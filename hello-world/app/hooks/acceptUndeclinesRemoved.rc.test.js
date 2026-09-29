// @vitest-environment jsdom
//
// N90 FIX 1, REACHABILITY. The owner-blocking defect (confirmed in
// docs/loop/N89.diagnosis.r1.md): an explicit ACCEPT never un-declines the
// fact it is accepting. `acceptFacts` (useCompanyResearch.js:445) reads the
// removed log and resends it UNCHANGED at :528, no matter what is being
// accepted -- so a fact the candidate removed and then re-accepts through the
// research dialog stays in the removed log forever, and every later fresh
// research + auto-insert drops it via the eligibility filter's
// `removedSet.has(a.url)` branch, returning `nothing-eligible` permanently.
//
// THIS FILE DRIVES THE REAL PATH A HUMAN DRIVES (brief rule 2): it mounts the
// really-rendered CompanyResearchDialog over the real useCompanyResearch hook
// and clicks the real "Insert into cover letter" control. It NEVER calls
// `acceptFacts(...)` directly for the behavioural legs. The prior removed log
// is a REALISTIC one: it is seeded through the real GET that
// `openCompanyResearch` -> `fetchAcceptedFactsInto` fires (:352-357), exactly
// the value a returning candidate's store row would return after an earlier
// removal -- never a direct poke of `acceptedFactsByJob` state.
//
// THE REACHABLE SEQUENCE (all three verified reachable in N89 diagnosis §3):
//   1. In an earlier session the candidate removed this article's fact -- so
//      the store's `removed` log carries its url, and the letter no longer
//      carries the fact. (Seeded via the GET below.)
//   2. They reopen the research dialog. CompanyResearchDialog never filters its
//      cards against the removed log, so the same article's card is still
//      selectable (diagnosis §3 / CompanyResearchDialog.js:117-140).
//   3. They check it and click "Insert into cover letter" -- a real click on
//      the real control, running the real acceptFacts.
//
// jsdom note: MUI Dialog and Select menu portal to document.body.
// Model harness: app/hooks/acceptFactReacceptPlacement.rc.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// The article the candidate removed earlier and now re-accepts. Its suggestion
// is a full sentence that appears nowhere in the engine letter, so a re-accept
// genuinely inserts it (never a reconstructing fixture).
const FACT = "Acme opened a Dublin telemetry lab this spring, which is exactly the kind of work I want to join.";
const ACCEPTED_URL = "https://news.example.com/dublin-lab";
const ARTICLE = {
  id: "art-a",
  title: "Acme opens a Dublin telemetry lab",
  url: ACCEPTED_URL,
  source: "Newsroom",
  date: "2026-02-01",
  summary: "A thing happened.",
  suggestion: FACT,
};
// A SECOND url that is in the removed log but is NOT being accepted this click.
// It corresponds to no article on screen; it stands for a different fact the
// candidate genuinely retracted and has not touched. It must survive the accept
// untouched (the fix un-declines ONLY what is accepted, never the whole log).
const UNTOUCHED_REMOVED_URL = "https://press.example.org/keep-this-removed";

function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let INTRO_IDX = -1;

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
  INTRO_IDX = introIndex(ENGINE_LINES);
});

let store = { facts: [], removed: [], revision: null };
let researchQueue = [];
let putBodies = [];
let research = null;
let currentMap = null;
let acceptPromise = null;
let container = null;
let root = null;
const EMPTY = [];

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  currentMap = tailoringMap;
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  const r = research.researchByJob[JOB_ID] || {};
  return createElement(CompanyResearchDialog, {
    open: research.companyResearch.open,
    company: research.companyResearch.company,
    needsCompany: !!r.needsCompany,
    loading: !!r.loading,
    error: r.error || "",
    articles: r.articles || EMPTY,
    warnings: r.warnings || EMPTY,
    busy: !!research.companyResearch.busy,
    acceptError: research.companyResearch.acceptError || "",
    acceptNotice: research.companyResearch.acceptNotice || "",
    coverLetterLines: tailoringMap[JOB_ID]?.coverLetterResultLines || EMPTY,
    onClose: () => research.closeCompanyResearch(),
    onApply: () => {},
    onAccept: (selection) => {
      acceptPromise = research.acceptFacts(selection);
      return acceptPromise;
    },
    onResearch: () => {},
    onAddUrl: () => {},
  });
}

function entryEngine(over = {}) {
  return { status: "done", coverLetterResultLines: [...ENGINE_LINES], coverLetterDocxB64: ENGINE_B64, coverVersionId: "ver-1", ...over };
}
function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// The prior removed log this test starts from -- as a returning candidate's
// store row would carry it after an earlier removal.
let SEED_REMOVED = [];

beforeEach(() => {
  SEED_REMOVED = [ACCEPTED_URL, UNTOUCHED_REMOVED_URL];
  // A non-empty removed log implies a row already exists -> a real revision.
  store = { facts: [], removed: [...SEED_REMOVED], revision: 1 };
  researchQueue = [];
  putBodies = [];
  research = null;
  currentMap = null;
  acceptPromise = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchQueue.shift() || [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      // The RPC REPLACES the retracted log with whatever the client sends
      // (migration 20260923030000:256) -- model that faithfully.
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision });
    }
    return json({});
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete globalThis.fetch;
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function drain(steps = 20) {
  for (let n = 0; n < steps; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entryEngine() } }));
  });
  await flush();
}

async function openResearch() {
  researchQueue.push([ARTICLE]);
  await act(async () => {
    research.openCompanyResearch(JOB);
  });
  await flush();
  expect(hookArticles().length, "the research run never reached the hook -- instrument failure").toBe(1);
  // The prior removed log was seeded through the REAL GET, not a state poke.
  expect(
    research.acceptedFactsByJob[JOB_ID]?.removed || [],
    "the removed log was not seeded from the GET -- the prior-removal precondition is not in place",
  ).toEqual(SEED_REMOVED);
}
function hookArticles() {
  return research?.researchByJob?.[JOB_ID]?.articles || [];
}
function buttonByText(text) {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === text);
}
async function clickAccept() {
  const button = buttonByText("Insert into cover letter");
  expect(button, "no 'Insert into cover letter' control on screen").toBeTruthy();
  expect(button.disabled).toBe(false);
  acceptPromise = null;
  await act(async () => {
    button.click();
  });
  expect(acceptPromise, "the control was clicked but no accept started").toBeTruthy();
  await act(async () => {
    await acceptPromise;
  });
  await drain();
}
function liveLines() {
  return currentMap[JOB_ID].coverLetterResultLines || [];
}
function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}
function lastPut() {
  expect(putBodies.length, "no accepted-facts PUT was ever sent -- the accept never reached the store").toBeGreaterThan(0);
  return putBodies[putBodies.length - 1];
}

// ---------------------------------------------------------------------------
// Fixture precondition -- guard against a vacuous pass.
// ---------------------------------------------------------------------------
describe("N90 FIX 1: fixture precondition", () => {
  it("the engine letter does not already carry the fact, and the removed log starts with both urls", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_LINES.join("\n"), "fixture already contains the fact -- a re-accept would insert nothing").not.toContain(FACT);
    expect(SEED_REMOVED, "the accepted url must start IN the removed log or there is nothing to un-decline").toContain(ACCEPTED_URL);
    expect(SEED_REMOVED, "the untouched url must start in the removed log").toContain(UNTOUCHED_REMOVED_URL);
  });
});

// ---------------------------------------------------------------------------
// THE DEFECT -- RED on HEAD.
// ---------------------------------------------------------------------------
describe("N90 FIX 1: an explicit accept un-declines the fact it accepts (RED on HEAD)", () => {
  it("accepting a previously-removed article drops its url from the persisted removed log", async () => {
    await mount();
    await openResearch();

    await clickAccept();
    expect(research.companyResearch.acceptError || "", "the accept was refused -- the test would be vacuous").toBe("");
    // Non-vacuity: the accept genuinely inserted the fact (so it really WAS an
    // accept of this url, not a no-op that trivially "removed" nothing).
    expect(count(liveLines().join("\n"), FACT), "the accept did not insert the fact -- nothing was actually accepted").toBe(1);

    // THE CRITERION: the removed log the client PUT no longer carries the
    // accepted url. On HEAD acceptFacts resends the whole removed log
    // unchanged, so this url is still there -> RED.
    const put = lastPut();
    expect(
      put.declinedUrls || [],
      "the accepted fact's url is STILL in the removed log after an explicit accept (N90 -- accept does not un-decline)",
    ).not.toContain(ACCEPTED_URL);

    // And it is truly gone from the persisted store, not just this PUT body.
    expect(store.removed, "the store still holds the accepted url as removed").not.toContain(ACCEPTED_URL);
  });

  it("CONTROL: an untouched removed entry is LEFT in the log (un-declining is scoped to what is accepted, never the whole log)", async () => {
    // Passes on HEAD (HEAD keeps the whole log) and must STAY green through the
    // fix. Its discriminating power (proven by the mutation run) is against a
    // naive fix that resets declinedUrls to [] on every accept -- which would
    // resurrect a fact the candidate deliberately retracted and never touched.
    await mount();
    await openResearch();

    await clickAccept();
    expect(research.companyResearch.acceptError || "").toBe("");

    const put = lastPut();
    expect(
      put.declinedUrls || [],
      "accepting one fact wiped an UNRELATED retraction from the removed log",
    ).toContain(UNTOUCHED_REMOVED_URL);
    expect(store.removed, "the store lost an unrelated retraction on an accept").toContain(UNTOUCHED_REMOVED_URL);
  });
});

// ---------------------------------------------------------------------------
// THE OWNER'S ACTUAL SYMPTOM -- RED on HEAD.
// After the un-decline, a later fresh research + auto-insert must no longer drop
// the fact as "removed": its url is out of removedSet, so the eligibility
// filter passes it, and (because it is now accepted) planCoverFacts dedupes it
// to "nothing-new" -- NOT "nothing-eligible". On HEAD the url is still in the
// removed log, so the filter drops it and the function returns nothing-eligible
// exactly as the owner reported.
// ---------------------------------------------------------------------------
describe("N90 FIX 1: after re-accept, a later auto-insert no longer reports nothing-eligible (RED on HEAD)", () => {
  it("the re-accepted fact is eligible again on the next auto-insert run", async () => {
    await mount();
    await openResearch();

    await clickAccept();
    expect(research.companyResearch.acceptError || "").toBe("");

    // A later run for the SAME application: the article resurfaces (still in
    // researchByJob from the open above) and auto-insert re-checks the store.
    // On HEAD this returns nothing-eligible (url still removed); with the fix it
    // returns nothing-new (url un-declined, but the fact is already accepted).
    let result = null;
    await act(async () => {
      result = await research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    expect(
      result?.code,
      "auto-insert still reports nothing-eligible after the fact was re-accepted -- the removal was never cleared (N90, the owner's symptom)",
    ).not.toBe("nothing-eligible");
    // Precise end state (diagnosis §"Interaction to verify"): already-accepted
    // -> nothing-new, never a duplicate insertion.
    expect(result?.code, "expected the re-accepted fact to dedupe to nothing-new").toBe("nothing-new");
  });
});

// WHAT THIS FILE CANNOT CATCH. It stubs /api/accepted-facts, so the route, the
// RPC and the retracted column are not exercised (the diagnosis established the
// server already replaces the log verbatim, so the client value is what
// matters). It drives one job in one session; a cross-session reload is not
// simulated. It asserts the removed-log CONTENTS and the resulting eligibility
// code, not the prose quality of the letter. The url matching is exact-string,
// mirroring the stored `record.url` -- a future normalization change to
// articleUrlKey that altered stored keys would need this fixture revisited.
