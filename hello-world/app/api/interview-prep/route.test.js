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
import { normalizePack, EMBEDDED_TEMPLATE_ORIGIN } from "@/lib/interviewPrep/prepParse.js";
import { packStatus, buildEmbeddedPack } from "@/lib/interviewPrep/prepPack.js";

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

  // buildEmbeddedPack itself now lives in lib/interviewPrep/prepPack.js
  // (imported above, the same module route.js imports packStatus from), so
  // this checks the REAL function's return value at runtime rather than
  // scanning route.js's source text for a literal that no longer lives
  // there.
  it('[mutant this kills] buildEmbeddedPack returns a real claims ARRAY, never an object map', () => {
    const pack = buildEmbeddedPack({ position: { title: "Engineer", company: "Globex" }, digest: null });
    expect(Array.isArray(pack.claims)).toBe(true);
    expect(pack.claims).toEqual([]);
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

describe("buildEmbeddedPack emits the four-section Pack contract (N16 wave B, moved to prepPack.js in wave D)", () => {
  // Wave A rewrote normalizePack to read `sections.stages.stages` (the
  // nested shape interview_prep_packs_ready_is_complete actually checks),
  // but buildEmbeddedPack once emitted `sections: { stages: [...] }` -- a
  // regression that dropped the embedded pack's one Overview stage at write
  // time (prepStore.js's writePrepPackResult also runs normalizePack). Wave
  // D moved buildEmbeddedPack itself into lib/interviewPrep/prepPack.js (so
  // the runtime proof below in "the F-1 regression" can call the REAL
  // function), so this now checks the real function's return shape directly
  // rather than scanning route.js's source text for a literal that no
  // longer lives there.
  it('[mutant this kills] carries all four Pack sections -- aboutYou, whyRole, askThem, stages -- at the paths interview_prep_packs_ready_is_complete reads', () => {
    const pack = buildEmbeddedPack({ position: { title: "Engineer", company: "Globex" }, digest: null });
    expect(Array.isArray(pack.sections.aboutYou.answer.lines)).toBe(true);
    expect(Array.isArray(pack.sections.whyRole.answer.lines)).toBe(true);
    expect(Array.isArray(pack.sections.askThem.questions)).toBe(true);
  });

  it('[mutant this kills] "stages" is an OBJECT carrying its own "stages" array -- never the array directly under sections (the exact wave-A regression)', () => {
    const pack = buildEmbeddedPack({ position: { title: "Engineer", company: "Globex" }, digest: null });
    expect(Array.isArray(pack.sections.stages.stages)).toBe(true);
    // The regressed shape this closes: `sections.stages` ITSELF an array,
    // one level shallower than the contract.
    expect(Array.isArray(pack.sections.stages)).toBe(false);
  });
});

describe("buildPrepPrompt requests the same four-section Pack contract, at the same nested paths, plus O-15/C-46's new instruction lines (N16 wave B)", () => {
  // Isolates buildPrepPrompt's own body so a `sections`/`claims` literal
  // belonging to buildEmbeddedPack (above it in the file) can never be
  // mistaken for this function's requested JSON shape.
  function promptBody(code) {
    const idx = code.indexOf("function buildPrepPrompt");
    expect(idx, "function buildPrepPrompt not found in route.js").toBeGreaterThanOrEqual(0);
    const nextFn = code.indexOf("function parsePrepResponse", idx);
    expect(nextFn, "function parsePrepResponse not found after buildPrepPrompt").toBeGreaterThan(idx);
    return code.slice(idx, nextFn);
  }

  it("route.js exists", () => {
    expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
  });

  it('[mutant this kills] the requested JSON shape names all four sections at the CHECK\'s own nested paths, and a flat "claims" array', () => {
    const body = promptBody(codeOf(ROUTE_PATH));
    expect(body).toMatch(/"aboutYou"\s*:\s*\{\s*"answer"\s*:\s*\{\s*"lines"/);
    expect(body).toMatch(/"whyRole"\s*:\s*\{\s*"answer"\s*:\s*\{\s*"lines"/);
    expect(body).toMatch(/"askThem"\s*:\s*\{\s*"questions"/);
    expect(body).toMatch(/"stages"\s*:\s*\{\s*"stages"\s*:\s*\[/);
    expect(body).toMatch(/"claims"\s*:\s*\[/);
  });

  it('[control] the requested-shape check can actually fail -- proven on the OLD, pre-N16 shape line', () => {
    const oldShapeLine =
      '{"tellMeAboutYourself": string, "whyThisPosition": string, "questionsToAsk": string[], "sections": {"stages": [{"name": string, "questions": string[], "recommendedAnswer": string}]}}';
    expect(oldShapeLine).not.toMatch(/"aboutYou"\s*:\s*\{\s*"answer"\s*:\s*\{\s*"lines"/);
    expect(oldShapeLine).not.toMatch(/"askThem"\s*:\s*\{\s*"questions"/);
    expect(oldShapeLine).not.toMatch(/"stages"\s*:\s*\{\s*"stages"\s*:\s*\[/);
  });

  it("[mutant this kills] instructs the model that every one of the four sections must be non-empty", () => {
    const body = promptBody(codeOf(ROUTE_PATH));
    expect(body).toContain("Every one of the four sections must be non-empty.");
  });

  it('[mutant this kills] instructs the model on C-46\'s citation contract: claimId must resolve, and sourceUrl must be a real publisher URL, never a redirect', () => {
    const body = promptBody(codeOf(ROUTE_PATH));
    expect(body).toContain(
      "Any support.claimId must appear as an id in claims, and every claims entry must carry a real publisher URL in sourceUrl -- never a search-redirect URL.",
    );
  });

  it("[mutant this kills] instructs the model to write aboutYou/whyRole in first person and never name any person there", () => {
    const body = promptBody(codeOf(ROUTE_PATH));
    expect(body).toContain(
      "Write aboutYou and whyRole in the first person. Never write the candidate's own name, or any person's name, in those two sections.",
    );
  });

  it("keeps the pre-existing O-11/O-15 interviewer-prediction prohibition verbatim", () => {
    const body = promptBody(codeOf(ROUTE_PATH));
    expect(body).toContain(
      "Never name, describe, or predict which specific person will conduct or attend any interview, however confident you are -- that is forbidden.",
    );
  });

  it("[control] the three new instruction-line checks can actually fail -- proven on a fixture missing all three", () => {
    const broken = [
      "Respond with ONLY a JSON object.",
      "Never name, describe, or predict which specific person will conduct or attend any interview, however confident you are -- that is forbidden.",
    ].join("\n\n");
    expect(broken).not.toContain("Every one of the four sections must be non-empty.");
    expect(broken).not.toContain("Any support.claimId must appear as an id in claims");
    expect(broken).not.toContain("Write aboutYou and whyRole in the first person.");
  });
});

describe("the generation path computes packStatus AFTER normalizing the model's reply, never on the raw parsed pack (N16 wave B / write rule)", () => {
  // SOURCE-TEXT ONLY, matching this file's own established discipline (see
  // its header): this can prove the route's SOURCE calls normalizePack
  // before packStatus and feeds packStatus the variable that call produced,
  // never `parsed.pack` directly. It CANNOT prove, at runtime, that the
  // value reaching packStatus actually went through every one of
  // normalizePack's drop/null branches correctly -- prepParse.test.js owns
  // that runtime proof for normalizePack itself, and finishAttempt.test.js
  // owns it for the write path beneath this route. What would defeat this
  // instrument: a build that imports normalizePack and packStatus, calls
  // both somewhere in the file, but computes the written status from
  // `parsed.pack` directly (reintroducing the exact bug this wave closes --
  // a 'ready' pack full of lines normalizePack would have dropped). A
  // regex ordering check cannot see through a build that renames variables
  // to defeat it by coincidence; only a real invocation with an injected
  // model response could close that gap, and this file's own header already
  // disclaims that kind of harness for every other gate it checks.
  it("route.js exists", () => {
    expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
  });

  it("imports normalizePack from prepParse.js and packStatus from prepPack.js, not a route-local reimplementation", () => {
    const code = codeOf(ROUTE_PATH);
    expect(code).toMatch(/import\s*\{[^}]*\bnormalizePack\b[^}]*\}\s*from\s*["'][^"']*prepParse["']/);
    expect(code).toMatch(/import\s*\{[^}]*\bpackStatus\b[^}]*\}\s*from\s*["'][^"']*prepPack["']/);
  });

  it('[mutant this kills] never calls packStatus on "parsed.pack" directly', () => {
    const code = codeOf(ROUTE_PATH);
    expect(code).not.toMatch(/packStatus\(\s*parsed\.pack\s*\)/);
  });

  it('[mutant this kills] normalizePack(parsed.pack) is computed, and packStatus is called on that same result, in that order', () => {
    const code = codeOf(ROUTE_PATH);
    const normIdx = code.search(/normalizePack\(\s*parsed\.pack\s*\)/);
    expect(normIdx, "normalizePack(parsed.pack) not found in route.js").toBeGreaterThanOrEqual(0);
    const statusIdx = code.indexOf("packStatus(", normIdx);
    expect(statusIdx, "packStatus( not found after normalizePack(parsed.pack)").toBeGreaterThan(normIdx);
    // The two must share a variable: whatever name normalizePack's result is
    // assigned to must be the SAME name packStatus is invoked with, not a
    // second, independent read of parsed.pack under a different name.
    const assign = code.slice(normIdx - 60, normIdx).match(/const\s+(\w+)\s*=\s*$/);
    expect(assign, "normalizePack(parsed.pack) is not assigned to a const").not.toBeNull();
    const varName = assign[1];
    const statusCall = code.slice(statusIdx, statusIdx + 40);
    expect(statusCall).toMatch(new RegExp(`packStatus\\(\\s*${varName}\\s*\\)`));
  });

  it('[mutant this kills] a computedStatus of null (0 of 4 sections survived normalization) writes status "failed" with reason "provider-error", not "ready"', () => {
    const code = codeOf(ROUTE_PATH);
    const nullIdx = code.search(/computedStatus\s*===\s*null/);
    expect(nullIdx, "no branch tests computedStatus === null").toBeGreaterThanOrEqual(0);
    const finishIdx = code.indexOf("finishAttempt(supabase,", nullIdx);
    expect(finishIdx, "no finishAttempt call found after the computedStatus === null check").toBeGreaterThan(nullIdx);
    const window = code.slice(finishIdx, finishIdx + 300);
    expect(window).toMatch(/status\s*:\s*["']failed["']/);
    expect(window).toMatch(/reason\s*:\s*["']provider-error["']/);
  });

  it("[control] the ordering check can actually fail -- proven on a fixture that reads parsed.pack a second time under a different name", () => {
    const broken = `
      // padding so the preceding-60-characters slice below has enough room,
      // matching how much real surrounding code precedes the real call site.
      const shapedPack = normalizePack(parsed.pack);
      const computedStatus = packStatus(parsed.pack);
    `;
    const normIdx = broken.search(/normalizePack\(\s*parsed\.pack\s*\)/);
    const statusIdx = broken.indexOf("packStatus(", normIdx);
    const assign = broken.slice(normIdx - 60, normIdx).match(/const\s+(\w+)\s*=\s*$/);
    expect(assign).not.toBeNull();
    const varName = assign[1];
    const statusCall = broken.slice(statusIdx, statusIdx + 40);
    expect(statusCall).not.toMatch(new RegExp(`packStatus\\(\\s*${varName}\\s*\\)`));
  });

  it("[control] the null-status write-rule check can actually fail -- proven on a fixture that writes 'ready' regardless", () => {
    const broken = `
      if (computedStatus === null) {
      }
      const { write, status } = await finishAttempt(supabase, {
        status: "ready",
        pack: normalizedPack,
      });
    `;
    const nullIdx = broken.search(/computedStatus\s*===\s*null/);
    const finishIdx = broken.indexOf("finishAttempt(supabase,", nullIdx);
    const window = broken.slice(finishIdx, finishIdx + 300);
    expect(window).not.toMatch(/status\s*:\s*["']failed["']/);
    expect(window).not.toMatch(/reason\s*:\s*["']provider-error["']/);
  });
});

describe("F-1: the embedded-template K1-SHAPE exemption is unreachable from the generation (model) path", () => {
  // Companion to prepParse.test.js's own F-1 describe block, which proves
  // the MECHANICS (exemptCitation true/false) at the normalizePack level.
  // What THIS file owns, per its own header, is proving the route's SOURCE
  // actually strips the field on the one path an attacker can reach --
  // buildEmbeddedPack's own literal is never attacker-influenced at all, so
  // the model (generation) path is the only one that needs this proof.
  it("route.js exists", () => {
    expect(existsSync(ROUTE_PATH), "app/api/interview-prep/route.js has not been implemented yet").toBe(true);
  });

  it('[mutant this kills] buildEmbeddedPack sets templateOrigin to the SAME EMBEDDED_TEMPLATE_ORIGIN constant normalizePack checks against', () => {
    const pack = buildEmbeddedPack({ position: { title: "Engineer", company: "Globex" }, digest: null });
    expect(pack.templateOrigin).toBe(EMBEDDED_TEMPLATE_ORIGIN);
  });

  // J: the strip now lives inside parsePrepResponse -- the single boundary
  // where untrusted model JSON becomes a pack object -- rather than as a
  // separate step the caller must remember to run afterward (see that
  // function's own header). Isolating its body, rather than scanning the
  // whole file, means an unrelated rename of some OTHER variable named
  // "parsed" elsewhere in route.js cannot false-fail this check, and a
  // strip that migrated to a different function would be caught by the
  // "not found" assertion below rather than silently matching leftover text.
  function parsePrepResponseBody(code) {
    const idx = code.indexOf("function parsePrepResponse");
    expect(idx, "function parsePrepResponse not found in route.js").toBeGreaterThanOrEqual(0);
    const nextFn = code.indexOf("function writeFailureResponse", idx);
    expect(nextFn, "function writeFailureResponse not found after parsePrepResponse").toBeGreaterThan(idx);
    return code.slice(idx, nextFn);
  }

  it('[mutant this kills] parsePrepResponse deletes templateOrigin off the parsed JSON before returning it as "pack"', () => {
    const body = parsePrepResponseBody(codeOf(ROUTE_PATH));
    const deleteIdx = body.indexOf("delete parsed.templateOrigin");
    expect(deleteIdx, "delete parsed.templateOrigin not found in parsePrepResponse").toBeGreaterThanOrEqual(0);
    const returnIdx = body.indexOf("return { ok: true, pack: parsed }", deleteIdx);
    expect(returnIdx, "return { ok: true, pack: parsed } not found after the delete").toBeGreaterThan(deleteIdx);
  });

  it("[control] the isolation helper can actually fail -- proven on a fixture where the strip has moved OUTSIDE parsePrepResponse", () => {
    const broken = `
      function parsePrepResponse(response) {
        return { ok: true, pack: JSON.parse(response.text) };
      }
      function writeFailureResponse() {}
    `;
    const idx = broken.indexOf("function parsePrepResponse");
    const nextFn = broken.indexOf("function writeFailureResponse", idx);
    const body = broken.slice(idx, nextFn);
    expect(body.indexOf("delete parsed.templateOrigin")).toBe(-1);
  });

  it("runtime: parsePrepResponse cannot be imported directly (route.test.js's own header) -- so the strip's actual behaviour is proven at the prepParse level: a pack shaped exactly like what parsePrepResponse now hands normalizePack (templateOrigin already absent) is refused normally", () => {
    // This mirrors exactly what reaches normalizePack once parsePrepResponse
    // has run: no templateOrigin key at all. prepParse.test.js's own F-1
    // block asserts the same fact directly against normalizePack; this
    // documents why route.js's own composition (strip, then normalize) is
    // what makes that fact reachable on the generation path.
    const raw = JSON.stringify({
      sections: { aboutYou: { answer: { lines: [{ text: "Jane Doe led that project." }] } } },
      claims: [],
      templateOrigin: EMBEDDED_TEMPLATE_ORIGIN,
    });
    const parsed = JSON.parse(raw);
    delete parsed.templateOrigin;
    const normalized = normalizePack(parsed);
    expect(normalized.sections.aboutYou.answer.lines).toHaveLength(0);
  });
});

describe("F-1: the embedded pack survives normalizePack for a realistic Title-Case job title (runtime, against the REAL producer)", () => {
  // The F-1 deliverable: a structurally perfect, semantically empty pack
  // must be impossible to ship green again. A prior revision of this test
  // ran the proof against `embeddedPackFixture`, a hand-mirrored COPY of
  // buildEmbeddedPack's literal, on the theory that the source-text blocks
  // above pin the real literal "byte-for-byte" so the two could not drift.
  // That theory was false: those blocks pinned only KEY STRUCTURE
  // (`aboutYou: { answer: { lines: ... }`), never the strings, never
  // non-emptiness -- a mutant emptying `lines` to `[]`, dropping a question,
  // or rewriting a sentence entirely all left the fixture-based version of
  // this test green. Wave D moved buildEmbeddedPack into
  // lib/interviewPrep/prepPack.js specifically so this test could import
  // and run the REAL function -- no mirror, nothing to drift.
  it('[the F-1 regression] all four sections of the REAL buildEmbeddedPack survive normalizePack, and packStatus reports "ready", for the Title-Case title "Software Engineer"', () => {
    const pack = buildEmbeddedPack({ position: { title: "Software Engineer", company: "Acme Robotics" }, digest: null });
    const normalized = normalizePack(pack);
    expect(normalized.sections.aboutYou.answer.lines.length).toBeGreaterThan(0);
    expect(normalized.sections.whyRole.answer.lines.length).toBeGreaterThan(0);
    // Exact count, not merely > 0 -- buildEmbeddedPack asks two distinct
    // askThem questions, and a mutant dropping one of them must still fail
    // this test even though one question is still a non-empty array.
    expect(normalized.sections.askThem.questions.length).toBe(2);
    expect(normalized.sections.stages.stages.length).toBeGreaterThan(0);
    // What packStatus computes from this survived content: with the fix,
    // all four sections are non-empty, so the pure predicate says "ready".
    // route.js's OWN embedded branch still deliberately WRITES "partial"
    // regardless (see buildEmbeddedPack's own header -- an owner ruling,
    // unchanged by this fix): a deterministic, no-LLM backend is templated
    // filler, never a real researched pack, so "ready" would overstate it
    // even though every section now genuinely survives. This assertion
    // proves the CONTENT survived (packStatus can now honestly say "ready"
    // for it), not what literal status byte the route chooses to persist.
    expect(packStatus(normalized)).toBe("ready");
  });

  it('[mutant this kills] the stage carries its "Tell me about yourself." question and exactly one Overview stage -- not an empty shell', () => {
    const pack = buildEmbeddedPack({ position: { title: "Software Engineer", company: "Acme Robotics" }, digest: null });
    const normalized = normalizePack(pack);
    expect(normalized.sections.stages.stages).toHaveLength(1);
    expect(normalized.sections.stages.stages[0].name).toBe("Overview");
    expect(normalized.sections.stages.stages[0].questions).toContain("Tell me about yourself.");
  });

  it('[mutant this kills] aboutYou/whyRole actually mention the posting\'s own company -- a length check alone cannot tell "Lead with the experience..." apart from unrelated filler text of the same length', () => {
    // "Acme Robotics" ends in a recognized organization suffix ("Robotics"),
    // so E's own title/company screening (above) never substitutes it out --
    // this is a stable content pin regardless of that fix.
    const pack = buildEmbeddedPack({ position: { title: "Software Engineer", company: "Acme Robotics" }, digest: null });
    const normalized = normalizePack(pack);
    expect(normalized.sections.aboutYou.answer.lines[0].text).toContain("Acme Robotics");
    expect(normalized.sections.whyRole.answer.lines[0].text).toContain("Acme Robotics");
  });

  it('[the exact defect this closes] the REAL pack, run through the OLD flat sections.stages shape wave B regressed to, still recovers its stage via F-5 (not a false pass from an unrelated fix)', () => {
    const pack = buildEmbeddedPack({ position: { title: "Data Scientist", company: "Northwind Health" }, digest: null });
    // Simulate the pre-fix regression: sections.stages as the array
    // directly, one level shallower than the contract.
    pack.sections.stages = pack.sections.stages.stages;
    const normalized = normalizePack(pack);
    expect(normalized.sections.stages.stages).toHaveLength(1);
  });

  it("[control] WITHOUT templateOrigin set, the stage's own 'Why <company>' question -- the one piece E's title/company screening cannot pre-filter, since the collision is with the FIXED template word \"Why\", not the company value itself -- is dropped, proving the exemption still does real work", () => {
    const pack = buildEmbeddedPack({ position: { title: "Software Engineer", company: "Acme Robotics" }, digest: null });
    delete pack.templateOrigin;
    const normalized = normalizePack(pack);
    expect(normalized.sections.stages.stages[0].questions).not.toContain("Why Acme Robotics?");
    expect(normalized.sections.stages.stages[0].questions).toContain("Tell me about yourself.");
  });

  it("[control] a lower-case, non-Title-Case job title never needed the exemption in the first place", () => {
    const pack = buildEmbeddedPack({ position: { title: "engineer", company: "globex" }, digest: null });
    delete pack.templateOrigin;
    const normalized = normalizePack(pack);
    expect(packStatus(normalized)).toBe("ready");
  });
});

describe("E: buildEmbeddedPack never interpolates a name-shaped title/company uncited (position rows are merged from external job feeds)", () => {
  // The exact executed exploit a prior revision of this pack shipped: an
  // exempted pack (templateOrigin set) kept "Lead with the experience most
  // relevant to the Jane Doe role at Acme Robotics." uncited, because the
  // K1-SHAPE exemption -- justified as "our own fixed template ... it
  // cannot name a real person" -- was actually applied to the template PLUS
  // whatever `position.title`/`position.company` a job feed supplied
  // (lib/supabase/writePosition.js merges `positions` rows keyed on
  // `external_id`, e.g. "gh-12345" -- external, uncorroborated data).
  it('[mutant this kills] a title shaped like a real person\'s name is never interpolated -- it falls back to "this role"', () => {
    const pack = buildEmbeddedPack({ position: { title: "Jane Doe", company: "Acme Robotics" }, digest: null });
    const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
    expect(aboutYouText).not.toContain("Jane Doe");
    expect(aboutYouText).toContain("this role");
  });

  it('[mutant this kills] a company shaped like a real person\'s name is never interpolated -- it falls back to "this company"', () => {
    const pack = buildEmbeddedPack({ position: { title: "Engineer", company: "Jane Doe" }, digest: null });
    const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
    expect(aboutYouText).not.toContain("Jane Doe");
    expect(aboutYouText).toContain("this company");
  });

  it("[positive control] an ordinary company name ending in a recognized organization suffix is used as-is", () => {
    const pack = buildEmbeddedPack({ position: { title: "Engineer", company: "Acme Robotics" }, digest: null });
    expect(pack.sections.aboutYou.answer.lines[0].text).toContain("Acme Robotics");
  });

  it("runtime: even WITH templateOrigin's exemption, the resulting pack never carries an uncited detected name once E's screening runs first", () => {
    const pack = buildEmbeddedPack({ position: { title: "Jane Doe", company: "Acme Robotics" }, digest: null });
    const normalized = normalizePack(pack);
    const allText = JSON.stringify(normalized.sections);
    expect(allText).not.toContain("Jane Doe");
  });
});
