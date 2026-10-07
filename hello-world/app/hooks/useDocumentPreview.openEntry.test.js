// @vitest-environment jsdom
//
// N132 T-R1 (pins R-1, the same-tick stale read) + AC-6 scope + AC-10
// regression -- all against the REAL useDocumentPreview hook, through its REAL
// public opener `openResumePreview(job, opts)`.
//
// THE MECHANISM UNDER TEST (plan Step 2). openResumePreview reads the map
// SYNCHRONOUSLY to pick the initial tab and to warm research
// (openResumePreview in useDocumentPreview.js). When the open handler writes an entry and
// opens in the SAME tick, `tailoringMap[job.id]` is still the pre-commit
// value, so a freshly-built cover-only entry is invisible and the modal opens
// on the WRONG tab with research cold. The fix is one additive fallback:
//     const t = tailoringMap[job.id] || opts.entry || {};
// (N133 later refined this selection: see the N133 block below.)
// This file drives that seam directly: it passes `opts.entry` and asserts the
// tab/research decision honours it, SAME-TICK (one act, no second render).
//
// RED REASON (on the pre-N132 tree): the read was `tailoringMap[job.id] || {}`
// -- `opts.entry` was ignored, so T-R1 opened on 'resume' and never warmed
// research. Since N132 it opens on 'cover' and warms. The T-R1 MUTANT is
// exactly reverting that fallback; the reference-tree run confirms it flips
// this file red.
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
// N133: the committed map and its setter, so a test can do what page.js's
// openApplicationPreview does -- write the map and open in ONE act, with
// `api.openResumePreview` still the PRE-write render's closure.
let latestMap = null;
let setMapRef = null;

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  latestMap = tailoringMap;
  setMapRef = setTailoringMap;
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
  latestMap = null;
  setMapRef = null;
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

// ===========================================================================
// N133 -- a truthy-but-CONTENTLESS map slot must not defeat opts.entry.
//
// THE DEFECT (docs/loop/N133.ac.r1.md, AC-N133-1..4). Before N133 the read was
// `tailoringMap[job.id] || opts.entry || {}`. `||` falls through only on a
// FALSY slot, so a slot like a prior failed run -- `{ status: "error", error }`,
// written by handleTailorJob / the manual-tailor catch via updateTailoringJob --
// is truthy, wins, and the whole open (tab, research warm-up, header) is
// computed from an object with no resume and no cover. page.js's
// openApplicationPreview overwrites that slot in the same tick (the write has
// not committed, so the closure still sees the stale slot) and passes the
// freshly-built entry as opts.entry; the hook ignores it.
//
// RULE UNDER TEST (AC-N133-1): a truthy slot that is previewable in NEITHER
// scope is treated exactly as an ABSENT slot when opts.entry is supplied. The
// open reads ONE object -- the entry -- for tab, warm-up and header.
//
// Each stale shape below is checked for the precondition (truthy, resume and
// cover both unavailable) so a fixture that quietly became contentful cannot
// turn a red into a pass. Title/posting on the entry DIFFER from the job's own
// so "which object did the open read?" is observable; in production page.js
// sets job.title from the same entry, so those two assertions pin the
// equivalence-with-absent-slot rule, while the tab and warm-up are the
// user-visible symptoms.
// ===========================================================================

const richCoverEntry = () => ({
  ...coverOnlyEntry(),
  generatedJobTitle: "Staff Engineer (Tailored)",
  jobDescription: "Posting text carried by the entry.",
});
const richBothEntry = () => ({
  ...resumeEntry(),
  coverLetterResultLines: ["Dear Hiring Manager,", "I would love to join."],
  generatedJobTitle: "Staff Engineer (Tailored)",
  jobDescription: "Posting text carried by the entry.",
});
const ENTRY_WARMUP = {
  jobId: JOB.id,
  company: "Acme",
  jobTitle: "Staff Engineer (Tailored)",
  posting: "Posting text carried by the entry.",
};

const STALE_SLOT_SHAPES = [
  ["{} (truthy, no keys)", () => ({})],
  ["{ status: 'error' } (a failed run, no message)", () => ({ status: "error" })],
  ["{ status: 'error', error } (a failed run with its message)", () => ({ status: "error", error: "Upload a resume first." })],
  ["status 'done' with every scope empty", () => ({ status: "done", result: "", resultLines: [], coverLetterResultLines: [] })],
];

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe.each(STALE_SLOT_SHAPES)("N133 stale contentless slot %s + opts.entry", (_label, makeSlot) => {
  it("[precondition] the slot is truthy yet previewable in NEITHER scope", async () => {
    await mount({ [JOB.id]: makeSlot() });
    expect(makeSlot()).toBeTruthy();
    expect(api.previewScopeAvailable(makeSlot(), "resume")).toBe(false);
    expect(api.previewScopeAvailable(makeSlot(), "cover")).toBe(false);
  });

  it("cover-only entry + tab:'cover' => opens on the 'cover' tab", async () => {
    await mount({ [JOB.id]: makeSlot() });
    await open(JOB, { tab: "cover", entry: richCoverEntry() });
    expect(api.resumePreview.open).toBe(true);
    expect(api.resumePreview.tab).toBe("cover");
  });

  it("cover-only entry => warms company research once, from the entry's title and posting", async () => {
    await mount({ [JOB.id]: makeSlot() });
    await open(JOB, { tab: "cover", entry: richCoverEntry() });
    expect(research).toHaveBeenCalledTimes(1);
    expect(research).toHaveBeenCalledWith(ENTRY_WARMUP);
  });

  it("cover-only entry => the preview header (title, posting) is read from the entry, not the stale slot", async () => {
    await mount({ [JOB.id]: makeSlot() });
    await open(JOB, { tab: "cover", entry: richCoverEntry() });
    expect(api.resumePreview.title).toBe("Staff Engineer (Tailored)");
    expect(api.resumePreview.posting).toBe("Posting text carried by the entry.");
  });

  it("[guard] resume+cover entry + tab:'resume' => stays on 'resume' (the handler's choice is not overridden)", async () => {
    await mount({ [JOB.id]: makeSlot() });
    await open(JOB, { tab: "resume", entry: richBothEntry() });
    expect(api.resumePreview.tab).toBe("resume");
  });

  it("resume+cover entry + tab:'resume' => STILL warms research once (a cover letter exists)", async () => {
    await mount({ [JOB.id]: makeSlot() });
    await open(JOB, { tab: "resume", entry: richBothEntry() });
    expect(research).toHaveBeenCalledTimes(1);
    expect(research).toHaveBeenCalledWith(ENTRY_WARMUP);
  });
});

describe("N133 controls and guards (green on HEAD; must stay green after the fix)", () => {
  it("[positive control] the SAME cover-only entry with the slot ABSENT => cover tab, one warm-up, entry header", async () => {
    // Isolates the stale slot as the only variable: every outcome the red
    // cases demand is already produced today when the slot is falsy.
    await mount({});
    await open(JOB, { tab: "cover", entry: richCoverEntry() });
    expect(api.resumePreview.tab).toBe("cover");
    expect(research).toHaveBeenCalledTimes(1);
    expect(research).toHaveBeenCalledWith(ENTRY_WARMUP);
    expect(api.resumePreview.title).toBe("Staff Engineer (Tailored)");
    expect(api.resumePreview.posting).toBe("Posting text carried by the entry.");
  });

  it("[guard] contentless slot and NO opts.entry (every other caller) => unchanged: 'resume' tab, research cold, even with tab:'cover'", async () => {
    await mount({ [JOB.id]: { status: "error", error: "Upload a resume first." } });
    await open(JOB, { tab: "cover" });
    expect(api.resumePreview.tab).toBe("resume");
    expect(research).not.toHaveBeenCalled();
  });

  it("[guard] contentless slot AND contentless opts.entry => no content is invented: 'resume' tab, research cold", async () => {
    await mount({ [JOB.id]: { status: "error" } });
    await open(JOB, { tab: "cover", entry: { status: "done", result: "", resultLines: [], coverLetterResultLines: [] } });
    expect(api.resumePreview.tab).toBe("resume");
    expect(research).not.toHaveBeenCalled();
  });

  it("[guard] a LIVE slot that has a cover letter beats a different opts.entry that also has one (live-wins)", async () => {
    // The over-correction mutant `opts.entry || slot` (or "entry first when it
    // has the scope") shadows the live map. Here BOTH have a cover letter, so
    // only the title/posting/warm-up args can tell which object was read.
    const live = { ...coverOnlyEntry(), generatedJobTitle: "Live Title", jobDescription: "Live posting." };
    await mount({ [JOB.id]: live });
    await open(JOB, { tab: "cover", entry: richCoverEntry() });
    expect(api.resumePreview.tab).toBe("cover");
    expect(api.resumePreview.title).toBe("Live Title");
    expect(api.resumePreview.posting).toBe("Live posting.");
    expect(research).toHaveBeenCalledTimes(1);
    expect(research).toHaveBeenCalledWith({ jobId: JOB.id, company: "Acme", jobTitle: "Live Title", posting: "Live posting." });
  });
});

describe("N133 handler-shaped open: the stale slot is overwritten in the SAME act as the open", () => {
  // page.js openApplicationPreview does exactly this: setTailoringMap(write the
  // freshly-built entry) then preview.openResumePreview(job, { tab, entry }) in
  // one tick. `api.openResumePreview` is the closure from the render BEFORE the
  // write, so it still sees the old error slot.
  async function overwriteAndOpen(entry) {
    await mount({ [JOB.id]: { status: "error", error: "Upload a resume first." } });
    await act(async () => {
      setMapRef((cur) => ({ ...cur, [JOB.id]: entry }));
      api.openResumePreview(JOB, { tab: "cover", entry });
    });
    await flushMicrotasks();
  }

  it("the write itself committed (so only the closure read was stale)", async () => {
    const entry = richCoverEntry();
    await overwriteAndOpen(entry);
    expect(latestMap[JOB.id].coverLetterResultLines).toEqual(entry.coverLetterResultLines);
    expect(latestMap[JOB.id].status).toBe("done");
  });

  it("opens on the 'cover' tab", async () => {
    await overwriteAndOpen(richCoverEntry());
    expect(api.resumePreview.tab).toBe("cover");
  });

  it("warms company research once", async () => {
    await overwriteAndOpen(richCoverEntry());
    expect(research).toHaveBeenCalledTimes(1);
    expect(research).toHaveBeenCalledWith(ENTRY_WARMUP);
  });
});
