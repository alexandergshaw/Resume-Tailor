// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- FREEZE the Sec 5.5 StudyWalkthrough props contract
// as code (C-c builds to it; DES-N157-C25) and the Sec 3.6 banner / reachable-
// remedy matrix (DES-N157-C11). Binds to design r2 Sec 5.5, Sec 3.6, Sec 7 copy.
//
// Each prop is pinned by an OBSERVABLE consequence, not a source-text signature
// read: applicationId (required/no default), onBuild (optional switch for the
// "Layer 1 not landed" mode), buildBusy, now (the revealedAt clock), engine /
// researchReason (banner variant + which remedy is reachable), and a `...rest`
// leak guard. A prose signature test would pass against a component that forwards
// the wrong things.
//
// RED REASON (greenfield): ./StudyWalkthrough.js absent -> collection fails.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { itemKey, normalizePlan, normalizeProgress } from "@/lib/studyPlan/studyPlanSchema.js";

import StudyWalkthrough from "./StudyWalkthrough.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const Q1 = { topicHint: "t1", kind: "new", text: "ALPHA prompt text", reveal: "ALPHA answer text", citations: [{ url: "https://p.example/a" }] };
const ID1 = itemKey(Q1);

// A ready, complete plan (no banner). A partial plan drives the provenance banner.
function plan({ complete = true, engine = "gemini" } = {}) {
  return normalizePlan({
    engine,
    provenance: complete ? { research: "complete", unsourcedTopicIds: [] } : { unsourcedTopicIds: [] },
    modules: [{ id: "m1", title: "Module", topics: [{ id: "t1", title: "Topic", items: [Q1] }] }],
  });
}

let container;
let root;

async function mount(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(StudyWalkthrough, {
          applicationId: "app-contract",
          plan: plan(),
          progress: normalizeProgress({}),
          writer: () => Promise.resolve({ written: true, error: null }),
          saveError: null,
          researchedAt: null,
          researchReason: null,
          engine: "gemini",
          buildBusy: false,
          ...props,
        }),
      ),
    );
  });
}

function buttonByName(name) {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === name || b.getAttribute("aria-label") === name,
  );
}
async function click(btn) {
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
}
const text = () => document.body.textContent || "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("applicationId is REQUIRED non-empty (Sec 5.5, S9): empty renders nothing, writer untouched", () => {
  it("applicationId='' renders no card and no primary control", async () => {
    const writer = vi.fn(() => Promise.resolve({ written: true, error: null }));
    await mount({ applicationId: "", writer });
    expect(buttonByName(STUDY_COPY.card.showAnswer)).toBeFalsy();
    expect(buttonByName(STUDY_COPY.card.next)).toBeFalsy();
    expect(writer).not.toHaveBeenCalled();
  });
});

describe("now is the injected revealedAt clock (Sec 5.5 / 3.4)", () => {
  it("a grade records revealedAt from now(), not a baked-in Date", async () => {
    const writer = vi.fn(() => Promise.resolve({ written: true, error: null }));
    const FIXED = "2099-12-31T23:59:59.000Z";
    await mount({ writer, now: () => FIXED });

    await click(buttonByName(STUDY_COPY.card.showAnswer));
    await click(buttonByName(STUDY_COPY.card.gotIt));

    expect(writer).toHaveBeenCalledTimes(1);
    const { seenDelta } = writer.mock.calls[0][0];
    expect(seenDelta[ID1].revealedAt).toBe(FIXED);
  });
});

describe("No `...rest` spread onto the DOM (declared prop surface, N18 lesson)", () => {
  it("an unknown prop does not appear as a DOM attribute", async () => {
    await mount({ "data-leak-marker": "LEAKX" });
    expect(document.body.querySelector("[data-leak-marker]")).toBeNull();
  });
});

describe("onBuild is the single switch for remedy controls (Sec 4.3 / 5.5 / DES-N157-C25)", () => {
  it("ABSENT onBuild: the no-research banner shows its text but NO remedy button", async () => {
    await mount({ plan: plan({ complete: false }), researchReason: "no-research", onBuild: undefined });
    expect(text()).toContain(STUDY_COPY.banner.general);
    // The single switch for the "Layer 1 has not landed" mode: no remedy renders.
    expect(buttonByName(STUDY_COPY.remedy.researchAndRebuild)).toBeFalsy();
    expect(buttonByName(STUDY_COPY.remedy.refreshResearch)).toBeFalsy();
    expect(buttonByName(STUDY_COPY.remedy.rebuildPlan)).toBeFalsy();
  });

  it("PRESENT onBuild: the no-research banner offers 'Research and rebuild' -> onBuild('research-rebuild')", async () => {
    const onBuild = vi.fn();
    await mount({ plan: plan({ complete: false }), researchReason: "no-research", onBuild });
    const remedy = buttonByName(STUDY_COPY.remedy.researchAndRebuild);
    expect(remedy, "remedy missing when onBuild present").toBeTruthy();
    await click(remedy);
    expect(onBuild).toHaveBeenCalledWith("research-rebuild");
  });
});

describe("Banner variant + REACHABLE remedy per Sec 3.6 (each remedy actually works for its cause, R7)", () => {
  it("no-research: 'Research and rebuild' is offered and 'Refresh research' is NOT", async () => {
    await mount({ plan: plan({ complete: false }), researchReason: "no-research", onBuild: vi.fn() });
    expect(text()).toContain(STUDY_COPY.banner.general);
    expect(buttonByName(STUDY_COPY.remedy.researchAndRebuild)).toBeTruthy();
    // 'ensure' re-researches a missing/failed digest; 'refresh' would be the
    // wrong (billing) remedy here -> it must NOT appear.
    expect(buttonByName(STUDY_COPY.remedy.refreshResearch)).toBeFalsy();
  });

  it("unsourced: 'Refresh research' is offered and 'Research and rebuild' is NOT", async () => {
    const onBuild = vi.fn();
    await mount({ plan: plan({ complete: false }), researchReason: "unsourced", onBuild });
    expect(text()).toContain(STUDY_COPY.banner.unsourced);
    const refresh = buttonByName(STUDY_COPY.remedy.refreshResearch);
    expect(refresh, "refresh remedy missing").toBeTruthy();
    // 'ensure' would no-op on an already-ready digest and loop to the same plan,
    // so only force-refresh is reachable here.
    expect(buttonByName(STUDY_COPY.remedy.researchAndRebuild)).toBeFalsy();
    await click(refresh);
    expect(onBuild).toHaveBeenCalledWith("refresh-rebuild");
  });

  it("embedded: the engine banner offers NO remedy button, only the switch-engine text", async () => {
    await mount({ plan: plan({ complete: false, engine: "embedded" }), engine: "embedded", researchReason: "no-research", onBuild: vi.fn() });
    expect(text()).toContain(STUDY_COPY.banner.embedded);
    // The engine is a global setting, so there is no in-banner remedy: a text
    // instruction instead, and neither research remedy button.
    expect(text()).toContain(STUDY_COPY.remedy.switchEngine);
    expect(buttonByName(STUDY_COPY.remedy.researchAndRebuild)).toBeFalsy();
    expect(buttonByName(STUDY_COPY.remedy.refreshResearch)).toBeFalsy();
  });

  it("[control] a ready, complete plan shows NO banner (the banner is not always-on)", async () => {
    await mount({ plan: plan({ complete: true }), researchReason: null });
    expect(text()).not.toContain(STUDY_COPY.banner.general);
    expect(text()).not.toContain(STUDY_COPY.banner.unsourced);
    expect(text()).not.toContain(STUDY_COPY.banner.embedded);
  });
});

describe("buildBusy disables remedy controls while a build runs (Sec 5.5)", () => {
  it("a remedy button is disabled when buildBusy is true", async () => {
    const onBuild = vi.fn();
    await mount({ plan: plan({ complete: false }), researchReason: "no-research", onBuild, buildBusy: true });
    const remedy = buttonByName(STUDY_COPY.remedy.researchAndRebuild);
    expect(remedy, "remedy missing").toBeTruthy();
    expect(remedy.disabled).toBe(true);
    // And a click while busy does not fire another build.
    await click(remedy);
    expect(onBuild).not.toHaveBeenCalled();
  });
});
