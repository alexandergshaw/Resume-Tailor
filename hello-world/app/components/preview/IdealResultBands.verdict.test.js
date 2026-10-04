// @vitest-environment jsdom
//
// N105 Step 8-UI -- the DOM half of the headline safety property (UX-26 / K3):
// a partial or absent review must NEVER render a clean verdict. Driven through
// IdealResultBands, the real composition that consumes the already-landed pure
// idealBandState. Lands RED: the component does not exist yet.
//
// The pure 36-combination purity is already pinned on lib/tailor/idealBandState.js;
// this file pins that the COMPOSED BAND actually renders that state's copy, that
// the clean verdict is reachable in the one licensed combination, and that the
// DOM-level forbidden-phrase sweep (with the data-quoted exclusion) holds.
//
// Render contract: <IdealResultBands ideal={...} currentText={...} handEdited={bool} />
// computes idealBandState internally and renders the headline, notes and the
// non-empty groups. Quoted claim/evidence text is marked data-quoted so a resume
// line that happens to say "all clear" cannot trip the sweep.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import IdealResultBands from "./IdealResultBands.js";
import { CATEGORY } from "@/lib/review/contract.js";
import { UNVERIFIED_FLAG } from "@/lib/llm/ideal/applicationReadyGate.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The forbidden clean-verdict phrases (UX 5.8 P1). None may appear in the band's
// CHROME text in any non-clean state.
const FORBIDDEN = [
  /no issues flagged/i,
  /no weaknesses/i,
  /nothing (was )?(flagged|found)/i,
  /found nothing/i,
  /no (problems|concerns|issues)\b/i,
  /all clear/i,
  /looks good/i,
  /passed/i,
  /\bverified\b/i,
  /safe to send/i,
];

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(IdealResultBands, props));
  });
}

// Chrome text = everything EXCEPT quoted claim/evidence nodes.
function chromeText() {
  const clone = container.cloneNode(true);
  clone.querySelectorAll("[data-quoted]").forEach((n) => n.remove());
  return clone.textContent || "";
}

const PARTIAL_IDEAL = {
  applicationReady: { result: "APP READY BODY" },
  review: {
    coverage: {
      complete: false,
      engineMode: "mechanical-only",
      evaluatedCategories: ["missing-keyword", "repetition", "unverifiable-metric", "vague-unsupported"],
    },
    flags: [],
    unresolvedQualifications: [],
    // A removed claim whose text itself contains a forbidden phrase -- it must be
    // quoted (data-quoted) so it does NOT trip the sweep.
    removed: [
      {
        spanId: "s1",
        text: "All clear on every metric we shipped",
        section: "Experience",
        contextKey: "Acme - Staff Engineer",
        reasonCode: "partial-match",
        flag: UNVERIFIED_FLAG,
        anchor: null,
      },
    ],
    leftOut: [],
    counts: { kept: 5, keptAccomplishments: 3, removed: 1, leftOut: 0 },
  },
};

const CLEAN_IDEAL = {
  applicationReady: { result: "CLEAN BODY" },
  review: {
    coverage: { complete: true, engineMode: "full", evaluatedCategories: Object.values(CATEGORY) },
    flags: [],
    unresolvedQualifications: [],
    removed: [],
    leftOut: [],
    counts: { kept: 6, keptAccomplishments: 4, removed: 0, leftOut: 0 },
  },
};

describe("N105 Step 8-UI -- band verdict rendering and the forbidden-phrase sweep", () => {
  it("a PARTIAL review (slice-1 norm) renders the partial headline and NO clean-verdict phrase in chrome", async () => {
    await render({ ideal: PARTIAL_IDEAL, currentText: "APP READY BODY", handEdited: false });
    expect(container.textContent).toMatch(/Partial review - mechanical checks only/);
    const chrome = chromeText();
    for (const re of FORBIDDEN) {
      expect(chrome, `partial chrome must not match ${re}`).not.toMatch(re);
    }
    // Control that the data-quoted exclusion is LOAD-BEARING, not vacuous: the
    // full DOM (quoted included) really does contain a forbidden phrase.
    expect(container.textContent).toMatch(/all clear/i);
  });

  it("POSITIVE CONTROL: the one licensed combination (fresh, complete, not thin, no findings) renders C17", async () => {
    await render({ ideal: CLEAN_IDEAL, currentText: "CLEAN BODY", handEdited: false });
    // Proves the clean branch is LIVE, not dead -- a sweep that nothing can ever
    // satisfy would be a trap.
    expect(chromeText()).toMatch(/no issues flagged/i);
  });

  it("an ABSENT review renders the no-review state, never a clean verdict", async () => {
    await render({
      ideal: { applicationReady: { result: "X" }, review: null },
      currentText: "X",
      handEdited: false,
    });
    const chrome = chromeText();
    expect(chrome).toMatch(/treat every line as unchecked/i);
    expect(chrome).not.toMatch(/no issues flagged/i);
    for (const re of FORBIDDEN) {
      expect(chrome, `no-review chrome must not match ${re}`).not.toMatch(re);
    }
  });
});
