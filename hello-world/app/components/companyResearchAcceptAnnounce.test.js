// @vitest-environment jsdom
//
// N95 AC-K2 -- the ACCEPT flow's in-flight state is ANNOUNCED to assistive
// tech, not only DRAWN as a disabled-button label. The accept button already
// disables and swaps its label to "Inserting…" while `busy` (AC-K1 GUARD,
// passes on HEAD, not new work) -- but a disabled button's label change is not
// a live region, so a screen-reader user is told nothing. This is the N84
// draw-not-announce class applied to accept.
//
// Driven the way a candidate reaches it (the sibling
// CompanyResearchDialog.defaultPlacement.test.js is the template): mount the
// REAL CompanyResearchDialog, let research resolve (articles arrive), click the
// real "Insert into cover letter" control, then the parent flips `busy` true
// (its real response) -- and a LIVE REGION, not the button label, must carry
// the announcement.
//
// RED-on-HEAD: the dialog renders no role=status / aria-live / data-copy-status
// region that changes text on the busy edge; only the button label toggles.
//
// jsdom note: MUI's Dialog portals into document.body -> queries go through
// document.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CompanyResearchDialog from "./CompanyResearchDialog.js";

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
];

const COVER_LINES = ["Dear Hiring Team,", "I am applying for the Staff Engineer role.", "Sincerely,"];

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

async function render(props) {
  await act(async () => {
    root.render(createElement(CompanyResearchDialog, dialogProps(props)));
  });
}

const acceptControl = () =>
  [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Insert into cover letter"));

// Every LIVE region in the document -- explicitly NOT the accept <button>
// (which is none of these), so a passing assertion proves an announced region,
// never the drawn label.
const liveRegionText = () =>
  [...document.querySelectorAll('[role="status"],[aria-live],[data-copy-status="polite"]')]
    .map((n) => n.textContent || "")
    .join(" | ");

describe("AC-K2: the accept in-flight state is announced, not only drawn", () => {
  it("lands 'Inserting…' in a live region on the busy edge, not just the button label", async () => {
    const onAccept = vi.fn();
    // research in flight, then articles arrive (the transition the dialog seeds on)
    await render({ onAccept, loading: true });
    await render({ onAccept, articles: ARTICLES });

    const button = acceptControl();
    expect(button, "no 'Insert into cover letter' control -- the accept flow is unreachable").toBeTruthy();
    expect(button.disabled).toBe(false);
    // no live region carries insert text before the flight begins
    expect(liveRegionText(), "a live region already announced inserting before the click").not.toMatch(/insert/i);

    // click the real control...
    await act(async () => {
      button.click();
    });
    expect(onAccept, "the accept control is not wired").toHaveBeenCalledTimes(1);

    // ...and the parent flips busy true (its real response): the announcement
    // must live in a LIVE region, not merely the disabled button's label.
    await render({ onAccept, articles: ARTICLES, busy: true });
    expect(liveRegionText(), "the accept in-flight state was drawn (button label) but never announced").toMatch(/insert/i);
  });

  it("control: the drawn label alone does not satisfy the announcement (it is not a live region)", async () => {
    // Vacuity guard: prove the button label DOES say Inserting while busy (so
    // the feature is really in the busy state), yet the assertion above reads a
    // LIVE region, not this label -- a build that only toggled the label fails
    // the test above while passing this control.
    await render({ onAccept: vi.fn(), articles: ARTICLES, busy: true });
    const label = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).join(" | ");
    expect(label, "the busy label is not drawn -- the fixture is wrong").toMatch(/inserting/i);
  });
});
