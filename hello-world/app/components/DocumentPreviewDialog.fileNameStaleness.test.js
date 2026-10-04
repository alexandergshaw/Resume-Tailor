// @vitest-environment jsdom
//
// N83 -- "preview Copy file name / Download .docx hand over a STALE file name".
//
// THE BUG (confirmed by a fresh verifier, NOT-SHIP on N63 commit b89371d,
// reproducible, not a jsdom artifact): the visible File-name <TextField> is
// driven by `fileNameDraft` (DocumentPreviewDialog.js:168, FileNameRow.js:47),
// but `activeTitle` -- the string "Copy file name" copies (FileNameRow.js:58 via
// title=activeTitle at :782) -- is resolved from `scopes[tab]?.fileName`
// (DocumentPreviewDialog.js:537), the LAST COMMITTED override, set only on
// blur/Enter (`commitFileName` at :425). `CopyDocumentControl.js:80` sets
// `onMouseDown={(e)=>e.preventDefault()}` deliberately (legitimate -- :74-79)
// so a POINTER click never blurs the field. So a mouse/touch user who types a
// new name and clicks "Copy file name" without tabbing away copies the PREVIOUS
// name. A silent wrong success -- no error, no warning.
//
// SAME CLASS: Download. `handleDownload` (:419) never calls `commitFileName`,
// and the download name resolves from the committed value downstream
// (useDocumentPreview.js:503-536 / documentScopes.js:38-57), one render late --
// so the download carries the old name too. Drive save is ALREADY CORRECT:
// `handleSaveToDrive` (:489-498) calls `commitFileName()` AND passes
// `fileNameDraft.trim()` directly, the exact pattern the fix must copy.
//
// WHAT THIS FILE PROVES, and its measurement ceiling (memory
// `measurement-instruments`): jsdom has NO real clipboard and does NO layout.
// Copy rows prove a REAL pointer activation on the REAL rendered control hands
// the CORRECT string to the single write path (writePlainText, observed via the
// navigator.clipboard.writeText stub). NONE of these rows proves the string
// reached the OS clipboard or that a downloaded .docx on disk carries the name
// -- those are browser-pane / manual checks, named in the notes artifact and
// NEVER inferred from a jsdom green.
//
// REACHABILITY / FIDELITY (brief item: "drive the real components with a REAL
// pointer interaction; a handler call would not exercise the
// preventDefault-on-mousedown path and would be degenerate"): every action here
// is dispatched as a real DOM `mousedown` + `click` on the real node found by
// its accessible name -- never a handler, setter, or writePlainText call. The
// mousedown is what runs the copy control's onMouseDown preventDefault (the
// production path that suppresses the field blur). jsdom does not move focus on
// a synthetic click (memory `loop-traps-tests`), so the no-commit condition
// this bug needs also holds trivially here -- which is faithful: the point is
// that NO commit happens between typing and activating, and the tests assert
// that directly (onRenameFile not called) rather than leaning on focus.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";
// The download's OWN resolver, imported as an INDEPENDENT oracle -- the property
// under test is "the copied base == the base the download produces", and this is
// the function the download (docx.js) and Drive save (driveNames.js) both call.
// Never re-derived from the component under test.
import { resolveDocumentFileName, getDownloadFileNameForTitle, getDownloadCoverLetterFileNameForTitle } from "@/lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// distinctive live-draft strings -- deliberately unlike any committed seed and
// unlike any model body text, so a match can ONLY mean the live draft flowed
// through. The committed seed the field is opened with:
// ---------------------------------------------------------------------------
const COMMITTED_SEED = "Committed Name Seed";
const COPY_DRAFT = "ZZ-Live-Copy-Draft-4242"; // needs no sanitising
const COPY_SANITIZE_DRAFT = "My/Live:Draft*4242"; // resolver strips / : *
const DOWNLOAD_DRAFT = "ZZ-Live-DL-Draft-7777";
const DRIVE_DRAFT = "ZZ-Live-Drive-Draft-5555";
const KB_DRAFT = "ZZ-Keyboard-Draft-9090";

// ---------------------------------------------------------------------------
// the clipboard seam (reproduced from DocumentPreviewDialog.titleCopy.test.js)
// ---------------------------------------------------------------------------

let removeClipboardStub = null;
let writeTextCalls;

function installClipboardStub() {
  writeTextCalls = [];
  navigator.clipboard = {
    writeText: (t) => {
      writeTextCalls.push(t);
      return Promise.resolve();
    },
    write: vi.fn(async () => {}),
  };
  removeClipboardStub = () => {
    delete navigator.clipboard;
  };
}
const lastCopied = () => writeTextCalls[writeTextCalls.length - 1];

// ---------------------------------------------------------------------------
// fixtures (forked from the copy suite's, kept minimal)
// ---------------------------------------------------------------------------

const MODEL_RESUME_LINES = ["MODEL RESUME NAME", "", "MODEL BULLET"];
const MODEL_COVER_LINES = ["Dear Hiring Manager,", "", "MODEL COVER BODY"];

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

// Reproduces DocumentPreviewMount.js:363-378's `rawOverride || derivedBase`
// exactly, so the dialog receives what production would.
function scopesFor({ resumeOverride, coverOverride, jobTitle = "Senior Engineer", company = "Acme", emailAvailable = true } = {}) {
  const resumeBase = resumeOverride != null ? resumeOverride : getDownloadFileNameForTitle(jobTitle, company).replace(/\.docx$/i, "");
  const coverBase = coverOverride != null ? coverOverride : getDownloadCoverLetterFileNameForTitle(jobTitle, company).replace(/\.docx$/i, "");
  return {
    resume: { available: true, text: MODEL_RESUME_LINES.join("\n"), html: undefined, fileName: resumeBase },
    cover: { available: true, text: MODEL_COVER_LINES.join("\n"), html: undefined, fileName: coverBase },
    email: { available: emailAvailable, text: "Subject: Application\n\nHi there," },
  };
}

function baseProps(overrides = {}) {
  const { jobTitle = "Senior Engineer", company = "Acme", scopes, ...rest } = overrides;
  return {
    open: true,
    jobTitle,
    company,
    initialTab: "resume",
    scopes: scopes || scopesFor({ jobTitle, company }),
    engine: "embedded",
    loadModel: vi.fn(async (scope) => ({ blocks: [{ type: "paragraph", runs: [{ text: scope }] }] })),
    onSave: vi.fn(),
    onRenameFile: vi.fn(),
    onDownload: vi.fn(),
    onClose: vi.fn(),
    busy: {},
    notice: {},
    error: {},
    drive: driveProps(),
    onActiveScopeChange: vi.fn(),
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

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
  removeClipboardStub?.();
  removeClipboardStub = null;
});

// The dialog seeds the File-name field ONLY on the closed->open transition
// (DocumentPreviewDialog.js:270-286), never on a mount that starts already open
// -- exactly how the real app opens it. Render closed, then open, so the field
// carries its committed seed (and the fix, which reads the live field, has a
// seeded draft to read). This is why the whole file uses closed->open rather
// than a bare open mount.
async function renderClosedThenOpen(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, { ...props, open: false }));
  });
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, { ...props, open: true }));
  });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

// A parent that RE-FEEDS scopes on rename, exactly as production does
// (renameDocument -> setTailoringMap -> re-render with the new fileName,
// useDocumentPreview.js:481-490 + DocumentPreviewMount.js:368-378). The
// keyboard path is only observably correct because production re-feeds; a
// static-scopes mock would falsely show it as broken. So the faithful keyboard
// harness MUST re-feed too (memory: "a harness that wires the component
// differently from production hides the wiring bug").
function StatefulHost({ open, initialScopes, onRename, ...rest }) {
  const [scopes, setScopes] = useState(initialScopes);
  const handleRename = (scope, name) => {
    onRename?.(scope, name);
    setScopes((s) => ({ ...s, [scope]: { ...s[scope], fileName: String(name || "").trim() } }));
  };
  return createElement(DocumentPreviewDialog, { ...rest, open, scopes, onRenameFile: handleRename });
}

async function renderStatefulClosedThenOpen({ initialScopes, onRename, ...rest }) {
  await act(async () => {
    root.render(createElement(StatefulHost, { open: false, initialScopes, onRename, ...rest }));
  });
  await act(async () => {
    root.render(createElement(StatefulHost, { open: true, initialScopes, onRename, ...rest }));
  });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

const buttons = () => [...document.querySelectorAll("button")];

// Accessible-name reader: aria-labelledby, then aria-label, then visible text,
// then title (reproduced from the copy suite).
function accessibleName(el) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.querySelector(`#${CSS.escape(id)}`)?.textContent || "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  const text = (clone.textContent || "").trim();
  return text || (el.getAttribute("title") || "").trim();
}

const TITLE_NAME = /file ?name|title/i;
const titleCopyControl = () => buttons().find((b) => TITLE_NAME.test(accessibleName(b)));
const textCopyControl = () => buttons().find((b) => /^copy text of the/i.test(accessibleName(b)));
const downloadControl = () => buttons().find((b) => /download \.docx/i.test(accessibleName(b)));
const driveSaveControl = () => buttons().find((b) => /^save\b.*to drive$/i.test(accessibleName(b)));

// The drive suite's OWN file-name selector, reproduced verbatim
// (DocumentPreviewDialog.drive.test.js). The "File name" span's parent contains
// the field's input.
function driveFileNameInput() {
  const label = [...document.querySelectorAll("span")].find((el) => el.textContent === "File name");
  return label?.parentElement?.querySelector("input") || null;
}
function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// A REAL pointer activation: mousedown (runs the copy control's
// preventDefault-on-mousedown, the production path that suppresses the blur)
// then click (runs the action). NOT a handler call.
async function pointerActivate(el) {
  expect(el, "the control must be reachable by accessible name").toBeTruthy();
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.click();
  });
}

async function switchTab(label) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === label);
  expect(tab).toBeTruthy();
  await act(async () => {
    tab.click();
  });
}

// ---------------------------------------------------------------------------
// harness controls
// ---------------------------------------------------------------------------

describe("harness controls", () => {
  it("NO-OP: arithmetic passes -- if this is red, nothing else here can be trusted", () => {
    expect(1 + 1).toBe(2);
  });

  it("this jsdom supplies NO clipboard surface, which is what the seam exists for", () => {
    expect(typeof document.execCommand).toBe("undefined");
    expect(typeof navigator.clipboard).toBe("undefined");
  });

  it("POSITIVE CONTROL: the file-name copy control IS present and reachable on HEAD (N63 shipped it)", async () => {
    // This is GREEN on HEAD. The N83 bug is about which VALUE it copies, not
    // whether it exists -- so a RED value row below is "wrong value", never
    // "the control/finder is broken". It is a distinct node from the text-copy
    // control.
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: COMMITTED_SEED }) }));
    const title = titleCopyControl();
    expect(title).toBeTruthy();
    expect(title).not.toBe(textCopyControl());
    expect(accessibleName(title)).toMatch(TITLE_NAME);
  });

  it("CANARY: a bogus accessible name matches no button, so the finders are not matching everything", async () => {
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: COMMITTED_SEED }) }));
    expect(buttons().find((b) => /copy the mailing address/i.test(accessibleName(b)))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// N83-T1 -- pointer COPY copies the LIVE draft, not the committed value
// ---------------------------------------------------------------------------

describe("N83-T1: a pointer Copy of a renamed-but-uncommitted field copies the LIVE draft", () => {
  it("copies what the user is looking at, not the last committed name (RED on HEAD)", async () => {
    installClipboardStub();
    const onRenameFile = vi.fn();
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: COMMITTED_SEED }), onRenameFile }));

    const input = driveFileNameInput();
    expect(input).toBeTruthy();
    expect(input.value).toBe(COMMITTED_SEED); // seeded from the committed value

    // The user types a new name; NO commit (no blur / focusout).
    setNativeInputValue(input, COPY_DRAFT);
    await act(async () => {});
    expect(input.value).toBe(COPY_DRAFT); // the field now shows the draft (onChange fired)

    // DISCRIMINATOR: the field is genuinely uncommitted -- commitFileName has
    // NOT fired. Without this, "copies the draft" could be "the commit happened
    // and re-fed scopes". It has not.
    expect(onRenameFile).not.toHaveBeenCalled();

    await pointerActivate(titleCopyControl());

    // The copy must re-resolve through the download's own resolver (copy==download).
    const expected = resolveDocumentFileName(COPY_DRAFT, "Senior Engineer", "Acme", "Resume").replace(/\.docx$/i, "");
    expect(expected).toBe(COPY_DRAFT); // oracle self-check: this draft needs no sanitising
    expect(lastCopied()).toBe(COPY_DRAFT); // RED ON HEAD: copies COMMITTED_SEED instead
    expect(lastCopied()).not.toBe(COMMITTED_SEED);
  });
});

// ---------------------------------------------------------------------------
// N83-T2 -- the LIVE draft is re-resolved (copy==download survives sanitising)
// ---------------------------------------------------------------------------

describe("N83-T2: a pointer Copy of a live draft with illegal characters copies the RESOLVED form", () => {
  it("copies the sanitised base the download would produce, never the raw draft (RED on HEAD)", async () => {
    installClipboardStub();
    const onRenameFile = vi.fn();
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: COMMITTED_SEED }), onRenameFile }));

    const input = driveFileNameInput();
    setNativeInputValue(input, COPY_SANITIZE_DRAFT);
    await act(async () => {});
    expect(input.value).toBe(COPY_SANITIZE_DRAFT);
    expect(onRenameFile).not.toHaveBeenCalled();

    await pointerActivate(titleCopyControl());

    const downloadBase = resolveDocumentFileName(COPY_SANITIZE_DRAFT, "Senior Engineer", "Acme", "Resume").replace(/\.docx$/i, "");
    expect(downloadBase).toBe("MyLiveDraft4242"); // oracle self-check
    expect(lastCopied()).toBe("MyLiveDraft4242"); // RED ON HEAD: copies COMMITTED_SEED
    // Specifically NOT the raw draft (the mutant "reads the draft but skips
    // re-resolving" dies here), and no path/illegal characters reach it.
    expect(lastCopied()).not.toBe(COPY_SANITIZE_DRAFT);
    expect(lastCopied()).not.toMatch(/[\\/:*?"<>|]/);
  });
});

// ---------------------------------------------------------------------------
// N83-T3 -- pointer DOWNLOAD conveys the LIVE draft (same class as copy)
// ---------------------------------------------------------------------------

describe("N83-T3: a pointer Download of a renamed-but-uncommitted field conveys the LIVE draft", () => {
  it("the live name reaches the download consumer, not the last committed name (RED on HEAD)", async () => {
    const onDownload = vi.fn();
    const onRenameFile = vi.fn();
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: COMMITTED_SEED }), onDownload, onRenameFile }));

    const input = driveFileNameInput();
    setNativeInputValue(input, DOWNLOAD_DRAFT);
    await act(async () => {});
    expect(input.value).toBe(DOWNLOAD_DRAFT);
    expect(onRenameFile).not.toHaveBeenCalled(); // uncommitted at download time

    await pointerActivate(downloadControl());

    expect(onDownload).toHaveBeenCalledTimes(1);
    // The live draft must be conveyed to the download. This deliberately does
    // NOT pin the argument SHAPE (payload field vs. positional arg) -- only
    // that the name the user typed reaches the consumer, which HEAD does not do
    // (it calls onDownload(tab, {text, html}) with no file name). Follows
    // handleSaveToDrive, which passes fileNameDraft.trim() directly.
    const conveyed = JSON.stringify(onDownload.mock.calls.at(-1));
    // GUARD: the distinctive draft cannot appear in the document body, so a
    // match can ONLY mean the file name was conveyed.
    expect(MODEL_RESUME_LINES.join("\n")).not.toContain(DOWNLOAD_DRAFT);
    expect(conveyed).toContain(DOWNLOAD_DRAFT); // RED ON HEAD
    expect(conveyed).not.toContain(COMMITTED_SEED);
  });
});

// ---------------------------------------------------------------------------
// N83-T4 -- Drive save is ALREADY correct and must stay so (non-regression)
// ---------------------------------------------------------------------------

describe("N83-T4: NON-REGRESSION -- pointer Save-to-Drive already conveys the LIVE draft", () => {
  it("passes fileNameDraft.trim() as activeFileName AND commits it (the pattern the fix copies) -- GREEN on HEAD", async () => {
    const saveToDrive = vi.fn();
    const onRenameFile = vi.fn();
    await renderClosedThenOpen(
      baseProps({ scopes: scopesFor({ resumeOverride: COMMITTED_SEED }), drive: driveProps({ saveToDrive }), onRenameFile }),
    );

    const input = driveFileNameInput();
    setNativeInputValue(input, DRIVE_DRAFT);
    await act(async () => {});
    expect(input.value).toBe(DRIVE_DRAFT);

    await pointerActivate(driveSaveControl());

    expect(saveToDrive).toHaveBeenCalledTimes(1);
    expect(saveToDrive.mock.calls[0][0]).toEqual(
      expect.objectContaining({ activeScope: "resume", activeFileName: DRIVE_DRAFT }),
    );
    // handleSaveToDrive ALSO commits -- the second half of the pattern.
    expect(onRenameFile).toHaveBeenCalledWith("resume", DRIVE_DRAFT);
  });
});

// ---------------------------------------------------------------------------
// N83-T5 -- the keyboard path works today and MUST keep working
// ---------------------------------------------------------------------------

describe("N83-T5: KEYBOARD PATH (tab-away commits, then activate) stays correct", () => {
  it("Tab-away commits, scopes re-feed, and a subsequent Copy reads the typed name -- GREEN on HEAD", async () => {
    installClipboardStub();
    const onRename = vi.fn();
    const { open: _open, scopes: _scopes, onRenameFile: _onRename, ...rest } = baseProps({
      jobTitle: "Senior Engineer",
      company: "Acme",
    });
    await renderStatefulClosedThenOpen({
      initialScopes: scopesFor({ resumeOverride: COMMITTED_SEED }),
      onRename,
      ...rest,
    });

    const input = driveFileNameInput();
    expect(input).toBeTruthy();
    expect(input.value).toBe(COMMITTED_SEED);

    setNativeInputValue(input, KB_DRAFT);
    await act(async () => {});
    expect(input.value).toBe(KB_DRAFT);

    // Tab away. React's onBlur is wired to focusout, not blur (memory
    // `loop-traps-tests`): dispatch focusout to model the commit a Tab produces.
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    // The commit fired and the parent re-fed scopes with the new name.
    expect(onRename).toHaveBeenCalledWith("resume", KB_DRAFT);

    await pointerActivate(titleCopyControl());
    expect(lastCopied()).toBe(KB_DRAFT); // GREEN on HEAD and after the fix
    expect(lastCopied()).not.toBe(COMMITTED_SEED);
  });

  it("SANITY: without the tab-away commit, the pointer Copy is stale on HEAD -- confirms T5's commit is load-bearing", async () => {
    // Companion to the row above: same setup, but NO focusout. On HEAD this is
    // the bug (copies the committed seed); after the fix it copies the draft.
    // Kept as an it.each-style contrast so a reader sees the commit is what
    // distinguishes the two, and so the row above cannot pass vacuously by the
    // copy always reading the draft regardless of commit.
    installClipboardStub();
    const onRename = vi.fn();
    const { open: _open, scopes: _scopes, onRenameFile: _onRename, ...rest } = baseProps({
      jobTitle: "Senior Engineer",
      company: "Acme",
    });
    await renderStatefulClosedThenOpen({
      initialScopes: scopesFor({ resumeOverride: COMMITTED_SEED }),
      onRename,
      ...rest,
    });
    const input = driveFileNameInput();
    setNativeInputValue(input, KB_DRAFT);
    await act(async () => {});
    expect(onRename).not.toHaveBeenCalled(); // no commit
    await pointerActivate(titleCopyControl());
    // After the fix this copies KB_DRAFT (pointer reads the live draft). This
    // row is therefore RED ON HEAD, like T1 -- included in the keyboard block
    // so the two paths sit side by side.
    expect(lastCopied()).toBe(KB_DRAFT);
    expect(lastCopied()).not.toBe(COMMITTED_SEED);
  });
});

// ---------------------------------------------------------------------------
// N83-T6 -- the same staleness on the COVER tab (the class, not one instance)
// ---------------------------------------------------------------------------

describe("N83-T6: the live-draft copy holds on the cover tab too (class, not instance)", () => {
  it("switching to the cover tab, typing, and pointer-Copying copies the live cover draft (RED on HEAD)", async () => {
    installClipboardStub();
    const onRenameFile = vi.fn();
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: COMMITTED_SEED, coverOverride: "Committed Cover Seed" }), onRenameFile }));

    await switchTab("Cover letter");
    const input = driveFileNameInput();
    expect(input).toBeTruthy();
    // On a tab switch the field reseeds from the cover's committed value
    // (DocumentPreviewDialog.js:318-322).
    expect(input.value).toBe("Committed Cover Seed");

    const coverDraft = "ZZ-Live-Cover-Draft-3131";
    setNativeInputValue(input, coverDraft);
    await act(async () => {});
    expect(input.value).toBe(coverDraft);
    expect(onRenameFile).not.toHaveBeenCalled();

    await pointerActivate(titleCopyControl());
    const expected = resolveDocumentFileName(coverDraft, "Senior Engineer", "Acme", "CL").replace(/\.docx$/i, "");
    expect(expected).toBe(coverDraft); // oracle self-check
    expect(lastCopied()).toBe(coverDraft); // RED ON HEAD: copies "Committed Cover Seed"
    expect(lastCopied()).not.toBe("Committed Cover Seed");
  });
});
