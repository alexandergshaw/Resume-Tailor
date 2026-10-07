// AC-N3 follow-up, RE-POINTED for N125 (§5.2, ruled inversion).
//
// This file used to assert that the answer response's `idealProject` carried
// the per-question MODEL example on the accept path. N125 moves that
// per-question generation OFF the answer serve path entirely: the answer
// response now carries the READY/POOL example (question-INDEPENDENT), served
// by a synchronous `peekIdealProject` that MISSES on a cold tick and returns
// the deterministic archetype. The per-question accept path moves to the NEW
// `/api/copilot/ideal-project` endpoint (see idealProject.endpoint.test.js).
//
// So the accept assertion below inverts: on a cold tick the answer response's
// `idealProject.project.title` is the DETERMINISTIC archetype's, NEVER
// `GOOD_EXAMPLE.title` — asserting the opposite would prove the per-question
// accept leaked back onto the answer path, which is exactly what N125 removes.
// The remaining cases stay green but their MEANING shifts (noted per case).
//
// RED on HEAD: the route still generates the example inline and accepts it, so
// `idealProject.project.title === GOOD_EXAMPLE.title` until step 6 lands the
// pool peek + removes the inline call. (This file's reds are grounded on the
// N125 §3.3 contract; see the TDD notes — the route change itself was not
// reference-built by the TDD seat.)
//
// Each case still mocks the two `generateContent` calls (answer + pool
// prefetch) separately, since a mock that cannot tell them apart cannot test
// either one.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { idealProjectPoolCache, idealProjectTailoredCache } from "@/lib/copilot/answerSessionCache";

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
    // The ideal-project caches are module-level and outlive a test. Production
    // starts every application with a COLD pool (so the prefetch fires); a pool
    // warmed by an earlier case here would suppress the prefetch and make a later
    // case's call-count assertion depend on declaration order.
    idealProjectPoolCache.clear();
    idealProjectTailoredCache.clear();
    mockUserWithPosting();
  });

  // RE-POINTED (N125 §5.2). The answer response's `idealProject` is the POOL
  // peek (question-INDEPENDENT), which MISSES on a cold tick and returns the
  // deterministic archetype. So shape/summary/metrics are still present (they
  // are deterministic), and `project` carries the DETERMINISTIC example —
  // `project.title !== GOOD_EXAMPLE.title`. That inequality is the load-bearing
  // part: it proves the per-question model accept did NOT leak onto the answer
  // path. The accept path itself is exercised by idealProject.endpoint.test.js.
  // RED on HEAD: the inline accept makes `project.title === GOOD_EXAMPLE.title`.
  it("carries the deterministic POOL example on a cold tick, never the per-question model one", () => {
    mockGeminiPerCall({ example: GOOD_EXAMPLE });
    return draft().then((data) => {
      expect(data.idealProject).not.toBeNull();
      expect(typeof data.idealProject.shape).toBe("string");
      expect(data.idealProject.shape.trim()).not.toBe("");
      expect(data.idealProject.summary).toMatch(/^They want a project built around/);
      expect(Array.isArray(data.idealProject.metrics)).toBe(true);
      expect(data.idealProject.metrics.length).toBeGreaterThan(0);
      // The deterministic archetype — a complete 4-section example — NOT the
      // per-question model example the mock would have returned.
      expect(data.idealProject.project.sections).toHaveLength(4);
      expect(data.idealProject.project.sections.map((s) => s.label)).toEqual(["Problem", "Built", "Ran", "Landed"]);
      expect(data.idealProject.project.title).not.toBe(GOOD_EXAMPLE.title);
    });
  });

  // GREEN, meaning SHIFTED (N125 §5.2): the answer path is now ALWAYS the
  // pool/deterministic example on a cold tick, whatever the (pool-prefetch)
  // mock returns, so this now proves "the pool/deterministic block always
  // renders" rather than "the accept-wiring produces a complete block".
  it("renders a complete pool/deterministic block regardless of the model response", async () => {
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

  // GREEN, now TRIVIAL (N125 §5.2): with the answer path always deterministic
  // on a cold tick, this no longer distinguishes reject from accept — it is an
  // answer-contract-shape guard (4 sections, not the rejected title). The
  // accept/reject DISTINCTION now lives in idealProject.endpoint.test.js.
  it("carries a complete deterministic example on the answer path (answer-contract shape)", async () => {
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
