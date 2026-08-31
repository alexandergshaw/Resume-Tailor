// @vitest-environment jsdom
//
// Wave 6A -- the seam this whole wave exists for. `DriveActions.onSave` is
// zero-argument (app/components/preview/DriveActions.js's own header); the
// dialog wraps `drive.saveToDrive` with `commitDraft()`/`commitFileName()`
// (ARCH.md §4.3) because only the dialog has the in-flight draft state
// (`editorRef`, `fileNameDraft`) those two commits read from. This file
// renders the REAL DocumentPreviewDialog (JobDescriptionTab.test.js's
// createRoot + act pattern) with a hand-built `drive` prop standing in for
// `useDriveDocuments` -- the hook itself is Wave 5A's, already covered by
// app/hooks/useDriveDocuments.connect.test.js; this file's job is ONLY the
// wiring between the dialog's local draft state and that hook's entry point.
//
// A trap this file found and works around, not previously listed in this
// repo's known-jsdom-traps: jsdom (pinned at ^29.1.1 here) implements NO
// `HTMLElement.prototype.innerText` at all -- `el.innerText` is `undefined`,
// confirmed directly against this repo's jsdom before writing a single test
// below. `commitDraft`/`activePayload` (DocumentPreviewDialog.js) both read
// `editorRef.current.innerText` -- exactly what a real browser reflects for
// a contentEditable surface, and exactly what jsdom does not provide. This
// is polyfilled BELOW, scoped to this file only (never in vitest.setup.js,
// which is outside this wave's allowed-files list, and never left behind
// for other files sharing this worker under --no-file-parallelism).

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";
import { buildPreviewBlob } from "@/lib/document/previewBlob.js";
import { createDocumentDownloaders, buildMinimalistDocx } from "@/lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// AC-S6a's byte-identity test (MAJOR-3 below) needs the LOCAL download
// path's real `triggerBlobDownload` (a DOM anchor-click side effect)
// replaced with something that just hands back the Blob, and row 2's
// persisted-storage-doc branch needs a fake Supabase `storage.download`.
// Both mocks are inert for every OTHER test in this file (none of them
// import lib/document/docx.js or lib/supabase/client at all -- every
// `onDownload`/`loadModel` prop here is a plain vi.fn() stub).
const h = vi.hoisted(() => ({ downloads: [], storageBlob: null }));
vi.mock("@/lib/document/download.js", () => ({
  triggerBlobDownload: (blob, fileName) => {
    h.downloads.push({ blob, fileName });
  },
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        download: async () => (h.storageBlob ? { data: h.storageBlob, error: null } : { data: null, error: { message: "not found" } }),
      }),
    },
  }),
}));

let removeInnerTextPolyfill = null;
beforeAll(() => {
  if (!("innerText" in document.createElement("div"))) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = value;
      },
    });
    removeInnerTextPolyfill = () => {
      delete HTMLElement.prototype.innerText;
    };
  }
});
afterAll(() => {
  removeInnerTextPolyfill?.();
});

// ---------------------------------------------------------------------------
// fixtures + harness
// ---------------------------------------------------------------------------

function driveProps(overrides = {}) {
  return {
    status: "connected",
    scopeCount: 2,
    connected: true,
    hasDriveReference: false,
    isStale: false,
    downloadStatus: "idle",
    onRefocusConsent: vi.fn(),
    onDownload: vi.fn(),
    leadingLine: null,
    rows: [],
    showConversionCaption: false,
    stale: false,
    reconnectCaption: false,
    hiringEmail: null,
    prompt: null,
    announcement: { polite: "", alert: "" },
    saveToDrive: vi.fn(),
    ...overrides,
  };
}

function baseScopes(overrides = {}) {
  return {
    resume: {
      available: true,
      text: "OLD RESUME TEXT",
      html: "<p>OLD RESUME TEXT</p>",
      fileName: "Resume File",
    },
    cover: {
      available: true,
      text: "OLD COVER TEXT",
      html: "<p>OLD COVER TEXT</p>",
      fileName: "Cover File",
    },
    email: { available: false, text: "" },
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    open: true,
    jobTitle: "Staff Engineer",
    company: "Acme",
    initialTab: "resume",
    scopes: baseScopes(),
    engine: "embedded",
    loadModel: vi.fn(),
    onSave: vi.fn(),
    onRenameFile: vi.fn(),
    onDownload: vi.fn(),
    onClose: vi.fn(),
    busy: {},
    notice: {},
    error: {},
    drive: driveProps(),
    onActiveScopeChange: vi.fn(),
    ...overrides,
  };
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
});

async function render(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, props));
  });
}

// MUI's Dialog portals its content to document.body, not into the local
// container -- the same tripwire DocumentPreviewMount.test.js pins, checked
// again here since this file renders the dialog directly.
function assertPortaled() {
  expect(container.textContent).toBe("");
  expect(document.body.textContent.length).toBeGreaterThan(0);
}

function findButtonByText(text) {
  return [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
}

function editableEl() {
  return document.querySelector('[contenteditable="true"]');
}

function saveDriveButton() {
  return document.getElementById("drive-save-control-label");
}

// Scoped to the "File name" row specifically -- CombineDocumentsControl's
// format Select can render its own hidden input, so a bare
// `document.querySelector("input")` is not safe to assume is the file-name
// field.
function fileNameInput() {
  const label = [...document.querySelectorAll("span")].find((el) => el.textContent === "File name");
  return label?.parentElement?.querySelector("input") || null;
}

function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function enterEditMode() {
  await act(async () => {
    findButtonByText("Edit").click();
  });
}

async function typeInEditor(html) {
  const editor = editableEl();
  editor.innerHTML = html;
  await act(async () => {
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// Harness validation control (repo standing practice, R-282's own header):
// a no-op that must come back GREEN before any RED elsewhere in this file
// is believed.
// ---------------------------------------------------------------------------

describe("harness sanity control", () => {
  it("no-op arithmetic passes -- if this is not green, nothing else in this file can be trusted", () => {
    expect(1 + 1).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DriveResultRegion mount -- unconditional, above DialogActions.
// ---------------------------------------------------------------------------

describe("DriveResultRegion mount", () => {
  it("renders unconditionally, ABOVE DialogActions (the ReviseStrip slot), never inside the action bar", async () => {
    await render(baseProps());
    assertPortaled();

    const statusRegion = document.querySelector('[role="status"]');
    const closeButton = findButtonByText("Close");
    expect(statusRegion).toBeTruthy();
    expect(closeButton).toBeTruthy();

    // DOM order: the live region (DriveResultRegion) must precede Close,
    // DialogActions' first child.
    const position = statusRegion.compareDocumentPosition(closeButton);
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    // Never a child of DialogActions -- the action bar's own <form>-less
    // button row must not contain the status/alert spans.
    const closeRow = closeButton.closest(".MuiDialogActions-root");
    expect(closeRow?.querySelector('[role="status"]')).toBeNull();
  });

  it("renders even on a never-saved posting with nothing to report (its two live regions still exist)", async () => {
    await render(baseProps({ drive: driveProps({ status: "unconfigured", scopeCount: 0 }) }));
    assertPortaled();
    expect(document.querySelector('[role="status"]')).toBeTruthy();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    // DriveActions itself renders nothing for "unconfigured" -- confirms the
    // strip's unconditional mount is independent of the action bar's own
    // controls being present at all.
    expect(document.getElementById("drive-save-control-label")).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// THE LOAD-BEARING TEST: commit-before-read, proven by a click that never
// blurs the editor.
// ---------------------------------------------------------------------------

describe("Save to Drive wrapper -- commit before read (the seam)", () => {
  it("typed text reaches saveToDrive's activeText WITHOUT blurring, and the parent commit (onSave) fires synchronously as part of the same click", async () => {
    const callOrder = [];
    const onSave = vi.fn((...args) => callOrder.push(["onSave", args]));
    const saveToDrive = vi.fn((...args) => callOrder.push(["saveToDrive", args]));
    await render(baseProps({ onSave, drive: driveProps({ saveToDrive }) }));

    await enterEditMode();
    await typeInEditor("<p>FRESHLY TYPED TEXT</p>");

    // Click Save WITHOUT ever blurring the editor -- editorRef.current is
    // still mounted with the freshly typed content, and the 600ms auto-save
    // debounce has NOT fired yet.
    await act(async () => {
      saveDriveButton().click();
    });

    // The bytes handed to the save: saveToDrive's activeText carries what
    // was just typed.
    expect(saveToDrive).toHaveBeenCalledTimes(1);
    const call = saveToDrive.mock.calls[0][0];
    expect(call.activeScope).toBe("resume");
    expect(call.activeText).toContain("FRESHLY TYPED TEXT");

    // The wrapper's OWN commitDraft() call -- not the (unfired) debounce,
    // not a blur that jsdom never fires on a plain .click() -- is what
    // synchronously persists the edit to the parent via onSave. Dropping
    // commitDraft() from the wrapper leaves onSave uncalled at this point;
    // see this file's header / the final report for the mutation proof.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe("resume");
    expect(onSave.mock.calls[0][1].text).toContain("FRESHLY TYPED TEXT");

    // Commit before read/send.
    expect(callOrder.map((c) => c[0])).toEqual(["onSave", "saveToDrive"]);
  });
});

// ---------------------------------------------------------------------------
// File name: RAW vs TRIMMED (ARCH.md §4.3's second explicit override).
// ---------------------------------------------------------------------------

describe("Save to Drive wrapper -- file name is trimmed", () => {
  it("passes the TRIMMED file name to saveToDrive, matching what commitFileName persists, without blurring the field", async () => {
    const onRenameFile = vi.fn();
    const saveToDrive = vi.fn();
    await render(baseProps({ onRenameFile, drive: driveProps({ saveToDrive }) }));

    const input = fileNameInput();
    expect(input).toBeTruthy();
    await act(async () => {
      setNativeInputValue(input, "  New Resume Name  ");
    });

    // Save WITHOUT blurring the file-name field.
    await act(async () => {
      saveDriveButton().click();
    });

    expect(saveToDrive).toHaveBeenCalledTimes(1);
    expect(saveToDrive.mock.calls[0][0].activeFileName).toBe("New Resume Name");

    expect(onRenameFile).toHaveBeenCalledTimes(1);
    expect(onRenameFile).toHaveBeenCalledWith("resume", "New Resume Name");
  });
});

// ---------------------------------------------------------------------------
// Both scopes save with their own current text (ARCH.md §4.3's inactive-
// scope note): activeText patches only the ACTIVE scope; the inactive one
// relies on the pre-existing tab-change commit.
// ---------------------------------------------------------------------------

describe("Save to Drive wrapper -- both scopes carry their own current text", () => {
  it("editing resume then switching to cover commits resume via the tab change; saving on cover sends only cover's fresh text", async () => {
    const onSave = vi.fn();
    const saveToDrive = vi.fn();
    await render(baseProps({ onSave, drive: driveProps({ saveToDrive }) }));

    await enterEditMode();
    await typeInEditor("<p>NEW RESUME TEXT</p>");

    const coverTab = [...document.querySelectorAll('[role="tab"]')].find(
      (el) => el.textContent === "Cover letter",
    );
    expect(coverTab).toBeTruthy();
    await act(async () => {
      coverTab.click();
    });

    // The pre-existing tab-change commit (Tabs onChange -> commitDraft())
    // persisted resume's fresh text to the parent -- this wave relies on
    // it rather than re-implementing it.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe("resume");
    expect(onSave.mock.calls[0][1].text).toContain("NEW RESUME TEXT");

    await enterEditMode();
    await typeInEditor("<p>NEW COVER TEXT</p>");

    await act(async () => {
      saveDriveButton().click();
    });

    expect(saveToDrive).toHaveBeenCalledTimes(1);
    const call = saveToDrive.mock.calls[0][0];
    expect(call.activeScope).toBe("cover");
    expect(call.activeText).toContain("NEW COVER TEXT");
    // Never leaks the OTHER scope's text into this save's activeText.
    expect(call.activeText).not.toContain("NEW RESUME TEXT");

    // Cover's own commitDraft (from this save's wrapper) is the SECOND
    // onSave call -- resume's came from the tab-change commit above.
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toBe("cover");
    expect(onSave.mock.calls[1][1].text).toContain("NEW COVER TEXT");
  });
});

// ---------------------------------------------------------------------------
// A Drive save never disables the local Download button -- proves no Drive
// code writes the busy/notice/error prop maps those local controls gate on.
// ---------------------------------------------------------------------------

describe("Drive never touches the local busy/notice/error maps", () => {
  it("Download .docx stays enabled while a Drive save is in flight", async () => {
    await render(baseProps({ busy: {}, drive: driveProps({ status: "saving" }) }));
    const downloadButton = findButtonByText("Download .docx");
    expect(downloadButton).toBeTruthy();
    expect(downloadButton.disabled).toBe(false);
  });

  it("Download .docx stays enabled while the conflict prompt is pending", async () => {
    await render(
      baseProps({
        busy: {},
        drive: driveProps({
          status: "promptPending",
          prompt: {
            docNames: ["Acme - Resume"],
            onSaveAsNew: vi.fn(),
            onOverwrite: vi.fn(),
            onDismiss: vi.fn(),
          },
        }),
      }),
    );
    const downloadButton = findButtonByText("Download .docx");
    expect(downloadButton.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MAJOR-4 (AC-A4): "On the consent return, focus returns to the element
// captured at click time, else to the save control." Unimplemented before
// this wave -- a keyboard user connecting Drive landed on <body>. Driven
// here by re-rendering the SAME dialog instance with a `drive` prop whose
// `status` is walked through disconnected -> consentPending -> resolved,
// standing in for what the real hook does across the OAuth popup's
// lifetime; `root.render` on the same element type reconciles rather than
// remounts, so DocumentPreviewDialog's internal refs survive each step
// exactly like they would across the hook's own re-renders.
//
// Two verified traps this shape works around:
//   1. jsdom does NOT move focus on a synthetic MouseEvent. `saveButton
//      .click()` alone leaves `document.activeElement` wherever it already
//      was -- so every test below calls `.focus()` on the control FIRST,
//      then `.click()`. Skipping the explicit focus() would make these
//      tests pass even against an implementation that never captures
//      anything, because `document.activeElement` would already coincide
//      with the save button for an unrelated reason (jsdom's default).
//   2. A real browser blurs the opener document when `window.open` steals
//      focus for the new popup -- jsdom doesn't do this on its own since no
//      popup is actually opened here (`saveToDrive` is a stub), so it's
//      simulated explicitly with `saveButton.blur()` before advancing
//      `drive.status` to "consentPending", matching what
//      DocumentPreviewDialog.js's own restoration effect expects to see.
// ---------------------------------------------------------------------------

describe("AC-A4: focus returns to the clicked control after the consent popup, not <body>", () => {
  it("restores focus to the control captured at click time once drive.status leaves consentPending, if focus was left untouched", async () => {
    const saveToDrive = vi.fn();
    await render(baseProps({ drive: driveProps({ status: "disconnected", saveToDrive }) }));

    const saveButton = saveDriveButton();
    saveButton.focus();
    expect(document.activeElement).toBe(saveButton); // precondition

    await act(async () => {
      saveButton.click();
    });

    // Simulate the OAuth popup stealing focus from the opener document.
    await act(async () => {
      saveButton.blur();
    });
    expect(document.activeElement).toBe(document.body);

    // The hook reports the popup is up.
    await render(baseProps({ drive: driveProps({ status: "consentPending", saveToDrive }) }));
    expect(document.activeElement).toBe(document.body); // unchanged -- no premature restore

    // The popup resolves (consent granted) -- nothing else touched focus
    // in the meantime.
    await render(baseProps({ drive: driveProps({ status: "connected", saveToDrive }) }));

    expect(document.activeElement).toBe(saveDriveButton());
  });

  it("does not yank focus back if the user deliberately moved it elsewhere while the popup was open", async () => {
    const saveToDrive = vi.fn();
    await render(baseProps({ drive: driveProps({ status: "disconnected", saveToDrive }) }));

    const saveButton = saveDriveButton();
    saveButton.focus();
    await act(async () => {
      saveButton.click();
    });
    await act(async () => {
      saveButton.blur();
    });
    await render(baseProps({ drive: driveProps({ status: "consentPending", saveToDrive }) }));

    // The user tabs to an unrelated control while the popup is open.
    const closeButton = findButtonByText("Close");
    await act(async () => {
      closeButton.focus();
    });
    expect(document.activeElement).toBe(closeButton);

    await render(baseProps({ drive: driveProps({ status: "connected", saveToDrive }) }));

    // Still on Close -- the restoration effect must not override a focus
    // change that happened after it captured its baseline.
    expect(document.activeElement).toBe(closeButton);
  });
});

// ---------------------------------------------------------------------------
// WAVE6-VERIFY.md MAJOR-2 (AC-E14): "no Drive action ever writes a key of
// the busy/notice/error maps." Static reading already shows nothing in
// DocumentPreviewDialog.js's Drive path CAN write those maps (they arrive as
// plain props; this component holds no setter for its parent's busy state),
// but the shipped test before this file only checked ONE of the ten
// controls those maps gate (Download .docx via `busyActive`) -- mutating
// `anyBusy` to also read `drive.status === "saving"`, or mutating the
// `error` map the same way, both passed GREEN, because nothing exercised
// the other nine.
//
// Two layers, per the brief: a literal props-spy (a Proxy trapping any write
// to busy/notice/error, defence in depth against a hypothetical future
// direct mutation) PLUS the behavioural check that actually catches an
// `anyBusy`/`busyActive`-DERIVATION mutation like M8/M9 above -- a Proxy set
// trap can't see a formula change that reads `drive.status` directly and
// never assigns into the map at all, so the real guarantee this test proves
// is "every one of the ten controls stays enabled through a full drive.status
// cycle while busy/notice/error never change." The positive control at the
// end -- a deliberate busy write that must disable all ten -- exists so a
// selector typo (a control silently not found, or found-but-vacuous) can't
// let the "stayed enabled" checks above pass for the wrong reason. The ten
// are enumerated HERE, in the test, never in the criterion (WAVE6-VERIFY.md:
// four readers produced four different counts for this).
// ---------------------------------------------------------------------------

describe("AC-E14: no Drive action writes busy/notice/error, pinned across all ten gated controls", () => {
  function isDisabled(el) {
    if (!el) return null;
    if (el.disabled === true) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (el.classList?.contains("Mui-disabled")) return true;
    return false;
  }

  function reviseTextarea() {
    return [...document.querySelectorAll("textarea")].find((el) => !el.hasAttribute("aria-hidden"));
  }

  // The ten controls busy/notice/error gate, across the two formulas
  // (`anyBusy`: focus picker, framing, scan posting, combine format, combine
  // download; `busyActive`: version control, highlight toggle, the revise
  // textarea + its button, download .docx).
  function tenControls() {
    return {
      focusPicker: [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Focus:")),
      framing: [...document.querySelectorAll('[role="combobox"]')].find((el) => el.textContent.startsWith("Framing:")),
      scanPosting: findButtonByText("Scan posting"),
      combineFormat: [...document.querySelectorAll('[role="combobox"]')].find((el) => el.textContent === ".docx"),
      combineDownload: findButtonByText("Download combined"),
      versionControl: [...document.querySelectorAll('[role="combobox"]')].find((el) => el.textContent.startsWith("Version ")),
      highlightToggle: findButtonByText("Highlight changes"),
      reviseText: reviseTextarea(),
      reviseButton: findButtonByText("Revise"),
      download: findButtonByText("Download .docx"),
    };
  }

  it("stays enabled through a full Drive save cycle (props spy: zero writes), and a deliberate busy write disables all ten (positive control)", async () => {
    const writes = [];
    const spyMap = (label) =>
      new Proxy(
        {},
        {
          set(target, prop, value) {
            writes.push(`${label}.${String(prop)}`);
            target[prop] = value;
            return true;
          },
        },
      );
    const busy = spyMap("busy");
    const notice = spyMap("notice");
    const error = spyMap("error");

    const versions = [
      { id: "v1", created_at: "2024-01-01T00:00:00Z" },
      { id: "v2", created_at: "2024-01-02T00:00:00Z" },
    ];
    const saveToDrive = vi.fn();
    const commonProps = {
      engine: "embedded",
      // Not hand-edited (empty html), so HighlightToggle's disabled state is
      // governed by `busyActive` alone, not also by `handEdited` -- isolating
      // the one thing this test is pinning.
      scopes: baseScopes({ resume: { available: true, text: "OLD RESUME TEXT", html: "", fileName: "Resume File" } }),
      busy,
      notice,
      error,
      onOpenFocusPicker: vi.fn(),
      onSetFraming: vi.fn(),
      onScrapePosting: vi.fn(async () => ({})),
      onResubmit: vi.fn(async () => true),
      documentVersions: { resume: versions },
      currentVersionId: { resume: "v1" },
      onSelectVersion: vi.fn(),
    };

    await render(baseProps({ ...commonProps, drive: driveProps({ status: "disconnected", saveToDrive }) }));

    // Non-empty steering text so the Revise button's disabled state is
    // governed by busyActive, not by an empty textarea (a different, correct
    // reason to be disabled that this test isn't pinning).
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(reviseTextarea(), "some steering text");
      reviseTextarea().dispatchEvent(new Event("input", { bubbles: true }));
    });

    function assertAllEnabled() {
      const found = tenControls();
      Object.entries(found).forEach(([name, el]) => {
        expect(el, `control not found: ${name}`).toBeTruthy();
        expect(isDisabled(el), `expected ${name} to stay enabled`).toBe(false);
      });
      // `error`/`notice` gate no CONTROL (there is no `disabled={...error...}`
      // anywhere in the source) -- their only rendered effect is this text
      // region, so that's what a drive.status-derived `error`/`notice` write
      // (M9) would actually move. Both testids are given by DocumentPreview
      // Dialog.js's JSX specifically so this is checkable at all.
      expect(document.querySelector('[data-testid="scope-error"]')).toBeFalsy();
      expect(document.querySelector('[data-testid="scope-notice"]')).toBeFalsy();
    }

    assertAllEnabled();

    // Walk the SAME dialog instance through a full save cycle -- disconnected
    // -> consentPending -> saving -> connected -- while busy/notice/error
    // never change. None of the ten controls, nor the error/notice region,
    // may react to any of it.
    for (const status of ["consentPending", "saving", "connected"]) {
      await render(baseProps({ ...commonProps, drive: driveProps({ status, saveToDrive }) }));
      assertAllEnabled();
    }

    expect(writes).toEqual([]); // props spy: nothing Drive-reachable ever wrote busy/notice/error

    // POSITIVE CONTROL: prove the same selectors/assertions actually detect
    // the disabled state (and the error region) when busy/error are
    // genuinely set -- so a broken selector (one that silently finds
    // nothing, or finds the wrong node) can't be the reason every check
    // above passed.
    await render(baseProps({ ...commonProps, busy: { resume: true }, drive: driveProps({ status: "connected", saveToDrive }) }));
    const disabledNow = tenControls();
    Object.entries(disabledNow).forEach(([name, el]) => {
      expect(el, `control not found: ${name}`).toBeTruthy();
      expect(isDisabled(el), `expected ${name} to become disabled`).toBe(true);
    });

    await render(baseProps({ ...commonProps, error: { resume: "Something broke" }, drive: driveProps({ status: "connected", saveToDrive }) }));
    const errorRegion = document.querySelector('[data-testid="scope-error"]');
    expect(errorRegion).toBeTruthy();
    expect(errorRegion.textContent).toBe("Something broke");
  });
});

// ---------------------------------------------------------------------------
// WAVE6-VERIFY.md MAJOR-3 (AC-S6a, amended [jsdom]): the Drive save path and
// the local download path must produce BYTE-IDENTICAL .docx output for the
// same tailoring entry, in the branches where that's actually a promise the
// code makes (rows 1-3 of the re-derived four-row table -- see
// lib/document/previewBlob.js's own header for row 4, the hand-edited
// restored-chip case, which is EXCLUDED here on purpose: there the Drive
// path (rebuilds onto the stored engine document) is the correct behaviour
// and the local download path (rebuilds onto the user's generic uploaded
// template instead) is the defective one, so pinning them together would
// oblige the Drive path to reproduce a bug rather than catch a real
// divergence).
//
// Neither call site lives in a file this task may touch (useDriveDocuments.js
// and useDocumentPreview.js are both under app/hooks/), so this test drives
// the exact two REAL functions each call site hands its args to --
// `buildPreviewBlob` (attemptOneScope's own byte-builder, useDriveDocuments.
// js:591) for the Drive side, and the real `downloadDocxFiles` returned by
// `createDocumentDownloaders` (downloadDocumentPreview's own byte-builder,
// useDocumentPreview.js:543) for the local side -- with each side's
// ARGUMENT CONSTRUCTION mirroring that call site's literal field mapping
// (cited inline below), rather than reaching into resolveDocumentBlob
// directly and hand-waving the two callers' contracts as identical.
//
// vi.useFakeTimers() is MANDATORY, not a nicety: JSZip stamps a wall-clock
// `date` into every zip entry it (re)writes unless told otherwise
// (lib/document/docx.js:327, `zip.file(documentXmlPath, serializedXml)` with
// no `date` option) -- measured directly against this repo's JSZip: two
// back-to-back builds are byte-identical, but two builds even ~3s apart
// differ. Row 3 below calls buildDocxFromUploadedTemplate independently on
// each side, so without a frozen clock this test would be flaky by
// construction and would get deleted by whoever hit that flake next.
// ---------------------------------------------------------------------------

describe("AC-S6a: Drive-save bytes match local-download bytes, rows 1-3 (fake timers)", () => {
  function arrayBufferToBase64(buf) {
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  function expectByteIdentical(a, b) {
    expect(a.length).toBeGreaterThan(0);
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  }

  // Local path: the real downloadDocxFiles, with triggerBlobDownload mocked
  // (top of file) to capture the Blob instead of clicking a DOM anchor.
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile: null,
    coverLetterFile: null,
    tailoringMap: {},
    applicationData: [],
  });

  async function localDownloadBlob(entry, text) {
    h.downloads.length = 0;
    // useDocumentPreview.js:503-541's own field mapping for the résumé
    // scope, reproduced literally (not resolveDocumentBlob's args -- that
    // would skip the very call site this test exists to pin).
    const lines = text.split("\n");
    const unchanged = text === (entry.result || "");
    const serveFinished = !(entry.edited?.resume) && unchanged;
    const args = {
      jobTitle: "Staff Engineer",
      company: "Acme",
      result: text,
      resultLines: lines,
      coverLetterResultLines: [],
      docxB64: serveFinished && typeof entry.docxB64 === "string" ? entry.docxB64 : "",
      coverLetterDocxB64: "",
      docxPath: serveFinished && !entry.docxB64 && entry.docxPath ? entry.docxPath : "",
      resumeFileName: "",
      coverLetterFileName: "",
      templateDocxB64: typeof entry.docxB64 === "string" ? entry.docxB64 : "",
      templateDocxPath: typeof entry.docxPath === "string" ? entry.docxPath : "",
    };
    const err = await downloadDocxFiles(args);
    expect(err).toBeNull();
    expect(h.downloads).toHaveLength(1);
    return h.downloads[0].blob;
  }

  // Drive path: the real buildPreviewBlob/previewBlobArgs, exactly what
  // attemptOneScope calls (useDriveDocuments.js:591).
  async function driveSaveBlob(entry, text) {
    const blob = await buildPreviewBlob(entry, "resume", { resumeFile: null, coverLetterFile: null, text });
    expect(blob).toBeTruthy();
    return blob;
  }

  beforeEach(() => {
    // `toFake: ["Date"]` ONLY -- JSZip's own async pipeline schedules its
    // chunked work across real setTimeout/setImmediate ticks (confirmed
    // directly: faking those too hangs row 3's generateAsync() forever,
    // timing out this test). Freezing only Date is sufficient AND correct
    // for what row 3 actually needs: identical `new Date()` reads on both
    // independent builds, with real scheduling left alone.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("row 1 -- unedited, in-session engine doc: served verbatim, identically, on both paths", async () => {
    const STORED_TEXT = "STORED RESUME TEXT ROW1";
    const entry = {
      result: STORED_TEXT,
      resultLines: [STORED_TEXT],
      docxB64: btoa("ARBITRARY-VERBATIM-BYTES-ROW1"),
      docxPath: "",
      edited: { resume: false, cover: false },
    };

    const driveBlob = await driveSaveBlob(entry, STORED_TEXT);
    const localBlob = await localDownloadBlob(entry, STORED_TEXT);

    expectByteIdentical(await blobBytes(driveBlob), await blobBytes(localBlob));
  });

  it("row 2 -- unedited, persisted storage doc only: both paths fetch the SAME stored bytes verbatim", async () => {
    const STORED_TEXT = "STORED RESUME TEXT ROW2";
    h.storageBlob = new Blob(["ARBITRARY-STORED-BYTES-ROW2"], { type: "application/octet-stream" });
    const entry = {
      result: STORED_TEXT,
      resultLines: [STORED_TEXT],
      docxB64: "",
      docxPath: "resumes/user-1/row2.docx",
      edited: { resume: false, cover: false },
    };

    const driveBlob = await driveSaveBlob(entry, STORED_TEXT);
    const localBlob = await localDownloadBlob(entry, STORED_TEXT);

    expectByteIdentical(await blobBytes(driveBlob), await blobBytes(localBlob));
  });

  it("row 3 -- edited, in-session engine doc: both paths rebuild the SAME draft text onto the SAME template, byte for byte", async () => {
    const STORED_TEXT = "STORED RESUME TEXT ROW3";
    const DRAFT_TEXT = "FRESHLY EDITED DRAFT TEXT ROW3";
    const templateBlob = await buildMinimalistDocx([], STORED_TEXT);
    const templateB64 = arrayBufferToBase64(await templateBlob.arrayBuffer());
    const entry = {
      result: STORED_TEXT,
      resultLines: [STORED_TEXT],
      docxB64: templateB64,
      docxPath: "",
      edited: { resume: true, cover: false },
    };

    const driveBlob = await driveSaveBlob(entry, DRAFT_TEXT);
    const localBlob = await localDownloadBlob(entry, DRAFT_TEXT);

    const driveBytes = await blobBytes(driveBlob);
    const localBytes = await blobBytes(localBlob);
    expectByteIdentical(driveBytes, localBytes);

    // Not vacuous: confirm both sides actually rebuilt (not a template
    // fallback that happened to match) by reading the draft text back out.
    const zip = await JSZip.loadAsync(driveBytes);
    const xml = await zip.file("word/document.xml").async("string");
    expect(xml).toContain(DRAFT_TEXT);
    expect(xml).not.toContain(STORED_TEXT);
  });
});
