// @vitest-environment jsdom
//
// N62 Capability A -- AC-A2: the research dialog seeds every accepted card's
// placement from the user's SAVED default, not from the hardcoded
// DEFAULT_PLACEMENT. The data that actually ships is `acceptSelection().facts[]
// .placement` (CompanyResearchDialog.js:131 carries `placement: c.target` into
// the accepted fact, which factStore keeps and factInsertion resolves), so
// that is what these assertions read -- NOT the Select's displayed value (a
// build could show the right label and still emit the wrong placement).
//
// WHY DRIVE THE REAL CONTROL. `acceptSelection()` is module-private and must
// stay that way (exporting it to call directly widens the export-reachability
// surface for no product reason). So the payload below is CAPTURED FROM A REAL
// CLICK on the real "Insert into cover letter" control, after the real
// "research finished" prop transition (articles arriving as a NEW array is what
// initialises the dialog's per-card `targets` state -- mounting once with the
// final articles leaves nothing selected).
//
// TRAP: the dialog seeds `targets[a.id]` only WHEN IT HAS NONE (:90 today,
// `if (!next[a.id])`), and that state survives across renders because the
// component stays mounted. So each test here mounts a FRESH dialog (new root in
// beforeEach) and lets the articles arrive fresh -- if the prop change were
// tested by re-rendering an already-seeded dialog, the seed would never re-run
// and the test would prove nothing either way.
//
// RED ON HEAD: :90 seeds `DEFAULT_PLACEMENT` unconditionally and ignores any
// prop, so every accepted fact's placement is "intro" regardless of the saved
// default -> the "current"/"why" assertions fail now.
//
// jsdom note: MUI's Dialog portals into document.body, so every query goes
// through document; the container-emptiness tripwire is asserted once.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CompanyResearchDialog from "./CompanyResearchDialog.js";
import { DEFAULT_PLACEMENT, PLACEMENTS } from "@/lib/document/coverLetterWeave.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

// Meet the dialog the way a candidate does: open while research is in flight,
// then the articles arrive (the transition that seeds per-card `targets`).
async function openAndLoad(props) {
  await act(async () => {
    root.render(createElement(CompanyResearchDialog, dialogProps({ ...props, loading: true })));
  });
  await act(async () => {
    root.render(createElement(CompanyResearchDialog, dialogProps({ ...props, articles: ARTICLES })));
  });
}

function acceptControl() {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Insert into cover letter");
}

async function captureSelection(props) {
  const onAccept = vi.fn();
  await openAndLoad({ ...props, onAccept });
  const button = acceptControl();
  expect(
    button,
    `no "Insert into cover letter" control; buttons were: ${[...document.querySelectorAll("button")]
      .map((b) => JSON.stringify((b.textContent || "").trim()))
      .join(", ")}`,
  ).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(async () => {
    button.click();
  });
  expect(onAccept).toHaveBeenCalledTimes(1);
  return onAccept.mock.calls[0][0];
}

describe("AC-A2 vacuity control", () => {
  it("one click emits one fact per checked card with the real card text (so placement assertions are non-vacuous)", async () => {
    const selection = await captureSelection({ defaultPlacement: "current" });
    // portal tripwire
    expect(container.textContent).toBe("");
    expect(document.body.textContent.length).toBeGreaterThan(0);
    expect(Array.isArray(selection.facts)).toBe(true);
    expect(selection.facts).toHaveLength(ARTICLES.length);
    expect(selection.facts.map((f) => f.text)).toEqual(ARTICLES.map((a) => a.suggestion));
  });
});

describe("AC-A2 the accepted fact's placement is the saved default", () => {
  it('seeds every accepted fact to the saved default "current" (RED on HEAD: seeds "intro")', async () => {
    const selection = await captureSelection({ defaultPlacement: "current" });
    expect(selection.facts.length).toBeGreaterThan(0);
    for (const fact of selection.facts) {
      expect(fact.placement, `accepted fact "${fact.text}" did not take the saved default placement`).toBe("current");
    }
  });

  it('seeds a DIFFERENT saved default "why" (control: proves the prop is read, not a constant)', async () => {
    // Two distinct non-default values close the "hardcoded to the one value I
    // tested" gap: a build that ignored the prop and always used DEFAULT, and a
    // build that hardcoded "current", both fail one of these two tests.
    const selection = await captureSelection({ defaultPlacement: "why" });
    for (const fact of selection.facts) {
      expect(fact.placement).toBe("why");
    }
  });

  it("falls back to DEFAULT_PLACEMENT when no default is saved (empty prop)", async () => {
    // The saved-default-absent case: it must NOT break the existing behaviour.
    // Green on HEAD (already the default) -- kept as the closed lower boundary
    // so a build that made the prop mandatory, or defaulted it wrongly, fails.
    const selection = await captureSelection({ defaultPlacement: "" });
    for (const fact of selection.facts) {
      expect(fact.placement).toBe(DEFAULT_PLACEMENT);
    }
  });

  it("the saved default is one of the four real placement ids (guards the fixtures)", () => {
    // Canary: if PLACEMENTS ever renamed these ids, the fixtures above would be
    // testing against ghosts -- this fails loudly instead.
    const ids = PLACEMENTS.map((p) => p.id);
    expect(ids).toContain("current");
    expect(ids).toContain("why");
    expect(ids).toContain(DEFAULT_PLACEMENT);
  });
});
