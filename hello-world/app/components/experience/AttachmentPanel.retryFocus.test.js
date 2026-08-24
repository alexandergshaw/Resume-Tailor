// @vitest-environment jsdom
//
// Where keyboard focus goes when a Retry button unmounts itself.
//
// All three of this panel's failure alerts — a failed notes save, a failed
// delete, a failed download — carry a Retry, and every one of those handlers
// clears its own per-id error entry as its first synchronous act. That
// unmounts the Alert, and the Retry button inside it, which is the element
// the user is standing on. Focus falls to <body>, so a keyboard user is
// thrown to the top of the document from a list that can be long.
//
// The bug is inherited, not new: the notes and delete alerts have behaved
// this way since they were written. It is gated now because the panel has
// since grown an explicit rule that a control must never leave the tab order
// at the moment it is used (see the Download button's own comment), and a
// rule kept in one place and broken in three is not a rule.
//
// THE TRAP THIS FILE IS BUILT AROUND: jsdom does not move focus on a
// synthetic MouseEvent. A test that focuses the Retry button, clicks it, and
// then asserts focus is "somewhere sensible" passes against a component whose
// focus() call has been deleted, because focus simply never moved. So every
// test below focuses the RETRY BUTTON first and then asserts that focus has
// moved OFF it and onto a specific named element — and asserts it is not
// document.body, which is where the real browser drops it today.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AttachmentPanel, { UNDO_WINDOW_MS } from "./AttachmentPanel.js";

vi.mock("../../../lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("../../../lib/document/download", () => ({ triggerBlobDownload: vi.fn() }));

import { createClient } from "../../../lib/supabase/client";
import { triggerBlobDownload } from "../../../lib/document/download";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  triggerBlobDownload.mockReset();
  createClient.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete global.fetch;
});

function attachment(overrides = {}) {
  return {
    id: "a1",
    page_id: "page-1",
    name: "file.txt",
    kind: "text",
    bytes: 1024,
    notes: "",
    url: null,
    storage_path: "user-1/experience/page-1/a1-file.txt",
    ...overrides,
  };
}

const TWO = [
  attachment({ id: "a1", name: "first.pdf", kind: "pdf", storage_path: "user-1/experience/page-1/a1-first.pdf" }),
  attachment({ id: "a2", name: "second.pdf", kind: "pdf", storage_path: "user-1/experience/page-1/a2-second.pdf" }),
];

const THREE = [
  ...TWO,
  attachment({ id: "a3", name: "third.pdf", kind: "pdf", storage_path: "user-1/experience/page-1/a3-third.pdf" }),
];

async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

// `patchOk` / `deleteOk` are read at call time, so a test can flip one
// between the first failure and the retry. `patchHangs` makes a PATCH never
// settle, which is what exposes state that is cleared when a save STARTS
// rather than when it succeeds.
function installFetch(list, state = {}) {
  global.fetch = vi.fn((url, options = {}) => {
    const method = (options && options.method) || "GET";
    if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
    if (method === "PATCH") {
      if (state.patchHangs) return new Promise(() => {});
      return Promise.resolve({ ok: state.patchOk !== false, json: async () => ({}) });
    }
    if (method === "DELETE") {
      if (state.deleteGate) return new Promise((resolve) => state.deleteGate.push(resolve));
      return Promise.resolve({ ok: state.deleteOk !== false, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

function installStorage({ error = null } = {}) {
  const download = vi.fn(async () => ({ data: error ? null : new Blob(["b"]), error }));
  createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ download })) } });
  return { download };
}

async function mount(props = { pageId: "page-1" }) {
  await act(async () => {
    root.render(createElement(AttachmentPanel, props));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// Clicks, then lets the handler's own promise chain settle before returning.
//
// The settle step MUST be timer-aware. The delete tests below run under
// `vi.useFakeTimers()` (they have to - the delete failure only appears once
// the five-second undo window has elapsed), and Vitest's fake timers default
// to `shouldAdvanceTime: false`, so a raw `setTimeout(resolve, 0)` scheduled
// here never fires and the await hangs until the test times out. That looks
// exactly like a component that never responded to the click, which is a
// deeply misleading way to fail.
async function click(el) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function retryButton() {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Retry");
}

function byLabel(label) {
  return container.querySelector(`[aria-label="${label}"]`);
}

function notesFieldFor(name) {
  return container.querySelector(`textarea[aria-label="Notes for the AI for ${name}"]`);
}

// Focuses the Retry button, then clicks it, then reports where focus ended up.
// The initial focus() is what makes the assertion meaningful — see this
// file's header on the jsdom synthetic-click trap.
async function clickRetryFromFocus() {
  const retry = retryButton();
  expect(retry, "expected a Retry button to be on screen").toBeDefined();
  retry.focus();
  expect(document.activeElement).toBe(retry);
  await click(retry);
  return retry;
}

describe("Retry on a failed notes save", () => {
  it("puts focus on that attachment's notes field, not on <body>", async () => {
    installFetch(TWO, { patchOk: false });
    installStorage();
    await mount();

    const field = notesFieldFor("first.pdf");
    field.focus();
    await act(async () => {
      field.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const retry = await clickRetryFromFocus();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(retry);
    expect(document.activeElement).toBe(notesFieldFor("first.pdf"));
  });
});

describe("the notes alert survives being reached", () => {
  it("does not vanish when focus merely LANDS on its Retry button", async () => {
    // The nastiest interaction in this panel, and the one the focus fix
    // itself creates. Once a Retry has put the caret INTO the notes field, a
    // second failure leaves the caret there with the alert on screen. In a
    // real browser, pressing that Retry moves focus to the button on
    // MOUSEDOWN, which fires focusout on the textarea, which runs the notes
    // save. If that save clears the error entry as its first act, the alert
    // — and the button being pressed — unmount before mouseup, the click
    // never lands, and focus falls to <body>. That is precisely the defect
    // this whole chunk exists to remove, reappearing on every retry after
    // the first. Keyboard is the same story: tabbing to the Retry removes it
    // mid-transition.
    //
    // jsdom DOES fire focusout on .focus(), so this sequence reproduces it
    // exactly. The PATCH hangs so nothing can resolve and tidy up on its own
    // — the alert must still be there because the failure is still true, not
    // because a request happened to come back.
    const state = { patchOk: false };
    installFetch(TWO, state);
    installStorage();
    await mount();

    const field = notesFieldFor("first.pdf");
    field.focus();
    await act(async () => {
      field.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const retry = retryButton();
    expect(retry, "the failed save should have produced a Retry").toBeDefined();

    // The caret goes back into the field, as it does after a real Retry.
    notesFieldFor("first.pdf").focus();
    // …and now the user reaches for Retry. From here on nothing may resolve.
    state.patchHangs = true;
    await act(async () => {
      retry.focus();
    });

    expect(retry.isConnected, "the Retry button must not unmount as focus arrives on it").toBe(true);
    expect(document.activeElement).toBe(retry);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("Retry on a failed download", () => {
  it("puts focus back on that attachment's own Download button", async () => {
    installFetch(TWO);
    installStorage({ error: { message: "Object not found" } });
    await mount();

    await click(byLabel("Download first.pdf"));

    const retry = await clickRetryFromFocus();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(retry);
    expect(document.activeElement).toBe(byLabel("Download first.pdf"));
  });

  it("lets go of the focus request once it has been honoured", async () => {
    // A focus request that is never cleared is re-honoured on EVERY later
    // render. `onNotesInput` calls setAttachments on every keystroke, so the
    // effect would re-grab the last target once per character - the caret
    // would be dragged out of the notes field mid-word, making it impossible
    // to type. Every other test here performs a single Retry and then stops,
    // which is exactly why deleting the clear-out survived them all.
    installFetch(TWO);
    installStorage({ error: { message: "Object not found" } });
    await mount();

    await click(byLabel("Download first.pdf"));
    await clickRetryFromFocus();
    expect(document.activeElement).toBe(byLabel("Download first.pdf"));

    const field = notesFieldFor("second.pdf");
    field.focus();
    await type(field, "typing away");

    expect(document.activeElement).toBe(notesFieldFor("second.pdf"));
    expect(notesFieldFor("second.pdf").value).toBe("typing away");
  });

  it("focuses the right row's control when a later row is the one that failed", async () => {
    // Positive control for the test above: a fix that always focused the
    // FIRST download button would pass it and be wrong for every other row.
    installFetch(TWO);
    installStorage({ error: { message: "Object not found" } });
    await mount();

    await click(byLabel("Download second.pdf"));
    await clickRetryFromFocus();

    expect(document.activeElement).toBe(byLabel("Download second.pdf"));
  });
});

describe("Retry on a failed delete", () => {
  // The delete failure only appears once the five-second undo window has run
  // out and the deferred DELETE has actually been attempted and refused.
  async function reachDeleteFailure(state) {
    vi.useFakeTimers();
    installFetch(TWO, state);
    installStorage();
    await act(async () => {
      root.render(createElement(AttachmentPanel, { pageId: "page-1" }));
    });
    await advance(30);
    await click(byLabel("Delete first.pdf"));
    await advance(UNDO_WINDOW_MS + 10);
  }

  it("keeps focus on that row's Delete button when the retry fails again", async () => {
    const state = { deleteOk: false };
    await reachDeleteFailure(state);
    expect(byLabel("Delete first.pdf"), "the row must be restored by a failed delete").not.toBeNull();

    const retry = await clickRetryFromFocus();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(retry);
    expect(document.activeElement).toBe(byLabel("Delete first.pdf"));
  });

  it("moves focus to a control that still exists when the retry succeeds", async () => {
    // The hard case, and the reason this cannot simply focus "the row's own
    // control": a successful retry removes the row, so the element the other
    // tests focus is gone by the time the effect runs. Focus must land on
    // something real - the next attachment's Delete button here - and above
    // all not on <body>.
    const state = { deleteOk: false };
    await reachDeleteFailure(state);
    state.deleteOk = true;

    const retry = await clickRetryFromFocus();

    expect(byLabel("Delete first.pdf"), "a successful retry must remove the row").toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(retry);
    expect(document.activeElement).toBe(byLabel("Delete second.pdf"));
  });

  it("falls back to the PREVIOUS row when the deleted one was last", async () => {
    // The `?? prevId` half of the fallback. Every other delete test deletes a
    // row that HAS a following sibling, so removing `?? prevId` entirely left
    // the whole suite green - the branch existed and was never once taken.
    const state = { deleteOk: false };
    vi.useFakeTimers();
    installFetch(THREE, state);
    installStorage();
    await act(async () => {
      root.render(createElement(AttachmentPanel, { pageId: "page-1" }));
    });
    await advance(30);
    await click(byLabel("Delete third.pdf"));
    await advance(UNDO_WINDOW_MS + 10);
    state.deleteOk = true;

    await clickRetryFromFocus();

    expect(byLabel("Delete third.pdf")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(byLabel("Delete second.pdf"));
  });

  it("does not steal focus from wherever the user went while the retry was in flight", async () => {
    // A delete Retry is the one focus target decided AFTER an await, so it is
    // the only one that can land seconds later. If it focuses unconditionally
    // it yanks the caret out of whatever the user has since clicked into -
    // and because a notes field saves on blur, that also fires a PATCH of a
    // half-typed note. Focus should only be moved if it was actually lost.
    const state = { deleteOk: false };
    await reachDeleteFailure(state);

    state.deleteGate = [];
    const retry = retryButton();
    retry.focus();
    await click(retry);

    // The user gives up waiting and starts typing in another row.
    const field = notesFieldFor("second.pdf");
    field.focus();
    await type(field, "still writing this");
    expect(document.activeElement).toBe(field);

    await act(async () => {
      state.deleteGate.forEach((resolve) => resolve({ ok: true, json: async () => ({}) }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(document.activeElement).toBe(notesFieldFor("second.pdf"));
    expect(notesFieldFor("second.pdf").value).toBe("still writing this");
  });

  it("abandons a retry that resolves after the user has switched project pages", async () => {
    // Two defects in one scenario, both of the class this panel already
    // documents at length: attachment ids are unique per attachment but
    // scoped to nothing the panel enforces, so two different pages can hold
    // rows sharing an id.
    //
    // Without a pageIdRef guard, a delete Retry resolving after a page
    // switch removes a row from the NEW page's list and announces the OLD
    // page's file name into its live region. Without clearing pendingFocus
    // on the switch, the focus request left behind lands on whichever
    // control now happens to hold that key - a completely unrelated
    // attachment.
    const state = { deleteOk: false };
    let currentPage = "page-1";
    vi.useFakeTimers();
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        const list =
          currentPage === "page-1"
            ? TWO
            : [attachment({ id: "a1", name: "elsewhere.pdf", kind: "pdf", storage_path: "user-1/experience/page-2/a1-elsewhere.pdf" })];
        return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      }
      if (method === "DELETE") {
        if (state.deleteGate) return new Promise((resolve) => state.deleteGate.push(resolve));
        return Promise.resolve({ ok: state.deleteOk !== false, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    installStorage();
    await act(async () => {
      root.render(createElement(AttachmentPanel, { pageId: "page-1" }));
    });
    await advance(30);
    await click(byLabel("Delete first.pdf"));
    await advance(UNDO_WINDOW_MS + 10);

    // Retry, but hold the DELETE open, then leave for another page.
    state.deleteGate = [];
    const retry = retryButton();
    retry.focus();
    await click(retry);

    currentPage = "page-2";
    await act(async () => {
      root.render(createElement(AttachmentPanel, { pageId: "page-2" }));
    });
    await advance(30);
    expect(container.textContent).toContain("elsewhere.pdf");

    await act(async () => {
      state.deleteGate.forEach((resolve) => resolve({ ok: true, json: async () => ({}) }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Page two's own attachment - which merely shares an id - is still here
    // and was never focused, and page one's row did not follow the user
    // across.
    expect(byLabel("Delete elsewhere.pdf")).not.toBeNull();
    expect(byLabel("Delete first.pdf")).toBeNull();
    expect(document.activeElement).not.toBe(byLabel("Delete elsewhere.pdf"));
    // NOT asserted here: that the live region has stopped saying
    // `Removed "first.pdf"`. It has not. `statusAnnouncement` is set by
    // scheduleDelete at click time - legitimately, on page one - and nothing
    // resets it on a page switch, so the previous page's last announcement is
    // still sitting in the region while page two is on screen. That is a real
    // (pre-existing, cosmetic) leak of the same family as the per-id maps,
    // and it is deliberately out of this change's scope rather than quietly
    // folded in. Recorded as its own follow-up.
  });

  it("falls back to the upload control when the deleted row was the only one", async () => {
    const state = { deleteOk: false };
    vi.useFakeTimers();
    installFetch([TWO[0]], state);
    installStorage();
    await act(async () => {
      root.render(createElement(AttachmentPanel, { pageId: "page-1" }));
    });
    await advance(30);
    await click(byLabel("Delete first.pdf"));
    await advance(UNDO_WINDOW_MS + 10);
    state.deleteOk = true;

    await clickRetryFromFocus();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(container.querySelector("#attachment-file-input"));
  });
});
