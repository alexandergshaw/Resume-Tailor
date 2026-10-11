// N154 — the per-bullet DETAIL route (app/api/copilot/answer/project-bullet-detail/
// route.js), mirroring tech-term-detail/route.js step order plus the MANDATORY
// output gate. RED on HEAD: neither the route nor the modules it imports
// (projectBulletPrompt, projectBulletDetailHonesty, projectBulletDetailContract)
// exist, so the dynamic import throws.
//
// THE LOAD-BEARING ROUTE-LEVEL CONTROL (plan R3): the REAL
// sanitizeProjectBulletDetail is NOT mocked here, so a mocked model returning a
// scripted first-person claim proves the gate is actually WIRED on every
// non-embedded success — not merely exported. A build that forgot to call it, or
// hid it behind a flag, reds this.
//
// Also pins: kill switch 503; auth 401; bad JSON 400; every validation refusal
// 400 (including bulletIndex not an int >= 0, D5); embedded returns empty with NO
// model client; 504 on timeout; 502 on any other throw with a FIXED string; and
// NO rate limiter (owner ruling, route DEFERRED).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";

const APP_ID = "22222222-2222-2222-2222-222222222222";
const POSITION = { id: "p1", company: "Acme", title: "SRE", description: "Own the estate." };

let userSeq = 0;
function supabaseWith({ userId = `d-${(userSeq += 1)}`, position = POSITION } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: APP_ID, user_id: userId, positions: position }, error: null });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => chain),
  });
  return userId;
}

function modelReturns(text) {
  getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn(async () => ({ text })) } });
}
function modelThrows(err) {
  getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn(async () => { throw err; }) } });
}

const VALID = {
  applicationId: APP_ID,
  question: "Tell me about an incident.",
  title: "Rebuilt the paging rotation",
  bullet: "Cut alert noise from 5 to 1 per shift",
  siblingBullets: ["Mean time to ack within the target"],
  bulletIndex: 0,
  engine: "gemini",
};

function req(body) {
  return new Request("http://localhost/api/copilot/answer/project-bullet-detail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function post(body) {
  const { POST } = await import("./route.js");
  return POST(req(body));
}

beforeEach(() => {
  createClient.mockReset();
  getGeminiClient.mockReset();
  getServerEnv.mockClear();
  delete process.env.COPILOT_PROJECT_BULLET_DETAIL_DISABLED;
});
afterEach(() => {
  delete process.env.COPILOT_PROJECT_BULLET_DETAIL_DISABLED;
});

describe("the output gate is wired on every non-embedded success (not merely exported)", () => {
  it("sanitizes a scripted first-person claim OUT of the route's own response", async () => {
    supabaseWith();
    modelReturns(
      "A strong candidate might describe tuning alert thresholds. You could say: 'I built the paging pipeline.'",
    );
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.detail).not.toContain("I built");
    expect(json.detail).not.toContain("You could say");
    expect(json.detail).toContain("A strong candidate might describe tuning alert thresholds.");
    expect(json.empty).toBe(false);
  });

  it("returns empty:true (200) when the whole detail was scripted claims", async () => {
    supabaseWith();
    modelReturns("I built the pipeline. We used Kafka. I led the rollout.");
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.detail).toBe("");
    expect(json.empty).toBe(true);
  });
});

describe("gates and failure modes", () => {
  it("503s when the kill switch is set, before any model client", async () => {
    process.env.COPILOT_PROJECT_BULLET_DETAIL_DISABLED = "1";
    supabaseWith();
    const res = await post(VALID);
    expect(res.status).toBe(503);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated caller", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    expect((await post(VALID)).status).toBe(401);
  });

  it("400s on a non-JSON body", async () => {
    supabaseWith();
    const { POST } = await import("./route.js");
    const bad = new Request("http://localhost/api/copilot/answer/project-bullet-detail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect((await POST(bad)).status).toBe(400);
  });

  it("returns {detail:'',empty:true,engine:'embedded'} for the embedded engine, with NO model client", async () => {
    supabaseWith();
    const res = await post({ ...VALID, engine: "embedded" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ detail: "", empty: true, engine: "embedded" });
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("400s when the bullet is missing, empty or too long", async () => {
    supabaseWith();
    expect((await post({ ...VALID, bullet: undefined })).status).toBe(400);
    supabaseWith();
    expect((await post({ ...VALID, bullet: "   " })).status).toBe(400);
    supabaseWith();
    expect((await post({ ...VALID, bullet: "x".repeat(201) })).status).toBe(400);
  });

  it("400s when the title is missing or too long", async () => {
    supabaseWith();
    expect((await post({ ...VALID, title: undefined })).status).toBe(400);
    supabaseWith();
    expect((await post({ ...VALID, title: "x".repeat(161) })).status).toBe(400);
  });

  it("400s when the question is missing or too long", async () => {
    supabaseWith();
    expect((await post({ ...VALID, question: undefined })).status).toBe(400);
    supabaseWith();
    expect((await post({ ...VALID, question: "x".repeat(2001) })).status).toBe(400);
  });

  it("[D5] 400s when bulletIndex is not an integer >= 0", async () => {
    for (const bad of [undefined, -1, 1.5, "0", null, {}]) {
      supabaseWith();
      // eslint-disable-next-line no-await-in-loop
      const res = await post({ ...VALID, bulletIndex: bad });
      expect(res.status, `bulletIndex=${String(bad)}`).toBe(400);
    }
  });

  it("answers WITHOUT an applicationId (it is optional, role context only)", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "no-app" } }, error: null }) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn() })) })) })) })),
    });
    modelReturns("A strong candidate might describe the trade-offs involved.");
    const res = await post({ ...VALID, applicationId: undefined });
    expect(res.status).toBe(200);
    expect((await res.json()).detail).toContain("A strong candidate might describe");
  });

  it("504s on a model timeout and 502s on any other throw, with a FIXED string (no provider text)", async () => {
    supabaseWith();
    modelThrows(Object.assign(new Error("deadline"), { name: "TimeoutError" }));
    const t = await post(VALID);
    expect(t.status).toBe(504);
    expect((await t.json()).code).toBe("project_bullet_timeout");

    supabaseWith();
    modelThrows(new Error("SECRET provider detail 0xdeadbeef"));
    const h = await post(VALID);
    expect(h.status).toBe(502);
    expect(JSON.stringify(await h.json())).not.toContain("0xdeadbeef");
  });
});

describe("carries no spend limiter (owner ruling: route DEFERRED, prefetched like its siblings)", () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  it("constructs no limiter, returns no 429, and imports nothing from the rate-limit module", () => {
    const code = strip(readFileSync(path.join(process.cwd(), "app/api/copilot/answer/project-bullet-detail/route.js"), "utf8"));
    expect(code).not.toMatch(/createRateLimiter/);
    expect(code).not.toMatch(/status:\s*429/);
    expect(code).not.toMatch(/@\/lib\/rateLimit/);
    expect(code).not.toMatch(/getSession\(/);
  });

  it("[canary] the same scan over a still-bounded route sees a limiter, so the absence above is measured", () => {
    const boundedCode = strip(readFileSync(path.join(process.cwd(), "app/api/application-project-pool/route.js"), "utf8"));
    expect(boundedCode).toMatch(/createRateLimiter/);
    expect(boundedCode).toMatch(/status:\s*429/);
  });
});
