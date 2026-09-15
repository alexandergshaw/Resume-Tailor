// app/api/interview-prep/route.js exists in this checkout (landed in
// plan.r1.md Wave 3) and this diff edits it. This file is a SOURCE-TEXT
// instrument, not a runtime integration test, and that stays a deliberate
// scoping decision, not a shortcut, even now that the route exists --
// stated here so a later reader does not mistake it for less than it is, or
// for more.
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
 *  code that uses it -- same discipline as app/glossaryTriggerSeams.test.js.
 *  Strips a `//` run to end-of-line wherever it starts, not only when the
 *  whole line is a comment -- a TRAILING `//` comment (code, then a comment)
 *  used to survive this and could false-fail one of the bans below. This
 *  file's own route source carries no `//` inside a string or regex literal
 *  (checked by hand), so this is safe here even though it is not a general
 *  JS tokenizer. */
function codeOf(filePath) {
  return readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("O-14's gate -- a request-supplied engine must never override the server's configuration", () => {
  // This control used to prove the route's extra OR-term was NECESSARY, by
  // showing the shipped wantsEmbedded() returned the wrong answer on its own.
  // SEC-1 fixed that resolver (owner rulings O-14 + O-18), so the premise no
  // longer holds and the control detected it -- which is what a control is
  // for. It now pins the CURRENT truth: the resolver refuses an escalating
  // request by itself, so the route's second term is redundant. It is kept
  // regardless, because O-14 ruled the route-level gate stays as defence in
  // depth rather than as the fix -- and a redundant guard that is asserted to
  // be redundant cannot rot into a guard nobody notices is load-bearing.
  it("[positive control] wantsEmbedded(engine, env) ALONE now refuses an escalating request against an embedded server -- so the route's extra term is redundant, and deliberately retained", () => {
    const env = { RESUME_ENGINE: "embedded" };
    // Escalation is refused by the resolver itself (SEC-1).
    expect(wantsEmbedded("gemini", env)).toBe(true);
    expect(wantsEmbedded("external", env)).toBe(true);
    // O-18's other half: de-escalation is still honoured, so this gate never
    // blocks a candidate opting into the free, non-egressing path.
    expect(wantsEmbedded("embedded", { RESUME_ENGINE: "gemini" })).toBe(true);
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

describe("the route composes its terminal-write path through the extracted finishAttempt module, never a route-local reimplementation (N9)", () => {
  // finishAttempt() -- including the CHECK-safe fallback that reads
  // isCheckViolation() -- moved out of this route into
  // lib/interviewPrep/finishAttempt.js (see that file's own header and
  // finishAttempt.test.js for its runtime coverage and its own,
  // call-shape-level source checks on isCheckViolation). What THIS file
  // still owns is the route's own composition: that it defers to that
  // module rather than a local stand-in, and that no message-text pattern
  // has crept back into the route itself.
  const NO_LOCAL_FINISH_ATTEMPT = /(function|const|let)\s+finishAttempt\b/;
  const CHECK_PHRASE = /check\s+constraint/i;

  it("route.js exists", () => {
    expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
  });

  it("imports finishAttempt from its own dedicated module, not a route-local reimplementation", () => {
    const code = codeOf(ROUTE_PATH);
    expect(code).toMatch(/import\s*\{[^}]*\bfinishAttempt\b[^}]*\}\s*from\s*["'][^"']*finishAttempt["']/);
    expect(code).not.toMatch(NO_LOCAL_FINISH_ATTEMPT);
  });

  it('[mutant this kills: the message-text regex reintroduced, with or without "violates"] the route\'s own source contains no CHECK-constraint phrasing of its own', () => {
    // The defect N9 removes: `function isCheckViolation(message) { return
    // typeof message === "string" && /violates check constraint/i.test(message);
    // }`. The ORIGINAL ban here only matched the full "violates check
    // constraint" phrase, so a reworded matcher testing for just "check
    // constraint" (dropping "violates") evaded it -- broadened below to
    // catch either.
    const code = codeOf(ROUTE_PATH);
    expect(code).not.toMatch(CHECK_PHRASE);
  });

  it("[control] the phrase-absence check can actually fail -- proven on synthetic fixtures, WITH and WITHOUT \"violates\"", () => {
    const withViolates = `
      function isCheckViolation(message) {
        return typeof message === "string" && /violates check constraint/i.test(message);
      }
    `;
    const withoutViolates = `
      function isCheckViolation(message) {
        return typeof message === "string" && /check constraint/i.test(message);
      }
    `;
    expect(withViolates).toMatch(CHECK_PHRASE);
    expect(withoutViolates).toMatch(CHECK_PHRASE);
  });

  it("[control] the no-local-finishAttempt check can actually fail -- proven on a synthetic fixture that keeps the import but shadows it locally", () => {
    // The exact evasion this guards against: an import line that still
    // satisfies a naive "imports finishAttempt" substring check, sitting
    // beside a local definition that actually gets called instead.
    const brokenSource = `
      import { finishAttempt as sharedFinishAttempt } from "@/lib/interviewPrep/finishAttempt";
      function finishAttempt() { return { write: { written: false }, status: "failed" }; }
    `;
    expect(brokenSource).toMatch(NO_LOCAL_FINISH_ATTEMPT);
  });
});

describe("the embedded write satisfies interview_prep_packs' own CHECK constraints under status 'partial', never 'ready'", () => {
  // Confirmed present on the live project (no drift), supabase/migrations/
  // 20260914000000_interview_prep.sql:
  //
  //   interview_prep_packs_claims_is_array (:219-220) -- applies to BOTH
  //   'ready' AND 'partial': `jsonb_typeof(pack -> 'claims') = 'array'`. So
  //   buildEmbeddedPack must emit a real array unconditionally, not rely on
  //   prepParse.js's normalizePack to rescue an object map at write time --
  //   a producer should be correct at the source.
  //
  //   interview_prep_packs_ready_is_complete (:194-211) -- applies ONLY to
  //   'ready', and requires `pack -> 'sections'` to carry all four of
  //   aboutYou/whyRole/askThem/stages, each resolving to a non-empty array
  //   at the exact nested paths the migration names. buildEmbeddedPack's
  //   `sections` carries only `stages`, so it can only ever satisfy this
  //   CHECK by building a full four-section pack -- which the owner ruled
  //   against, choosing instead to write status 'partial' (honest about a
  //   deterministic, no-LLM backend), which never evaluates this CHECK at
  //   all (`status <> 'ready' or (...)`).
  //
  // Both instruments below are source-text, matching this file's own
  // established idiom (see its header): the two gates they pin are about
  // WHICH LITERAL the route's source writes, not about a mocked dependency
  // graph's return value.

  it("route.js exists", () => {
    expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
  });

  /** Isolates buildEmbeddedPack's own body, so a `claims` literal read
   *  elsewhere in the file (e.g. the Gemini generation path) can never be
   *  mistaken for this function's. */
  function embeddedPackBody(code) {
    const idx = code.indexOf("function buildEmbeddedPack");
    expect(idx, "function buildEmbeddedPack not found in route.js").toBeGreaterThanOrEqual(0);
    const nextFn = code.indexOf("function buildPrepPrompt", idx);
    expect(nextFn, "function buildPrepPrompt not found after buildEmbeddedPack").toBeGreaterThan(idx);
    return code.slice(idx, nextFn);
  }

  it('[mutant this kills] buildEmbeddedPack returns "claims: []" -- a real array literal, never the object-map "claims: {}"', () => {
    const code = codeOf(ROUTE_PATH);
    const body = embeddedPackBody(code);
    expect(body).toMatch(/claims\s*:\s*\[\s*\]/);
    expect(body).not.toMatch(/claims\s*:\s*\{\s*\}/);
  });

  it("[control] the claims-array check can actually fail -- proven on a synthetic fixture still emitting the object-map shape", () => {
    const broken = `
      function buildEmbeddedPack({ position, digest }) {
        return { sections: { stages: [] }, claims: {} };
      }
      function buildPrepPrompt() {}
    `;
    const idx = broken.indexOf("function buildEmbeddedPack");
    const nextFn = broken.indexOf("function buildPrepPrompt", idx);
    const body = broken.slice(idx, nextFn);
    expect(body).not.toMatch(/claims\s*:\s*\[\s*\]/);
    expect(body).toMatch(/claims\s*:\s*\{\s*\}/);
  });

  /** Isolates the embedded gate's own block, up to the Gemini client setup
   *  that follows it -- so the Gemini generation path's own (unrelated)
   *  "ready" write can never be mistaken for the embedded path's. */
  function embeddedGateWindow(code) {
    const gateIdx = code.indexOf("if (useEmbedded) {");
    expect(gateIdx, "if (useEmbedded) { block not found in route.js").toBeGreaterThanOrEqual(0);
    const clientIdx = code.indexOf("let client;", gateIdx);
    expect(clientIdx, "let client; not found after the embedded gate").toBeGreaterThan(gateIdx);
    return code.slice(gateIdx, clientIdx);
  }

  it('[mutant this kills] the embedded path\'s own finishAttempt call writes status "partial", never "ready"', () => {
    const code = codeOf(ROUTE_PATH);
    const window = embeddedGateWindow(code);
    expect(window).toMatch(/status\s*:\s*["']partial["']/);
    expect(window).not.toMatch(/status\s*:\s*["']ready["']/);
  });

  it("[control] the embedded-status check can actually fail -- proven on a synthetic fixture that still writes 'ready'", () => {
    const broken = `
      if (useEmbedded) {
        const pack = buildEmbeddedPack({ position, digest });
        const { write, status } = await finishAttempt(supabase, {
          ...attemptCtx,
          status: "ready",
          pack,
        });
      }
      let client;
    `;
    const gateIdx = broken.indexOf("if (useEmbedded) {");
    const clientIdx = broken.indexOf("let client;", gateIdx);
    const window = broken.slice(gateIdx, clientIdx);
    expect(window).not.toMatch(/status\s*:\s*["']partial["']/);
    expect(window).toMatch(/status\s*:\s*["']ready["']/);
  });
});

describe("attemptCtx carries triggerClass and engine to every finishAttempt call site (N14 remediation review)", () => {
  // Measured: deleting `engine` from attemptCtx's own literal leaves the full
  // lib/interviewPrep + app/api/interview-prep suite (136 tests) green --
  // no test previously read attemptCtx's declared property list, so
  // interview_prep_events.engine would go silently blank on every attempt
  // this route records. finishAttempt.test.js's own wire test (against the
  // real writePrepPackResult/recordPrepEvent) pins the VALUES that reach the
  // event row; this file owns the route's own composition -- that the one
  // object built here actually carries both fields to every write site.
  const ATTEMPT_CTX_DECL = /const\s+attemptCtx\s*=\s*\{([^}]*)\}/;

  it("route.js exists", () => {
    expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
  });

  it('[mutant this kills: "engine" (or "triggerClass") dropped from the attemptCtx literal] attemptCtx names both triggerClass and engine', () => {
    const code = codeOf(ROUTE_PATH);
    const match = code.match(ATTEMPT_CTX_DECL);
    expect(match, "const attemptCtx = { ... } not found in route.js").not.toBeNull();
    expect(match[1]).toMatch(/\btriggerClass\b/);
    expect(match[1]).toMatch(/\bengine\b/);
  });

  it("every finishAttempt(supabase, { call site spreads attemptCtx, directly or via a ctx object built from it", () => {
    const code = codeOf(ROUTE_PATH);
    const CALL_SITE = /finishAttempt\(supabase,\s*\{/g;
    let match;
    let count = 0;
    while ((match = CALL_SITE.exec(code))) {
      count += 1;
      const window = code.slice(match.index, match.index + 200);
      expect(window, `finishAttempt call at offset ${match.index} does not spread attemptCtx or ctx`).toMatch(
        /\.\.\.(attemptCtx|ctx)\b/,
      );
    }
    // Five direct route-body calls plus refuseRecordingFailure's own --
    // regressing this count would mean a call site's shape changed enough
    // that this scan no longer sees it at all.
    expect(count).toBeGreaterThanOrEqual(6);
  });

  it("refuseRecordingFailure's own ctx argument is itself built by spreading attemptCtx", () => {
    // refuseRecordingFailure(supabase, ctx) spreads `...ctx`, not
    // `...attemptCtx`, by name -- ctx is its own parameter. The previous
    // test alone would pass even if that parameter were seeded from
    // something else entirely, so this checks the CALL site builds ctx from
    // attemptCtx in the first place.
    const code = codeOf(ROUTE_PATH);
    const idx = code.indexOf("refuseRecordingFailure(supabase, {");
    expect(idx, "refuseRecordingFailure(supabase, { call site not found").toBeGreaterThanOrEqual(0);
    const window = code.slice(idx, idx + 200);
    expect(window).toMatch(/\.\.\.attemptCtx\b/);
  });

  it("[control] the attemptCtx property check can actually fail -- proven on a fixture missing engine", () => {
    const brokenSource = "const attemptCtx = { applicationId, userId, leaseToken: claim.leaseToken, triggerClass };";
    const match = brokenSource.match(ATTEMPT_CTX_DECL);
    expect(match).not.toBeNull();
    expect(match[1]).not.toMatch(/\bengine\b/);
  });

  it("[control] the per-call-site spread check can actually fail -- proven on a fixture that stops spreading attemptCtx", () => {
    const brokenSource = 'const { write, status } = await finishAttempt(supabase, { applicationId, status: "ready" });';
    const CALL_SITE = /finishAttempt\(supabase,\s*\{/g;
    const match = CALL_SITE.exec(brokenSource);
    expect(match).not.toBeNull();
    const window = brokenSource.slice(match.index, match.index + 200);
    expect(window).not.toMatch(/\.\.\.(attemptCtx|ctx)\b/);
  });
});
