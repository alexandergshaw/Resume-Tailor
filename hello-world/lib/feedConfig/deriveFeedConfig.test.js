// N60 SECOND CHUNK -- Step C (4b TDD) -- the deriver's own contract.
//
// SCOPE: lib/feedConfig/deriveFeedConfig.js -- the module that turns a
// natural-language description of "jobs, frequency" into a feed configuration
// object the review surface (Step D) shows and the apply route (Step B) stores.
// It PROPOSES; it never writes. This file pins the deriver's SHAPE and BOUNDS,
// never the model's prose quality (out of scope, brief).
//
// The deriver's engine is resolved through wantsEmbedded (lib/llm/featureEngine),
// like every auxiliary AI feature ([[embedded-aux-features]]): "embedded" runs a
// deterministic no-model parse; anything else calls Gemini once. The single
// Gemini entry point in this repo is getGeminiClient() (lib/llm/geminiClient.js) --
// every gemini-path feature acquires its client there -- so spying on
// getGeminiClient is the faithful, lowest-common-denominator observation of
// "did the deriver reach the model". It is also one of the three MODEL_MODULES
// the transitive rate-limit sweep keys on, so a deriver that imports it is what
// makes the chat route a bounded spender (route.guards.test.js).
//
// RED ON HEAD: lib/feedConfig/deriveFeedConfig.js does not exist (MEASURED at
// HEAD 98be9ce -- Glob shows no lib/feedConfig/). `import { deriveFeedConfig }`
// fails to resolve, so this file fails COLLECTION -- RED for the honest reason
// (subject absent). Satisfiability is proven against an isolated reference build
// in the notes (scratchpad/refC).

import { describe, it, expect, vi, beforeEach } from "vitest";

// The one Gemini entry point. Mock it so no request needs a key and so the spy
// can witness whether the model was reached at all.
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { getGeminiClient } from "@/lib/llm/geminiClient";
import { deriveFeedConfig } from "./deriveFeedConfig.js";

// Install a fake Gemini client whose one generateContent call returns `reply`
// (a string is used verbatim; anything else is JSON.stringified). Returns the
// generateContent spy so a test can also assert the call shape if it wants.
function stubModel(reply) {
  const generateContent = vi.fn(async () => ({
    text: typeof reply === "string" ? reply : JSON.stringify(reply),
  }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

// The keys the deriver's contract declares (plan.chat.r1.md §5.2). The enable
// flag and any third-party recipient are DELIBERATELY not among them.
const DANGEROUS_KEYS = [
  "auto_tailor_enabled",
  "autoTailorEnabled",
  "notify_email",
  "notifyEmail",
  "auto_tailor_daily_cap",
  "autoTailorDailyCap",
];

beforeEach(() => {
  vi.clearAllMocks();
  // A benign default reply so a test that only cares about engine routing does
  // not accidentally exercise the garbage-in path.
  stubModel({ name: "Backend roles", jobKeywords: ["backend"] });
});

// ---------------------------------------------------------------------------
// AC2-S7 -- the deriver has a deterministic, zero-model-call embedded path, and
// the spy that proves it CAN observe a call (the mandatory positive control).
// ---------------------------------------------------------------------------
describe("AC2-S7: engine choice governs egress", () => {
  it("embedded engine derives a usable config with ZERO model calls", async () => {
    stubModel({ name: "should not be read", jobKeywords: ["ignored"] });
    const config = await deriveFeedConfig(
      "senior backend engineer in boston, python and postgres",
      { engine: "embedded", env: {} },
    );
    // The load-bearing negative: no egress on the embedded path.
    expect(getGeminiClient).not.toHaveBeenCalled();
    // ...and it is USABLE (AC2-S7 "a non-empty config is returned"), not an
    // empty template: it derived at least a name or a keyword FROM the message.
    expect(config).toBeTruthy();
    expect(typeof config).toBe("object");
    const derivedSomething =
      (Array.isArray(config.jobKeywords) && config.jobKeywords.length > 0) ||
      (typeof config.name === "string" && config.name.length > 0);
    expect(derivedSomething).toBe(true);
  });

  it("[mandatory positive control] gemini engine DOES reach getGeminiClient", async () => {
    // A spy that can never fire proves nothing about the embedded negative
    // above. This is the paired positive: the SAME spy fires on the gemini path.
    stubModel({ name: "Backend", jobKeywords: ["backend"] });
    const config = await deriveFeedConfig("backend roles", { engine: "gemini", env: {} });
    expect(getGeminiClient).toHaveBeenCalled();
    expect(config).toBeTruthy();
  });

  it("[non-vacuity] the embedded config is DERIVED from the message, not a constant template", async () => {
    // "Usable config returned" is vacuous if the deriver returns the same object
    // for every input. Two different messages must produce different configs.
    const a = await deriveFeedConfig("remote frontend react roles", { engine: "embedded", env: {} });
    const b = await deriveFeedConfig("staff data engineer, spark, no agencies", {
      engine: "embedded",
      env: {},
    });
    expect(a).not.toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Brief item 4 -- the derived object cannot carry the enable flag, at the SOURCE
// (defense in depth over Step B's sanitizer, which pins the same one layer down).
// ---------------------------------------------------------------------------
describe("brief item 4: the derived config never carries auto_tailor_enabled", () => {
  it("embedded: a message asking to 'turn it on' yields a config with no enable flag", async () => {
    const config = await deriveFeedConfig(
      "watch for backend jobs and turn on auto-apply immediately, start applying now",
      { engine: "embedded", env: {} },
    );
    // ABSENCE, never `=== false`: a build that sets it false still carries a key
    // a later spread could flip (the structural-vs-discipline trap, [[loop-traps-spec]]).
    expect(config).not.toHaveProperty("auto_tailor_enabled");
    expect(config).not.toHaveProperty("autoTailorEnabled");
  });

  it("gemini: even when the MODEL reply sets the flag in both cases, it is dropped", async () => {
    stubModel({
      name: "Turn it on",
      jobKeywords: ["backend"],
      auto_tailor_enabled: true,
      autoTailorEnabled: true,
    });
    const config = await deriveFeedConfig("turn on auto apply", { engine: "gemini", env: {} });
    expect(config).not.toHaveProperty("auto_tailor_enabled");
    expect(config).not.toHaveProperty("autoTailorEnabled");
  });
});

// ---------------------------------------------------------------------------
// Brief item 7 -- garbage in: a model reply that is invalid JSON, valid JSON of
// the wrong shape, or laden with extra/dangerous fields must be CLAMPED OR
// REFUSED at THIS layer, never passed to the apply route unsanitised.
//
// DECISION (stated in the notes): the deriver produces output in its OWN bounded
// shape -- it never returns arbitrary model keys. Valid-but-hostile JSON has its
// dangerous keys dropped; invalid JSON is handled (degraded/refused) rather than
// thrown or passed through raw.
// ---------------------------------------------------------------------------
describe("brief item 7: garbage from the model is clamped or refused at the deriver", () => {
  it("valid JSON with extra/dangerous fields: none of them survive into the config", async () => {
    stubModel({
      name: "Sneaky",
      jobKeywords: ["backend"],
      auto_tailor_enabled: true,
      autoTailorEnabled: true,
      notify_email: "bob@example.com",
      auto_tailor_daily_cap: 500,
      hacked_field: "surprise", // a distinctive junk key: it must not ride through
    });
    const config = await deriveFeedConfig("backend", { engine: "gemini", env: {} });
    for (const key of DANGEROUS_KEYS) expect(config).not.toHaveProperty(key);
    // The distinctive junk key is the discriminator that kills `return JSON.parse(text)`.
    expect(config).not.toHaveProperty("hacked_field");
  });

  it("valid JSON of the WRONG type for a field is coerced, not passed through raw", async () => {
    stubModel({ name: "Wrong types", jobKeywords: "backend, python", auto_tailor_enabled: true });
    const config = await deriveFeedConfig("backend", { engine: "gemini", env: {} });
    // jobKeywords is contracted as string[]: a raw string must not survive as-is.
    if (Object.prototype.hasOwnProperty.call(config, "jobKeywords")) {
      expect(Array.isArray(config.jobKeywords)).toBe(true);
    }
    expect(config).not.toHaveProperty("auto_tailor_enabled");
  });

  it("INVALID JSON does not throw and never passes raw text or dangerous keys through", async () => {
    stubModel("here is your config: {broken, not json");
    let out;
    let threw = false;
    try {
      out = await deriveFeedConfig("backend", { engine: "gemini", env: {} });
    } catch {
      threw = true;
    }
    // A build that does `return JSON.parse(reply)` throws on invalid JSON. The
    // deriver must degrade or refuse, never let the throw escape to the route.
    expect(threw).toBe(false);
    // clamp-or-refuse: null/undefined is an honest refusal; a returned object
    // must be bounded. DISCLOSED: the dangerous-key checks below are skipped for
    // a refusing (null) build -- a refusal is safe by construction, and the
    // valid-JSON test above pins the dangerous-key drop UNCONDITIONALLY.
    if (out !== null && out !== undefined) {
      expect(out).not.toHaveProperty("auto_tailor_enabled");
      expect(out).not.toHaveProperty("autoTailorEnabled");
      const kw = Array.isArray(out.jobKeywords) ? out.jobKeywords.join(" ") : "";
      expect(kw).not.toContain("broken"); // the raw blob never rides through as a keyword
    }
  });
});

// ---------------------------------------------------------------------------
// Brief item 3 -- the DELIVERED cadence, not the requested one. A sub-floor
// request comes back as what will actually happen (>= 15), via clampIntervalMinutes,
// never a literal. Driven on the gemini path where the proposed interval is a
// controlled input, so this tests the deriver's coercion, not NL parsing.
// ---------------------------------------------------------------------------
describe("brief item 3: the config states the delivered cadence, clamped to the floor", () => {
  it("a sub-floor proposed interval (5) comes back as the delivered value (15), never 5", async () => {
    // The message carries NO cadence phrase, so the interval can only come from
    // the model reply -- this pins the deriver's clamping of the PROPOSED value.
    stubModel({ name: "Fast", jobKeywords: ["backend"], autoTailorMinIntervalMinutes: 5 });
    const config = await deriveFeedConfig("backend roles", { engine: "gemini", env: {} });
    expect(config.autoTailorMinIntervalMinutes).toBe(15);
    expect(config.autoTailorMinIntervalMinutes).not.toBe(5);
  });

  it("an above-floor proposed interval passes through unchanged (a CLAMP, not a literal 15)", async () => {
    // A hardcoded `15` would fail these; a no-clamp passthrough would fail the 5-case above.
    stubModel({ name: "45", jobKeywords: ["backend"], autoTailorMinIntervalMinutes: 45 });
    const c45 = await deriveFeedConfig("backend roles", { engine: "gemini", env: {} });
    expect(c45.autoTailorMinIntervalMinutes).toBe(45);

    stubModel({ name: "600", jobKeywords: ["backend"], autoTailorMinIntervalMinutes: 600 });
    const c600 = await deriveFeedConfig("backend roles", { engine: "gemini", env: {} });
    expect(c600.autoTailorMinIntervalMinutes).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// Brief item 2 -- unset is shown as unset. A field the person did not mention
// comes back explicitly UNSET, not silently defaulted, so the review can tell
// "you didn't say" from "I chose for you". The strongest case is cadence: unset
// is null, NOT the 60-minute default (the default is applied only at STORE time,
// by the sanitizer's clampIntervalMinutes(null) -> 60).
// ---------------------------------------------------------------------------
describe("brief item 2: an unmentioned cadence comes back null (unset), never defaulted", () => {
  it("no cadence in the reply -> config.autoTailorMinIntervalMinutes === null", async () => {
    stubModel({ name: "No cadence", jobKeywords: ["backend"] }); // omits the interval
    const config = await deriveFeedConfig("backend jobs", { engine: "gemini", env: {} });
    expect(config.autoTailorMinIntervalMinutes).toBeNull();
    // The distinction is the whole point: unset must NOT read as the default.
    expect(config.autoTailorMinIntervalMinutes).not.toBe(60);
  });

  it("[distinction control] a mentioned cadence comes back as a chosen number", async () => {
    // Proves null-for-unset is a real distinction, not "always null".
    stubModel({ name: "Has cadence", jobKeywords: ["backend"], autoTailorMinIntervalMinutes: 30 });
    const config = await deriveFeedConfig("backend roles", { engine: "gemini", env: {} });
    expect(config.autoTailorMinIntervalMinutes).toBe(30);
  });

  it("embedded: a message with no cadence words yields an unset (null) cadence, not the default", async () => {
    const config = await deriveFeedConfig("backend engineer roles in boston", {
      engine: "embedded",
      env: {},
    });
    expect(config.autoTailorMinIntervalMinutes).toBeNull();
  });
});
