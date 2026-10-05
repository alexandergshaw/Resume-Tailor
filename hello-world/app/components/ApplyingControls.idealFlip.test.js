// @vitest-environment jsdom
//
// N107 go-live -- the FLIP, proven through the REAL ApplyingControls component
// with NO gate mock. The sibling ApplyingControls.idealSlider.test.js forces the
// dark-launch gate ON via a mock to prove the stop CAN appear; this file instead
// leaves idealDelivery.js real, so it measures what a user meets by DEFAULT after
// go-live: the sixth "Ideal" stop is reachable on the live slider with nothing
// mocked.
//
// Reachability: reads the native <input type=range> MUI renders and its visible
// mark labels -- the same surface a sighted or screen-reader user meets. The
// level control lives inside the "Add Context" accordion, opened here as a user
// does via "Show options".
//
// RED on HEAD: IDEAL_LEVEL_ENABLED is false, so the live slider clips to max 5
// with no Ideal mark. GREEN after the flip. This is the strongest flip proof --
// real component, real gate, real DOM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ApplyingControls from "./ApplyingControls.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function profileCtl() {
  return {
    entries: [],
    open: false,
    setOpen: () => {},
    add: () => {},
    update: () => {},
    remove: () => {},
    copyBlock: () => {},
    copiedId: null,
    formatBlock: () => "",
    formatAll: () => "",
    copyAll: () => {},
    allCopied: false,
    downloadDocx: () => {},
    downloadError: "",
  };
}

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "user-1" },
    resumeFile: null,
    setResumeFile: () => {},
    coverLetterFile: null,
    setCoverLetterFile: () => {},
    contextPanelOpen: true,
    setContextPanelOpen: () => {},
    aggressiveness: 3,
    setAggressiveness: () => {},
    tailorMode: "",
    setTailorMode: () => {},
    additionalContext: "",
    setAdditionalContext: () => {},
    setContextFiles: () => {},
    references: profileCtl(),
    education: profileCtl(),
    employment: profileCtl(),
    employmentImport: { loading: false },
    importEmploymentFromResume: () => {},
    renderCopyButton: () => null,
    materials: [],
    materialsBusy: false,
    materialsError: "",
    uploadMaterials: () => {},
    downloadMaterialFile: () => {},
    removeMaterialFile: () => {},
    askAiAboutMaterial: null,
    currentUserPresent: true,
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

async function renderControls(overrides = {}) {
  await act(async () => {
    root.render(createElement(ApplyingControls, baseProps(overrides)));
  });
}

function sliderInput() {
  return container.querySelector('input[type="range"]');
}

function markLabels() {
  return [...container.querySelectorAll(".MuiSlider-markLabel")].map((n) => (n.textContent || "").trim());
}

describe("N107 -- the Ideal stop is user-reachable on the live slider by default", () => {
  it("the slider exposes a sixth stop (aria-valuemax 6) with an 'Ideal' mark, no gate mock", async () => {
    await renderControls();
    const input = sliderInput();
    expect(input).toBeTruthy();
    // RED on HEAD: the live slider is max 5 while the gate is dark.
    expect(input.getAttribute("aria-valuemax")).toBe("6");
    expect(markLabels()).toContain("Ideal");
  });

  it("CONTROL: the five standard marks are still present (the flip adds a stop, it does not replace the scale)", async () => {
    await renderControls();
    const labels = markLabels();
    expect(labels).toContain("Light");
    expect(labels).toContain("Balanced");
    expect(labels).toContain("Strong");
    expect(labels).toContain("Ideal");
  });
});
