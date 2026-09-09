import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/llm/extractEmployment", () => ({ extractEmploymentFromResumeText: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { extractEmploymentFromResumeText } from "@/lib/llm/extractEmployment";
import { createClient } from "@/lib/supabase/server";

const ROUTE_SOURCE = readFileSync(
  path.join(process.cwd(), "app", "api", "extract-employment", "route.js"),
  "utf8",
);

/** The bound this route declares. Duplicated in lib/rateLimit/adoption.test.js. */
const LIMIT = 10;

function jsonRequest(body) {
  return { json: async () => body };
}

// USER IDS ARE UNIQUE PER CASE, deliberately. The rate limiter is a module
// singleton -- that is the whole point (see "builds the limiter at MODULE
// scope" below) -- so its counters survive between `it()` blocks in this file
// exactly as they survive between requests in a running server. Sharing one id
// would let an early case's requests deny a later one, which would be a defect
// in the TEST, not in the bound. Same discipline as
// app/api/copilot/ask/route.test.js.
let userSeq = 0;
function signedIn(userId = `extract-user-${(userSeq += 1)}`) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
  return userId;
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

const RESUME = [
  "EXPERIENCE",
  "Senior Software Engineer, Acme Corp — Remote",
  "Jan 2020 – Present",
  "- Built and scaled the platform.",
  "- Led a team of five engineers.",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

// ---------------------------------------------------------------------------
// Identity. This route used to have NO auth gate of any kind: one anonymous
// POST bought a Gemini call on arbitrary attacker-posted text.
// ---------------------------------------------------------------------------
describe("an anonymous caller cannot spend a model call here", () => {
  it("401s without reading the body or reaching Gemini", async () => {
    signedOut();
    const json = vi.fn(async () => ({ resumeText: RESUME, engine: "gemini" }));
    const res = await POST({ json });
    expect(res.status).toBe(401);
    // The gate precedes the body read, so a hostile 20k-character payload is
    // never even parsed.
    expect(json).not.toHaveBeenCalled();
    expect(extractEmploymentFromResumeText).not.toHaveBeenCalled();
  });

  it("401s the embedded path too — the gate precedes the engine branch", async () => {
    // The embedded parser is keyless and free, but it is still this server's
    // CPU running on an anonymous caller's 20k characters. A gate that only
    // covered the Gemini branch would leave that open.
    signedOut();
    const res = await POST(jsonRequest({ resumeText: RESUME, engine: "embedded" }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The bound. Only possible now that there is an id to key on.
// ---------------------------------------------------------------------------
describe("the spend ceiling actually bites", () => {
  it("denies past the bound with 429 and a Retry-After", async () => {
    signedIn("extract-greedy");

    const statuses = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      statuses.push((await POST(jsonRequest({ engine: "embedded" }))).status);
    }

    // A limiter built INSIDE the handler gets a fresh store on every request,
    // so every caller is forever on its first request and all LIMIT+1 are 400.
    // That is why the loop runs PAST the bound rather than stopping at it.
    expect(statuses.filter((s) => s === 400)).toHaveLength(LIMIT);
    expect(statuses[LIMIT]).toBe(429);

    const denied = await POST(jsonRequest({ resumeText: RESUME, engine: "gemini" }));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("RateLimit-Limit")).toBe(String(LIMIT));
    // A denial costs nothing: the bound is checked ahead of the engine branch.
    expect(extractEmploymentFromResumeText).not.toHaveBeenCalled();
  });

  it("counts per authenticated user, so one caller's flood cannot deny another", async () => {
    signedIn("extract-flooder");
    for (let i = 0; i < LIMIT + 1; i += 1) await POST(jsonRequest({ engine: "embedded" }));
    expect((await POST(jsonRequest({ engine: "embedded" }))).status).toBe(429);

    signedIn("extract-bystander");
    expect((await POST(jsonRequest({ engine: "embedded" }))).status).toBe(400);
  });

  it("builds the limiter at MODULE scope, never inside the handler", () => {
    // The static half of the assertion above. A per-request limiter counts
    // nothing while looking correct, so no behavioural test of a single call
    // can see it and only a construction-site check can.
    const declaration = /^const \w+ = createRateLimiter\(/m;
    expect(ROUTE_SOURCE).toMatch(declaration);
    const limiterAt = ROUTE_SOURCE.search(declaration);
    const handlerAt = ROUTE_SOURCE.indexOf("export async function POST");
    expect(handlerAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeLessThan(handlerAt);
    expect(ROUTE_SOURCE.slice(handlerAt)).not.toMatch(/createRateLimiter\(/);
  });
});

describe("POST /api/extract-employment", () => {
  it("400s when resumeText is missing", async () => {
    const res = await POST(jsonRequest({ engine: "embedded" }));
    expect(res.status).toBe(400);
  });

  it("uses the deterministic parser on the embedded engine — no LLM call", async () => {
    const res = await POST(jsonRequest({ resumeText: RESUME, engine: "embedded" }));
    const data = await res.json();
    expect(data.engine).toBe("embedded");
    expect(Array.isArray(data.positions)).toBe(true);
    expect(data.positions.length).toBeGreaterThan(0);
    expect(data.positions[0].company).toMatch(/Acme/i);
    expect(extractEmploymentFromResumeText).not.toHaveBeenCalled();
  });

  it("uses Gemini when that engine is requested", async () => {
    extractEmploymentFromResumeText.mockResolvedValue([{ company: "Gemini Co", title: "Eng" }]);
    const res = await POST(jsonRequest({ resumeText: RESUME, engine: "gemini" }));
    const data = await res.json();
    expect(data.engine).toBe("gemini");
    expect(data.positions[0].company).toBe("Gemini Co");
    expect(extractEmploymentFromResumeText).toHaveBeenCalledOnce();
  });

  it("falls back to the deterministic parser when Gemini extraction throws", async () => {
    extractEmploymentFromResumeText.mockRejectedValue(new Error("no key"));
    const res = await POST(jsonRequest({ resumeText: RESUME, engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.engine).toBe("embedded");
    expect(data.positions.length).toBeGreaterThan(0);
  });
});
