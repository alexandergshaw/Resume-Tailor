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
    // THE CONTROL: the removed url is now in the log.
    expect(
      put.declinedUrls || [],
      "removeInsertedFact did NOT record the removed fact's url -- the removed log is the mechanism the fix relies on (N90 removal control)",
    ).toContain(REAL_1.url);
    expect(store.removed, "the store did not persist the removal").toContain(REAL_1.url);
    // The fact really left the letter (non-vacuity: the removal did something).
    expect(coverLines().join("\n"), "the fact was not actually removed from the letter").not.toContain(REAL_1.suggestion);
  });
});

// WHAT THIS FILE CANNOT CATCH. Both are GREEN controls -- they cannot fail on
// HEAD and are not evidence of the FIX 1 defect (that is
// acceptUndeclinesRemoved.rc.test.js). They stub /api/accepted-facts, so the
// route/RPC/column are not exercised; they prove only the CLIENT sends the
// right removed-log value. They are driven as hook functions, not through the
// effect/strip that fires them in the app (reachability lives in the sibling
// .rc files named in the header).
