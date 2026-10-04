// @vitest-environment jsdom
//
// N105 Step 6 (DARK-LAUNCHED) -- the tailoring-level Slider, driven through the
// REAL ApplyingControls component (not a shim). These rows land RED as the
// implementer hand-off for the six-stop slider, its a11y, and the K14
// dark-launch gate.
//
// Reachability: every assertion reads the DOM the slider actually renders -- the
// native <input type=range> MUI mounts, its accessible name, its aria-valuetext,
// and the visible mark labels -- the same surface a sighted or screen-reader
// user meets. No prop-level or handler-level shortcut.
//
// RED reasons at HEAD:
//   * the live slider is max=5, label "Aggressiveness", id on the ROOT span and
//     NO accessible name or value text on the input (measured hole U4);
//   * it has no "Ideal" stop and consults no dark-launch gate.
//
// The dark-launch gate predicate lives in lib/tailor/idealDelivery.js
// (idealLevelEnabled, false in slice 1). It is mocked here so ON/OFF can be
// driven; at HEAD ApplyingControls does not import it yet, so the mock is inert
// until the implementer wires it -- the ON positive control still reds now
// because the live slider exposes no Ideal stop at all.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ApplyingControls from "./ApplyingControls.js";
import { levelAriaValueText } from "@/lib/tailor/tailorLevel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Controllable dark-launch gate. vi.hoisted so the mock factory can close over it.
const gate = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/tailor/idealDelivery.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, idealLevelEnabled: () => gate.enabled };
});

// A benign useProfileEntries controller stub: ApplyingControls renders three
// ProfileListSection instances, each of which calls formatAll() at render time.
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
    // The level control lives in the "Add Context" accordion -- open it, as a
    // user does via "Show options", so the slider is on screen.
    contextPanelOpen: true,
    setContextPanelOpen: () => {},
    aggressiveness: 3,
    setAggressiveness: () => {},
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
  gate.enabled = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

async function renderControls(overrides = {}) {
  await act(async () => {
    root.render(createElement(ApplyingControls, baseProps(overrides)));
  });
}

function sliderInput() {
  return container.querySelector('input[type="range"]');
}

// Accessible name per the ARIA name computation we actually rely on: an explicit
// aria-label, else the concatenated text of aria-labelledby targets.
function accessibleName(el) {
  if (!el) return "";
  const label = el.getAttribute("aria-label");
  if (label && label.trim()) return label.trim();
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (ids.length) {
    return ids
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function markLabels() {
  return [...container.querySelectorAll(".MuiSlider-markLabel")].map((n) => (n.textContent || "").trim());
}

describe("N105 Step 6 -- six-stop tailoring-level Slider (a11y)", () => {
  it("the Slider's input has an accessible NAME containing the visible label 'Tailoring level' (fixes U4)", async () => {
    await renderControls();
    const input = sliderInput();
    expect(input).toBeTruthy();
    const name = accessibleName(input);
    // RED at HEAD: the live slider puts its id on the ROOT span, so the input
    // resolves to an EMPTY name. Mutant that reds once built: remove the
    // aria-labelledby / slotProps naming -> name goes empty again.
    expect(name).not.toBe("");
    expect(name).toMatch(/tailoring level/i);
  });

  it("the visible control label reads 'Tailoring level', not 'Aggressiveness' (L2)", async () => {
    await renderControls();
    const text = container.textContent || "";
    expect(text).toMatch(/tailoring level/i);
    // Negative: the old intensity word must be gone -- the scale now ends in a
    // MODE, not an intensity.
    expect(text).not.toMatch(/aggressiveness/i);
  });

  it("the input carries aria-valuetext from levelAriaValueText for the current stop (L3)", async () => {
    // Control source is INDEPENDENT of the component: levelAriaValueText is the
    // single value-text table (tailorLevel.js), asserted here against the string
    // MUI puts on the input via getAriaValueText.
    await renderControls({ aggressiveness: 5 });
    expect(sliderInput().getAttribute("aria-valuetext")).toBe(levelAriaValueText(5));
    expect(levelAriaValueText(5)).toBe("Strong");

    await act(async () => {
      root.render(createElement(ApplyingControls, baseProps({ aggressiveness: 3 })));
    });
    expect(sliderInput().getAttribute("aria-valuetext")).toBe(levelAriaValueText(3));
    expect(levelAriaValueText(3)).toBe("Balanced");
  });
});

describe("N105 Step 6 -- K14 dark-launch gate on the Ideal stop", () => {
  it("POSITIVE CONTROL: with the gate ON, the Ideal stop is reachable (max 6 + an 'Ideal' mark)", async () => {
    gate.enabled = true;
    await renderControls();
    const input = sliderInput();
    // RED at HEAD: the live slider is hard-wired max=5 with no Ideal stop, so
    // even with the gate forced ON the stop is absent. Once built, this proves
    // the gate actually EXPOSES the stop (not a dead branch).
    expect(input.getAttribute("aria-valuemax")).toBe("6");
    expect(markLabels()).toContain("Ideal");
  });

  it("DARK-LAUNCH (slice-1 default): with the gate OFF, the Ideal stop is NOT reachable", async () => {
    // Discipline disclosure: at HEAD this asserts the ABSENCE of a stop that
    // does not exist yet, so it passes VACUOUSLY on HEAD. It becomes load-bearing
    // the moment the stop is built: paired with the ON positive control above it
    // pins that the slider CONSULTS idealLevelEnabled rather than exposing the
    // stop unconditionally.
    //   Mutant (K14) the pair kills: render max=6 / the Ideal mark regardless of
    //   the gate -> this OFF row reds.
    //   Realization assumed: the gate HIDES the stop (max stays 5). A build that
    //   instead renders a disabled-but-present Ideal mark would need this
    //   rewritten to assert the mark is non-interactive; the property under test
    //   is reachability either way.
    gate.enabled = false;
    await renderControls();
    expect(sliderInput().getAttribute("aria-valuemax")).not.toBe("6");
    expect(markLabels()).not.toContain("Ideal");
  });
});
