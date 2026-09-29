// @vitest-environment jsdom
//
// N90 FIX 2, THE COUNTS (hook level). The owner has repeatedly demanded logs
// that fill the gap: the next `nothing-eligible` repro must be conclusive on
// its own. The fix makes the `nothing-eligible` return of
// `autoInsertFactsForJob` carry PLAIN COUNTS (no urls, no text -- N77):
//   articleCount, droppedNoUrl, droppedNoSuggestion, droppedRemoved,
//   droppedRemovedAlsoAccepted
// where the last counts dropped-as-removed urls that ALSO appear in the
// accepted `facts` -- a nonzero value is direct proof of the FIX 1 defect
// (a fact simultaneously accepted and removed).
//
// This file drives the real `autoInsertFactsForJob` over a representative
// filtered set in which EVERY article is dropped for a distinct reason, so
// eligible is empty and the function returns `nothing-eligible`, and asserts
// the exact counts. On HEAD the return carries none of these fields -> RED
// (each is `undefined`).
//
// The removed log (droppedRemoved) is seeded through the real GET that
// openCompanyResearch fires; the "also accepted" case is a fact whose url is in
// BOTH the seeded removed log AND the seeded accepted facts.
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

// A1: no usable url -> droppedNoUrl.
const A1_NO_URL = {
  title: "Acme rumoured to be hiring",
  url: "",
  source: "",
  summary: "Unsourced chatter.",
  suggestion: "I hear Acme is growing fast and would love to be part of it.",
};
// A2: usable url, but blank suggestion -> droppedNoSuggestion.
const A2_NO_SUGGESTION = {
  title: "Acme opens an office",
  url: "https://news.example.com/acme/office",
  source: "news.example.com",
  summary: "Acme opened an office.",
  suggestion: "   ",
};
// A3: usable url, suggestion, IN the removed log, NOT accepted -> droppedRemoved only.
const A3_REMOVED = {
  title: "Acme wins an award",
  url: "https://press.example.org/acme/award",
  source: "press.example.org",
  summary: "Acme won an award.",
  suggestion: "Acme winning a national award is a big reason I am excited about this role.",
};
// A4: usable url, suggestion, IN the removed log AND currently accepted
// (its url is in `facts`) -> droppedRemoved AND droppedRemovedAlsoAccepted.
// This is the smoking gun the owner needs in the log.
const A4_REMOVED_AND_ACCEPTED = {
  title: "Acme launches a telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme opened a telemetry lab.",
  suggestion: "Acme opening a Dublin telemetry lab is exactly the kind of work I want to join.",
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
// Seed research articles AND the store (facts + removed) via the real GET.
async function seedResearch(articles, { removed = [], facts = [] } = {}) {
  researchArticles = articles;
  store = { facts, removed, revision: removed.length || facts.length ? 1 : null };
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
}
async function runAuto() {
  let result = null;
  await act(async () => {
    result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
  });
  await drain();
  return result;
}

// ===========================================================================
// THE COUNTS -- RED on HEAD (the nothing-eligible return carries no counts).
// ===========================================================================
describe("N90 FIX 2: the nothing-eligible return carries content-free drop counts (RED on HEAD)", () => {
  it("reports the exact articleCount and per-reason drop counts for a fully-filtered set", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    // A4's url is in BOTH the removed log and the accepted facts (the FIX 1
    // anomaly). A3 is removed but not accepted.
    await seedResearch([A1_NO_URL, A2_NO_SUGGESTION, A3_REMOVED, A4_REMOVED_AND_ACCEPTED], {
      removed: [A3_REMOVED.url, A4_REMOVED_AND_ACCEPTED.url],
      facts: [{ id: "seed-a4", url: A4_REMOVED_AND_ACCEPTED.url, text: A4_REMOVED_AND_ACCEPTED.suggestion, title: A4_REMOVED_AND_ACCEPTED.title }],
    });

    const result = await runAuto();

    // Precondition: every article was dropped, so this really IS the
    // nothing-eligible path (else the counts would be about a different return).
    expect(result?.code, "the run did not reach nothing-eligible -- some article was eligible; the count fixture is wrong").toBe("nothing-eligible");

    // THE CRITERION (RED on HEAD -- these fields do not exist on HEAD's return).
    expect(result.articleCount, "articleCount not reported on the nothing-eligible return").toBe(4);
    expect(result.droppedNoUrl, "droppedNoUrl not reported / wrong").toBe(1);
    expect(result.droppedNoSuggestion, "droppedNoSuggestion not reported / wrong").toBe(1);
    expect(result.droppedRemoved, "droppedRemoved not reported / wrong").toBe(2);
    expect(
      result.droppedRemovedAlsoAccepted,
      "droppedRemovedAlsoAccepted not reported / wrong -- this is the field that exposes the accept-never-clears bug",
    ).toBe(1);

    // Invariants the counts must satisfy (eligible is empty here):
    expect(
      result.droppedNoUrl + result.droppedNoSuggestion + result.droppedRemoved,
      "the per-reason counts do not sum to articleCount -- the tally is not mutually exclusive",
    ).toBe(result.articleCount);
    expect(
      result.droppedRemovedAlsoAccepted,
      "droppedRemovedAlsoAccepted exceeds droppedRemoved -- it must be a subset of the removed drops",
    ).toBeLessThanOrEqual(result.droppedRemoved);

    // CONTENT-LEAK GUARD (N77): no url / title / suggestion in the returned
    // fields the recorder will read. Only counts and the canned reason/code.
    const serialized = JSON.stringify({
      articleCount: result.articleCount,
      droppedNoUrl: result.droppedNoUrl,
      droppedNoSuggestion: result.droppedNoSuggestion,
      droppedRemoved: result.droppedRemoved,
      droppedRemovedAlsoAccepted: result.droppedRemovedAlsoAccepted,
    });
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("example.org");
    expect(serialized).not.toContain("telemetry");
  });
});

// ===========================================================================
// CONTROL -- the counts are gated to the nothing-eligible return only (GREEN;
// a mutant that attaches the counts to every return reds this).
// ===========================================================================
describe("N90 FIX 2 control: a run that finds an eligible fact does not return nothing-eligible or drop counts", () => {
  it("returns a non-nothing-eligible code with no drop-count fields when a fact is eligible", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    // A3 is removed, but A4's article is eligible (not removed, has url +
    // suggestion) -- so eligible is non-empty and the function proceeds.
    await seedResearch([A3_REMOVED, A4_REMOVED_AND_ACCEPTED], { removed: [A3_REMOVED.url] });

    const result = await runAuto();

    expect(result?.code, "an eligible fact still produced nothing-eligible").not.toBe("nothing-eligible");
    // The drop counts belong ONLY to the nothing-eligible return; no other
    // outcome carries them (mirrors the DocumentPreviewMount gating).
    expect(result.droppedRemoved, "drop counts leaked onto a non-nothing-eligible return").toBeUndefined();
    expect(result.droppedRemovedAlsoAccepted, "drop counts leaked onto a non-nothing-eligible return").toBeUndefined();
    expect(result.articleCount, "articleCount leaked onto a non-nothing-eligible return").toBeUndefined();
  });
});

// WHAT THIS FILE CANNOT CATCH. It pins the counts the FUNCTION returns; it does
// NOT prove they reach the downloaded activity log -- that round trip (through
// recordAutoInsertOutcome and the fact-auto-insert field allowlist) is
// app/components/factAutoInsertNothingEligibleFields.rc.test.js, which drives
// the real DocumentPreviewMount and the real recorder. It stubs
// /api/accepted-facts. The droppedRemovedAlsoAccepted match is url-keyed via
// the seeded accepted facts; an id-only accepted fact (no url) would rely on
// the article's minted id matching, which this fixture does not exercise.
