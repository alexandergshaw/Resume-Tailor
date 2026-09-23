// @vitest-environment jsdom
//
// N35 -- the accepted-fact PROVENANCE KEY, pinned at the producer/storage
// half of the seam. The sibling file app/hooks/acceptFactIdSeam.test.js
// pins the same contract at the wire (the PUT body the hook actually
// sends); this one pins what the DIALOG emits and what the STORE keeps.
//
// ---------------------------------------------------------------------------
// WHAT IS WRONG TODAY, AND WHY 14,000 GREEN TESTS NEVER SAW IT
// ---------------------------------------------------------------------------
// `CompanyResearchDialog.js:126` builds each accepted fact with the key
// `factId` (and a hardcoded `null` at that). Every consumer reads `id`:
//
//   lib/acceptedFacts/factStore.js:29      sanitizeFact  -> raw.id
//   lib/acceptedFacts/factInsertion.js:85  planCoverFacts -> fact.id
//   app/hooks/useCompanyResearch.js:273    priorRecord    -> f?.id
//
// So every accepted fact is stored with `id: null`, every `inserted_facts`
// provenance row names no fact, and the id-based half of dedupe is inert.
// Nothing caught it because the three landed accept tests
// (acceptDurabilityAndConflict / acceptNoEngineBytes / acceptRebuildBoundary)
// hand-build their `SELECTION` fixtures with `factId: null` copied from the
// producer, so the fixture agrees with the bug and the sanitizer's `id: null`
// output is what every assertion expects. Text-normalised dedupe
// (`mergeAcceptedFacts`) masks the user-visible symptom.
//
// ---------------------------------------------------------------------------
// WHY THESE TESTS DRIVE THE UI RATHER THAN CALLING THE BUILDER
// ---------------------------------------------------------------------------
// `acceptSelection()` is module-private inside the component and must stay
// that way -- exporting it so a test could call it would widen the surface
// the export-reachability sweep measures, purely to make a test easier, and
// would prove nothing about the payload a human's click actually produces.
// So every payload below is CAPTURED FROM A REAL CLICK on the real control,
// in the real dialog, after the real "research finished" prop transition
// (articles arriving as a new array is what initialises the dialog's
// selection state -- mounting once with the final articles leaves NOTHING
// selected, which is itself worth knowing).
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT
// ---------------------------------------------------------------------------
// It does NOT demand `id === article.id`. That is one correct build; a build
// that mints a stable derived id (a hash of url+text, say) is equally
// correct and would also fix the defect. What dedupe and provenance actually
// need is pinned instead: present, non-empty, distinct between two different
// accepted cards, and stable across two accepts of the SAME card. A build
// that satisfies those cannot leave id-based dedupe inert.
//
// jsdom note: MUI's Dialog portals into document.body, never into the mount
// container, so every query below goes through document, and the container
// emptiness is asserted once as a tripwire rather than assumed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CompanyResearchDialog from "./CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Two real research cards, in the shape `app/api/company-research/route.js:76`
// emits (`id: "art-<i>"`, title/url/source/summary/suggestion).
const ARTICLES = [
  {
    id: "art-0",
    title: "Acme opens Dublin telemetry lab",
    url: "https://acme.example.com/newsroom/dublin-lab",
    source: "Acme Newsroom",
    date: "2026-02-01",
    summary: "Acme opened a telemetry lab in Dublin.",
    suggestion: "Acme opened a Dublin telemetry lab in 2026.",
  },
  {
    id: "art-1",
    title: "Acme ships accessibility overhaul",
    url: "https://acme.example.com/newsroom/a11y",
    source: "Acme Newsroom",
    date: "2026-03-04",
    summary: "Acme rebuilt its product for screen readers.",
    suggestion: "Acme rebuilt its product for screen readers in 2026.",
  },
];

const COVER_LINES = [
  "Dear Hiring Team,",
  "I am applying for the Staff Engineer role. I have spent eight years on telemetry systems.",
  "In my current role I lead the observability group.",
  "Sincerely,",
];

// The fields `sanitizeFact` keeps, DERIVED from the shipping sanitizer rather
// than hand-listed here -- a hand-listed copy would agree with a stale idea
// of the contract forever. `sanitizeFact` itself is module-private (correct:
// `sanitizeStoredFacts` is the whole-array entry point production calls), so
// the key set is read off its output for one fully-populated fact.
const RECOGNISED_FACT_KEYS = Object.keys(
  sanitizeStoredFacts([
    {
      id: "probe-1",
      text: "A probe fact that is long enough to survive.",
      url: "https://example.com/probe",
      title: "Probe",
      source: "Probe Source",
      placement: "intro",
      textOrigin: "template",
    },
  ])[0] || {},
);

function unrecognisedKeys(fact) {
  return Object.keys(fact || {}).filter((k) => !RECOGNISED_FACT_KEYS.includes(k));
}

let container = null;
let root = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function dialogProps(over) {
  return {
    open: true,
    company: "Acme",
    needsCompany: false,
    loading: false,
    error: "",
    articles: [],
    warnings: [],
    busy: false,
    acceptError: "",
    acceptNotice: "",
    coverLetterLines: COVER_LINES,
    onClose: () => {},
    onApply: () => {},
    onResearch: () => {},
    onAddUrl: () => {},
    ...over,
  };
}

// Mount the dialog the way a candidate meets it: open while the research
// request is still in flight, then the articles arrive. That second render is
// what initialises the dialog's `selected`/`suggestions` state, so it is not
// scene-setting -- skip it and nothing is ever selected.
async function openAndLoadArticles(onAccept, articles = ARTICLES) {
  await act(async () => {
    root.render(createElement(CompanyResearchDialog, dialogProps({ loading: true, onAccept })));
  });
  await act(async () => {
    root.render(createElement(CompanyResearchDialog, dialogProps({ articles, onAccept })));
  });
}

function acceptControl() {
  return [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Insert into cover letter",
  );
}

// REACHABILITY: a real click on the real control. A direct `onAccept(...)`
// call, or a call to the builder, would satisfy every assertion below while
// the button stayed unreachable or disabled.
async function clickAccept() {
  const button = acceptControl();
  expect(
    button,
    `no "Insert into cover letter" control in the dialog; buttons were: ${[...document.querySelectorAll("button")]
      .map((b) => JSON.stringify((b.textContent || "").trim()))
      .join(", ")}`,
  ).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(async () => {
    button.click();
  });
}

async function captureSelection(articles = ARTICLES) {
  const onAccept = vi.fn();
  await openAndLoadArticles(onAccept, articles);
  await clickAccept();
  expect(onAccept).toHaveBeenCalledTimes(1);
  return onAccept.mock.calls[0][0];
}

// ---------------------------------------------------------------------------
// Harness + vacuity controls. Every RED below is only readable as a product
// failure once these are green: an empty fact list would satisfy every
// "for each emitted fact" assertion in this file by construction.
// ---------------------------------------------------------------------------

describe("harness and vacuity controls", () => {
  it("the sanitizer's recognised key set really contains the provenance key", () => {
    // Canary for the derived key set itself. If `sanitizeStoredFacts` ever
    // returns nothing for a valid fact, `RECOGNISED_FACT_KEYS` would be []
    // and the class guard below would flag every key -- loud, not silent.
    expect(RECOGNISED_FACT_KEYS).toContain("id");
    expect(RECOGNISED_FACT_KEYS).toEqual(
      expect.arrayContaining(["id", "text", "url", "title", "source", "placement", "textOrigin"]),
    );
  });

  it("one click emits exactly one fact per checked research card", async () => {
    const selection = await captureSelection();
    // The portal tripwire: nothing renders into the mount container.
    expect(container.textContent).toBe("");
    expect(document.body.textContent.length).toBeGreaterThan(0);
    expect(Array.isArray(selection.facts)).toBe(true);
    expect(selection.facts).toHaveLength(ARTICLES.length);
    // And the facts are the real card text, not placeholders -- so the
    // assertions below are measuring the shipping payload.
    expect(selection.facts.map((f) => f.text)).toEqual(ARTICLES.map((a) => a.suggestion));
  });
});

// ---------------------------------------------------------------------------
// The CLASS guard. Not "the dialog must not say factId" -- that guard dies
// with the one bug it was written for. This one says: no key the dialog emits
// may be a key the store silently discards, whatever it is called next time.
// ---------------------------------------------------------------------------

describe("every key the dialog emits is a key the store recognises (class guard)", () => {
  it("emits no field that sanitizeStoredFacts would silently discard", async () => {
    const selection = await captureSelection();
    for (const fact of selection.facts) {
      expect(
        unrecognisedKeys(fact),
        `the dialog emits ${JSON.stringify(unrecognisedKeys(fact))}, which sanitizeFact drops on the floor; ` +
          `recognised keys are ${JSON.stringify(RECOGNISED_FACT_KEYS)}`,
      ).toEqual([]);
    }
  });

  it("CONTROL: the guard bites on a NEW unrecognised key, and passes a fact made only of recognised ones", () => {
    // Proved against a member the guard has never seen, not against `factId`
    // (the originating bug) -- a guard demonstrated only on the case it was
    // written for is the "tested the easier mutant" trap. Two directions, so
    // a guard that returned [] for everything, or flagged everything, fails
    // here rather than passing silently above.
    expect(unrecognisedKeys({ id: "x", text: "t", sourceUrl: "https://example.com" })).toEqual(["sourceUrl"]);
    expect(unrecognisedKeys({ id: "x", text: "t", factId: null })).toEqual(["factId"]);
    const allRecognised = Object.fromEntries(RECOGNISED_FACT_KEYS.map((k) => [k, "v"]));
    expect(unrecognisedKeys(allRecognised)).toEqual([]);
  });

  // WHAT THIS GUARD CANNOT CATCH, stated so the next reader does not
  // over-trust it: it sees only keys that are PRESENT and unrecognised. A
  // recognised key that is MISSING (exactly today's `id`), or present with a
  // WRONG value (the other card's id), is invisible to it. Those are the
  // separate, specific assertions below -- both instruments are kept.
});

// ---------------------------------------------------------------------------
// The specific assertions: the provenance id itself, through the real store
// entry point.
// ---------------------------------------------------------------------------

describe("an accepted fact carries a provenance id that survives the store", () => {
  it("emits the provenance key `id` on every accepted fact", async () => {
    const selection = await captureSelection();
    for (const fact of selection.facts) {
      expect(Object.keys(fact)).toContain("id");
    }
  });

  it("stores a non-empty, DISTINCT id for each accepted card", async () => {
    // Distinctness is the property id-based dedupe needs: two different cards
    // must not collapse into one stored fact, and a single shared constant id
    // ("fact") would satisfy a mere non-null check.
    const selection = await captureSelection();
    const stored = sanitizeStoredFacts(selection.facts);
    expect(stored).toHaveLength(ARTICLES.length);
    for (const fact of stored) {
      expect(typeof fact.id).toBe("string");
      expect(String(fact.id || "").trim()).not.toBe("");
    }
    expect(new Set(stored.map((f) => f.id)).size).toBe(stored.length);
  });

  it("emits the SAME id for the same card on a second accept (id-based dedupe needs stability)", async () => {
    // A `Date.now()`/random id would pass the distinctness test above and
    // still leave dedupe inert, because the second accept of the same card
    // would carry a new id. Two independent mounts, because a candidate who
    // re-opens the dialog is the real second accept.
    const first = await captureSelection();
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const second = await captureSelection();
    const idsOf = (sel) => sanitizeStoredFacts(sel.facts).map((f) => f.id);
    // Non-vacuity guard, and it is load-bearing: without it this test is
    // GREEN today, because `[null, null]` equals `[null, null]`. Two runs of
    // a producer that emits no id at all agree perfectly and prove nothing.
    for (const id of idsOf(first)) expect(String(id || "").trim()).not.toBe("");
    expect(idsOf(second)).toEqual(idsOf(first));
  });

  it("CONTROL (under-fires): the store PRESERVES an id a producer does supply", () => {
    // Without this, the three reds above would be equally explained by a
    // sanitizer that discards every id -- in which case the fix would belong
    // on the other side of the seam. It does not.
    const stored = sanitizeStoredFacts([
      { id: "art-0", text: "Acme opened a Dublin telemetry lab in 2026.", placement: "intro" },
    ]);
    expect(stored[0].id).toBe("art-0");
  });

  it("CONTROL (over-fires): the store yields id null when the producer supplies none", () => {
    // The mutation control in miniature: it proves the assertions above CAN
    // fail. Drop the id at the producer and the stored fact's id is null --
    // which is precisely what ships today, and precisely what no landed test
    // distinguishes from a fact whose id was carried through.
    const stored = sanitizeStoredFacts([
      { factId: null, text: "Acme opened a Dublin telemetry lab in 2026.", placement: "intro" },
    ]);
    expect(stored[0].id).toBeNull();
  });
});
