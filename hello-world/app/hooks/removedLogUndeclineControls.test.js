// @vitest-environment jsdom
//
// N90 FIX 1, CONTROLS. The fix (accept un-declines what it accepts) is scoped
// to `acceptFacts` ALONE. These two controls pin the boundary of that scope --
// the two paths the fix must NOT change:
//
//   1. AUTO-INSERT must NEVER un-decline. An UNREQUESTED auto-insert of a
//      previously-removed fact stays suppressed: only an explicit accept
//      overrides a removal (diagnosis §"Why this is the smallest correct
//      change"). So `autoInsertFactsForJob` must keep resending the removed log
//      unchanged, and must keep excluding the removed article.
//   2. REMOVAL must still ADD to the removed log. `removeInsertedFact` is the
//      one writer of the log; the fix leaves it alone.
//
// BOTH controls PASS on HEAD and MUST STAY GREEN through the fix. Their
// discriminating power is proven by the mutation run in the TDD notes:
//   - a mutant that clears the removed log on the AUTO path reds control 1;
//   - a mutant that clears the log (or fails to add) on removal reds control 2.
// A control that stays green when the mechanism is broken proves nothing; these
// are here precisely so a too-broad fix cannot pass.
//
// WHY HOOK-LEVEL. Neither path is a human click: auto-insert fires from
// DocumentPreviewMount's coordinating effect, and one-click removal fires from
// the preview strip. Their reachability is already pinned by
// autoInsertFactsForJob.rc.test.js and removeInsertedFact.rc.test.js; here they
// are driven as the hook functions the app calls, and the assertions are on the
// hook's own observable state and the PUT bodies it sends.
//
// Model harness: app/hooks/autoInsertFactsForJob.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const REAL_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
};
const REAL_2 = {
  title: "Acme wins a sustainability award",
  url: "https://press.example.org/acme/award",
  source: "press.example.org",
  summary: "Acme received a national sustainability award.",
  suggestion: "Acme winning a national sustainability award is a big reason I am excited about this opportunity.",
};

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

let store = { facts: [], removed: [], revision: null };
let putBodies = [];
let researchArticles = [];
let probe = null;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
function entryWithEngineLetter(overrides = {}) {
  return {
    status: "done",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    ...overrides,
  };
}
function HookProbe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  researchArticles = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
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
async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap }));
  });
  await flush();
}
async function seedResearch(articles, { removed = [] } = {}) {
  researchArticles = articles;
  store = { facts: [], removed, revision: removed.length ? 1 : null };
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function insertedFacts() {
  return probe.tailoringMap[JOB_ID]?.insertedFacts || [];
}
function lastPut() {
  expect(putBodies.length, "no accepted-facts PUT was sent").toBeGreaterThan(0);
  return putBodies[putBodies.length - 1];
}

// ===========================================================================
// CONTROL 1 -- AUTO-INSERT must NOT un-decline (GREEN; a mutant that clears the
// removed log on the auto path reds this).
// ===========================================================================
describe("N90 FIX 1 control: an unrequested auto-insert never un-declines a removed fact", () => {
  it("keeps the removed url in the log it PUTs, and does not re-insert the removed fact", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    // REAL_1 was removed earlier (its url is in the seeded removed log); REAL_2
    // was not. Auto-insert must respect that -- insert REAL_2, leave REAL_1
    // both un-inserted AND still marked removed.
    await seedResearch([REAL_1, REAL_2], { removed: [REAL_1.url] });

    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const text = coverLines().join("\n");
    // The removed fact stays out (this half is also pinned by the N72 suite;
    // kept here as the non-vacuity control -- a run that inserted nothing would
    // pass the log assertion below trivially).
    expect(text, "a previously-removed fact was silently re-inserted by auto-insert").not.toContain(REAL_1.suggestion);
    expect(text, "the non-removed eligible fact was not inserted -- the run did nothing").toContain(REAL_2.suggestion);

    // THE CONTROL: the log the auto path persisted STILL carries the removed
    // url. Auto-insert must not clear it -- only an explicit accept may.
    const put = lastPut();
    expect(
      put.declinedUrls || [],
      "auto-insert CLEARED a removed url -- an unrequested run must never un-decline a retracted fact (N90 auto-path control)",
    ).toContain(REAL_1.url);
    expect(store.removed, "the store lost the removed url after an auto-insert").toContain(REAL_1.url);
  });
});

// ===========================================================================
// CONTROL 2 -- REMOVAL still adds to the removed log (GREEN; a mutant that
// makes removal skip the log, or clear it, reds this).
// ===========================================================================
describe("N90 FIX 1 control: removing a fact still records its url in the removed log", () => {
  it("adds the removed url to the log the PUT sends", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    // No prior removals; auto-insert REAL_1 so there is a located inserted-fact
    // record for removeInsertedFact to act on.
    await seedResearch([REAL_1]);
    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const inserted = insertedFacts();
    expect(inserted.length, "auto-insert did not record the fact -- nothing to remove").toBe(1);
    expect(store.removed, "the removed log is not empty before the removal -- precondition broken").toEqual([]);
    const factId = inserted[0].id;
    const putsBefore = putBodies.length;

    await act(async () => {
      await probe.research.removeInsertedFact(JOB_ID, factId);
    });
    await drain();

    expect(putBodies.length, "removeInsertedFact sent no PUT").toBeGreaterThan(putsBefore);
    const put = lastPut();
    // THE CONTROL: the removed fact's id (N75: the per-fact id, not its source
    // url; `factId` above is the id the app minted for REAL_1) is now in the log.
    expect(
      put.declinedUrls || [],
      "removeInsertedFact did NOT record the removed fact's id -- the removed log is the mechanism the fix relies on (N90 removal control)",
    ).toContain(factId);
    expect(store.removed, "the store did not persist the removal").toContain(factId);
    // The fact really left the letter (non-vacuity: the removal did something).
    expect(coverLines().join("\n"), "the fact was not actually removed from the letter").not.toContain(REAL_1.suggestion);
  });
});

// ===========================================================================
// N91 -- the id-keyed half of FIX 1's own un-decline (regression guard; GREEN
// on HEAD, unlike the RED-on-HEAD defect pinned in acceptUndeclinesRemoved.rc.
// test.js). `acceptFacts`'s `acceptedKeys` Set matches on BOTH url and id
// (useCompanyResearch.js, `facts.flatMap((f) => [f?.url, f?.id])`), matching
// the id-first key `removedFactKey(record)` (`record.id || record.url`, N75)
// that removeInsertedFact writes -- and the url half still clears a url-keyed
// entry written before N75 -- but every N90
// test drives url-based un-declining only, so a mutant dropping the `.id`
// half of that Set survived all 11 N90 tests (N90.verify.r1.md finding 2/3).
//
// Driven the same way this file drives autoInsertFactsForJob/removeInsertedFact
// above: `probe.research.acceptFacts(...)` is the real exported function
// page.js wires to the dialog's onAccept, called with a hand-built selection
// shaped exactly like CompanyResearchDialog's acceptSelection() output for a
// url-less article (`{id, text, url: "", title, source, placement,
// textOrigin}`) -- the same pattern acceptDurabilityAndConflict.test.js uses
// for acceptFacts generally. A DOM-driven fixture cannot pin the id branch:
// useCompanyResearch's own withMintedIds/mintArticleId (:174-175) discards
// every incoming article's id and re-mints it from the url, and a url-less
// article's fallback id is a non-deterministic runStamp -- so a hand-built
// selection is the only way to fix the id being un-declined to a known value.
// ===========================================================================
describe("N91: an explicit accept also un-declines an id-keyed removed entry (no url)", () => {
  it("drops the accepted fact's id -- not just a url -- from the persisted removed log", async () => {
    const ID_ONLY_KEY = "fact-support-hub";
    const UNTOUCHED_URL = "https://press.example.org/keep-this-removed";
    const FACT_TEXT = "Acme relocated its support hub to Austin, right as I was moving there myself.";

    await mount({ [JOB_ID]: entryWithEngineLetter() });
    // A returning candidate's store row after an earlier removal of a
    // url-less fact: removeInsertedFact's `record.url || record.id` would
    // have stored its id, not a url, in the removed log. Seeded through the
    // real GET seedResearch fires, plus an untouched url-keyed entry so an
    // over-broad fix (clearing by url only, or wiping the whole log) is
    // distinguishable from the real, scoped one.
    await seedResearch([], { removed: [ID_ONLY_KEY, UNTOUCHED_URL] });
    expect(
      probe.research.acceptedFactsByJob[JOB_ID]?.removed || [],
      "the removed log was not seeded from the GET -- the prior-removal precondition is not in place",
    ).toEqual([ID_ONLY_KEY, UNTOUCHED_URL]);

    let result = null;
    await act(async () => {
      result = await probe.research.acceptFacts({
        facts: [
          {
            id: ID_ONLY_KEY,
            text: FACT_TEXT,
            url: "",
            title: "Acme relocates its support hub",
            source: "Newsroom",
            placement: "current",
            textOrigin: "template",
          },
        ],
        declinedUrls: [],
      });
    });
    await drain();

    expect(result?.ok, `the accept was refused -- the test would be vacuous: ${result?.reason}`).toBe(true);
    // Non-vacuity: the accept genuinely inserted the fact.
    expect(coverLines().join("\n"), "the accept did not insert the fact -- nothing was actually accepted").toContain(FACT_TEXT);

    const put = lastPut();
    expect(
      put.declinedUrls || [],
      "the accepted fact's id is STILL in the removed log after an explicit accept (N91 -- id-based un-decline gap)",
    ).not.toContain(ID_ONLY_KEY);
    expect(store.removed, "the store still holds the accepted id as removed").not.toContain(ID_ONLY_KEY);

    // CONTROL: an unrelated url-keyed entry survives -- id-based un-declining
    // must be scoped to what was accepted, same as the url-keyed case in
    // acceptUndeclinesRemoved.rc.test.js.
    expect(
      put.declinedUrls || [],
      "accepting the id-keyed fact wiped an unrelated url-keyed retraction from the removed log",
    ).toContain(UNTOUCHED_URL);
    expect(store.removed, "the store lost an unrelated url-keyed retraction on an id-based accept").toContain(UNTOUCHED_URL);
  });
});

// WHAT THIS FILE CANNOT CATCH. All three describes above are GREEN controls
// -- they cannot fail on HEAD and are not evidence of the FIX 1 defect (that
// is acceptUndeclinesRemoved.rc.test.js). They stub /api/accepted-facts, so
// the route/RPC/column are not exercised; they prove only the CLIENT sends
// the right removed-log value. They are driven as hook functions, not
// through the effect/strip/dialog that fires them in the app (reachability
// lives in the sibling .rc files named in the header).
