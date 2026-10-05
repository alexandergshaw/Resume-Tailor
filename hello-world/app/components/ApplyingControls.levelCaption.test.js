// @vitest-environment jsdom
//
// N107 go-live -- the caption leaf under the tailoring-level slider, driven
// through the REAL ApplyingControls component. The slider gained its sixth stop
// at N105 Step 6, but the caption that tells a user what the selected level
// DOES was never built: LEVEL_CAPTIONS has sat as an orphaned export
// (lib/sourceScan/exportReachability.ledger.js records it, idealCannotRunCaption
// and idealCannotRunAnnouncement as the "unbuilt caption leaf"). Go-live wants
// the caption, so these rows pin that a VISIBLE caption describing the selected
// level renders, and that it follows the selection rather than being hardwired.
//
// Reachability: reads container.textContent -- the visible prose a user reads
// under the slider -- after mounting the real component with the level control's
// accordion open, exactly as a user meets it.
//
// ORACLE NOTE (deliberate): the expected caption copy is asserted as literal
// user-facing PHRASES rather than by importing LEVEL_CAPTIONS. Importing that
// still-orphaned symbol from a test would move it out of the orphan ledger and
// red lib/sourceScan/exportReachability.sweep.test.js on HEAD -- an instrument
// failure in another file, not a behavior of this feature (loop-traps-tests:
// "a test that trips a repo gate is usually testing the wrong entry point").
// When the implementer wires the leaf, ApplyingControls imports LEVEL_CAPTIONS
// as a SHIPPING consumer, which is what legitimately retires those ledger rows;
// at that point the copy here and the table are kept in step by the render.
// The phrases chosen are distinctive enough that a swapped or absent caption is
// caught, and the standard/ideal pair is the over-fire control.
//
// RED on HEAD: no caption element exists at all, so every phrase is absent.
//
// The dark-launch gate is mocked so the Ideal stop can be selected to read its
// caption; after go-live the real gate is ON, but mocking keeps this row
// independent of the flip's timing.

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
  vi.clearAllMocks();
});

async function renderControls(overrides = {}) {
  await act(async () => {
    root.render(createElement(ApplyingControls, baseProps(overrides)));
  });
}

const text = () => container.textContent || "";

describe("N107 -- a visible caption describes the selected tailoring level", () => {
  it("a standard level shows the standard caption (and NOT the Ideal 'what it builds' text)", async () => {
    // RED on HEAD: no caption element at all. The negative half is the over-fire
    // control: a caption hardwired to the Ideal text reds here.
    await renderControls({ tailorMode: "", aggressiveness: 3 });
    const t = text();
    expect(t).toContain("the top level");
    expect(t).not.toContain("two files in one run");
  });

  it("the Ideal stop shows the 'what it builds' caption (two documents, hypothetical never submitted, resume only)", async () => {
    // RED on HEAD. A swapped caption (standard copy on the Ideal stop) reds via
    // the distinctive Ideal phrases; an absent caption reds via the same.
    await renderControls({ tailorMode: "ideal", aggressiveness: 3 });
    const t = text();
    expect(t).toContain("two files in one run");
    expect(t).toContain("HYPOTHETICAL");
    expect(t).toContain("no cover letter");
    // Scope control: the Ideal caption is not the standard teaser.
    expect(t).not.toContain("the top level");
  });
});
