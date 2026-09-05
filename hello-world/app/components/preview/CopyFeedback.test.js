// @vitest-environment jsdom
//
// ACCEPTANCE tests for AC-C11 (the result is announced, and no outcome is ever
// silent) at the level of the strip and its hook.
//
// NO CLIPBOARD STUB IN THIS FILE, deliberately (plan section 1.5.3 rule 2).
// `CopyFeedbackStrip` takes {polite, alert, visible, seq} as props and
// `useCopyFeedback` takes finished outcome objects; neither ever touches a
// clipboard. Installing a stub here would be dead weight that invites
// copy-paste into a suite that then silently depends on it.
//
// react-dom/client createRoot + act, the pattern
// DocumentPreviewDialog.drive.test.js uses. No @testing-library anywhere in
// this repo.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useCopyFeedback, CopyFeedbackStrip } from "./CopyFeedback.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SUCCESS = { polite: "Resume text copied.", alert: "", visible: "Resume text copied.", persist: false };
const REFUSAL = { polite: "", alert: "The resume is still loading. Try again in a moment.", visible: "The resume is still loading. Try again in a moment.", persist: false };
const FAILURE = {
  polite: "",
  alert: "Couldn't copy the resume. Select the document text and copy it manually.",
  visible: "Couldn't copy the resume. Select the document text and copy it manually.",
  persist: true,
};

let container;
let root;
// The hook's return value, captured from inside the render so the tests can
// drive `announce`/`clear` the way the dialog does.
let api = null;

function Harness({ clearKey = "resume|view|0|true" } = {}) {
  const copy = useCopyFeedback(clearKey);
  api = copy;
  return createElement(CopyFeedbackStrip, copy.regionProps);
}

beforeEach(() => {
  api = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(Harness, props));
  });
}

async function announce(outcome) {
  await act(async () => {
    api.announce(outcome);
  });
}

// Selected by the explicit data attribute, never by role: in the DIALOG,
// `document.querySelector('[role="status"]')` resolves to DriveResultRegion's
// region, which the DOM-order invariant puts ABOVE this strip. Using the same
// selector in both places is what keeps the two suites' habits identical.
const politeRegion = () => container.querySelector('[data-copy-status="polite"]');
const alertRegion = () => container.querySelector('[data-copy-status="alert"]');
const chip = () => container.querySelector('[data-copy-status="chip"]');

describe("harness sanity control", () => {
  it("renders the strip and exposes the hook -- if this is red, nothing else here can be trusted", async () => {
    await render();
    expect(politeRegion()).toBeTruthy();
    expect(typeof api.announce).toBe("function");
    expect(typeof api.clear).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// AC-C11.2 -- both regions mounted UNCONDITIONALLY and EMPTY
// ---------------------------------------------------------------------------

describe("AC-C11.2: two keyed visuallyHidden regions, mounted unconditionally and empty", () => {
  it("mounts both regions on the first render, with no text in either", async () => {
    // answerStatus.js's header records the rule this discharges: "a live
    // region that MOUNTS at the same moment its final text is already inside
    // it usually does NOT get announced ... only a TEXT CHANGE on an
    // already-mounted region does." The MUI Dialog unmounts its children on
    // close, so "unconditional" means for the whole open lifetime.
    await render();
    expect(politeRegion()).toBeTruthy();
    expect(alertRegion()).toBeTruthy();
    expect(politeRegion().textContent).toBe("");
    expect(alertRegion().textContent).toBe("");
  });

  it("gives the success region role=status + aria-live=polite and the failure region role=alert", async () => {
    // Success is POLITE so it does not interrupt; every non-success is an
    // ALERT so it does not queue behind polite Drive chatter
    // (mui-a11y-traps item 4).
    await render();
    expect(politeRegion().getAttribute("role")).toBe("status");
    expect(politeRegion().getAttribute("aria-live")).toBe("polite");
    expect(alertRegion().getAttribute("role")).toBe("alert");
  });

  it("the VISIBLE chip carries no role and no aria-live -- a third live channel would double-announce", async () => {
    await render();
    expect(chip()).toBeTruthy();
    expect(chip().getAttribute("role")).toBeNull();
    expect(chip().getAttribute("aria-live")).toBeNull();
    // Positive control for the instrument: the same reader DOES find the
    // attributes on the two regions above, so a null here is a real null.
    expect(politeRegion().getAttribute("role")).toBe("status");
  });

  it("both live regions are visually hidden; the chip is not", async () => {
    // Not cosmetics: DriveActions.js's header records what happened the last
    // time two nodes in this slot both rendered the same caption -- every user
    // saw each one twice, in two different colours.
    await render();
    await announce(SUCCESS);
    for (const region of [politeRegion(), alertRegion()]) {
      const style = getComputedStyle(region);
      expect(style.position).toBe("absolute");
      expect(style.width).toBe("1px");
      expect(style.height).toBe("1px");
      expect(style.overflow).toBe("hidden");
    }
    // POSITIVE CONTROL: the same instrument reads the chip as a normal,
    // visible node -- so the four assertions above are facts about the
    // regions and not about a getComputedStyle that answers "1px" for
    // everything.
    expect(getComputedStyle(chip()).width).not.toBe("1px");
    expect(getComputedStyle(chip()).position).not.toBe("absolute");
  });
});

// ---------------------------------------------------------------------------
// AC-C11.2 -- exactly one region carries a given message
// ---------------------------------------------------------------------------

describe("AC-C11.2: exactly one region ever carries a given message", () => {
  it("a SUCCESS feeds polite, and the alert region is exactly the empty string", async () => {
    await render();
    await announce(SUCCESS);
    // NEGATIVE CONTROL, in the shape plan section 1.5.3 rule 5 mandates: the
    // region that should carry text is non-empty AND the other is exactly "".
    // `expect(region.textContent).not.toBe("")` on one region alone is the
    // assertion that goes green on the wrong region, and it is banned.
    expect(politeRegion().textContent).toBe(SUCCESS.polite);
    expect(alertRegion().textContent).toBe("");
    expect(chip().textContent).toBe(SUCCESS.visible);
  });

  it("a REFUSAL feeds alert, and the polite region is exactly the empty string", async () => {
    await render();
    await announce(REFUSAL);
    expect(alertRegion().textContent).toBe(REFUSAL.alert);
    expect(politeRegion().textContent).toBe("");
    expect(chip().textContent).toBe(REFUSAL.visible);
  });

  it("a failure after a success leaves NO stale success text standing", async () => {
    await render();
    await announce(SUCCESS);
    await announce(FAILURE);
    expect(politeRegion().textContent).toBe("");
    expect(alertRegion().textContent).toBe(FAILURE.alert);
  });
});

// ---------------------------------------------------------------------------
// AC-C11.5 -- null, never an empty keyed span
// ---------------------------------------------------------------------------

describe("AC-C11.5: an empty region renders null, NEVER <span key={seq}>{\"\"}</span>", () => {
  it("has zero element children when empty and exactly one when fed", async () => {
    // An empty span exists either way and an empty text node is not an
    // announcement: writing it makes AC-C11.4's whole property vacuous while
    // every mutation-count assertion stays green.
    await render();
    expect(politeRegion().children).toHaveLength(0);
    expect(alertRegion().children).toHaveLength(0);

    await announce(SUCCESS);
    expect(politeRegion().children).toHaveLength(1);
    expect(politeRegion().children[0].tagName).toBe("SPAN");
    // ...and the region that carries nothing still has no node at all.
    expect(alertRegion().children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-C11.4 -- THE PROPERTY: two identical outcomes must BOTH announce
// ---------------------------------------------------------------------------

describe("AC-C11.4: a byte-identical repeat is a real DOM mutation, not an empty text diff", () => {
  // Records are banked from the observer CALLBACK and merged with a final
  // takeRecords() -- the merge is load-bearing under `await act()` and is
  // documented at DriveResultRegion.test.js's
  // "MAJOR M-4: the ALERT region mutates across a failure -> retry ->
  // IDENTICAL failure sequence, not just the polite region".
  async function mutationsAcrossRepeat(outcome, region) {
    await render();
    await announce(outcome);
    const node = region();
    const records = [];
    const observer = new window.MutationObserver((rs) => records.push(...rs));
    observer.observe(node, { characterData: true, childList: true, subtree: true });
    // Step 2 of the mandated procedure: reset the record array, so what is
    // counted is the SECOND announcement alone.
    records.length = 0;
    await announce(outcome);
    records.push(...observer.takeRecords());
    observer.disconnect();
    return { records, node };
  }

  it("a repeated SUCCESS mutates the polite region", async () => {
    const { records, node } = await mutationsAcrossRepeat(SUCCESS, politeRegion);
    expect(records.length).toBeGreaterThan(0);
    // Paired with a positive assertion that a real message is present, so the
    // row cannot pass over an empty region.
    expect(node.textContent).toBe(SUCCESS.polite);
  });

  it("a repeated REFUSAL mutates the alert region -- the case none of the design documents pinned", async () => {
    // Without this, a user who presses the dimmed button twice hears the
    // reason ONCE -- and it is silent specifically for the screen-reader user,
    // who is the one the control is deliberately kept in the tab order for.
    const { records, node } = await mutationsAcrossRepeat(REFUSAL, alertRegion);
    expect(records.length).toBeGreaterThan(0);
    expect(node.textContent).toBe(REFUSAL.alert);
  });

  it("the VISIBLE chip mutates on the repeat too -- the sighted twin of the property", async () => {
    // Today's copyEmail is silent for a sighted user on a second identical
    // copy for the identical React reason: setCopyFeedback("Copied") with
    // "Copied" already on screen, React bails, and the only observable effect
    // is a reset setTimeout.
    const { records, node } = await mutationsAcrossRepeat(SUCCESS, chip);
    expect(records.length).toBeGreaterThan(0);
    expect(node.textContent).toBe(SUCCESS.visible);
  });

  it("POSITIVE CONTROL: the same observer sees NOTHING when nothing is announced", async () => {
    // Without this row, an observer that fires on unrelated churn would make
    // the three assertions above green regardless of the keyed node.
    await render();
    await announce(SUCCESS);
    const records = [];
    const observer = new window.MutationObserver((rs) => records.push(...rs));
    observer.observe(politeRegion(), { characterData: true, childList: true, subtree: true });
    records.length = 0;
    await act(async () => {}); // a commit that announces nothing
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records).toHaveLength(0);
  });

  it("the counter is a KEY only and is never rendered", async () => {
    await render();
    for (let i = 0; i < 4; i += 1) await announce(SUCCESS);
    for (const node of [politeRegion(), alertRegion(), chip()]) {
      expect(node.textContent).not.toMatch(/\d/);
    }
    // Positive control: the messages really are on screen, so "no digit" is
    // not a fact about three empty nodes.
    expect(politeRegion().textContent).toBe(SUCCESS.polite);
  });
});

// ---------------------------------------------------------------------------
// 1c section 7.3 -- duration, persistence, and the four clear triggers
// ---------------------------------------------------------------------------

describe("1c section 7.3: a success dismisses after 3 s; a clipboard failure PERSISTS", () => {
  it("clears a success after 3000 ms, matching the shipped copyEmail timer", async () => {
    vi.useFakeTimers();
    await render();
    await announce(SUCCESS);
    expect(politeRegion().textContent).toBe(SUCCESS.polite);
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(politeRegion().textContent).toBe(SUCCESS.polite); // still standing just before
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(politeRegion().textContent).toBe("");
    expect(chip().textContent).toBe("");
  });

  it("clears a refusal after 3000 ms as well -- same constant, one timer", async () => {
    vi.useFakeTimers();
    await render();
    await announce(REFUSAL);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(alertRegion().textContent).toBe("");
  });

  it("does NOT clear a clipboard failure -- auto-dismissing an INSTRUCTION mid-read is a defect", async () => {
    vi.useFakeTimers();
    await render();
    await announce(FAILURE);
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(alertRegion().textContent).toBe(FAILURE.alert);
    expect(chip().textContent).toBe(FAILURE.visible);
  });

  it("leaves no timer running after unmount", async () => {
    vi.useFakeTimers();
    await render();
    await announce(SUCCESS);
    // Corpus self-test: a timer really is pending, so the zero below is not a
    // statement about a hook that never scheduled one.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => {
      root.unmount();
    });
    // The dialog's own unmount effect drops the timer clear it used to own
    // (that line goes with the deleted copyFeedbackTimerRef), so if the hook
    // does not take it over the timer is simply orphaned. React 19 makes a
    // setState on an unmounted root a silent no-op, so "it did not throw" is
    // NOT an observation -- the pending timer itself is.
    expect(vi.getTimerCount()).toBe(0);
    // Re-create so afterEach's unmount has a live root.
    root = createRoot(container);
  });
});

describe("1c section 7.3 / AC-C2: stale feedback is cleared on every state change that replaces the document", () => {
  it("clear() empties both regions and the chip", async () => {
    await render();
    await announce(FAILURE); // the persisting one, so only an explicit clear can remove it
    await act(async () => {
      api.clear();
    });
    expect(politeRegion().textContent).toBe("");
    expect(alertRegion().textContent).toBe("");
    expect(chip().textContent).toBe("");
  });

  it("a change of the clear key clears -- the tab / mode / reloadKey / open-reseed trigger", async () => {
    // "Resume text copied." still showing after the user switches to the
    // cover tab tells them the cover letter is on their clipboard when it is
    // not. The reloadKey case is worse: a revise, a focus change, a research
    // weave or a version switch replaces the content on screen with the user
    // taking no action at all.
    await render({ clearKey: "resume|view|0|true" });
    await announce(FAILURE);
    expect(alertRegion().textContent).toBe(FAILURE.alert);

    await render({ clearKey: "cover|view|0|true" });
    expect(alertRegion().textContent).toBe("");
    expect(politeRegion().textContent).toBe("");
    expect(chip().textContent).toBe("");
  });

  it("re-rendering with the SAME clear key does not clear a standing message", async () => {
    // POSITIVE CONTROL for the row above: without it, a hook that cleared on
    // every render would pass it.
    await render({ clearKey: "resume|view|0|true" });
    await announce(FAILURE);
    await render({ clearKey: "resume|view|0|true" });
    expect(alertRegion().textContent).toBe(FAILURE.alert);
  });
});
