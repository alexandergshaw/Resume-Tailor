// @vitest-environment jsdom
//
// N95 (perceived-smoothness pass) -- MOVE feedback: working indicator,
// double-fire refusal, announcement, failure teardown. Driven the way a
// candidate drives it (loop-tdd rule 2; the sibling moveInsertedFact.rc.test.js
// is the template): mount the REAL DocumentPreviewMount (real
// DocumentPreviewDialog + InsertedFactsStrip), insert a fact through the real
// accept path, then CLICK the real per-fact arrow. `research.moveInsertedFact`
// is NEVER called directly -- a direct call cannot prove a user reaches the
// control, and reachability is the most-repeated defect in this repo.
//
// The in-flight window is created HONESTLY, not synchronously: the network PUT
// commitFactMove issues is GATED on a promise this test controls, so the move
// is genuinely mid-flight (a delayed promise, per loop-tdd rule 13) while the
// second click / the marker assertions run. A same-tick "fire twice" cannot
// prove a concurrency guard; a real user's second click lands hundreds of ms
// later, on whatever the first click's re-render produced -- which is exactly
// what these tests reproduce (click, let React commit, then click again).
//
// RED-on-HEAD (verified this round): `moveInsertedFact` (useCompanyResearch.js
// :635-697) sets no pending flag; the arrows' only `disabled` driver is the
// caller-precomputed `movability` map, unchanged in flight -- so a move has no
// aria-busy marker, is fully spammable (a second click launches a second
// splice+PUT), and no live region announces it.
//
// jsdom note: MUI's Dialog portals into document.body, so DOM queries go
// through `document`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// A body paragraph with the fact NOT at either boundary and TWO further
// sentences after it, so the fact can move forward more than once: after one
// forward move `movability.forward` is STILL true. That is what lets the
// movability-independence assertion (AC-M2) bite -- a guard that (wrongly)
// keyed the in-flight disable on `movability` would leave the arrow live here,
// and the second click would slip through.
const FACT_TEXT = "Beta led a Dublin telemetry lab.";
const BODY = `Alpha shipped the platform. ${FACT_TEXT} Gamma scaled the fleet. Delta cut the latency.`;

function seededEntry(over = {}) {
  const lines = ["Dear Hiring Manager,", BODY, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    // No cover bytes -> commitFactMove skips the docx splice and the PUT is the
    // ONLY IO left to gate; the move still proceeds (a move is not gated on
    // bytes, AC-A9), so the flight is real and deterministic.
    coverLetterDocxB64: "",
    coverVersionId: "ver-1",
    insertedFacts: [
      {
        id: "art-dublin",
        text: FACT_TEXT,
        lineIndex: 1,
        offset: lines[1].indexOf(FACT_TEXT),
        url: "https://news.example.com/acme/dublin-lab",
        title: "Acme opens a Dublin telemetry lab",
      },
    ],
    ...over,
  };
}

let store;
let putBodies;
let probe;
let container = null;
let root = null;
// When armed, every /api/accepted-facts PUT (the move's commit) awaits this
// gate before responding, so the move stays genuinely mid-flight.
let putGate = null;
let putShouldFail = false;

function makeDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function Probe() {
  const [tailoringMap, setTailoringMap] = useState({ [JOB_ID]: seededEntry() });
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  const preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: () => {},
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 50,
    contextFiles: [],
    downloadDocxFiles: {},
    startBackgroundResearch: research.startBackgroundResearch,
    setPreviewReloadKey,
    onDocumentEdited: () => {},
    currentUser: null,
    onCheckDuplicate: () => {},
  });
  probe = { tailoringMap, setTailoringMap, research, preview };
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research,
    chat: { askAiAbout: () => {} },
    tailorEngine: "gemini",
    previewReloadKey,
    scrapePreviewPosting: null,
    currentUser: null,
    resumeFile: null,
    coverLetterFile: null,
  });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  probe = null;
  putGate = null;
  putShouldFail = false;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      // The PUT is COUNTED at dispatch (above) so a second concurrent op is
      // visible immediately; the RESPONSE waits on the gate when armed.
      if (putGate) await putGate.promise;
      if (putShouldFail) return json({ error: "The letter's saved copy is out of date." }, 409);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision, versionSaved: !!body.coverVersion });
    }
    return json({});
  });
});

afterEach(async () => {
  if (putGate) {
    putGate.resolve();
    putGate = null;
  }
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete globalThis.fetch;
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });
  await flush();
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

const laterButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence later"]')];
const earlierButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence earlier"]')];
const alertBands = () => [...document.querySelectorAll('[role="alert"]')];
// EVERY polite live region in the document -- there is already ONE from
// DocumentPreviewDialog's own CopyFeedbackStrip (the copy-feedback instance),
// so the move's announcement is proven by TEXT landing in a polite region,
// never by mere presence. Selected by data-copy-status, never role, because
// DriveResultRegion's role=status carries no data-copy-status (verified in
// DocumentPreviewDialog.copy.test.js:549) -- role alone would be ambiguous.
const politeText = () =>
  [...document.querySelectorAll('[data-copy-status="polite"]')].map((n) => n.textContent || "").join(" | ");

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

// The fact's row carries aria-busy while ITS op is in flight; closest() also
// matches self, so this is truthy whether the attribute lands on the row or a
// control within it.
function rowBusy(btn) {
  return !!btn.closest('[aria-busy="true"]');
}

describe("AC-M1: a move shows a working indicator for the flight and clears it on settle", () => {
  it("marks the fact's row aria-busy after click and removes it once the commit resolves", async () => {
    await mount();
    expect(coverLines().join("\n"), "the fact was never inserted -- the test would be vacuous").toContain(FACT_TEXT);
    expect(laterButtons().length).toBe(1);
    expect(rowBusy(laterButtons()[0]), "the row is aria-busy before any move -- the marker is meaningless").toBe(false);

    putGate = makeDeferred();
    await act(async () => {
      laterButtons()[0].click();
    });
    await flush();
    // present DURING flight (RED on HEAD: moveInsertedFact sets no pending state)
    expect(rowBusy(laterButtons()[0]), "no in-flight marker after a move click -- the move has no working indicator").toBe(true);

    // absent AFTER settle (the safe failing direction is a spinner that outlives
    // the op; assert it is gone both ways -- here, success)
    putGate.resolve();
    putGate = null;
    await flush();
    expect(rowBusy(laterButtons()[0]), "the working indicator outlived the resolved move").toBe(false);
  });
});

describe("AC-M2: a second activation mid-flight launches no second move", () => {
  it("disables the fact's move control in flight (independent of movability) so a second click dispatches no second commit", async () => {
    await mount();
    expect(laterButtons()[0].disabled, "forward is not live before the move -- the guard test would be vacuous").toBe(false);

    putGate = makeDeferred();
    await act(async () => {
      laterButtons()[0].click();
    });
    await flush();

    // exactly ONE commit dispatched so far, and the arrow is now guarded
    expect(putBodies.length, "the first move never dispatched a commit -- the flight is not real").toBe(1);
    // The fact still has room to move forward again, so `movability.forward`
    // stays true here -- the ONLY thing that can have disabled this arrow is an
    // in-flight guard independent of movability. RED on HEAD (no such guard);
    // a per-direction/movability-keyed guard leaves it live and dies here.
    expect(laterButtons()[0].disabled, "the in-flight arrow is not disabled -- a second click can launch a second splice+PUT").toBe(true);

    await act(async () => {
      laterButtons()[0].click();
    });
    await flush();
    expect(putBodies.length, "a second click mid-flight launched a second concurrent commit").toBe(1);

    putGate.resolve();
    putGate = null;
    await flush();
  });
});

describe("AC-M3: a move's state is ANNOUNCED via a live region, not merely drawn", () => {
  it("lands the move outcome in a polite region whose text survives the move's own reload bump", async () => {
    await mount();
    expect(politeText(), "a polite region already carries move text before any move -- not a change").not.toMatch(/moved/i);

    // A completed move (not gated): the announcement must be present AFTER the
    // move's setPreviewReloadKey re-parse settles. If the strip's feedback
    // clearKey included previewReloadKey, the move's OWN reload bump would
    // render-phase-reset the region to empty and wipe "Fact moved." -- a silent
    // a11y failure (D-PLAN-1 / R6). Asserting AFTER settle is what catches it.
    await act(async () => {
      laterButtons()[0].click();
    });
    await flush();

    expect(politeText(), "no live region announced the move -- it was drawn (or not) but never announced").toMatch(/moved/i);
  });
});

describe("AC-M4: a failed move tears the pending state down and surfaces the reason", () => {
  it("clears the marker, re-enables the control, and shows the reason in the strip alert band", async () => {
    await mount();

    putShouldFail = true;
    putGate = makeDeferred();
    await act(async () => {
      laterButtons()[0].click();
    });
    await flush();
    // the pending marker is present during the failing op's flight (RED on HEAD)
    expect(rowBusy(laterButtons()[0]), "a failing move shows no in-flight marker to tear down").toBe(true);

    putGate.resolve();
    putGate = null;
    await flush();

    // (a) marker cleared, (b) control usable again, (c) reason surfaced
    expect(rowBusy(laterButtons()[0]), "the marker outlived a FAILED move -- it can spin forever").toBe(false);
    expect(laterButtons()[0].disabled, "the control stayed disabled after a failed move").toBe(false);
    const bandText = alertBands().map((b) => b.textContent || "").join(" ");
    expect(bandText, "the failed move surfaced no honest reason in any alert band").toMatch(/move|date|try again/i);
  });
});

describe("NO-OP control: a settled, ungated move raises no lasting busy marker", () => {
  it("leaves no aria-busy row once a normal move completes (a hardwired-on indicator would fail here)", async () => {
    await mount();
    await act(async () => {
      laterButtons()[0].click();
    });
    await flush();
    // With no gate, the move completes within the flush; a correct build shows
    // NO lasting marker. A build that hardwired aria-busy on (over-fires) fails.
    expect(document.querySelector('[aria-busy="true"]'), "a settled move left a stuck busy marker").toBeNull();
    expect(coverLines().join("\n"), "the ungated move did not actually happen -- control is vacuous").toContain(FACT_TEXT);
  });
});
