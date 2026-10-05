// @vitest-environment jsdom
//
// N75 -- the retracted-fact (removed) log must key on the STABLE per-fact id,
// never the source URL. `removeInsertedFact` used to write
// `record.url || record.id`, so two DIFFERENT facts citing the same page wrote
// the SAME key: retracting one suppressed a legitimate re-add of the other,
// collapsed two retractions into one log entry, and a later explicit accept of
// either fact un-declined BOTH (it clears the url key the pair share).
//
// Shape of the evidence:
//   - the pure helper `removedFactKey` (the one derivation the write side
//     uses) -- id first, url only as the id-less fallback, "" for neither;
//   - the hook, driven the way N90's removedLogUndeclineControls drives it
//     (real useCompanyResearch, stubbed /api/accepted-facts), asserting on the
//     PUT bodies and the stored log, for two same-url facts with distinct ids;
//   - CONTROLS that are green on HEAD and must stay green: a retraction of a
//     research-minted fact still suppresses a later re-research of that same
//     article, a legacy url-keyed entry already in a stored log still
//     suppresses, and a record with no id still records something.
//
// Fact ids here are hand-built ("art-0" is the legacy position-minted shape
// older stored rows still carry): useCompanyResearch re-mints every ARRIVING
// article's id from its url, so only an explicitly accepted fact (or a stored
// legacy row) can be one of two distinct-id facts sharing a url.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { removedFactKey, filterEligibleArticles } from "@/lib/acceptedFacts/factInsertion.js";
import { articleUrlKey } from "@/lib/research/articleIdentity.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const SHARED_URL = "https://careers.example.com/acme/about";
const FACT_A = {
  id: "art-0",
  text: "Acme just opened a Dublin telemetry lab, which is exactly the work I want to do.",
  url: SHARED_URL,
  title: "Acme careers",
  source: "careers.example.com",
  placement: "intro",
  textOrigin: "template",
};
const FACT_B = {
  id: "art-1",
  text: "Acme also won a national sustainability award this year, which is a big reason I applied.",
  url: SHARED_URL,
  title: "Acme careers",
  source: "careers.example.com",
  placement: "intro",
  textOrigin: "template",
};
// A researched article at the SAME url, carrying a third, different claim.
const ARTICLE_AT_SHARED_URL = {
  title: "Acme careers",
  url: SHARED_URL,
  source: "careers.example.com",
  summary: "Acme runs a mentoring program for new engineers.",
  suggestion: "Acme's mentoring program for new engineers is the kind of culture I want to grow in.",
};
const REAL_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
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
async function openResearch(articles = [], { removed = [] } = {}) {
  researchArticles = articles;
  store = { facts: [], removed, revision: removed.length ? 1 : null };
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
}
async function accept(facts) {
  let result = null;
  await act(async () => {
    result = await probe.research.acceptFacts({ facts, declinedUrls: [] });
  });
  await drain();
  return result;
}
async function remove(factId) {
  await act(async () => {
    await probe.research.removeInsertedFact(JOB_ID, factId);
  });
  await drain();
}
async function autoInsert() {
  let result = null;
  await act(async () => {
    result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
  });
  await drain();
  return result;
}
function coverText() {
  return (probe.tailoringMap[JOB_ID]?.coverLetterResultLines || []).join("\n");
}
function insertedIds() {
  return (probe.tailoringMap[JOB_ID]?.insertedFacts || []).map((f) => f.id);
}
function lastPut() {
  expect(putBodies.length, "no accepted-facts PUT was sent").toBeGreaterThan(0);
  return putBodies[putBodies.length - 1];
}

// Two facts, same url, distinct ids, both really inserted (non-vacuity for
// everything that follows).
async function insertBothSameUrlFacts() {
  await mount({ [JOB_ID]: entryWithEngineLetter() });
  await openResearch();
  const result = await accept([FACT_A, FACT_B]);
  expect(result?.ok, `the setup accept was refused: ${result?.reason}`).toBe(true);
  expect(coverText(), "fact A was never inserted -- the scenario is vacuous").toContain(FACT_A.text);
  expect(coverText(), "fact B was never inserted -- the scenario is vacuous").toContain(FACT_B.text);
  expect(insertedIds().sort()).toEqual([FACT_A.id, FACT_B.id]);
}

// ===========================================================================
// The shared key derivation (pure).
// ===========================================================================
describe("N75: removedFactKey -- the one write-side key derivation", () => {
  it("is the per-fact id, even when the record also carries a url", () => {
    expect(removedFactKey({ id: "art-0", url: SHARED_URL })).toBe("art-0");
  });

  it("two facts sharing a url get DIFFERENT keys", () => {
    expect(removedFactKey({ id: "art-0", url: SHARED_URL })).not.toBe(removedFactKey({ id: "art-1", url: SHARED_URL }));
  });

  it("falls back to the url for a record with no id (so a retraction is still recorded)", () => {
    expect(removedFactKey({ url: SHARED_URL })).toBe(SHARED_URL);
    expect(removedFactKey({ id: "", url: SHARED_URL })).toBe(SHARED_URL);
    expect(removedFactKey({ id: null, url: SHARED_URL })).toBe(SHARED_URL);
  });

  it("is empty -- never undefined, never a throw -- for a record with neither, or no record", () => {
    expect(removedFactKey({})).toBe("");
    expect(removedFactKey({ id: "", url: "" })).toBe("");
    expect(removedFactKey(null)).toBe("");
    expect(removedFactKey(undefined)).toBe("");
  });
});

describe("N75: the read side honours the same key (filterEligibleArticles)", () => {
  const articleFor = (fact) => ({ id: fact.id, url: fact.url, suggestion: fact.text, title: "t" });
  const eligibleIds = (articles, removedLog) =>
    filterEligibleArticles(articles, { urlKey: articleUrlKey, removedSet: new Set(removedLog), priorFacts: [] }).eligible.map((a) => a.id);

  it("a log written for fact A suppresses A and leaves a same-url fact B eligible", () => {
    const log = [removedFactKey(FACT_A)];
    expect(eligibleIds([articleFor(FACT_A), articleFor(FACT_B)], log)).toEqual([FACT_B.id]);
  });

  it("a legacy url-keyed entry already in a stored log still suppresses (no silent reinstatement of an old retraction)", () => {
    expect(eligibleIds([articleFor(FACT_A), articleFor(FACT_B)], [SHARED_URL])).toEqual([]);
  });
});

// ===========================================================================
// The hook -- write side (RED on HEAD: the log holds the shared url).
// ===========================================================================
describe("N75: removeInsertedFact keys the retraction on the fact id", () => {
  it("retracting A records A's id, not the url A shares with B, and leaves B in the letter and the store", async () => {
    await insertBothSameUrlFacts();
    await remove(FACT_A.id);

    expect(coverText(), "fact A is still in the letter -- the removal did nothing").not.toContain(FACT_A.text);
    expect(coverText(), "retracting A also removed B").toContain(FACT_B.text);

    const put = lastPut();
    expect(put.declinedUrls, "A's retraction was not keyed on A's id").toContain(FACT_A.id);
    expect(put.declinedUrls, "the shared url was written to the log -- it would suppress B too").not.toContain(SHARED_URL);
    expect(put.facts.map((f) => f.id), "B left the stored set when only A was retracted").toEqual([FACT_B.id]);
    expect(store.removed).toEqual([FACT_A.id]);
  });

  it("retracting both records BOTH ids -- two retractions are not collapsed into one shared-url entry", async () => {
    await insertBothSameUrlFacts();
    await remove(FACT_A.id);
    await remove(FACT_B.id);

    expect(coverText()).not.toContain(FACT_B.text);
    expect([...lastPut().declinedUrls].sort(), "the second retraction was swallowed by the first's shared key").toEqual([FACT_A.id, FACT_B.id]);
    expect([...store.removed].sort()).toEqual([FACT_A.id, FACT_B.id]);
  });
});

// ===========================================================================
// The hook -- read side, end to end (RED on HEAD).
// ===========================================================================
describe("N75: a retraction of A does not suppress a different fact at the same url", () => {
  it("auto-insert still inserts a researched claim at A's url after A was retracted", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openResearch([ARTICLE_AT_SHARED_URL]);
    const accepted = await accept([FACT_A]);
    expect(accepted?.ok, `the setup accept was refused: ${accepted?.reason}`).toBe(true);
    expect(coverText()).toContain(FACT_A.text);

    await remove(FACT_A.id);
    expect(coverText(), "A was not retracted -- the scenario is vacuous").not.toContain(FACT_A.text);

    const result = await autoInsert();
    expect(
      result?.ok,
      `a DIFFERENT fact at A's url was suppressed by A's retraction (code: ${result?.code}, droppedRemoved: ${result?.droppedRemoved})`,
    ).toBe(true);
    expect(coverText()).toContain(ARTICLE_AT_SHARED_URL.suggestion);
    expect(coverText(), "A was reinstated by an unrequested auto-insert").not.toContain(FACT_A.text);
  });
});

describe("N75: re-adding A through the explicit accept un-declines only A", () => {
  it("accepting A again drops A's id from the log and keeps B's retraction", async () => {
    await insertBothSameUrlFacts();
    await remove(FACT_A.id);
    await remove(FACT_B.id);
    expect([...store.removed].sort(), "precondition: both retractions are on the log").toEqual([FACT_A.id, FACT_B.id]);

    const result = await accept([FACT_A]);
    expect(result?.ok, `the re-accept was refused: ${result?.reason}`).toBe(true);
    expect(coverText(), "the explicit re-accept did not put A back").toContain(FACT_A.text);
    expect(coverText(), "re-adding A also brought B back").not.toContain(FACT_B.text);

    const put = lastPut();
    expect(put.declinedUrls, "A's id is still on the log after an explicit re-accept").not.toContain(FACT_A.id);
    expect(put.declinedUrls, "re-accepting A un-declined B (it shares A's url)").toContain(FACT_B.id);
  });
});

// ===========================================================================
// CONTROLS -- green on HEAD, must stay green through the fix.
// ===========================================================================
describe("N75 control: a retraction of a research-minted fact still suppresses its own re-research", () => {
  it("does not reinstate the retracted article on a later auto-insert run", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openResearch([REAL_1]);
    const first = await autoInsert();
    expect(first?.ok, `the first auto-insert did nothing: ${first?.code}`).toBe(true);
    const inserted = probe.tailoringMap[JOB_ID]?.insertedFacts || [];
    expect(inserted.length, "nothing to retract").toBe(1);

    await remove(inserted[0].id);
    expect(coverText(), "the fact was not retracted").not.toContain(REAL_1.suggestion);

    const second = await autoInsert();
    expect(second?.ok, "the retracted article was silently reinstated").toBe(false);
    expect(second?.code).toBe("nothing-eligible");
    expect(second?.droppedRemoved, "the article was not dropped as removed").toBe(1);
    expect(coverText()).not.toContain(REAL_1.suggestion);
  });
});

describe("N75 control: a legacy url-keyed removed entry still suppresses", () => {
  it("auto-insert drops an article whose url is already in the stored log", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openResearch([REAL_1], { removed: [REAL_1.url] });
    const result = await autoInsert();
    expect(result?.ok).toBe(false);
    expect(result?.code).toBe("nothing-eligible");
    expect(coverText()).not.toContain(REAL_1.suggestion);
  });
});

describe("N75 control: a located record with no id still records its retraction (fallback)", () => {
  const LINES = ["Dear Hiring Team,", `${FACT_A.text} I build observability tooling.`, "Sincerely, Alex"];
  const noIdMap = (record) => ({
    [JOB_ID]: { status: "done", coverLetterResultLines: [...LINES], insertedFacts: [record] },
  });

  it("falls back to the url when the record has no id", async () => {
    await mount(noIdMap({ text: FACT_A.text, lineIndex: 1, offset: 0, url: SHARED_URL, title: "t" }));
    await openResearch();
    await act(async () => {
      const r = await probe.research.removeInsertedFact(JOB_ID, undefined);
      expect(r?.ok, `the removal was refused: ${r?.reason}`).toBe(true);
    });
    await drain();
    expect(coverText(), "the id-less fact was not removed").not.toContain(FACT_A.text);
    expect(lastPut().declinedUrls).toEqual([SHARED_URL]);
  });

  it("writes nothing to the log (and does not throw) when the record has neither id nor url", async () => {
    await mount(noIdMap({ text: FACT_A.text, lineIndex: 1, offset: 0 }));
    await openResearch();
    await act(async () => {
      const r = await probe.research.removeInsertedFact(JOB_ID, undefined);
      expect(r?.ok, `the removal was refused: ${r?.reason}`).toBe(true);
    });
    await drain();
    expect(coverText(), "the key-less fact was not removed").not.toContain(FACT_A.text);
    expect(lastPut().declinedUrls, "an empty key was written to the removed log").toEqual([]);
  });
});
