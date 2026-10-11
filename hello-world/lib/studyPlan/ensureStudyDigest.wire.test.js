// N157 SC-A (4b TDD seat) -- the A4 client wrapper's WIRE test.
// Binds to docs/loop/N157.SC-A.plan.r1.md (A4; risk row R4) and N157.arch.r2.md
// §4.2 (create-time ordering) / ledger ARCH-N157-1, ARCH-N157-15.
//
// WHAT THIS FILE PROVES (and why it drives the real transport). SC-A adds NO
// grounded call: ensureStudyDigest/refreshStudyDigest only POST the
// already-grounded /api/application-digest route (whose grounded call is
// wire-tested by app/api/application-digest/route.wire.test.js). The silent
// harm (R4) is a wrapper that (a) issues its OWN grounded call, or (b) sends
// force:true on the create path (double-billing every create), or (c) omits
// force. Asserting the request shape against an injected fake would see
// whatever object the code hands it; mirroring route.wire.test.js's
// discipline, this file STUBS globalThis.fetch and reads the bytes actually
// put on the wire -- URL, method, and the parsed body -- and pins that exactly
// ONE request fires and it goes to the digest route, never a grounded endpoint.
//
// RED on HEAD: lib/studyPlan/ensureStudyDigest.js does not exist yet, so the
// dynamic import in beforeAll throws and every `it` reds with "cannot find
// module" -- the honest greenfield red. Each `it` carries a real behavioural
// assertion. Satisfiability + mutation were proven against a scratchpad
// reference (recorded in tests.r1.md, not shipped).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

let mod = null;

beforeAll(async () => {
  mod = await import("@/lib/studyPlan/ensureStudyDigest.js");
});

const APP_ID = "11111111-1111-1111-1111-111111111111";
const ENGINE = "gemini";
const DIGEST = { application_id: APP_ID, status: "ready", markdown: "## Acme", sources: [] };

let originalFetch;

// A fetch stub that records every call and returns a ready digest. Overridable
// per test for the error paths.
function installFetch(responder) {
  const fetchSpy = vi.fn(responder);
  globalThis.fetch = fetchSpy;
  return fetchSpy;
}

function okResponse(json = { digest: DIGEST }) {
  return { ok: true, status: 200, json: async () => json };
}

// Pull the (url, init) and the parsed JSON body off a recorded fetch call.
function callShape(fetchSpy, i = 0) {
  const [url, init] = fetchSpy.mock.calls[i];
  return { url, method: init?.method, body: JSON.parse(init?.body ?? "{}"), headers: init?.headers };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ensureStudyDigest (A4): exactly one POST to the digest route, force:false (R4/S4)", () => {
  it("fires EXACTLY ONE fetch, to /api/application-digest, method POST, JSON content-type", async () => {
    const fetchSpy = installFetch(() => okResponse());
    await mod.ensureStudyDigest({ applicationId: APP_ID, engine: ENGINE });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // over-fire control: no rogue second call
    const { url, method, headers } = callShape(fetchSpy);
    expect(url).toBe("/api/application-digest");
    expect(method).toBe("POST");
    expect(headers?.["Content-Type"]).toBe("application/json");
  });

  it("sends { applicationId, engine, force:false } in the body (ensure path)", async () => {
    const fetchSpy = installFetch(() => okResponse());
    await mod.ensureStudyDigest({ applicationId: APP_ID, engine: ENGINE });
    const { body } = callShape(fetchSpy);
    expect(body.applicationId).toBe(APP_ID);
    expect(body.engine).toBe(ENGINE); // under-fire control: engine must not be dropped
    expect(body.force).toBe(false);
  });

  it("returns json.digest", async () => {
    installFetch(() => okResponse({ digest: DIGEST }));
    const out = await mod.ensureStudyDigest({ applicationId: APP_ID, engine: ENGINE });
    expect(out).toEqual(DIGEST);
  });

  it("hits NO grounded endpoint -- the single call is the digest route only (R4 rogue-call guard)", async () => {
    // A wrapper that issues its own interactions.create/generateContent would
    // show as a second fetch or a different URL. The single-URL assertion is
    // the rogue-grounded-call guard; the regex is defence in depth against a
    // call that fires to a grounded surface INSTEAD of the digest route.
    const fetchSpy = installFetch(() => okResponse());
    await mod.ensureStudyDigest({ applicationId: APP_ID, engine: ENGINE });
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(["/api/application-digest"]);
    for (const u of urls) {
      expect(u).not.toMatch(/interactions|generateContent|googleSearch|generativelanguage|:generateContent/i);
    }
  });
});

describe("refreshStudyDigest (A4): the ONLY fresh grounded spend, force:true (R4/D-2)", () => {
  it("sends force:true (manual refresh), one fetch to the digest route", async () => {
    const fetchSpy = installFetch(() => okResponse());
    await mod.refreshStudyDigest({ applicationId: APP_ID, engine: ENGINE });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { url, body } = callShape(fetchSpy);
    expect(url).toBe("/api/application-digest");
    expect(body.force).toBe(true);
    expect(body.applicationId).toBe(APP_ID);
    expect(body.engine).toBe(ENGINE);
  });
});

describe("requestStudyDigest (A4): force defaults false; propagates/raises errors", () => {
  it("defaults force to false when not supplied (the create path never double-bills)", async () => {
    // Negative control for the force flag in BOTH directions: a mutant that
    // always sends force:true reds here and in the ensure test; a mutant that
    // always sends false reds the refresh test.
    const fetchSpy = installFetch(() => okResponse());
    await mod.requestStudyDigest({ applicationId: APP_ID, engine: ENGINE });
    expect(callShape(fetchSpy).body.force).toBe(false);
  });

  it("passes force:true through verbatim when supplied", async () => {
    const fetchSpy = installFetch(() => okResponse());
    await mod.requestStudyDigest({ applicationId: APP_ID, engine: ENGINE, force: true });
    expect(callShape(fetchSpy).body.force).toBe(true);
  });

  it("throws the server's error message on a non-ok response", async () => {
    installFetch(() => ({ ok: false, status: 503, json: async () => ({ error: "embedded engine unsupported" }) }));
    await expect(mod.requestStudyDigest({ applicationId: APP_ID, engine: "embedded" })).rejects.toThrow(
      "embedded engine unsupported",
    );
  });

  it("throws a status-bearing fallback when a non-ok response has no error field", async () => {
    installFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(mod.requestStudyDigest({ applicationId: APP_ID, engine: ENGINE })).rejects.toThrow("500");
  });
});
