// app/api/interview-prep/route.js does not exist in this checkout yet
// (plan.r1.md Wave 3). This file is a SOURCE-TEXT instrument, not a runtime
// integration test, and that is a deliberate scoping decision, not a
// shortcut -- stated here so a later reader does not mistake it for less
// than it is, or for more.
//
// WHY SOURCE-TEXT, NOT A MOCKED POST() CALL. A full runtime harness for this
// route would need to fake auth (lib/experience/apiAuth.js), the rate
// limiter, the kill switch, an `applications` tenant-ownership read (no
// binding design document names which existing helper, if any, the route
// reuses for that read), O-7's digest-ensure (design-structure.r1.md §3
// states only that it is "a separate fire-and-forget POST" -- no document
// gives its exact call shape from inside this route), and prepStore.js's
// eight functions. The first six of those are UNSPECIFIED plumbing this
// chunk's own design documents deliberately leave to the implementer
// (plan.r1.md §10: "this plan's own tracing... was not completed to the
// same depth"). Guessing wrong module names or call shapes for any of them
// would make this file fail for an import-mismatch or wrong-mock reason
// once the real route lands, not for the O-14/recordModelCallIssued reasons
// it exists to pin -- the exact "AN INJECTED FAKE CANNOT SEE THE LAYER THAT
// DROPS YOUR ARGUMENT" trap this repo has already been bitten by once
// (lib/copilot/companyFactsSource.wire.test.js's history). The two gates
// this file DOES own are both about WHICH COMPOSITION the route's source
// uses, not about what a mocked dependency graph returns, so a source-text
// assertion is the correct-strength instrument here, matching this chunk's
// own K2-RPC precedent (design-operate.r1.md §3b) and app/glossaryTriggerSeams.test.js's
// seam-test idiom, not a downgrade from a runtime test that was skipped.
//
// This file proves the SHAPE of the source is right; it does not and cannot
// prove the route behaves correctly end to end. That end-to-end proof is a
// step-9/manual-check obligation once the route exists to run.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { wantsEmbedded } from "@/lib/llm/featureEngine.js";

const ROUTE_PATH = path.join(process.cwd(), "app", "api", "interview-prep", "route.js");

/** Comments stripped so a prose mention of a symbol is never mistaken for
 *  code that uses it -- same discipline as app/glossaryTriggerSeams.test.js. */
function codeOf(filePath) {
  return readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

describe("O-14's gate -- a request-supplied engine must never override the server's configuration", () => {
  // The positive control does not depend on route.js existing at all: it
  // proves, against the REAL, already-shipped wantsEmbedded(), that the fix
  // is genuinely necessary -- calling it with only the request-supplied
  // value, exactly as a route that skipped the fix would, produces the wrong
  // answer.
  it("[positive control] wantsEmbedded(engine, env) ALONE returns false for an embedded server forced by RESUME_ENGINE -- proving F2(a) fails without the extra term", () => {
    const env = { RESUME_ENGINE: "embedded" };
    expect(wantsEmbedded("gemini", env)).toBe(false);
    expect(wantsEmbedded("external", env)).toBe(false);
  });

  it("[no-op control] plan.r1.md §8.5's own row: with no engine requested, the OR composition trivially agrees with the server-forced term alone", () => {
    // body?.engine is undefined on an unset request, so the route's second
    // OR-term reads wantsEmbedded(undefined, env) -- identical to the first
    // term. x || x === x for any boolean x; this is deliberately the
    // weakest of the four rows precisely because it is the one that must
    // never register a difference the fix introduced.
    const env = { RESUME_ENGINE: "embedded" };
    expect(wantsEmbedded(undefined, env) || wantsEmbedded(undefined, env)).toBe(wantsEmbedded(undefined, env));
  });

  describe("[requires the route] the route's own source composes serverForcesEmbedded || wantsEmbedded(body?.engine, env)", () => {
    it("route.js exists", () => {
      expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
    });

    it("imports wantsEmbedded from the shared resolver, not a route-local reimplementation", () => {
      const code = codeOf(ROUTE_PATH);
      expect(code).toMatch(/import\s*\{[^}]*\bwantsEmbedded\b[^}]*\}\s*from\s*["'][^"']*featureEngine["']/);
    });

    it('[mutant this kills] computes a server-forced term via wantsEmbedded(undefined, ...) -- never wantsEmbedded(body?.engine, env) alone', () => {
      // Contract §12 / C-48's exact requirement:
      //   serverForcesEmbedded = wantsEmbedded(undefined, env)
      //   useEmbedded = serverForcesEmbedded || wantsEmbedded(body?.engine, env)
      // A build that computes useEmbedded from the request-supplied engine
      // ALONE never calls wantsEmbedded with `undefined` as its first
      // argument, so this pattern is absent from it.
      const code = codeOf(ROUTE_PATH);
      expect(code).toMatch(/wantsEmbedded\s*\(\s*undefined\s*,/);
    });

    it("[mutant this kills] the server-forced term and the request-scoped call are joined by ||, not used independently", () => {
      const code = codeOf(ROUTE_PATH);
      const idx = code.search(/wantsEmbedded\s*\(\s*undefined\s*,/);
      expect(idx, "wantsEmbedded(undefined, ...) not found -- see the previous test").toBeGreaterThanOrEqual(0);
      // The composition must live within a short window of its own
      // definition -- either as one combined expression, or as a variable
      // consumed by an `||` a few lines below. A window rather than the
      // exact same line tolerates the assignment being split across two
      // statements (serverForcesEmbedded = ...; useEmbedded = ... || ...;),
      // which is exactly the shape the contract's own prose uses.
      const window = code.slice(idx, idx + 400);
      expect(window).toMatch(/\|\|/);
      expect(window).toMatch(/wantsEmbedded\s*\(\s*body/);
    });

    it("[control] the mutant-detection window logic can actually fail -- proven against a synthetic fixture, not the real file", () => {
      const brokenSource = `
        const useEmbedded = wantsEmbedded(body?.engine, env);
      `;
      expect(brokenSource).not.toMatch(/wantsEmbedded\s*\(\s*undefined\s*,/);
    });
  });
});

describe("recordModelCallIssued gates the paid call (design-operate.r1.md §6, OP-9)", () => {
  it("route.js exists", () => {
    expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
  });

  it("calls recordModelCallIssued at all, before a generation call", () => {
    const code = codeOf(ROUTE_PATH);
    const recordIdx = code.indexOf("recordModelCallIssued(");
    expect(recordIdx, "recordModelCallIssued( not found in route.js").toBeGreaterThanOrEqual(0);
    const generateIdx = code.indexOf("generateContent(", recordIdx);
    expect(generateIdx, "no generateContent( call found after recordModelCallIssued(").toBeGreaterThan(recordIdx);
  });

  // check-4b.r1.md's BLOCKER: the pre-round-2 form checked only that
  // ".recorded" and "return"/"continue" both occur SOMEWHERE in the window,
  // with no requirement that the two be causally connected -- a route that
  // (a) calls recordModelCallIssued, (b) logs `.recorded` for observability
  // only, (c) has an ORDINARY, unrelated validation guard
  // (`if (!body?.applicationId) return ...`) sitting after that log, and
  // (d) calls generateContent UNCONDITIONALLY passed all 12 rows in this
  // file -- the exact regression design-operate.r1.md §6 names ("a counter
  // that can silently fall behind the calls actually issued is not a bound
  // on those calls"). The fix requires the return/continue to sit INSIDE a
  // conditional whose OWN condition tests `.recorded` (or a destructured
  // `recorded`), not merely co-occur with it in an unordered window.
  const RECORDED_GUARD = /if\s*\(\s*!?\s*(?:\w+\.)?recorded\b[^)]*\)\s*\{?\s*(return|continue)\b/;

  it('[mutant this kills] a guard whose OWN condition tests ".recorded" (or "recorded") is immediately followed by an early exit -- not merely co-occurring with one', () => {
    // Kills: an implementation that calls recordModelCallIssued for its
    // side effect only, discards the result, and issues the provider call
    // unconditionally -- exactly the defect design-operate.r1.md §6
    // documents as the actual fix ("a counter that can silently fall behind
    // the calls actually issued is not a bound on those calls").
    const code = codeOf(ROUTE_PATH);
    const recordIdx = code.indexOf("recordModelCallIssued(");
    const generateIdx = code.indexOf("generateContent(", recordIdx);
    expect(recordIdx).toBeGreaterThanOrEqual(0);
    expect(generateIdx).toBeGreaterThan(recordIdx);
    const between = code.slice(recordIdx, generateIdx);
    expect(
      between,
      "no `if` whose OWN condition tests .recorded is immediately followed by return/continue",
    ).toMatch(RECORDED_GUARD);
  });

  it("[control] the tightened guard regex ACCEPTS a genuine causal gate", () => {
    const between = `
      const { recorded, error } = await recordModelCallIssued(supabase, { applicationId, userId });
      if (!recorded) {
        return NextResponse.json({ error: "spend-record-failed" }, { status: 500 });
      }
    `;
    expect(between).toMatch(RECORDED_GUARD);
  });

  it("[control] the tightened guard regex REJECTS the checker's exact counter-build -- a co-occurring but causally UNRELATED return", () => {
    const between = `
      const { recorded } = await recordModelCallIssued(supabase, { applicationId, userId });
      console.log("spend recorded:", recorded);
      if (!body?.applicationId) {
        return NextResponse.json({ error: "missing applicationId" }, { status: 400 });
      }
    `;
    expect(between).not.toMatch(RECORDED_GUARD);
  });

  it("[control] the between-window mutant check can fail -- proven on a synthetic fixture where the guard is absent entirely", () => {
    const brokenBetween = "const { recorded, error } = await recordModelCallIssued(supabase, { applicationId, userId });\n";
    expect(brokenBetween).not.toMatch(RECORDED_GUARD);
  });

  it("[control] the between-window check also fails when .recorded is referenced AFTER the generation call, not before", () => {
    // Guards against a check that exists in the file but too late to matter
    // -- e.g. only logged after the (already-issued) call resolves.
    const wrongOrder = `
      const create = await client.models.generateContent({ model, contents });
      const { recorded } = await recordModelCallIssued(supabase, { applicationId, userId });
      if (!recorded) return;
    `;
    const recordIdx = wrongOrder.indexOf("recordModelCallIssued(");
    const generateIdx = wrongOrder.indexOf("generateContent(", recordIdx);
    // generateContent( appears BEFORE recordModelCallIssued( in this
    // fixture, so indexOf(..., recordIdx) never finds it after the record
    // call -- exactly the ordering defect this instrument must catch.
    expect(generateIdx).toBe(-1);
  });
});
