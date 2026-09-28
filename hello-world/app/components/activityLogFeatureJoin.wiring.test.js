// @vitest-environment jsdom
//
// THE PRODUCTION JOIN, driven end to end. (Backlog N61.)
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// The app-wide activity log AGGREGATES the per-feature logs: a feature calls
// `attachActivitySection(id, { render })` from wherever it holds its own
// ledger, and `ActivityLogButton` snapshots the same log and writes the folded
// document. The two halves reach each other through NOTHING but the module
// singleton `defaultLog` in lib/activityLog/appActivityLog.js -- there is no
// prop, no context, no parent/child relationship (that absence is the seam's
// deliberate design: appActivityLog.js's header, "a feature reaches the log
// with an import instead of a prop chain through app/page.js").
//
// Every existing test exercises ONE side of that seam against a THROWAWAY log:
//   * lib/activityLog/appActivityLog.test.js and activityLogDocument.test.js
//     attach a hand-written `render` to a fresh `createActivityLog()` instance
//     -- never the singleton, never a real feature's own attach call.
//   * app/components/ActivityLogButton.test.js clicks the real button, but the
//     only thing it puts in the log is a hand-written `recordActivity(...)`; it
//     never mounts a feature that ATTACHES a section, so the
//     attachActivitySection -> singleton -> snapshot -> download path, driven by
//     real feature code, is never executed.
//
// So the one thing the owner actually asked for -- "a log they can use across
// the whole app" -- is the one thing no test drives: a real feature folding its
// real records into the file a real click downloads. This is the repo's most
// expensive trap (a complete mechanism whose last hop is untested, green until
// someone mounts the real consumer -- see loop-traps-tests, "test the JOIN with
// the REAL consumer" and "a harness that wires the component differently from
// production hides the wiring bug"). This file closes it by mounting the REAL
// hook and the REAL button as the independent siblings production makes them,
// letting them find each other only through the singleton, and reading the
// downloaded bytes.
//
// STATE OF THE FEATURE ON HEAD: these tests PASS on HEAD. The join is wired
// correctly today (useDuplicateApplyCheck.js:92-104 attaches; page.js:1382
// mounts the hook unconditionally; ActivityLogButton reads the same singleton).
// This is therefore a REGRESSION GUARD, not a red implementer hand-off -- see
// the file's report. Its power is proven by mutation (remove the hook's attach
// effect and both join tests go red) rather than by landing red.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, Fragment, act } from "react";
import { createRoot } from "react-dom/client";

// The DOM download helper is the only thing that cannot run in jsdom; capturing
// it is how we read the bytes the button produced. Everything else -- the hook,
// the button, the singleton, the renderers -- is the real production module.
vi.mock("@/lib/document/download.js", () => ({ triggerBlobDownload: vi.fn() }));

import { triggerBlobDownload } from "@/lib/document/download.js";
import ActivityLogButton from "./ActivityLogButton.js";
import { useDuplicateApplyCheck } from "@/app/hooks/useDuplicateApplyCheck.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
// The real hook's return value, captured from inside the mounted component so a
// test can drive runDuplicateCheck the way page.js's callers do.
let hookApi;

// A minimal host that does exactly what app/page.js does with this hook and no
// more: call it at the top level so its attach effect runs on mount, and expose
// its api. It renders nothing -- the feature's UI is not what is under test, the
// fold-in of its LOG is.
function DupeHost(props) {
  hookApi = useDuplicateApplyCheck(props);
  return null;
}

const HOST_PROPS = {
  applicationData: [],
  applicationError: null,
  applicationLoadedOnce: true,
  appliedByExternalId: new Map(),
  trackedJobs: [],
  setMainTab: () => {},
  setInterviewSearch: () => {},
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  triggerBlobDownload.mockReset();
  hookApi = null;
});

afterEach(async () => {
  // Unmounting runs the hook's cleanup, which detaches its section from the
  // singleton -- so one test's feature never bleeds into the next's document.
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// Mount the real hook and the real button as INDEPENDENT SIBLINGS under one
// root. They share no prop and no ancestor state; the only thing that can carry
// the feature's log to the button is the module singleton. That is precisely
// production's wiring (page.js mounts the hook; SettingsMenu mounts the button;
// neither passes the log to the other), and mounting a contrived parent that
// threaded a prop between them would test a wiring that does not exist.
async function mountJoin() {
  await act(async () => {
    root.render(createElement(Fragment, null, createElement(DupeHost, HOST_PROPS), createElement(ActivityLogButton)));
  });
}

function theButton() {
  return [...container.querySelectorAll("button")].find((b) => /activity log/i.test(b.textContent || ""));
}

async function clickAndReadDownload() {
  const callsBefore = triggerBlobDownload.mock.calls.length;
  await act(async () => {
    theButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const calls = triggerBlobDownload.mock.calls;
  expect(calls.length, "the real button click did not reach the download helper").toBe(callsBefore + 1);
  return calls[calls.length - 1][0].text();
}

async function recordOneCheck(jobId) {
  // runDuplicateCheck records exactly one "check" ledger entry per call, on
  // every branch: the success path and the throwing path both go through
  // applyMerge -> recordDupeLogEntry. So one call is one entry, regardless of
  // what the verdict turns out to be -- which is what makes the count below a
  // faithful, non-vacuous measure of "the feature recorded something".
  await act(async () => {
    hookApi.runDuplicateCheck({ id: jobId, title: "Staff Engineer", company: "Acme" }, { jobId, entryPoint: "E1" });
  });
}

// Reads the "- Entries recorded: N" line the duplicate-apply renderer emits.
// Returns null if the line is absent, so a test can tell "the section is there
// and says 0" from "the section is not in the file at all".
function foldedEntryCount(md) {
  const line = md.split("\n").find((l) => /Entries recorded:\s*\d+/.test(l));
  return line ? Number(line.match(/Entries recorded:\s*(\d+)/)[1]) : null;
}

describe("[N61] a real feature's log reaches the real download button through the singleton", () => {
  it("folds the duplicate-apply feature's own records into the downloaded file", async () => {
    await mountJoin();

    // Baseline: the feature has attached but recorded nothing. The section must
    // already be in the file (an attached feature that has not fired yet is
    // still part of the app-wide log) and must say ZERO -- this is the control
    // that stops the "== 1" assertion below from being a constant that would
    // pass however the join is wired.
    const before = await clickAndReadDownload();
    expect(before, "the attached feature's section never reached the file").toContain("Feature logs folded in");
    expect(before).toContain("Duplicate-application check log");
    expect(foldedEntryCount(before)).toBe(0);

    // Drive the real feature the way a tailor run does, then download again. The
    // count moving 0 -> 1 is the whole join: the hook wrote to its own ref, the
    // singleton's snapshot re-ran the hook's render closure, and the button's
    // click carried the result into the bytes.
    await recordOneCheck("job-alpha");
    const after = await clickAndReadDownload();
    expect(foldedEntryCount(after), "the feature recorded a check the app-wide file never showed").toBe(1);
  });

  it("re-reads the feature's live refs on every click, so the file is never a mount-time snapshot", async () => {
    // The load-bearing property of `render` being a FUNCTION (appActivityLog.js
    // header): a feature attaches ONCE at mount, and each download must reflect
    // what the feature holds AT CLICK TIME, not what it held when it attached.
    // Proven here end to end through the real button rather than against a fresh
    // createActivityLog() instance.
    await mountJoin();

    await recordOneCheck("job-one");
    expect(foldedEntryCount(await clickAndReadDownload())).toBe(1);

    await recordOneCheck("job-two");
    await recordOneCheck("job-three");
    // If the section were captured at attach time (a string, not a closure), or
    // snapshotted at mount, this would still read 1.
    expect(foldedEntryCount(await clickAndReadDownload())).toBe(3);
  });

  it("demotes the feature's own top-level heading so the combined file keeps one outline", async () => {
    // renderDuplicateApplyLog emits its own `# Duplicate-application check log`.
    // The app-wide document pushes an attached log's headings down three levels
    // so the file reads as one document. This exercises that path on REAL
    // feature output arriving through the real click, not a hand-written string.
    await mountJoin();
    await recordOneCheck("job-x");
    const md = await clickAndReadDownload();
    expect(md).toMatch(/^#### Duplicate-application check log$/m);
    expect(md).not.toMatch(/^# Duplicate-application check log$/m);
  });
});
