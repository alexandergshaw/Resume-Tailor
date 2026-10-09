// @vitest-environment jsdom
//
// N151b (4b) — T6 (panel wiring): ApplyingControls, given a `templateLibrary`
// prop, must RENDER the TemplateLibraryPanel in the Materials section — the real
// parent the user scrolls to. jsdom renders components here (precedent:
// ApplyingControls.markTemplate.test.js).
//
// REACHABILITY: the panel is located by its real a11y surface (the radiogroup +
// its "Template library" name) inside a full ApplyingControls mount — not by
// importing the panel directly.
//
// RED on HEAD: ApplyingControls neither accepts a templateLibrary prop nor renders
// the panel, so no radiogroup appears. GREEN after Step 5. (ApplyingControls
// itself imports fine on HEAD — this reds by ABSENCE of the panel, not by
// module-not-found.)
//
// Mutation that must RED: drop the <TemplateLibraryPanel /> render. No-op CONTROL
// that must survive: the shipped Materials controls ("Supplementary materials",
// "Upload files") still render.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ApplyingControls from "./ApplyingControls.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const A = { id: "tmpl-a", name: "Classic", kind: "resume" };

function profileCtl() {
  return {
    entries: [], open: false, setOpen: () => {}, add: () => {}, update: () => {},
    remove: () => {}, copyBlock: () => {}, copiedId: null, formatBlock: () => "",
    formatAll: () => "", copyAll: () => {}, allCopied: false, downloadDocx: () => {},
    downloadError: "",
  };
}
function templateLibraryStub(overrides = {}) {
  return {
    templates: [A], selectedId: "tmpl-a", loading: false, error: "",
    refresh: vi.fn(), select: vi.fn(), remove: vi.fn(), ...overrides,
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
    templateLibrary: templateLibraryStub(),
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
  await act(async () => { root.unmount(); });
  container.remove();
});
async function render(overrides = {}) {
  await act(async () => {
    root.render(createElement(ApplyingControls, baseProps(overrides)));
  });
}
function accName(el) {
  const label = (el.getAttribute("aria-label") || "").trim();
  if (label) return label;
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
}

describe("ApplyingControls renders the template library panel (T6)", () => {
  it("shows the switcher's radio group when given a templateLibrary prop", async () => {
    await render();
    const group = container.querySelector('[role="radiogroup"]');
    expect(group, "ApplyingControls did not render the TemplateLibraryPanel").toBeTruthy();
    expect(accName(group)).toMatch(/template library/i);
    expect(container.textContent).toContain("Classic");
  });

  it("[control] the shipped Materials controls still render alongside the panel", async () => {
    // The Materials section is unaffected by the panel's presence; this survives
    // the "drop the <TemplateLibraryPanel /> render" mutation. (The upload control
    // is a MUI Button component="label", i.e. a <label>, so match on text.)
    await render();
    expect(container.textContent).toMatch(/supplementary materials/i);
    expect(container.textContent, "the Upload files control vanished").toMatch(/upload files/i);
  });
});
