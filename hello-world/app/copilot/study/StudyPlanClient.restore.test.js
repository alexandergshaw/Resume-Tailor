// @vitest-environment jsdom
//
// N160 -- the study-plan surface restores the last application the user BUILT a
// plan for. The shared PostingPicker already takes `initialId` (pinned in
// app/copilot/PostingPicker.defaults.test.js); this file pins the part that was
// deferred at N157 SC-C because a persisted restore "would auto-select across the
// landed copilot tests": StudyPlanClient reads a per-viewer id from localStorage
// ONCE at mount, hands it to the picker as `initialId`, and writes it when a build
// starts.
//
// THE INERT-BY-DEFAULT FLOOR. With nothing persisted (the state every landed
// suite runs in) the picker must receive NO initialId and nothing may select --
// the second describe block pins exactly that, with the real picker mounted, so a
// restore that fires on an empty store fails here before it can leak into the
// seven CopilotClient hard-gate suites or the PracticeSurface suite.
//
// HOW IT IS DRIVEN. The real StudyPlanClient and the real PostingPicker, through
// the same seams the landed StudyPlanClient.test.js stubs (engine store, posting
// loader, the Supabase binding, fetch). PostingPicker is wrapped, not replaced:
// the wrapper records the props StudyPlanClient hands it and renders the real one,
// so "receives initialId" is observed at the boundary AND the preselect is
// observed through the DOM. The storage key is pinned as a literal on purpose: it
// is a persisted contract, and a rename silently drops every viewer's last choice.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "studyPlan:lastApplicationId";

// ---- controllable seams (same set the landed StudyPlanClient suite stubs) ---
vi.mock("@/app/settings/engine", () => ({
  useEngine: () => ({ engine: "gemini", setEngine: () => {} }),
  readEngine: () => "gemini",
}));

const fetchPracticePostings = vi.fn();
vi.mock("@/lib/copilot/postings", () => ({ fetchPracticePostings: (...a) => fetchPracticePostings(...a) }));

const reader = vi.fn(async () => EMPTY_RECORD);
const writer = vi.fn(async () => ({ written: true, error: null }));
const bindStudyPlan = vi.fn(() => ({ reader, writer }));
vi.mock("@/lib/studyPlan/studyPlanBrowser.js", () => ({ bindStudyPlan: (...a) => bindStudyPlan(...a) }));

// Records every prop object StudyPlanClient hands the picker, then renders the real one.
const pickerProps = vi.hoisted(() => []);
vi.mock("../PostingPicker", async (importOriginal) => {
  const actual = await importOriginal();
  const React = await import("react");
  return {
    default: (props) => {
      pickerProps.push(props);
      return React.createElement(actual.default, props);
    },
  };
});

const OPTION = { id: "app-7", title: "Staff Engineer", company: "Acme", label: "Staff Engineer — Acme" };
const EMPTY_RECORD = { status: null, plan: null, knobs: null, progress: null, cachedResearch: null, researchedAt: null, engine: null, error: null };

function response(json) {
  return { ok: true, status: 200, json: async () => json };
}

let resetBuild;
let resetProgress;
let StudyPlanClient;
let container;
let root;
let originalFetch;

beforeEach(async () => {
  pickerProps.length = 0;
  reader.mockClear();
  writer.mockClear();
  bindStudyPlan.mockClear();
  fetchPracticePostings.mockReset();
  fetchPracticePostings.mockResolvedValue([OPTION]);
  try {
    localStorage.clear();
  } catch {
    /* the storage under test may be unreachable */
  }

  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/application-digest")) return response({ digest: { status: "ready" } });
    if (u.includes("/api/study-plan")) return response({ status: "ready", partial: false, reason: null });
    throw new Error("unexpected fetch: " + u);
  });

  ({ resetStudyPlanBuildStore: resetBuild } = await import("@/lib/studyPlan/studyPlanBuild.js"));
  ({ resetStudyPlanProgressStore: resetProgress } = await import("@/lib/studyPlan/studyPlanProgressStore.js"));
  resetBuild();
  resetProgress();

  ({ default: StudyPlanClient } = await import("./StudyPlanClient.js"));

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
  resetBuild();
  resetProgress();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignored */
  }
});

// ---- helpers ------------------------------------------------------------
async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function mount() {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(StudyPlanClient, null)));
  });
  await flush();
}
const text = () => document.body.textContent || "";
const pickerInput = () => document.body.querySelector(".MuiAutocomplete-root input");
const buttonByName = (name) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
async function click(btn) {
  expect(btn, "button not found").toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await flush();
}
async function selectPosting() {
  const input = pickerInput();
  await act(async () => {
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await flush();
  const option = document.body.querySelector('[role="option"]');
  expect(option, "no option rendered to select").toBeTruthy();
  await click(option);
}
const SELECTED_INTRO = "Build a study plan for Staff Engineer at Acme";

// -------------------------------------------------------------------------
describe("a persisted id that matches a loaded option is restored", () => {
  it("hands the picker that initialId and the posting comes up selected, with no click", async () => {
    localStorage.setItem(KEY, "app-7");
    await mount();

    expect(pickerProps.some((p) => p.initialId === "app-7")).toBe(true);
    expect(pickerInput().value).toBe(OPTION.label);
    expect(text()).toContain(SELECTED_INTRO);
    expect(buttonByName(STUDY_COPY.picker.createButton).disabled).toBe(false);
    // The restored application is the one the shell binds and loads.
    expect(bindStudyPlan).toHaveBeenCalledWith("app-7");
  });

  it("a persisted id that matches NO loaded option selects nothing (no bogus selection)", async () => {
    localStorage.setItem(KEY, "app-gone");
    await mount();

    expect(pickerInput().value).toBe("");
    expect(buttonByName(STUDY_COPY.picker.createButton).disabled).toBe(true);
    expect(bindStudyPlan).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });
});

describe("nothing persisted: the restore is inert (the state every landed suite runs in)", () => {
  it("never hands the picker an initialId, and nothing auto-selects", async () => {
    await mount();

    expect(pickerProps.length).toBeGreaterThan(0);
    expect(pickerProps.every((p) => p.initialId === undefined)).toBe(true);
    expect(pickerInput().value).toBe("");
    expect(buttonByName(STUDY_COPY.picker.createButton).disabled).toBe(true);
    expect(bindStudyPlan).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

  it("an empty stored string counts as nothing persisted", async () => {
    localStorage.setItem(KEY, "");
    await mount();

    expect(pickerProps.every((p) => p.initialId === undefined)).toBe(true);
    expect(pickerInput().value).toBe("");
  });

  it("merely SELECTING a posting does not persist it (only a build does)", async () => {
    await mount();
    await selectPosting();

    expect(text()).toContain(SELECTED_INTRO);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("writing: a build is what records the application", () => {
  it("starting a build stores the application id under the pinned key", async () => {
    await mount();
    await selectPosting();
    await click(buttonByName(STUDY_COPY.picker.createButton));

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe("app-7");
  });

  it("round trip: after a build, a fresh mount restores that application", async () => {
    await mount();
    await selectPosting();
    await click(buttonByName(STUDY_COPY.picker.createButton));

    await act(async () => root.unmount());
    resetBuild();
    pickerProps.length = 0;
    root = createRoot(container);
    await mount();

    expect(pickerProps.some((p) => p.initialId === "app-7")).toBe(true);
    expect(pickerInput().value).toBe(OPTION.label);
  });
});

describe("unreachable storage must not crash the surface", () => {
  it("a throwing getItem renders normally, with no initialId and nothing selected", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    await mount();

    expect(pickerProps.length).toBeGreaterThan(0);
    expect(pickerProps.every((p) => p.initialId === undefined)).toBe(true);
    expect(pickerInput().value).toBe("");
    expect(buttonByName(STUDY_COPY.picker.createButton)).toBeTruthy();
  });

  it("a throwing setItem does not stop the build from running", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await mount();
    await selectPosting();
    await click(buttonByName(STUDY_COPY.picker.createButton));

    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/application-digest"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/study-plan"))).toBe(true);
  });
});

describe("the persisted-id helper (lib/studyPlan/lastStudyApplication.js)", () => {
  it("reads back what it wrote, ignores an empty or non-string id, and never throws", async () => {
    const { readLastStudyApplicationId, writeLastStudyApplicationId } = await import("@/lib/studyPlan/lastStudyApplication.js");

    expect(readLastStudyApplicationId()).toBeUndefined();
    writeLastStudyApplicationId("app-9");
    expect(readLastStudyApplicationId()).toBe("app-9");
    expect(localStorage.getItem(KEY)).toBe("app-9");

    writeLastStudyApplicationId("");
    writeLastStudyApplicationId(undefined);
    writeLastStudyApplicationId(42);
    expect(readLastStudyApplicationId()).toBe("app-9");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLastStudyApplicationId()).toBeUndefined();
    expect(() => writeLastStudyApplicationId("app-10")).not.toThrow();
  });
});
