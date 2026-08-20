// Fix round on POST /api/copilot/role-situation, following an adversarial
// audit of the Gemini path. Two real defects, both here rather than in
// route.contract.test.js (that file is frozen - the coordinator's rule is
// this round adds tests, it doesn't edit the existing gate):
//
//   1. `sanitizeAsked` caps every `asked` entry to MAX_ASKED_CHARS before it
//      is ever compared, but the freshly generated `prompt` used to be
//      compared at full length. A generated prompt longer than that cap
//      could therefore never match its own (capped) recorded entry, so it
//      could be re-served forever with `source: "gemini"` while `exhausted`
//      stayed false. route.js now slices the prompt to the same cap before
//      comparing - the same fix, for the same reason, as
//      app/api/copilot/question/route.js already documents.
//   2. Nothing the model returned was validated beyond "non-empty and not a
//      verbatim repeat": no bound on `prompt` length (it renders straight
//      into an h3) and no check that `context` is even non-empty. route.js
//      now rejects anything outside the bank's own AC-Q2.3/AC-Q2.4 shape
//      (prompt 80-420 chars, context 1-200 chars) and falls back exactly
//      like every other failure on this route, reported as
//      `source: "fallback"`.
//
// A third question the audit raised but that turned out not to be a defect:
// whether the response's `role` could ever echo something the model
// returned. It can't - route.js's response always uses the locally resolved
// `role` (from normalizeRole(body?.role)), never anything read off
// `parsed`. The last test below pins that down so it stays true.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { nextRoleSituation } from "@/lib/copilot/roleSituations";

function jsonRequest(body) {
  return { json: async () => body };
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

function mockGemini(payload, { throws = false } = {}) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = throws
    ? vi.fn().mockRejectedValue(new Error("model down"))
    : vi.fn().mockResolvedValue({ text: JSON.stringify(payload) });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

// A prompt in the bank's own valid range (AC-Q2.3: 80-420 chars), so it
// isolates the length/shape checks from one another.
const VALID_PROMPT =
  "Your director pulls you aside after the meeting and asks, in front of two other managers, why the " +
  "rollout plan changed twice this week without any warning to the wider team.";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/copilot/role-situation - validates the model's shape (defect 2)", () => {
  it("falls back when the model's prompt is longer than the bank's own upper bound", async () => {
    mockUser();
    mockGemini({ prompt: "A".repeat(450), context: "Two other managers are in the room." });
    const res = await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }));
    const data = await res.json();
    expect(data.source).toBe("fallback");
    expect(data.situation.id).toBe(nextRoleSituation({ role: "manager", asked: [] }).situation.id);
  });

  it("falls back when the model's prompt is shorter than the bank's own lower bound", async () => {
    mockUser();
    mockGemini({ prompt: "Too short.", context: "Not much context either." });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }))
    ).json();
    expect(data.source).toBe("fallback");
  });

  it("falls back when the model's context is empty", async () => {
    mockUser();
    mockGemini({ prompt: VALID_PROMPT, context: "" });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }))
    ).json();
    expect(data.source).toBe("fallback");
  });

  it("falls back when the model's context is missing entirely", async () => {
    mockUser();
    mockGemini({ prompt: VALID_PROMPT });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }))
    ).json();
    expect(data.source).toBe("fallback");
  });

  it("falls back when the model's context is longer than the bank's own upper bound", async () => {
    mockUser();
    mockGemini({ prompt: VALID_PROMPT, context: "C".repeat(201) });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }))
    ).json();
    expect(data.source).toBe("fallback");
  });

  it("still accepts a prompt and context that sit inside the bank's own bounds", async () => {
    mockUser();
    mockGemini({ prompt: VALID_PROMPT, context: "Two other managers are in the room." });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }))
    ).json();
    expect(data.source).toBe("gemini");
    expect(data.situation.prompt).toBe(VALID_PROMPT);
  });
});

describe("POST /api/copilot/role-situation - never repeats an over-cap situation (defect 1)", () => {
  it("falls back rather than re-serving a situation the model regenerates verbatim, even one longer than the asked cap", async () => {
    mockUser();
    // A prompt long enough that, pre-fix, comparing it at full length against
    // its own (MAX_ASKED_CHARS-capped) recorded entry would never match.
    const longRepeat = "R".repeat(450);
    mockGemini({ prompt: longRepeat, context: "Same room, same question, asked twice." });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [longRepeat], engine: "gemini" }))
    ).json();
    // This falls back for two independent reasons on the shipped route: the
    // prompt is over the bank's own length bound (defect 2's fix) AND it is
    // a recognised repeat once compared like-with-like (defect 1's fix) - see
    // the note below on why that overlap makes this specific input unable to
    // distinguish the two fixes from each other in the final route.
    expect(data.source).toBe("fallback");
  });
});

describe("POST /api/copilot/role-situation - the response role is never echoed from the model", () => {
  it("uses the requested (normalized) role even when the model's JSON includes its own role field", async () => {
    mockUser();
    mockGemini({
      prompt: VALID_PROMPT,
      context: "Two other managers are in the room.",
      role: "attorney",
    });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }))
    ).json();
    expect(data.role).toBe("manager");
  });
});
