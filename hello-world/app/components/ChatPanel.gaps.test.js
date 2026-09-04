// @vitest-environment jsdom
//
// createRoot + act idiom (no @testing-library/react in this repo) -- as in
// app/components/preview/DriveActions.test.js.
//
// Everything else in this change is tested one link short of the point. The
// chain is:
//
//     readChatResponse(413)  ->  setChatError(msg)  ->  the user reads it
//
// and without this file the last link is untested: deleting the `chatError`
// renderer (the always-mounted `chatError` live region in `ChatPanel.js`),
// the `chatAttachError` renderer, or the attachment chips
// (`chatAttachedFiles.map` -> `<Chip>`) leaves every other test in this change
// green while the user sees nothing at all. So the first test here does not
// invent a message -- it runs the REAL classifier and renders its REAL output,
// which is the only way the whole chain is pinned end to end.
//
// The last test is a NEW requirement, not a regression guard: marking a turn
// `failed` and re-using its slot means the user's failed message is silently
// REPLACED by their next send. Without a visible cue that is a defect we would
// be introducing, so `failed` must be observable in the thread and the Resend
// control must stay reachable on it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";
import { useChat } from "../hooks/useChat.js";
import * as chatbot from "@/lib/chat/chatbot";
// AC-27b only. Imported to CANARY the instrument, not to test MUI: the
// keyboard assertions on the panel's own chip are meaningless unless a bare
// MUI Chip is first shown to be reachable by a dispatched keydown in this
// jsdom. See "AC-27b" below.
import Chip from "@mui/material/Chip";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
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
    chatInput: "",
    setChatInput: vi.fn(),
    sendChatMessage: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(ChatPanel, props));
  });
}

// The panel renders no portal (no MUI Dialog/Popper here), so the container's
// own text is the whole of what a user can read.
function screenText() {
  return container.textContent || "";
}

// A 413 exactly as the platform sends it: plain text, no content-type.
function response413() {
  return {
    ok: false,
    status: 413,
    headers: { get: () => null },
    text: async () => "Request Entity Too Large",
    json: async () => {
      throw new SyntaxError("Unexpected token 'R', \"Request En\"... is not valid JSON");
    },
  };
}

describe("ChatPanel: the classified failure actually reaches the screen", () => {
  it("renders the real readChatResponse output for a 413", async () => {
    const result = await chatbot.readChatResponse(response413());
    expect(result.ok).toBe(false);

    await render(baseProps({
      chatMessages: [{ role: "user", content: "review my resume", failed: true }],
      chatError: result.error,
    }));

    const text = screenText();
    // The whole classified message is on screen, not swallowed.
    expect(text).toContain(result.error);
    // ...and it is the actionable one, not the SyntaxError.
    expect(text).toMatch(/too (big|large)/i);
    expect(text).toMatch(/4\.5\s*MB/i);
    expect(text).not.toMatch(/Unexpected token/);
    expect(text).not.toMatch(/is not valid JSON/);
  });

  it("renders the attach refusal, naming every file a bulk add rejected", async () => {
    const refusal =
      "offer-letter-scan.png, portfolio-page-1.png and portfolio-page-2.png are too large to attach (max 2.8 MB each).";
    await render(baseProps({ chatAttachError: refusal }));

    const text = screenText();
    expect(text).toContain("offer-letter-scan.png");
    expect(text).toContain("portfolio-page-1.png");
    expect(text).toContain("portfolio-page-2.png");
  });

  it("renders one chip per attachment in the tray", async () => {
    await render(baseProps({
      chatAttachedFiles: [
        { name: "resume.pdf", kind: "binary", mimeType: "application/pdf", dataB64: "AAAA" },
        { name: "cover-letter.docx", kind: "text", content: "Dear hiring manager" },
      ],
    }));

    const text = screenText();
    expect(text).toContain("resume.pdf");
    expect(text).toContain("cover-letter.docx");
    expect(container.querySelectorAll(".MuiChip-root").length).toBeGreaterThanOrEqual(2);
  });

  it("ABSENCE CONTROL: with no error and an empty tray, none of that markup is present", async () => {
    await render(baseProps());

    const text = screenText();
    expect(text).not.toMatch(/too (big|large)/i);
    expect(text).not.toContain("resume.pdf");
    expect(container.querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });
});

describe("ChatPanel: a failed turn is visible as failed", () => {
  // Everything a user could perceive about one turn: its text, plus any
  // accessible name a cue might carry instead of visible text.
  function perceivableText(el) {
    const bits = [el.textContent || ""];
    for (const node of el.querySelectorAll("[aria-label],[title]")) {
      bits.push(node.getAttribute("aria-label") || "", node.getAttribute("title") || "");
    }
    return bits.join(" ");
  }

  function turnsMarked(value) {
    return [...container.querySelectorAll(`[data-chat-turn="${value}"]`)];
  }

  const THREAD = [
    { role: "user", content: "how do I phrase this" },
    { role: "assistant", content: "Try leading with the outcome." },
    { role: "user", content: "please review my resume", failed: true },
  ];

  it("marks the failed turn distinctly from the sent one", async () => {
    await render(baseProps({ chatMessages: THREAD }));

    const failed = turnsMarked("failed");
    const sent = turnsMarked("sent");

    // Exactly one of each, and each wraps only its own turn -- a single outer
    // wrapper carrying the attribute would fail the cross-checks below.
    expect(failed).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(failed[0].textContent).toContain("please review my resume");
    expect(failed[0].textContent).not.toContain("how do I phrase this");
    expect(sent[0].textContent).toContain("how do I phrase this");
    expect(sent[0].textContent).not.toContain("please review my resume");
  });

  it("tells the user, in words, that the failed turn was not sent", async () => {
    // A data attribute is invisible. The whole point of the requirement is
    // that the user can see which message did not go -- otherwise the slot
    // re-use replaces it with no cue at all.
    await render(baseProps({ chatMessages: THREAD }));

    const failed = turnsMarked("failed")[0];
    expect(failed).toBeDefined();
    expect(perceivableText(failed)).toMatch(/(not sent|didn'?t send|failed to send|couldn'?t send|not delivered)/i);
  });

  it("keeps Resend reachable on the failed turn", async () => {
    const props = baseProps({ chatMessages: THREAD });
    await render(props);

    const failed = turnsMarked("failed")[0];
    expect(failed).toBeDefined();
    const resend = [...failed.querySelectorAll("button")].find((b) =>
      /resend/i.test(b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || ""),
    );
    expect(resend).toBeDefined();

    await act(async () => {
      resend.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(props.resendUserMessage).toHaveBeenCalledWith(2);
  });
});

describe("ChatPanel: M6 -- deleting one chip revokes only that chip's preview URL", () => {
  let originalRevoke;
  beforeEach(() => {
    originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    if (originalRevoke) URL.revokeObjectURL = originalRevoke;
    else delete URL.revokeObjectURL;
  });

  it("revokes the deleted chip's blob URL and leaves the others alone", async () => {
    const keep = { name: "shot-keep.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA", previewUrl: "blob:keep" };
    const remove = { name: "shot-remove.png", kind: "binary", mimeType: "image/png", dataB64: "BBBB", previewUrl: "blob:remove" };
    const props = baseProps({ chatAttachedFiles: [keep, remove] });
    await render(props);

    const deleteIcons = container.querySelectorAll(".MuiChip-deleteIcon");
    expect(deleteIcons.length).toBe(2);

    await act(async () => {
      deleteIcons[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:remove");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:keep");
    expect(props.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    // A setter may be called with a value or an updater function.
    const arg = props.setChatAttachedFiles.mock.calls[0][0];
    const result = typeof arg === "function" ? arg(props.chatAttachedFiles) : arg;
    expect(result).toEqual([keep]);
  });
});

describe("ChatPanel: m8 -- the failed-turn cue is perceivable, not just visible", () => {
  const THREAD_ONE_FAILED = [{ role: "user", content: "please review my resume", failed: true }];

  // A2 adds a SECOND `role="status"` to this panel -- the always-mounted
  // `chatError` live region (AC-33). An unscoped
  // `container.querySelector('[role="status"]')` would then be picking one of
  // two by DOM order, which is not what either test below means. Both are
  // scoped to the failed turn instead; the assertions are otherwise unchanged.
  function failedTurnStatus() {
    const failed = container.querySelector('[data-chat-turn="failed"]');
    expect(failed, "no failed turn rendered").not.toBeNull();
    return failed.querySelector('[role="status"]');
  }

  it("carries role=\"status\" so a screen reader announces it without the user having to look", async () => {
    await render(baseProps({ chatMessages: THREAD_ONE_FAILED }));

    const status = failedTurnStatus();
    expect(status).toBeDefined();
    expect(status).not.toBeNull();
    expect((status.textContent || "")).toMatch(/not sent/i);
  });

  it("AC-37: the cue's rendered text is EXACTLY \"Not sent — try Resend below\"", async () => {
    // An exact string, not the regex family at :220. That family
    //  by a REWORDED cue -- "Didn't send — press Clear"
    // passes it -- so it cannot check this criterion at all.
    //
    // The wording is pinned deliberately, and this is the one place in A2 that
    // pins user-facing copy: for a size refusal the cue recommends Resend,
    // which rebuilds a byte-identical body and is therefore futile. A2's
    // ruling is to leave the cue exactly as it is and let the measured refusal
    // rendered ~8px below carry the real remedy; a future author who decides
    // otherwise must change this assertion consciously rather than drift past
    // it. The dash is U+2014, matching the failed-turn cue in `ChatPanel.js`.
    await render(baseProps({ chatMessages: THREAD_ONE_FAILED }));

    expect(failedTurnStatus().textContent).toBe("Not sent — try Resend below");
  });

  it("is no smaller than the other error text in the panel (chatError, 0.85rem)", async () => {
    // Same technique as app/components/preview/DriveResultRegion.test.js's
    // `cssRuleTextFor`: read the actual CSS text emotion (MUI's `sx` engine)
    // emitted for this element's own generated class, rather than trusting
    // jsdom's `getComputedStyle` (which does not reliably resolve the
    // cascade here).
    await render(baseProps({ chatMessages: THREAD_ONE_FAILED, chatError: "Something went wrong." }));

    const status = failedTurnStatus();
    expect(status).not.toBeNull();
    const cssClass = [...status.classList].find((c) => c.startsWith("css-"));
    expect(cssClass).toBeDefined();
    const ruleText = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .filter((rule) => rule.selectorText && rule.selectorText.includes(cssClass))
      .map((rule) => rule.cssText)
      .join(" ");

    // Previously 11px -- the smallest text in the whole panel.
    expect(ruleText).not.toMatch(/font-size:\s*11px/);
    expect(ruleText).toMatch(/font-size:\s*0\.85rem/);
  });
});

// ===========================================================================
// Chunk A2 -- the refusal experience.
//
// Two defects, and the measurements that separate them. Both were taken in
// THIS repo (React/React-DOM 19.2.4, vitest 4.1.8, jsdom 29.1.1) against the
// real `useChat` + `ChatPanel` pair, driven by a real click on Send:
//
//   Fixture A, `resumeFile === null` -- no await between setChatSending(true)
//   and the size throw, so React commits once.
//       second identical refusal -> MutationObserver records: []
//       composer disabled transitions:                        [false]
//   The ANNOUNCEMENT defect lives here and only here: the live region's text
//   does not change, so it emits no mutations and a screen reader says
//   nothing. The composer is never rendered disabled, so focus is never lost.
//
//   Fixture B, `resumeFile` set -- the `await buildTemplateLinesForUpload(resumeFile)`
//   inside `runChatRequest` (`chatbot.js`) forces a flush.
//       second identical refusal -> MutationObserver records: [childList, ...]
//       composer disabled transitions:                        [true, false]
//   The FOCUS defect lives here and only here.
//
// They are DISJOINT today and the fix COUPLES them: forcing the flush that
// makes Fixture A announce also flushes the pending setChatSending(true), so
// Fixture A starts rendering the composer disabled where it never did before.
// Shipping the announcement without the focus restore is a net regression for
// Fixture A. Hence "AC-34 + AC-31 together" below, which is not a convenience
// test -- it is the only one that fails if the two halves are landed apart.
//
// --- RE-MEASURED 2026-09-04, AFTER THE FIX. Two lines above are now stale ---
//
// The two "composer disabled transitions" figures above are PRE-FIX. AC-31
// rev 6 removed the composer from `chatSending`'s consumers, so the measured
// values on this tree are [] in BOTH fixtures, on the first send and on an
// identical repeat. So is `chatError`, `chatInput`, `chatMessages`,
// `document.activeElement`, and the Send button's own disabled transitions
// ([true, false] in both -- `setChatInput("")` drives that control, not
// `chatSending`).
//
// The fixtures are still genuinely different, one consumer further out.
// `chatSending` itself is untouched by rev 6, and the "Thinking…" indicator
// and the Resend button are still wired to it:
//
//   fixture A   "Thinking…" node add/remove: []              Resend disabled: []
//   fixture B   "Thinking…" node add/remove: [add, remove]   Resend disabled: [true, false]
//
// i.e. fixture A never COMMITS `chatSending` at all, and fixture B does. That
// is the seam the FIXTURE CLASSIFICATION case is re-based on, and the reason
// fixture B is load-bearing rather than redundant: a regression that re-wires
// the composer to `chatSending` can only be witnessed on fixture B, because
// fixture A has no committed `true` for the composer to render.
// ===========================================================================

// The `chatError` live region, as distinct from the OTHER two role="status"
// nodes in this panel: the failed-turn cue (which lives inside a chat turn and
// carries no aria-live) and AC-31g's progress region (which carries both, and
// is marked `data-chat-status`). Excluding the latter is a NARROWING, not a
// weakening -- this helper has always meant "the chatError region", and every
// assertion written against it means that too; before AC-31g exists no node
// carries `data-chat-status`, so the selector resolves identically today.
// Without it, `find()` returns whichever of the two polite regions happens to
// come first in DOM order, and every existing chatError assertion would
// silently re-point itself at a region that never carries the refusal.
function liveRegion() {
  return [...container.querySelectorAll('[aria-live="polite"]:not([data-chat-status])')]
    .find((el) => !el.closest("[data-chat-turn]")) || null;
}

// Read the CSS emotion actually emitted for an element's own generated class.
// Same technique as the 0.85rem test above and
// app/components/preview/DriveResultRegion.test.js's `cssRuleTextFor`;
// jsdom's getComputedStyle does not reliably resolve the cascade here.
function emittedCssFor(el) {
  const cssClass = [...el.classList].find((c) => c.startsWith("css-"));
  if (!cssClass) return "";
  return [...document.styleSheets]
    .flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
    .filter((rule) => rule.selectorText && rule.selectorText.includes(cssClass))
    .map((rule) => rule.cssText)
    .join(" ");
}

describe("ChatPanel: AC-33 -- the chatError region is a live region that is always there", () => {
  it("is present in the DOM while EMPTY, with role=status and aria-live=polite", async () => {
    // A live region MOUNTED at the moment its text first appears is
    // unreliably announced -- the assistive tech has to have been observing it
    // beforehand. Prior art for the exact assertion (an empty textContent on a
    // still-mounted region):
    // app/components/experience/AttachmentPanel.retryFocus.test.js:469.
    await render(baseProps({ chatError: "" }));

    const region = liveRegion();
    expect(region, "no aria-live region rendered with an empty chatError").not.toBeNull();
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });

  it("is not hidden in any way that suppresses announcements", async () => {
    // `display:none` and `visibility:hidden` both remove the node from the
    // accessibility tree, which would make the always-mounted region pointless.
    await render(baseProps({ chatError: "" }));

    const region = liveRegion();
    expect(region).not.toBeNull();
    expect(region.hasAttribute("hidden")).toBe(false);
    expect(region.getAttribute("aria-hidden")).toBeNull();
    const css = emittedCssFor(region);
    expect(css).not.toMatch(/display:\s*none/);
    expect(css).not.toMatch(/visibility:\s*hidden/);
  });

  it("is not hidden by an INLINE style either -- and the instrument saying so is not blind", async () => {
    // THE HOLE THIS CLOSES. The case above reads `emittedCssFor(region)`,
    // which returns "" whenever the element carries no `css-*` class -- and ""
    // satisfies BOTH `not.toMatch(/display:\s*none/)` and the visibility one.
    // That is the `not.toContain(undefined)` trap applied to an INSTRUMENT
    // rather than to an import, and it leaves the obvious hiding mechanism
    // wide open: `sx` compiles to a class, so `style={{display:"none"}}` when
    // `chatError` is empty passes the entire suite while removing the
    // always-mounted live region from the accessibility tree -- i.e. keeping
    // the node and losing every announcement AC-33 exists to guarantee.
    await render(baseProps({ chatError: "" }));
    const region = liveRegion();
    expect(region).not.toBeNull();

    // INSTRUMENT CANARY 1 -- `emittedCssFor` really did read rules for THIS
    // node. If this is "" then every negative fed by it above is vacuous.
    const css = emittedCssFor(region);
    expect(css, "emittedCssFor found no rules -- the negatives it feeds prove nothing").not.toBe("");
    expect(css).toMatch(/font-size/);

    // INSTRUMENT CANARY 2 -- prove the inline-style reader below actually
    // fires on a node that IS hidden that way, before trusting it to report
    // that the region is not.
    const planted = document.createElement("div");
    planted.setAttribute("style", "display: none");
    expect(planted.style.display).toBe("none");
    expect(planted.getAttribute("style")).toMatch(/display:\s*none/i);

    // ...and now the assertion itself, on the empty region and again once it
    // carries text, because "hidden only while empty" is the shape that would
    // slip past a single-state check.
    for (const chatError of ["", "That message is too large to send."]) {
      await render(baseProps({ chatError }));
      const el = liveRegion();
      expect(el, `no live region with chatError=${JSON.stringify(chatError)}`).not.toBeNull();
      expect(el.style.display).not.toBe("none");
      expect(el.style.visibility).not.toBe("hidden");
      expect(el.getAttribute("style") || "").not.toMatch(/display:\s*none|visibility:\s*hidden/i);
    }
  });

  it("PAIRED POSITIVE CONTROL: the SAME node then carries the error text", async () => {
    // Node identity across the empty -> non-empty transition is the whole
    // point: a region that is torn down and rebuilt announces nothing.
    await render(baseProps({ chatError: "" }));
    const before = liveRegion();
    expect(before).not.toBeNull();

    await render(baseProps({ chatError: "That message is too large to send." }));
    const after = liveRegion();

    expect(after).toBe(before);
    expect(after.textContent).toBe("That message is too large to send.");
    expect(screenText()).toContain("That message is too large to send.");
  });

  it("keeps the failed-turn cue BEFORE the error region in DOM order", async () => {
    // Two role=status regions now sit ~8px apart inside the same scroll
    // column. The order is load-bearing for the scoped selectors above and for
    // what a screen reader reads first.
    await render(baseProps({
      chatMessages: [{ role: "user", content: "review my resume", failed: true }],
      chatError: "That message is too large to send.",
    }));

    const regions = [...container.querySelectorAll('[role="status"]')];
    expect(regions.length).toBeGreaterThanOrEqual(2);
    const cue = container.querySelector('[data-chat-turn="failed"] [role="status"]');
    expect(cue).not.toBeNull();
    expect(regions.indexOf(cue)).toBeLessThan(regions.indexOf(liveRegion()));
  });
});

describe("ChatPanel: AC-27 -- every control a refusal names really is on screen", () => {
  it("Clear, Context and the chip's remove affordance all exist while the refusal names them", async () => {
    // This is the half a node test cannot do. AC-27 is not "the string
    // contains the word Clear", it is "the message names a control that exists
    // in the panel at that moment, by its visible label". Rename the header
    // button and this goes red even though every string assertion in
    // lib/chat/chatbot.refusal.test.js stays green.
    await render(baseProps({
      chatMessages: [{ role: "user", content: "review my resume" }],
      chatPinnedContext: { label: "Senior PM at Acme", content: "a posting" },
      chatAttachedFiles: [
        { name: "scan.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" },
      ],
    }));
    const text = screenText();

    expect(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE).toContain("Clear");
    expect(text).toContain("Clear");

    expect(chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE).toContain("Context");
    expect(text).toContain("Context");
    expect(container.querySelector('[aria-label="Remove context"]')).not.toBeNull();

    expect(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE).toMatch(/remove an attachment/i);
    expect(container.querySelectorAll(".MuiChip-deleteIcon").length).toBeGreaterThan(0);
  });
});


// ===========================================================================
// AC-31h -- the Send button is the SECOND control the "never disable" ruling
//           has to cover, and rev 6 only covered the first
// ===========================================================================
//
// AC-31b clause 1 points a MutationObserver at the COMPOSER's `disabled`
// attribute, and on this tree that observer records []. The Send button --
// the control the keyboard user just activated -- records a disable/enable
// pair in BOTH fixtures. A browser blurs a focused control the moment it
// becomes `disabled`, so the user is dropped to <body>; and `runChatRequest`'s
// `finally` runs the restore only `if (!refusedBeforeSend)`, so on the refused
// path nobody brings them back. That is verbatim the outcome AC-31b's own
// note calls "strictly worse than the rev-4 behaviour rev 6 replaced",
// relocated one control to the right, where clause 1's observer is not
// looking.
//
// THE OBVIOUS FIX DOES NOT WORK, which is why this describe pins the shape and
// not just the absence. Deleting `chatSending` from
// `disabled={chatSending || !chatInput.trim()}` leaves the button disabled
// anyway: `sendChatMessage` calls `setChatInput("")` on entry, so
// `!chatInput.trim()` is true for the whole flight on its own. MEASURED --
// fixture A never commits `chatSending` at all and STILL records
// ["DISABLE","ENABLE"] on this control. The state has to stop being `disabled`
// altogether.
//
// AND `aria-disabled` IS THE REPLACEMENT, not "no state at all". The
// double-send guard is already in JS (`if (!text || chatSending) return`, and
// `resendUserMessage`'s `if (chatSending) return`), so the `disabled`
// ATTRIBUTE is redundant as a correctness device and is doing only harm:
// it removes the control from the tab order, strips its focus, and -- because
// MUI renders a native <button> here -- makes it unclickable in a way the JS
// guard already covers. `aria-disabled` keeps the state announced and the
// control focusable and named. [MEASURED, this repo] a MUI `Button` given
// `aria-disabled` and no `disabled` renders `<button aria-disabled="true">`
// with `tabIndex 0` and its accessible name intact.
describe("ChatPanel: AC-31h -- Send is never `disabled`, and the state moves to `aria-disabled`", () => {
  const send = () =>
    [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Send");

  it("with nothing typed, Send carries `aria-disabled` -- not `disabled` -- and keeps its name and tab stop", async () => {
    await render(baseProps({ chatInput: "" }));
    const btn = send();
    expect(btn, "no Send button rendered -- every assertion below would be vacuous").toBeDefined();

    // The whole finding, in one line: a disabled control cannot hold focus,
    // and this is the control the user just activated.
    expect(
      btn.hasAttribute("disabled"),
      "Send renders `disabled` -- a browser blurs it to <body>, and the refused path never restores",
    ).toBe(false);
    expect(btn.disabled).toBe(false);

    // ...replaced by, not merely stripped of, its state. Without this half a
    // build that deletes `disabled` and offers nothing in its place passes,
    // and a screen-reader user is told nothing about why pressing Send does
    // nothing.
    expect(
      btn.getAttribute("aria-disabled"),
      "Send's unavailable state is not exposed to assistive tech at all",
    ).toBe("true");

    // Still operable-shaped: in the tab order, and still named "Send".
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
    expect((btn.textContent || "").trim()).toBe("Send");
    expect(btn.getAttribute("aria-label")).toBeNull();
  });

  it("PAIRED POSITIVE CONTROL: with text typed, the aria-disabled state is gone", async () => {
    // Without this the case above is satisfied by a button that is
    // permanently `aria-disabled="true"` -- state that never changes is not
    // state, and a screen-reader user would be told Send is unavailable while
    // it works.
    await render(baseProps({ chatInput: "review my resume" }));
    const btn = send();
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("aria-disabled") === "true").toBe(false);
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it("the unavailable state is still VISIBLE, not only announced", async () => {
    // Dropping `disabled` also drops MUI's `.Mui-disabled` styling, so a
    // sighted user loses the greyed-out cue unless the fix puts one back.
    // Asserted as "the two states are visually different" rather than as a
    // specific colour or opacity, so any honest implementation satisfies it
    // and a fix that forgets the visual half does not.
    //
    // The instrument is `className` PLUS the emitted rules, not the rules
    // alone. MUI expresses the disabled look through a state CLASS
    // (`Mui-disabled`) layered on the same generated `css-*` class, so
    // `emittedCssFor` returns a byte-identical string for both states and,
    // used on its own, would compare "" to "" and report a difference where
    // there is none -- and no difference where there is one. Today the
    // discrimination comes from `Mui-disabled`; after the fix it has to come
    // from whatever the implementation puts in its place, and either shows up
    // here.
    const look = (el) => `${el.className}||${emittedCssFor(el)}`;

    await render(baseProps({ chatInput: "" }));
    const off = look(send());
    await render(baseProps({ chatInput: "review my resume" }));
    const on = look(send());

    // INSTRUMENT CANARY: prove both reads actually resolved rules for these
    // nodes before trusting a comparison between them.
    expect(off, "emittedCssFor read no rules for the unavailable state").toMatch(/css-/);
    expect(on, "emittedCssFor read no rules for the available state").toMatch(/css-/);
    expect(
      off,
      "Send looks identical whether or not it can be pressed -- the visual affordance was dropped with `disabled`",
    ).not.toBe(on);
  });
});

// ===========================================================================
// AC-27b -- THE REMEDY RULE is about operability, not existence
// ===========================================================================
//
// AC-27's existing case asserts that the chip's remove affordance EXISTS while
// the refusal names it. Existence is not what SC 3.3.3 Error Suggestion needs;
// the suggestion has to be one the user can actually carry out. [MEASURED] the
// shipped chip is a `<div role="button" tabindex="0">` whose accessible name
// is the FILE NAME, whose delete icon is `aria-hidden` with no name and no tab
// stop, and whose only working key is Backspace -- an MUI-internal convention
// announced nowhere. Enter does nothing. Space does nothing.
//
// So the AT journey the refusal sets up is: hear "Remove an attachment ... and
// try again", tab to a control announced as "scan.png, button", press Enter --
// nothing -- press Space -- nothing. The user hears the instruction and cannot
// follow it, which makes the refusal's remedy false for exactly the population
// the whole rev-6 announcement mechanism was built for.
describe("ChatPanel: AC-27b -- the remedy the refusal names is OPERABLE, not just present", () => {
  const chipRoot = () => container.querySelector(".MuiChip-root");

  const press = async (el, key) => {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    });
  };

  it("INSTRUMENT CANARY: a dispatched Enter/Space DOES reach a clickable MUI Chip in this jsdom", async () => {
    // Everything below asserts that keys reach the panel's chip. If a
    // dispatched KeyboardEvent could not activate an MUI Chip here at all,
    // those assertions would be red for a harness reason and would stay red
    // against a correct fix. This proves the instrument first.
    const onClick = vi.fn();
    await act(async () => {
      root.render(createElement(Chip, { size: "small", label: "canary.png", onClick }));
    });
    const el = chipRoot();
    expect(el, "no chip rendered by the canary").not.toBeNull();
    await press(el, "Enter");
    expect(onClick, "a dispatched Enter does not reach an MUI Chip's onClick in this jsdom").toHaveBeenCalled();
    const afterEnter = onClick.mock.calls.length;
    await press(el, " ");
    expect(onClick.mock.calls.length, "a dispatched Space does not reach an MUI Chip's onClick").toBeGreaterThan(afterEnter);
  });

  it("the chip is NAMED for what it does, and the name still contains its visible label", async () => {
    const setChatAttachedFiles = vi.fn();
    await render(baseProps({
      chatAttachedFiles: [{ name: "scan.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" }],
      setChatAttachedFiles,
    }));
    const el = chipRoot();
    expect(el, "no chip rendered").not.toBeNull();

    // POSITIVE CONTROL: this really is the control the refusal names.
    expect(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE).toMatch(/remove an attachment/i);

    // SC 4.1.2 Name, Role, Value: a control whose whole purpose is removal
    // must say so. "scan.png, button" says nothing about what activating it
    // will do.
    const name = el.getAttribute("aria-label") || (el.textContent || "").trim();
    expect(name, "the chip's accessible name does not say it removes anything").toMatch(/remove/i);
    // SC 2.5.3 Label in Name: the visible label is the file name, so the
    // accessible name has to contain it -- speech-input users say what they
    // see.
    expect(name).toContain("scan.png");
    expect((el.textContent || "")).toContain("scan.png");
  });

  it("Enter and Space actually remove the attachment -- Backspace is not the only key", async () => {
    for (const key of ["Enter", " "]) {
      const setChatAttachedFiles = vi.fn();
      await render(baseProps({
        chatAttachedFiles: [{ name: "scan.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" }],
        setChatAttachedFiles,
      }));
      const el = chipRoot();
      expect(el).not.toBeNull();
      expect(el.tabIndex, "the chip is not in the tab order, so no key can ever reach it").toBeGreaterThanOrEqual(0);

      await press(el, key);
      expect(
        setChatAttachedFiles,
        `pressing ${JSON.stringify(key)} on the chip did nothing -- the refusal names a control the keyboard cannot operate`,
      ).toHaveBeenCalled();
    }
  });

  it("REGRESSION GUARD: Backspace still removes it, so the fix ADDS keys rather than swapping them", async () => {
    const setChatAttachedFiles = vi.fn();
    await render(baseProps({
      chatAttachedFiles: [{ name: "scan.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" }],
      setChatAttachedFiles,
    }));
    await press(chipRoot(), "Backspace");
    expect(setChatAttachedFiles).toHaveBeenCalled();
  });

  it("PAIRED POSITIVE CONTROL: the removal really removes THIS chip, not just fires a setter", async () => {
    // An absence-free control on the two cases above: `setChatAttachedFiles`
    // being called proves a handler ran, not that it removes the right entry.
    // Drive the updater the panel passes and check what comes out.
    const setChatAttachedFiles = vi.fn();
    const files = [
      { name: "scan.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" },
      { name: "notes.txt", kind: "text", content: "hi" },
    ];
    await render(baseProps({ chatAttachedFiles: files, setChatAttachedFiles }));
    await press(chipRoot(), "Enter");

    expect(
      setChatAttachedFiles,
      "Enter on the chip removed nothing, so there is no removal to inspect",
    ).toHaveBeenCalled();
    const updater = setChatAttachedFiles.mock.calls.at(-1)[0];
    expect(typeof updater, "the panel did not pass a functional updater").toBe("function");
    expect(updater(files).map((f) => f.name)).toEqual(["notes.txt"]);
  });
});

// ---------------------------------------------------------------------------
// The real hook wired to the real panel. Everything below drives
// `useChat` -> `createChatHandlers` -> `ChatPanel` with no stand-ins, because
// the two defects are both COMPOSITION defects: every half is individually
// correct and the announcement/focus behaviour only exists in the join.
// ---------------------------------------------------------------------------

describe("ChatPanel + useChat: what a size refusal does to the live region and to focus", () => {
  let savedFetch;
  const api = { current: null };

  beforeEach(() => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error("the refusal must happen BEFORE fetch"); });
  });
  afterEach(() => { globalThis.fetch = savedFetch; });

  function Harness({ resumeFile }) {
    const chat = useChat({
      resumeFile,
      applicationData: [],
      applicationStages: {},
      mainTab: "jobs",
      activeSection: null,
    });
    api.current = chat;
    return createElement(ChatPanel, { ...chat, fabPos: { bottom: 24, right: 24 } });
  }

  // MUI's multiline TextField renders a second, aria-hidden textarea purely to
  // measure height; the visible one is the composer and the one chatInputRef
  // points at.
  const composer = () => container.querySelector("textarea:not([aria-hidden])");
  const sendButton = () =>
    [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Send");

  // 4.7 MB of base64 in one attachment: the body is over MAX_REQUEST_BYTES by
  // ~200 KB, `attachedFiles` is the largest section by three orders of
  // magnitude, and the refusal is byte-identical every time it is triggered --
  // which is exactly the repeat AC-34 is about.
  const overCapAttachment = () => ({
    name: "scan.png", kind: "binary", mimeType: "image/png",
    dataB64: "A".repeat(4_700_000), previewUrl: null,
  });

  // FIXTURE B's résumé must be a REAL file read, not an `async () => [...]`
  // stub. `buildTemplateLinesForUpload` reads the Blob, which yields to the
  // MACROTASK queue; an async stub resolves as a microtask and React coalesces
  // straight through it, so the composer is never rendered disabled and the
  // fixture silently reclassifies itself as FIXTURE A -- a test that believes
  // it covers the résumé-present path while covering the other one. The
  // classification is asserted below rather than assumed.
  const realResumeFile = () =>
    new File([new Uint8Array(4096)], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  // Every transition of the composer's `disabled` ATTRIBUTE, read per record
  // (`attributeOldValue` tells us the direction) rather than by sampling the
  // element after the fact, which would collapse a disable/enable pair that
  // landed in one observer callback.
  function watchDisabled(el) {
    const becameDisabled = [];
    const obs = new MutationObserver((records) => {
      for (const r of records) becameDisabled.push(r.oldValue === null);
    });
    obs.observe(el, { attributes: true, attributeFilter: ["disabled"], attributeOldValue: true });
    return {
      stop() {
        for (const r of obs.takeRecords()) becameDisabled.push(r.oldValue === null);
        obs.disconnect();
        return becameDisabled;
      },
    };
  }

  // `overCap` is ADDITIVE and defaults to the behaviour every existing caller
  // already relies on (the 4.7 MB attachment that makes the send refuse before
  // `fetch`). The SUCCESS-path cases added for AC-31g and the `ifLost` guard
  // need the same real hook/panel pair with a body that actually fits, and
  // they are the only callers that pass `false`.
  async function mountChat({ resumeFile = null, overCap = true } = {}) {
    await act(async () => { root.render(createElement(Harness, { resumeFile })); });
    await act(async () => {
      if (overCap) api.current.setChatAttachedFiles([overCapAttachment()]);
      api.current.setChatInput("please review this");
    });
    // FOCUS MUST NOT BE ON THE COMPOSER for any assertion below, and this line
    // is what guarantees it. The restore is `ifLost`-guarded: with focus still
    // on the composer the guard returns early and the focus spy records ZERO
    // calls AGAINST CORRECT CODE -- a test that fails a correct implementation
    // and invites someone to "fix" the source. <body> is also the honest
    // starting state: a dispatched click does not move focus, and a real
    // browser drops focus to <body> the moment the composer is disabled
    // mid-send. Do not delete this.
    document.body.focus();
  }

  async function clickSend() {
    await act(async () => {
      api.current.setChatInput("please review this");
    });
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
  }

  // The focus restore is deferred (AC-31a); wait past the exported delay with
  // real timers rather than racing it.
  async function settleFocus() {
    const delay = chatbot.FOCUS_RESTORE_DELAY_MS;
    expect(typeof delay, "FOCUS_RESTORE_DELAY_MS must be exported").toBe("number");
    await act(async () => { await new Promise((r) => setTimeout(r, delay + 25)); });
  }

  // Bank records from the CALLBACK and merge `takeRecords()`. `takeRecords()`
  // alone is unreliable under `await act()`: the observer callback fires as a
  // microtask and drains the queue first, so by the time the assertion runs
  // there is nothing left to take.
  function watch(node) {
    const seen = [];
    const obs = new MutationObserver((records) => {
      for (const r of records) seen.push(r.type);
    });
    obs.observe(node, { childList: true, characterData: true, subtree: true });
    return {
      stop() {
        for (const r of obs.takeRecords()) seen.push(r.type);
        obs.disconnect();
        return seen;
      },
    };
  }

  it("PRECONDITION: the fixture really is refused before fetch, and reaches the screen", async () => {
    await mountChat();
    await clickSend();

    expect(globalThis.fetch).not.toHaveBeenCalled();          // AC-18
    expect(api.current.chatError).toBeTruthy();
    expect(screenText()).toContain(api.current.chatError);
    expect(api.current.chatInputRef.current).toBe(composer());
  }, 30000);

  it("AC-34: a SECOND identical refusal still mutates the live region (fixture A, no résumé)", async () => {
    // MEASURED BEFORE THE FIX: []. React coalesces setChatError("")
    // (`runChatRequest`'s pre-send `setChatError("")`, `chatbot.js`) and
    // setChatError(msg) (its `catch`) into one commit whose value
    // equals the previous value, so the region emits nothing and the user --
    // who just pressed Resend or Send again -- hears silence.
    await mountChat();
    await clickSend();
    const first = api.current.chatError;

    const region = liveRegion();
    expect(region, "AC-33's always-mounted region is what makes this observable").not.toBeNull();
    const w = watch(region);

    await clickSend();
    const records = w.stop();

    expect(api.current.chatError).toBe(first);          // the text really is identical
    expect(liveRegion()).toBe(region);                  // the node was not remounted
    expect(records.length, "the live region emitted no mutation on the repeat").toBeGreaterThan(0);
    expect(region.textContent).toBe(first);
  }, 30000);

  it("AC-31b rev 6: a refused send leaves focus on <body> -- nothing moves it (fixture A)", async () => {
    // Deliberately NOT the assertion AC-31's blockquote bans. That one is
    // "focus is STILL on the composer" after `disabled` is set -- and it is
    // measurably green with or without the fix, because jsdom does not move
    // activeElement when an already-focused element becomes disabled.
    //
    // This asserts something different and measurably RED today: focus starts
    // on <body> and must MOVE. [EXECUTED, jsdom 29.1.1] `focus()` on a
    // disabled element that is not already the active element is IGNORED here,
    // exactly as a browser ignores it -- so this cannot be satisfied by a
    // synchronous focus() in the `finally` either. (AC.md rev 3's claim that
    // "jsdom lets focus() succeed on a disabled element" holds only in the
    // degenerate case where the element was already focused; see the report.)
    // REVERSED BY AC-31 rev 6, and this is the case that shows why the old
    // requirement was the defect rather than the fix. Screen readers cancel
    // in-progress speech on a focus change; the refusal is ~38 words (6-9 s)
    // and the restore fired at 80 ms, so the announcement this whole chunk
    // exists to deliver was cut off after roughly one syllable -- by A2's own
    // focus half.
    //
    // Rev 6's answer is that the composer is never disabled on the refused
    // path, so focus is never taken and none has to be given back. The
    // consequence for THIS fixture -- a click on Send with focus starting on
    // <body> -- is that focus STAYS on <body>. That is asserted here rather
    // than glossed: it is the honest outcome of the ruling, and the ruling
    // records why the two alternatives (restoring anyway, or focusing the live
    // region) are both worse.
    //
    // AC-31c: the precondition is ASSERTED, not assumed. `document.body.focus()`
    // is a no-op while another element holds focus (rev 4 fact 3), so a test
    // that merely called it would be relying on nothing.
    await mountChat();
    expect(document.activeElement, "AC-31c: precondition not established").toBe(document.body);

    await clickSend();
    await settleFocus();

    expect(
      document.activeElement,
      "focus moved on a refused send -- that cancels the refusal announcement (AC-35 rev 6)",
    ).toBe(document.body);

    // PAIRED POSITIVE CONTROLS, so the absence above is not satisfied by a
    // panel that did nothing at all: the refusal really landed on screen, and
    // the user's question really came back (AC-30).
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(api.current.chatError).toBeTruthy();
    expect(screenText()).toContain(api.current.chatError);
    expect(composer().value).toBe("please review this");
  }, 30000);

  it("U-B1 (jsdom stand-in): focus LOST FROM THE COMPOSER mid-send is given back", async () => {
    // PLAN §5.4's U-B1 item, which was the one part of the folded-away
    // useChat.announce.test.js with no equivalent here. AC-31b above starts
    // from "nothing has ever been focused"; this starts from the state a real
    // keyboard user is actually in -- they typed in the composer, pressed
    // Enter, and the browser dropped focus to <body> when the composer became
    // disabled mid-send. Those are different preconditions, and only this one
    // exercises the sequence the criterion is about.
    //
    // The explicit `blur()` IS the browser behaviour, written out: jsdom does
    // NOT blur an element that becomes `disabled`, so without this line the
    // composer stays `activeElement`, the `ifLost` guard correctly declines to
    // act, and the test would assert nothing while looking like it passed.
    // REV 6 TURNS THIS INTO THE HEADLINE POSITIVE CONTROL. U-B1's scenario --
    // a keyboard user who typed in the composer and pressed Enter -- is the
    // one AC-31 rev 6 is written for, and the requirement is no longer "focus
    // is taken away and given back" but "focus is never taken away at all".
    // The composer is not disabled while sending, so there is no blur to
    // simulate and no restore to wait for: the user simply keeps their
    // caret, and their screen reader finishes reading why the send failed.
    //
    // The explicit `.blur()` the old version needed is GONE on purpose. It
    // existed to stand in for a browser behaviour (blur-on-disable) that rev 6
    // makes unreachable, and leaving it in would have manufactured the very
    // focus loss the fix removes.
    await mountChat();
    const el = composer();
    el.focus();
    expect(document.activeElement, "the composer could not be focused").toBe(el);

    await clickSend();
    await settleFocus();

    // The composer is never rendered disabled, so nothing ever moved focus.
    expect(el.disabled, "the composer was disabled mid-send -- a browser would blur it").toBe(false);
    expect(
      document.activeElement,
      "the keyboard user lost their place during a refused send",
    ).toBe(composer());

    // PAIRED POSITIVE CONTROLS: a refusal really did happen and the question
    // really came back, so "focus never moved" is not "nothing happened".
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(api.current.chatError).toBeTruthy();
    expect(composer().value).toBe("please review this");
  }, 30000);

  // Every add/removal of the "Thinking…" node, taken from the RECORDS rather
  // than by sampling the DOM afterwards: `chatSending` goes true and back to
  // false inside one `clickSend`, so anything that samples after the fact sees
  // nothing in either fixture and reports the two as identical.
  function watchThinking(node) {
    const seen = [];
    const take = (records) => {
      for (const r of records) {
        if (r.type !== "childList") continue;
        for (const n of r.addedNodes) {
          if ((n.textContent || "").includes("Thinking")) seen.push("add");
        }
        for (const n of r.removedNodes) {
          if ((n.textContent || "").includes("Thinking")) seen.push("remove");
        }
      }
    };
    const obs = new MutationObserver(take);
    obs.observe(node, { childList: true, subtree: true });
    return {
      stop() {
        take(obs.takeRecords());
        obs.disconnect();
        return seen;
      },
    };
  }

  // A second, independent mount inside one test, so the classification can
  // compare the two fixtures against each other instead of asserting one half
  // and trusting the other. The outer `afterEach` unmounts whatever `root`
  // ends up pointing at, so the only thing to do by hand is retire the mount
  // being replaced.
  async function remountFresh() {
    await act(async () => { root.unmount(); });
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.current = null;
  }

  async function classifySend(mountOpts) {
    await mountChat(mountOpts);
    const w = watchThinking(container);
    await clickSend();
    return { thinking: w.stop(), error: api.current.chatError };
  }

  it("FIXTURE CLASSIFICATION: the résumé fixture forces a chatSending commit that fixture A coalesces away", async () => {
    // RE-BASED 2026-09-04, and the re-base is the finding, so it is written
    // out rather than left as a title change.
    //
    // This case exists to prove the harness's two fixtures are genuinely
    // different, so that every case asserting per-fixture behaviour is not
    // silently running the same path twice. Its discriminator USED TO BE "the
    // composer renders disabled", and AC-31 rev 6 removed the composer from
    // `chatSending`'s consumers -- so the discriminator went away with the
    // defect it was reading, and the case failed while describing nothing
    // wrong. Retiring it was the wrong answer: the fixtures still diverge, at
    // the seam one level up.
    //
    // MEASURED 2026-09-04 on this tree, instrumented mount + click, both the
    // first send and an identical repeat, values verbatim:
    //
    //   fixture A (resumeFile: null)          thinking [], mutation records 5
    //   fixture B (resumeFile: realResumeFile) thinking ["add","remove"], records 8
    //
    // and IDENTICAL in both fixtures: `chatError` (byte-for-byte the same
    // refusal), the composer's `disabled` transitions ([] -- the fix), the
    // composer's and the panel's post-dispatch state, `chatInput`,
    // `chatMessages` (["user:failed"]), and `document.activeElement`
    // (<body>). The Send button's `disabled` transitions are [true, false] in
    // BOTH: that control is `disabled={chatSending || !chatInput.trim()}` and
    // `sendChatMessage`'s `setChatInput("")` drives it on its own, so it is
    // NOT a discriminator and a classification built on it would have been
    // green on two identical fixtures. Measured, not assumed.
    //
    // WHAT THE ONE SURVIVING DIFFERENCE IS. With no résumé there is no `await`
    // anywhere between `setChatSending(true)` and the size throw, so
    // `runChatRequest` runs to its `finally` synchronously and React coalesces
    // `true` and `false` into one commit: `chatSending` is NEVER committed and
    // the "Thinking…" node is never created. With a résumé,
    // `buildTemplateLinesForUpload` reads a real Blob, which yields to the
    // MACROTASK queue, React flushes the pending commit, and the node is
    // created and then removed. That is the exact property AC-32 names, and it
    // is the same mechanism the old `disabled` discriminator was reading --
    // one consumer of `chatSending` further out, where rev 6 did not touch it.
    //
    // WHY IT STILL MATTERS, not just that it still works: because fixture A
    // never commits `chatSending` at all, fixture A CANNOT witness a
    // regression that puts `disabled={chatSending}` back on the composer --
    // there would be no committed `true` for the composer to render. That is
    // not a deduction; it was MEASURED 2026-09-04 on a control the fix did
    // NOT touch. The Resend button is still `disabled={chatSending}`
    // (ChatPanel.js, the Resend control), and watching its `disabled`
    // attribute across a send gives:
    //
    //   fixture A  []              -- never rendered disabled
    //   fixture B  [true, false]   -- disabled and re-enabled
    //
    // So fixture B is the only fixture in this file that can fail if the
    // composer is re-wired to `chatSending`, and that is exactly what the
    // AC-31a case below rests on -- every `disabled` absence asserted on
    // fixture A is vacuous against that regression. If the two fixtures ever
    // collapse into one, that case stops guarding the fix and nothing else in
    // this file says so. This is that alarm.
    //
    // MUTANTS (executed; see the report): mounting fixture B with
    // `resumeFile: null` kills it, and mounting fixture A with
    // `realResumeFile()` kills it -- i.e. it fails from either direction the
    // moment the two fixtures are made the same.
    const b = await classifySend({ resumeFile: realResumeFile() });
    await remountFresh();
    const a = await classifySend({});

    expect(
      b.thinking,
      "fixture B never committed chatSending -- the résumé read is not deferring, so this is fixture A wearing fixture B's name",
    ).toContain("add");
    expect(
      a.thinking,
      "fixture A committed chatSending -- the two fixtures are no longer distinct and every per-fixture assertion in this file is running one path twice",
    ).toEqual([]);

    // PAIRED POSITIVE CONTROLS (AC-31c clause 2): `a.thinking` is an ABSENCE,
    // and an absence is free in a harness where Send is inert or the panel
    // never mounted. Both fixtures really refused, before `fetch`, with the
    // same message -- so the difference above is a difference in SCHEDULE, not
    // in outcome, which is precisely the claim.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(b.error, "fixture B did not refuse").toBeTruthy();
    expect(a.error, "the two fixtures did not produce the same refusal").toBe(b.error);
  }, 30000);

  it("AC-31a rev 6: NO focus() call at all, and the composer is never disabled (fixture B, résumé uploaded)", async () => {
    // This is the trap AC-31a exists for, and fixture B is where it bites
    // today: the real file read in `runChatRequest`'s `resumeFile` branch
    // (`buildTemplateLinesForUpload`, `chatbot.js`) defers a MACROTASK, which
    // forces the disabled render, and `setChatSending(false)` in the `finally`
    // is a QUEUED React update -- at the instant the `finally` runs the
    // composer is still disabled in the DOM. A fix that focuses there passes a
    // naive spy and does nothing in production.
    // AC-31a is MOOT on this path under rev 6, not deleted: it still governs
    // anywhere a focus call legitimately happens, i.e. a path that really did
    // disable the composer. Rev 6 removes both halves of its premise here --
    // there is no focus call and there is no disabled render -- so what this
    // case now pins is the MECHANISM that makes it moot, which is the part a
    // regression would break first. AC-32: it must hold with the résumé
    // present too, so this is the fixture-B half of the absence.
    await mountChat({ resumeFile: realResumeFile() });
    expect(document.activeElement).toBe(document.body);

    const el = composer();
    const w = watchDisabled(el);
    const focusCalls = [];
    const spy = vi.spyOn(el, "focus").mockImplementation(function focusSpy() {
      focusCalls.push(el.disabled);
    });

    await clickSend();
    await settleFocus();
    spy.mockRestore();

    // The composer is never rendered disabled -- not once, in either
    // direction. This is the whole fix: `chatSending` still flips (the
    // double-send guard and the "Thinking…" indicator are untouched), but the
    // composer input is no longer one of its consumers.
    expect(
      w.stop(),
      "the composer was rendered disabled during a refused send -- a browser would blur it and the announcement would be cut off",
    ).not.toContain(true);
    expect(focusCalls, "focus() was called on a refused send").toEqual([]);

    // PAIRED POSITIVE CONTROLS: the refusal fired, on the résumé fixture.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(api.current.chatError).toBeTruthy();
    expect(composer().value).toBe("please review this");
  }, 30000);

  it("AC-31 + AC-34 TOGETHER: the two halves cannot be landed separately (fixture A)", async () => {
    // §1.3's coupling, as one failing test. Forcing the flush that makes
    // fixture A announce also flushes the pending setChatSending(true), so
    // fixture A begins rendering the composer disabled where it never did --
    // i.e. the announcement fix INTRODUCES the focus loss on the one path that
    // did not have it. Land the announcement alone and the focus assertion
    // here goes red; land the focus restore alone and the mutation assertion
    // does.
    //
    // The coupling is exactly TWO-way: announcement and focus. The TEXT
    // RESTORE is deliberately NOT asserted here -- it does not depend on the
    // flush and is tested on its own, in the case below and in
    // lib/chat/chatbot.refusal.test.js. Adding it to this pair would make one
    // failure indistinguishable from three.
    //
    // B3 -- WHY THE PRECONDITION IS RE-ESTABLISHED RATHER THAN ASSERTED.
    // The first send ARMS the deferred focus restore (AC-31a, 80 ms). Simply
    // asserting `activeElement === document.body` after it raced that timer:
    // green when the three `act` calls inside `clickSend` happened to finish
    // inside the window, RED against CORRECT code under full-suite worker
    // contention. Measured 2 failures in 3 full-suite runs, and reproduced
    // deterministically by inserting a ~120 ms `act` pause here. A test that
    // fails correct code on the one case whose job is to prove the two halves
    // cannot be landed apart makes a real regression and a scheduling hiccup
    // indistinguishable, and invites the next person to weaken it.
    //
    // So: let the first restore LAND, then put focus back on <body> by hand.
    // `blur()` is a no-op if focus never moved, so the state is the same
    // either way -- and the final assertion now depends on the SECOND send's
    // restore rather than possibly inheriting the first one's.
    //
    // NOTE FOR ANYONE TEMPTED TO SHORTEN THE DEFERRAL: that racy line used to
    // be the ONLY thing that failed a 0 ms deferral. It is not any more, and
    // deleting it here would have removed a kill silently. The deferral is now
    // pinned deterministically in lib/chat/chatbot.refusal.test.js -- "the
    // deferral really is FOCUS_RESTORE_DELAY_MS long" -- on fake timers, where
    // no scheduler can flake it.
    // WHAT REV 6 DID TO THIS COUPLING, because the pairing is not the same one
    // any more and pretending otherwise would leave a test asserting a
    // mechanism that no longer exists.
    //
    // §1.3's coupling was: `flushSync` forces the pending setChatSending(true)
    // to commit, so fixture A starts rendering the composer DISABLED where it
    // never did -- i.e. the announcement fix introduced the focus loss, and
    // the focus restore was needed to repair it. Rev 6 removes the composer
    // from `chatSending`'s consumers entirely, so the flush can no longer
    // disable anything and the focus loss it used to introduce is unreachable.
    // The two halves are no longer "announce" + "restore"; they are "announce"
    // + "and doing so must not take focus away".
    //
    // That is still exactly two things and still fails if either half is
    // landed alone: land the flush while the composer is still
    // `disabled={chatSending}` and the disabled assertion goes red; drop the
    // flush and the mutation assertion does.
    await mountChat();
    const el = composer();
    el.focus();
    expect(document.activeElement).toBe(el);

    await clickSend();
    await settleFocus();

    const region = liveRegion();
    expect(region).not.toBeNull();
    const w = watch(region);
    const d = watchDisabled(el);

    await clickSend();
    const records = w.stop();
    await settleFocus();

    expect(records.length, "no announcement on the repeat").toBeGreaterThan(0);
    expect(
      d.stop(),
      "the announcement flush re-introduced the disabled render, which is what took focus away",
    ).not.toContain(true);
    expect(
      document.activeElement,
      "focus left the composer while a 6-9 second announcement was being read",
    ).toBe(composer());
  }, 30000);

  it("AC-30/AC-36: the refused question is back in the composer, and the panel shows it", async () => {
    await mountChat();
    await clickSend();

    expect(api.current.chatInput).toBe("please review this");
    expect(composer().value).toBe("please review this");
  }, 30000);

  it("the ifLost guard: focus already parked on another control is NOT stolen", async () => {
    // The half the node suite structurally cannot cover -- there
    // `typeof document === "undefined"` degrades the guard to an unconditional
    // restore. If the user tabbed to Clear while the send was in flight,
    // yanking focus back is a worse defect than the one being fixed.
    //
    // THIS TEST IS CORRECT AND MUST NOT BE WEAKENED. It has already been read
    // once as "a test that fails correct code"; it is not. Measured against a
    // reference built from PLAN-A2 §5.1 Edit 4: it PASSES when the `ifLost`
    // check runs where M-6 requires -- INSIDE `focusComposerEnd`'s deferred
    // `try` -- and FAILS (focus ends on the composer, exactly the reported
    // symptom) when the check is instead evaluated synchronously in
    // `restoreComposerFocusIfLost` before the `setTimeout` is armed.
    //
    // The mechanism, which is also M-6's second reason for existing: this is
    // the résumé-ABSENT fixture, so there is no await between the send
    // starting and the size throw. The whole try/catch/finally therefore
    // completes inside the click dispatch below, one statement BEFORE
    // `clear.focus()` runs. A synchronous guard samples `document.activeElement`
    // at that moment -- <body> -- concludes focus was lost, and 80 ms later
    // steals it back from a control the user has since moved to. Deferring the
    // check asks the question when it is actually meaningful: after the
    // composer is re-enabled and after the user has had the whole in-flight
    // window to tab away.
    //
    // So a red here is an IMPLEMENTATION defect (M-6 ignored), not a fixture
    // problem. Do not re-point this at the résumé-present fixture and do not
    // relax the assertion.
    await mountChat();
    const clear = [...container.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === "Clear");
    expect(clear, "Clear should be offered once the tray is non-empty").toBeDefined();

    await act(async () => {
      api.current.setChatInput("please review this");
    });
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      clear.focus();
    });
    await act(async () => {});
    await settleFocus();

    expect(document.activeElement).toBe(clear);
  }, 30000);

  // -------------------------------------------------------------------------
  // Shared instruments for the four cases below. All additive: nothing above
  // this point changes.
  // -------------------------------------------------------------------------

  // The AC-31g progress region, as distinct from BOTH other role="status"
  // nodes in this panel: the failed-turn cue (inside a `[data-chat-turn]`) and
  // the `chatError` region (which `liveRegion()` above finds). Selected by an
  // explicit hook rather than by position, because "the second status node"
  // would silently re-point itself the day another notice is added.
  const progressRegion = () => container.querySelector('[data-chat-status="progress"]');

  // A `fetch` whose resolution this test controls, so the IN-FLIGHT window is
  // observable rather than raced. `release()` completes the request.
  function gatedOkFetch(reply) {
    let release;
    const gate = new Promise((r) => { release = r; });
    globalThis.fetch = vi.fn(async () => {
      await gate;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ reply }),
        json: async () => ({ reply }),
      };
    });
    return { release: async () => { await act(async () => { release(); }); await act(async () => {}); } };
  }

  function okFetch(reply = "here is what I would change") {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ reply }),
      json: async () => ({ reply }),
    }));
  }

  // Fire Send and let the microtask/macrotask queues settle, WITHOUT the
  // `setChatInput` re-seed `clickSend` does -- the success-path cases need the
  // composer's real post-send state.
  async function activateSend() {
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  // ===========================================================================
  // AC-31g -- a SUCCESSFUL send is announced. This is the 99% path, and rev 6
  //           left it completely silent.
  // ===========================================================================
  //
  // WHAT REV 6 REMOVED AND DID NOT REPLACE. Before rev 6 the composer carried
  // `disabled={chatSending}`. In a browser that blurs the focused composer,
  // and `restoreComposerFocusIfLost` re-focused it ~80 ms after the request
  // settled -- so NVDA/JAWS announced a newly focused text field ("Message AI
  // Help, edit, multiline"). Crude, accidental, and the ONLY completion cue a
  // blind candidate ever had. Rev 6 correctly stops disabling the composer, so
  // focus never leaves, so the restore never fires, so that cue is gone.
  //
  // [MEASURED on this tree] what is left on the success path: exactly ONE
  // live-ish region (`[role=status][aria-live=polite]`), which is the
  // `chatError` region, and it is EMPTY; the assistant's reply is not inside
  // any live region; "Thinking…" is a bare <div> with no role, no aria-live
  // and no aria-busy; and there is no `aria-busy` anywhere in the panel. A
  // blind candidate presses Enter and hears nothing at 0 ms, nothing at 3 s,
  // and nothing when the reply lands. On EVERY send.
  //
  // WHY NOT PUT THE REPLY IN A LIVE REGION -- the obvious fix, and the wrong
  // one. `role="status"` carries an implicit `aria-atomic="true"`, so the
  // region is re-read WHOLE on every change; a normal-length answer is
  // hundreds of words, and it would be spoken as one uninterruptible
  // utterance the user cannot navigate, pause or review with a reading cursor.
  // `role="log"` (atomic false, additions only) avoids the re-read but still
  // speaks the entire answer aloud, and is the least reliably supported of the
  // live-region roles in VoiceOver. The reply is already reachable as ordinary
  // text with a review cursor; what is missing is not the CONTENT, it is the
  // EVENT.
  //
  // SO: A SHORT CUE, in its own always-mounted polite region, saying only that
  // the state changed. Three states, one utterance each, none of them the
  // answer:
  //
  //   sending -> a short "in flight" cue
  //   ready   -> a short "the reply is here" cue
  //   failed  -> the progress region goes EMPTY and the refusal is the
  //              `chatError` region's alone (AC-31f), so two polite regions
  //              never change in the same commit -- announcement order between
  //              two polite regions in one commit is unspecified across AT,
  //              and the refusal must not be the one that loses the race.
  //
  // Two utterances per send, ~3 words total, and only ever on an actual send:
  // comparable in volume to the accidental cue rev 6 removed, and strictly
  // more informative. It reaches AT with focus still in the composer, which is
  // this design's existing bet and holds for all three engines: NVDA and JAWS
  // announce polite `role="status"` updates regardless of focus location and
  // regardless of browse/forms mode, and VoiceOver announces `role="status"`
  // -- its known weak spot being in-place text replacement, which is why the
  // cue node is REPLACED rather than mutated, exactly as AC-34 does.
  //
  // `aria-busy` IS REQUIRED AND IS NOT THE ANNOUNCEMENT. No screen reader
  // speaks an `aria-busy` change; its job is to mark the turn list as
  // mid-update. That is why it must NOT wrap either live region: `aria-busy`
  // on an ancestor of a live region SUPPRESSES that region's announcements
  // until it clears, so a careless placement would silence the refusal
  // AC-31f rests on -- a worse defect than the one being fixed. The last
  // clause below is what forbids it.
  describe("AC-31g: a successful send is announced, without reading the reply aloud", () => {
    it("the progress region is always mounted, empty, and is NOT the chatError region", async () => {
      okFetch();
      await mountChat({ overCap: false });

      const region = progressRegion();
      expect(region, "no always-mounted progress region -- a send start/finish is announced to nobody").not.toBeNull();
      expect(region.getAttribute("role")).toBe("status");
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.textContent).toBe("");
      // A region mounted at the moment its text appears is unreliably
      // announced (AC-33's whole rationale), and hiding it removes it from the
      // accessibility tree just as surely as not rendering it.
      expect(region.hasAttribute("hidden")).toBe(false);
      expect(region.getAttribute("aria-hidden")).toBeNull();
      expect(region.style.display).not.toBe("none");
      expect(region.style.visibility).not.toBe("hidden");
      // Distinct node from AC-33's error region: one channel per meaning.
      expect(region).not.toBe(liveRegion());
      expect(liveRegion(), "AC-33's error region must not have been replaced by this one").not.toBeNull();
    });

    it("announces SENDING, then READY -- short, distinct, and never the reply itself", async () => {
      const REPLY = "Lead each bullet with the outcome. ".repeat(20);
      const gate = gatedOkFetch(REPLY);
      await mountChat({ overCap: false });

      const region = progressRegion();
      expect(region, "no progress region to observe").not.toBeNull();
      const w = watch(region);

      await activateSend();

      // --- IN FLIGHT -------------------------------------------------------
      expect(api.current.chatSending, "the fixture is not actually in flight").toBe(true);
      const sending = (progressRegion().textContent || "").trim();
      expect(sending, "nothing is announced when a send STARTS").not.toBe("");
      expect(
        sending.length,
        "the sending cue is long enough to be a message rather than a cue -- it is spoken on every send",
      ).toBeLessThanOrEqual(40);
      expect(sending).toMatch(/sending|thinking|working/i);

      // aria-busy marks the TURN LIST as mid-update...
      const busy = container.querySelector('[aria-busy="true"]');
      expect(busy, "nothing carries aria-busy while a send is in flight").not.toBeNull();
      // ...and must not wrap either live region, or it silences them.
      expect(
        progressRegion().closest('[aria-busy="true"]'),
        "the progress region sits inside an aria-busy subtree -- its announcements are suppressed",
      ).toBeNull();
      expect(
        liveRegion().closest('[aria-busy="true"]'),
        "the chatError region sits inside an aria-busy subtree -- AC-31f's only channel is suppressed",
      ).toBeNull();

      // --- REPLY LANDS -----------------------------------------------------
      await gate.release();
      const records = w.stop();

      expect(api.current.chatSending).toBe(false);
      const ready = (progressRegion().textContent || "").trim();
      expect(ready, "nothing is announced when the reply ARRIVES").not.toBe("");
      expect(ready, "the sending and ready cues are the same string -- the user cannot tell them apart").not.toBe(sending);
      expect(ready.length, "the ready cue is long enough to be the answer rather than a cue").toBeLessThanOrEqual(40);
      expect(ready).toMatch(/ready|answer|repl/i);
      // The whole point of a short cue: the answer is NOT spoken by the region.
      expect(progressRegion().textContent).not.toContain(REPLY);
      expect(progressRegion().textContent.length).toBeLessThan(REPLY.length);

      // AC-34's mechanism, for AC-31g's region: the node carrying the cue is
      // destroyed and recreated on each transition, so an announcement is an
      // unambiguous tree modification rather than an in-place text diff --
      // the shape VoiceOver handles most reliably.
      const added = records.filter((t) => t === "childList").length;
      expect(added, "the cue text is mutated in place rather than re-keyed (AC-34's mechanism)").toBeGreaterThanOrEqual(2);

      // aria-busy clears with the flight.
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();

      // PAIRED POSITIVE CONTROLS (AC-31c clause 2). Every assertion above is
      // about a cue; these are what prove a real send really happened, so the
      // cue is not being read off a panel that did nothing.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(api.current.chatError).toBe("");
      expect(api.current.chatMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(screenText()).toContain(REPLY.trim());
    }, 30000);

    it("a REFUSED send never claims a reply is ready, and leaves the refusal to the chatError region", async () => {
      // The third state. Without this the cue is satisfied by a region that
      // says "ready" whenever a send ends, however it ended -- which would
      // tell a blind candidate an answer had arrived when what arrived was a
      // refusal.
      await mountChat();                       // the over-cap fixture: refused before fetch
      await clickSend();
      await settleFocus();

      const region = progressRegion();
      expect(region, "no progress region at all").not.toBeNull();
      const text = (region.textContent || "").trim();
      expect(text, "the progress region announced a ready reply on a REFUSED send").not.toMatch(/ready|answer|repl/i);
      expect(text, "the progress region is still announcing an in-flight send after it settled").not.toMatch(/sending|thinking|working/i);

      // AC-31f: the refusal is the chatError region's, and only its. Two
      // polite regions changing in one commit have unspecified announcement
      // order across AT, and the refusal must not be the one that loses.
      expect(liveRegion().textContent).toBe(api.current.chatError);
      expect(text).not.toContain(api.current.chatError);

      // PAIRED POSITIVE CONTROLS: a real refusal really did happen.
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(api.current.chatError).toBeTruthy();
      expect(screenText()).toContain(api.current.chatError);
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    }, 30000);
  });

  // ===========================================================================
  // AC-31h (fixture-driven half) -- the Send button's `disabled` transitions
  // ===========================================================================
  //
  // The static half is in `describe("ChatPanel: AC-31h ...")` above, on plain
  // props. This is the half AC-31b clause 1 specifies for the composer,
  // pointed at the control the user actually activated: a MutationObserver on
  // the `disabled` ATTRIBUTE across a whole refused send, read per record so a
  // disable/enable pair landing in one observer callback is not collapsed.
  //
  // FIXTURE ASSIGNMENT, MEASURED RATHER THAN INHERITED. AC-31b's fixture note
  // says a `disabled` observer can only fail on fixture B, because fixture A
  // never commits `chatSending`. That is true OF THE COMPOSER and it is NOT
  // true of this control: `sendChatMessage` clears the input on entry, so
  // `!chatInput.trim()` disables Send on its own, and MEASURED on this tree
  // BOTH fixtures record ["DISABLE","ENABLE"] here. Fixture B is still the
  // required one -- it is the only fixture where `chatSending` itself can
  // drive the attribute, so it is the only one that can witness a future
  // regression that re-wires this control to `chatSending`. Fixture A is
  // asserted too, and is not vacuous: it is the fixture that witnesses the
  // `!chatInput.trim()` half, i.e. the half that survives the obvious
  // "just delete `chatSending` from the expression" fix.
  //
  // NOT ASSERTED, DELIBERATELY: `document.activeElement` on the Send button.
  // jsdom does not blur an element that becomes `disabled` (rev 4 fact 1), so
  // "focus is still on Send" is green with and without the fix and would be a
  // test that cannot fail. The attribute observer is the only jsdom-reachable
  // witness, which is exactly why AC-31b made it a numbered clause.
  function watchSendDisabled() {
    const btn = sendButton();
    const seen = [];
    const obs = new MutationObserver((records) => {
      for (const r of records) seen.push(r.oldValue === null ? "DISABLE" : "ENABLE");
    });
    obs.observe(btn, { attributes: true, attributeFilter: ["disabled"], attributeOldValue: true });
    return {
      stop() {
        for (const r of obs.takeRecords()) seen.push(r.oldValue === null ? "DISABLE" : "ENABLE");
        obs.disconnect();
        return seen;
      },
    };
  }

  it("AC-31h: the Send button is never rendered `disabled` mid-send (fixture B, résumé uploaded)", async () => {
    await mountChat({ resumeFile: realResumeFile() });
    const w = watchSendDisabled();
    const btn = sendButton();

    await clickSend();
    await settleFocus();

    expect(
      w.stop(),
      "the Send button was rendered disabled during a refused send -- a browser blurs it to <body>, and `if (!refusedBeforeSend)` means nothing brings the user back",
    ).not.toContain("DISABLE");
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.isConnected, "the observer was watching a detached node").toBe(true);

    // PAIRED POSITIVE CONTROLS (AC-31c clause 2): the refusal really fired on
    // the résumé fixture, so the absence above is not "nothing happened".
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(api.current.chatError).toBeTruthy();
    expect(screenText()).toContain(api.current.chatError);
    expect(composer().value).toBe("please review this");
  }, 30000);

  it("AC-31h: ...and on fixture A too, where the input-clear alone drives it", async () => {
    await mountChat();
    const w = watchSendDisabled();

    await clickSend();
    await settleFocus();

    expect(
      w.stop(),
      "the Send button was rendered disabled on the no-résumé fixture -- `setChatInput(\"\")` disables it even where `chatSending` is never committed",
    ).not.toContain("DISABLE");

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(api.current.chatError).toBeTruthy();
    expect(composer().value).toBe("please review this");
  }, 30000);

  // ===========================================================================
  // The `ifLost` guard, on a path where the restore ACTUALLY RUNS
  // ===========================================================================
  //
  // The existing "the ifLost guard: focus already parked on another control is
  // NOT stolen" case drives the REFUSED fixture, where rev 6's
  // `if (!refusedBeforeSend)` means `restoreComposerFocusIfLost` is never
  // called at all: its `expect(document.activeElement).toBe(clear)` is true
  // because nothing ever tried to move focus. MEASURED: deleting the guard
  // entirely, and moving it to a synchronous pre-check before the timer is
  // armed -- the exact mutation `composerFocus.js`'s M-6 comment says makes
  // that case fail -- both survive the whole 442-file suite.
  //
  // A path where the restore runs is a SUCCESSFUL send. And the timing is what
  // makes it discriminating, so it is written out rather than left implicit:
  //
  //   t=0     Send activated, focus on <body>
  //   t~0     fetch resolves, `finally` runs, `focusComposerEnd` arms an 80 ms
  //           timer. A SYNCHRONOUS guard would evaluate here, see <body>,
  //           conclude "lost", and arm unconditionally.
  //   t~1     the user tabs to Clear.
  //   t=80    correct code re-asks the question INSIDE the deferred callback,
  //           sees Clear, and declines. A deleted or synchronous guard steals
  //           focus from a control the user is standing on.
  //
  // So this case kills BOTH mutations, and the refused-fixture case above
  // kills neither.
  it("the ifLost guard, on a SUCCESSFUL send: focus moved into the restore window is NOT stolen", async () => {
    okFetch("here is what I would change");
    await mountChat({ overCap: false });
    await act(async () => {
      api.current.setChatMessages([{ role: "user", content: "an earlier question" }]);
    });
    const clear = [...container.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === "Clear");
    expect(clear, "Clear is not offered, so there is nowhere to park focus").toBeDefined();
    expect(document.activeElement, "AC-31c: the starting state is asserted, not assumed").toBe(document.body);

    await activateSend();
    // The request has settled and the restore timer is armed. NOW the user
    // moves -- inside the window, which is the whole scenario.
    clear.focus();
    expect(document.activeElement, "Clear could not be focused").toBe(clear);
    await settleFocus();

    expect(
      document.activeElement,
      "focus was yanked out of Clear 80 ms after a send the user had already moved on from",
    ).toBe(clear);

    // PAIRED POSITIVE CONTROLS: a real, successful round-trip happened, so
    // "focus did not move" is not "the send never ran".
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(api.current.chatError).toBe("");
    expect(api.current.chatMessages.at(-1).role).toBe("assistant");
  }, 30000);

  it("PAIRED POSITIVE CONTROL: with focus still on <body>, the same send DOES restore the composer", async () => {
    // Without this, the case above is satisfied by an implementation with no
    // restore at all -- the dead-feature trap. This is the half that proves
    // the machinery the guard guards is live.
    okFetch("here is what I would change");
    await mountChat({ overCap: false });
    expect(document.activeElement).toBe(document.body);

    await activateSend();
    await settleFocus();

    expect(
      document.activeElement,
      "a successful send never restored focus to the composer -- the ifLost guard has nothing to guard",
    ).toBe(composer());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(api.current.chatMessages.at(-1).role).toBe("assistant");
  }, 30000);

  // ===========================================================================
  // AC-30 mid-flight -- the RB1 trade, pinned where §K flag 6 described the
  //                     opposite
  // ===========================================================================
  //
  // §K flag 6 states that "AC-30 UNCONDITIONALLY assigns `chatInput` on a
  // refusal, so a user who types a follow-up during a slow send that then
  // fails loses it with no undo." The shipped code does the OPPOSITE: RB1's
  // guard `if (!live || live === text)` declines the restore when the live
  // composer holds anything else, so the DRAFT wins and AC-30's restore is
  // silently not applied. Nothing tested it in either direction.
  //
  // The trade is the right one -- a draft the user is mid-way through typing
  // is unrecoverable, whereas the submitted question survives in the failed
  // bubble with Resend beside it -- but it costs AC-30 on a reachable path,
  // and an untested trade is indistinguishable from a bug. This pins it, with
  // the recovery route asserted alongside so "AC-30 does not hold here" is
  // never read as "the question was lost".
  it("AC-30 mid-flight (fixture B): a draft typed during the send WINS, and the question survives in the failed turn", async () => {
    await mountChat({ resumeFile: realResumeFile() });
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // SAME SYNCHRONOUS TURN as the click, and that is load-bearing rather
      // than incidental. `sendChatMessage` runs to its first `await` inside
      // the dispatch, so `setChatInput("")` and this line land in ONE React
      // batch and commit "draft typed during flight" to the composer BEFORE
      // the résumé read's macrotask resolves -- which is what puts a real
      // draft in `chatInputRef.current.value` at the moment
      // `sendChatMessage` resumes and asks RB1's question.
      //
      // MEASURED, and the reason the obvious alternative is not used: with an
      // `await new Promise((r) => setTimeout(r, 0))` before this line the
      // whole refusal has ALREADY completed -- `live` is `""`, RB1 restores
      // the question, and this assignment then overwrites it afterwards. The
      // case would assert "chatInput is the draft" and pass no matter what
      // the guard did; an unconditional `setChatInput(text)` survives it.
      // Instrumented (`live`/`willRestore` logged from inside
      // `sendChatMessage`): this shape reports
      // `live="draft typed during flight" willRestore=false`, the setTimeout
      // shape reports `live="" willRestore=true`.
      api.current.setChatInput("draft typed during flight");
    });
    await act(async () => {});
    await settleFocus();

    // POSITIVE CONTROLS FIRST: a real refusal, before `fetch`.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(api.current.chatError).toBeTruthy();

    // RB1: the draft is not overwritten. AC-30's restore does NOT apply here.
    expect(
      api.current.chatInput,
      "the mid-flight draft was overwritten by AC-30's restore -- the user loses it with no undo",
    ).toBe("draft typed during flight");
    expect(composer().value).toBe("draft typed during flight");

    // ...and the submitted question is not lost, which is what makes the
    // trade acceptable: it is in the failed turn, with Resend beside it.
    const failed = container.querySelector('[data-chat-turn="failed"]');
    expect(failed, "the submitted question is nowhere -- the trade is a data loss, not a trade").not.toBeNull();
    expect(failed.textContent).toContain("please review this");
    expect(
      [...failed.querySelectorAll("button")].some((b) => /resend/i.test(b.getAttribute("aria-label") || b.textContent || "")),
      "no Resend control on the failed turn -- the question is visible but unrecoverable",
    ).toBe(true);
  }, 30000);
});
