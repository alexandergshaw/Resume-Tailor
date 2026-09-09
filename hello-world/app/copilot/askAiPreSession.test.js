// @vitest-environment jsdom
//
// ARCH-ask-ai, pre-session mount. The ask-AI box shipped as a CHILD of
// StickyQuestionStrip, and both session clients gate that strip on their own
// `mountStrip` predicate (a question, a held question, or a live session with
// a measured reading). Every one of those reasons requires a session to have
// already started, so the box did not exist at all in the state a candidate
// most wants it in: the minutes BEFORE the interview, when they are preparing
// rather than mid-answer. AskAiBox.test.js pinned that as a named limitation;
// this file is the proof it is closed.
//
// TWO INSTRUMENTS, because the two clients do not admit the same one:
//
//   A. CopilotClient is RENDERED FOR REAL (react-dom/client, the same mock set
//      CopilotClient.wiring.test.js established for this suite). That is the
//      only instrument that can see a composition defect — a correct AskAiBox
//      mounted with the wrong props, or mounted twice — and it is also the
//      only way to prove the claim that actually decides whether this feature
//      works at all: that `applicationId` is really available before a session
//      starts. It is asserted here by SELECTING A POSTING AND WATCHING THE
//      REQUEST, not by reading the source, because a source-text check cannot
//      tell `applicationId={posting?.id}` wired from present-but-undefined.
//
//   B. PracticeClient is checked as SOURCE TEXT. That is this repo's standing
//      ruling for that component, not a shortcut taken here —
//      PracticeClient.interviewTypeWiring.test.js opens by quoting
//      PracticeClient.js's own comment that it "cannot be rendered under
//      test", and it sits on top of sixteen hooks over the recorder, the
//      capture session, the critique route and the question bank. The
//      property under test IS the shape of the source (which branch of which
//      ternary an element sits in), which is the one case where reading it is
//      the right tool — and every assertion below is paired with [control]
//      runs against deliberately broken sources, so a check that stopped
//      checking anything fails here rather than going quietly vacuous.
//
// jsdom has NO layout: `getBoundingClientRect()` returns zeroes. Nothing in
// this file measures geometry, and it must not start — the strip's height
// budget is a browser check (see AskAiBox.js's own header for the measured
// numbers). What is asserted here is PRESENCE and COUNT, both of which jsdom
// answers honestly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Path-based rather than `fileURLToPath(new URL(rel, import.meta.url))`: under
// jsdom the global URL is jsdom's, not Node's, and the URL form throws "The
// URL must be of scheme file" there. Same idiom the practice suite settled on.
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");
const LIVE_SOURCE = readSource("./CopilotClient.js");
const PRACTICE_SOURCE = readSource("./practice/PracticeClient.js");

// The accessible name AskAiBox gives its field, verbatim. Used as the instance
// counter throughout this file: it is a real `<label for>` (AskAiBox carries no
// `aria-label` at all — StickyQuestionStrip.test.js's AC-31 case forbids one
// inside the strip), it is unique on the page, and it is already covered by
// AskAiBox.test.js's own naming case, so counting it cannot drift away from
// what a screen-reader user actually finds.
const ASK_LABEL = "Ask AI about this application";

const FAKE_POSTING = {
  id: "posting-1",
  title: "Backend Engineer",
  company: "Acme Corp",
  description: "Build a billing platform.",
  url: "",
};

// ---------------------------------------------------------------------------
// The CopilotClient.wiring.test.js mock set, unchanged: every hook that would
// fire a network request is mocked to a static return, and every child that has
// nothing to do with what is under test here is stubbed to `() => null`.
// StickyQuestionStrip and AskAiBox are deliberately left REAL — stubbing either
// would make this file prove nothing about whether the box is on screen.
// ---------------------------------------------------------------------------
vi.mock("./practice/PracticeClient", () => ({ default: () => null }));
vi.mock("./LiveHearingStrip", () => ({ default: () => null }));
vi.mock("./ManualQuestion", () => ({ default: () => null }));
vi.mock("./StatusPill", () => ({ default: () => null }));
vi.mock("./SpeakerBar", () => ({ default: () => null }));
vi.mock("./TranscriptView", () => ({ default: () => null }));
vi.mock("@/app/components/TabHeader", () => ({ default: () => null }));

// The posting picker, reduced to the one affordance this file needs: a button
// that hands CopilotClient a real posting. A real SessionSetup would work too
// but would drag PostingPicker's own network calls in for a fact that is not
// under test here.
vi.mock("./SessionSetup", () => ({
  default: (props) =>
    createElement(
      "div",
      { "data-testid": "session-setup-stub" },
      createElement(
        "button",
        { type: "button", onClick: () => props.onPostingChange(FAKE_POSTING) },
        "Select posting",
      ),
    ),
}));

vi.mock("@/app/hooks/useResponsive", () => ({ useIsMobile: () => false, useIsTablet: () => false }));
vi.mock("@mui/material/useMediaQuery", () => ({ default: () => false }));
vi.mock("@/app/settings/engine", () => ({ useEngine: () => ({ engine: "embedded", setEngine: () => {} }) }));
vi.mock("./usePrepContext", () => ({ usePrepContext: () => ["", () => {}] }));
vi.mock("./useApplicationDocs", () => ({
  useApplicationDocs: () => ({ status: "idle", resume: "", coverLetter: "", error: "", retry: () => {} }),
}));
vi.mock("./useCopilotDashboard", () => ({
  useCopilotDashboard: () => ({
    pace: {},
    fillers: {},
    recordSpeechSample: () => {},
    resetForSession: () => {},
  }),
}));
vi.mock("./useCaptureSetup", () => ({
  useCaptureSetup: () => ({
    source: "tab",
    onSourceChange: () => {},
    micDeviceId: null,
    onMicDeviceChange: () => {},
    micLabel: "System default",
    sourceAvailability: { tab: true, system: true, inperson: true },
    sourceUnavailableReason: "",
  }),
}));
vi.mock("./useCompanyBrief", () => ({
  useCompanyBrief: () => ({
    status: "idle",
    articles: [],
    warnings: [],
    error: "",
    company: "",
    open: false,
    openBrief: vi.fn(),
    closeBrief: vi.fn(),
    refresh: vi.fn(),
  }),
}));

let liveSessionReturn;
vi.mock("./useLiveSession", () => ({ useLiveSession: () => liveSessionReturn }));
function baseLiveSessionReturn(overrides = {}) {
  return {
    warning: "",
    setWarning: () => {},
    error: "",
    finals: [],
    interims: { them: "", you: "" },
    startedAt: null,
    liveSince: null,
    now: 0,
    elapsed: 0,
    stop: vi.fn(),
    start: vi.fn(),
    onDraft: vi.fn(),
    addManualQuestion: vi.fn(),
    clearAll: vi.fn(),
    copyTranscript: vi.fn(),
    speakerSnapshot: { userTag: null, confidence: "unknown", overridden: false, tags: [] },
    speakerLabelFor: vi.fn(),
    identityUnsettled: false,
    onAssignUser: vi.fn(),
    sessionRef: { current: null },
    downloadLog: vi.fn(),
    sessionLogHasEvents: false,
    pinnedId: null,
    newerQuestionCount: 0,
    held: false,
    pinCurrentQuestion: vi.fn(),
    unpinQuestion: vi.fn(),
    cueAnnouncement: { text: "", nonce: 0 },
    ...overrides,
  };
}

let container;
let root;
let fetchMock;
let CopilotClient;

beforeEach(async () => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ answer: "ok" }) }));
  globalThis.fetch = fetchMock;
  liveSessionReturn = baseLiveSessionReturn();
  ({ default: CopilotClient } = await import("./CopilotClient.js"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.resetModules();
});

async function render() {
  await act(async () => {
    root.render(createElement(CopilotClient));
  });
}

// Every ask-AI box currently on screen, by its own accessible name.
function askBoxes() {
  return [...container.querySelectorAll("label")].filter((el) => el.textContent.trim() === ASK_LABEL);
}

function askField() {
  const label = askBoxes()[0];
  return label ? container.querySelector(`#${CSS.escape(label.getAttribute("for"))}`) : null;
}

async function clickText(pattern) {
  const button = [...container.querySelectorAll("button")].find((b) => pattern.test(b.textContent));
  expect(button, `no button matching ${pattern}`).toBeTruthy();
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// The ask route's requests, and only those. CopilotClient makes a mount-time
// fetch of its own (the STT provider name), so indexing `mock.calls[0]` picks
// up whichever request happened to be first — a test that would pass or fail
// on an unrelated component's network behaviour.
function askRequests() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/copilot/ask");
}

async function typeAndSubmit(text) {
  const field = askField();
  expect(field, "there is no ask field to type into").toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

// ---------------------------------------------------------------------------
// A. Live mode, rendered for real
// ---------------------------------------------------------------------------
describe("live mode: the ask box is on screen BEFORE a session starts", () => {
  it("renders exactly one ask field with nothing started, no question and no held question", async () => {
    // The pre-session state, verbatim: `status: "idle"` (so `live` is false),
    // `questions: []`, `held: false`, no measured reading. `mountStrip` is
    // false for all three of its disjuncts, so the sticky strip — and, until
    // this change, the ask box with it — does not render at all.
    await render();
    expect(container.querySelector("[data-testid='session-setup-stub']"), "not the pre-session state").toBeTruthy();
    expect(askBoxes()).toHaveLength(1);
  });

  it("is a real text input the candidate can type into, not a disclosure to click first", async () => {
    // Minimise clicks. A pre-session mount that put a trigger in front of the
    // field would satisfy "the box exists" while costing a click per question.
    await render();
    const field = askField();
    expect(field).toBeTruthy();
    expect(field.tagName).toBe("INPUT");
    expect(field.closest("form")).toBeTruthy();
  });

  it("sits AHEAD of the bounded, overflow:hidden live wrapper, where the strip itself mounts", async () => {
    // Same slot as the strip, for the same two reasons: the wrapper is height-
    // bounded and `overflow: hidden` at `sm`+ while live, so anything inside it
    // can be clipped; and a `position: sticky` sibling can only occlude what
    // FOLLOWS it, which must never include SessionSetup and the Start button.
    // Keeping the pre-session mount in the strip's own slot also means the box
    // does not JUMP when a session starts and the strip takes over.
    await render();
    const field = askField();
    const setup = container.querySelector("[data-testid='session-setup-stub']");
    expect(field.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("posts the SELECTED POSTING's id — applicationId is genuinely available pre-session", async () => {
    // The claim this whole feature rests on. `posting` is CopilotClient's own
    // `useState(null)`, written by SessionSetup's posting picker, which renders
    // and is interactive with nothing started — so the application id exists
    // before the session does, and does not have to be invented. Asserted
    // through the REQUEST rather than the source: `applicationId={posting?.id}`
    // present-but-undefined reads identically in source text and ships the box
    // answering from the knowledge base alone.
    await render();
    await clickText(/select posting/i);
    await typeAndSubmit("what did I claim about billing");

    // Exactly one, and to the ask route — never to /api/chat, which injects
    // user text into a system instruction.
    expect(askRequests()).toHaveLength(1);
    const sent = JSON.parse(askRequests()[0][1].body);
    expect(sent.applicationId).toBe(FAKE_POSTING.id);
    expect(sent.question).toBe("what did I claim about billing");
    // The engine choice too — the box must not silently ask a different engine
    // than the one the rest of the page is using.
    expect(sent.engine).toBe("embedded");
  });

  it("still sends the id once the strip has taken over — the strip's own copy is wired too", async () => {
    // The prop threading is per-mount-site, so proving it at one site proves
    // nothing about the other. Before this change NEITHER client passed
    // `applicationId` to the strip at all, so the shipped box asked with an
    // empty id in every state it could actually be reached in.
    liveSessionReturn = baseLiveSessionReturn({ held: true, pinnedId: 1, newerQuestionCount: 1 });
    await render();
    await clickText(/select posting/i);
    await typeAndSubmit("a question asked mid-session");

    expect(askRequests()).toHaveLength(1);
    const sent = JSON.parse(askRequests()[0][1].body);
    expect(sent.applicationId).toBe(FAKE_POSTING.id);
    expect(sent.engine).toBe("embedded");
  });
});

describe("live mode: there is never more than one ask box", () => {
  it("keeps exactly one once the strip mounts and takes ownership of it", async () => {
    // `held: true` reaches `mountStrip` through its second disjunct, so the
    // strip renders and brings its own AskAiBox. A pre-session mount added as
    // an unconditional sibling would show TWO fields here — two drafts, two
    // answer panels, and a second one covering the first.
    liveSessionReturn = baseLiveSessionReturn({ held: true, pinnedId: 1, newerQuestionCount: 1 });
    await render();
    expect(askBoxes()).toHaveLength(1);
  });

  it("keeps exactly one across the pre-session -> session transition", async () => {
    await render();
    expect(askBoxes()).toHaveLength(1);
    liveSessionReturn = baseLiveSessionReturn({ held: true, pinnedId: 1, newerQuestionCount: 1 });
    await render();
    expect(askBoxes()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B. Both clients, as source text — the structural property, with controls
// ---------------------------------------------------------------------------

// Every way the sibling mount can be wrong, evaluated as DATA so the [control]
// runs below execute the byte-identical code path against broken sources. That
// is what makes them controls: mutating this function mutates the shipped
// guard.
//
// The property: the strip mount and the ask mount are the TWO BRANCHES OF ONE
// TERNARY keyed on `mountStrip`. That shape is what makes "exactly one
// instance" structural rather than argued — two branches of one conditional
// cannot both render, and there is no second call site of either element to
// render alongside them.
function siblingMountFailures(rawSource) {
  const failures = [];
  // Comments FIRST, and this is load-bearing rather than tidy-minded: this
  // guard's first red run reported `strip-duplicated` against a correct
  // CopilotClient.js, because a JSX comment at its own `:879` says "moved to
  // <StickyQuestionStrip above". Prose that names an element is not a second
  // call site, and a guard that cannot tell them apart rejects correct code —
  // which is a guard a future implementer deletes. Block comments (which is
  // what `{/* … */}` is) and whole-line `//` comments only; a mid-line `//`
  // strip would truncate any line holding a URL.
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  if (!/import\s+AskAiBox\s+from\s+["'][^"']*dashboard\/AskAiBox["']/.test(source)) failures.push("not-imported");

  const askIdx = source.indexOf("<AskAiBox");
  const stripIdx = source.indexOf("<StickyQuestionStrip");
  // Without these two, every ordering check below compares -1 against -1 and
  // passes for any file forever (MUTATION 1 / MUTATION 2 below pin them).
  if (askIdx === -1) failures.push("ask-box-missing");
  if (stripIdx === -1) failures.push("strip-missing");
  if (askIdx > -1 && source.lastIndexOf("<AskAiBox") !== askIdx) failures.push("ask-box-duplicated");
  if (stripIdx > -1 && source.lastIndexOf("<StickyQuestionStrip") !== stripIdx) failures.push("strip-duplicated");
  if (askIdx === -1 || stripIdx === -1) return failures;

  const ternaryMatch = /\bmountStrip\s*\?/.exec(source);
  if (!ternaryMatch) failures.push("no-mountStrip-ternary");
  else {
    const ternaryIdx = ternaryMatch.index;
    if (stripIdx < ternaryIdx) failures.push("strip-outside-the-ternary");
    // The `) : (` that opens the ELSE branch, searched forward from the strip
    // mount. A `: null` else branch — today's shape — has no such opener, so
    // this is the check that is red until the fix lands.
    const elseMatch = /\)\s*:\s*\(/.exec(source.slice(stripIdx));
    if (!elseMatch) failures.push("no-else-branch");
    else {
      const elseIdx = stripIdx + elseMatch.index;
      if (askIdx < elseIdx) failures.push("ask-box-not-in-the-else-branch");
      else {
        // Nothing may gate the ask mount a second time. An extra `&&` or `?`
        // between the else branch opening and the element reintroduces exactly
        // the class of gate this change exists to remove.
        const between = source.slice(elseIdx + elseMatch[0].length, askIdx).replace(/\/\*[\s\S]*?\*\//g, "");
        if (/[?]|&&/.test(between)) failures.push("ask-box-re-gated");
      }
    }
  }

  // Both mount sites must carry the two props, and `applicationId` must be
  // DERIVED FROM THE SELECTED POSTING rather than a literal — an empty-string
  // literal type-checks, renders, and silently answers from the knowledge base
  // alone for every application the candidate ever asks about.
  for (const [name, idx] of [["strip", stripIdx], ["ask-box", askIdx]]) {
    // To the self-closing `/>`, never to the first `>`. The strip mount
    // carries `statsOnly={!(questions.length > 0 || held)}`, so slicing to the
    // first `>` stops INSIDE the props and every prop after it reads as
    // missing — a guard that fails correct code.
    const close = source.indexOf("/>", idx);
    const mount = source.slice(idx, close === -1 ? source.length : close);
    if (!/applicationId=\{[^}]*\bposting\b/.test(mount)) failures.push(`${name}-applicationId-not-from-posting`);
    if (!/engine=\{engine\}/.test(mount)) failures.push(`${name}-engine-not-threaded`);
  }

  return failures;
}

// The shape this change is asking for, in miniature. Used as the positive
// control: a guard nobody has ever seen go green may simply be unsatisfiable.
const FIXED_SHAPE = `
  import AskAiBox from "./dashboard/AskAiBox";
  {mountStrip ? (
    <StickyQuestionStrip
      questions={questions}
      applicationId={posting?.id || ""}
      engine={engine}
    />
  ) : (
    <AskAiBox
      applicationId={posting?.id || ""}
      engine={engine}
    />
  )}
`;

// Today's shape: the strip mount with a `: null` else branch and no ask mount
// anywhere. This is what both clients look like before the fix.
const PRE_FIX_SHAPE = `
  {mountStrip ? (
    <StickyQuestionStrip
      questions={questions}
      sessionLive={live}
    />
  ) : null}
`;

describe("both session clients mount the ask box pre-session (source shape)", () => {
  it("CopilotClient.js pairs the ask mount with the strip mount in one mountStrip ternary", () => {
    expect(siblingMountFailures(LIVE_SOURCE)).toEqual([]);
  });

  it("PracticeClient.js does the same", () => {
    expect(siblingMountFailures(PRACTICE_SOURCE)).toEqual([]);
  });

  it("[control] the shipped guard passes against the shape it is asking for", () => {
    expect(siblingMountFailures(FIXED_SHAPE)).toEqual([]);
  });

  it("[control] fails against the pre-fix shape: a strip mount with a `: null` else branch", () => {
    expect(siblingMountFailures(PRE_FIX_SHAPE)).toEqual(
      expect.arrayContaining(["not-imported", "ask-box-missing"]),
    );
  });

  it("[control] fails against an UNCONDITIONAL sibling — the shape that renders two boxes at once", () => {
    // The obvious wrong fix, and the one that is invisible to a "the element
    // is present" check: the strip keeps its own copy, a second one is mounted
    // beside it, and every state where the strip renders has two ask fields.
    const doubled = `
      import AskAiBox from "./dashboard/AskAiBox";
      {mountStrip ? (
        <StickyQuestionStrip applicationId={posting?.id || ""} engine={engine} />
      ) : null}
      <AskAiBox applicationId={posting?.id || ""} engine={engine} />
    `;
    expect(siblingMountFailures(doubled)).toContain("no-else-branch");
  });

  it("[control] fails against a SECOND ask mount added beside a correct one", () => {
    const duplicated = `${FIXED_SHAPE}\n<AskAiBox applicationId={posting?.id || ""} engine={engine} />`;
    expect(siblingMountFailures(duplicated)).toContain("ask-box-duplicated");
  });

  it("[control] fails against an else branch that re-gates the ask box", () => {
    // `{mountStrip ? (<Strip/>) : (live ? <AskAiBox/> : null)}` reintroduces a
    // session gate one level down and passes every ordering check.
    const regated = FIXED_SHAPE.replace(") : (\n    <AskAiBox", ") : (\n    live ? <AskAiBox");
    expect(siblingMountFailures(regated)).toContain("ask-box-re-gated");
  });

  it("[control] MUTATION 1 — with <AskAiBox deleted, `ask-box-missing` is what fires", () => {
    // Delete the element and every ordering check passes on -1. Drop
    // `ask-box-missing` from the failure list and this guard can never fail
    // again — the -1-compared-against--1 collapse.
    const deleted = `
      import AskAiBox from "./dashboard/AskAiBox";
      {mountStrip ? (
        <StickyQuestionStrip applicationId={posting?.id || ""} engine={engine} />
      ) : (
        <Box />
      )}
    `;
    expect(siblingMountFailures(deleted)).toContain("ask-box-missing");
  });

  it("[control] MUTATION 2 — an empty-string applicationId literal is caught", () => {
    // `applicationId=""` renders, type-checks, and makes the route answer from
    // the knowledge base alone for every question ever asked. No test that only
    // looks for the attribute's presence can see it.
    const literal = FIXED_SHAPE.replace(/applicationId=\{posting\?\.id \|\| ""\}/g, 'applicationId=""');
    expect(siblingMountFailures(literal)).toEqual(
      expect.arrayContaining(["strip-applicationId-not-from-posting", "ask-box-applicationId-not-from-posting"]),
    );
  });
});
