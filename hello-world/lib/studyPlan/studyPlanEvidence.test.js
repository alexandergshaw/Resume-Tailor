// N157 SC-A (4b TDD seat) -- the pure digest->EvidenceSet adapter chain.
// Binds to docs/loop/N157.SC-A.plan.r1.md (A1 evidenceCitations, A2
// adaptDigestToEvidence, A3 gatherEvidence; risk rows R1/R2/R3/R7) and
// N157.arch.r2.md §4.1. SC-A issues NO grounded call; its grounded evidence is
// the already-persisted application_digests row, adapted here.
//
// RED on HEAD: lib/studyPlan/studyPlanEvidence.js does not exist yet, so the
// dynamic import in beforeAll throws and every `it` reds with a "cannot find
// module" error -- the honest greenfield red (vi.mock cannot substitute an
// unresolvable specifier; this is the same pattern the landed
// studyPlanSchema.test.js uses). Each `it` carries a real behavioural
// assertion so that, once the module lands, the suite discriminates a correct
// build from the specific defects the risk rows name. The scratchpad reference
// build + mutation run that proved these assertions satisfiable and
// discriminating is recorded in tests.r1.md (not shipped).
//
// FROZEN CONTRACT (plan §3/§7, resolving the arch's single OPEN item):
//   * EvidenceSet citation element is EXACTLY { url } -- url taken VERBATIM
//     from application_digests.sources[].url (NOT extractCitationSources's
//     .uri, NOT a normalised new URL(url).href). title/start/end excluded.
//   * complete:true ONLY when the digest is ready AND >=1 usable citation
//     survives the redirect/safeHref filter; a ready digest with zero usable
//     citations is reason:"unsourced", sourced:false, complete:false -- NEVER
//     silently complete (R2). Absent/not-ready/empty-markdown is
//     reason:"no-research", items:[] (R3). Never trusted-by-default.
//   * adaptDigestToEvidence and gatherEvidence NEVER throw (R3).

import { describe, it, expect, vi, beforeAll } from "vitest";

// The REAL production guards, imported to CANARY the fixtures below. These
// three `it`s (in "fixtures discriminate") exercise production modules that
// already exist on HEAD, so they PASS on HEAD by design -- they are
// instrument-validation, NOT feature coverage, and are disclosed as such in
// tests.r1.md. Their job is to prove the redirect fixture really IS a
// grounding redirect per the shipped guard (so a drop-test that greens is
// measuring a real drop) and the publisher fixture really is NOT.
import { citationHost, servesGroundingRedirect } from "@/lib/tracking/citationHref.js";
import { safeExternalHref } from "@/lib/url/safeExternalHref.js";

let mod = null;

beforeAll(async () => {
  // The import specifier the generation sub-chunk will use for this module.
  mod = await import("@/lib/studyPlan/studyPlanEvidence.js");
});

// --- fixtures -------------------------------------------------------------

// A vertexaisearch grounding-redirect host: a link that reads like a Google
// API endpoint and, if shown as a citation, 404s a recruiter to a dead URL
// (the [[gemini-grounding-redirects]] harm). MUST be dropped (R1/S2).
const REDIRECT_URL =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ-abc123xyz";
// The parent-host form: any *.cloud.google.com whose path carries
// grounding-api-redirect. Catches a mutant that only string-matches the exact
// vendor host and misses a renamed redirector.
const REDIRECT_URL_PARENT =
  "https://foo.cloud.google.com/grounding-api-redirect/abc987";
// Real publisher URLs -- survive the filter.
const REAL_URL = "https://www.reuters.com/technology/acme-ai-funding-2026/";
const SECOND_REAL_URL = "https://techcrunch.com/2026/01/05/acme-series-b/";
// A url whose VERBATIM form differs from new URL(url).href (the parser
// lowercases the host but preserves path case), so a mutant that returns
// new URL(url).href instead of the raw string reds the verbatim assertion.
const VERBATIM_MIXEDCASE = "https://www.Example-Press.com/Story/42";

const READY_MARKDOWN = "## Acme Robotics\nShips a Kubernetes control plane; recent Series B.";
const RESEARCHED_AT = "2026-10-01T12:00:00.000Z";

function readyDigest(sources, overrides = {}) {
  return {
    status: "ready",
    markdown: READY_MARKDOWN,
    sources,
    researched_at: RESEARCHED_AT,
    ...overrides,
  };
}

// --- fixture canaries (PASS on HEAD -- instrument validation, not coverage) --
describe("fixtures discriminate (canary against the shipped guards)", () => {
  it("the redirect fixtures ARE grounding redirects per the production guard", () => {
    expect(servesGroundingRedirect(citationHost(REDIRECT_URL), REDIRECT_URL)).toBe(true);
    expect(servesGroundingRedirect(citationHost(REDIRECT_URL_PARENT), REDIRECT_URL_PARENT)).toBe(true);
  });

  it("the publisher fixtures are NOT redirects and pass safeExternalHref verbatim", () => {
    expect(servesGroundingRedirect(citationHost(REAL_URL), REAL_URL)).toBe(false);
    expect(safeExternalHref(REAL_URL)).toBe(REAL_URL);
    // VERBATIM_MIXEDCASE survives safeExternalHref unchanged but differs from
    // its normalised href -- the discriminator the verbatim test relies on.
    expect(safeExternalHref(VERBATIM_MIXEDCASE)).toBe(VERBATIM_MIXEDCASE);
    expect(new URL(VERBATIM_MIXEDCASE).href).not.toBe(VERBATIM_MIXEDCASE);
  });

  it("the refused-scheme fixtures ARE refused by safeExternalHref", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref("data:text/html,x")).toBeNull();
  });
});

// --- A1: evidenceCitations ------------------------------------------------
describe("evidenceCitations (A1): the §3 redirect/safeHref filter, verbatim, deduped", () => {
  it("drops a vertexaisearch grounding-redirect source and KEEPS the real publisher (R1/S2)", () => {
    // Load-bearing. A no-strip impl, or one that passes the raw url (not the
    // citationHost-folded host) to servesGroundingRedirect, keeps the redirect
    // and reds here. The real host is the positive control: it must survive,
    // so a filter that drops everything also reds.
    const out = mod.evidenceCitations([{ url: REDIRECT_URL }, { url: REAL_URL }]);
    expect(out).toEqual([{ url: REAL_URL }]);
  });

  it("drops the parent-host redirect form too (renamed-redirector guard)", () => {
    const out = mod.evidenceCitations([{ url: REDIRECT_URL_PARENT }, { url: REAL_URL }]);
    expect(out).toEqual([{ url: REAL_URL }]);
  });

  it("keeps a clean publisher url VERBATIM and emits EXACTLY { url } (shape freeze)", () => {
    // Pins two frozen properties at once: (a) url is verbatim, so a mutant
    // returning new URL(url).href reds; (b) the element is exactly { url },
    // so a mutant leaking title/start/end from the column reds (toEqual is
    // exact-key).
    const out = mod.evidenceCitations([
      { url: VERBATIM_MIXEDCASE, title: "Example Press", start: 0, end: 10 },
    ]);
    expect(out).toEqual([{ url: VERBATIM_MIXEDCASE }]);
    expect(Object.keys(out[0])).toEqual(["url"]);
  });

  it("reads sources[].url, NEVER .uri (the frozen-shape canary)", () => {
    // The persisted column element is { url } (digestCitations.js:376-385),
    // NOT extractCitationSources's { uri }. A mutant reading .uri produces the
    // decoy and reds. The decoy is itself a valid publisher url so the only
    // way to pass is to read the right field.
    const out = mod.evidenceCitations([
      { url: REAL_URL, uri: "https://decoy-wrong-field.example/x" },
    ]);
    expect(out).toEqual([{ url: REAL_URL }]);
  });

  it("drops javascript:/data:/non-object/empty entries, keeps the valid one", () => {
    const out = mod.evidenceCitations([
      { url: "javascript:alert(1)" },
      { url: "data:text/html,x" },
      { url: "" },
      { url: 42 },
      null,
      "not-an-object",
      { url: REAL_URL },
    ]);
    expect(out).toEqual([{ url: REAL_URL }]);
  });

  it("dedupes by url preserving first-seen order", () => {
    // Mutant: no dedupe -> length 3 and reds. Order mutant (e.g. sort) reds too.
    const out = mod.evidenceCitations([
      { url: REAL_URL },
      { url: SECOND_REAL_URL },
      { url: REAL_URL },
    ]);
    expect(out).toEqual([{ url: REAL_URL }, { url: SECOND_REAL_URL }]);
  });

  it("returns [] for a non-array (null/undefined/object), never throws", () => {
    expect(mod.evidenceCitations(null)).toEqual([]);
    expect(mod.evidenceCitations(undefined)).toEqual([]);
    expect(mod.evidenceCitations({ url: REAL_URL })).toEqual([]);
  });
});

// --- A2: adaptDigestToEvidence -------------------------------------------
describe("adaptDigestToEvidence (A2): the three-way refusal/unsourced/complete branch", () => {
  it("ready + usable citations => complete:true, one sourced item, reason:null (happy path / over-fire control)", () => {
    // This is the control proving complete CAN be true: a build hardwired to
    // complete:false reds here, and a build hardwired to complete:true reds the
    // unsourced tests below.
    const ev = mod.adaptDigestToEvidence(readyDigest([{ url: REAL_URL }]), {
      postingFingerprint: "fp-abc",
    });
    expect(ev.complete).toBe(true);
    expect(ev.reason).toBeNull();
    expect(ev.researchedAt).toBe(RESEARCHED_AT);
    expect(ev.postingFingerprint).toBe("fp-abc");
    expect(ev.items).toHaveLength(1);
    expect(ev.items[0].topicHint).toBe("");
    expect(ev.items[0].text).toBe(READY_MARKDOWN);
    expect(ev.items[0].sourced).toBe(true);
    expect(ev.items[0].citations).toEqual([{ url: REAL_URL }]);
  });

  it("ready + ZERO usable citations (empty sources) => unsourced, NOT complete (R2/S6)", () => {
    const ev = mod.adaptDigestToEvidence(readyDigest([]), { postingFingerprint: "fp" });
    expect(ev.complete).toBe(false);
    expect(ev.reason).toBe("unsourced");
    expect(ev.items).toHaveLength(1);
    expect(ev.items[0].sourced).toBe(false);
    expect(ev.items[0].citations).toEqual([]);
    expect(ev.items[0].text).toBe(READY_MARKDOWN);
  });

  it("ready + ONLY a redirect source => unsourced after the filter, NOT complete (R1+R2 joined)", () => {
    // The dangerous case: a ready digest whose single source is a vertexaisearch
    // redirect must become unsourced, never a 'researched' plan built on a
    // faked citation. A mutant that skips the strip keeps a citation and marks
    // complete:true -- reds here AND in the A1 drop test.
    const ev = mod.adaptDigestToEvidence(readyDigest([{ url: REDIRECT_URL }]), {});
    expect(ev.complete).toBe(false);
    expect(ev.reason).toBe("unsourced");
    expect(ev.items[0].sourced).toBe(false);
    expect(ev.items[0].citations).toEqual([]);
  });

  it("absent digest (null) => no-research refusal, items:[], researchedAt:null (R3)", () => {
    const ev = mod.adaptDigestToEvidence(null, { postingFingerprint: "fp" });
    expect(ev).toMatchObject({ complete: false, items: [], reason: "no-research", researchedAt: null });
    expect(ev.postingFingerprint).toBe("fp");
  });

  it("not-ready status (running) => no-research refusal (R3)", () => {
    const ev = mod.adaptDigestToEvidence(readyDigest([{ url: REAL_URL }], { status: "running" }), {});
    expect(ev).toMatchObject({ complete: false, items: [], reason: "no-research" });
  });

  it("ready but empty/whitespace markdown => no-research refusal (R3)", () => {
    const ev = mod.adaptDigestToEvidence(readyDigest([{ url: REAL_URL }], { markdown: "   \n  " }), {});
    expect(ev).toMatchObject({ complete: false, items: [], reason: "no-research" });
  });

  it("echoes postingFingerprint VERBATIM and defaults it to \"\" when absent (R7)", () => {
    // The adapter is fingerprint-agnostic: it stores the caller's string, never
    // recomputes it (a second copy of postingFingerprint is the R7 defect). A
    // mutant that ignores/derives the field reds.
    const ev = mod.adaptDigestToEvidence(readyDigest([{ url: REAL_URL }]), {
      postingFingerprint: "FP-VERBATIM-123",
    });
    expect(ev.postingFingerprint).toBe("FP-VERBATIM-123");
    const noOpt = mod.adaptDigestToEvidence(readyDigest([{ url: REAL_URL }]));
    expect(noOpt.postingFingerprint).toBe("");
  });

  it("researchedAt is null when the column is non-string", () => {
    const ev = mod.adaptDigestToEvidence(readyDigest([{ url: REAL_URL }], { researched_at: 1700000000 }), {});
    expect(ev.researchedAt).toBeNull();
  });

  it("NEVER throws on bad shapes (non-array sources, undefined, garbage) (R3)", () => {
    expect(() => mod.adaptDigestToEvidence({ status: "ready", markdown: "x", sources: "nope" })).not.toThrow();
    expect(() => mod.adaptDigestToEvidence(undefined)).not.toThrow();
    expect(() => mod.adaptDigestToEvidence(12345)).not.toThrow();
    // non-array sources on a ready digest -> zero citations -> unsourced.
    const ev = mod.adaptDigestToEvidence({ status: "ready", markdown: "x", sources: "nope" });
    expect(ev.reason).toBe("unsourced");
    expect(ev.items[0].citations).toEqual([]);
  });
});

// --- A3: gatherEvidence (async, injected reader) --------------------------
describe("gatherEvidence (A3): injected reader, never throws, refusal-honest", () => {
  it("ready row => adapts it; calls readDigest with (applicationId, userId); threads fingerprint", async () => {
    const readDigest = vi.fn().mockResolvedValue(readyDigest([{ url: REAL_URL }]));
    const ev = await mod.gatherEvidence(
      { readDigest },
      { applicationId: "app-1", userId: "user-1", postingFingerprint: "fp-x" },
    );
    expect(readDigest).toHaveBeenCalledWith("app-1", "user-1");
    expect(ev.complete).toBe(true);
    expect(ev.items[0].citations).toEqual([{ url: REAL_URL }]);
    expect(ev.postingFingerprint).toBe("fp-x");
  });

  it("reader resolves null => no-research refusal, fingerprint still carried", async () => {
    const readDigest = vi.fn().mockResolvedValue(null);
    const ev = await mod.gatherEvidence(
      { readDigest },
      { applicationId: "app-1", userId: "user-1", postingFingerprint: "fp-y" },
    );
    expect(ev).toMatchObject({ complete: false, items: [], reason: "no-research" });
    expect(ev.postingFingerprint).toBe("fp-y");
  });

  it("a DELAYED rejecting reader RESOLVES to no-research, never rejects (R3 silent-crash guard)", async () => {
    // The silent-failure direction: a thrown reader must not propagate into the
    // route as a 500. A same-tick throw cannot prove an async catch, so the
    // reader rejects on a timer. A mutant that lets the rejection propagate
    // makes this promise reject -> the .resolves assertion reds.
    const readDigest = vi.fn(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("db down")), 5)),
    );
    await expect(
      mod.gatherEvidence({ readDigest }, { applicationId: "app-1", userId: "user-1", postingFingerprint: "fp-z" }),
    ).resolves.toMatchObject({ complete: false, items: [], reason: "no-research", postingFingerprint: "fp-z" });
  });

  it("a reader that throws SYNCHRONOUSLY => no-research refusal, never throws", async () => {
    const readDigest = vi.fn(() => {
      throw new Error("sync boom");
    });
    await expect(
      mod.gatherEvidence({ readDigest }, { applicationId: "app-1", userId: "user-1" }),
    ).resolves.toMatchObject({ complete: false, items: [], reason: "no-research" });
  });
});
