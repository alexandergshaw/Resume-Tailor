// node (this repo's default environment) — a SOURCE-TEXT test, deliberately.
//
// The LAST describe block below (step-9c-iii, 2nd pass) also imports real,
// pure, React-free functions from lib/copilot/choiceChangeInvalidation.js
// and calls them directly — no jsdom, no React render needed, because the
// FIX itself (after the coordinator's gate on the first attempt) is a pure
// per-render comparison with no effect, no flushSync and no React timing
// dependency at all; see that module's own doc on joinInterviewTypeAnnouncements.
//
// AC-A12 / AC-A13 / AC-A15, on the LIVE surface. This file exists because
// nothing else in chunk A reads `CopilotClient.js` at all: the practice
// surface got a wiring assertion (`PracticeClient.interviewTypeWiring.test.js`,
// AC-A13b) and the live surface — the file the plan itself calls "the binding
// constraint of the chunk" — got none. The AC-A13b argument applies here
// verbatim; it simply had no file.
//
// It is not a hypothetical hole. An adversarial pass built a `PracticeClient`
// that imported BOTH `useInterviewTypeChange` and the duty composer, CALLED
// both, and was still completely inert — the hook got an empty handler and the
// composer was invoked from the posting callback instead. Every "imports and
// calls" assertion was green while changing the interview type did nothing and
// changing the POSTING ran the type change's duty list. The same shape is
// available here, so the same instrument is pointed at it.
//
// Written BEFORE the implementation exists (step 4b), so these fail against
// today's `CopilotClient.js`, which has no interview-type wiring of any kind.
//
// TWO RULES THIS FILE FOLLOWS, both learned from defects in its sibling:
//   1. ASSERT THE OBSERVABLE EFFECT, NOT THE PRESENCE OF A CALL. Every
//      assertion below is scoped to the scope the effect must occur in.
//   2. BRACKET-BALANCE, NEVER SLICE TO A DELIMITER. Slicing to the first `)`
//      lands inside `() => {}`; running to "the next top-level const"
//      overshoots into whatever follows. Both have already produced a wrong
//      result in this test set — one vacuous, one that failed a CORRECT
//      implementation.
//
// AND THE STANDING CONSTRAINT: when this property moves to another module,
// AMEND these assertions to name the module that now holds it. A module must
// never be left carrying dead code to keep a source-text test green.
//
// THIS ALREADY HAPPENED ONCE (headroom extraction, wave 2): the live/practice
// announcement state, both change-subscriber handlers (interview-type AND
// code-language), the practice wrapper, and the join call site all moved
// from CopilotClient.js into app/copilot/useTypeAnnouncements.js (read below
// as HOOK) to buy CopilotClient.extraction.test.js's 950-line cap some
// headroom. CLIENT kept only two seams: feeding the hook the real
// `cueAnnouncement.text`/`briefLiveText` values (as `cueText`/`briefText`),
// and calling the `resetTypeAnnouncements` the hook hands back from
// `onModeChange`. When ANY of this moves again, re-amend the assertions
// below rather than deleting them — an assertion made to merely prove a
// string exists somewhere, rather than that the module which now owns the
// property still enforces it, is the exact failure mode this note warns
// against. (Mutation-tested against useTypeAnnouncements.js when it moved:
// every relocated assertion was confirmed to still fail when the property it
// names was individually broken in the new module.)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = readFileSync(join(HERE, "CopilotClient.js"), "utf8");
// Headroom extraction (wave 2): the interview-type/code-language change
// handlers, the announcement state and the join now live in
// useTypeAnnouncements.js — see ITS OWN doc, and CopilotClient.js's own
// comment at the call site, for the move. Every assertion below that used to
// read CLIENT for one of THOSE properties now reads HOOK instead; anything
// that stayed behind in CopilotClient.js (onPostingChange, the
// practice-composer ban, onModeChange's call site) still reads CLIENT.
const HOOK = readFileSync(join(HERE, "useTypeAnnouncements.js"), "utf8");

// The full expression starting at `marker`, bracket-balanced.
function callExpression(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

// A `const <name> = ...` declaration, balanced to the end of its first
// bracketed expression and not one character further.
function declarationBody(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start === -1) return null;
  const open = src.indexOf("(", start);
  if (open === -1) return src.slice(start);
  const balanced = callExpression(src.slice(open), "(");
  return balanced === null ? src.slice(start) : src.slice(start, open + balanced.length);
}

// The body a subscription hook actually runs, whichever of the two legal
// shapes the caller used:
//
//   useInterviewTypeChange(useCallback((next, prev, meta) => { ... }, [deps]))
//   const onTypeChanged = useCallback(..., [deps]); useInterviewTypeChange(onTypeChanged);
//
// Resolving a bare identifier back to its declaration is what stops this file
// FAILING A CORRECT IMPLEMENTATION that hoists its handler — the plan's §C.2
// requires a stable `useCallback`, and says nothing about whether it is
// inlined at the registration site.
function subscriptionHandler(src, hookName) {
  const call = callExpression(src, `${hookName}(`);
  if (call === null) return null;
  const inner = call.slice(hookName.length + 1, -1).trim();
  if (/^[A-Za-z_$][\w$]*$/.test(inner)) {
    const resolved = declarationBody(src, inner);
    if (resolved) return resolved;
  }
  return call;
}

// The argument object handed to `invalidateLiveAnswers`, extracted from inside
// the change handler. Every claim about WHAT the composer is given is scoped
// here rather than to the handler as a whole: a stable `useCallback`'s
// dependency array sits inside the handler's own extent, so a name mentioned
// only there would satisfy a handler-wide match while the callback bag omitted
// it. That loophole was found by mutating this file.
//
// Takes `src` explicitly (wave 2): the handler this extracts from now lives
// in useTypeAnnouncements.js (HOOK), not CopilotClient.js (CLIENT).
function invalidateLiveAnswersCall(src) {
  const handler = subscriptionHandler(src, "useInterviewTypeChange");
  if (handler === null) return null;
  return callExpression(handler, "invalidateLiveAnswers(");
}

describe("CopilotClient reads the shared interview type", () => {
  it("imports the store hook itself from app/copilot/", () => {
    // useInterviewType (the read/write pair CopilotClient still uses directly
    // for interviewTypeLabel/setInterviewType) stayed in CLIENT; only the
    // CHANGE SUBSCRIPTION moved (next test).
    expect(CLIENT).toMatch(
      /import\s*\{[^}]*\buseInterviewType\b[^}]*\}\s*from\s*["']\.\/useInterviewType(?:\.js)?["']/,
    );
  });

  // wave 2: the change subscription itself moved into useTypeAnnouncements.js
  // along with the handler it feeds — so the import assertion now targets
  // HOOK, not CLIENT.
  it("HOOK imports the change subscription from app/copilot/", () => {
    expect(HOOK).toMatch(
      /import\s*\{[^}]*\buseInterviewTypeChange\b[^}]*\}\s*from\s*["']\.\/useInterviewType(?:\.js)?["']/,
    );
  });

  it("HOOK imports the live invalidation composer from lib/copilot/", () => {
    expect(HOOK).toMatch(
      /import\s*\{[^}]*\binvalidateLiveAnswers\b[^}]*\}\s*from\s*["']@\/lib\/copilot\/choiceChangeInvalidation(?:\.js)?["']/,
    );
  });

  it("HOOK registers a change subscription", () => {
    expect(HOOK).toMatch(/\buseInterviewTypeChange\s*\(/);
  });

  it("CopilotClient itself no longer imports or registers the subscription directly", () => {
    // Nothing here bans CLIENT from mentioning the NAME in a comment — this
    // guards against the extraction leaving a second, dead registration
    // behind rather than actually moving the only one.
    expect(CLIENT).not.toMatch(/\buseInterviewTypeChange\s*\(/);
    expect(CLIENT).toMatch(/from\s*["']\.\/useTypeAnnouncements(?:\.js)?["']/);
  });
});

describe("the live duty list runs off the STORE, on every origin (AC-A12)", () => {
  // wave 2: the subscriber itself (and everything below in this block) moved
  // to useTypeAnnouncements.js — read HOOK, not CLIENT, for all three.
  it("calls invalidateLiveAnswers INSIDE the change handler", () => {
    // Presence of the call anywhere in the file is not wiring. This is the
    // live-side twin of the practice mutant: both names imported, both
    // "called", and the interview type still does nothing.
    const handler = subscriptionHandler(HOOK, "useInterviewTypeChange");
    expect(handler).not.toBe(null);
    expect(handler).toMatch(/\binvalidateLiveAnswers\s*\(/);
  });

  it("hands it the cache clear and the generation bump", () => {
    // AC-A12: these two are NEVER gated on origin — that is the whole point
    // of the practice-tab -> live direction. `CopilotClient` stays mounted in
    // practice mode, so `answerCacheRef` and `draftGenRef` survive the mode
    // switch and would otherwise serve a stale-format cached answer.
    const args = invalidateLiveAnswersCall(HOOK);
    expect(args).not.toBe(null);
    expect(args).toMatch(/\bclearAnswerCache\b/);
    expect(args).toMatch(/\bbumpDraftGeneration\b/);
  });

  it("threads the origin from the handler's own argument, never a literal", () => {
    // A hardcoded origin makes AC-A15's billing gate unreachable: a
    // foreign-window change would fire a billed model call in every open
    // window, for a click the candidate is not even looking at.
    const handler = subscriptionHandler(HOOK, "useInterviewTypeChange");
    expect(handler).not.toMatch(/\borigin\s*:\s*["']/);
    expect(handler).toMatch(/[A-Za-z_$][\w$]*\s*\??\.\s*origin\b/);
  });
});

describe("the auto-redraft is gated, and the posting path cannot reach it (AC-A15)", () => {
  // wave 2: the change handler these three drive now lives in
  // useTypeAnnouncements.js — read HOOK. The posting-path negative below
  // stays on CLIENT: onPostingChange never moved.
  it("passes redraftCurrentAnswer, so the redraft is reachable at all", () => {
    // The positive control for the two negatives below. Without it, a
    // `CopilotClient` that simply never redrafts satisfies both.
    const args = invalidateLiveAnswersCall(HOOK);
    expect(args).not.toBe(null);
    expect(args).toMatch(/\bredraftCurrentAnswer\b/);
  });

  it("computes canRedraft rather than hardcoding it", () => {
    // Contract 3: `canRedraft = origin === "local" && mode === "live"`, kept a
    // plain boolean DELIBERATELY so AC-A15b's dependency requirement stays
    // visible at the registration site. A literal `true` fires a billed call
    // for a foreign-window change; a literal `false` ships the feature's most
    // visible half switched off, and nothing else in the suite would notice.
    const args = invalidateLiveAnswersCall(HOOK);
    expect(args).not.toBe(null);
    expect(args).toMatch(/\bcanRedraft\b/);
    expect(args).not.toMatch(/\bcanRedraft\s*:\s*(?:true|false)\b/);
    expect(args).toMatch(/\bmode\b/);
  });

  it("is not registered with an empty dependency array", () => {
    // AC-A15b, as far as source text honestly reaches. The gate is
    // render-scope state, so a handler closed over at mount freezes where the
    // session is not live and the auto-redraft is disabled FOREVER — the
    // failure mode that looks exactly like the feature simply not working.
    //
    // `react-hooks/exhaustive-deps` at this project's 0-warnings gate is the
    // real oracle and catches the general case; this catches only the literal
    // `[]`, which is the shape a hand-written subscription actually takes.
    const handler = subscriptionHandler(HOOK, "useInterviewTypeChange");
    expect(handler).not.toMatch(/,\s*\[\s*\]\s*\)/);
  });

  it("does not run the live duty list from the POSTING callback — the paired negative", () => {
    // The live side needs this stated more carefully than the practice side.
    // `onPostingChange` (`:188-192`) ALREADY clears the cache and bumps the
    // generation inline, and that is correct and pre-existing. What it must
    // never do is go through the interview type's composer or reach the
    // redraft: a posting change firing `redraftCurrentAnswer` is a billed
    // model call nobody asked for, and it is exactly how the practice mutant
    // shipped inert while green.
    const posting = declarationBody(CLIENT, "onPostingChange");
    expect(posting).not.toBe(null);
    expect(posting).not.toMatch(/\binvalidateLiveAnswers\s*\(/);
    expect(posting).not.toMatch(/\bredraftCurrentAnswer\b/);
  });
});

describe("CopilotClient does not reach for the practice-side composers", () => {
  it("calls none of them", () => {
    // Each would be wrong here for a different reason: `discardPracticeWork`
    // and `discardQuestionAndScoreWork` reset a question bank the live
    // surface does not own; `discardAnswerWork` and `discardDraftedAnswers`
    // are chunk C's seams. The live duty list is `invalidateLiveAnswers` and
    // nothing else.
    expect(CLIENT).not.toMatch(/\bdiscardPracticeWork\s*\(/);
    expect(CLIENT).not.toMatch(/\bdiscardQuestionAndScoreWork\s*\(/);
    expect(CLIENT).not.toMatch(/\bdiscardAnswerWork\s*\(/);
    expect(CLIENT).not.toMatch(/\bdiscardDraftedAnswers\s*\(/);
  });
});

// Step-6/9 verification, MATERIAL-1 / BLOCKER-1: CopilotClient is mounted in
// every mode and writes its own interview-type announcement with no `mode`
// gate, while PracticeClient writes its own into a second slot that
// CopilotClient joins alongside it. Each side's own suite
// (choiceChangeInvalidation.test.js, practiceInterviewTypeAnnouncement.test.js,
// this file's own assertions above) proves its half correct IN ISOLATION —
// none of them composes the two, which is why the defect shipped once (the
// announcement-callback seam earlier in this chunk), shipped again as
// MATERIAL-1, and shipped a THIRD time inside MATERIAL-1's own fix:
// `claimStorageAnnouncement` has exactly ONE call site in production — the
// practice-side wrapper (`onPracticeTypeAnnouncement`) — and the live path
// claims the shared latch inline, gated on `mode === "live"`, the same
// predicate `joinInterviewTypeAnnouncements` uses to decide whether that
// text is ever spoken. A test that called `claimStorageAnnouncement` from
// BOTH "sides" (as this file's own prior revision did) modelled a call
// production never makes and was green against that exact defect.
//
// So every case below either drives the REAL two-argument decision
// (`joinInterviewTypeAnnouncements`, exported from CopilotClient.js) or
// reproduces the live path's own inline claim condition ONLY to build the
// input the join receives — never as a second call to
// `claimStorageAnnouncement`, which stays practice-only. (An earlier
// revision of this fix moved both functions into useLiveSession.js to save
// budget; that broke CopilotClient.wiring.test.js/.roles.test.js/
// .downloadLog.test.js, which each `vi.mock("./useLiveSession")` wholesale
// with a factory that does not return these exports — reverted.)
describe("composing the two announcement sources (step-6/9 verification, MATERIAL-1/BLOCKER-1)", () => {
  it("the live path's own latch condition matches the join's own speak condition — both mode === \"live\"", () => {
    // This is what BLOCKER-1 actually was: the CLAIM and the JOIN disagreed
    // (`mode !== "roles"` vs `mode === "live"`). Pinning the literal
    // condition in the handler's own source is what stops that gap
    // reopening silently under a future edit to either side alone. Wave 2:
    // both the handler and the join it disagreed with now live in the SAME
    // file (useTypeAnnouncements.js) — read HOOK.
    const handler = subscriptionHandler(HOOK, "useInterviewTypeChange");
    expect(handler).toMatch(/announceBlocked\s*=\s*blocked\s*&&\s*mode\s*===\s*"live"\s*&&/);
  });

  it("claimStorageAnnouncement is called from exactly one place — the practice wrapper, never the live handler", () => {
    // Wave 2: the live handler AND the practice wrapper moved TOGETHER into
    // useTypeAnnouncements.js (splitting them would have separated two
    // things that read each other's ambient state — see the extraction's own
    // doc), so the "exactly one call site" property now applies to HOOK. The
    // stronger, still-true half of the original claim survives as its own
    // assertion: CLIENT doesn't call it AT ALL any more, because it no
    // longer even imports it.
    expect(CLIENT).not.toMatch(/\bclaimStorageAnnouncement\b/);
    const handler = subscriptionHandler(HOOK, "useInterviewTypeChange");
    expect(handler).not.toMatch(/\bclaimStorageAnnouncement\s*\(/);
    const callSites = HOOK.match(/\bclaimStorageAnnouncement\s*\(/g) || [];
    expect(callSites).toHaveLength(1);
  });

  it("on the practice tab, a foreign change speaks ONLY the practice sentence — not the live one too", async () => {
    const { joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    // The exact two strings ux-chunk-a.md §9.3's table gives for a foreign
    // change on each surface — both genuinely non-empty at the same tick,
    // because CopilotClient's own subscriber and PracticeClient's both fire
    // off the SAME store change.
    const liveForeignText =
      "Interview type changed to Technical / coding in another window. The answer on screen was drafted before the change.";
    const practiceForeignText =
      "Interview type changed to Technical / coding in another window. Your score average and drafted answers were cleared. The question on screen stays until you ask for the next one.";
    const spoken = joinInterviewTypeAnnouncements({
      mode: "practice",
      live: liveForeignText,
      practice: practiceForeignText,
      liveAmbientAtSet: "same|",
      practiceAmbientAtSet: "same|",
      cueText: "same",
      briefText: "",
    }).filter(Boolean);
    expect(spoken).toEqual([practiceForeignText]);
  });

  it("on the roles tab, neither surface's text is ever spoken", async () => {
    const { joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    const spoken = joinInterviewTypeAnnouncements({
      mode: "roles",
      live: "Interview type changed to Technical / coding in another window. The answer on screen was drafted before the change.",
      practice: "Interview type set to Technical / coding. Practice questions cleared.",
      liveAmbientAtSet: "same|",
      practiceAmbientAtSet: "same|",
      cueText: "same",
      briefText: "",
    }).filter(Boolean);
    expect(spoken).toEqual([]);
  });

  it("a stale sentence left over from a tab that is no longer showing is dropped, not re-announced", async () => {
    const { joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    const liveText = "Interview type set to General / mixed. Not saved. This browser is blocking stored settings.";
    const staleFromPracticeVisit = "Interview type set to General / mixed. Practice questions cleared.";
    const spoken = joinInterviewTypeAnnouncements({
      mode: "live",
      live: liveText,
      practice: staleFromPracticeVisit,
      liveAmbientAtSet: "same|",
      practiceAmbientAtSet: "same|",
      cueText: "same",
      briefText: "",
    }).filter(Boolean);
    expect(spoken).toEqual([liveText]);
  });

  // THE END-TO-END ASSERTION (step-9 ruling): a practice-tab user with
  // blocked storage hears the storage sentence EXACTLY ONCE and NEVER ZERO
  // TIMES — driven through the REAL production functions on both sides,
  // in BOTH call orders, because registration order (child mounts before
  // parent, but PracticeClient's subscriber re-registers on every
  // answering/settling/answerMetrics change) is not something either side
  // may rely on. `practiceInterviewTypeAnnouncement` is the exact pure
  // function usePracticeAnswer.js's `describeInterviewTypeChange` delegates
  // to, called with the exact args that hook passes — no latch state among
  // them, because the once-per-tab decision does not live on that side.
  it("a practice-tab user with blocked storage hears the storage sentence exactly once, in either call order", async () => {
    const { claimStorageAnnouncement, joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    const { practiceInterviewTypeAnnouncement } = await import(
      "@/lib/copilot/practiceInterviewTypeAnnouncement"
    );
    const { interviewTypeChangeAnnouncement } = await import("@/lib/copilot/choiceChangeInvalidation");
    const label = "Technical / coding";
    // The practice row WITH the clause appended — the clause composes onto
    // the row rather than replacing it, so what the change did to the
    // questions is still reported on the one change that carries the clause.
    const storageSentence = `Interview type set to ${label}. Practice questions cleared. Not saved. This browser is blocking stored settings.`;

    for (const order of ["live-first", "practice-first"]) {
      const sharedLatch = { current: false };
      const mode = "practice";

      // The LIVE path: gated inline on mode === "live" (never true here),
      // so it never claims and its own text carries no storage row.
      const liveAnnounceBlocked = false && mode === "live"; // mirrors: blocked && mode === "live" && !latch
      const buildLiveText = () =>
        interviewTypeChangeAnnouncement({
          surface: "live",
          origin: "local",
          label,
          hadRecording: false,
          hadReview: false,
          storageBlocked: liveAnnounceBlocked,
        });

      // The PRACTICE path: ALWAYS offers BOTH rows when blocked (the fix),
      // and the ONE shared latch at the join picks between them.
      const buildPracticeText = () =>
        claimStorageAnnouncement(
          practiceInterviewTypeAnnouncement({
            origin: "local",
            label,
            answering: false,
            settling: false,
            answerMetrics: null,
            blocked: true,
          }),
          sharedLatch,
        );

      const [liveText, practiceText] =
        order === "live-first"
          ? [buildLiveText(), buildPracticeText()]
          : (() => {
              const practiceText = buildPracticeText();
              const liveText = buildLiveText();
              return [liveText, practiceText];
            })();

      const spoken = joinInterviewTypeAnnouncements({
        mode,
        live: liveText,
        practice: practiceText,
        liveAmbientAtSet: "same|",
        practiceAmbientAtSet: "same|",
        cueText: "same",
        briefText: "",
      }).filter(Boolean);
      expect(spoken, `order=${order}`).toEqual([storageSentence]);
    }
  });

  // THE SECOND CHANGE — the case the manual-regression pass found and the
  // case nothing here composed. The test below this one pins a single claim
  // against a spent latch and is green against the defect, because a
  // one-shot claim can never reveal what the SECOND change says.
  //
  // Storage blocked (Safari private browsing, or quota), practice tab, and
  // the candidate changes the interview type twice. The first change spends
  // the latch. Before the fix the second was announced as `""` — including a
  // change that discarded an in-progress take, and a foreign change whose
  // wipe of the score average and every room draft nothing else reports
  // (`answerStatusMessage` returns `""` for the `idle` status
  // `invalidateDrafts` leaves behind).
  it("a SECOND change on a storage-blocked practice tab still speaks — the ordinary row, never \"\"", async () => {
    const { claimStorageAnnouncement } = await import("@/lib/copilot/choiceChangeInvalidation");
    const { practiceInterviewTypeAnnouncement } = await import(
      "@/lib/copilot/practiceInterviewTypeAnnouncement"
    );
    const sharedLatch = { current: false }; // fresh tab, nothing said yet

    // Driven through the real production pair, exactly as
    // usePracticeAnswer's describeInterviewTypeChange -> PracticeClient ->
    // CopilotClient's onPracticeTypeAnnouncement does it.
    const change = (label, extra = {}) =>
      claimStorageAnnouncement(
        practiceInterviewTypeAnnouncement({
          origin: "local",
          label,
          answering: false,
          settling: false,
          answerMetrics: null,
          blocked: true,
          ...extra,
        }),
        sharedLatch,
      );

    const first = change("Technical / coding");
    expect(first).toBe(
      "Interview type set to Technical / coding. Practice questions cleared. Not saved. This browser is blocking stored settings.",
    );
    expect(sharedLatch.current).toBe(true);

    // The second change had an answer being recorded, so it destroyed one.
    const second = change("Behavioral", { answering: true });
    expect(second).toBe(
      "Interview type set to Behavioral. Practice questions cleared and your recording was discarded.",
    );
    // The two assertions that fail against the defect, stated separately so
    // neither can be satisfied by an implementation that merely stopped
    // saying the clause.
    expect(second).not.toBe("");
    expect(second).not.toContain("blocking stored settings"); // said once per tab, not twice

    // And a THIRD, foreign this time: the wipe report survives too.
    const third = change("System design", { origin: "foreign" });
    expect(third).toBe(
      "Interview type changed to System design in another window. Your score average and drafted answers were cleared. The question on screen stays until you ask for the next one.",
    );

    // SILENCE HAZARD. React coalesces, so two consecutive announcements with
    // identical text produce no DOM change and the second is never spoken.
    // Every row carries its own label and `choiceStore` returns early on an
    // unchanged value, so consecutive changes cannot collide — asserted
    // rather than reasoned, because the fallback is new and this is exactly
    // the property a new fallback can quietly break.
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("a practice-tab claim against an already-spent latch falls back to the ordinary row", async () => {
    const { claimStorageAnnouncement } = await import("@/lib/copilot/choiceChangeInvalidation");
    const sharedLatch = { current: true }; // already spoken, by either surface
    const pair = {
      storage: "Interview type set to Technical / coding. Practice questions cleared. Not saved. This browser is blocking stored settings.",
      ordinary: "Interview type set to Technical / coding. Practice questions cleared.",
    };
    expect(claimStorageAnnouncement(pair, sharedLatch)).toBe(pair.ordinary);
  });

  it("a caller with only ONE sentence still collapses to \"\" against a spent latch", async () => {
    // The string shape is unchanged, deliberately: it means "I have nothing
    // else to say". Nothing in production uses it — the live surface gates
    // inline and never comes through here — but it is the shape
    // CopilotClient.js:417 would pass if a future caller handed up a bare
    // string, and silently speaking a spent clause would be worse.
    const { claimStorageAnnouncement } = await import("@/lib/copilot/choiceChangeInvalidation");
    const sentence = "Interview type set to Technical / coding. Not saved. This browser is blocking stored settings.";
    expect(claimStorageAnnouncement(sentence, { current: true })).toBe("");
    // Positive control: against a FREE latch the same string is spoken and
    // the latch is spent, so the `""` above is the latch and not the shape.
    const free = { current: false };
    expect(claimStorageAnnouncement(sentence, free)).toBe(sentence);
    expect(free.current).toBe(true);
  });

  it("a non-storage sentence is never touched by the latch", async () => {
    const { claimStorageAnnouncement } = await import("@/lib/copilot/choiceChangeInvalidation");
    const latch = { current: true }; // already spent — must not matter here
    const ordinary = "Interview type set to Technical / coding. Practice questions cleared.";
    expect(claimStorageAnnouncement(ordinary, latch)).toBe(ordinary);
  });
});

// Step-9c-iii, 2nd pass. The first attempt (LAYOUT effect + flushSync +
// no-deps-array sweeper) was gated: flushSync masked a real
// react-hooks/exhaustive-deps warning (this repo's bar is 0 errors AND 0
// warnings), the "already shown" check mutated state under a name that
// promised a pure question, and — the substantive bug — it cleared on
// EVERY subsequent render for ANY reason, including this file's own
// once-a-second session clock, which meant a sentence could be yanked off
// screen well before a screen reader finished it.
//
// This fix, per the coordinator's ruling, has NO effect, NO flushSync, and
// NO ref-based sweeper: `joinInterviewTypeAnnouncements` compares each
// slot's "ambient signature" (`${cueText}|${briefText}`) AT THE MOMENT it
// was set (stamped by the SAME change handler that is already the single
// writer of the announcement text) against the CURRENT signature, PURELY
// at render time. A render that changes neither cueText nor briefText
// — the clock tick that broke the first attempt — leaves the signature
// untouched and therefore never excludes anything. A render that DOES
// change one of them excludes the slot in the SAME commit that mutates the
// DOM for that reason, so the stale text and the new content never appear
// together, with no timing race to get wrong.
//
// Every case below drives the REAL exported function with plain data — no
// React needed at all, because the fix no longer depends on React's commit
// timing to behave correctly, which is itself the improvement over the
// gated attempt.
describe("the stale announcement is excluded once superseded, without truncating mid-read (step-9c-iii, 2nd pass)", () => {
  // makeLiveSurfaceWith (declared below this describe block) is a minimal,
  // faithful model of CopilotClient's own state machine for this one slot:
  // `changeType` is the change handler (single writer of both the text and
  // its ambient stamp, exactly as CopilotClient.js's onInterviewTypeChanged
  // does); `render` is the join, called fresh each time exactly as a
  // component body would.
  it("a type change announces; an unrelated cue update announces nothing new; a second type change announces its own text", async () => {
    const { joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    const surface = makeLiveSurfaceWith(joinInterviewTypeAnnouncements);

    surface.changeType("Interview type set to Technical / coding. Not saved.");
    expect(surface.render()).toBe("Interview type set to Technical / coding. Not saved.");

    // THE OBSERVABLE EFFECT: the region after the unrelated cue is the cue
    // ALONE — no trace of the type sentence, not "<type> <cue>".
    surface.setCue("Question held on screen.");
    expect(surface.render()).toBe("Question held on screen.");
    expect(surface.render()).not.toContain("Not saved");

    surface.changeType("Interview type set to General / mixed. Practice questions cleared.");
    expect(surface.render()).toBe(
      "Question held on screen. Interview type set to General / mixed. Practice questions cleared.",
    );
  });

  it("does not silently coalesce three genuinely distinct announcements into fewer than three DOM texts", async () => {
    // The silence hazard: React bails out on an unchanged string via
    // Object.is, so if this fix ever made two consecutive commits carry
    // identical text, the second would never reach the screen at all.
    const { joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    const surface = makeLiveSurfaceWith(joinInterviewTypeAnnouncements);
    const seen = [];
    surface.changeType("Interview type set to Technical / coding. Practice questions cleared.");
    seen.push(surface.render());
    surface.setCue("Question held on screen.");
    seen.push(surface.render());
    surface.setBrief("Researching Acme Corp.");
    seen.push(surface.render());

    expect(seen).toEqual([
      "Interview type set to Technical / coding. Practice questions cleared.",
      "Question held on screen.",
      "Question held on screen. Researching Acme Corp.",
    ]);
    expect(new Set(seen).size).toBe(3);
  });

  it("a render that changes NEITHER cueText nor briefText never excludes the announcement — no truncation risk from an unrelated tick", async () => {
    // This is exactly the failure the gated first attempt had: its sweeper
    // fired on literally every render, including one driven by nothing
    // more than the session's once-a-second clock, which touches neither
    // input this fix actually keys on.
    const { joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    const surface = makeLiveSurfaceWith(joinInterviewTypeAnnouncements);
    surface.changeType("Interview type set to Technical / coding. Not saved.");
    for (let i = 0; i < 5; i += 1) {
      expect(surface.render()).toBe("Interview type set to Technical / coding. Not saved.");
    }
  });

  it("a round trip back to the same mode with cue/brief unchanged the whole time does not resurrect the old sentence (MATERIAL-2)", async () => {
    // The one gap the ambient comparison alone cannot close (nothing about
    // the ambient signature differs on a same-mode round trip) — closed
    // instead by the explicit clear in onModeChange, a discrete,
    // user-initiated event rather than a frequent tick.
    const { joinInterviewTypeAnnouncements } = await import("@/lib/copilot/choiceChangeInvalidation");
    const surface = makeLiveSurfaceWith(joinInterviewTypeAnnouncements);
    surface.changeType("Interview type set to Technical / coding. Not saved.");
    expect(surface.render()).toContain("Not saved");
    surface.leaveAndReturnToLiveMode();
    expect(surface.render()).toBe("");
  });
});

// Used by every `it` in the describe block above; takes the REAL function
// as an argument (each `it` imports it fresh via dynamic import, matching
// this file's own convention elsewhere) rather than a module-level import
// this file's node/source-text half does not otherwise need.
function makeLiveSurfaceWith(joinInterviewTypeAnnouncements) {
  let cueText = "";
  let briefText = "";
  let typeAnnouncement = "";
  let typeAmbientAtSet = "";
  return {
    setCue: (text) => {
      cueText = text;
    },
    setBrief: (text) => {
      briefText = text;
    },
    changeType: (text) => {
      typeAnnouncement = text;
      typeAmbientAtSet = `${cueText}|${briefText}`;
    },
    leaveAndReturnToLiveMode: () => {
      typeAnnouncement = ""; // MATERIAL-2: onModeChange's explicit clear
    },
    render: () => {
      const [liveTypeText] = joinInterviewTypeAnnouncements({
        mode: "live",
        live: typeAnnouncement,
        practice: "",
        liveAmbientAtSet: typeAmbientAtSet,
        practiceAmbientAtSet: "",
        cueText,
        briefText,
      });
      return [cueText, briefText, liveTypeText].filter(Boolean).join(" ");
    },
  };
}

describe("CopilotClient.js's own mechanism matches the model above (step-9c-iii, 2nd pass)", () => {
  // wave 2: the whole mechanism (both change handlers, the ambient state,
  // the join) moved into useTypeAnnouncements.js. Every property below that
  // used to be checked against CLIENT's own source is now checked against
  // HOOK's; CLIENT keeps only the two seams that stayed behind — feeding the
  // hook the real cueAnnouncement.text/briefLiveText, and calling the reset
  // it hands back from onModeChange.
  it("HOOK stamps an ambient signature in both change handlers, with no effect/flushSync anywhere in either file", () => {
    expect(CLIENT).not.toMatch(/\buseLayoutEffect\b/);
    expect(CLIENT).not.toMatch(/\bflushSync\b/);
    expect(HOOK).not.toMatch(/\buseLayoutEffect\b/);
    expect(HOOK).not.toMatch(/\bflushSync\b/);
    // HOOK receives the ambient text as its OWN `cueText`/`briefText`
    // parameters (CLIENT's job, checked below, is handing it the real
    // `cueAnnouncement.text`/`briefLiveText` values under those names) — so
    // the stamp itself is keyed on the parameter names, not the outer
    // variables that no longer exist inside this file.
    //
    // Scoped to EACH handler's own extent, not "somewhere in HOOK" — both
    // stamp calls are textually identical (`cueText`/`briefText` are shared
    // params), so a bare file-wide match here would still pass with one of
    // the two calls deleted, because the other's identical text satisfies
    // the same regex. Found by mutating this file.
    const stamp = /setTypeAmbientAtSet\(`\$\{cueText\}\|\$\{briefText\}`\)/;
    const interviewTypeHandler = subscriptionHandler(HOOK, "useInterviewTypeChange");
    expect(interviewTypeHandler).toMatch(stamp);
    const codeLanguageConfig = callExpression(HOOK, "useLiveCodeLanguageChange(");
    expect(codeLanguageConfig).not.toBe(null);
    expect(codeLanguageConfig).toMatch(stamp);
    expect(HOOK).toMatch(/setPracticeAmbientAtSet\(`\$\{cueText\}\|\$\{briefText\}`\)/);
  });

  it("HOOK's live handler OWN deps include cueText and briefText — the stale-closure guard, and CLIENT feeds it the real values", () => {
    const handler = subscriptionHandler(HOOK, "useInterviewTypeChange");
    // Renamed from cueAnnouncement.text/briefLiveText to cueText/briefText —
    // an unavoidable consequence of parameterizing the hook (it has no
    // `cueAnnouncement` or `briefLiveText` of its own to close over) — but
    // the guard is the SAME one: a stale-closure defense on whichever
    // variables actually carry the live cue/brief text at the moment the
    // handler runs.
    expect(handler).toMatch(/\[\s*mode\s*,\s*redraftCurrentAnswer\s*,\s*cueText\s*,\s*briefText\s*\]/);
    // The other half of the guard: those parameters must actually BE
    // cueAnnouncement.text/briefLiveText, not some other stand-in — checked
    // at CLIENT's call site into the hook, which is the one place those two
    // real values still exist under their own names.
    const call = callExpression(CLIENT, "useTypeAnnouncements(");
    expect(call).not.toBe(null);
    expect(call).toMatch(/cueText:\s*cueAnnouncement\.text/);
    expect(call).toMatch(/briefText:\s*briefLiveText/);
  });

  it("onModeChange still triggers the explicit reset (MATERIAL-2's remaining half), and the reset itself clears both slots", () => {
    // Split in two by the move: CLIENT still owns the discrete,
    // user-initiated EVENT (leaving a mode with cue/brief unchanged, which
    // the ambient comparison alone can't catch); HOOK now owns what that
    // event actually clears.
    const modeChangeBody = declarationBody(CLIENT, "onModeChange");
    expect(modeChangeBody).not.toBe(null);
    expect(modeChangeBody).toMatch(/\bresetTypeAnnouncements\s*\(\s*\)/);
    const resetBody = declarationBody(HOOK, "resetTypeAnnouncements");
    expect(resetBody).not.toBe(null);
    expect(resetBody).toMatch(/setTypeAnnouncement\(""\)/);
    expect(resetBody).toMatch(/setPracticeTypeAnnouncement\(""\)/);
  });

  it("the join call site (inside HOOK) passes the ambient fields through to the real composer", () => {
    expect(HOOK).toMatch(/liveAmbientAtSet:\s*typeAmbientAtSet/);
    expect(HOOK).toMatch(/practiceAmbientAtSet/);
    expect(HOOK).toMatch(/cueText(?:,|\s*:\s*cueText)/);
    expect(HOOK).toMatch(/briefText(?:,|\s*:\s*briefText)/);
  });
});
