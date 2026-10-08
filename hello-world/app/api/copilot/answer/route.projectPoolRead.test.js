import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// N143 fix round F1 -- M1 (the pool read must never block the answer) and M2
// (a read that ERRORS is `failed`, a row that is merely absent is `pending`),
// proved at the route.
//
// M1, measured before the fix: the route awaited the pool read ahead of the
// model call with nothing bounding it, so a read that never resolved meant the
// POST never returned and the model was called zero times. Row 1 is a nicety;
// it had become a precondition of the answer.
//
// The fix has two halves and this file pins them apart, because a deadline alone
// would pass a "does it hang" test while still putting the pool read in front of
// the first bullet:
//   DEFERRAL ... the read is settled at the END (inside the stream producer, just
//                before the `done` frame; just before the JSON body on the
//                non-streaming branches). Proved without any clock: the pool read
//                is a promise this test holds, the points frames are read while
//                it is still unsettled, and only then is it released.
//   DEADLINE .... a read that never settles is reported as a read error once its
//                deadline passes, so the terminal frame still arrives. The
//                deadline is shortened here (the unit test for the real figure
//                is lib/copilot/projectExampleRead.test.js).

const knobs = vi.hoisted(() => ({ deadlineMs: 40, poolRead: null }));

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/copilot/answerCodeLanguage", () => ({
  startCodeLanguageResolution: vi.fn(),
  peekCodeLanguage: vi.fn(() => null),
  generateCodeLanguage: vi.fn(),
}));
// The real deadline race, with its duration set per test. projectExampleRead.js
// races the pool read through settleWithin and nothing else in this file's
// requests does (no company is known, and the code-language resolver is mocked
// above), so overriding the duration here moves exactly that deadline.
vi.mock("@/lib/copilot/answerSessionCache", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, settleWithin: (promise, _ms, options) => actual.settleWithin(promise, knobs.deadlineMs, options) };
});

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache } from "@/lib/copilot/answerSessionCache";
import { splitFrames } from "@/lib/copilot/answerStream";

const PAYLOAD = {
  points: ["Situation: I led the checkout migration.", "Result: latency fell by a third."],
  type: "behavioral",
};
const QUESTION = "Tell me about an incident you handled in production.";

const ENTRY = (competency, domain, title) => ({
  competency,
  domain,
  title,
  bullets: ["Cut alert noise from 5 to 1 per shift", "Raised the pass rate 61% to 78%"],
  hypothetical: true,
});
const READY_ROW = {
  application_id: "app-1",
  status: "ready",
  engine: "gemini",
  updated_at: "2026-10-08T00:00:00.000Z",
  projects: [ENTRY("incident response", "SRE", "Rebuilt the paging rotation"), ENTRY("curriculum design", "K-12 teaching", "Rebuilt the fractions unit")],
};

function jsonRequest(body) {
  return { json: async () => body };
}

// One `applications` row answers every docs/posting/employer lookup; `company` is
// empty on purpose so no company-facts search puts a second model call on the
// request. The pool table answers whatever `knobs.poolRead` produces.
function mockSupabase() {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => ({ data: [], error: null })),
      maybeSingle: vi.fn(async () => {
        if (table === "application_project_pool") return knobs.poolRead();
        if (table === "applications") {
          return {
            data: { id: "app-1", resume_used_id: null, cover_letter_id: null, positions: { description: "Run the estate.", company: "", title: "SRE" } },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from });
}

function chunkStream(chunks) {
  return (async function* () {
    for (const text of chunks) yield { text };
  })();
}

function mockGemini() {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const models = {
    generateContentStream: vi.fn().mockImplementation(async () => chunkStream([JSON.stringify(PAYLOAD)])),
    generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(PAYLOAD) }),
  };
  getGeminiClient.mockReturnValue({ models });
  return models;
}

// Reads frames from a streamed body as they arrive. `next(ms)` returns the next
// frame, or `null` if none arrives within `ms` (the producer is waiting), or
// `undefined` once the stream has ended.
function frameReader(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queue = [];
  let ended = false;
  // A read that lost the race to a timeout is still outstanding and will deliver
  // its chunk: it is kept and raced again, never abandoned for a fresh read,
  // which would silently drop the frames it carried.
  let pending = null;
  return {
    async next(ms) {
      for (;;) {
        if (queue.length) return queue.shift();
        if (ended) return undefined;
        pending ??= reader.read();
        const raced = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve("timeout"), ms))]);
        if (raced === "timeout") return null;
        pending = null;
        if (raced.done) {
          ended = true;
          continue;
        }
        buffer += decoder.decode(raced.value, { stream: true });
        const split = splitFrames(buffer);
        buffer = split.rest;
        queue.push(...split.frames);
      }
    },
    async all() {
      const frames = [];
      for (;;) {
        const frame = await this.next(5000);
        if (frame === undefined) return frames;
        if (frame === null) throw new Error("stream stalled");
        frames.push(frame);
      }
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  answerContextCache.clear();
  knobs.deadlineMs = 40;
  knobs.poolRead = async () => ({ data: null, error: null });
  mockSupabase();
});
afterEach(() => vi.unstubAllEnvs());

const NEVER = () => new Promise(() => {});

describe("DEFERRAL -- the answer streams before the pool read settles (M1)", () => {
  it("writes the points frames while the pool read is still unsettled, then delivers Row 1 on the done frame", async () => {
    let release;
    knobs.deadlineMs = 10_000;
    knobs.poolRead = () => new Promise((resolve) => (release = () => resolve({ data: READY_ROW, error: null })));
    const models = mockGemini();

    const res = await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", stream: true }));
    const frames = frameReader(res);

    // The first bullet arrives with the pool read held. Had the read been
    // awaited ahead of the model call, the model would not have been called and
    // this frame would never come.
    const first = await frames.next(2000);
    expect(first?.t).toBe("points");
    expect(models.generateContentStream).toHaveBeenCalledTimes(1);
    expect(typeof release).toBe("function");

    // Everything the model wrote is out; the producer is now waiting on the read
    // and nothing terminal has been written.
    const seen = [first];
    for (let frame = await frames.next(150); frame; frame = await frames.next(150)) seen.push(frame);
    expect(seen.every((f) => f.t === "points")).toBe(true);

    release();
    const rest = await frames.all();
    const done = rest.find((f) => f.t === "done");
    expect(done).toBeTruthy();
    expect(done.points).toEqual(PAYLOAD.points);
    expect(done.projectExample.status).toBe("ready");
    expect(done.projectExample.competency).toBe("incident response");
  });
});

describe("DEADLINE -- a read that never settles cannot hang the answer (M1)", () => {
  it("streaming: the answer and its done frame still arrive, Row 1 reads failed, the model was called once", async () => {
    knobs.poolRead = NEVER;
    const models = mockGemini();
    const res = await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", stream: true }));
    const all = await frameReader(res).all();
    const done = all.find((f) => f.t === "done");
    expect(all.some((f) => f.t === "points")).toBe(true);
    expect(done.points).toEqual(PAYLOAD.points);
    // Not pending: nothing is being prepared on the user's behalf.
    expect(done.projectExample).toEqual({ status: "failed" });
    expect(models.generateContentStream).toHaveBeenCalledTimes(1);
  });

  it("non-streaming points mode: the POST returns the answer, Row 1 reads failed, the model was called once", async () => {
    knobs.poolRead = NEVER;
    const models = mockGemini();
    const res = await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points).toEqual(PAYLOAD.points);
    expect(data.projectExample).toEqual({ status: "failed" });
    expect(models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("non-streaming answer mode: the POST returns the answer, Row 1 reads failed, the model was called once", async () => {
    knobs.poolRead = NEVER;
    const models = mockGemini();
    const res = await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", engine: "gemini", mode: "answer" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points).toEqual(PAYLOAD.points);
    expect(typeof data.answer).toBe("string");
    expect(data.projectExample).toEqual({ status: "failed" });
    expect(models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("[positive control] with the read healthy the same requests carry a real Row 1", async () => {
    knobs.poolRead = async () => ({ data: READY_ROW, error: null });
    mockGemini();
    const stream = await frameReader(await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", stream: true }))).all();
    expect(stream.find((f) => f.t === "done").projectExample.status).toBe("ready");
    const json = await (await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", engine: "gemini" }))).json();
    expect(json.projectExample.status).toBe("ready");
  });
});

describe("ERROR is failed, ABSENT is pending (M2)", () => {
  const cases = [
    ["a query error", async () => ({ data: null, error: { message: "connection reset by peer" } })],
    ["a thrown read", async () => {
      throw new Error("socket hang up");
    }],
  ];

  it.each(cases)("%s -> failed on every Gemini branch, never pending", async (_label, poolRead) => {
    knobs.poolRead = poolRead;
    mockGemini();
    const stream = await frameReader(await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", stream: true }))).all();
    expect(stream.find((f) => f.t === "done").projectExample).toEqual({ status: "failed" });
    for (const extra of [{}, { mode: "answer" }]) {
      const data = await (await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", engine: "gemini", ...extra }))).json();
      expect(data.projectExample).toEqual({ status: "failed" });
    }
  });

  it("[control] a clean miss (no row, no error) is still pending, so the two are told apart", async () => {
    knobs.poolRead = async () => ({ data: null, error: null });
    mockGemini();
    const stream = await frameReader(await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", stream: true }))).all();
    expect(stream.find((f) => f.t === "done").projectExample).toEqual({ status: "pending" });
    const data = await (await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", engine: "gemini" }))).json();
    expect(data.projectExample).toEqual({ status: "pending" });
  });
});

describe("the probe's evidence rides the done frame (m5)", () => {
  it("a ready pick carries the fit score and the WHOLE pool's tags", async () => {
    knobs.poolRead = async () => ({ data: READY_ROW, error: null });
    mockGemini();
    const done = (await frameReader(await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", stream: true }))).all()).find(
      (f) => f.t === "done",
    );
    expect(done.projectExample.status).toBe("ready");
    expect(done.projectExample.fitScore).toBeGreaterThanOrEqual(1);
    expect(done.projectExample.poolTags).toEqual([
      { competency: "incident response", domain: "SRE", title: "Rebuilt the paging rotation" },
      { competency: "curriculum design", domain: "K-12 teaching", title: "Rebuilt the fractions unit" },
    ]);
  });

  it("a no_match carries the tags too, and still no benchmark of its own", async () => {
    knobs.poolRead = async () => ({ data: READY_ROW, error: null });
    mockGemini();
    const data = await (
      await POST(jsonRequest({ question: "Describe how you would price a cloud contract.", applicationId: "app-1", engine: "gemini" }))
    ).json();
    expect(data.projectExample.status).toBe("no_match");
    expect(data.projectExample.fitScore).toBe(0);
    expect(data.projectExample.poolTags).toHaveLength(2);
    expect(data.projectExample).not.toHaveProperty("bullets");
    expect(data.projectExample).not.toHaveProperty("title");
  });

  it("pending and failed frames gain nothing", async () => {
    knobs.poolRead = async () => ({ data: null, error: { message: "down" } });
    mockGemini();
    const data = await (await POST(jsonRequest({ question: QUESTION, applicationId: "app-1", engine: "gemini" }))).json();
    expect(Object.keys(data.projectExample)).toEqual(["status"]);
  });
});
