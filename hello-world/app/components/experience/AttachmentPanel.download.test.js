// @vitest-environment jsdom
//
// Getting a file back OUT of a project page.
//
// Until this existed, an attachment was write-only for every kind except
// image and video: those two get a short-lived signed URL purely so the card
// can preview them inline (app/api/experience/attachments/route.js's GET
// mints one for nothing else), and a pdf, a deck, a spreadsheet or a text
// file had no route back to the user's disk at all.
//
// A sibling file rather than more blocks inside AttachmentPanel.test.js,
// which is already past this repo's 1000-line ceiling - the same reason
// AttachmentPanel.officeKinds.test.js exists.
//
// The Supabase CLIENT is doubled here, but lib/supabase/experienceAttachments
// is NOT mocked: the panel's call into it is the join this file is really
// about, and a hand-built fixture of what the store "probably" returns is
// exactly how two individually-correct halves get wired together wrong.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AttachmentPanel from "./AttachmentPanel.js";

vi.mock("../../../lib/supabase/client", () => ({ createClient: vi.fn() }));

// A full stub, deliberately: jsdom implements neither URL.createObjectURL nor
// a real download, so the shared helper cannot run here. Stubbing it is also
// what makes "did the panel use the SHARED helper" observable at all - a
// private fourth copy of the object-URL-on-a-temporary-anchor idiom inside
// the panel would produce an identical user-visible result and leave this
// spy untouched.
vi.mock("../../../lib/document/docx", () => ({ triggerBlobDownload: vi.fn() }));

import { createClient } from "../../../lib/supabase/client";
import { triggerBlobDownload } from "../../../lib/document/docx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mirrors AttachmentPanel.test.js's own withoutZwsp - see the announcement
// helpers in AttachmentPanel.js for why the trailing character is there.
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
  // `vi.restoreAllMocks()` in afterEach does NOT clear these. It only restores
  // spies registered through `vi.spyOn`; a plain `vi.fn()` returned from a
  // `vi.mock` factory is never in that set, so its call history survives every
  // test in the file. Without this, each successful download leaves a call
  // behind and the later `not.toHaveBeenCalled()` / `toHaveBeenCalledTimes(1)`
  // assertions fail against a perfectly correct component - a red suite that
  // says nothing about the code. BulkActionsBar.test.js:353 clears the same
  // helper in its own beforeEach for exactly this reason.
  //
  // mockReset, not mockClear: two tests below install a THROWING
  // implementation to exercise the catch branch, and mockClear wipes only the
  // call history, leaving the implementation in place to blow up every
  // subsequent test in the file.
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

// Shaped like the row the GET route actually returns: it spreads the whole
// database row (`{ ...row, kind, url }`), so `storage_path` is already on the
// wire today - see app/api/experience/attachments/route.js.
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

// The panel's own list load. Every other method falls through to a generic
// ok, so a stray notes PATCH in a test that isn't about one doesn't throw.
function installFetch(list = []) {
  global.fetch = vi.fn((url, options = {}) => {
    const method = (options && options.method) || "GET";
    if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// Doubles the BROWSER supabase client, at the same seam
// ExperienceTab.js:431-442 already uses to pull attachment bytes for the
// chat. `download` is a vi.fn so a test can both inspect the key it was
// asked for and control when it settles.
function installStorage({ blob = new Blob(["bytes"]), error = null, deferred = false } = {}) {
  let settle;
  const pending = new Promise((resolve) => {
    settle = resolve;
  });
  const download = vi.fn(() => (deferred ? pending : Promise.resolve({ data: blob, error })));
  const from = vi.fn(() => ({ download }));
  createClient.mockReturnValue({ storage: { from } });
  return { download, from, settle: () => settle({ data: blob, error }) };
}

async function mount(props = { pageId: "page-1" }) {
  await act(async () => {
    root.render(createElement(AttachmentPanel, props));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function click(el) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function downloadButtons() {
  return [...container.querySelectorAll('[aria-label^="Download "]')];
}

function downloadButtonFor(name) {
  return container.querySelector(`[aria-label="Download ${name}"]`);
}

function statusText() {
  const region = container.querySelector('[role="status"]');
  return region ? region.textContent : "";
}

function retryButtons() {
  return [...container.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Retry");
}

const MIXED = [
  attachment({ id: "a1", name: "resume-draft.pdf", kind: "pdf", storage_path: "user-1/experience/page-1/a1-resume-draft.pdf" }),
  attachment({ id: "a2", name: "screenshot.png", kind: "image", url: "https://example.com/a2.png", storage_path: "user-1/experience/page-1/a2-screenshot.png" }),
  attachment({ id: "a3", name: "demo.mp4", kind: "video", url: "https://example.com/a3.mp4", storage_path: "user-1/experience/page-1/a3-demo.mp4" }),
  attachment({ id: "a4", name: "kickoff.pptx", kind: "slides", storage_path: "user-1/experience/page-1/a4-kickoff.pptx" }),
  attachment({ id: "a5", name: "q3.xlsx", kind: "sheet", storage_path: "user-1/experience/page-1/a5-q3.xlsx" }),
];

describe("a download control on every attachment", () => {
  it("gives every kind one, with a distinct accessible name naming its own file", async () => {
    // The whole point of the feature is the kinds that have NO inline
    // preview - a pdf, a deck, a spreadsheet. A control that only appeared
    // for image/video would leave exactly the files that need it stranded.
    installFetch(MIXED);
    installStorage();
    await mount();

    const names = downloadButtons().map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Download resume-draft.pdf",
      "Download screenshot.png",
      "Download demo.mp4",
      "Download kickoff.pptx",
      "Download q3.xlsx",
    ]);
    // Five buttons all called "Download" is the failure this repo has
    // actually shipped before, on a different tab.
    expect(new Set(names).size).toBe(names.length);
  });

  it("renders each one as a real, enabled control that is always present", async () => {
    // Not revealed on hover: a control that only exists while the pointer is
    // over its row is unreachable by keyboard and invisible to a screen
    // reader, which is the most common way a list-row action fails WCAG.
    installFetch(MIXED);
    installStorage();
    await mount();

    const buttons = downloadButtons();
    // Asserted BEFORE the loop, and not merely implied by it: a `for` over an
    // empty list passes every assertion inside it, so without this line a
    // panel with no download control at all was green here.
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("leaves the delete controls exactly as they were", async () => {
    // A GUARD, not a gate - it passes both before and after this change, by
    // design. It is here so that the day someone reorganises a card's actions
    // and drops or renames the delete control, that shows up as a failure in
    // the file whose change caused it.
    installFetch(MIXED);
    installStorage();
    await mount();

    const deleteNames = [...container.querySelectorAll('[aria-label^="Delete "]')].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(deleteNames).toEqual([
      "Delete resume-draft.pdf",
      "Delete screenshot.png",
      "Delete demo.mp4",
      "Delete kickoff.pptx",
      "Delete q3.xlsx",
    ]);
  });
});

describe("downloading a file", () => {
  it("reads the row's own storage key and saves it under the ORIGINAL file name", async () => {
    // Two separate things, both load-bearing:
    //  - the key comes from the row's `storage_path`, never re-derived, so a
    //    file whose name the upload sanitizer changed still resolves;
    //  - the SAVED name is the row's `name`, which is the unmodified name the
    //    user uploaded - not the storage key's `<uuid>-<sanitized>` basename,
    //    which is what a naive implementation hands the browser.
    const blob = new Blob(["pdf bytes"]);
    installFetch([MIXED[0]]);
    const storage = installStorage({ blob });
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));

    expect(storage.from).toHaveBeenCalledWith("resumes");
    expect(storage.download).toHaveBeenCalledWith("user-1/experience/page-1/a1-resume-draft.pdf");
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    expect(triggerBlobDownload).toHaveBeenCalledWith(blob, "resume-draft.pdf");
  });

  it("says so afterwards, and says it again the second time", async () => {
    // The SAME sentence announced twice in a row is the case that breaks a
    // live region, and it is entirely ordinary here - downloading a file
    // again is not an error. The mechanism is NOT a setState bailout:
    // `bumpAnnouncement` returns a fresh object every call, so the
    // Object.is-equal bailout can never fire on this path. It is React's
    // RECONCILER - an unchanged text node is left untouched, and a live
    // region with no DOM mutation announces nothing. Hence the sequence
    // number and the alternating invisible character, which are what make
    // the rendered TEXT differ between two identical messages.
    installFetch([MIXED[0]]);
    installStorage();
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));
    const first = statusText();
    expect(withoutZwsp(first)).toBe('Downloaded "resume-draft.pdf"');

    await click(downloadButtonFor("resume-draft.pdf"));
    const second = statusText();
    expect(withoutZwsp(second)).toBe('Downloaded "resume-draft.pdf"');
    // The rendered TEXT NODE has to differ, not just the state object behind
    // it - an unchanged text node is left untouched by the reconciler and no
    // live region ever fires.
    expect(second).not.toBe(first);
  });

  it("round-trips a name that is not plain ASCII, byte for byte", async () => {
    // The reason this feature does NOT ask Supabase to name the download for
    // it. `createSignedUrl(path, ttl, { download: name })` builds its query
    // with URLSearchParams (already percent-encoded) and then wraps the whole
    // URL in encodeURI, escaping the percent signs a second time - measured:
    // "café report (v2).pdf" arrives as "caf%25C3%25A9+report+%2528v2%2529.pdf".
    // Handing the name to the anchor as a DOM property has no encoding layer
    // at all, and this test is what stops anyone "simplifying" back to the
    // signed-URL parameter later.
    const name = "café report (v2).pdf";
    const blob = new Blob(["pdf bytes"]);
    installFetch([attachment({ id: "a9", name, kind: "pdf", storage_path: "user-1/experience/page-1/a9-cafu00e9_report_(v2).pdf" })]);
    installStorage({ blob });
    await mount();

    await click(downloadButtonFor(name));

    // The exact argument, so the sanitized storage-key basename this file is
    // really stored under ("a9-cafu00e9_report_(v2).pdf" - escapeUnsafeChars
    // in lib/experience/attachments.js genuinely emits `u<hex>` for every
    // non-ASCII code point) can never be what reaches the user's disk.
    expect(triggerBlobDownload).toHaveBeenCalledWith(blob, name);
  });

  it("does not disturb the list", async () => {
    installFetch(MIXED);
    installStorage();
    await mount();

    await click(downloadButtonFor("kickoff.pptx"));

    expect(downloadButtons()).toHaveLength(5);
    expect(container.textContent).toContain("kickoff.pptx");
  });
});

describe("when a download fails", () => {
  it("says which file, keeps the row, and saves nothing", async () => {
    installFetch([MIXED[0]]);
    installStorage({ blob: null, error: { message: "Object not found" } });
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));

    expect(triggerBlobDownload).not.toHaveBeenCalled();
    // Located through the live region, not through container.textContent.
    // Asserting only that the words appear SOMEWHERE on the page passes just
    // as happily against an alert rendered with role="presentation" - which
    // looks identical on screen and is completely silent to a screen reader.
    // The panel's notes and delete failures are both asserted this way
    // (AttachmentPanel.test.js) and this one has to be too.
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // Naming the file matters: a page can hold many attachments and the alert
    // is rendered next to one of them.
    expect(alert.textContent).toContain("resume-draft.pdf");
    expect(alert.textContent.toLowerCase()).toContain("could not download");
    // The attachment itself is untouched - a failed read is not a delete.
    expect(downloadButtonFor("resume-draft.pdf")).not.toBeNull();
  });

  it("re-announces a second consecutive failure of the same file", async () => {
    // The per-id `seq` is what makes two identical failure messages differ in
    // the DOM, exactly as the success announcement does. Without a test that
    // fails the SAME file twice and compares the rendered strings, replacing
    // `nextSeqFor(downloadErrorSeqRef, id)` with a constant is invisible: the
    // alert looks right both times, and a screen reader hears the second
    // failure not at all. The notes and delete maps each already have this
    // test; this one was missing.
    installFetch([MIXED[0]]);
    installStorage({ blob: null, error: { message: "Object not found" } });
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));
    const first = container.querySelector('[role="alert"]').textContent;

    await click(downloadButtonFor("resume-draft.pdf"));
    const second = container.querySelector('[role="alert"]').textContent;

    expect(withoutZwsp(first)).toBe(withoutZwsp(second));
    expect(second).not.toBe(first);
  });

  it("offers a Retry that actually downloads on the second attempt", async () => {
    // The same shape saveNotes and removeAttachment already use for their own
    // failures. A dead-end error message would leave the only way out being a
    // full page reload.
    const blob = new Blob(["pdf bytes"]);
    installFetch([MIXED[0]]);
    let attempt = 0;
    const download = vi.fn(async () => {
      attempt += 1;
      return attempt === 1 ? { data: null, error: { message: "Object not found" } } : { data: blob, error: null };
    });
    createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ download })) } });
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));
    expect(retryButtons()).toHaveLength(1);

    await click(retryButtons()[0]);

    expect(download).toHaveBeenCalledTimes(2);
    expect(triggerBlobDownload).toHaveBeenCalledWith(blob, "resume-draft.pdf");
    // …and the failure that has now been resolved stops being shown.
    expect(retryButtons()).toHaveLength(0);
  });

  it("fails cleanly for a row with no stored file at all", async () => {
    // `storage_path` is nullable in the migration.
    installFetch([attachment({ id: "a1", name: "orphan.pdf", kind: "pdf", storage_path: null })]);
    const storage = installStorage();
    await mount();

    await click(downloadButtonFor("orphan.pdf"));

    expect(storage.download).not.toHaveBeenCalled();
    expect(triggerBlobDownload).not.toHaveBeenCalled();
    expect(container.textContent).toContain("orphan.pdf");
  });

  it("reports a THROWN failure rather than swallowing it", async () => {
    // The store function never throws - it returns { blob, error }. But the
    // two calls the panel makes DIRECTLY can: createClient() throws when the
    // public Supabase env vars are missing, and triggerBlobDownload touches
    // URL.createObjectURL and link.click(). With a `finally` and no `catch`,
    // either throw merely rejected the promise an onClick returned: the
    // spinner cleared and the user got no file, no alert and no announcement.
    // Nothing else in this file exercises a throw, so without this test that
    // whole branch is ungated.
    installFetch([MIXED[0]]);
    createClient.mockImplementation(() => {
      throw new Error("supabaseUrl is required.");
    });
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("resume-draft.pdf");
    expect(triggerBlobDownload).not.toHaveBeenCalled();
    // …and the busy flag was released, so the control is usable again rather
    // than stuck showing a spinner forever.
    expect(downloadButtonFor("resume-draft.pdf").getAttribute("aria-busy")).not.toBe("true");
  });

  it("reports a throw from the save step too, not just the read", async () => {
    // The other half of the same branch: the bytes arrived, and handing them
    // to the browser is what failed. The user still has no file, so they
    // still have to be told.
    installFetch([MIXED[0]]);
    installStorage();
    triggerBlobDownload.mockImplementation(() => {
      throw new Error("createObjectURL failed");
    });
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(retryButtons()).toHaveLength(1);
  });

  it("keeps one file's failure off every other file's card", async () => {
    installFetch(MIXED);
    installStorage({ blob: null, error: { message: "Object not found" } });
    await mount();

    await click(downloadButtonFor("kickoff.pptx"));

    // Exactly one failure is on screen, not one per row.
    expect(retryButtons()).toHaveLength(1);
  });
});

describe("while a download is in flight", () => {
  it("ignores a second activation of the same control instead of downloading twice", async () => {
    // A slow read invites a second click. Two reads of the same object means
    // two files in the user's downloads folder, and - worse - two calls into
    // triggerBlobDownload racing over the same name.
    installFetch([MIXED[0]]);
    const storage = installStorage({ deferred: true });
    await mount();

    const button = downloadButtonFor("resume-draft.pdf");
    // BOTH clicks inside ONE act(), with no await between them. This is the
    // whole test: two SEPARATE `await act()` calls let React flush the first
    // click's state update before the second click lands, so a guard held in
    // useState - which cannot possibly work against a real double-tap, since
    // a setState is not visible to a handler already queued in the same tick
    // - passes anyway. The guard has to be a ref, and only this shape says so.
    // The panel's delete path guards the identical way, for the identical
    // reason: `if (pendingDeleteTimersRef.current[id]) return;`.
    await act(async () => {
      button.click();
      button.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(storage.download).toHaveBeenCalledTimes(1);

    await act(async () => {
      storage.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
  });

  it("keeps the control in the tab order rather than disabling it", async () => {
    // A control that disappears from the tab order the moment it is used
    // dumps keyboard focus back to the top of the document - the exact
    // failure this repo has already shipped once, on a disabled control whose
    // explanation left the tab order at the same time it appeared.
    installFetch([MIXED[0]]);
    const storage = installStorage({ deferred: true });
    await mount();

    const button = downloadButtonFor("resume-draft.pdf");
    await click(button);

    const inFlight = downloadButtonFor("resume-draft.pdf");
    expect(inFlight).not.toBeNull();
    expect(inFlight.disabled).toBe(false);
    expect(inFlight.getAttribute("tabindex")).not.toBe("-1");
    // A big video takes real seconds. Since the control deliberately does not
    // disable, aria-busy is what says "this is running" without costing the
    // tab order.
    expect(inFlight.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      storage.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(downloadButtonFor("resume-draft.pdf").getAttribute("aria-busy")).not.toBe("true");
  });

  it("marks only the file being fetched as busy", async () => {
    // Positive control for the assertion above: an aria-busy hard-coded onto
    // every card, or onto none, would be indistinguishable from a correct one
    // in a single-attachment test.
    installFetch(MIXED);
    const storage = installStorage({ deferred: true });
    await mount();

    await click(downloadButtonFor("kickoff.pptx"));

    expect(downloadButtonFor("kickoff.pptx").getAttribute("aria-busy")).toBe("true");
    expect(downloadButtonFor("resume-draft.pdf").getAttribute("aria-busy")).not.toBe("true");

    await act(async () => {
      storage.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("still lets a DIFFERENT file be downloaded at the same time", async () => {
    // The re-entry guard has to be per attachment. A single global "busy"
    // flag would make the second file's click do nothing at all, silently.
    // Each key gets its OWN blob, and both are held open until released
    // together. A single shared pending promise would let a panel that mixed
    // the two files up - saving one blob under the other's name - pass, since
    // the two blobs would be the same object.
    const pdfBlob = new Blob(["pdf"]);
    const xlsxBlob = new Blob(["xlsx"]);
    const byKey = {
      "user-1/experience/page-1/a1-resume-draft.pdf": pdfBlob,
      "user-1/experience/page-1/a5-q3.xlsx": xlsxBlob,
    };
    const releases = [];
    const download = vi.fn(
      (key) =>
        new Promise((resolve) => {
          releases.push(() => resolve({ data: byKey[key] ?? null, error: null }));
        }),
    );
    installFetch(MIXED);
    createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ download })) } });
    await mount();

    await click(downloadButtonFor("resume-draft.pdf"));
    await click(downloadButtonFor("q3.xlsx"));

    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls.map(([key]) => key)).toEqual([
      "user-1/experience/page-1/a1-resume-draft.pdf",
      "user-1/experience/page-1/a5-q3.xlsx",
    ]);

    await act(async () => {
      releases.forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Both actually land, each under its own name. Without these the test
    // stopped at "two reads were issued" and a panel that saved nothing at
    // all after the reads resolved would have passed.
    expect(triggerBlobDownload).toHaveBeenCalledTimes(2);
    expect(triggerBlobDownload).toHaveBeenCalledWith(pdfBlob, "resume-draft.pdf");
    expect(triggerBlobDownload).toHaveBeenCalledWith(xlsxBlob, "q3.xlsx");
  });
});

// The whole class of bug that the panel's pageId-change effect and its
// pageIdRef already exist to prevent, applied to the one operation that did
// not yet participate in either. Both were missing when the download control
// was first written, and neither is visible to a test that never leaves
// page one - which is why they are here rather than folded into the blocks
// above.
//
// Attachment ids are unique per attachment but scoped to nothing the panel
// itself enforces, so two different pages can perfectly well hold rows that
// share one. Giving page one and page two an attachment with the SAME id is
// what makes the leak show up as a message naming the WRONG file, rather
// than as a merely stale one - mirrors AttachmentPanel.test.js's own
// "switching pages clears stale per-attachment error state".
describe("switching pages while downloads are involved", () => {
  const SHARED_ID = "shared-1";

  // Serves page one's list or page two's, according to `currentPage`.
  function installTwoPageFetch(getPage) {
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        const list =
          getPage() === "page-1"
            ? [attachment({ id: SHARED_ID, name: "on-page-one.pdf", kind: "pdf", storage_path: "user-1/experience/page-1/s1-one.pdf" })]
            : [attachment({ id: SHARED_ID, name: "on-page-two.pdf", kind: "pdf", storage_path: "user-1/experience/page-2/s1-two.pdf" })];
        return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  }

  it("does not carry a failed download's alert onto another page's attachment", async () => {
    let currentPage = "page-1";
    installTwoPageFetch(() => currentPage);
    installStorage({ blob: null, error: { message: "Object not found" } });
    await mount({ pageId: "page-1" });

    await click(downloadButtonFor("on-page-one.pdf"));
    expect(container.querySelector('[role="alert"]').textContent).toContain("on-page-one.pdf");

    currentPage = "page-2";
    await mount({ pageId: "page-2" });

    // Left alone, the alert renders against page two's card while naming
    // page one's file - and its Retry closes over page two's attachment, so
    // pressing it downloads something other than what the message says.
    expect(container.textContent).toContain("on-page-two.pdf");
    expect(container.textContent).not.toContain("Could not download");
  });

  it("does not announce a download that lands after the user has moved on", async () => {
    // A 100 MB video is seconds of wall clock - long enough to click away
    // from. The file itself must still arrive, because the user asked for
    // it; what must NOT happen is the panel narrating it into a page that
    // has nothing to do with it.
    let currentPage = "page-1";
    installTwoPageFetch(() => currentPage);
    const storage = installStorage({ deferred: true });
    await mount({ pageId: "page-1" });

    await click(downloadButtonFor("on-page-one.pdf"));

    currentPage = "page-2";
    await mount({ pageId: "page-2" });

    await act(async () => {
      storage.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    expect(triggerBlobDownload).toHaveBeenCalledWith(expect.anything(), "on-page-one.pdf");
    expect(withoutZwsp(statusText())).not.toContain("Downloaded");
  });

  it("does not plant a late failure's alert on the page the user moved to", async () => {
    // The sharper half of the same guard, and the one the page-switch effect
    // alone cannot cover: this write lands AFTER that effect's deferred
    // clear has already run, so only a check against the pageId the download
    // started under keeps it off the new page.
    let currentPage = "page-1";
    installTwoPageFetch(() => currentPage);
    const storage = installStorage({ deferred: true, blob: null, error: { message: "Object not found" } });
    await mount({ pageId: "page-1" });

    await click(downloadButtonFor("on-page-one.pdf"));

    currentPage = "page-2";
    await mount({ pageId: "page-2" });

    await act(async () => {
      storage.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("on-page-two.pdf");
    expect(container.textContent).not.toContain("Could not download");
  });
});
