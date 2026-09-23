// @vitest-environment jsdom
//
// N35 -- the accepted-fact PROVENANCE KEY, pinned at the WIRE: the request
// body `useCompanyResearch.acceptFacts` actually sends to
// /api/accepted-facts after a real click on the real dialog control.
//
// The sibling file app/components/CompanyResearchDialog.acceptedFactKeys.test.js
// pins the producer/store half (what the dialog emits, what
// `sanitizeStoredFacts` keeps). This file pins the half no single-module test
// can see: whether a provenance id survives the whole path
//
//   dialog acceptSelection() -> acceptFacts() -> planAcceptForEntry()
//     -> { facts, coverVersion.insertedFacts } -> PUT /api/accepted-facts
//
// Two things ride on that body, and both are inert today:
//   * `facts` is what `lib/acceptedFacts/factStore.js#sanitizeStoredFacts`
//     stores, so an id that never arrives is an id that is never stored;
//   * `coverVersion.insertedFacts` is written to
//     `generated_cover_letters.inserted_facts` -- the record of WHICH
//     accepted facts this letter version carries. With every id null, that
//     column says a letter contains "some facts" and can never say which.
//
// THE MEASURED DEFECT: `CompanyResearchDialog.js:126` emits `factId`, while
// `factInsertion.js:85` (`fact.id ?? null`), `factStore.js:29` (`raw.id`) and
// `useCompanyResearch.js:273` (`f?.id`) all read `id`. One producer, three
// readers, no agreement -- and no landed test distinguishes the two, because
// the three accept suites hand-build `SELECTION` fixtures carrying the
// producer's own `factId: null`.
//
// WHY THE PRIOR-FACT LEG IS IN THE SAME ARRAY AS THE NEW ONE. Each assertion
// below reads TWO entries of one `insertedFacts` array: entry 0 comes from
// the server's stored facts (it HAS an id) and entry 1 from the dialog (it
// does not). That pairing is the control and the measurement in one place --
// it makes "the seam cannot carry ids at all" and "this one producer does
// not supply one" distinguishable without a second harness.
//
// REACHABILITY. The accept is driven by clicking the real control in the real
// mounted dialog. `research.acceptFacts(...)` is called directly ONLY in the
// clearly-labelled hook controls at the bottom, which exist to answer "would
// a correct producer's id survive?" -- never to stand in for the click.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const ARTICLE = {
  id: "art-0",
  title: "Acme opens Dublin telemetry lab",
  url: "https://acme.example.com/newsroom/dublin-lab",
  source: "Acme Newsroom",
  date: "2026-02-01",
  summary: "Acme opened a telemetry lab in Dublin.",
  suggestion: "Acme opened a Dublin telemetry lab in 2026.",
};

// A fact the SERVER already holds for this application, in the shape
// `getFactsForJob` returns (post-`sanitizeFact`, so keyed `id`). The hook
// seeds it through the real GET when the dialog opens.
const STORED_FACT = {
  id: "stored-1",
  text: "Acme grew its Dublin engineering team by a third in 2025.",
  url: "https://acme.example.com/newsroom/dublin-growth",
  title: "Acme grows Dublin team",
  source: "Acme Newsroom",
  placement: "intro",
  textOrigin: "template",
};

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  // A REAL engine cover letter: the accept refuses outright without engine
  // bytes (PB1), and the docx splice really runs on this path, so a stub
  // would change which branch is measured.
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

let research = null;
let container = null;
let root = null;
let fetchCalls = [];
let acceptPromise = null;

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  return createElement(CompanyResearchDialog, {
    open: research.companyResearch.open,
    company: research.companyResearch.company,
    needsCompany: false,
    loading: false,
    error: "",
    // Built fresh on every render ON PURPOSE: a new `articles` identity is
    // what makes the dialog initialise its selection state, exactly as the
    // real research response does when it lands.
    articles: [{ ...ARTICLE }],
    warnings: [],
    busy: !!research.companyResearch.busy,
    acceptError: research.companyResearch.acceptError || "",
    acceptNotice: research.companyResearch.acceptNotice || "",
    coverLetterLines: tailoringMap[JOB_ID]?.coverLetterResultLines || [],
    onClose: () => research.closeCompanyResearch(),
    onApply: () => {},
    // Production's own binding is `onAccept={research.acceptFacts}`
    // (app/page.js:2975). The promise is kept here ONLY so the test can
    // await the work the click started -- the docx splice inside
    // `acceptFacts` is genuinely async (JSZip), so a fixed number of
    // microtask flushes after the click is a race, not a wait.
    onAccept: (selection) => {
      acceptPromise = research.acceptFacts(selection);
      return acceptPromise;
    },
    onResearch: () => {},
    onAddUrl: () => {},
  });
}

function entryWithEngineLetter() {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
  };
}

async function mount({ priorFacts = [STORED_FACT] } = {}) {
  currentPriorFacts = priorFacts;
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entryWithEngineLetter() } }));
  });
  await act(async () => {
    research.openCompanyResearch(JOB);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

let currentPriorFacts = [];

beforeEach(() => {
  research = null;
  fetchCalls = [];
  currentPriorFacts = [];
  acceptPromise = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    fetchCalls.push({ url: String(url), method, body: init.body });
    if (String(url).includes("/api/company-research")) {
      return new Response(JSON.stringify({ articles: [], warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/api/accepted-facts")) {
      if (method === "GET") {
        return new Response(JSON.stringify({ facts: currentPriorFacts, removed: [], revision: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ facts: currentPriorFacts, removed: [], revision: 4, versionSaved: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.fetch;
});

function writes() {
  return fetchCalls.filter((c) => c.url.includes("/api/accepted-facts") && c.method !== "GET");
}

function lastWriteBody() {
  const all = writes();
  expect(all.length, "no write to /api/accepted-facts was made at all").toBeGreaterThan(0);
  return JSON.parse(all[all.length - 1].body);
}

async function clickAccept() {
  const button = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Insert into cover letter",
  );
  expect(
    button,
    `no "Insert into cover letter" control in the dialog; buttons were: ${[...document.querySelectorAll("button")]
      .map((b) => JSON.stringify((b.textContent || "").trim()))
      .join(", ")}`,
  ).toBeTruthy();
  expect(button.disabled).toBe(false);
  acceptPromise = null;
  await act(async () => {
    button.click();
  });
  expect(acceptPromise, "the accept control was clicked but no accept was started").toBeTruthy();
  await act(async () => {
    await acceptPromise;
  });
}

// ---------------------------------------------------------------------------
// Harness sanity. If any of these is red, everything below is an instrument
// failure and NOT a product verdict: a refused accept sends no body at all,
// and "the id is missing from a body that was never sent" is not a finding.
// ---------------------------------------------------------------------------

describe("harness sanity", () => {
  it("the fixture is a real engine cover letter", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
  });

  it("a real click sends exactly one write, with a cover version and the merged facts", async () => {
    await mount();
    await clickAccept();
    expect(research.companyResearch.acceptError || "").toBe("");
    expect(writes()).toHaveLength(1);
    const body = lastWriteBody();
    // Vacuity guard: the assertions below iterate these arrays, so an empty
    // one would satisfy every "for each" claim by construction.
    expect(body.facts).toHaveLength(2);
    expect(body.coverVersion).toBeTruthy();
    expect(body.coverVersion.insertedFacts).toHaveLength(2);
    // Entry 0 is the fact the server already held; entry 1 is the one this
    // click accepted. Pinned by TEXT, so the id assertions below cannot be
    // satisfied by the two entries swapping places.
    expect(body.facts[0].text).toBe(STORED_FACT.text);
    expect(body.facts[1].text).toBe(ARTICLE.suggestion);
    expect(body.coverVersion.insertedFacts[0].text).toBe(STORED_FACT.text);
    expect(body.coverVersion.insertedFacts[1].text).toBe(ARTICLE.suggestion);
  });
});

// ---------------------------------------------------------------------------
// The contract.
// ---------------------------------------------------------------------------

describe("a fact accepted by clicking the dialog reaches the store with a provenance id", () => {
  it("sends a non-empty id on the accepted fact in `facts`", async () => {
    await mount();
    await clickAccept();
    const body = lastWriteBody();
    // CONTROL, in the same array: the fact that already had an id still has
    // it here, so a red on the next line is this producer's, not the seam's.
    expect(body.facts[0].id).toBe(STORED_FACT.id);
    expect(typeof body.facts[1].id, `accepted fact sent as ${JSON.stringify(body.facts[1])}`).toBe("string");
    expect(String(body.facts[1].id || "").trim()).not.toBe("");
    expect(body.facts[1].id).not.toBe(body.facts[0].id);
  });

  it("records that same id in the letter version's `insertedFacts` provenance", async () => {
    await mount();
    await clickAccept();
    const body = lastWriteBody();
    const inserted = body.coverVersion.insertedFacts;
    // CONTROL, same array: the prior fact's id is carried into the record by
    // `useCompanyResearch.js:273`, which reads `f?.id` -- the third consumer.
    expect(inserted[0].id).toBe(STORED_FACT.id);
    expect(String(inserted[1].id || "").trim(), `insertedFacts was ${JSON.stringify(inserted)}`).not.toBe("");
    // And it is the SAME id the stored fact carries, or the two halves of the
    // row disagree about which fact the letter contains.
    expect(inserted[1].id).toBe(body.facts[1].id);
  });
});

// ---------------------------------------------------------------------------
// Hook controls. These call `acceptFacts` directly, which is why they are
// controls and not the measurement: they answer "does an id supplied by a
// correct producer survive this hook?", which is the question that separates
// a producer defect from a seam that cannot carry ids at all.
// ---------------------------------------------------------------------------

describe("CONTROLS: the hook itself carries, and can lose, a provenance id", () => {
  const handBuilt = (over) => ({
    facts: [
      {
        text: "Acme opened a Santiago telemetry lab in 2026.",
        url: ARTICLE.url,
        title: ARTICLE.title,
        source: ARTICLE.source,
        placement: "intro",
        textOrigin: "template",
        ...over,
      },
    ],
    declinedUrls: [],
  });

  it("UNDER-FIRE: an id supplied on the selection reaches BOTH `facts` and `insertedFacts`", async () => {
    await mount({ priorFacts: [] });
    await act(async () => {
      await research.acceptFacts(handBuilt({ id: "art-99" }));
    });
    const body = lastWriteBody();
    expect(body.facts[0].id).toBe("art-99");
    expect(body.coverVersion.insertedFacts[0].id).toBe("art-99");
  });

  it("OVER-FIRE: with no id on the selection, the same body carries id null", async () => {
    // This is the mutation control stated as a test: it proves the two
    // assertions above CAN fail, and it is exactly the shape that ships
    // today -- which is why the landed suites, whose fixtures all look like
    // this, are green while the feature is broken.
    await mount({ priorFacts: [] });
    await act(async () => {
      await research.acceptFacts(handBuilt({ factId: null }));
    });
    const body = lastWriteBody();
    expect(body.facts[0].id).toBeUndefined();
    expect(body.coverVersion.insertedFacts[0].id).toBeNull();
  });
});

// WHAT THIS FILE CANNOT CATCH. It stops at the request body: the route, the
// RPC and the DB column are stubbed here (factStore.sanitize.test.js and the
// migration's own constraints cover that side). It also says nothing about
// WHICH id a correct build should mint -- only that one exists, is non-empty,
// differs between different facts, and is the same value in both halves of
// the payload. A build that minted a fresh random id on every accept would
// pass this file and fail the stability assertion in the sibling file; both
// are needed.
