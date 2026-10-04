// @vitest-environment jsdom
//
// N105 Step 6 -- choosing a stop on the REAL ApplyingControls slider. The Ideal
// stop is a MODE: it goes through setTailorMode and never overwrites the saved
// 1..5 level (never setAggressiveness(6)); a standard stop clears the mode and
// sets the level. Driven through the native <input type=range> MUI mounts, the
// same element a keyboard or assistive-tech user changes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ApplyingControls from "./ApplyingControls.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/tailor/idealDelivery.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, idealLevelEnabled: () => gate.enabled };
});

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

const setAggressiveness = vi.fn();
const setTailorMode = vi.fn();

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
    setAggressiveness,
    tailorMode: "",
    setTailorMode,
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
  gate.enabled = true;
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

const sliderInput = () => container.querySelector('input[type="range"]');

// React tracks the input's value; assign through the native setter so the change
// event is not swallowed as "no change".
async function chooseStop(value) {
  const input = sliderInput();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, String(value));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("N105 Step 6 -- choosing a stop (gate ON)", () => {
  it("the Ideal stop sets the MODE and never writes aggressiveness 6", async () => {
    await renderControls();
    await chooseStop(6);
    expect(setTailorMode).toHaveBeenCalledWith("ideal");
    expect(setAggressiveness).not.toHaveBeenCalled();
  });

  it("a standard stop sets the level and clears the Ideal mode", async () => {
    await renderControls({ tailorMode: "ideal" });
    await chooseStop(2);
    expect(setAggressiveness).toHaveBeenCalledWith(2);
    expect(setTailorMode).toHaveBeenCalledWith("");
  });

  it("with the Ideal mode set the slider sits on the Ideal stop and announces it", async () => {
    await renderControls({ tailorMode: "ideal", aggressiveness: 3 });
    const input = sliderInput();
    expect(input.getAttribute("aria-valuenow")).toBe("6");
    expect(input.getAttribute("aria-valuetext")).toBe("Ideal, builds two resumes");
  });

  it("with the gate OFF a stale Ideal mode is not shown: the slider sits on the saved level", async () => {
    gate.enabled = false;
    await renderControls({ tailorMode: "ideal", aggressiveness: 4 });
    const input = sliderInput();
    expect(input.getAttribute("aria-valuenow")).toBe("4");
    expect(input.getAttribute("aria-valuemax")).toBe("5");
  });
});
