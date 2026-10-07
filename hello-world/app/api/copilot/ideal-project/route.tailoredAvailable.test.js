// N125 fresh-verify F2: the READY response carries the SERVER's verdict on
// whether a TAILORED request can ever be served (`tailoredAvailable`), because
// the client cannot compute wantsEmbedded itself — it needs the server's
// RESUME_ENGINE and key. Gating the client on its own engine string alone let a
// server-forced embedded deployment (or a keyless one) fire a TAILORED POST that
// could only come back empty, and flash a "Tailoring to this question..." cue
// for a result that could never arrive.
//
// The flag must AGREE with the gate the TAILORED branch actually applies, so
// each case below pairs the flag with what a TAILORED request really does under
// the same environment: a flag that said `true` while the server refused (or
// the reverse) fails here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache, idealProjectPoolCache, idealProjectTailoredCache } from "@/lib/copilot/answerSessionCache";

const POSTING = [
  "Senior Product Manager, Education Technology",
  "We are hiring a product manager to own our K-12 product suite end to end.",
  "You will run Agile ceremonies and partner with UX design and customer success to shape the product roadmap.",
].join("\n");

const GOOD_EXAMPLE = {
  title: "Rebuilding the enrolment workflow teachers actually use, in Education.",
  sections: [
    { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the enrolment flow ran to seven screens." },
    { label: "Built", body: "A single-screen flow with the roster pre-filled from the student system, and an assistant flagging incomplete records before submission." },
    { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so settled trade-offs stayed settled." },
    { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the part that did not move at all." },
  ],
  outcomes: [
    { metric: "adoption rate", figure: "34% → 71% of teachers active weekly" },
    { metric: "user satisfaction / NPS", figure: "teacher NPS +9 → +38" },
    { metric: "time-to-ship", figure: "median idea-to-production 9 weeks → 3" },
  ],
};

function mockUser() {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === "applications") return { data: { id: "app-1", positions: { description: POSTING } }, error: null };
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from });
}

function mockGemini() {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async () => ({ text: JSON.stringify(GOOD_EXAMPLE) }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

const call = (body) => POST({ json: async () => ({ applicationId: "app-1", question: "Tell me about a project you owned.", ...body }) });
const readyFor = async (engine) => (await call({ engine })).json();
const tailoredFor = async (engine) => (await call({ engine, tailored: true })).json();

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
  // Hermetic: neither the server default nor a key may leak in from the shell.
  vi.stubEnv("RESUME_ENGINE", "");
  vi.stubEnv("Gemini_LLM_API_Key", "");
  mockUser();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/copilot/ideal-project — READY carries tailoredAvailable (N125 F2)", () => {
  it("is true for a gemini request on a server with no forbidding default, and a TAILORED request IS served", async () => {
    mockGemini();
    const ready = await readyFor("gemini");
    expect(ready.tier).toBe("ready");
    expect(ready.tailoredAvailable).toBe(true);

    const tailored = await tailoredFor("gemini");
    expect(tailored.idealProject).not.toBeNull();
    expect(tailored.idealProject.project.title).toBe(GOOD_EXAMPLE.title);
  });

  it("is false for the user-picked embedded engine, and a TAILORED request makes no model call", async () => {
    const generateContent = mockGemini();
    expect((await readyFor("embedded")).tailoredAvailable).toBe(false);

    expect((await tailoredFor("embedded")).idealProject).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("is false when the SERVER forces embedded (RESUME_ENGINE=embedded) though the client asked for gemini", async () => {
    vi.stubEnv("RESUME_ENGINE", "embedded");
    const generateContent = mockGemini();
    const ready = await readyFor("gemini");
    // Positive control: an example IS served, so a route that answered nothing
    // cannot satisfy the flag assertion below by accident.
    expect(ready.idealProject.project.sections).toHaveLength(4);
    expect(ready.tailoredAvailable).toBe(false);

    expect((await tailoredFor("gemini")).idealProject).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("follows key presence when the request names no engine: false without a key, true with one", async () => {
    mockGemini();
    expect((await readyFor(undefined)).tailoredAvailable).toBe(false);

    vi.stubEnv("Gemini_LLM_API_Key", "test-key");
    answerContextCache.clear();
    expect((await readyFor(undefined)).tailoredAvailable).toBe(true);
  });

  it("is present (false) on a posting-less READY too, so the client never has to guess", async () => {
    mockGemini();
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: vi.fn(() => {
        const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
        return chain;
      }),
    });
    const ready = await readyFor("embedded");
    expect(ready.idealProject).toBeNull();
    expect(ready.tailoredAvailable).toBe(false);
  });
});
