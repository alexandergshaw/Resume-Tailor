// @vitest-environment jsdom
//
// N132 T-R1 (pins R-1, the same-tick stale read) + AC-6 scope + AC-10
// regression -- all against the REAL useDocumentPreview hook, through its REAL
// public opener `openResumePreview(job, opts)`.
//
// THE MECHANISM UNDER TEST (plan Step 2). openResumePreview reads the map
// SYNCHRONOUSLY to pick the initial tab and to warm research
// (useDocumentPreview.js:292,309). When the open handler writes an entry and
// opens in the SAME tick, `tailoringMap[job.id]` is still the pre-commit
// value, so a freshly-built cover-only entry is invisible and the modal opens
// on the WRONG tab with research cold. The fix is one additive fallback:
//     const t = tailoringMap[job.id] || opts.entry || {};   // :292
// This file drives that seam directly: it passes `opts.entry` and asserts the
// tab/research decision honours it, SAME-TICK (one act, no second render).
//
// RED REASON (on HEAD): line 292 is `tailoringMap[job.id] || {}` -- `opts.entry`
// is ignored, so T-R1 opens on 'resume' and never warms research. After Step 2
// it opens on 'cover' and warms. The T-R1 MUTANT is exactly reverting that
// one-liner; the reference-tree run confirms it flips this file red.
//
// This file imports NO N132 module, so its RED is purely the hook's behaviour
// being absent -- not a missing import. currentUser is null so resolvePositionId
// short-circuits (documentVersionLoad.js:14) and no Supabase client is built.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useDocumentPreview } from "./useDocumentPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
let container = null;
let root = null;
let research = null;

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((current) => ({
        ...current,
        [jobId]:
          typeof updater === "function" ? updater(current[jobId] || {}) : { ...(current[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: async () => null,
    startBackgroundResearch: research,
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: null,
  });
  return null;
}

async function mount(initialMap) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
  });
}

// Open and flush the fire-and-forget version load so no setState escapes act.
async function open(job, opts) {
  await act(async () => {
    api.openResumePreview(job, opts);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  api = null;
  research = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ fixtures

const coverOnlyEntry = () => ({
  status: "done",
  result: "",
  resultLines: [],
  coverLetterResultLines: ["Dear Hiring Manager,", "I would love to join."],
  coverLetterDocxPath: "",
});
const resumeEntry = () => ({
  status: "done",
  result: "Alex Shaw\nStaff Engineer",
  resultLines: ["Alex Shaw", "Staff Engineer"],
  coverLetterResultLines: [],
});
const JOB = { id: "app:uuid-1", title: "Staff Engineer", company: "Acme" };

// ===========================================================================
// T-R1 -- the same-tick cover tab from opts.entry (pins R-1).
// ===========================================================================

describe("T-R1 opts.entry drives the initial tab and research warm-up same-tick", () => {
  it("absent map entry + opts.entry cover-only => opens on the 'cover' tab", async () => {
    await mount({}); // tailoringMap has NO entry for JOB.id
    await open(JOB, { tab: "cover", entry: coverOnlyEntry() });
    // On HEAD this is 'resume' (opts.entry ignored, t === {}). The one-line
    // fix flips it to 'cover'. Reverting the fix is the T-R1 mutant.
    expect(api.resumePreview.open).toBe(true);
    expect(api.resumePreview.tab).toBe("cover");
  });

  it("absent map entry + opts.entry cover-only => research warms same-tick", async () => {
    await mount({});
    await open(JOB, { tab: "cover", entry: coverOnlyEntry() });
    // Warm only fires when previewScopeAvailable(t,'cover'); on HEAD t === {}
    // so it never warms. Independent companion signal to the tab assertion.
    expect(research).toHaveBeenCalledTimes(1);
    expect(research).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB.id }));
  });

  it("[positive control] the SAME entry in the MAP (not opts.entry) already opens 'cover'", async () => {
    // Isolates the opts.entry path: the harness and hook can produce 'cover'
    // from the map today, so T-R1's failure is specifically the opts.entry
    // fallback, not a broken fixture or an unreachable 'cover' branch.
    await mount({ [JOB.id]: coverOnlyEntry() });
    await open(JOB, { tab: "cover" });
    expect(api.resumePreview.tab).toBe("cover");
  });
});

// ===========================================================================
// AC-6 -- scope: resume-if-present-else-cover.
// ===========================================================================

describe("AC-6 initial scope", () => {
  it("a resume-bearing entry opens on the 'resume' tab (tab !== 'cover')", async () => {
    await mount({});
    await open(JOB, { tab: "resume", entry: resumeEntry() });
    expect(api.resumePreview.tab).toBe("resume");
  });

  it("an entry with both scopes still honours tab:'resume' (not forced to cover)", async () => {
    await mount({});
    await open(JOB, { tab: "resume", entry: { ...resumeEntry(), coverLetterResultLines: ["x"] } });
    expect(api.resumePreview.tab).toBe("resume");
  });
});

// ===========================================================================
// AC-10 -- existing openers unaffected + the precedence is map-over-entry.
// These PASS on HEAD (the change is additive) and must STAY green; their
// teeth are the named mutants the reference tree exercises.
// ===========================================================================

describe("AC-10 regression: callers that pass no opts.entry are unchanged", () => {
  it("no opts.entry, resume entry in the map => resume tab, research cold", async () => {
    await mount({ [JOB.id]: resumeEntry() });
    await open(JOB, {});
    expect(api.resumePreview.tab).toBe("resume");
    expect(research).not.toHaveBeenCalled();
  });

  it("no opts.entry, cover entry in the map, opts.tab:'cover' => cover tab + research warms (map-driven as before)", async () => {
    await mount({ [JOB.id]: coverOnlyEntry() });
    await open(JOB, { tab: "cover" });
    expect(api.resumePreview.tab).toBe("cover");
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("[precedence mutant guard] a LIVE map entry wins over a stale opts.entry", async () => {
    // Correct fix is `tailoringMap[job.id] || opts.entry`: the live map wins.
    // A map entry with cover + opts.tab:'cover' opens 'cover'. Pass a
    // cover-LESS opts.entry: with correct precedence the map still decides
    // (cover). The mutant `opts.entry || tailoringMap[job.id]` would let the
    // coverless entry shadow the live map and open 'resume'. Green on HEAD
    // (opts.entry ignored) AND after the correct fix; red under that mutant.
    await mount({ [JOB.id]: coverOnlyEntry() });
    await open(JOB, { tab: "cover", entry: { status: "done", result: "x", resultLines: ["x"], coverLetterResultLines: [] } });
    expect(api.resumePreview.tab).toBe("cover");
  });
});
