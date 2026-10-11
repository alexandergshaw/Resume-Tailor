// @vitest-environment jsdom
//
// N157 SC-C: the provenance banner's inputs, and the rebuild wiring, through the
// REAL StudyPlanClient shell. StudyPlanClient.test.js drives create/failure; this
// file decides the part it does not: that what the banner and the overview show
// is threaded from the stored plan row.
//
// WHY THIS IS A SEPARATE FILE AND WHAT IT PINS. The progress store's settled
// record drops the plan row's `researchedAt` (it keeps plan, knobs, progress and
// cachedResearch only), so a shell that fed the banner from the store alone could
// never render "Based on research from ..." -- and nothing else would fail,
// because the banner simply returns null without it. The first two tests pin the
// threading with a control: the same plan shows the line when the row carries a
// date and does not when it does not. The rest pin that each banner remedy and the
// plain rebuild reach the right route call (research vs refresh vs neither, and
// the STORED knobs on the body), through real clicks.
//
// The Supabase binding, the engine store, the posting loader and fetch are the
// only stubs; the build orchestration, the progress store and the components run.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { normalizeKnobs, normalizePlan } from "@/lib/studyPlan/studyPlanSchema.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let engineValue = "gemini";
vi.mock("@/app/settings/engine", () => ({
  useEngine: () => ({ engine: engineValue, setEngine: () => {} }),
  readEngine: () => engineValue,
}));

const fetchPracticePostings = vi.fn();
vi.mock("@/lib/copilot/postings", () => ({ fetchPracticePostings: (...a) => fetchPracticePostings(...a) }));

let readerResult;
const reader = vi.fn(async () => readerResult);
const writer = vi.fn(async () => ({ written: true, error: null }));
vi.mock("@/lib/studyPlan/studyPlanBrowser.js", () => ({ bindStudyPlan: () => ({ reader, writer }) }));

const OPTION = { id: "app-7", title: "Staff Engineer", company: "Acme", label: "Staff Engineer — Acme" };
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const STORED_KNOBS = { newReviewRatio: 0.25, weakTopicIds: ["t1"], pace: { daysUntil: 3 }, topicScope: { excludedAreas: ["sql"] } };

const ITEM = { topicHint: "t1", kind: "new", text: "ALPHA prompt", reveal: "ALPHA answer", citations: [] };
const modules = [{ id: "m1", title: "Module One", topics: [{ id: "t1", title: "Topic One", items: [ITEM] }] }];
const COMPLETE_PLAN = normalizePlan({ engine: "gemini", provenance: { research: "complete" }, modules });
const PARTIAL_PLAN = normalizePlan({ engine: "gemini", provenance: { research: "partial" }, modules });

function record(overrides) {
  return {
    status: "ready",
    plan: COMPLETE_PLAN,
    knobs: STORED_KNOBS,
    progress: null,
    cachedResearch: null,
    researchedAt: null,
    engine: "gemini",
    error: null,
    ...overrides,
  };
}

let fetchMock;
let originalFetch;
let resetBuild;
let resetProgress;
let StudyPlanClient;
let container;
let root;

function reply(json) {
  return { ok: true, status: 200, json: async () => json };
}
const callsTo = (fragment) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(fragment));

beforeEach(async () => {
  engineValue = "gemini";
  readerResult = record();
  reader.mockClear();
  fetchPracticePostings.mockReset();
  fetchPracticePostings.mockResolvedValue([OPTION]);

  originalFetch = globalThis.fetch;
  fetchMock = vi.fn(async (url) => {
    if (String(url).includes("/api/application-digest")) return reply({ digest: { status: "ready" } });
    return reply({ status: "ready", partial: false, reason: null });
  });
  globalThis.fetch = fetchMock;

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
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
const text = () => document.body.textContent || "";
const buttonByName = (name) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
async function click(btn) {
  expect(btn, "button not found").toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await flush();
  await flush();
  await flush();
}
async function mountAndSelect() {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(StudyPlanClient, null)));
  });
  await flush();
  const input = document.body.querySelector(".MuiAutocomplete-root input");
  await act(async () => {
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await flush();
  await click(document.body.querySelector('[role="option"]'));
}

describe("researchedAt reaches the banner from the plan row (the store's settled record drops it)", () => {
  it("a complete plan whose row carries researchedAt shows 'Based on research from <relative>.'", async () => {
    readerResult = record({ researchedAt: THREE_DAYS_AGO });
    await mountAndSelect();
    expect(text()).toContain("ALPHA prompt");
    expect(text()).toContain(STUDY_COPY.sources.researchLine.replace("<relative>", "3d ago"));
  });

  it("CONTROL: the same plan with no researchedAt shows no research line", async () => {
    readerResult = record({ researchedAt: null });
    await mountAndSelect();
    expect(text()).toContain("ALPHA prompt");
    expect(text()).not.toContain("Based on research from");
  });
});

describe("each banner remedy reaches the right route calls, with the STORED knobs", () => {
  it("'Research and rebuild' (partial, no-research) calls the digest route WITHOUT force, then the plan route", async () => {
    readerResult = record({ plan: PARTIAL_PLAN, status: "partial", cachedResearch: { reason: "no-research" } });
    await mountAndSelect();
    expect(text()).toContain(STUDY_COPY.banner.general);

    await click(buttonByName(STUDY_COPY.remedy.researchAndRebuild));

    const digest = callsTo("/api/application-digest");
    expect(digest).toHaveLength(1);
    expect(JSON.parse(digest[0][1].body).force).toBe(false);
    const plan = callsTo("/api/study-plan");
    expect(plan).toHaveLength(1);
    expect(JSON.parse(plan[0][1].body).knobs).toEqual(normalizeKnobs(STORED_KNOBS));
  });

  it("'Refresh research' (partial, unsourced) calls the digest route WITH force, then the plan route", async () => {
    readerResult = record({ plan: PARTIAL_PLAN, status: "partial", cachedResearch: { reason: "unsourced" } });
    await mountAndSelect();
    expect(text()).toContain(STUDY_COPY.banner.unsourced);

    await click(buttonByName(STUDY_COPY.remedy.refreshResearch));

    const digest = callsTo("/api/application-digest");
    expect(digest).toHaveLength(1);
    expect(JSON.parse(digest[0][1].body).force).toBe(true);
    expect(callsTo("/api/study-plan")).toHaveLength(1);
  });

  it("'Rebuild plan' skips research entirely and still sends the stored knobs", async () => {
    await mountAndSelect();
    await click(buttonByName(STUDY_COPY.card.outline));
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));

    expect(callsTo("/api/application-digest")).toHaveLength(0);
    const plan = callsTo("/api/study-plan");
    expect(plan).toHaveLength(1);
    expect(JSON.parse(plan[0][1].body)).toEqual({ applicationId: "app-7", engine: "gemini", knobs: normalizeKnobs(STORED_KNOBS) });
  });

  it("a successful rebuild reloads the record exactly once more (the new plan is read back)", async () => {
    await mountAndSelect();
    const readsBefore = reader.mock.calls.length;
    await click(buttonByName(STUDY_COPY.card.outline));
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(reader.mock.calls.length).toBe(readsBefore + 1);
  });
});
