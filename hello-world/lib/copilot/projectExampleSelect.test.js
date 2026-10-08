// N143 seam 2 (T3) + seam 5 status derivation (T8) + the selector half of the
// cache guard (T9). Falsifier for lib/copilot/projectExampleSelect.js, which
// does not exist on HEAD — so this whole file is RED at the import line until
// the implementer lands the module (that is the hand-off, not a defect).
//
// WHY THIS SEAM IS THE v1-FAILURE GUARD. The feature N141 deleted shipped an
// off-domain example (an SRE story for a teaching question) because selection
// FORCED a pick: "best-matching entry is selected and shown" with no floor.
// selectPoolProject must instead be able to return `no_match` — and the fit it
// scores must be the entry's CURATED competency/domain tag, not the invented
// title/bullets prose (whose domain words recur, so a threshold over prose
// never bites). Both properties are pinned below with mutation-direction
// controls, and the POSITIVE control is written FIRST in each block so a zero
// is distinguishable from a blind instrument.
//
// PURE by construction: the module imports only significantTerms/overlapScore
// from projectStories.js (verified exports at :169/:173) and wantsEmbedded.
// The last describe block proves it imports no Gemini/Supabase client, which is
// how "Row 1 selection adds zero model calls" (AC-6) is true BY CONSTRUCTION
// rather than by a spied route call.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  selectPoolProject,
  POOL_FIT_THRESHOLD,
  buildProjectExample,
  POOL_PENDING_MAX_AGE,
} from "./projectExampleSelect.js";
import { significantTerms, overlapScore } from "./projectStories.js";

// A pool entry in the shape the generator/parser produce (design r2 §1.1).
const entry = (over = {}) => ({
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack 61% to 78% within target"],
  hypothetical: true,
  ...over,
});

const SRE_Q = "Tell me about an incident you handled in production under pressure.";
const TEACHING_Q = "Describe how you redesigned a curriculum unit for struggling students.";

describe("selectPoolProject — fit threshold and the honest no-match outcome (T3 / AC-6)", () => {
  it("[positive control, written first] picks the single on-domain entry and reports a match", () => {
    // The instrument MUST be able to find a real match, or every no_match
    // assertion below is vacuous.
    const onDomain = entry({ competency: "incident response", domain: "SRE" });
    const res = selectPoolProject([onDomain], { question: SRE_Q });
    expect(res.outcome).toBe("match");
    expect(res.entry).toBe(onDomain);
    expect(res.fitScore).toBeGreaterThanOrEqual(POOL_FIT_THRESHOLD);
    // The fit is a real overlap count, computed over the competency+domain tag
    // — independently re-derived here from the shared primitives so the
    // expectation does not come from the mechanism under test.
    expect(res.fitScore).toBe(overlapScore(significantTerms(SRE_Q), "incident response SRE"));
  });

  it("returns no_match (entry null, fitScore 0) on an empty or absent pool", () => {
    for (const pool of [[], null, undefined]) {
      const res = selectPoolProject(pool, { question: SRE_Q });
      expect(res.outcome).toBe("no_match");
      expect(res.entry).toBeNull();
      expect(res.fitScore).toBe(0);
    }
  });

  it("returns no_match when the only entry is clearly off-domain (the exact v1 failure)", () => {
    // A teaching entry against an SRE question shares zero distinctive
    // competency/domain terms, so the honest answer is "no close example",
    // NOT a forced off-domain pick.
    const offDomain = entry({ competency: "curriculum design", domain: "K-12 teaching" });
    const res = selectPoolProject([offDomain], { question: SRE_Q });
    expect(res.outcome).toBe("no_match");
    expect(res.entry).toBeNull();
    expect(res.fitScore).toBeLessThan(POOL_FIT_THRESHOLD);
  });

  it("[mutation control] never returns a non-null entry while fitScore < POOL_FIT_THRESHOLD", () => {
    // The named failure direction (design r2 §4.1 invariant): a build that
    // forces the best-scoring entry through regardless of the floor reds here.
    const offDomainPool = [
      entry({ competency: "curriculum design", domain: "K-12 teaching" }),
      entry({ competency: "patient triage", domain: "ICU nursing" }),
    ];
    const res = selectPoolProject(offDomainPool, { question: SRE_Q });
    expect(res.outcome).toBe("no_match");
    expect(res.entry).toBeNull();
  });

  it("picks the STRICTLY-HIGHEST fit, not array order (mis-selection fixture)", () => {
    // A weak-but-nonzero on-domain entry sits first; a clearly better one sits
    // later. A selector that returns the first entry above threshold reds.
    const weak = entry({ competency: "incident response", domain: "operations", title: "weak" });
    const strong = entry({ competency: "incident response production", domain: "SRE", title: "strong" });
    const res = selectPoolProject([weak, strong], { question: SRE_Q });
    expect(res.outcome).toBe("match");
    expect(res.entry).toBe(strong);
    expect(res.entry.title).toBe("strong");
  });

  it("keeps array order on a tie", () => {
    const first = entry({ competency: "incident response", domain: "SRE", title: "first" });
    const second = entry({ competency: "incident response", domain: "SRE", title: "second" });
    const res = selectPoolProject([first, second], { question: SRE_Q });
    expect(res.entry).toBe(first);
  });

  it("scores fit over competency+domain, NOT title/bullets", () => {
    // An entry whose TITLE and BULLETS are stuffed with the question's terms
    // but whose competency/domain are off-domain must still be a no_match —
    // otherwise invented prose would make the threshold never bite.
    const promptStuffed = entry({
      competency: "curriculum design",
      domain: "K-12 teaching",
      title: "Production incident response under pressure",
      bullets: ["Handled a production incident", "Incident response in production"],
    });
    const res = selectPoolProject([promptStuffed], { question: SRE_Q });
    expect(res.outcome).toBe("no_match");
    expect(res.entry).toBeNull();
  });

  it("selects a DIFFERENT pick for a different question over the same pool (two-picks guard, AC-7)", () => {
    // A fresh pick per question — the cache-invariant property. If the pick
    // were frozen/carried, both questions would select the same entry.
    const pool = [
      entry({ competency: "incident response", domain: "SRE", title: "sre-entry" }),
      entry({ competency: "curriculum design", domain: "K-12 teaching", title: "teaching-entry" }),
    ];
    const sre = selectPoolProject(pool, { question: SRE_Q });
    const teaching = selectPoolProject(pool, { question: TEACHING_Q });
    expect(sre.entry.title).toBe("sre-entry");
    expect(teaching.entry.title).toBe("teaching-entry");
    expect(sre.entry).not.toBe(teaching.entry);
  });
});

describe("buildProjectExample — the five-outcome done-frame status matrix (T8 / design r2 §4.4)", () => {
  const readyPool = (over = {}) => ({
    status: "ready",
    projects: [entry()],
    engine: "gemini",
    updated_at: "2026-10-08T00:00:00.000Z",
    ...over,
  });
  const AT = Date.parse("2026-10-08T00:00:00.000Z");

  it("[positive control] a ready+match pool emits a ready entry carrying the invented markers", () => {
    const out = buildProjectExample({
      pool: readyPool(),
      pick: selectPoolProject([entry()], { question: SRE_Q }),
      applicationId: "app-1",
      engine: "gemini",
      now: AT,
    });
    expect(out.status).toBe("ready");
    expect(out.competency).toBe("incident response");
    expect(out.domain).toBe("SRE");
    expect(Array.isArray(out.bullets)).toBe(true);
    expect(out.hypothetical).toBe(true);
    expect(out.engine).toBe("gemini");
  });

  it("OMITS the field entirely (returns undefined) when there is no applicationId", () => {
    // The OMIT is load-bearing: a missing field is how the component renders a
    // clean NA, distinct from a sent {status:'failed'}.
    expect(
      buildProjectExample({ pool: readyPool(), pick: { outcome: "match", entry: entry() }, applicationId: "", engine: "gemini", now: AT }),
    ).toBeUndefined();
    expect(
      buildProjectExample({ pool: readyPool(), pick: { outcome: "match", entry: entry() }, applicationId: null, engine: "gemini", now: AT }),
    ).toBeUndefined();
  });

  it("[mutation control] OMITS the field for an embedded engine even with a ready pool", () => {
    // A build that attaches projectExample on the embedded path reds here.
    const out = buildProjectExample({
      pool: readyPool(),
      pick: { outcome: "match", entry: entry() },
      applicationId: "app-1",
      engine: "embedded",
      now: AT,
    });
    expect(out).toBeUndefined();
  });

  it("emits {status:'pending'} with no benchmark content when there is no pool row", () => {
    const out = buildProjectExample({ pool: null, pick: null, applicationId: "app-1", engine: "gemini", now: AT });
    expect(out).toEqual({ status: "pending" });
  });

  it("emits {status:'pending'} for a YOUNG pending row (younger than POOL_PENDING_MAX_AGE)", () => {
    const out = buildProjectExample({
      pool: { status: "pending", projects: [], updated_at: "2026-10-08T00:00:00.000Z" },
      pick: null,
      applicationId: "app-1",
      engine: "gemini",
      now: AT + (POOL_PENDING_MAX_AGE - 1000),
    });
    expect(out).toEqual({ status: "pending" });
  });

  it("[mutation control] emits {status:'failed'} for a STALE pending row (crashed generation)", () => {
    // The named silent failure: a crashed generation that says "preparing"
    // forever. Past POOL_PENDING_MAX_AGE it must read as failed.
    const out = buildProjectExample({
      pool: { status: "pending", projects: [], updated_at: "2026-10-08T00:00:00.000Z" },
      pick: null,
      applicationId: "app-1",
      engine: "gemini",
      now: AT + (POOL_PENDING_MAX_AGE + 1000),
    });
    expect(out).toEqual({ status: "failed" });
  });

  it("emits {status:'failed'} for a failed pool row", () => {
    const out = buildProjectExample({
      pool: { status: "failed", projects: [], updated_at: "2026-10-08T00:00:00.000Z", error: "boom" },
      pick: null,
      applicationId: "app-1",
      engine: "gemini",
      now: AT,
    });
    expect(out).toEqual({ status: "failed" });
  });

  it("emits {status:'failed'} for a ready pool with empty/unusable projects (never no_match)", () => {
    // "no close match" would claim a pool was actually searched; an empty
    // ready pool was not.
    const out = buildProjectExample({
      pool: readyPool({ projects: [] }),
      pick: { outcome: "no_match", entry: null, fitScore: 0 },
      applicationId: "app-1",
      engine: "gemini",
      now: AT,
    });
    expect(out).toEqual({ status: "failed" });
  });

  it("[mutation control] emits {status:'no_match'} for ready + no_match, NOT a fabricated benchmark", () => {
    const out = buildProjectExample({
      pool: readyPool({ projects: [entry({ competency: "curriculum design", domain: "K-12 teaching" })] }),
      pick: selectPoolProject([entry({ competency: "curriculum design", domain: "K-12 teaching" })], { question: SRE_Q }),
      applicationId: "app-1",
      engine: "gemini",
      now: AT,
    });
    expect(out).toEqual({ status: "no_match" });
  });

  it("[no-overclaim] a non-ready pool NEVER emits a ready entry's title/bullets (AC-14 ii)", () => {
    for (const pool of [
      { status: "pending", projects: [entry()], updated_at: "2026-10-08T00:00:00.000Z" },
      { status: "failed", projects: [entry()], updated_at: "2026-10-08T00:00:00.000Z" },
    ]) {
      const now = pool.status === "pending" ? AT : AT; // young pending stays pending; failed stays failed
      const out = buildProjectExample({ pool, pick: { outcome: "match", entry: entry() }, applicationId: "app-1", engine: "gemini", now });
      expect(out.status).not.toBe("ready");
      expect(out).not.toHaveProperty("title");
      expect(out).not.toHaveProperty("bullets");
    }
  });
});

describe("the selector is pure — zero model calls by construction (AC-6 / R-H)", () => {
  it("imports no Gemini, Interactions or Supabase client", () => {
    const src = readFileSync(fileURLToPath(new URL("./projectExampleSelect.js", import.meta.url)), "utf8");
    // Canary: the file really imports the shared overlap primitives it is
    // supposed to reuse, so "no gemini import" is not measured on an empty read.
    expect(src).toMatch(/projectStories/);
    expect(src).not.toMatch(/geminiClient|getGeminiClient|interactions\.create|generateContent/);
    expect(src).not.toMatch(/@\/lib\/supabase|createClient|createSupabaseServerClient/);
  });
});
