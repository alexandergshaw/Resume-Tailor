// node (this repo's default environment) — a SOURCE-TEXT test, deliberately.
//
// AC-A13b. `PracticeClient` cannot be rendered under test; its own comment
// says so at `PracticeClient.js:371` ("this component cannot be rendered under
// test, so a reordering inline would be unfalsifiable"). That is the same
// reasoning that put `submitPracticeQuestion` in `lib/copilot/manualQuestion.js`,
// and the same reasoning that puts the interview-type duty list in
// `lib/copilot/choiceChangeInvalidation.js`.
//
// Extracting the duty list makes the DUTIES testable and proves nothing about
// whether anyone calls them. A correct helper that is never wired is this
// repo's most common way to finish green and broken: the feature ships inert
// with a fully green suite. Here the property genuinely IS the shape of the
// source, which is the one case where reading it is the right instrument.
//
// Written BEFORE the implementation exists (step 4b), so these fail against
// today's `PracticeClient.js`, which still holds the invalidation sequence
// inline in `onInterviewTypeChange` (`:410-418`) and imports the store from
// `./useInterviewType`.
//
// TWO CONSTRAINTS ON THIS FILE ITSELF, both from prior instances in this
// codebase and both binding on whoever edits it next:
//   1. It must assert the CALLER calls it, not merely that the import exists.
//   2. When the property later moves to another module, AMEND these assertions
//      to name the module that now holds it. A module must never be left
//      carrying dead code to keep a source-text test green.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Path-based, not `fileURLToPath(new URL(rel, import.meta.url))`. This file
// runs under node where either works, but the jsdom files in this set proved
// the URL form throws there ("The URL must be of scheme file", because jsdom's
// global URL is not Node's), so the whole set uses the one idiom that works in
// both environments.
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");
const CLIENT = readSource("./PracticeClient.js");

// The body of a top-level `const <name> = useCallback(...)` declaration,
// bracket-balanced to the end of that call and NOT one character further.
//
// An earlier revision ran to the next `\n  const `, which overshot whenever the
// declaration was followed by anything else at top level — in the real file it
// swallowed the `useInterviewTypeChange(...)` registration that follows, so a
// "this callback no longer names the duties" assertion read the subscriber's
// duty list and failed against a CORRECT implementation. A test that rejects
// correct code is one a future implementer deletes.
function declarationBody(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start === -1) return null;
  const open = src.indexOf("(", start);
  if (open === -1) return src.slice(start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

// The full call expression starting at `marker`, by BALANCING brackets.
//
// Slicing to the first `)` is the trap this helper exists to avoid, and it has
// already bitten once here: in `usePracticeQuestions({ posting,
// onRequestFailed: () => {}, interviewType })` the first `)` is the one inside
// `() => {}`, so a naive slice ends before the argument under test is ever
// reached and the assertion is vacuously green. Parse the signature; never
// slice to a bracket.
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

// The body a subscription hook actually runs, whichever of the two legal
// shapes the caller used:
//
//   useInterviewTypeChange(useCallback((next, prev, meta) => { ... }, [deps]))
//   const onTypeChanged = useCallback(..., [deps]); useInterviewTypeChange(onTypeChanged);
//
// Resolving a bare identifier back to its declaration is what stops this file
// FAILING A CORRECT IMPLEMENTATION that hoists its handler. §C.2/§C.3 require
// a stable `useCallback` and say nothing about whether it is inlined at the
// registration site, so both shapes are legal and both must be readable here.
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

// Line comments only — enough that prose naming a retired parameter cannot
// fail an assertion about the parameter itself.
const stripLineComments = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

describe("PracticeClient imports the shared store from its new home", () => {
  it("imports useInterviewType from app/copilot/, not from practice/", () => {
    // The store moves up a directory so both surfaces share one instance;
    // `practice/useInterviewType.js` is deleted with no re-export shim, because
    // a shim keeps the module map lying and breaks the single-writer invariant.
    expect(CLIENT).toMatch(
      /import\s*\{[^}]*\buseInterviewType\b[^}]*\}\s*from\s*["']\.\.\/useInterviewType(?:\.js)?["']/,
    );
    expect(CLIENT).not.toMatch(/from\s*["']\.\/useInterviewType(?:\.js)?["']/);
  });
});

describe("PracticeClient WIRES the change subscription (AC-A13b)", () => {
  it("imports the change-subscription hook", () => {
    expect(CLIENT).toMatch(
      /import\s*\{[^}]*\buseInterviewTypeChange\b[^}]*\}\s*from\s*["']\.\.\/useInterviewType(?:\.js)?["']/,
    );
  });

  it("actually CALLS it — an import alone ships the feature inert", () => {
    expect(CLIENT).toMatch(/\buseInterviewTypeChange\s*\(/);
  });

  it("imports the shared duty composer from lib/copilot/", () => {
    expect(CLIENT).toMatch(
      /import\s*\{[^}]*\bdiscardPracticeWork\b[^}]*\}\s*from\s*["']@\/lib\/copilot\/choiceChangeInvalidation(?:\.js)?["']/,
    );
  });

  it("runs the duty list INSIDE the change handler, not merely somewhere in the file", () => {
    // The presence of a call is not wiring. A file that imports both names,
    // hands `useInterviewTypeChange` an empty handler, and invokes
    // `discardPracticeWork` from `onPostingChange` satisfies every
    // "imports and calls" assertion while the interview type does NOTHING —
    // and changing the posting silently clears the score average instead.
    // That is verbatim the failure AC-A13b exists to prevent, so the call has
    // to be scoped to the subscription it belongs to.
    const subscriber = subscriptionHandler(CLIENT, "useInterviewTypeChange");
    expect(subscriber).not.toBe(null);
    expect(subscriber).toMatch(/\bdiscardPracticeWork\s*\(/);
  });

  it("does not run the duty list from the POSTING callback — the paired negative", () => {
    // Same mutant, from the other side: without this, moving the call into
    // `onPostingChange` and ALSO leaving one in the subscriber would pass the
    // case above while a posting change wrongly discards practice work.
    const posting = declarationBody(CLIENT, "onPostingChange");
    expect(posting).not.toBe(null);
    expect(posting).not.toMatch(/\bdiscardPracticeWork\s*\(/);
  });

  it("threads the origin from the handler's own argument, never a literal", () => {
    // A hardcoded `origin: "local"` makes AC-A11's whole three-valued split
    // unreachable: a foreign-window change would run the destructive local
    // duty list, abandoning an in-progress recording and revoking a finished
    // take's replay. The store hands the origin to the handler; it must be
    // forwarded, not re-asserted.
    const subscriber = subscriptionHandler(CLIENT, "useInterviewTypeChange");
    const args = callExpression(subscriber, "discardPracticeWork(");
    expect(args).not.toBe(null);
    expect(args).not.toMatch(/\borigin\s*:\s*["']/);
    expect(args).toMatch(/\borigin\s*:\s*[A-Za-z_$][\w$]*\s*\??\.\s*origin\b/);
  });

  it("hands the composer the room-draft invalidator (AC-A21b)", () => {
    // Omitting one callback from the bag is the same defect class as wiring
    // the composer to the wrong trigger: the composer is correct, the duty
    // silently never runs, and every pure test of the composer stays green.
    // Scoped to the CALL, not the handler: a stable `useCallback`'s dependency
    // array sits inside the handler's own extent, so a callback mentioned only
    // there would satisfy a handler-wide match while the bag omitted it.
    const subscriber = subscriptionHandler(CLIENT, "useInterviewTypeChange");
    const args = callExpression(subscriber, "discardPracticeWork(");
    expect(args).not.toBe(null);
    expect(args).toMatch(/\binvalidateRoomDrafts\b/);
    expect(args).toMatch(/\bclearSessionScores\b/);
    expect(args).toMatch(/\bmarkQuestionsStale/);
  });

  it("calls the FULL composer, never the answer-side subset on its own", () => {
    // `discardAnswerWork` exists for chunk C's language control (FD-2). Called
    // from here it would silently stop a type change from invalidating the
    // question bank and the session score average. `discardDraftedAnswers`,
    // narrower still, would additionally stop it clearing the answer state.
    expect(CLIENT).not.toMatch(/\bdiscardAnswerWork\s*\(/);
    expect(CLIENT).not.toMatch(/\bdiscardDraftedAnswers\s*\(/);
  });
});

describe("PracticeClient calls onInterviewTypeAnnouncement with a BUILT value (contract 7)", () => {
  // Caught in review, not by this file: CopilotClient.js passes
  // onInterviewTypeAnnouncement={setPracticeTypeAnnouncement}, and
  // PracticeClient never destructured or called it — every assertion above
  // was green throughout, because none of them look at this prop at all. A
  // presence check alone ("the prop is destructured") would NOT have caught
  // it either: an implementation that accepts the prop and never calls it
  // satisfies a presence check while shipping the announcement completely
  // inert. So this checks the OBSERVABLE EFFECT — that the subscriber
  // actually calls it, with a value built from a function call rather than a
  // literal or nothing — the same "positive control + negative control"
  // shape as the discardPracticeWork checks above.

  it("accepts onInterviewTypeAnnouncement as a prop", () => {
    // Positive control for the calls below: without this, the component
    // could not reference the name at all.
    expect(CLIENT).toMatch(/\bonInterviewTypeAnnouncement\b/);
  });

  it("calls it from INSIDE the change subscriber, with a value built by a function call — never a literal, never nothing", () => {
    const subscriber = subscriptionHandler(CLIENT, "useInterviewTypeChange");
    expect(subscriber).not.toBe(null);
    expect(subscriber).toMatch(/\bonInterviewTypeAnnouncement\s*\(/);

    const args = callExpression(subscriber, "onInterviewTypeAnnouncement(");
    expect(args).not.toBe(null);
    // Not a hardcoded string and not an empty call — either would satisfy
    // "the callback is called" while still shipping a useless or blank
    // announcement, which is the same class of inertness as never calling
    // it at all.
    expect(args).not.toMatch(/onInterviewTypeAnnouncement\(\s*["']/);
    expect(args).not.toMatch(/onInterviewTypeAnnouncement\(\s*\)/);
    expect(args).toMatch(/onInterviewTypeAnnouncement\(\s*[A-Za-z_$][\w$]*\s*\(/);
  });

  it("does not call it from the POSTING callback — the paired negative", () => {
    const posting = declarationBody(CLIENT, "onPostingChange");
    expect(posting).not.toBe(null);
    expect(posting).not.toMatch(/\bonInterviewTypeAnnouncement\s*\(/);
  });

  it("is hard-called, never with '?.' — a missing wire must throw, not go silently inert", () => {
    // '?.()' is exactly how a wiring bug like this one survives: it turns a
    // loud crash on a missing prop into a silent no-op indistinguishable
    // from "nothing needed announcing this time".
    expect(CLIENT).not.toMatch(/onInterviewTypeAnnouncement\s*\?\.\s*\(/);
  });
});

describe("the old inline invalidation sequence is GONE from onInterviewTypeChange", () => {
  it("still has the callback — PracticeSetup passes it to the picker's onChange", () => {
    const body = declarationBody(CLIENT, "onInterviewTypeChange");
    expect(body).not.toBe(null);
    // Positive control for the extraction below: without this, deleting the
    // callback entirely would satisfy every "no longer contains" assertion
    // while breaking the control it is wired to.
    expect(body).toMatch(/\bsetInterviewType\s*\(/);
  });

  it("no longer performs the duty list itself", () => {
    // The sequence moves onto the store subscription (AC-A13), so a change
    // arriving from the OTHER tab or another window runs it too. Left here, it
    // fires only for this tab's own picker — and it cannot express the origin
    // split at all, because it never learns where the change came from.
    //
    // Matched WITHOUT the `()` — pinning the zero-argument spelling pins
    // today's syntax, not the property, and is satisfied by keeping the whole
    // inline list and giving each call an argument. There is no legitimate
    // reason for any of these three names to appear in this callback at all,
    // so the name alone is the assertion.
    const body = declarationBody(CLIENT, "onInterviewTypeChange");
    expect(body).not.toMatch(/\bresetQuestions\b/);
    expect(body).not.toMatch(/\babandonInProgressAnswer\b/);
    expect(body).not.toMatch(/\bresetAnswerState\b/);
    expect(body).not.toMatch(/\bclearSessionScores\b/);
    expect(body).not.toMatch(/\bmarkQuestionsStale/);
    expect(body).not.toMatch(/\binvalidateRoomDrafts\b/);
  });
});

describe("PracticeClient no longer passes the interview type down as a value", () => {
  it("stops handing usePracticeQuestions an interviewType argument (AC-A20b)", () => {
    // `usePracticeQuestions.js:58`'s `interviewTypeRef` is retired rather than
    // left in place: a render-mirrored ref cannot be current inside a
    // synchronous change listener, and this chunk moves practice invalidation
    // into exactly such a listener.
    const args = callExpression(CLIENT, "usePracticeQuestions(");
    expect(args).not.toBe(null);
    // Bracket-balanced, not sliced to the first `)`. The multi-line form
    // `usePracticeQuestions({ posting, onRequestFailed: () => {},
    // interviewType })` closes an inner `)` first, and a sliced assertion
    // never reaches the argument it exists to forbid.
    expect(stripLineComments(args)).not.toMatch(/\binterviewType\b/);
  });
});

describe("clearSessionScores is ADDITIVE, never folded into resetAnswerState (AC-A11b)", () => {
  // `usePracticeAnswer.js` is this same wave's file (plan row M8), so reading
  // it here couples nothing across waves — W3-practice owns both the hook and
  // this test.
  //
  // Why source text rather than a render: `usePracticeAnswer` is an 864-line
  // hook over the capture pipeline, the critique route and the recorder, and
  // it has no test file of its own in the plan. The ONE property that most
  // needs protecting is structural anyway — that the score clear is a new
  // export and not new behaviour inside an existing one — and that is exactly
  // the shape of the source.
  const ANSWER = readSource("./usePracticeAnswer.js");

  it("exposes clearSessionScores, and it clears the score map", () => {
    // The positive control for the negative below: without it, deleting
    // `setQuestionScores` from the hook entirely would satisfy the negative.
    const body = declarationBody(ANSWER, "clearSessionScores");
    expect(body).not.toBe(null);
    expect(body).toMatch(/\bsetQuestionScores\s*\(/);
  });

  it("resetAnswerState does not touch the score map", () => {
    // AC-A11b is explicit that the fix is a NEW export. `roles/useRoleAnswer.js`
    // imports this same hook and must be unaffected (AC-A28), and
    // `resetAnswerState` has four other `PracticeClient` call sites — "Next
    // question", "Try again" and two more — so folding the clear into it would
    // wipe the running session average on every one of them.
    const body = declarationBody(ANSWER, "resetAnswerState");
    expect(body).not.toBe(null);
    expect(body).not.toMatch(/\bsetQuestionScores\b/);
  });

  it("is returned by the hook, not merely defined inside it", () => {
    // A callback the caller cannot reach is the same defect as a helper
    // nobody calls: correct, tested, and inert.
    const returned = ANSWER.slice(ANSWER.lastIndexOf("return {"));
    expect(returned).toMatch(/\bclearSessionScores\b/);
  });
});
