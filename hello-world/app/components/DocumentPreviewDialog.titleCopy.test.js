// @vitest-environment jsdom
//
// N63 -- "give copyable titles for each document in the preview/edit modal".
//
// SETTLED (brief): a document's "title" is its DOWNLOAD FILENAME BASE -- the
// File-name field's committed value minus the extension. It is the one string
// that (a) DIFFERS per document (the dialog heading is byte-identical on the
// resume and cover tabs) and (b) is guaranteed truthful to what an employer
// receives, because the download resolves the same base through the same
// resolveDocumentFileName() this suite anchors to.
//
// WHAT THIS FILE PROVES, and its measurement ceiling, stated plainly (memory
// `measurement-instruments`, backlog N74 -- a glossed limit is what this note
// exists to avoid): jsdom has NO real clipboard and does NO layout. Every row
// below proves that a REAL click on the REAL rendered control hands the CORRECT
// string to the single write path (writePlainText, observed here via the
// navigator.clipboard.writeText stub the async branch calls) and that the
// feedback DOM mutates. NONE of these rows proves the string reached the OS
// clipboard -- that is a browser-pane readText() check or a manual check
// (N63-T11), named in the notes artifact and NEVER inferred from a jsdom green.
//
// REACHABILITY (brief item 1 / N63-T1): this project has shipped a complete
// mechanism with the last hop missing seven times, twice this week. So the
// action under test is `control.click()` on the control found in the rendered
// dialog's own DOM -- never a call to a handler, a setter, or writePlainText.
// The control is found by its accessible name, exactly as a screen-reader user
// or a testing-library `getByRole` would reach it. A source scan / toContain /
// snapshot is an explicitly INSUFFICIENT instrument here and appears nowhere.
//
// THE JSDOM CLIPBOARD SEAM (measured and documented at length in this
// directory's DocumentPreviewDialog.copy.test.js): document.execCommand,
// navigator.clipboard, ClipboardEvent and DataTransfer are ALL undefined here.
// With the shipped default deps every click takes the copyEvent "unavailable"
// FAILURE branch (feeds the alert region, leaves polite ""); install the async
// clipboard stub and the SUCCESS branch runs (feeds polite, leaves alert "").
// Those are this file's two seam controls. `delete`, never `= undefined`, in
// teardown -- an assignment leaves a truthy own key that poisons every later
// file sharing this worker under --no-file-parallelism.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";
// The download's OWN resolver, imported as an INDEPENDENT instrument -- the
// property under test is "the copied base == the base the download produces",
// and this is the function the download (lib/document/docx.js:720-721) and
// Drive save (lib/drive/driveNames.js:31) both call. Never re-derived from the
// component under test.
import { resolveDocumentFileName, getDownloadFileNameForTitle, getDownloadCoverLetterFileNameForTitle } from "@/lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// the seam
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
// fixtures -- forked from the copy suite's, kept minimal
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

// The mount derives scopes[tab].fileName as `rawOverride || derivedBase` (see
// DocumentPreviewMount.js:368-378). This helper reproduces that EXACTLY so the
// dialog receives what production would: pass an override to model a rename,
// omit it to model the derived base the mount computes from title/company.
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

async function render(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, props));
  });
  // MUI's Dialog portals to document.body; without an unmount-per-render this
  // assertion is what keeps every document.querySelector below unambiguous.
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

// A stateful parent that seeds `scopes` and lets the child render normally --
// used only where a re-render with new scopes is needed.
function StatefulHost({ initialScopes, ...rest }) {
  const [scopes] = useState(initialScopes);
  return createElement(DocumentPreviewDialog, { ...rest, scopes });
}

// The dialog seeds the File-name field only on the closed->open TRANSITION
// (DocumentPreviewDialog.js:271-287), never on a mount that starts already
// open -- exactly how the real app opens it. Render closed, then open, so the
// field carries its committed seed for the rows that read it.
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

// Accessible-name reader, reproduced from the copy suite: aria-labelledby,
// then aria-label, then visible text, then title.
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

// The title/file-name copy control, found the way a user reaches it: by an
// accessible name that names the FILE NAME / TITLE it copies. Matches
// "file name" | "filename" | "title"; the existing text-copy control's name is
// "Copy text of the {doc}", which contains none of those, so the two are
// disjoint by construction (asserted in N63-T1).
const TITLE_NAME = /file ?name|title/i;
const titleCopyControl = () => buttons().find((b) => TITLE_NAME.test(accessibleName(b)));
// The existing document-TEXT copy control (DocumentPreviewDialog.js:947),
// found the same way -- the positive control that proves the finder works even
// on HEAD, and the node the title control must be DISTINCT from.
const textCopyControl = () => buttons().find((b) => /^copy text of the/i.test(accessibleName(b)));

const politeRegion = () => document.querySelector('[data-copy-status="polite"]');
const alertRegion = () => document.querySelector('[data-copy-status="alert"]');
const chipRegion = () => document.querySelector('[data-copy-status="chip"]');

// The drive suite's OWN file-name selector, reproduced verbatim
// (DocumentPreviewDialog.drive.test.js:193-196). Pinned here so the Step-1
// extraction that gives the copy control its home cannot silently break the
// structure the drive suite depends on (brief: "A LOUD REGRESSION TO AVOID").
function driveFileNameInput() {
  const label = [...document.querySelectorAll("span")].find((el) => el.textContent === "File name");
  return label?.parentElement?.querySelector("input") || null;
}
function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clickTitleCopy() {
  const control = titleCopyControl();
  expect(control, "the title/file-name copy control must be reachable by accessible name").toBeTruthy();
  await act(async () => {
    control.click();
  });
}

async function switchTab(label) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === label);
  expect(tab).toBeTruthy();
  await act(async () => {
    tab.click();
  });
}

function isDisabled(el) {
  if (!el) return null;
  if (el.disabled === true) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.classList?.contains("Mui-disabled")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// harness controls
// ---------------------------------------------------------------------------

describe("harness controls", () => {
  it("no-op arithmetic passes -- if this is red, nothing else here can be trusted", () => {
    expect(1 + 1).toBe(2);
  });

  it("this jsdom supplies NO clipboard surface, which is what the seam exists for", () => {
    expect(typeof document.execCommand).toBe("undefined");
    expect(typeof navigator.clipboard).toBe("undefined");
  });

  it("POSITIVE CONTROL: the existing document-TEXT copy control IS reachable by accessible name on HEAD", async () => {
    // This must be GREEN on HEAD. It proves the accessible-name finder works,
    // so that a RED title-copy row below is "the control is absent", never
    // "the finder is broken".
    await render(baseProps());
    expect(textCopyControl()).toBeTruthy();
    expect(accessibleName(textCopyControl())).toMatch(/copy text of the resume/i);
  });
});

// ---------------------------------------------------------------------------
// N63-T1 -- the control EXISTS and is REACHABLE on each docx document
// ---------------------------------------------------------------------------

describe("N63-T1: a distinct, reachable file-name copy control on the resume AND cover tabs", () => {
  it("is present, distinct from the text-copy control, and CLICKABLE on the resume tab", async () => {
    installClipboardStub();
    await render(baseProps());
    const title = titleCopyControl();
    expect(title).toBeTruthy(); // RED ON HEAD: no such control exists yet
    // DISTINCT node from the existing text-copy control -- a control that
    // merely re-finds the text-copy button is not a new affordance.
    expect(title).not.toBe(textCopyControl());
    expect(title.tagName).toBe("BUTTON");
    // Reached and ACTUATED as a user does -- a real click on the real node.
    await clickTitleCopy();
    expect(writeTextCalls.length).toBeGreaterThan(0);
  });

  it("is present and CLICKABLE on the cover tab after switching tabs", async () => {
    installClipboardStub();
    await render(baseProps());
    await switchTab("Cover letter");
    expect(titleCopyControl()).toBeTruthy(); // RED ON HEAD
    await clickTitleCopy();
    expect(writeTextCalls.length).toBeGreaterThan(0);
  });

  it("CANARY: a bogus accessible name matches no button, so the finder is not matching everything", async () => {
    await render(baseProps());
    const bogus = buttons().find((b) => /copy the mailing address/i.test(accessibleName(b)));
    expect(bogus).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// N63-T2 -- copyable whenever available, INDEPENDENT of the body render
// ---------------------------------------------------------------------------

describe("N63-T2: enabled whenever the document is available, not gated on docState", () => {
  it("is enabled and copies while the preview body is still loading, WHILE the text-copy control is disabled in the same frame", async () => {
    installClipboardStub();
    // A loadModel that never settles pins docState[tab] at {loading:true}, so
    // copyStateFor(available, docState[tab]) !== "ready" and the text-copy
    // control is disabled. The title does not depend on docState.
    await render(baseProps({ loadModel: vi.fn(() => new Promise(() => {})) }));
    // INDEPENDENCE CONTROL: the text-copy control really is gated in this frame
    // (otherwise "the title is enabled" proves nothing -- both could be).
    expect(isDisabled(textCopyControl())).toBe(true);
    const title = titleCopyControl();
    expect(title).toBeTruthy(); // RED ON HEAD
    expect(isDisabled(title)).toBe(false);
    await clickTitleCopy();
    expect(writeTextCalls).toHaveLength(1);
    expect(lastCopied()).toBe("Acme - Senior Engineer - Resume");
  });
});

// ---------------------------------------------------------------------------
// N63-T3 -- the copied title is TRUE to the file, and DISTINCT per document
// ---------------------------------------------------------------------------

describe("N63-T3: the copied base equals the download's base, and differs per document", () => {
  it("resume copies the resume base, cover copies the cover base; the two differ, neither is the heading or the label", async () => {
    installClipboardStub();
    await render(baseProps({ company: "Acme", jobTitle: "Senior Engineer" }));

    await clickTitleCopy();
    const resumeCopied = lastCopied();
    // Concrete literal -- computed by hand, independent of the component.
    expect(resumeCopied).toBe("Acme - Senior Engineer - Resume");
    // ...and it equals what the DOWNLOAD produces for the same document, by the
    // download's own resolver (the copy==download property).
    expect(resumeCopied).toBe(resolveDocumentFileName("Acme - Senior Engineer - Resume", "Senior Engineer", "Acme", "Resume").replace(/\.docx$/i, ""));

    await switchTab("Cover letter");
    await clickTitleCopy();
    const coverCopied = lastCopied();
    expect(coverCopied).toBe("Acme - Senior Engineer - CL");
    expect(coverCopied).toBe(resolveDocumentFileName("Acme - Senior Engineer - CL", "Senior Engineer", "Acme", "CL").replace(/\.docx$/i, ""));

    // DISTINCT per document -- the whole reason "titles for each document" is
    // the filename base and not the heading.
    expect(resumeCopied).not.toBe(coverCopied);
    // NOT the shared dialog heading (company · jobTitle)...
    expect(resumeCopied).not.toBe("Acme · Senior Engineer");
    expect(coverCopied).not.toBe("Acme · Senior Engineer");
    // ...NOT the SCOPE_LABEL, NOT the other tab's base.
    expect(resumeCopied).not.toBe("Resume");
    expect(coverCopied).not.toBe("Cover letter");
    // ...and each names the company, so a pasted title identifies the employer.
    expect(resumeCopied).toContain("Acme");
    expect(coverCopied).toContain("Acme");
  });
});

// ---------------------------------------------------------------------------
// N63-T4 -- never empty, never a placeholder, in the unknown/empty state
// ---------------------------------------------------------------------------

describe("N63-T4: unknown/empty state copies a non-empty default, never a placeholder", () => {
  it("no company and no job title: resume copies 'Target Role - Resume', cover 'Target Role - CL'", async () => {
    installClipboardStub();
    await render(baseProps({ company: "", jobTitle: "", scopes: scopesFor({ company: "", jobTitle: "" }) }));

    await clickTitleCopy();
    expect(lastCopied()).toBe("Target Role - Resume");

    await switchTab("Cover letter");
    await clickTitleCopy();
    expect(lastCopied()).toBe("Target Role - CL");

    for (const copied of writeTextCalls) {
      expect(copied.trim().length).toBeGreaterThan(0);
      expect(copied).not.toMatch(/undefined|null/);
    }
  });

  it("a committed-blank file name still resolves to the non-empty default, never ''", async () => {
    installClipboardStub();
    // scopes[tab].fileName = "" -- the dialog must re-resolve to the derived
    // default rather than copy an empty string.
    const scopes = scopesFor({ company: "Acme", jobTitle: "Senior Engineer" });
    scopes.resume.fileName = "";
    await render(baseProps({ company: "Acme", jobTitle: "Senior Engineer", scopes }));
    await clickTitleCopy();
    expect(lastCopied()).toBe("Acme - Senior Engineer - Resume");
    expect(lastCopied().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// N63-T5 -- a rename is reflected; copy and download never disagree
// ---------------------------------------------------------------------------

describe("N63-T5: a stored rename is reflected, sanitised to match the download, and read from the LIVE draft (N83)", () => {
  // N83: these two rows now render closed->open so the File-name field seeds
  // its draft from the committed override -- because the N83 fix reads the LIVE
  // draft (what the user sees), not scopes[tab].fileName. On an already-open
  // mount the draft would be "" and the copy would resolve to the derived
  // default, so a bare `render()` here is no longer production-faithful. The
  // seeded draft equals the committed override, so these stay GREEN on HEAD and
  // after the fix; only the third row below (the inverted one) is RED on HEAD.
  it("a stored override is copied verbatim when it needs no sanitising", async () => {
    installClipboardStub();
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: "Jane Doe CV" }) }));
    await clickTitleCopy();
    expect(lastCopied()).toBe("Jane Doe CV");
  });

  it("SILENT-FAILURE ROW: an override with characters the resolver strips copies the RESOLVED form, matching the download", async () => {
    // The plan's sharpest risk. If the copy read the field value RAW it
    // would hand "My/Resume:2024" to an employer's upload field while the
    // downloaded file is "MyResume2024.docx" -- copy and download disagree. The
    // copy must re-resolve through the same sanitiser the download uses.
    installClipboardStub();
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: "My/Resume:2024" }) }));
    await clickTitleCopy();
    // The download's own resolver is the independent oracle.
    const downloadBase = resolveDocumentFileName("My/Resume:2024", "Senior Engineer", "Acme", "Resume").replace(/\.docx$/i, "");
    expect(downloadBase).toBe("MyResume2024"); // self-test of the oracle
    expect(lastCopied()).toBe("MyResume2024");
    // ...and specifically NOT the raw, unsanitised override.
    expect(lastCopied()).not.toBe("My/Resume:2024");
    expect(lastCopied()).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("reads the LIVE uncommitted draft the user is looking at, not the last committed value (N83)", async () => {
    // N83 INVERTS THIS ROW. It formerly asserted the copy reads the COMMITTED
    // value, reasoning that Download must agree with Copy. That premise is
    // right; the resolution was backwards. A fresh verifier (NOT-SHIP on N63
    // commit b89371d) confirmed the bug: because the copy control's
    // onMouseDown preventDefault (CopyDocumentControl.js:80) keeps a pointer
    // click from blurring the field, a mouse/touch user who types a new name
    // and clicks "Copy file name" without tabbing away copies the PREVIOUS
    // name -- a silent wrong success. The fix makes BOTH Copy and Download read
    // the LIVE draft (following handleSaveToDrive, which already does). See
    // DocumentPreviewDialog.fileNameStaleness.test.js for the full class
    // (copy + download + drive + keyboard, driven by a real pointer sequence).
    installClipboardStub();
    await renderClosedThenOpen(baseProps({ scopes: scopesFor({ resumeOverride: "Committed Name" }) }));
    const input = driveFileNameInput();
    expect(input).toBeTruthy();
    expect(input.value).toBe("Committed Name"); // seeded from the committed value
    // Type a new draft WITHOUT committing (no blur -- the copy control's
    // onMouseDown preventDefault means clicking it never blurs the field).
    setNativeInputValue(input, "UNCOMMITTED DRAFT");
    await act(async () => {});
    expect(input.value).toBe("UNCOMMITTED DRAFT"); // the field now shows the draft
    await clickTitleCopy();
    // RED ON HEAD: HEAD copies "Committed Name". The fix copies the live draft.
    expect(lastCopied()).toBe("UNCOMMITTED DRAFT");
    expect(lastCopied()).not.toBe("Committed Name");
  });
});

// ---------------------------------------------------------------------------
// N63-T8 -- routes through the single write path, once per click
// ---------------------------------------------------------------------------

describe("N63-T8: the copy routes through the single write path, exactly once per click", () => {
  it("NO-WRITE-WITHOUT-A-CLICK: rendering alone writes nothing; the click is what writes", async () => {
    installClipboardStub();
    await render(baseProps());
    expect(writeTextCalls).toHaveLength(0); // no render-time / mount-time copy
    await clickTitleCopy();
    expect(writeTextCalls).toHaveLength(1); // exactly one write, from the click
    expect(lastCopied()).toBe("Acme - Senior Engineer - Resume");
  });
});

// ---------------------------------------------------------------------------
// N63-T10 -- the email tab gets NO dedicated title copy (scope boundary)
// ---------------------------------------------------------------------------

describe("N63-T10: no file-name/title copy control on the email tab", () => {
  it("the email tab exposes no title copy control (the email has no filename)", async () => {
    // VACUOUSLY GREEN ON HEAD -- no title control exists anywhere yet. Its
    // power is proven by a MUTANT in the reference tree (render the control
    // unconditionally / on the email tab -> this row goes red); see the notes
    // artifact. Kept as a scope boundary so the implementer's placement inside
    // the docx-only File-name row is asserted, not assumed.
    await render(baseProps());
    await switchTab("Hiring email");
    expect(titleCopyControl()).toBeUndefined();
    // POSITIVE CONTROL: the email tab DOES still carry the document-text copy
    // control, so "no title control" is not "the tab rendered nothing".
    expect(textCopyControl()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The drive suite's file-name selector must survive the extraction
// ---------------------------------------------------------------------------

describe("N63 regression guard: the drive suite's 'File name' -> parent -> input selector still resolves", () => {
  it("the span reading 'File name' has the file-name input under its parent element", async () => {
    // NON-REGRESSION GUARD (brief: "A LOUD REGRESSION TO AVOID"). Passes on
    // HEAD; guards the Step-1 extraction. Its power is proven by a MUTANT that
    // re-nests the row so the input leaves the span's parent -> this row goes
    // red (notes artifact). What it CANNOT catch: a wrong input value (only
    // that the structural selector still finds AN input).
    await renderClosedThenOpen(baseProps());
    const input = driveFileNameInput();
    expect(input).toBeTruthy();
    expect(input.tagName).toBe("INPUT");
    // It is the file-name field: seeded with the committed base on open.
    expect(input.value).toBe("Acme - Senior Engineer - Resume");
  });
});
