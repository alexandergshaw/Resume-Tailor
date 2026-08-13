import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/settings/engine", () => ({ readEngine: vi.fn(() => "gemini") }));

import { draftAnswerStreaming } from "./answerClient.js";

// AC-P2.6: the browser half of the streaming answer path. The client's job is
// narrow on purpose — frame the bytes, hand each points frame to the caller,
// resolve with the terminal payload — because everything harder (the framing
// itself, extracting complete bullets from partial JSON) lives in the pure
// answerStream.js module beside it.

function streamingResponse(chunks, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder();
  return {
    ok,
    status,
    headers: { get: () => "application/x-ndjson" },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    json: async () => ({}),
  };
}

function frame(obj) {
  return `${JSON.stringify(obj)}\n`;
}

const ARGS = { question: "Tell me about a migration.", context: "", profile: "", applicationId: null };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete globalThis.fetch;
});

describe("draftAnswerStreaming (AC-P2.6)", () => {
  it("asks the route for a stream", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "done", points: ["a"], type: "general" })]),
    );
    await draftAnswerStreaming(ARGS, { onPoints: () => {} });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.question).toBe(ARGS.question);
  });

  it("calls onPoints for each points frame, in order", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([
        frame({ t: "points", points: ["a"] }),
        frame({ t: "points", points: ["a", "b"] }),
        frame({ t: "done", points: ["a", "b"], type: "general", cues: [] }),
      ]),
    );
    const seen = [];
    await draftAnswerStreaming(ARGS, { onPoints: (p) => seen.push(p) });
    expect(seen).toEqual([["a"], ["a", "b"]]);
  });

  it("delivers frames that arrive split across chunk boundaries", async () => {
    // A frame cut in half by the network is the normal case, not the edge one.
    const one = frame({ t: "points", points: ["First point."] });
    const two = frame({ t: "done", points: ["First point."], type: "general", cues: ["First"] });
    const joined = one + two;
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([joined.slice(0, 12), joined.slice(12, 40), joined.slice(40)]),
    );
    const seen = [];
    const result = await draftAnswerStreaming(ARGS, { onPoints: (p) => seen.push(p) });
    expect(seen).toEqual([["First point."]]);
    expect(result.points).toEqual(["First point."]);
  });

  it("resolves with the done frame's payload", async () => {
    const done = {
      t: "done",
      points: ["a", "b"],
      cues: ["ca", "cb"],
      type: "behavioral",
      buzzwords: ["kubernetes"],
      resumeAnchor: { title: "Engineer", company: "Acme" },
      idealProject: { shape: "platform" },
      grounding: { resume: true, coverLetter: false },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(streamingResponse([frame(done)]));
    const result = await draftAnswerStreaming(ARGS, { onPoints: () => {} });
    expect(result.points).toEqual(done.points);
    expect(result.cues).toEqual(done.cues);
    expect(result.type).toBe("behavioral");
    expect(result.buzzwords).toEqual(done.buzzwords);
    expect(result.resumeAnchor).toEqual(done.resumeAnchor);
    expect(result.idealProject).toEqual(done.idealProject);
    expect(result.grounding).toEqual(done.grounding);
  });

  it("rejects with the error frame's message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([
        frame({ t: "points", points: ["a"] }),
        frame({ t: "error", error: "Could not generate an answer." }),
      ]),
    );
    await expect(draftAnswerStreaming(ARGS, { onPoints: () => {} })).rejects.toThrow(
      /Could not generate an answer/,
    );
  });

  it("rejects when the stream ends with no terminal frame", async () => {
    // A dropped connection mid-answer must surface as a failure the card can
    // show a retry on, never as a silent resolve with half an answer.
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "points", points: ["a"] })]),
    );
    await expect(draftAnswerStreaming(ARGS, { onPoints: () => {} })).rejects.toThrow();
  });

  it("rejects with the route's error on a non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "Sign in to use the interview copilot." }),
      body: null,
    });
    await expect(draftAnswerStreaming(ARGS, { onPoints: () => {} })).rejects.toThrow(
      /Sign in to use the interview copilot/,
    );
  });

  it("never calls onPoints after resolving", async () => {
    let resolved = false;
    let lateCall = false;
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([
        frame({ t: "points", points: ["a"] }),
        frame({ t: "done", points: ["a"], type: "general", cues: [] }),
      ]),
    );
    await draftAnswerStreaming(ARGS, {
      onPoints: () => {
        if (resolved) lateCall = true;
      },
    });
    resolved = true;
    await new Promise((r) => setTimeout(r, 10));
    expect(lateCall).toBe(false);
  });

  it("survives a caller whose onPoints throws", async () => {
    // onPoints is a caller-supplied React setState wrapper; a throw there must
    // not lose an answer that otherwise arrived intact.
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([
        frame({ t: "points", points: ["a"] }),
        frame({ t: "done", points: ["a"], type: "general", cues: [] }),
      ]),
    );
    const result = await draftAnswerStreaming(ARGS, {
      onPoints: () => {
        throw new Error("render blew up");
      },
    });
    expect(result.points).toEqual(["a"]);
  });

  it("works with no onPoints callback at all", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "done", points: ["a"], type: "general", cues: [] })]),
    );
    const result = await draftAnswerStreaming(ARGS);
    expect(result.points).toEqual(["a"]);
  });
});
