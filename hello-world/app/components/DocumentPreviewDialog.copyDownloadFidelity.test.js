// @vitest-environment jsdom
//
// N108 + N109 -- residuals of N83 (preview Copy / Download file-name fidelity).
//
// N83 made the preview's "Copy file name" and "Download .docx" convey the LIVE
// File-name field instead of the last committed value
// (DocumentPreviewDialog.fileNameStaleness.test.js). A fresh verifier then
// filed two residuals:
//
//   N108 -- the field BLANKED over a committed custom name. Copy fell back to
//   the COMMITTED name (resolveActiveDocumentTitle's `draft.trim() || committed`)
//   while Download conveyed "" and resolved to the DERIVED default
//   ("<Company> - <Position> - Resume"). Two egresses, two different file names
//   for one click on one screen -- the invariant the titleCopy suite states
//   ("copy and download never disagree") held for every non-blank draft only.
//   RULING: a blanked field resolves to the DERIVED default on every egress
//   (Copy, Download, Drive save, commit) -- commitFileName commits "" for a
//   blank field, so resurrecting the stale committed name on Copy/Download
//   would disagree with Drive save and the commit.
//
//   N109 -- the DOWNLOAD side of illegal-character fidelity had no test. The
//   copy side is pinned (fileNameStaleness N83-T2, 'My/Live:Draft*4242' ->
//   'MyLiveDraft4242'); the download side's property -- the raw draft reaches
//   downloadDocxFiles, which re-resolves it through resolveDocumentFileName,
//   so the file on disk carries the same sanitised base the copy handed over --
//   was asserted nowhere.
//
// WHAT IS MEASURED. Each row drives the REAL dialog with REAL pointer
// activations (mousedown + click on the nodes found by accessible name), then
// reads two observable outputs: the string the Copy control wrote to the
// clipboard stub, and the file name the real downloadDocxFiles handed to the
// browser-download trigger. The download side runs the SAME three-hop chain as
// useDocumentPreview.downloadDocumentPreview -- resolveDownloadPayload ->
// buildDownloadArgs -> createDocumentDownloaders().downloadDocxFiles -- with
// only the browser-download trigger (lib/document/download.js) replaced by a
// spy, the seam docx.hypotheticalDownload.test.js uses. The hook's own glue
// (one destructuring line + the call) is not re-run here; the chain it calls is.
//
// MEASUREMENT CEILING (memory `measurement-instruments`): jsdom has no real
// clipboard and no real file system. A green here proves the two strings a user
// would receive are equal, not that the OS clipboard or a saved .docx on disk
// holds them -- those are browser-pane / manual checks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/document/download.js", () => ({ triggerBlobDownload: vi.fn() }));

import DocumentPreviewDialog from "./DocumentPreviewDialog.js";
import { triggerBlobDownload } from "@/lib/document/download.js";
import {
  createDocumentDownloaders,
  resolveDocumentFileName,
  getDownloadFileNameForTitle,
  getDownloadCoverLetterFileNameForTitle,
} from "@/lib/document/docx.js";
import { resolveDownloadPayload, buildDownloadArgs } from "@/lib/tailor/documentScopes.js";
import { driveDocName } from "@/lib/drive/driveNames.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_TITLE = "Senior Engineer";
const COMPANY = "Acme";
const COMMITTED_RESUME = "Committed Resume Seed";
const COMMITTED_COVER = "Committed Cover Seed";
const DERIVED_RESUME = `${COMPANY} - ${JOB_TITLE} - Resume`;
const DERIVED_COVER = `${COMPANY} - ${JOB_TITLE} - CL`;

// ---------------------------------------------------------------------------
// the clipboard seam (reproduced from DocumentPreviewDialog.fileNameStaleness.test.js)
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
// fixtures
// ---------------------------------------------------------------------------

const MODEL_RESUME_LINES = ["MODEL RESUME NAME", "", "MODEL BULLET"];
const MODEL_COVER_LINES = ["Dear Hiring Manager,", "", "MODEL COVER BODY"];

function driveProps() {
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
  };
}

// Reproduces DocumentPreviewMount.js's `rawOverride || derivedBase` exactly:
// the dialog's scopes[tab].fileName is the committed override, or the derived
// base when there is none -- never empty in production.
function scopesFor({ resumeOverride, coverOverride } = {}) {
  const resumeBase = resumeOverride != null ? resumeOverride : getDownloadFileNameForTitle(JOB_TITLE, COMPANY).replace(/\.docx$/i, "");
  const coverBase = coverOverride != null ? coverOverride : getDownloadCoverLetterFileNameForTitle(JOB_TITLE, COMPANY).replace(/\.docx$/i, "");
  return {
    resume: { available: true, text: MODEL_RESUME_LINES.join("\n"), html: undefined, fileName: resumeBase },
    cover: { available: true, text: MODEL_COVER_LINES.join("\n"), html: undefined, fileName: coverBase },
    email: { available: true, text: "Subject: Application\n\nHi there," },
  };
}

function baseProps(overrides = {}) {
  return {
    open: true,
    jobTitle: JOB_TITLE,
    company: COMPANY,
    initialTab: "resume",
    scopes: scopesFor({ resumeOverride: COMMITTED_RESUME, coverOverride: COMMITTED_COVER }),
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
    ...overrides,
  };
}

// The tailoring-map entry the hook's downloadDocumentPreview reads. The finished
// docx bytes are a stub: the unedited path serves them verbatim (atob only), so
// the name is the only thing under test. resumeFileName/coverLetterFileName hold
// the COMMITTED overrides, as the real entry does.
function tailoringEntry() {
  return {
    docxB64: btoa("stub-resume-docx"),
    coverLetterDocxB64: btoa("stub-cover-docx"),
    resumeFileName: COMMITTED_RESUME,
    coverLetterFileName: COMMITTED_COVER,
  };
}

// The download side, end to end: the dialog's onDownload payload through the
// production chain to the name handed to the browser-download trigger.
async function downloadedFileName(scope, payload) {
  triggerBlobDownload.mockClear();
  const { text, lines, fileNameOverride } = resolveDownloadPayload(payload);
  const args = buildDownloadArgs({
    scope,
    entry: tailoringEntry(),
    text,
    lines,
    serveFinished: true,
    title: JOB_TITLE,
    company: COMPANY,
    spacing: null,
    formattingTemplate: null,
    fileNameOverride,
  });
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile: null,
    coverLetterFile: null,
    tailoringMap: {},
    applicationData: [],
  });
  const error = await downloadDocxFiles(args);
  expect(error, "the download chain must complete without an error").toBeFalsy();
  expect(triggerBlobDownload, "exactly one file is handed to the browser per download").toHaveBeenCalledTimes(1);
  return triggerBlobDownload.mock.calls[0][1];
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
  triggerBlobDownload.mockClear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  removeClipboardStub?.();
  removeClipboardStub = null;
});

// The File-name field seeds ONLY on the closed->open transition, so render
// closed then open -- exactly how the real app opens the dialog.
async function renderClosedThenOpen(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, { ...props, open: false }));
  });
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, { ...props, open: true }));
  });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

const buttons = () => [...document.querySelectorAll("button")];

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
const downloadControl = () => buttons().find((b) => /download \.docx/i.test(accessibleName(b)));

function fileNameInput() {
  const label = [...document.querySelectorAll("span")].find((el) => el.textContent === "File name");
  return label?.parentElement?.querySelector("input") || null;
}
function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// A REAL pointer activation: mousedown (the copy control's preventDefault, which
// is why the field never blurs) then click. NOT a handler call.
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

const driveSaveControl = () => buttons().find((b) => /^save\b.*to drive$/i.test(accessibleName(b)));

// Open the dialog, optionally on the cover tab, type `draft` into the field WITHOUT
// committing it, then Copy and Download by pointer. Returns the two observable
// names: what was copied, and the file name the download was saved under.
// `withDrive` (opt-in; every other row is unchanged) also presses Save to Drive
// and returns the Drive doc name the real useDriveDocuments derivation
// (driveDocName on the dialog's activeFileName) produces, plus the value the
// dialog committed to the parent via onRenameFile.
async function copyThenDownload({ scope, draft, withDrive = false }) {
  installClipboardStub();
  const onDownload = vi.fn();
  const onRenameFile = vi.fn();
  const saveToDrive = vi.fn();
  await renderClosedThenOpen(baseProps({ onDownload, onRenameFile, drive: { ...driveProps(), saveToDrive } }));
  if (scope === "cover") await switchTab("Cover letter");

  const input = fileNameInput();
  expect(input).toBeTruthy();
  expect(input.value).toBe(scope === "cover" ? COMMITTED_COVER : COMMITTED_RESUME); // seeded from the committed value
  setNativeInputValue(input, draft);
  await act(async () => {});
  expect(input.value).toBe(draft);
  // DISCRIMINATOR: the field is genuinely uncommitted, so the two egresses are
  // resolving the LIVE draft against the committed value, not a re-fed prop.
  expect(onRenameFile).not.toHaveBeenCalled();

  await pointerActivate(titleCopyControl());
  expect(writeTextCalls).toHaveLength(1);
  const copied = lastCopied();

  await pointerActivate(downloadControl());
  expect(onDownload).toHaveBeenCalledTimes(1);
  const [downloadScope, payload] = onDownload.mock.calls[0];
  expect(downloadScope).toBe(scope);
  const downloaded = await downloadedFileName(scope, payload);
  if (!withDrive) return { copied, downloaded };

  await pointerActivate(driveSaveControl());
  expect(saveToDrive).toHaveBeenCalledTimes(1);
  const driveArgs = saveToDrive.mock.calls[0][0];
  expect(driveArgs.activeScope).toBe(scope);
  const driveName = driveDocName({
    override: driveArgs.activeFileName,
    jobTitle: JOB_TITLE,
    company: COMPANY,
    kind: scope === "cover" ? "CL" : "Resume",
  });
  // Every commitFileName call (Download's, then Drive's) sends the same trimmed draft.
  const committed = onRenameFile.mock.calls.map(([, name]) => name);
  return { copied, downloaded, driveName, committed };
}

// ---------------------------------------------------------------------------
// harness controls
// ---------------------------------------------------------------------------

describe("harness controls", () => {
  it("NO-OP: arithmetic passes -- if this is red, nothing else here can be trusted", () => {
    expect(1 + 1).toBe(2);
  });

  it("POSITIVE CONTROL: a clean typed draft is copied AND downloaded under that name (the instrument can read both egresses)", async () => {
    const { copied, downloaded } = await copyThenDownload({ scope: "resume", draft: "Clean Live Draft 8080" });
    expect(copied).toBe("Clean Live Draft 8080");
    expect(downloaded).toBe("Clean Live Draft 8080.docx");
  });

  it("the derived defaults and the committed seeds are all distinct, so an agreeing pair can only mean the SAME resolution", () => {
    const names = new Set([DERIVED_RESUME, DERIVED_COVER, COMMITTED_RESUME, COMMITTED_COVER]);
    expect(names.size).toBe(4);
    expect(resolveDocumentFileName("", JOB_TITLE, COMPANY, "Resume")).toBe(`${DERIVED_RESUME}.docx`);
    expect(resolveDocumentFileName("", JOB_TITLE, COMPANY, "CL")).toBe(`${DERIVED_COVER}.docx`);
  });
});

// ---------------------------------------------------------------------------
// N108 -- a BLANKED field over a committed custom name
// ---------------------------------------------------------------------------

describe("N108: blanking the file name over a committed custom name -- Copy and Download name the SAME file", () => {
  const BLANKS = [
    ["empty", ""],
    ["whitespace-only", "   "],
  ];

  it.each(BLANKS)("%s draft, RESUME tab: the copied name and the downloaded file name agree", async (_label, blank) => {
    const { copied, downloaded } = await copyThenDownload({ scope: "resume", draft: blank });
    // THE invariant (RED before the fix: Copy named the committed seed, Download the derived default).
    expect(`${copied}.docx`).toBe(downloaded);
    // The agreed fallback: a blanked field resolves to the DERIVED default on
    // every egress -- the field commits "" (commitFileName), so the committed
    // seed is gone, and it must NOT be resurrected by either Copy or Download.
    expect(copied).toBe(DERIVED_RESUME);
    expect(downloaded).toBe(`${DERIVED_RESUME}.docx`);
    expect(copied).not.toBe(COMMITTED_RESUME);
  });

  it.each(BLANKS)("%s draft, COVER tab: the copied name and the downloaded file name agree (the class, not one instance)", async (_label, blank) => {
    const { copied, downloaded } = await copyThenDownload({ scope: "cover", draft: blank });
    expect(`${copied}.docx`).toBe(downloaded);
    expect(copied).toBe(DERIVED_COVER);
    expect(downloaded).toBe(`${DERIVED_COVER}.docx`);
    expect(copied).not.toBe(COMMITTED_COVER);
  });

  // All FOUR egresses of one blanked field name the same file: Copy, Download,
  // Drive save (driveDocName on activeFileName) and the commit (onRenameFile
  // with "", which DocumentPreviewMount re-derives as `"" || derivedBase`).
  it.each(BLANKS)("%s draft: Copy == Download == Drive save == the committed value's derived base (RESUME)", async (_label, blank) => {
    const { copied, downloaded, driveName, committed } = await copyThenDownload({ scope: "resume", draft: blank, withDrive: true });
    expect(driveName).toBe(DERIVED_RESUME); // the same derived default the dialog's Copy/Download land on
    expect(copied).toBe(driveName);
    expect(downloaded).toBe(`${driveName}.docx`);
    // The commit sends the blank, never the stale committed seed...
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((name) => name === "")).toBe(true);
    // ...and the mount's `rawOverride || derivedBase` (scopesFor) resolves "" to that same derived base.
    expect(committed[0] || scopesFor().resume.fileName).toBe(copied);
  });

  it.each(BLANKS)("%s draft: Copy == Download == Drive save == the committed value's derived base (COVER)", async (_label, blank) => {
    const { copied, downloaded, driveName, committed } = await copyThenDownload({ scope: "cover", draft: blank, withDrive: true });
    expect(driveName).toBe(DERIVED_COVER);
    expect(copied).toBe(driveName);
    expect(downloaded).toBe(`${driveName}.docx`);
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((name) => name === "")).toBe(true);
    expect(committed[0] || scopesFor().cover.fileName).toBe(copied);
  });

  it("a NON-blank draft over the same committed name still agrees on the LIVE draft (the fix does not regress N83)", async () => {
    const { copied, downloaded } = await copyThenDownload({ scope: "resume", draft: "ZZ-Live-Fidelity-6161" });
    expect(copied).toBe("ZZ-Live-Fidelity-6161");
    expect(`${copied}.docx`).toBe(downloaded);
    expect(downloaded).not.toContain(COMMITTED_RESUME);
  });
});

// ---------------------------------------------------------------------------
// N109 -- illegal characters: the DOWNLOAD path sanitises exactly as Copy does
// ---------------------------------------------------------------------------

describe("N109: a live draft with illegal characters -- the DOWNLOAD carries the same sanitised base as Copy", () => {
  const ILLEGAL = /[\\/:*?"<>|]/;

  it("RESUME: 'My/Live:Draft*4242' downloads as 'MyLiveDraft4242.docx', the base Copy handed over", async () => {
    const draft = "My/Live:Draft*4242"; // the same string fileNameStaleness N83-T2 pins on the copy side
    const { copied, downloaded } = await copyThenDownload({ scope: "resume", draft });
    expect(copied).toBe("MyLiveDraft4242");
    expect(downloaded).toBe("MyLiveDraft4242.docx");
    expect(`${copied}.docx`).toBe(downloaded);
    // Specifically NOT the raw draft on either egress, and no illegal character reaches the file name.
    expect(downloaded).not.toContain(draft);
    expect(downloaded).not.toMatch(ILLEGAL);
  });

  it("COVER: the same holds on the cover tab, which resolves with the 'CL' kind", async () => {
    const draft = "Cover/Live:Draft*3131";
    const { copied, downloaded } = await copyThenDownload({ scope: "cover", draft });
    expect(copied).toBe("CoverLiveDraft3131");
    expect(downloaded).toBe("CoverLiveDraft3131.docx");
    expect(`${copied}.docx`).toBe(downloaded);
    expect(downloaded).not.toMatch(ILLEGAL);
  });

  it("RESUME: every one of the nine illegal characters is stripped from the download, and Copy agrees", async () => {
    const draft = 'a\\b/c:d*e?f"g<h>i|j';
    const { copied, downloaded } = await copyThenDownload({ scope: "resume", draft });
    expect(copied).toBe("abcdefghij");
    expect(downloaded).toBe("abcdefghij.docx");
    expect(downloaded).not.toMatch(ILLEGAL);
  });

  it("RESUME: interior runs of whitespace collapse identically on both egresses", async () => {
    const { copied, downloaded } = await copyThenDownload({ scope: "resume", draft: "  Spaced   Out   Name  " });
    expect(copied).toBe("Spaced Out Name");
    expect(`${copied}.docx`).toBe(downloaded);
  });

  it("RESUME: a draft made ONLY of illegal characters sanitises to nothing, and both egresses fall to the SAME derived default", async () => {
    const { copied, downloaded } = await copyThenDownload({ scope: "resume", draft: '/:*?"<>|' });
    expect(copied).toBe(DERIVED_RESUME);
    expect(downloaded).toBe(`${DERIVED_RESUME}.docx`);
    expect(`${copied}.docx`).toBe(downloaded);
    expect(copied).not.toBe(COMMITTED_RESUME);
  });
});
