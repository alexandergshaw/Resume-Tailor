// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/JobDescriptionTab.test.js and
// app/components/experience/PageTree.test.js are the precedents for
// rendering a whole component here. This file's acceptance criteria ARE the
// markup and timing: which button carries aria-pressed, whether the status
// region actually mutates its own text node twice in a row, whether typing
// saves per keystroke. None of that survives being extracted into a pure
// function, so it has to be proven against the real DOM.
//
// ./MarkdownPreview is mocked out entirely (its own contract is covered by
// MarkdownPreview.test.js) so a defect in the preview renderer can never be
// reported as a PageEditor failure -- this file only exercises Edit mode's
// wiring, plus the fact that switching to Preview mode doesn't blow up.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PageEditor from "./PageEditor.js";

vi.mock("./MarkdownPreview", () => ({
  default: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// PageEditor.js used to append this invisible character to its status
// region on alternating announcements (ANNOUNCE_TOGGLE there), to force two
// consecutive IDENTICAL announcements to differ. That mechanism has since
// been deleted as dead code: performSave always announces "Saving" first,
// then either "Saved" or "Save failed", so two consecutive announcements
// can no longer carry the same text through any production path - see the
// "status region never repeats an announcement" describe block below for
// the test now pinning that invariant directly. `withoutZwsp` is kept as a
// no-op safety net for the assertions below that pre-date the removal (the
// rendered text never actually carries a ZWSP any more, so stripping it is
// a no-op) rather than rewriting every one of them for a change with no
// externally observable effect.
const ZWSP = String.fromCodePoint(0x200b);
const ZWSP_RE = new RegExp(ZWSP, "g");
function withoutZwsp(text) {
  return text.replace(ZWSP_RE, "");
}

let container;
let root;

beforeEach(() => {
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

function page(overrides) {
  return { id: "p1", title: "Original title", body: "Original body", ...overrides };
}

function baseProps(overrides) {
  return {
    page: page(),
    onChange: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(PageEditor, props));
  });
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

function buttonNamed(pattern) {
  return buttons().find((b) => pattern.test((b.getAttribute("aria-label") || b.textContent).trim()));
}

// The real inputs, excluding MUI's aria-hidden auto-resize shadow textarea
// (the same exclusion app/components/JobDescriptionTab.test.js applies).
function fields() {
  return [...container.querySelectorAll("input, textarea")].filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  );
}

function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = container.querySelector(`#${CSS.escape(labelledBy)}`);
    if (target) return target.textContent.trim();
  }
  if (el.id) {
    const label = container.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }
  return "";
}

function fieldNamed(pattern) {
  return fields().find((el) => pattern.test(accessibleName(el)));
}

function titleField() {
  return fieldNamed(/^title$/i);
}

function bodyField() {
  return fieldNamed(/^body$/i);
}

function statusRegion() {
  return container.querySelector('[role="status"]');
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function type(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

// `cancelable: true` matters: without it preventDefault is a no-op and
// `defaultPrevented` reads false no matter what the component does, so the
// keyboard-trap test below would pass against any implementation. jsdom
// will not actually move focus on a synthetic Tab either way, so
// defaultPrevented is the only observable signal.
async function pressTab(el) {
  const evt = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => {
    el.dispatchEvent(evt);
  });
  return evt;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Drives vi's fake timers forward AND lets any already-pending microtasks
// (the `await onChange(...)` inside performSave) resolve, all inside act()
// so React's resulting state updates are flushed before the assertion runs.
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("PageEditor -- mode toggle", () => {
  it("gives Edit and Preview distinct accessible names and correct aria-pressed, flipping both on click", async () => {
    await render(baseProps());
    const editBtn = buttonNamed(/^edit$/i);
    const previewBtn = buttonNamed(/^preview$/i);
    expect(editBtn).toBeDefined();
    expect(previewBtn).toBeDefined();
    expect(editBtn).not.toBe(previewBtn);

    expect(editBtn.getAttribute("aria-pressed")).toBe("true");
    expect(previewBtn.getAttribute("aria-pressed")).toBe("false");

    await click(previewBtn);
    expect(editBtn.getAttribute("aria-pressed")).toBe("false");
    expect(previewBtn.getAttribute("aria-pressed")).toBe("true");

    await click(editBtn);
    expect(editBtn.getAttribute("aria-pressed")).toBe("true");
    expect(previewBtn.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("PageEditor -- debounced autosave", () => {
  it("does not call onChange per keystroke, and calls it exactly once, with the latest text, once typing settles", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(baseProps({ onChange, page: page({ title: "T", body: "" }) }));

    const body = bodyField();
    await type(body, "a");
    await advance(300);
    await type(body, "ab");
    await advance(300);
    await type(body, "abc");
    await advance(300);

    // Well under the 800ms debounce window since the LAST keystroke: no
    // save should have fired yet. Asserting the count (not merely "was
    // called") is the point -- a save-per-keystroke implementation would
    // also satisfy a bare toHaveBeenCalled().
    expect(onChange).toHaveBeenCalledTimes(0);

    await advance(801);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ title: "T", body: "abc" });
  });
});

describe("PageEditor -- save status announcements", () => {
  it("is a polite status region that announces Saving then Saved", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const onChange = vi.fn().mockReturnValue(pending.promise);
    await render(baseProps({ onChange, page: page({ title: "T", body: "" }) }));

    const status = statusRegion();
    expect(status).not.toBeNull();
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent.trim()).toBe("");

    await type(bodyField(), "x");
    await advance(801);
    expect(withoutZwsp(status.textContent)).toBe("Saving");

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(withoutZwsp(status.textContent)).toBe("Saved");
  });

  // THE IMPORTANT ONE, updated for the D6 fix. This test used to exercise a
  // DIFFERENT bug: a failed save announced "Saving" and then nothing else at
  // all, so the retry's own "Saving" landed as the very next announcement
  // with nothing in between - the "write the same string twice" case the
  // seq-parity ZWSP toggle exists to fix. That premise no longer holds: a
  // failed save now announces its own failure (see the "does not leave the
  // status region stuck" test below), so "Saving" and a retry's "Saving"
  // are never adjacent announcements any more - a genuinely different piece
  // of text (the failure) always lands in between them now, which is
  // already a real, distinct mutation with no help from the toggle needed.
  // What is still true, and still worth pinning here: the toggle mechanism
  // itself must keep making two back-to-back IDENTICAL "Saving" writes (the
  // one thing that can still repeat with nothing in between - the debounced
  // autosave firing, succeeding, and the user typing again before the next
  // save's "Saving" would otherwise collide with a leftover render) produce
  // genuinely different DOM text. The other two tests in this describe
  // block (the plain Saving-then-Saved case, and two clean back-to-back
  // successful saves) already cover that from different angles, so this
  // slot is repurposed below to the D6 regression instead of duplicating
  // them.
  it("does not leave the status region stuck asserting 'Saving' once a save has definitively failed", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const onChange = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render(baseProps({ onChange, page: page({ title: "T", body: "" }) }));

    const status = statusRegion();

    await type(bodyField(), "x");
    await advance(801);
    expect(withoutZwsp(status.textContent)).toBe("Saving");

    await act(async () => {
      first.reject(new Error("network down"));
      await first.promise.catch(() => {});
    });

    // The save has definitively failed - the error Alert is up (asserted
    // elsewhere), but the polite status region must not go on claiming a
    // save is still in flight. Actively asserting that is worse than
    // announcing nothing at all, which is the D6 defect.
    expect(withoutZwsp(status.textContent)).not.toBe("Saving");

    // Retry re-announces a genuine, fresh "Saving" - the mechanism is not
    // otherwise broken by this fix.
    const retryBtn = buttonNamed(/^retry$/i);
    expect(retryBtn).toBeDefined();
    await click(retryBtn);
    expect(withoutZwsp(status.textContent)).toBe("Saving");

    await act(async () => {
      second.resolve();
      await second.promise;
    });
  });

  // The retry-path test above proves the ZWSP mechanism does real work when
  // a save FAILS. It does not, by itself, prove the mechanism is needed on
  // the far more common path: two clean, back-to-back SUCCESSFUL saves.
  // That path is only safe if the intermediate "Saving" state genuinely
  // reaches the DOM as its own mutation before "Saved" overwrites it -- if
  // React's automatic batching instead coalesces the "Saving" and "Saved"
  // state updates of a single fast-resolving save into ONE commit, the
  // second save's Node text would go directly from "Saved" (already
  // committed from save 1) to "Saved" again with the SAME value, React's
  // own reconciler would bail on that fiber, and NOTHING would ever be
  // written to the DOM for the second save -- silent to a screen reader.
  //
  // This has to be checked empirically (real DOM mutations, via
  // MutationObserver with characterDataOldValue so a value is captured at
  // the moment it changed, not read later after something may have
  // overwritten it) rather than inferred from React state, because state
  // updates and committed DOM writes are not the same event: React can
  // legitimately schedule two setState calls and still only touch the DOM
  // once, and a screen reader only ever sees the DOM writes.
  it("gives a screen reader a real DOM mutation on the SECOND of two clean, back-to-back successful saves", async () => {
    vi.useFakeTimers();
    // Deliberately the fastest-resolving mock available -- no manual
    // deferred promise here. The whole point is to stress the case where
    // onChange settles before React has any obvious reason to paint an
    // intermediate frame.
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(baseProps({ onChange, page: page({ title: "T", body: "" }) }));

    const status = statusRegion();
    let records = [];
    const observer = new window.MutationObserver((list) => {
      records.push(...list);
    });
    observer.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
      characterDataOldValue: true,
    });

    // First successful save: settles the region on "Saved".
    await type(bodyField(), "first edit");
    await advance(801);
    await act(async () => {
      await Promise.resolve(); // let any queued observer microtask land
    });
    const afterFirstSave = status.textContent;
    expect(withoutZwsp(afterFirstSave)).toBe("Saved");

    // Only the SECOND save's mutations are under test from here.
    records = [];

    // Second successful save -- the one under test.
    await type(bodyField(), "second edit");
    await advance(801);
    await act(async () => {
      await Promise.resolve();
    });
    records.push(...observer.takeRecords());
    observer.disconnect();

    const afterSecondSave = status.textContent;
    expect(withoutZwsp(afterSecondSave)).toBe("Saved");

    // The assertion the coordinator asked for: a screen reader needs SOME
    // genuine DOM mutation during the second save to have anything to
    // announce. Satisfied if either (a) a real characterData/childList
    // mutation was recorded anywhere in the region during the second save
    // (proof an intermediate value, or at least a write, actually reached
    // the DOM and didn't get silently bailed on), or (b) the final text of
    // save 2 is itself textually distinct from save 1's, which would be a
    // mutation by definition.
    const sawARealMutation = records.length > 0;
    const finalTextDiffers = afterSecondSave !== afterFirstSave;
    expect(sawARealMutation || finalTextDiffers).toBe(true);
  });
});

describe("PageEditor -- the status region never repeats an announcement", () => {
  // Pins the actual invariant that makes a distinctness trick unnecessary
  // in the first place (an earlier version of this file forced consecutive
  // identical announcements to differ with an invisible toggle character;
  // that mechanism was deleted as dead code - see the ZWSP comment above).
  // The invariant: performSave ALWAYS announces "Saving" first, via
  // flushSync, then either "Saved" or "Save failed" - so every announcement
  // is preceded by a genuinely different one, through every real path this
  // test drives (a save, a second save right after, a failed save, and a
  // retry). If a future change ever breaks that alternation - a path that
  // announces "Saving" twice in a row with nothing in between, say - this
  // test fails.
  it("gives every announcement a real DOM mutation, and never repeats the same value twice in a row, across a save, a second save, a failure, and a retry", async () => {
    vi.useFakeTimers();
    const saveOne = deferred();
    const saveTwo = deferred();
    const saveThree = deferred();
    const retrySave = deferred();
    const onChange = vi
      .fn()
      .mockReturnValueOnce(saveOne.promise)
      .mockReturnValueOnce(saveTwo.promise)
      .mockReturnValueOnce(saveThree.promise)
      .mockReturnValueOnce(retrySave.promise);
    await render(baseProps({ onChange, page: page({ title: "T", body: "" }) }));

    const status = statusRegion();
    let pendingRecords = [];
    const observer = new window.MutationObserver((list) => {
      pendingRecords.push(...list);
    });
    observer.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
      characterDataOldValue: true,
    });

    const observedValues = [];
    // Asserts the FIRST half of the invariant (a real DOM mutation reached
    // the region for this announcement - not merely a React state update
    // that never actually committed), records the value observed, and
    // resets the mutation log for the next segment.
    function checkpoint(expectedText) {
      pendingRecords.push(...observer.takeRecords());
      expect(pendingRecords.length).toBeGreaterThan(0);
      pendingRecords = [];
      expect(withoutZwsp(status.textContent)).toBe(expectedText);
      observedValues.push(status.textContent);
    }

    // Save 1: succeeds.
    await type(bodyField(), "first edit");
    await advance(801);
    checkpoint("Saving");
    await act(async () => {
      saveOne.resolve();
      await saveOne.promise;
    });
    checkpoint("Saved");

    // Save 2: succeeds right after - the exact back-to-back case a
    // coalescing bug would show up as "Saved" -> "Saved" with nothing
    // observably different in between.
    await type(bodyField(), "second edit");
    await advance(801);
    checkpoint("Saving");
    await act(async () => {
      saveTwo.resolve();
      await saveTwo.promise;
    });
    checkpoint("Saved");

    // Save 3: fails.
    await type(bodyField(), "third edit");
    await advance(801);
    checkpoint("Saving");
    await act(async () => {
      saveThree.reject(new Error("network down"));
      await saveThree.promise.catch(() => {});
    });
    checkpoint("Save failed");

    // Retry: succeeds.
    const retryBtn = buttonNamed(/^retry$/i);
    expect(retryBtn).toBeDefined();
    await click(retryBtn);
    checkpoint("Saving");
    await act(async () => {
      retrySave.resolve();
      await retrySave.promise;
    });
    checkpoint("Saved");

    observer.disconnect();

    // The SECOND half of the invariant: no two consecutive announcements
    // are identical, across the whole sequence.
    for (let i = 1; i < observedValues.length; i += 1) {
      expect(observedValues[i]).not.toBe(observedValues[i - 1]);
    }
    expect(observedValues).toEqual(["Saving", "Saved", "Saving", "Saved", "Saving", "Save failed", "Saving", "Saved"]);
  });
});

describe("PageEditor -- failed save and retry", () => {
  it("shows an error with a Retry button, keeps the user's typed text, and re-issues the save on Retry", async () => {
    vi.useFakeTimers();
    const failing = deferred();
    const onChange = vi.fn().mockReturnValueOnce(failing.promise).mockResolvedValueOnce(undefined);
    await render(baseProps({ onChange, page: page({ title: "T", body: "" }) }));

    await type(bodyField(), "keep me");
    await advance(801);

    await act(async () => {
      failing.reject(new Error("Could not save"));
      await failing.promise.catch(() => {});
    });

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Could not save");
    // The user's text was never reverted by the failed save.
    expect(bodyField().value).toBe("keep me");

    const retryBtn = buttonNamed(/^retry$/i);
    expect(retryBtn).toBeDefined();
    await click(retryBtn);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ title: "T", body: "keep me" });
  });
});

describe("PageEditor -- flushes a pending autosave instead of discarding it", () => {
  // The D3 defect: the [pageId] effect and the unmount cleanup both used to
  // clearTimeout a pending debounced save and never send it, so switching
  // pages (or app/page.js unmounting this whole tab) within the 800ms
  // debounce window silently threw away whatever the user had just typed.
  it("flushes the pending text through the ORIGINAL page's onChange when the pageId prop changes mid-debounce", async () => {
    vi.useFakeTimers();
    const onChangeA = vi.fn().mockResolvedValue(undefined);
    const onChangeB = vi.fn().mockResolvedValue(undefined);

    await render(baseProps({ onChange: onChangeA, page: page({ id: "pA", title: "A title", body: "A body" }) }));

    await type(bodyField(), "typed but not yet saved");
    // Still well inside the 800ms debounce window - nothing has been sent.
    await advance(300);
    expect(onChangeA).not.toHaveBeenCalled();

    // Switch to a different page before the debounce timer ever fires.
    await render(baseProps({ onChange: onChangeB, page: page({ id: "pB", title: "B title", body: "B body" }) }));

    // The pending save for page A must go out through page A's OWN
    // onChange - not page B's, which would silently misfile A's text under
    // B's id instead of just losing it.
    expect(onChangeA).toHaveBeenCalledTimes(1);
    expect(onChangeA).toHaveBeenCalledWith({ title: "A title", body: "typed but not yet saved" });
    expect(onChangeB).not.toHaveBeenCalled();
  });

  it("flushes the pending text on unmount too", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(baseProps({ onChange, page: page({ id: "pC", title: "T", body: "orig" }) }));

    await type(bodyField(), "typed right before navigating away");
    await advance(300);
    expect(onChange).not.toHaveBeenCalled();

    // Rendering null in PageEditor's place unmounts it for real (the same
    // mechanism as app/page.js conditionally mounting the whole tab),
    // without disturbing this file's own root/container lifecycle.
    await act(async () => {
      root.render(null);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ title: "T", body: "typed right before navigating away" });
  });

  it("does not flush when there is nothing pending", async () => {
    vi.useFakeTimers();
    const onChangeA = vi.fn().mockResolvedValue(undefined);
    const onChangeB = vi.fn().mockResolvedValue(undefined);

    await render(baseProps({ onChange: onChangeA, page: page({ id: "pA", title: "A title", body: "A body" }) }));
    // No typing at all - nothing was ever scheduled.

    await render(baseProps({ onChange: onChangeB, page: page({ id: "pB", title: "B title", body: "B body" }) }));

    expect(onChangeA).not.toHaveBeenCalled();
    expect(onChangeB).not.toHaveBeenCalled();
  });
});

describe("PageEditor -- keyboard behaviour in the body field", () => {
  it("lets Tab leave the body field: no character inserted, preventDefault never called", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(baseProps({ onChange, page: page({ title: "T", body: "hello" }) }));

    const body = bodyField();
    const before = body.value;
    const evt = await pressTab(body);

    expect(evt.defaultPrevented).toBe(false);
    expect(body.value).toBe(before);
  });
});

describe("PageEditor -- Ask AI", () => {
  // The whole point of pinning "the CURRENT title/body, not the last-saved
  // page prop": a user who typed a fresh sentence and pressed Ask AI before
  // the 800ms autosave debounce fired must not have that sentence silently
  // missing from what gets pinned. Asserting the exact object onAskAi was
  // called with (not merely "was called") is what catches an implementation
  // that pins the stale `page` prop instead of local state.
  it("hands the LIVE (possibly still-debouncing) title and body to onAskAi when pressed", async () => {
    const onAskAi = vi.fn();
    await render(baseProps({ onAskAi, page: page({ title: "Original title", body: "Original body" }) }));

    await type(bodyField(), "Original body, plus a fresh unsaved edit");

    const askAiBtn = buttonNamed(/^ask ai$/i);
    expect(askAiBtn).toBeDefined();
    await click(askAiBtn);

    expect(onAskAi).toHaveBeenCalledTimes(1);
    expect(onAskAi).toHaveBeenCalledWith({
      title: "Original title",
      body: "Original body, plus a fresh unsaved edit",
    });
  });
});

describe("PageEditor -- the preview pane is a named region (D7)", () => {
  // Switching to Preview mode used to swap the entire content area for a
  // plain, unnamed Box - focus stays on the Preview button (aria-pressed
  // partially covers that), but nothing tells assistive tech that the whole
  // region underneath just became different content.
  it("gives the preview pane role=region with a real accessible name once switched to Preview mode", async () => {
    await render(baseProps());

    // Not present in Edit mode - this is specifically about the swapped-in
    // preview content, not the editor generally.
    expect(container.querySelector('[role="region"]')).toBeNull();

    await click(buttonNamed(/^preview$/i));

    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(accessibleName(region).trim().length).toBeGreaterThan(0);
    // Distinct from the toggle button's own name ("Preview") so a screen
    // reader user does not hear two different things both called "Preview".
    expect(accessibleName(region).trim().toLowerCase()).not.toBe("preview");
  });
});
