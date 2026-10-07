// @vitest-environment jsdom
//
// N123 step-4b (TDD hand-off) -- the chat-modal overhaul STRUCTURE/ORDER/dock.
//
// createRoot + act idiom (no @testing-library/react in this repo), same as
// ChatPanel.gaps.test.js / ChatPanel.answerAsMe.test.js. Every case mounts the
// REAL ChatPanel and drives it the way a user reaches it (store-seeded engine +
// voice preference, rendered controls), never a direct handler call.
//
// WHAT IS RED AT HEAD vs WHAT IS A GREEN REGRESSION GUARD (disclosed per the
// TDD seat's standing rule 1 -- a test that passes vacuously on HEAD is called
// out, never counted as coverage of the new behaviour):
//
//   RED at HEAD (fail because the dock/body layout is unbuilt):
//     T1  -- [data-chat-dock] does not exist.
//     T9d -- no dock to assert "carries no live region" against.
//     T10 -- at HEAD the Review control precedes the chips; the overhaul moves
//            it into the dock BELOW the body strip, so chips must precede it.
//     T12a-- no dock to count children of.
//     T12b-- at HEAD the drag hint is an IN-FLOW row; the overhaul makes it an
//            absolutely-positioned, pointer-events:none label.
//
//   GREEN at HEAD -- a regression guard that must STAY green through the
//   reshuffle (these pin HARD INVARIANTS so the overhaul cannot silently break
//   them; the R4 landmark + the live-region placement have NO other HEAD guard,
//   which is exactly why they are pinned here):
//     T9a-c -- exactly one of each live region, none under [aria-busy].
//     T11   -- Clear in the header + Context bar stay ABOVE the thread (H1,
//              refusal.js 29-41), and never move into the dock.
//     R4    -- the chat Review control sits inside its "Review of this <noun>"
//              landmark section.
//
// R-1 (chat collapse toggle) IS NOT ENCODED HERE. The 4b brief asked for R-1 to
// be "landed reversed", but the BINDING plan (N123.plan.r1.md section 5/6 and
// L-N123-P14) and the design default (N123.design.r1.md section 9, R-1 default
// = "Not included") both say R-1 is NOT taken and that
// DocumentReviewSection.toggle.test.js:93 ("is not on the chat card") must stay
// GREEN, not inverted. Flipping it would (a) edit another seat's landed test
// with no cited ruling that overrules the default, and (b) create an
// UNSATISFIABLE red: the plan tells the implementer NOT to add a chat collapse,
// so no correct build could turn it green. That conflict is reported to the
// orchestrator rather than papered over; this file leaves toggle.test.js
// untouched.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/review/runDocumentReview.js", () => ({ runDocumentReview: vi.fn() }));

import { runDocumentReview } from "@/lib/review/runDocumentReview.js";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  }
  try {
    window.localStorage.clear();
    // Default to the AI engine so the voice switch is enabled; individual cases
    // override to "embedded" where that is the state under test.
    window.localStorage.setItem("tailorEngine", "gemini");
  } catch {
    /* storage may be unavailable */
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  runDocumentReview.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks();
});

function baseProps(overrides = {}) {
  return {
    chatPanelRef: { current: null },
    chatScrollRef: { current: null },
    chatInputRef: { current: null },
    chatDragActive: false,
    setChatDragActive: vi.fn(),
    addChatAttachments: vi.fn(),
    fabPos: { bottom: 24, right: 24 },
    chatSize: { width: 380, height: 520 },
    startChatResize: vi.fn(),
    chatMessages: [],
    setChatMessages: vi.fn(),
    chatError: "",
    setChatError: vi.fn(),
    chatPinnedContext: null,
    setChatPinnedContext: vi.fn(),
    chatSending: false,
    chatCopiedIndex: null,
    setChatCopiedIndex: vi.fn(),
    resendUserMessage: vi.fn(),
    chatAttachedFiles: [],
    setChatAttachedFiles: vi.fn(),
    chatAttachError: "",
    setChatAttachError: vi.fn(),
    chatInput: "",
    setChatInput: vi.fn(),
    sendChatMessage: vi.fn(),
    onClose: vi.fn(),
    returnFocusRef: { current: null },
    ...overrides,
  };
}

// scope "resume" -> NOUN "resume" -> landmark "Review of this resume".
const DOC = {
  kind: "applicationReady",
  scope: "resume",
  title: "Acme - Staff Engineer - Resume",
  resultLines: ["Owned the billing rewrite from design to launch."],
  posting: null,
  realMaterial: null,
};

const POSTING_CONTEXT = {
  label: "Acme - Staff Engineer - Resume",
  content: "a posting",
  posting: { salaryStated: false, title: "Staff Engineer" },
};

async function render(props) {
  await act(async () => root.render(createElement(ChatPanel, props)));
}

// --- finders driven the way a user / AT reaches each control -----------------
const dock = () => container.querySelector("[data-chat-dock]");
const sendButton = () => [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Send");
const reviewButton = () => [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));
const clearButton = () => [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Clear");
const thread = (props) => props.chatScrollRef.current;
// The composer textarea the user types in (MUI mounts a second aria-hidden one
// purely to measure height).
const composer = () => container.querySelector("textarea:not([aria-hidden])");
// The hidden <input type=file> lives inside the attach control.
const attachInput = () => container.querySelector('input[type="file"]');
const attachControl = () => attachInput()?.closest("label, button") ?? null;
function answerSwitch() {
  return [...container.querySelectorAll('input[type="checkbox"]')].find((el) => /answer as me/i.test((el.closest("label")?.textContent || "")));
}

// Read the CSS emotion actually emitted for an element's own generated class --
// same technique as ChatPanel.gaps.test.js's emittedCssFor; jsdom's
// getComputedStyle does not reliably resolve this cascade. Misses media-query
// nested rules (a CSSMediaRule has no selectorText), which is fine for the
// position/pointer-events literals below (those are top-level in the sx).
function emittedCssFor(el) {
  const cssClass = [...el.classList].find((c) => c.startsWith("css-"));
  if (!cssClass) return "";
  return [...document.styleSheets]
    .flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
    .filter((rule) => rule.selectorText && rule.selectorText.includes(cssClass))
    .map((rule) => rule.cssText)
    .join(" ");
}

describe("N123 T1 -- the two-row composer dock exists and holds the right controls", () => {
  it("[data-chat-dock] exists with exactly two element children and holds switch+attach+textarea+Send+Review", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));

    const d = dock();
    // RED at HEAD: there is no dock; the footer is three stacked rows.
    expect(d, "no [data-chat-dock] -- the composer dock is unbuilt").not.toBeNull();

    // Exactly two element children: the toolbar block and the composer row.
    expect(d.children).toHaveLength(2);

    // The five dock controls all live inside it.
    expect(d.contains(sendButton()), "Send is not in the dock").toBe(true);
    expect(d.contains(composer()), "the composer textarea is not in the dock").toBe(true);
    expect(d.contains(attachControl()), "the attach control is not in the dock").toBe(true);
    expect(d.contains(answerSwitch()), "the Answer-as-me switch is not in the dock").toBe(true);
    expect(d.contains(reviewButton()), "the Review control is not in the dock toolbar").toBe(true);
  });

  it("the none-caption takes the Review slot in the dock when nothing is pinned", async () => {
    await render(baseProps({ chatReviewDocument: null }));
    const d = dock();
    expect(d, "no [data-chat-dock] when nothing is pinned either").not.toBeNull();
    expect(d.children).toHaveLength(2);
    // No document => no Review button, but the dock still carries the empty-state
    // caption (so the toolbar row is never empty).
    expect(reviewButton()).toBeUndefined();
    expect((d.textContent || "")).toMatch(/nothing to review/i);
  });

  it("attachment chips are in the body strip, NOT in the dock", async () => {
    await render(baseProps({
      chatReviewDocument: DOC,
      chatAttachedFiles: [{ name: "scan.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" }],
    }));
    const d = dock();
    expect(d).not.toBeNull();
    // POSITIVE CONTROL: the chip really did render somewhere in the panel.
    expect(container.querySelectorAll(".MuiChip-root").length).toBeGreaterThan(0);
    // ...just not inside the dock.
    expect(d.querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });
});

describe("N123 T9 -- the three live regions stay put and never enter the new siblings", () => {
  const progress = () => container.querySelector('[data-chat-status="progress"]');
  const alertRegion = () => container.querySelector('[data-chat-status="review-alert"]');
  const errorRegion = () =>
    [...container.querySelectorAll('[aria-live="polite"]:not([data-chat-status])')].find((el) => !el.closest("[data-chat-turn]")) || null;

  it("T9a GUARD: exactly one progress (polite), one review-alert (assertive), one chatError (polite)", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));
    expect(container.querySelectorAll('[data-chat-status="progress"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chat-status="review-alert"]')).toHaveLength(1);
    expect(progress().getAttribute("aria-live")).toBe("polite");
    expect(alertRegion().getAttribute("role")).toBe("alert");
    expect(errorRegion(), "the always-mounted chatError region").not.toBeNull();
  });

  it("T9b GUARD: none of the three live regions nests under [aria-busy]", async () => {
    await render(baseProps({ chatReviewDocument: DOC, chatSending: true }));
    expect(container.querySelector('[aria-busy="true"]'), "CONTROL: the busy wrapper exists while sending").not.toBeNull();
    expect(progress().closest('[aria-busy="true"]')).toBeNull();
    expect(alertRegion().closest('[aria-busy="true"]')).toBeNull();
    expect(errorRegion().closest('[aria-busy="true"]')).toBeNull();
  });

  it("T9d: the dock carries NO live region (aria-live / role=status / role=alert)", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));
    const d = dock();
    // RED at HEAD: no dock exists to make this assertion against.
    expect(d, "no dock -- cannot yet prove it is free of live regions").not.toBeNull();
    expect(d.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });
});

describe("N123 T10 -- interactive DOM order follows visual order (WCAG 2.4.3)", () => {
  it("with chips present, Review follows the chips (it is in the dock, below the body strip)", async () => {
    await render(baseProps({
      chatReviewDocument: DOC,
      chatAttachedFiles: [
        { name: "a.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" },
        { name: "b.png", kind: "binary", mimeType: "image/png", dataB64: "BBBB" },
      ],
    }));
    const chips = [...container.querySelectorAll(".MuiChip-root")];
    expect(chips.length).toBeGreaterThan(0);
    const lastChip = chips[chips.length - 1];
    const review = reviewButton();
    expect(review, "no Review control").toBeTruthy();
    // RED at HEAD: today the Review section (line 627) precedes the chips (633),
    // so this FOLLOWING relation is reversed.
    expect(
      lastChip.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING,
      "Review does not follow the attachment chips -- the chips are not in the body strip above the dock",
    ).toBeTruthy();
  });

  it("within the dock, Answer-as-me precedes the composer trio (attach, textarea, Send in order)", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));
    const d = dock();
    expect(d, "no dock").not.toBeNull();
    const sw = answerSwitch();
    const attach = attachControl();
    const input = composer();
    const send = sendButton();
    const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // toolbar (Review + switch) is above the composer row, and within the
    // composer row the order is attach, input, Send.
    expect(follows(sw, attach), "attach must follow the switch (toolbar above composer)").toBe(true);
    expect(follows(attach, input), "the input must follow attach").toBe(true);
    expect(follows(input, send), "Send must follow the input").toBe(true);
  });
});

describe("N123 T11 (H1) -- Clear + Context stay at the top, never in the dock", () => {
  // The refusal copy (lib/chat/refusal.js 29-41) tells the user these controls
  // are "at the top of the panel". Moving them would make a landed refusal
  // sentence false. Pinned here so a reshuffle reds. GREEN at HEAD -- a guard.
  it("Clear is a header descendant and precedes the thread; it is not in the dock", async () => {
    const props = baseProps({ chatMessages: [{ role: "user", content: "hi" }] });
    await render(props);
    const clear = clearButton();
    expect(clear, "no Clear control").toBeTruthy();
    const t = thread(props);
    expect(t, "chatScrollRef did not attach to the thread").not.toBeNull();
    expect(
      clear.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING,
      "Clear does not precede the thread",
    ).toBeTruthy();
    // Vacuous at HEAD (no dock); becomes a real containment guard at Step 2.
    const d = dock();
    if (d) expect(d.contains(clear)).toBe(false);
  });

  it("the Context label + Remove-context control precede the thread and are not in the dock", async () => {
    const props = baseProps({ chatPinnedContext: POSTING_CONTEXT });
    await render(props);
    const remove = container.querySelector('[aria-label="Remove context"]');
    expect(remove, "no Remove-context control").not.toBeNull();
    const t = thread(props);
    expect(remove.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING, "Context remove does not precede the thread").toBeTruthy();
    const d = dock();
    if (d) expect(d.contains(remove)).toBe(false);
  });

  it("the refusal vocabulary still names these locations 'at the top'", async () => {
    // A string snapshot of the H1 invariant: if a future author moves Clear or
    // Context, these refusal sentences become false and must be revisited.
    const refusal = await import("@/lib/chat/refusal.js");
    expect(refusal.TOO_BIG_TRANSCRIPT_MESSAGE).toMatch(/Clear at the top of the panel/);
    expect(refusal.TOO_BIG_PINNED_CONTEXT_MESSAGE).toMatch(/at the top of this panel/);
  });
});

describe("N123 T12a -- toggling the voice switch adds no dock row", () => {
  it("the dock has the same element-child count with the voice preference OFF and ON", async () => {
    window.localStorage.setItem("tailorEngine", "gemini");
    window.localStorage.setItem("chatAnswerAsMe", "false");
    await render(baseProps({ chatReviewDocument: DOC }));
    const off = dock();
    expect(off, "no dock to count").not.toBeNull();
    const offCount = off.children.length;

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.setItem("chatAnswerAsMe", "true");
    await render(baseProps({ chatReviewDocument: DOC }));
    const on = dock();
    expect(on).not.toBeNull();
    expect(on.children.length, "turning the voice preference on changed the dock row count").toBe(offCount);
  });
});

describe("N123 T12b -- the drag label is out of flow and never a drag target", () => {
  it("while dragging, the drop label is position:absolute + pointer-events:none", async () => {
    await render(baseProps({ chatReviewDocument: DOC, chatDragActive: true }));
    const label = [...container.querySelectorAll("*")].find((el) => /drop files/i.test((el.textContent || "")) && el.children.length === 0);
    expect(label, "no drop-files label while dragging").toBeTruthy();
    const css = emittedCssFor(label);
    // INSTRUMENT CANARY: the reader actually resolved rules for this node.
    expect(css, "emittedCssFor read no rules for the drop label").not.toBe("");
    // RED at HEAD: today the hint is an in-flow row (fontStyle italic, no
    // positioning), so neither literal is present.
    expect(css, "the drag label is not absolutely positioned (still an in-flow row that reflows the footer)").toMatch(/position:\s*absolute/);
    expect(css, "the drag label still takes pointer events, so it can fire spurious dragleave").toMatch(/pointer-events:\s*none/);
  });

  it("CONTROL: with no drag active, there is no drop-files label at all", async () => {
    await render(baseProps({ chatReviewDocument: DOC, chatDragActive: false }));
    const label = [...container.querySelectorAll("*")].find((el) => /drop files/i.test((el.textContent || "")) && el.children.length === 0);
    expect(label).toBeFalsy();
  });
});

describe("N123 R4 (SILENT guard) -- the chat Review control keeps its landmark", () => {
  // No ChatPanel test asserts this today; the split of DocumentReviewSection
  // could drop the <section aria-label="Review of this <noun>"> wrapper on the
  // chat surface unseen. Pinned here. GREEN at HEAD -- a guard.
  it("the Review control sits inside a 'Review of this resume' landmark section", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));
    const review = reviewButton();
    expect(review, "no Review control").toBeTruthy();
    const landmark = review.closest('section[aria-label="Review of this resume"]');
    expect(landmark, "the Review control lost its 'Review of this resume' landmark").not.toBeNull();
  });
});

// ===========================================================================
// BROWSER-ONLY -- jsdom cannot measure layout. getBoundingClientRect() returns
// zeros here (MEMORY: measurement-instruments), so a jsdom assertion of any px
// target would be VACUOUS. These are skipped, not faked. They are the delayed
// "reference build" measurements the plan (L-N123-25) gates the close on: run
// the design section 10 visible-window / headless-Chrome harness against the
// BUILT component, confirming document.visibilityState === "visible" &&
// innerWidth > 0 first or the series is INVALID (not zero).
//
//   T2   dock height <= 100/100/116 px (sm+ S1/S2/S3), <= 118 px phone
//   T3   thread >= 60% of panel height with a pinned doc
//   T4   max vertical centre distance among the 5 composer controls <= 44/62/50
//   T5   REACHABILITY (the whole point, B1 clip fix): textarea + Send fully
//        inside the panel in EVERY state incl. result-open at 380x520 / 280x320
//        / 375x812 / 320x640; thread >= 48 px except the S6c corner
//   T6   input-to-control centre distances
//   T12c opening a review result leaves the toolbar + composer rects fixed
//   section 8 owner/visible-browser sign-off: dock density, drag-label look,
//        stacked hairlines, 48px thread-floor legibility, paperclip glyph,
//        dark-mode of the ON label/disabled switch/drag label, focus-ring
//        clipping at the strip top + result inner scroller, iOS Safari vh,
//        screen-reader reading order.
// ===========================================================================
describe.skip("N123 T2-T6 / T12c -- BROWSER-ONLY layout measurement (INVALID until the real-browser harness runs on the built component)", () => {
  it("T5: textarea and Send stay inside the panel in every state (B1 clip fix)", () => {
    // Intentionally empty: see the block comment. Asserting a px clip in jsdom
    // would be a fabricated measurement.
  });
});
