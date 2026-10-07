// N126: the spend ceiling on POST /api/copilot/ideal-project. Added beside
// route.test.js rather than inside it: that file's landed assertions describe the
// READY / TAILORED contract and are not edited. This file pins the BOUND.
//
// The endpoint's TAILORED tier is a live per-question Gemini generation, and its
// READY tier starts the posting-only pool generation; until this bound existed a
// loop against it (or one signed-in caller hammering distinct questions) was
// unmetered. Mirrors app/api/copilot/critique/route.test.js's ceiling suite.
//
// The static half of the contract -- the limiter is a MODULE-SCOPE singleton, the
// 429 is built from rateLimitHeaders(), the declared number matches the table --
// lives in lib/rateLimit/adoption.test.js. This is the behavioural half, and it
// is the half that catches a per-request limiter: that shape permits all
// LIMIT+1 requests while looking correct.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache, idealProjectPoolCache, idealProjectTailoredCache } from "@/lib/copilot/answerSessionCache";

const LIMIT = 40;

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

// USER IDS ARE UNIQUE PER CASE, deliberately. This route's rate limiter is a
// module singleton -- that is the whole point of building it at module scope --
// so its counters survive between `it()` blocks in this file exactly as they
// survive between requests in production. Reusing one id would make a later case
// start already part-way to the bound. Returns the `from` spy so a case can
// prove no posting was ever loaded for a denied request.
function mockUser(id) {
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
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) }, from });
  return from;
}

function mockGemini() {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async () => ({ text: JSON.stringify(GOOD_EXAMPLE) }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

// READY for the embedded engine: the cheapest request the endpoint serves (no
// model reach at all), so a loop of them exercises the bound itself and nothing
// else. `json` is a spy so a case can prove the body was never read on a denial.
const request = (body, headers) => ({ ...(headers ? { headers } : {}), json: vi.fn(async () => body) });
const readyBody = { applicationId: "app-1", question: "Tell me about a project.", engine: "embedded" };

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
});

describe("the ideal-project spend ceiling actually bites (N126)", () => {
  it("denies past the bound with 429, Retry-After and the RateLimit-* headers", async () => {
    mockUser("ideal-greedy");

    const statuses = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      statuses.push((await POST(request(readyBody))).status);
    }

    // A limiter built INSIDE the handler gets a fresh store on every request,
    // so every caller is forever on its first request and all LIMIT+1 succeed.
    // This assertion is what catches that shape, and it is the reason the loop
    // runs one request PAST the bound instead of stopping at it.
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMIT);
    expect(statuses[LIMIT]).toBe(429);

    const denied = await POST(request(readyBody));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("RateLimit-Limit")).toBe(String(LIMIT));
    expect(denied.headers.get("RateLimit-Remaining")).toBe("0");
    const data = await denied.json();
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });

  it("counts per authenticated user, so one caller's flood cannot deny another", async () => {
    mockUser("ideal-flooder");
    for (let i = 0; i < LIMIT + 1; i += 1) await POST(request(readyBody));
    const flooded = await POST(request(readyBody));
    expect(flooded.status).toBe(429);

    mockUser("ideal-bystander");
    const bystander = await POST(request(readyBody));
    expect(bystander.status).toBe(200);
  });

  it("counts READY and TAILORED against ONE allowance per user", async () => {
    mockUser("ideal-both-tiers");
    mockGemini();
    // Half READY, half TAILORED (the cadence the client really has: one of each
    // per question). Both tiers land in the same bucket, so the pair runs the
    // allowance out at LIMIT total requests, not LIMIT of each.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await POST(
        request(i % 2 === 0 ? readyBody : { ...readyBody, engine: "gemini", question: `Question ${i}`, tailored: true }),
      );
      expect(res.status).toBe(200);
    }
    expect((await POST(request(readyBody))).status).toBe(429);
    expect((await POST(request({ ...readyBody, engine: "gemini", question: "One more", tailored: true }))).status).toBe(429);
  });

  it("spends nothing on a denied request -- no body read, no posting loaded, no model client constructed", async () => {
    const from = mockUser("ideal-nospend");
    for (let i = 0; i < LIMIT + 1; i += 1) await POST(request(readyBody));

    const generateContent = mockGemini();
    from.mockClear();
    const deniedRequest = request({ ...readyBody, engine: "gemini", question: "A brand new question", tailored: true });
    const denied = await POST(deniedRequest);
    expect(denied.status).toBe(429);
    expect(deniedRequest.json).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("keys on the resolved user id, not a forged x-forwarded-for: rotating it buys no fresh bucket", async () => {
    mockUser("ideal-forger");
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await POST(request(readyBody, new Headers({ "x-forwarded-for": `9.9.9.${i % 250}, 10.0.0.1` })));
      expect(res.status).toBe(200);
    }
    const denied = await POST(request(readyBody, new Headers({ "x-forwarded-for": "7.7.7.7, 10.0.0.1" })));
    expect(denied.status).toBe(429);
  });

  it("resolves the user BEFORE it checks the bound: unauthenticated requests stay 401, never 429", async () => {
    // A gate placed ahead of auth would have no user id to key on and, with no
    // trustworthy proxy chain, would refuse the caller (identify -> "unidentified"
    // -> 429). 401 on every one of LIMIT+1 requests is the order, pinned.
    mockUser(null);
    for (let i = 0; i < LIMIT + 1; i += 1) {
      expect((await POST(request(readyBody))).status).toBe(401);
    }
  });
});
