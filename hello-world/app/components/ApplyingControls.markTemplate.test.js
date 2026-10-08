// @vitest-environment jsdom
//
// N151a (4b) — T10 / T11: the "Add to template library" control on each
// supplementary material, proven through the REAL ApplyingControls component
// (its real action row at ApplyingControls.js:376-403), the same surface a user
// meets. jsdom renders components here (vitest.config.js oxc lang:"jsx";
// JobDescriptionTab.test.js / ApplyingControls.idealFlip.test.js are the
// precedents).
//
// REACHABILITY: the button is found and clicked exactly as a user reaches it —
// mounted in its real parent, located by its visible label, clicked with a real
// MouseEvent. No handler is called directly.
//
// RED on HEAD: ApplyingControls renders no "Add to template library" button and
// takes no markMaterialAsTemplate prop. GREEN after Step 7.
//
// T10 mutation that must RED: render the button unconditionally (it would then
// appear for the .pdf row and when signed out). No-op CONTROL that must survive:
// Ask AI / Download / Remove still render and fire.
// T11 mutation that must RED: detach the button's onClick. CONTROL: Download
// still downloads.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ApplyingControls from "./ApplyingControls.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ADD_LABEL = /add to template library/i;

function profileCtl() {
  return {
    entries: [], open: false, setOpen: () => {}, add: () => {}, update: () => {},
    remove: () => {}, copyBlock: () => {}, copiedId: null, formatBlock: () => "",
    formatAll: () => "", copyAll: () => {}, allCopied: false, downloadDocx: () => {},
    downloadError: "",
  };
}

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "user-1" },
    resumeFile: null, setResumeFile: () => {},
    coverLetterFile: null, setCoverLetterFile: () => {},
    contextPanelOpen: false, setContextPanelOpen: () => {},
    aggressiveness: 3, setAggressiveness: () => {},
    tailorMode: "", setTailorMode: () => {},
    additionalContext: "", setAdditionalContext: () => {},
    setContextFiles: () => {},
    references: profileCtl(), education: profileCtl(), employment: profileCtl(),
    employmentImport: { loading: false }, importEmploymentFromResume: () => {},
    renderCopyButton: () => null,
    materials: [],
    materialsBusy: false, materialsError: "",
    uploadMaterials: () => {},
    downloadMaterialFile: vi.fn(),
    removeMaterialFile: vi.fn(),
    askAiAboutMaterial: vi.fn(),
    markMaterialAsTemplate: vi.fn(),
    currentUserPresent: true,
    ...overrides,
  };
}

const docxItem = { name: "resume.docx", size: 1234, source: "remote" };
const pdfItem = { name: "transcript.pdf", size: 999, source: "remote" };

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function render(overrides = {}) {
  await act(async () => {
    root.render(createElement(ApplyingControls, baseProps(overrides)));
  });
}

function allButtons() {
  return [...container.querySelectorAll("button")];
}
// Match on VISIBLE TEXT only. The per-material action buttons (Ask AI, Download,
// Remove, and the new "Add to template library") are text buttons; the sibling
// ProfileListSection controls are icon-only IconButtons that carry their name in
// aria-label with EMPTY textContent — matching aria-label too would wrongly pull
// those in (measured: /download/i matched 4 icon buttons). Text-only matching
// scopes cleanly to the materials row.
function buttonsNamed(pattern) {
  return allButtons().filter((b) => pattern.test((b.textContent || "").trim()));
}
async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// ---------------------------------------------------------------------------
// T10 — the .docx-only, signed-in-only gate.
// ---------------------------------------------------------------------------
describe("Add-to-template-library gate (T10)", () => {
  it("shows the button for a .docx material and NOT for a .pdf material (exactly one, on the docx row)", async () => {
    await render({ materials: [docxItem, pdfItem] });
    const adds = buttonsNamed(ADD_LABEL);
    expect(adds, "expected exactly one Add-to-template-library button (the .docx)").toHaveLength(1);
    // It belongs to the docx row, not the pdf row.
    const row = adds[0].closest("div")?.parentElement;
    expect((row?.textContent || "")).toContain("resume.docx");
    expect((row?.textContent || "")).not.toContain("transcript.pdf");
  });

  it("does NOT show the button when signed out (absence is the disabled reason)", async () => {
    await render({ materials: [docxItem], currentUser: null, currentUserPresent: false });
    expect(buttonsNamed(ADD_LABEL)).toHaveLength(0);
  });

  it("[control] Ask AI / Download / Remove still render for the .docx material (the gate is specific)", async () => {
    await render({ materials: [docxItem] });
    expect(buttonsNamed(/ask ai/i).length, "Ask AI missing").toBeGreaterThan(0);
    expect(buttonsNamed(/download/i).length, "Download missing").toBeGreaterThan(0);
    expect(buttonsNamed(/remove/i).length, "Remove missing").toBeGreaterThan(0);
  });

  it("[control] the .pdf material still has its Download/Remove controls (only the library button is gated)", async () => {
    await render({ materials: [pdfItem] });
    expect(buttonsNamed(ADD_LABEL)).toHaveLength(0);
    expect(buttonsNamed(/download/i).length).toBeGreaterThan(0);
    expect(buttonsNamed(/remove/i).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T11 — clicking fires markMaterialAsTemplate(item) with the right item.
// ---------------------------------------------------------------------------
describe("Add-to-template-library click (T11)", () => {
  it("clicking the button calls markMaterialAsTemplate with that material", async () => {
    const markMaterialAsTemplate = vi.fn();
    await render({ materials: [docxItem], markMaterialAsTemplate });
    const [btn] = buttonsNamed(ADD_LABEL);
    expect(btn, "no Add-to-template-library button to click").toBeTruthy();
    await click(btn);
    expect(markMaterialAsTemplate).toHaveBeenCalledTimes(1);
    expect(markMaterialAsTemplate.mock.calls[0][0]).toMatchObject({ name: "resume.docx" });
  });

  it("[control] clicking Download still calls downloadMaterialFile (click wiring isn't globally broken)", async () => {
    const downloadMaterialFile = vi.fn();
    await render({ materials: [docxItem], downloadMaterialFile });
    const [dl] = buttonsNamed(/download/i);
    await click(dl);
    expect(downloadMaterialFile).toHaveBeenCalledTimes(1);
    expect(downloadMaterialFile.mock.calls[0][0]).toMatchObject({ name: "resume.docx" });
  });
});

// WHAT THIS CANNOT CATCH: it stubs markMaterialAsTemplate, so it does not prove
// the handler fetches remote bytes and POSTs with the derived name — that is the
// useMaterialsLocker hook test. And the server-side mark->active join is T9.
