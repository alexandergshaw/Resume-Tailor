// @vitest-environment jsdom
//
// N107 go-live -- the caption under the tailoring-level slider follows the
// Ideal-level gate and is programmatically tied to the slider. The sibling
// ApplyingControls.levelCaption.test.js pins the caption TEXT per level; this
// file pins when the caption exists at all and how it is associated.
//
// With the gate OFF the slider has no Ideal stop, so a caption that describes
// "Ideal, the top level" would tease a level the user cannot select: nothing
// renders and the slider carries no aria-describedby. With the gate ON the
// slider's aria-describedby resolves to the caption node.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ApplyingControls from "./ApplyingControls.js";
import { LEVEL_CAPTIONS } from "@/lib/tailor/tailorLevel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/tailor/idealDelivery.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, idealLevelEnabled: () => gate.enabled };
});

function profileCtl() {
  return {
    entries: [], open: false, setOpen: () => {}, add: () => {}, update: () => {},
    remove: () => {}, copyBlock: () => {}, copiedId: null, formatBlock: () => "",
    formatAll: () => "", copyAll: () => {}, allCopied: false, downloadDocx: () => {}, downloadError: "",
  };
}

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "user-1" },
    resumeFile: null, setResumeFile: () => {},
    coverLetterFile: null, setCoverLetterFile: () => {},
    contextPanelOpen: true, setContextPanelOpen: () => {},
    aggressiveness: 3, setAggressiveness: () => {},
    tailorMode: "", setTailorMode: () => {},
    additionalContext: "", setAdditionalContext: () => {},
    setContextFiles: () => {},
    references: profileCtl(), education: profileCtl(), employment: profileCtl(),
    employmentImport: { loading: false }, importEmploymentFromResume: () => {},
    renderCopyButton: () => null,
    materials: [], materialsBusy: false, materialsError: "",
    uploadMaterials: () => {}, downloadMaterialFile: () => {}, removeMaterialFile: () => {},
    askAiAboutMaterial: null, currentUserPresent: true,
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
});

async function renderControls(overrides = {}) {
  await act(async () => {
    root.render(createElement(ApplyingControls, baseProps(overrides)));
  });
}

const sliderInput = () => container.querySelector('input[type="range"]');
const text = () => container.textContent || "";

describe("N107 -- the level caption exists only while the Ideal stop is on offer", () => {
  it("gate OFF: no caption renders and the slider has no aria-describedby", async () => {
    gate.enabled = false;
    await renderControls({ tailorMode: "", aggressiveness: 3 });
    expect(text()).not.toContain(LEVEL_CAPTIONS.standard);
    expect(container.querySelector("#tailoring-level-caption")).toBeNull();
    expect(sliderInput().getAttribute("aria-describedby")).toBeNull();
  });

  it("gate OFF: a stale saved 'ideal' mode does not surface the Ideal caption either", async () => {
    gate.enabled = false;
    await renderControls({ tailorMode: "ideal", aggressiveness: 3 });
    expect(text()).not.toContain(LEVEL_CAPTIONS.ideal);
    expect(container.querySelector("#tailoring-level-caption")).toBeNull();
  });

  it("gate ON: the slider's aria-describedby resolves to a non-empty caption node, per level", async () => {
    for (const [tailorMode, expected] of [
      ["", LEVEL_CAPTIONS.standard],
      ["ideal", LEVEL_CAPTIONS.ideal],
    ]) {
      await renderControls({ tailorMode, aggressiveness: 3 });
      const id = sliderInput().getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      const node = document.getElementById(id);
      expect(node).toBeTruthy();
      expect((node.textContent || "").trim()).toBe(expected);
    }
  });

  it("the caption is static text: not a live region", async () => {
    await renderControls({ tailorMode: "ideal", aggressiveness: 3 });
    const node = container.querySelector("#tailoring-level-caption");
    expect(node).toBeTruthy();
    expect(node.getAttribute("role")).toBeNull();
    expect(node.getAttribute("aria-live")).toBeNull();
  });
});
