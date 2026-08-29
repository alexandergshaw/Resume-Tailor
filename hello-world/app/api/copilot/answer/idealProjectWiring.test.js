// AC-N3 follow-up: the route's wiring of the MODEL-GENERATED worked example
// into the ideal-project aid.
//
// This file exists because of a specific hole. `route.test.js`'s `mockGemini`
// returns ONE canned payload for every `generateContent` call, so the second
// call — the one asking for a worked example — always came back as the answer
// payload, always failed validation, and always fell back to the deterministic
// archetype. The accept path was therefore never executed by any test, and it
// shipped broken: the route substituted the generated `{ title, sections,
// outcomes }` for the WHOLE aid, dropping `shape`, `summary` and `metrics`, and
// `AnswerAids` then computed `hasIdealRow === false` and rendered nothing at
// all. The headline feature reached the user only when it failed.
//
// So every case here mocks the two calls SEPARATELY. That is the whole point:
// a mock that cannot tell the two calls apart cannot test either one.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";

const POSTING = [
  "Senior Product Manager, Education Technology",
  "Salary range: $78,496.00 - $105,974.00 annually.",
  "This role supports 12 campuses and a team of 8.",
  "You will run Agile ceremonies and bring Artificial Intelligence into the classroom.",
  "Requirements: 5+ years of product management experience.",
].join("\n");

const ANSWER_PAYLOAD = {
  points: ["Situation: I owned the rollout.", "Result: it landed on time."],
  cues: ["Situation: the rollout", "Result: on time"],
  type: "behavioral",
};

// A worked example the validator will vouch for: four labels in order, bodies
// inside the word bounds, third person, digit-free metrics, figures carrying
// digits, and not one number that occurs in POSTING.
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

function mockUserWithPosting(description = POSTING) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === "applications") {
          // `positions`, not `position` — the embedded relation's key in
          // fetchPostingDescription's select. Getting it wrong yields an empty
          // description, which makes every case here fail for the wrong reason
          // (no posting means no aid at all, rather than a mis-wired one).
          return { data: { id: "app-1", positions: { description } }, error: null };
        }
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from,
  });
}

// AC-C9d — a PROSPECTIVE hazard recorded for the next person to add a case
// here, not a live one: `draft()` below sends no `interviewType`, so
// `route.js` normalizes that to `general` (not code-bearing), and chunk C's
// code-language resolver is never reached by anything in this file today —
// verified, not assumed. But the day a case here passes a code-bearing type,
// the resolver's own model call becomes a THIRD description-carrying
// `generateContent` call, which this router (`isExampleCall`, just below)
// cannot tell apart from the worked-example call by an EXCLUSION test, and
// which `:170`'s `.filter((text) => !text.includes("Problem"))` would then
// misclassify as an answer call. At that point the fix is POSITIVE
// identification of each call (e.g. by its own system instruction or a
// distinctive marker each prompt actually carries), never a longer exclusion
// list — this file's own header states that rule for the two calls it
// already tells apart, and a third call is the same problem, not a new one.
//
// Answers each `generateContent` call by looking at what was actually asked
// for. The example prompt is the only one carrying the posting description —
// which is itself worth asserting, since AC-H7.27 requires the posting reach
// no other prompt.
function mockGeminiPerCall({ example }) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async (req) => {
    const text = JSON.stringify(req?.contents?.[0]?.parts?.[0]?.text || "");
    const isExampleCall = text.includes("Salary range") || text.includes("Problem");
    if (isExampleCall) {
      return { text: example === undefined ? "not json at all" : JSON.stringify(example) };
    }
    return { text: JSON.stringify(ANSWER_PAYLOAD) };
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

async function draft() {
  const res = await POST({
    json: async () => ({ question: "Tell me about a project you owned.", applicationId: "app-1", mode: "answer", engine: "gemini" }),
  });
  return res.json();
}

describe("the generated worked example is wired into the aid, not substituted for it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserWithPosting();
  });

  // The bug this file was written for. A valid example must ENRICH the aid,
  // never replace it: `shape`, `summary` and `metrics` are computed
  // deterministically and are what the rest of the block renders from. Without
  // them `AnswerAids` finds nothing to show and the whole row disappears.
  it("keeps shape, summary and metrics when the model's example is accepted", () => {
    mockGeminiPerCall({ example: GOOD_EXAMPLE });
    return draft().then((data) => {
      expect(data.idealProject).not.toBeNull();
      expect(typeof data.idealProject.shape).toBe("string");
      expect(data.idealProject.shape.trim()).not.toBe("");
      expect(data.idealProject.summary).toMatch(/^They want a project built around/);
      expect(Array.isArray(data.idealProject.metrics)).toBe(true);
      expect(data.idealProject.metrics.length).toBeGreaterThan(0);
      // And the generated example is what `project` carries.
      expect(data.idealProject.project.title).toBe(GOOD_EXAMPLE.title);
      expect(data.idealProject.project.sections.map((s) => s.label)).toEqual(["Problem", "Built", "Ran", "Landed"]);
    });
  });

  // The exact condition AnswerAids uses to decide whether to render the row at
  // all. Asserting the fields individually above is not enough — this is the
  // predicate that actually failed, and it must hold on BOTH paths.
  it("renders a complete block whether the example is accepted or rejected", async () => {
    for (const example of [GOOD_EXAMPLE, { title: "", sections: [], outcomes: [] }, undefined]) {
      vi.clearAllMocks();
      mockUserWithPosting();
      mockGeminiPerCall({ example });
      const data = await draft();
      const ideal = data.idealProject;
      expect(ideal, `no aid at all for example=${JSON.stringify(example)?.slice(0, 40)}`).toBeTruthy();
      const idealLine = (ideal.summary || "").trim() || (ideal.shape || "").trim();
      const hasExample = Array.isArray(ideal.project?.sections) && ideal.project.sections.length > 0;
      const hasMetrics = Array.isArray(ideal.metrics) && ideal.metrics.length > 0;
      expect(!!idealLine || hasMetrics || hasExample).toBe(true);
    }
  });

  // A rejected example must leave the deterministic one in place — not null,
  // not a half-built object.
  it("falls back to the deterministic example when the model's is rejected", async () => {
    mockGeminiPerCall({ example: { title: "I owned it.", sections: [], outcomes: [] } });
    const data = await draft();
    expect(data.idealProject.project).toBeTruthy();
    expect(data.idealProject.project.sections).toHaveLength(4);
    expect(data.idealProject.project.title).not.toBe("I owned it.");
  });

  // AC-H7.27, re-asserted from the new direction: the example prompt is the
  // only one that may carry the posting description.
  it("never lets the posting description reach the answer prompt", async () => {
    const generateContent = mockGeminiPerCall({ example: GOOD_EXAMPLE });
    await draft();
    expect(generateContent.mock.calls.length).toBeGreaterThanOrEqual(2);
    const answerCalls = generateContent.mock.calls
      .map((call) => String(call[0]?.contents?.[0]?.parts?.[0]?.text || ""))
      .filter((text) => !text.includes("Problem"));
    expect(answerCalls.length).toBeGreaterThan(0);
    for (const text of answerCalls) {
      expect(text).not.toContain("Salary range");
      expect(text).not.toContain("12 campuses");
    }
  });

  // The aid is never worth failing the answer over.
  it("still answers when the example call throws", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: {
        generateContent: vi.fn(async (req) => {
          const text = String(req?.contents?.[0]?.parts?.[0]?.text || "");
          if (text.includes("Salary range")) throw new Error("example call exploded");
          return { text: JSON.stringify(ANSWER_PAYLOAD) };
        }),
      },
    });
    const data = await draft();
    expect(data.points.length).toBeGreaterThan(0);
    expect(data.idealProject.project.sections).toHaveLength(4);
  });
});
