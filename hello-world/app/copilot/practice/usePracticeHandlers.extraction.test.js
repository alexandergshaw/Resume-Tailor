// node (this repo's default environment) — a SOURCE-TEXT test, deliberately,
// for the reason CopilotClient.extraction.test.js and
// SessionControls.extraction.test.js each give in their own headers: the
// property under test IS the shape of the source — which module owns the
// handlers, whether the caller still carries a copy, and where in the call
// order the replacement sits. None of that is observable from rendered output.
//
// app/copilot/practice/usePracticeHandlers.js is a LINE-BUDGET EXTRACTION out
// of app/copilot/practice/PracticeClient.js, the same move usePracticeAnswer.js,
// usePracticeQuestions.js, usePracticeCaptureSession.js and
// usePracticeAnswerActions.js each already record.
//
// ---------------------------------------------------------------------------
// THE GAP THIS FILE CLOSES, WHICH IS NOT THE EXTRACTION
// ---------------------------------------------------------------------------
// PracticeClient.js sat at 999 lines against this repo's 1000-line convention
// with that convention enforced NOWHERE for this file. Measured before the
// move, all three rosters that look like they might cover it do not:
//
//   - lib/drive/lineCeiling.test.js's CAPPED_AT_1000 lists two files, both in
//     app/components/, neither of them this one.
//   - roles/RoleDrillClient.recording.test.js's five-file list names
//     CopilotClient.js and usePracticeCaptureSession.js — not PracticeClient.js.
//   - roles/RoleDrillClient.contract.test.js sweeps app/copilot/roles/ only.
//
// So the convention was referenced in half a dozen comments and executable in
// none of them for this file, and it PASSED at 1001 lines. Two changes in a row
// then had to budget lines instead of writing code: the sub-bullets mount hit
// 1001 and was squeezed back by rewrapping a comment, and the glossary provider
// mount hit 1002 and had its comment cut to three words to fit. The ceiling
// below is the point of this file as much as the extraction is.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// The measure PracticeClient.js's own convention is stated in, and NOT the one
// `grep -c` reports — grep counts newlines and reads exactly one lower on a
// file with a trailing newline, which is how "999" and "1000" can both be true
// of the same file depending on who is asking.
const lines = (src) => src.split("\n").length;

// F11, byte-for-byte the helper CopilotClient.extraction.test.js:31-35 uses: a
// raw line count is the one metric COMMENTS inflate, so it is useless as a
// floor on an extracted module. A ten-line hook under a sixty-line banner
// passes a raw count and is still a stub.
const codeLines = (src) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")).length;

// Prose that NAMES a symbol is not a call site. Both modules here carry
// comments naming the very handlers under test — PracticeClient.js's JSX still
// explains `submitPracticeQuestion` in a block comment, and its own mount
// comment names onNextQuestion — so every claim below reads the source with
// comments removed. Whole-line `//` and block comments only; a mid-line strip
// would truncate any line holding a URL.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CLIENT = read("./PracticeClient.js");
const HANDLERS = read("./usePracticeHandlers.js");
const CLIENT_CODE = stripComments(CLIENT);
const HANDLERS_CODE = stripComments(HANDLERS);

describe("PracticeClient.js has an executable ceiling at last", () => {
  // 903 after this extraction. 950 is the same cap CopilotClient.js carries at
  // CopilotClient.extraction.test.js:48-50 — practice mode's live-mode sibling,
  // the file this one is most often changed alongside — so the two modes are
  // held to one number rather than two arbitrary ones. Under the project's 1000
  // with genuine headroom, and reachable only because the extraction below
  // actually moved code out.
  //
  // DO NOT raise this constant to make room for a change. That is the failure
  // CopilotClient.extraction.test.js's F1 note records paying for once: its cap
  // was set to the post-extraction figure, became unsatisfiable the moment real
  // wiring landed, and could then only be satisfied by deleting comments.
  // Extract the next seam instead — usePracticeHandlers.js's header names why
  // the seam matters more than the size.
  it("is at most 950 lines", () => {
    expect(lines(CLIENT)).toBeLessThanOrEqual(950);
  });

  it("[control] the line counter is the one the convention is stated in", () => {
    // Guards the measure itself, not the file: a counter off by one is how a
    // 1000-line file reports 999 and passes a `< 1000` gate. Two literals with
    // and without a trailing newline pin both directions.
    expect(lines("a\nb\nc")).toBe(3);
    expect(lines("a\nb\nc\n")).toBe(4);
  });
});

describe("the question/posting/type handlers moved to usePracticeHandlers.js", () => {
  it("[control] stripping comments leaves real code behind, in both files", () => {
    // Without this, every `not.toMatch` ban below is satisfied by a stripper
    // that returned "" — the vacuity failure this repo's other source tests
    // each pin in their own way.
    expect(CLIENT_CODE).toMatch(/export default function PracticeClient\(/);
    expect(HANDLERS_CODE).toMatch(/export function usePracticeHandlers\(/);
    // ...and that it really removes the comment occurrences the bans below
    // would otherwise trip on, rather than being an identity function. Both of
    // these are real: PracticeClient.js still explains submitPracticeQuestion
    // in a JSX block comment, and still names onNextQuestion in the mount
    // comment for usePracticeAnswerActions.
    expect(CLIENT).toMatch(/submitPracticeQuestion/); // present, in a JSX comment
    expect(CLIENT_CODE).not.toMatch(/submitPracticeQuestion/); // ...and only there
  });

  it("exists and is not a stub", () => {
    // A token extraction that moved one callback out would pass a bare "the
    // file exists" check. The moved run is six callbacks and a subscription.
    expect(codeLines(HANDLERS)).toBeGreaterThan(60);
  });

  it("owns every handler that used to sit in the caller", () => {
    for (const name of [
      "onNextQuestion",
      "onRetryQuestion",
      "onManualQuestion",
      "onPostingChange",
      "onInterviewTypeChange",
      "onInterviewTypeChangeSubscriber",
    ]) {
      expect(HANDLERS_CODE, `${name} did not move`).toMatch(new RegExp(`const ${name} = useCallback`));
    }
    // The subscription itself, not just the callback it takes: registering it
    // is the half that makes another window's `storage` event run the duty
    // list, and a move that left the callback behind would look complete.
    expect(HANDLERS_CODE).toMatch(/useInterviewTypeChange\(onInterviewTypeChangeSubscriber\)/);
  });

  it("returns the five the caller renders, and NOT the internal subscriber", () => {
    // onInterviewTypeChangeSubscriber is consumed inside this module by
    // useInterviewTypeChange. Returning it too would invite a second
    // registration at the call site — the duty list running twice for one
    // change, which is the exact defect the caller's own comment on
    // onInterviewTypeChange says collapsing it to just the write prevents.
    const ret = HANDLERS_CODE.match(/return \{[^}]*\}/);
    expect(ret, "no return statement found").toBeTruthy();
    expect(ret[0]).toMatch(/onNextQuestion/);
    expect(ret[0]).toMatch(/onRetryQuestion/);
    expect(ret[0]).toMatch(/onManualQuestion/);
    expect(ret[0]).toMatch(/onPostingChange/);
    expect(ret[0]).toMatch(/onInterviewTypeChange\b/);
    expect(ret[0]).not.toMatch(/onInterviewTypeChangeSubscriber/);
  });

  it("the caller imports and calls it, and no longer holds the handlers itself", () => {
    expect(CLIENT_CODE).toMatch(/import \{ usePracticeHandlers \} from "\.\/usePracticeHandlers"/);
    expect(CLIENT_CODE).toMatch(/usePracticeHandlers\(\{/);
    // The bans. Each names something the old block could not exist without and
    // that nothing else in PracticeClient.js legitimately needs, so a leftover
    // copy — or a duplicate — turns this red.
    expect(CLIENT_CODE).not.toMatch(/const onNextQuestion = useCallback/);
    expect(CLIENT_CODE).not.toMatch(/const onPostingChange = useCallback/);
    expect(CLIENT_CODE).not.toMatch(/const onInterviewTypeChangeSubscriber = useCallback/);
    expect(CLIENT_CODE).not.toMatch(/useInterviewTypeChange\(/);
    expect(CLIENT_CODE).not.toMatch(/submitPracticeQuestion\(/);
    expect(CLIENT_CODE).not.toMatch(/discardPracticeWork\(/);
    // The imports the moved code was the only user of must go with it —
    // otherwise the extraction leaves the caller paying for a module it no
    // longer calls, and the next reader cannot tell the move was complete.
    expect(CLIENT_CODE).not.toMatch(/import \{ submitPracticeQuestion \}/);
    expect(CLIENT_CODE).not.toMatch(/import \{ discardPracticeWork \}/);
    expect(CLIENT_CODE).toMatch(/import \{ useInterviewType \} from "\.\.\/useInterviewType"/);
  });
});

describe("HOOK CALL ORDER — the load-bearing property of a React extraction", () => {
  // React identifies hooks by call INDEX, so an extraction that moves a hook
  // relative to another is a behaviour change dressed as a relocation. This
  // move is safe for one reason only: the six useCallbacks and the
  // useInterviewTypeChange subscription were a CONTIGUOUS run, and the hook
  // that now contains them is called at exactly the point that run began.
  it("the call site sits between the same two neighbours the moved run did", () => {
    const before = CLIENT_CODE.indexOf("useLastSampleAt(useCopilotDashboard())");
    const call = CLIENT_CODE.indexOf("usePracticeHandlers({");
    const after = CLIENT_CODE.indexOf("usePracticeCaptureSession({");
    expect(before, "the preceding neighbour is gone").toBeGreaterThan(-1);
    expect(call, "the call site is gone").toBeGreaterThan(-1);
    expect(after, "the following neighbour is gone").toBeGreaterThan(-1);
    expect(before).toBeLessThan(call);
    expect(call).toBeLessThan(after);
  });

  it("calls its own hooks in the order the caller called them", () => {
    // Order WITHIN the extracted module matters just as much: the run is
    // flattened back into the caller's sequence at render time, so a module
    // that reordered its own callbacks would shift every index after it.
    const order = [...HANDLERS_CODE.matchAll(/const (on\w+) = useCallback/g)].map((m) => m[1]);
    expect(order).toEqual([
      "onNextQuestion",
      "onRetryQuestion",
      "onManualQuestion",
      "onPostingChange",
      "onInterviewTypeChange",
      "onInterviewTypeChangeSubscriber",
    ]);
    // ...and the subscription stays LAST, after the callback it registers.
    expect(HANDLERS_CODE.indexOf("useInterviewTypeChange(onInterviewTypeChangeSubscriber)")).toBeGreaterThan(
      HANDLERS_CODE.indexOf("const onInterviewTypeChangeSubscriber"),
    );
  });

  it("moved every hook it took, and left none of them behind", () => {
    // A count, not a spot-check: six useCallback calls and one subscription
    // left the caller, so the caller's own hook count must have dropped by
    // exactly that much in this seam. Counting the two sides separately is
    // what catches a callback that was copied rather than moved.
    const callbacksHere = (HANDLERS_CODE.match(/useCallback\(/g) || []).length;
    expect(callbacksHere).toBe(6);
    // PracticeClient keeps exactly two of its own: onToggleSaveEnabled and the
    // combined resetForSession. If a later change adds one, AMEND this with
    // the reason rather than deleting it.
    const callbacksThere = (CLIENT_CODE.match(/useCallback\(/g) || []).length;
    expect(callbacksThere).toBe(2);
  });
});

describe("the extraction is WIRED, not merely mounted", () => {
  // `usePracticeHandlers({})` type-checks, returns five perfectly good
  // undefineds, and renders a screen whose every button is silently dead. Each
  // assertion below names an argument whose loss is invisible in a screenshot.
  const callIdx = CLIENT_CODE.indexOf("usePracticeHandlers({");
  const call = CLIENT_CODE.slice(callIdx, CLIENT_CODE.indexOf("});", callIdx));

  it("hands over the real question-flow functions, not placeholders", () => {
    for (const arg of [
      "advanceAsked",
      "requestQuestion",
      "retryFetch",
      "resetQuestions",
      "markQuestionsStaleForNewFormat",
      "setManualQuestion",
      "currentQuestionRef",
    ]) {
      expect(call, `${arg} is not wired`).toMatch(new RegExp(`\\b${arg},`));
    }
  });

  it("hands over the answer-flow functions and the room-question hook whole", () => {
    for (const arg of [
      "abandonInProgressAnswer",
      "resetAnswerState",
      "clearSessionScores",
      "describeInterviewTypeChange",
      "roomQuestions",
    ]) {
      expect(call, `${arg} is not wired`).toMatch(new RegExp(`\\b${arg},`));
    }
    // Whole, not destructured: the moved dependency arrays read
    // `roomQuestions.addManualQuestion` and `roomQuestions.invalidateDrafts`,
    // and passing the two members separately would have rewritten them.
    expect(HANDLERS_CODE).toMatch(/roomQuestions\.addManualQuestion/);
    expect(HANDLERS_CODE).toMatch(/roomQuestions\.invalidateDrafts/);
  });

  it("hands over the setters and the two shared refs BY REFERENCE", () => {
    expect(call).toMatch(/\bsetPosting,/);
    expect(call).toMatch(/\bsetInterviewType,/);
    expect(call).toMatch(/\barmedRef,/);
    expect(call).toMatch(/\barmedFromRef,/);
    // `.current` at the call site would pass a snapshot taken during render,
    // which is exactly the bug passing a ref exists to avoid — the arming
    // machinery in usePracticeAnswerActions would then never see what
    // onNextQuestion wrote.
    expect(call).not.toMatch(/armedRef\.current/);
    expect(call).not.toMatch(/armedFromRef\.current/);
    // Contract 7: hard-called with no `?.` inside the moved code, so a missing
    // wire must throw rather than go inert.
    expect(call).toMatch(/\bonInterviewTypeAnnouncement,/);
  });

  it("[control] the call slice really is the call, not the whole file", () => {
    // Without this, the three runs above degrade to whole-file substring
    // checks, which every one of them would pass with the arguments scattered
    // anywhere in the component.
    expect(call.startsWith("usePracticeHandlers({")).toBe(true);
    expect(call.length).toBeLessThan(700);
    expect(call).not.toMatch(/usePracticeCaptureSession/);
    expect(call).not.toMatch(/usePracticeAnswerActions/);
  });
});

describe("nothing was lost on the way out", () => {
  // The union of the caller and the new module must still carry the sentences
  // whose loss would cost the next reader a re-derivation of a real defect —
  // the same discipline CopilotClient.extraction.test.js applies to its own
  // three extractions. Each of these explains a decision that looks arbitrary
  // and is not.
  const union = [CLIENT, HANDLERS].join("\n");

  const mustSurvive = [
    // Why onNextQuestion arms BEFORE the fetch rather than after.
    "arms auto-start BEFORE the fetch",
    // Why a typed question deliberately does NOT arm the recorder.
    "the user's hands are on the keyboard",
    // Why the picker's own handler is collapsed to just the store write.
    // (Short: the sentence wraps mid-phrase in the source, and a fragment that
    // spans the wrap is never a substring of the file.)
    "duty list would run twice",
    // Why the subscriber forwards the store's origin instead of a literal.
    "NEVER a literal",
    // Why the announcement pair is forwarded whole and never unwrapped here.
    "Forwarded whole and never unwrapped here",
    // Why the statement order inside onNextQuestion is not free to change.
    "run BETWEEN computing",
  ];

  for (const fragment of mustSurvive) {
    it(`still explains: ${fragment}`, () => {
      expect(union).toContain(fragment);
    });
  }
});
