// @vitest-environment jsdom
//
// N56 half (a) -- accepting two or more company facts in ONE action must land
// EVERY fact, in the letter's text AND in its bytes, in the order the cards
// appear on screen, with the all-or-nothing guarantee intact. On HEAD this
// always fails: two cards take the same default placement (`intro`), so
// planCoverFacts emits two edits against the SAME paragraph mutating one shared
// array (the 2nd edit's `before` is the 1st's OUTPUT), and factDocx.js refuses
// the whole splice as `stale-plan` -- surfaced to the candidate as the false
// "saved file is missing".
//
// REACHABILITY (brief rule 5; a source scan can be satisfied by unreachable
// code -- proven twice this week). Every accept below is a REAL click on the
// real "Insert into cover letter" control of the really-mounted
// CompanyResearchDialog, over the real useCompanyResearch hook, with articles
// arriving through the real `/api/company-research` fetch and cards ticked as
// the dialog pre-selects them. `research.acceptFacts(...)` is never called
// directly for the behavioural legs. Model: acceptFactIdDerivation.test.js.
// jsdom note: MUI's Dialog portals to document.body, never the mount container.
//
// INVERTIBILITY IS A HARD CONSTRAINT (N61, blocked on this chunk). Each fact
// must be inserted VERBATIM, single-space separated, with NO lead-in, so each
// fact stays an individually excisable substring. A coalescing that added a
// lead-in ("In fact, ") would pass "both facts present" and still break N61's
// one-click removal -- so a lead-in must FAIL a test here, not be caught in
// review. The invertibility leg does exactly that.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { planAcceptForEntry } from "@/lib/acceptedFacts/factInsertion.js";
import { applyCoverDocxEdits } from "@/lib/acceptedFacts/factDocx.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// Two facts whose SCREEN order (card order = fetch order) is the OPPOSITE of
// both their alphabetical order AND their length order, so an implementation
// that happens to sort them cannot pass the order leg by coincidence.
const F1 = "Zeta shipped a compact release."; // first on screen; starts 'Z'; short
const F2 =
  "Alfa announced a very long, detailed, multi-year platform investment programme running through this decade."; // second; 'A'; long
const F3 = "Mira opened a second research site in Cork this spring.";

function card(id, suggestion, url) {
  return {
    id,
    title: `${suggestion.slice(0, 18)}…`,
    url,
    source: "Newsroom",
    date: "2026-02-01",
    summary: "A thing happened.",
    suggestion,
  };
}
const TWO_CARDS = [
  card("art-a", F1, "https://news.example.com/one"),
  card("art-b", F2, "https://news.example.com/two"),
];
const THREE_CARDS = [...TWO_CARDS, card("art-c", F3, "https://news.example.com/three")];

const ABSENT_PARAGRAPH =
  "This entire paragraph was typed by hand and appears nowhere in the generated cover letter document at all.";

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  // A REAL engine cover letter: the accept refuses outright without engine
  // bytes and the docx splice really runs, so a stub would change which branch
  // every assertion below measures.
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

let store = { facts: [], removed: [], revision: null };
let researchQueue = [];
let putBodies = [];
let research = null;
let currentMap = null;
let container = null;
let root = null;
let acceptPromise = null;
let lastSelection = null;
const EMPTY = [];

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  currentMap = tailoringMap; // read the live map back instead of guessing it
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
      lastSelection = selection;
      acceptPromise = research.acceptFacts(selection);
      return acceptPromise;
    },
    onResearch: () => {},
    onAddUrl: () => {},
  });
}

function entryEngine(over = {}) {
  return {
    status: "done",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    ...over,
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
  currentMap = null;
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

async function openSession(articles, entry = entryEngine()) {
  researchQueue.push(articles);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry } }));
  });
  await act(async () => {
    research.openCompanyResearch(JOB);
  });
  await flush();
  const got = hookArticles();
  expect(got.length, "the research run never reached the hook -- instrument failure").toBe(articles.length);
}

function hookArticles() {
  return research?.researchByJob?.[JOB_ID]?.articles || [];
}
function checkboxes() {
  return [...document.querySelectorAll('input[type="checkbox"]')];
}
function acceptControl() {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Insert into cover letter");
}
function suggestionFieldValues() {
  return [...document.querySelectorAll("textarea")]
    .filter((t) => t.getAttribute("aria-hidden") !== "true")
    .map((t) => t.value);
}

// A real click on the real control; refusal allowed (the caller decides what
// the outcome must be).
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
  await flush(2);
}

function liveLines() {
  return currentMap[JOB_ID].coverLetterResultLines || [];
}
function liveText() {
  return liveLines().join("\n");
}
function count(hay, needle) {
  return hay.split(needle).length - 1;
}
function lineWith(text) {
  return liveLines().find((l) => l.includes(text));
}

// Read the SERIALIZED docx's plain text (unzip word/document.xml, strip tags).
// base64 of a zip says nothing about its text, so `b64.includes(FACT)` would be
// green for every input.
async function docxText(b64) {
  if (!b64) return "";
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const xml = await zip.file("word/document.xml").async("string");
  return xml.replace(/<[^>]+>/g, "");
}

const norm = (s) => String(s || "").replace(/\s{2,}/g, " ").trim();
// The inverse of `insertFactText`: excise the fact text with one adjoining
// space and re-collapse whitespace (exactly what N61's one-click removal does).
function excise(line, factText) {
  let out = String(line);
  if (out.includes(` ${factText}`)) out = out.replace(` ${factText}`, "");
  else if (out.includes(`${factText} `)) out = out.replace(`${factText} `, "");
  else out = out.replace(factText, "");
  return norm(out);
}

// ---------------------------------------------------------------------------
// Harness sanity. If any of these is red every verdict is an instrument
// failure, not a product finding.
// ---------------------------------------------------------------------------

describe("harness sanity", () => {
  it("the fixture is a real engine cover letter and neither fact is already in it", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
    const text = ENGINE_LINES.join("\n");
    for (const f of [F1, F2, F3]) expect(text, `fact already present: ${f}`).not.toContain(f);
  });

  it("CANARY: both cards render, both are pre-ticked, and the order fixture is sort-proof", async () => {
    await openSession(TWO_CARDS);
    expect(suggestionFieldValues()).toEqual([F1, F2]);
    expect(checkboxes().map((b) => b.checked)).toEqual([true, true]);
    // Screen order is F1, F2 -- deliberately the opposite of alpha and length.
    expect([F1, F2].slice().sort()).toEqual([F2, F1]);
    expect(F1.length).toBeLessThan(F2.length);
  });

  it("CONTROL: excise() is the true inverse of a verbatim single-space insert", () => {
    // Proves the invertibility instrument itself: a verbatim join round-trips,
    // and a lead-in does NOT (excising the fact leaves the orphaned connective).
    const original = "I want this role. And here is more.";
    const verbatim = "I want this role. Zeta shipped. Alfa grew. And here is more.";
    expect(excise(excise(verbatim, "Zeta shipped."), "Alfa grew.")).toBe(norm(original));
    const withLeadIn = "I want this role. In fact, Zeta shipped. Alfa grew. And here is more.";
    expect(excise(excise(withLeadIn, "Zeta shipped."), "Alfa grew.")).not.toBe(norm(original));
  });
});

// ---------------------------------------------------------------------------
// Half (a) -- RED on HEAD.
// ---------------------------------------------------------------------------

describe("two cards in one click land both facts (AC-1, AC-2, AC-3)", () => {
  it("AC-1: not refused, and both suggestion texts are in the letter's lines, each exactly once", async () => {
    await openSession(TWO_CARDS);
    const before = liveLines().length;
    await clickAcceptRaw();

    expect(
      research.companyResearch.acceptError || "",
      "the two-card accept was refused -- this is the N56 defect",
    ).toBe("");
    const text = liveText();
    expect(count(text, F1), "F1 is missing or duplicated in the letter text").toBe(1);
    expect(count(text, F2), "F2 is missing or duplicated in the letter text").toBe(1);
    // AC-3: facts land INSIDE existing paragraphs, never as new lines.
    expect(liveLines().length, "the accept added or removed a paragraph").toBe(before);
  });

  it("AC-2: the same click changes the BYTES and the serialized docx carries BOTH facts", async () => {
    await openSession(TWO_CARDS);
    const bytesBefore = currentMap[JOB_ID].coverLetterDocxB64;
    expect(bytesBefore).toBe(ENGINE_B64);
    await clickAcceptRaw();
    expect(research.companyResearch.acceptError || "").toBe("");

    const bytesAfter = currentMap[JOB_ID].coverLetterDocxB64;
    // A text-only fix that leaves the bytes untouched is WORSE than the current
    // refusal (the downloaded letter would silently disagree with the screen).
    expect(bytesAfter, "the bytes did not change -- text-only success is a regression").not.toBe(bytesBefore);
    const served = await docxText(bytesAfter);
    expect(served, "the serialized docx is missing F1").toContain(F1);
    expect(served, "the serialized docx is missing F2").toContain(F2);
  });
});

describe("order and count with two and three cards (AC-4, AC-6)", () => {
  it("AC-4: same-paragraph facts read in SCREEN order, not sorted order", async () => {
    await openSession(TWO_CARDS);
    const screen = suggestionFieldValues(); // [F1, F2] as shown
    await clickAcceptRaw();
    expect(research.companyResearch.acceptError || "").toBe("");

    const para = lineWith(F1);
    expect(para, "F1 and F2 did not coalesce into one paragraph").toBe(lineWith(F2));
    // The screen order is [F1, F2]; the paragraph must read F1 before F2.
    expect(screen).toEqual([F1, F2]);
    expect(
      para.indexOf(F1) < para.indexOf(F2),
      `paragraph reads out of screen order: ${JSON.stringify(para)}`,
    ).toBe(true);
  });

  it("AC-6: three cards in one click behave like two -- all three land, each once, in screen order", async () => {
    await openSession(THREE_CARDS);
    const screen = suggestionFieldValues();
    expect(screen).toEqual([F1, F2, F3]);
    await clickAcceptRaw();
    expect(research.companyResearch.acceptError || "").toBe("");

    const text = liveText();
    for (const f of [F1, F2, F3]) expect(count(text, f), `wrong count for ${f}`).toBe(1);
    const para = lineWith(F1);
    expect(para.indexOf(F1)).toBeLessThan(para.indexOf(F2));
    expect(para.indexOf(F2)).toBeLessThan(para.indexOf(F3));
  });
});

describe("no lead-in / per-fact invertibility (hard constraint for N61)", () => {
  it("each fact is a verbatim, single-space-separated, individually excisable substring -- no lead-in", async () => {
    await openSession(TWO_CARDS);
    await clickAcceptRaw();
    expect(research.companyResearch.acceptError || "").toBe("");

    const para = lineWith(F1);
    const original = ENGINE_LINES[liveLines().indexOf(para)];
    // The engine's original paragraph at that index, before insertion.
    const originalLine = ENGINE_LINES.find((l) => excise(excise(para, F2), F1) === norm(l)) || "";

    // Excising both facts (each with one adjoining space) and re-collapsing
    // whitespace must reproduce the ORIGINAL paragraph. A lead-in would leave an
    // orphaned connective and this would fail. (originalLine is discovered by
    // the round-trip itself, so the assertion is that SUCH a line exists.)
    expect(originalLine, "excising the facts did not reproduce any original engine paragraph -- a lead-in was added").not.toBe("");
    // Belt and braces: none of weaveSources' known lead-ins leaked into the accept path.
    for (const leadIn of ["In fact, ", "Beyond that, ", "Beyond my day-to-day work, ", "Outside the classroom, "]) {
      expect(para, `accept path borrowed the weave lead-in ${JSON.stringify(leadIn)}`).not.toContain(leadIn);
    }
    // And the two facts are separated by exactly one space (screen order F1,F2).
    expect(para).toContain(`${F1} ${F2}`);
    void original;
  });
});

describe("re-clicking the same selection adds nothing (AC-7, M1 dedupe)", () => {
  it("a second click on the same ticked cards does not duplicate anything", async () => {
    await openSession(TWO_CARDS);
    // First accept must succeed for this to mean anything (RED on HEAD: it does not).
    await clickAcceptRaw();
    expect(research.companyResearch.acceptError || "", "first accept was refused -- vacuous until AC-1 passes").toBe("");
    const paraAfterFirst = lineWith(F1);
    const writesAfterFirst = putBodies.length;

    // The dialog stays open with the same cards ticked; click again.
    await clickAcceptRaw();
    expect(research.companyResearch.acceptError || "").toBe("");

    const text = liveText();
    expect(count(text, F1), "a re-click duplicated F1").toBe(1);
    expect(count(text, F2), "a re-click duplicated F2").toBe(1);
    expect(lineWith(F1), "the paragraph text changed on a no-op re-click").toBe(paraAfterFirst);
    // The second click really happened (a write, or a deduped no-op write).
    expect(putBodies.length).toBeGreaterThanOrEqual(writesAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// GREEN guards -- what half (a) must NOT break. Stated and counted as guards.
// ---------------------------------------------------------------------------

describe("all-or-nothing within one click (AC-15) -- load-bearing once AC-1 passes", () => {
  it("if a fact's paragraph is absent from the docx, NONE of the group is applied and it is refused", async () => {
    // Both cards target the intro paragraph, which is present in the lines but
    // (mutated) absent from the docx -> the splice cannot apply -> the whole
    // click is refused, never a partial that silently drops the fact it could
    // not place. On HEAD this is refused too (stale-plan); it becomes
    // load-bearing the instant AC-1 passes.
    const lines = [...ENGINE_LINES];
    lines[1] = ABSENT_PARAGRAPH;
    await openSession(TWO_CARDS, entryEngine({ coverLetterResultLines: lines }));
    await clickAcceptRaw();

    expect(research.companyResearch.acceptError || "", "the unplaceable group was NOT refused").not.toBe("");
    const text = liveText();
    expect(text, "F1 leaked in despite the group being unplaceable").not.toContain(F1);
    expect(text, "F2 leaked in despite the group being unplaceable").not.toContain(F2);
    expect(currentMap[JOB_ID].coverLetterDocxB64, "the bytes were mutated on a refusal").toBe(ENGINE_B64);
  });
});

describe("a refusal writes nothing (AC-13) -- GREEN non-regression", () => {
  it("R1 (bytes missing) is refused before any PUT, and the entry is untouched", async () => {
    const entry = entryEngine({ coverLetterDocxB64: "", pristineCoverLines: [...ENGINE_LINES], edited: { resume: false, cover: false } });
    const linesBefore = [...entry.coverLetterResultLines];
    await openSession(TWO_CARDS, entry);
    await clickAcceptRaw();

    expect(research.companyResearch.acceptError || "", "R1 did not refuse").not.toBe("");
    expect(putBodies.length, "a refusal spent a write / rate-limit token").toBe(0);
    const live = currentMap[JOB_ID];
    expect(live.coverLetterResultLines).toEqual(linesBefore);
    expect(live.coverLetterDocxB64 ?? "").toBe("");
    expect(live.pristineCoverLines).toEqual([...ENGINE_LINES]);
    expect(live.edited).toEqual({ resume: false, cover: false });
  });
});

describe("facts at DIFFERENT paragraphs still land in their own paragraphs (AC-5) -- over-fire control", () => {
  it("PLANNER: two placements resolve to DIFFERENT line indices, neither coalesced into the other", () => {
    // The over-fire control on AC-4: a 'fix' that coalesced every accepted fact
    // into the opening paragraph regardless of placement would fail here.
    const GREETING = "Dear Hiring Manager,";
    const INTRO = "I am writing to apply for the Staff Engineer position at Acme. I have deep platform experience.";
    const ROLE = "In my current role at Acme, I lead a small platform team.";
    const SIGN = "Sincerely,";
    const entry = { status: "done", coverLetterResultLines: [GREETING, INTRO, ROLE, SIGN] };
    const plan = planAcceptForEntry(entry, {
      facts: [
        { id: "x", text: "Acme opened a Dublin lab.", placement: "intro" },
        { id: "y", text: "Acme also opened a Berlin office.", placement: "current" },
      ],
    });
    expect(plan.cover.edits).toHaveLength(2);
    const [a, b] = plan.cover.edits;
    expect(a.lineIndex, "two placements coalesced onto ONE line").not.toBe(b.lineIndex);
    expect(plan.cover.lines[1]).toContain("Acme opened a Dublin lab.");
    expect(plan.cover.lines[2]).toContain("Acme also opened a Berlin office.");
    // The intro fact must NOT have landed on the current-role line and vice versa.
    expect(plan.cover.lines[1]).not.toContain("Berlin office");
    expect(plan.cover.lines[2]).not.toContain("Dublin lab");
  });

  it("APPLY: two edits at different real paragraphs both splice into the docx", async () => {
    // Real bytes, real lines. Probe Q3 in the AC measured this green on HEAD.
    const idxs = [];
    for (let i = 1; i < ENGINE_LINES.length && idxs.length < 2; i += 1) {
      if (ENGINE_LINES[i].trim().length > 25 && !idxs.some((j) => ENGINE_LINES[j] === ENGINE_LINES[i])) idxs.push(i);
    }
    expect(idxs.length, "the engine letter did not yield two distinct paragraphs").toBe(2);
    const [i0, i1] = idxs;
    const edits = [
      { lineIndex: i0, before: ENGINE_LINES[i0], after: `${ENGINE_LINES[i0]} AlphaFactOne here.` },
      { lineIndex: i1, before: ENGINE_LINES[i1], after: `${ENGINE_LINES[i1]} BetaFactTwo here.` },
    ];
    const res = await applyCoverDocxEdits(ENGINE_B64, ENGINE_LINES, edits);
    expect(res.applied, `applyCoverDocxEdits refused: ${res.reason}`).toBe(true);
    const served = await docxText(res.docxB64);
    expect(served).toContain("AlphaFactOne here.");
    expect(served).toContain("BetaFactTwo here.");
  });
});

describe("a genuinely stale plan is still refused with the ORIGINAL bytes (AC-14) -- GREEN", () => {
  it("an edit whose before does not match the line is refused stale-plan, bytes identical", async () => {
    // Fails if the fix is implemented by weakening or deleting factDocx.js's
    // partial-splice guard -- which half (a) must not touch.
    const edits = [{ lineIndex: 1, before: "text that is not in the letter at all", after: "whatever after" }];
    const res = await applyCoverDocxEdits(ENGINE_B64, ENGINE_LINES, edits);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("stale-plan");
    // Not a partially spliced document, not an empty string -- the input, verbatim.
    expect(res.docxB64).toBe(ENGINE_B64);
  });
});

// WHAT THIS FILE CANNOT CATCH. It stops at the client and at
// `applyCoverDocxEdits`; the route, the RPC and the `inserted_facts` column are
// not exercised. `docxText` reads whole-paragraph text after tag-stripping, so
// a fact split across many runs by some future serializer change could be
// missed -- the engine letter writes each paragraph as one run today. The
// invertibility leg proves a lead-in would fail; it cannot prove the resulting
// prose reads well, only that it round-trips to the original bytes-for-text.
