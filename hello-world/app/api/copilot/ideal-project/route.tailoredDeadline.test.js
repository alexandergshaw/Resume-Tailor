// N129 defect 1 (deadline too short) and the endpoint half of defect 2 (double
// fire). Added beside route.test.js rather than inside it: that file's header
// says the deadline NUMBER is deliberately not pinned, and a landed test is not
// edited. What this file pins is the BEHAVIOUR the number exists for:
//
//  - a TAILORED generation that takes longer than the old 6s cap but finishes
//    inside the deadline is RETURNED, not abandoned. The live log showed every
//    tailored request ending at ~6.2s (the 6s cap plus request overhead), so the
//    cap was discarding the example almost every time;
//  - a generation that never finishes still degrades to `idealProject: null`
//    (the safety path the deadline exists for);
//  - two concurrent TAILORED POSTs for one (application, question) share ONE
//    model call and both carry the example.
//
// Fake timers throughout: the model latency is a faked setTimeout, so no case
// waits real seconds. The deadline VALUE is not exported (a Next route file may
// only export its handlers and segment config), so the cases bracket it: an
// example at 8s and at 15s must be served, and a hung call must give up.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import * as route from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache, idealProjectPoolCache, idealProjectTailoredCache } from "@/lib/copilot/answerSessionCache";

const { POST } = route;

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

// A model whose call takes `delayMs` of (faked) wall-clock, or never returns.
function mockSlowGemini(delayMs) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(
    () =>
      new Promise((resolve) => {
        if (delayMs === Infinity) return;
        setTimeout(() => resolve({ text: JSON.stringify(GOOD_EXAMPLE) }), delayMs);
      }),
  );
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

const tailoredCall = (question = "Tell me about a project you owned.") =>
  POST({ json: async () => ({ applicationId: "app-1", question, engine: "gemini", tailored: true }) });

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
  vi.useFakeTimers();
  mockUser();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/copilot/ideal-project — the TAILORED deadline does not discard a slow-but-finishing example (N129)", () => {
  it.each([8000, 15000])(
    "RETURNS an example whose generation takes %ims — past the old 6s cap, inside the deadline",
    async (latencyMs) => {
      mockSlowGemini(latencyMs);
      const pending = tailoredCall();
      await vi.advanceTimersByTimeAsync(latencyMs + 50);
      const data = await (await pending).json();
      expect(data.tier).toBe("tailored");
      expect(data.source).toBe("model");
      expect(data.idealProject).not.toBeNull();
      expect(data.idealProject.project.title).toBe(GOOD_EXAMPLE.title);
    },
  );

  it("is still WAITING at 7s, the point the old 6s cap had already given up at", async () => {
    mockSlowGemini(8000);
    const pending = tailoredCall();
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(7000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(settled).toBe(true);
  });

  it("still degrades to idealProject null (never an error) when the model call never finishes", async () => {
    const generateContent = mockSlowGemini(Infinity);
    const pending = tailoredCall();
    await vi.advanceTimersByTimeAsync(120000);
    const res = await pending;
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("tailored");
    expect(data.source).toBeNull();
    expect(data.idealProject).toBeNull();
    // Positive control: the model WAS asked, so the null is the deadline's
    // doing and not a request that never reached it.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("declares a function duration that outlasts the deadline, so the platform default cannot kill the request first", () => {
    expect(route.maxDuration).toBeGreaterThanOrEqual(30);
  });
});

describe("POST /api/copilot/ideal-project — concurrent identical TAILORED requests share one model call (N129)", () => {
  it("makes ONE model call for two simultaneous POSTs of the same question, and both carry the example", async () => {
    // 2s, well inside any deadline, so this isolates the sharing from the
    // deadline cases above.
    const generateContent = mockSlowGemini(2000);
    const first = tailoredCall("Tell me about a project you owned.");
    const second = tailoredCall("Tell me about a project you owned.");
    await vi.advanceTimersByTimeAsync(2100);
    const [a, b] = await Promise.all([first, second].map(async (p) => (await p).json()));
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(a.idealProject.project.title).toBe(GOOD_EXAMPLE.title);
    expect(b.idealProject.project.title).toBe(GOOD_EXAMPLE.title);
  });

  it("control: two DIFFERENT questions are two model calls", async () => {
    const generateContent = mockSlowGemini(2000);
    const first = tailoredCall("Tell me about a project you owned.");
    const second = tailoredCall("Tell me about a time you resolved a conflict.");
    await vi.advanceTimersByTimeAsync(2100);
    await Promise.all([first, second]);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
