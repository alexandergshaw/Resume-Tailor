// @vitest-environment jsdom
//
// N35 -- the accepted-fact provenance id must be UNIQUE, not merely present.
// This file is the follow-on to app/hooks/acceptFactIdSeam.test.js: that one
// pinned that an id ARRIVES at the wire at all (fixed in 351d426, `id: c.id`
// at CompanyResearchDialog.js:126). This one pins that two DIFFERENT facts
// never arrive under the SAME id.
//
// ---------------------------------------------------------------------------
// F1 -- THE COLLISION, MEASURED (not inferred)
// ---------------------------------------------------------------------------
// Article ids are minted BY POSITION, by both producers:
//     app/api/company-research/route.js:76      id: `art-${i}`
//     lib/research/companyResearchLocal.js:78   id: `art-${idx}`
// `useCompanyResearch.js:93-100` (`fetchResearchInto`) replaces the job's
// article list WHOLESALE on every research run, so run 2's first card is
// `art-0` exactly as run 1's first card was -- a different article, the same
// id. `factInsertion.js:160-173` (`mergeAcceptedFacts`) dedupes by NORMALISED
// TEXT ONLY, so both survive the merge and the PUT body carries
//     facts.map(f => f.id) === ["art-0", "art-0"]
// with two different `text` values. The same pair lands in
// `coverVersion.insertedFacts`, which is written to
// `generated_cover_letters.inserted_facts` -- the row that is supposed to say
// WHICH accepted facts a letter version carries. Under a collision it names
// one id for two distinct claims, and no reader can tell them apart.
//
// OWNER RULING (2026-09-23): non-durable ids are acceptable; COLLIDING ids are
// not. `inserted_facts` must never carry two distinct facts under one id.
//
// ---------------------------------------------------------------------------
// F4 -- THE ID-LESS ARTICLE (hardening; no producer does this today)
// ---------------------------------------------------------------------------
// `fetchResearchInto` stores `data.articles` verbatim. An article with no `id`
// therefore reaches the dialog with `a.id === undefined`, and the dialog keys
// THREE maps on it (`CompanyResearchDialog.js:86-90`): `selected`,
// `suggestions`, `targets`. Two id-less articles collapse onto the single key
// `undefined` -- `Object.fromEntries` keeps the LAST suggestion, so both cards
// render and both emit the SAME text, and `mergeAcceptedFacts`' text dedupe
// then silently discards one of the candidate's two accepted facts. The paste
// path already mints its own id (`useCompanyResearch.js:140`, `url-<ts>-<i>`),
// so arrival is where the gap is.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT
// ---------------------------------------------------------------------------
// No id FORMAT, anywhere. The owner has not chosen a scheme. A url-derived
// hash, a `${jobId}:${runNonce}:${index}`, a uuid minted on arrival -- every
// non-colliding scheme satisfies every assertion here. Only the PROPERTIES the
// ruling names are pinned: present, non-empty, distinct between distinct
// facts, and (as a separate green-today control) stable across two accepts of
// the same card inside one session. Nor is a FIX SITE assumed: articles are
// driven through the real `/api/company-research` fetch into the real hook, so
// a mint in `fetchResearchInto` and a mint in the dialog both satisfy it.
//
// REACHABILITY. Every accepted payload below comes from a real click on the
// real "Insert into cover letter" control in the really-mounted dialog, fed by
// the really-fetched article list. `research.acceptFacts(...)` is never called
// directly in this file.
//
// jsdom note: MUI's Dialog portals into document.body, never the mount
// container, so every DOM query goes through `document`.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { mergeAcceptedFacts } from "@/lib/acceptedFacts/factInsertion.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// Three research runs, each in the shape the two real producers emit: the
// first card of every run is `art-0`, because both mint by POSITION.
const RUN_1 = [
  {
    id: "art-0",
    title: "Acme opens Dublin telemetry lab",
    url: "https://acme.example.com/newsroom/dublin-lab",
    source: "Acme Newsroom",
    date: "2026-02-01",
    summary: "Acme opened a telemetry lab in Dublin.",
    suggestion: "Acme opened a Dublin telemetry lab in 2026.",
  },
];
const RUN_2 = [
  {
    id: "art-0",
    title: "Acme ships an accessibility overhaul",
    url: "https://acme.example.com/newsroom/a11y",
    source: "Acme Newsroom",
    date: "2026-03-04",
    summary: "Acme rebuilt its product for screen readers.",
    suggestion: "Acme rebuilt its product for screen readers in 2026.",
  },
];
const RUN_3 = [
  {
    id: "art-0",
    title: "Acme funds a Cork apprenticeship",
    url: "https://acme.example.com/newsroom/cork",
    source: "Acme Newsroom",
    date: "2026-04-02",
    summary: "Acme funded an apprenticeship programme in Cork.",
    suggestion: "Acme funded a Cork apprenticeship programme in 2026.",
  },
];

// F4's pair: two articles with NO `id` key at all.
const NO_ID_A = {
  title: "Acme publishes its carbon ledger",
  url: "https://acme.example.com/newsroom/carbon",
  source: "Acme Newsroom",
  date: "2026-04-09",
  summary: "Acme published an audited carbon ledger.",
  suggestion: "Acme published an audited carbon ledger in 2026.",
};
const NO_ID_B = {
  title: "Acme doubles its apprenticeship intake",
  url: "https://acme.example.com/newsroom/intake",
  source: "Acme Newsroom",
  date: "2026-04-11",
  summary: "Acme doubled the size of its apprentice cohort.",
  suggestion: "Acme doubled its apprentice cohort in 2026.",
};
// The SAME two articles plus ids and nothing else, so the only difference
// between an F4 red and its green control is the missing id.
const WITH_ID_A = { ...NO_ID_A, id: "art-0" };
const WITH_ID_B = { ...NO_ID_B, id: "art-1" };
const RUN_NO_IDS = [NO_ID_A, NO_ID_B];
const RUN_TWO_IDS = [WITH_ID_A, WITH_ID_B];

// PRE-EXISTING, UNRELATED LIMIT, measured here and reported rather than
// tested: accepting TWO cards in ONE click is refused outright today. Both
// facts resolve to the DEFAULT placement (the accept path never lets the
// candidate change it -- `targets` is only editable in the two-step "arrange"
// flow behind `onApply`), so `planCoverFacts` writes two edits against the
// same paragraph and the second edit's `before` is the FIRST edit's output.
// `factDocx.js:33` then finds `lines[edit.lineIndex] !== edit.before`, returns
// `applied: false, reason: "stale-plan"`, and `useCompanyResearch` surfaces
// NO_ENGINE_BYTES_REASON. So every wire-level assertion in this file accepts
// ONE card per click -- otherwise an F4 red would be this refusal wearing an
// id defect's clothes, and no correct id scheme could ever turn it green.

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  // A REAL engine cover letter: the accept refuses outright without engine
  // bytes (PB1) and the docx splice really runs, so a stub would change which
  // branch is measured.
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

// --- the fake server -------------------------------------------------------
// It keeps state ACROSS mounts, because that is what makes "two sessions" a
// real scenario: session 2's GET must return exactly what session 1's PUT
// stored. The facts it keeps are run through the REAL `sanitizeStoredFacts`,
// the same function app/api/accepted-facts/route.js stores through, so the
// prior-fact shape here is the shape production really reads back.

let store = { facts: [], removed: [], revision: null };
let researchQueue = [];
let putBodies = [];
let research = null;
let container = null;
let root = null;
let acceptPromise = null;
let lastSelection = null;

const EMPTY = [];

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  // The article list comes from the HOOK's own state, populated by the real
  // `/api/company-research` fetch -- not from a prop the test controls. That
  // is what makes `fetchResearchInto` a legitimate fix site for F4.
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
    // Production binds `onAccept={research.acceptFacts}` (app/page.js:2975).
    // The selection is recorded and the promise kept ONLY so the test can
    // read what the dialog emitted and await the genuinely-async docx splice.
    onAccept: (selection) => {
      lastSelection = selection;
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

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchQueue = [];
  putBodies = [];
  research = null;
  acceptPromise = null;
  lastSelection = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) {
      return json({ articles: researchQueue.shift() || [], warnings: [] });
    }
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
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

// One browser session: a fresh mount, a fresh research run, the dialog opened
// the way the preview opens it. `researchStartedRef` is per-hook-instance, so
// a new mount really does re-run research -- which is precisely how the
// article list gets replaced wholesale between sessions.
async function openSession(articles) {
  researchQueue.push(articles);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entryWithEngineLetter() } }));
  });
  await act(async () => {
    research.openCompanyResearch(JOB);
  });
  await flush();
  const got = research.researchByJob[JOB_ID]?.articles || [];
  expect(got, "the research run never reached the hook -- instrument failure, not a product verdict").toHaveLength(
    articles.length,
  );
}

async function closeSession() {
  await act(async () => root.unmount());
  container.remove();
  root = null;
  container = null;
}

function acceptControl() {
  return [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Insert into cover letter",
  );
}

// A real click on the real control, with the accept allowed to be refused.
// Used only where what is measured is what the DIALOG emitted, which happens
// strictly before the hook can refuse anything.
async function clickAcceptRaw() {
  const button = acceptControl();
  expect(
    button,
    `no "Insert into cover letter" control; buttons were: ${[...document.querySelectorAll("button")]
      .map((b) => JSON.stringify((b.textContent || "").trim()))
      .join(", ")}`,
  ).toBeTruthy();
  expect(button.disabled).toBe(false);
  acceptPromise = null;
  lastSelection = null;
  await act(async () => {
    button.click();
  });
  expect(acceptPromise, "the accept control was clicked but no accept was started").toBeTruthy();
  await act(async () => {
    await acceptPromise;
  });
  expect(lastSelection, "the control was clicked but the dialog emitted no selection").toBeTruthy();
}

async function clickAccept() {
  await clickAcceptRaw();
  expect(research.companyResearch.acceptError || "", "the accept was refused; nothing below is a verdict").toBe("");
}

async function runSessionAndAccept(articles) {
  await openSession(articles);
  await clickAccept();
  await closeSession();
}

function lastBody() {
  expect(putBodies.length, "no write to /api/accepted-facts was made at all").toBeGreaterThan(0);
  return putBodies[putBodies.length - 1];
}

// The per-article suggestion editors, read off the DOM. MUI's multiline
// TextField renders a hidden shadow textarea for autosizing next to the real
// one; only the real one is returned. Canaried below against a run whose
// articles DO carry ids.
function suggestionFieldValues() {
  return [...document.querySelectorAll("textarea")]
    .filter((t) => t.getAttribute("aria-hidden") !== "true")
    .map((t) => t.value);
}

// --- the class guard, as a pure function so it can be proved both ways ------
// Returns the ids under which two or more DISTINCT texts were filed. This is
// the ruling stated mechanically: it is indifferent to scheme, and it does not
// fire when the same fact legitimately appears twice under one id.
function collidingIds(list) {
  const byId = new Map();
  for (const f of list || []) {
    const key = String(f?.id ?? "");
    if (!byId.has(key)) byId.set(key, new Set());
    byId.get(key).add(String(f?.text ?? "").trim());
  }
  return [...byId.entries()].filter(([, texts]) => texts.size > 1).map(([id]) => id);
}

// Every property the ruling names, over one list. Non-vacuity comes FIRST:
// "the ids differ" is trivially true of a list with one entry or none, so the
// expected length and the distinctness of the TEXTS are asserted before any id
// is looked at.
function expectDistinctProvenance(list, expectedTexts, label) {
  expect(Array.isArray(list), `${label} is not an array: ${JSON.stringify(list)}`).toBe(true);
  expect(list.map((f) => f.text), `${label} texts`).toEqual(expectedTexts);
  expect(new Set(expectedTexts).size, `${label}: the fixture texts are not distinct -- vacuous test`).toBe(
    expectedTexts.length,
  );
  for (const f of list) {
    expect(typeof f.id, `${label} entry sent as ${JSON.stringify(f)}`).toBe("string");
    expect(String(f.id || "").trim(), `${label} entry sent as ${JSON.stringify(f)}`).not.toBe("");
  }
  expect(collidingIds(list), `${label} files two different facts under one id: ${JSON.stringify(list)}`).toEqual([]);
  expect(new Set(list.map((f) => f.id)).size, `${label} ids: ${JSON.stringify(list.map((f) => f.id))}`).toBe(
    list.length,
  );
}

// ---------------------------------------------------------------------------
// Harness sanity. If any of these is red, every verdict below is an instrument
// failure: a refused accept sends no body, and "the ids collide in a body that
// was never sent" is not a finding.
// ---------------------------------------------------------------------------

describe("harness sanity", () => {
  it("the fixture is a real engine cover letter", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
  });

  it("one session, one click, one write carrying that run's fact", async () => {
    await runSessionAndAccept(RUN_1);
    expect(putBodies).toHaveLength(1);
    const body = lastBody();
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].text).toBe(RUN_1[0].suggestion);
    expect(String(body.facts[0].id || "").trim()).not.toBe("");
    expect(body.coverVersion).toBeTruthy();
    expect(body.coverVersion.insertedFacts).toHaveLength(1);
  });

  it("CANARY: the suggestion-field reader really returns one distinct value per card", async () => {
    // Known positive for `suggestionFieldValues`. Without this, F4's DOM red
    // would be equally explained by a reader that returns [] or one entry for
    // every page, and the collapse it claims to see would be its own bug.
    await openSession(RUN_TWO_IDS);
    expect(suggestionFieldValues()).toEqual(RUN_TWO_IDS.map((a) => a.suggestion));
    await closeSession();
  });

  it("CONTROL: the collision guard fires on a hand-built collision and stays quiet otherwise", () => {
    // Both directions, so a guard that returned [] for everything -- or one
    // that flagged everything -- fails here rather than passing silently in
    // the assertions above.
    expect(collidingIds([{ id: "a", text: "one" }, { id: "b", text: "two" }])).toEqual([]);
    expect(collidingIds([{ id: "a", text: "one" }, { id: "a", text: "two" }])).toEqual(["a"]);
    // Two id-less facts are a collision under the empty key, which is what an
    // `id: null` producer would leave behind.
    expect(collidingIds([{ id: null, text: "one" }, { text: "two" }])).toEqual([""]);
    // And the SAME fact twice under one id is not a collision -- the guard
    // measures distinct claims, not duplicate rows.
    expect(collidingIds([{ id: "a", text: "one" }, { id: "a", text: "one" }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F1: article ids are minted by position and the list is replaced wholesale,
// so session N's `art-0` is a different article from session N-1's `art-0`.
// ---------------------------------------------------------------------------

describe("F1: facts accepted in different research sessions never share an id", () => {
  it("the PUT body carries two DISTINCT ids for the two accepted facts", async () => {
    await runSessionAndAccept(RUN_1);
    await runSessionAndAccept(RUN_2);
    expect(putBodies).toHaveLength(2);
    expectDistinctProvenance(lastBody().facts, [RUN_1[0].suggestion, RUN_2[0].suggestion], "body.facts");
  });

  it("the letter version's insertedFacts provenance carries two DISTINCT ids", async () => {
    // The half the ruling names by column: `generated_cover_letters.inserted_facts`
    // is the record of WHICH facts this letter version contains, and under a
    // collision it names one id for two claims.
    await runSessionAndAccept(RUN_1);
    await runSessionAndAccept(RUN_2);
    expectDistinctProvenance(
      lastBody().coverVersion.insertedFacts,
      [RUN_1[0].suggestion, RUN_2[0].suggestion],
      "coverVersion.insertedFacts",
    );
  });

  it("the ids survive the store the route writes through", async () => {
    // The two assertions above stop at the request body. This one runs the
    // accepted set through the REAL `sanitizeStoredFacts` -- the function
    // app/api/accepted-facts/route.js stores through -- because an id that is
    // distinct on the wire and clipped to a shared prefix in the store would
    // satisfy them and still collide in the column.
    await runSessionAndAccept(RUN_1);
    await runSessionAndAccept(RUN_2);
    expectDistinctProvenance(
      sanitizeStoredFacts(lastBody().facts),
      [RUN_1[0].suggestion, RUN_2[0].suggestion],
      "sanitizeStoredFacts(body.facts)",
    );
  });

  it("CLASS GUARD: no id in a three-session accepted set files two different facts", async () => {
    // Proved against a member the guard has not seen -- RUN_3 is a third
    // session, not the originating pair -- so a fix that only de-duplicated
    // "the second run" fails here. This guard is kept ALONGSIDE the specific
    // assertions above, not instead of them: it cannot see a MISSING id (an
    // all-null set collides under one key and is caught) but it also cannot
    // see a WRONG-but-unique id, which no test here can.
    await runSessionAndAccept(RUN_1);
    await runSessionAndAccept(RUN_2);
    await runSessionAndAccept(RUN_3);
    const body = lastBody();
    const texts = [RUN_1[0].suggestion, RUN_2[0].suggestion, RUN_3[0].suggestion];
    expect(body.facts.map((f) => f.text), "three sessions did not accumulate three facts").toEqual(texts);
    expect(collidingIds(body.facts), `ids were ${JSON.stringify(body.facts.map((f) => f.id))}`).toEqual([]);
    expect(collidingIds(body.coverVersion.insertedFacts)).toEqual([]);
  });

  it("CONTROL (over-fires): the accepted set really does accumulate across sessions", async () => {
    // Green today, and load-bearing. Every red above would be equally well
    // explained by a merge that DROPPED the earlier fact -- in which case the
    // ids would trivially be distinct and the bug would be somewhere else.
    // This pins that both facts are present and that the collision is real.
    await runSessionAndAccept(RUN_1);
    await runSessionAndAccept(RUN_2);
    const body = lastBody();
    expect(body.facts).toHaveLength(2);
    expect(new Set(body.facts.map((f) => f.text)).size).toBe(2);
    expect(body.coverVersion.insertedFacts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// F4: an article that arrives with no id. No producer does this today, so this
// is hardening -- but the failure mode is silent DATA LOSS, not a crash: the
// candidate checks two cards, sees one of them, and the other never reaches
// the letter.
// ---------------------------------------------------------------------------

describe("F4: articles that arrive without an id", () => {
  const NO_ID_TEXTS = [NO_ID_A.suggestion, NO_ID_B.suggestion];

  it("two id-less articles accepted in two sessions reach the store with distinct ids", async () => {
    // One card per click, for the placement reason recorded at the fixtures.
    await runSessionAndAccept([NO_ID_A]);
    await runSessionAndAccept([NO_ID_B]);
    expectDistinctProvenance(lastBody().facts, NO_ID_TEXTS, "body.facts");
  });

  it("both reach the letter version's insertedFacts provenance", async () => {
    await runSessionAndAccept([NO_ID_A]);
    await runSessionAndAccept([NO_ID_B]);
    expectDistinctProvenance(lastBody().coverVersion.insertedFacts, NO_ID_TEXTS, "coverVersion.insertedFacts");
  });

  it("the dialog's per-card editors do not collapse onto one key", async () => {
    // The user-visible half of F4: `suggestions`/`targets`/`selected` are
    // keyed on `a.id` (CompanyResearchDialog.js:86-90), so two `undefined` ids
    // share one entry and BOTH cards render the LAST article's suggestion.
    // Read off the DOM rather than off state, because this field is the one
    // the candidate reads and edits.
    await openSession(RUN_NO_IDS);
    expect(suggestionFieldValues()).toEqual(NO_ID_TEXTS);
    await closeSession();
  });

  it("the payload the dialog emits carries two distinct texts, one per card", async () => {
    // Pinned at the dialog's own output as well, because the wire reds alone
    // are ambiguous: `mergeAcceptedFacts`' text dedupe would collapse two
    // identical texts there even if the dialog HAD emitted two distinct rows.
    // This says the two rows were never distinct in the first place.
    //
    // `clickAcceptRaw` is used on purpose: with both cards in one click the
    // accept is refused for the unrelated placement reason above, and that
    // refusal happens strictly AFTER the dialog has emitted this payload.
    await openSession(RUN_NO_IDS);
    await clickAcceptRaw();
    expect(lastSelection.facts).toHaveLength(2);
    expect(lastSelection.facts.map((f) => f.text)).toEqual(NO_ID_TEXTS);
    expect(collidingIds(lastSelection.facts), `dialog emitted ${JSON.stringify(lastSelection.facts)}`).toEqual([]);
    await closeSession();
  });

  it("CONTROL (under-fires): the identical pair WITH ids already yields two distinct facts", async () => {
    // WITH_ID_A/B are NO_ID_A/B plus an id and nothing else, driven through
    // the identical two-session path. GREEN TODAY. It proves the reds above
    // are about the missing id, and not about a hook, a merge or a store that
    // can only ever carry one fact.
    await runSessionAndAccept([WITH_ID_A]);
    await runSessionAndAccept([WITH_ID_B]);
    expectDistinctProvenance(lastBody().facts, NO_ID_TEXTS, "body.facts");
  });

  it("CONTROL (mechanism): the merge collapses equal texts and keeps distinct ones", () => {
    // Why a collapsed EDITOR becomes a lost FACT, isolated from the defect so
    // this control stays green before and after the fix. `mergeAcceptedFacts`
    // is identity-by-normalised-text: two cards that emit the same string are
    // one fact by the time the PUT is built, whatever their ids say. Both
    // directions, so a merge that deduped everything -- or nothing -- fails
    // here instead of quietly explaining an F4 red that was never about ids.
    expect(mergeAcceptedFacts([], [{ text: "Acme did a thing." }, { text: "Acme did a thing." }])).toHaveLength(1);
    expect(mergeAcceptedFacts([], [{ text: "Acme did a thing." }, { text: "Acme did another." }])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The counterweight. Distinctness alone is satisfied by a fresh random id on
// every accept, which would leave id-based dedupe as inert as it is today.
// ---------------------------------------------------------------------------

describe("CONTROL: an id is stable across two accepts of the same card in one session", () => {
  it("a second click on the unchanged selection emits the same id", async () => {
    // GREEN TODAY (`art-0` both times) and stated as a control, not as
    // coverage: it exists so that a fix which mints the id inside
    // `acceptSelection()` -- per click, from Date.now() or a counter -- is
    // caught instead of passing the distinctness tests above.
    //
    // Read off the DIALOG's emitted selection rather than the PUT body on
    // purpose: `mergeAcceptedFacts` and `planCoverFacts` both dedupe the
    // second accept away by text, so the second body would echo the STORED id
    // and could never show a freshly-minted one.
    await openSession(RUN_1);
    await clickAccept();
    const first = lastSelection.facts.map((f) => f.id);
    expect(first).toHaveLength(1);
    // Non-vacuity: `[undefined] === [undefined]` would agree perfectly and
    // prove nothing, so the id must be a real value before it is compared.
    expect(String(first[0] || "").trim()).not.toBe("");
    lastSelection = null;
    await clickAccept();
    expect(lastSelection.facts.map((f) => f.id)).toEqual(first);
    await closeSession();
  });
});

// WHAT THIS FILE CANNOT CATCH, stated so the next reader does not over-trust
// it. (1) It stops at the request body and at `sanitizeStoredFacts`; the route,
// the RPC and the `inserted_facts` column are not exercised. (2) It cannot see
// a WRONG but unique id -- an id that is distinct and non-empty but points at
// the other article's url -- because nothing here knows which id is "right" by
// design (no format is pinned). (3) It says nothing about durability: an id
// that changes between sessions for the same article is explicitly allowed by
// the 2026-09-23 ruling, so the stability control above is scoped to one
// session only, and a scheme carrying a per-run nonce passes this whole file.
