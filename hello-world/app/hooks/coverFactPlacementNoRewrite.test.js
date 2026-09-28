// @vitest-environment jsdom
//
// N62 Capability A -- AC-A4 and the checker's extra duplicate/orphan guard.
//
// AC-A4 (non-rewrite): changing the saved default must NOT retroactively
// rewrite a letter already written. This is a GUARD -- vacuously green on HEAD,
// because nothing wires a preference change to a re-plan today. Its power is
// proven in the 4b report by a mutant that eagerly re-plans existing letters on
// a default change; against that mutant these assertions go red. Stated as a
// guard per the AC.
//
// THE CHECKER'S EXTRA GUARD (item 5): a SECOND insertion run at a DIFFERENT
// default, against a letter that ALREADY contains the fact, must not duplicate
// it or orphan its record. On HEAD both runs resolve to "intro" (the option is
// ignored), so planCoverFacts' same-paragraph dedupe catches the re-run and the
// guard is green. The danger appears only once the default is honoured: run one
// lands the fact on the intro line; the default then changes to "current"; run
// two resolves the fact to the current-role line, finds its text is NOT in THAT
// paragraph, and re-inserts it -- a duplicated claim whose second copy is
// unrecorded (an orphan). A correct build must make the second auto-run
// idempotent for an already-inserted fact regardless of placement. Both halves
// of trap #4 are asserted: exactly one occurrence of the fact, AND every record
// locates its own text at its recorded offset.
//
// Harness mirrors app/hooks/autoInsertFactsForJob.test.js.

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
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it reinforces my interest here.",
};

function occurrences(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

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
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    ...overrides,
  };
}
function HookProbe({ initialMap, defaultPlacement }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey, defaultPlacement });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchArticles = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
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
async function mount(initialMap, defaultPlacement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap, defaultPlacement }));
  });
  await flush();
}
async function rerender(initialMapUnused, defaultPlacement) {
  // Re-render the SAME root with a new defaultPlacement -- exactly what a
  // preference change does in-session (page.js re-threads the value). State in
  // the hook (tailoringMap) is preserved.
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap: probe.tailoringMap, defaultPlacement }));
  });
  await flush();
}
async function seedResearch(job, articles) {
  researchArticles = articles;
  store = { facts: [], removed: [], revision: null };
  await act(async () => {
    probe.research.openCompanyResearch(job);
  });
  await flush();
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function insertedFacts() {
  return probe.tailoringMap[JOB_ID]?.insertedFacts || [];
}

describe("AC-A4: changing the default never rewrites a letter already written (GUARD -- proven by mutant)", () => {
  it("an existing entry's lines and inserted-fact records are byte-identical after the default changes", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() }, "intro");
    await seedResearch(JOB, [REAL_1]);
    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    // Positive control: the fact really did land, so "unchanged" below is not
    // "unchanged because nothing ever happened".
    expect(coverLines().join("\n"), "the fact was not inserted before the default change").toContain(REAL_1.suggestion);
    const linesBefore = JSON.stringify(coverLines());
    const recordsBefore = JSON.stringify(insertedFacts());

    // Change the saved default in-session. NO second insertion is triggered.
    await rerender(null, "current");

    expect(JSON.stringify(coverLines()), "changing the default rewrote an existing letter's lines").toBe(linesBefore);
    expect(JSON.stringify(insertedFacts()), "changing the default moved/rewrote existing inserted-fact records").toBe(recordsBefore);
  });
});

describe("checker guard: a second auto-run at a DIFFERENT default neither duplicates the fact nor orphans its record", () => {
  it("the fact appears exactly once and every record locates its own text after a default change + re-run", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() }, "intro");
    await seedResearch(JOB, [REAL_1]);

    // Run 1 at "intro".
    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();
    expect(coverLines().join("\n"), "run 1 did not insert the fact").toContain(REAL_1.suggestion);

    // The default changes to "current", then auto-insert fires again for the
    // same job (e.g. a re-open of the review surface).
    await rerender(null, "current");
    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const joined = coverLines().join("\n");
    expect(
      occurrences(joined, REAL_1.suggestion),
      "the fact was inserted a SECOND time at the new default -- a duplicated claim in the letter",
    ).toBe(1);

    // Trap #4: assert BOTH one occurrence AND every record locates its own text.
    const lines = coverLines();
    const records = insertedFacts();
    const forFact = records.filter((r) => r.text === REAL_1.suggestion);
    expect(forFact.length, "the re-run created a duplicate or orphaned record for the fact").toBe(1);
    for (const r of records) {
      const span = String(lines[r.lineIndex] ?? "").slice(r.offset, r.offset + String(r.text).length);
      expect(span, `record ${JSON.stringify(r.text)} does not locate its own text at its recorded offset (orphaned)`).toBe(r.text);
    }
  });
});
