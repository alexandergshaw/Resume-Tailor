// @vitest-environment jsdom
//
// N150 Wave D — the tech-buzzwords UI, rendered through the REAL (default-export)
// AnswerAids. RED on HEAD: AnswerAids ignores a `techTerms` prop, so the group
// never renders and no term-named button is found.
//
// The load-bearing, copy-agnostic contract (design §5; placement/exact copy are
// 1c's and deliberately NOT pinned here):
//   • a ready techTerms renders each term as a NATIVE <button> whose accessible
//     name IS the term, with aria-expanded + aria-controls to an inline region.
//     Asserting accessible-name === term is exactly the anti-Tooltip control
//     (a MUI Tooltip steals the control's accessible name — mui-a11y-traps).
//   • terms render ONLY under status === "ready" (a failed/pending list shows
//     no term buttons).
//   • an unconditional honesty lead renders with the group.
//   • the early-return gained `|| hasTechTermsGroup`: a card whose ONLY group is
//     tech-terms still renders (does not return null).
//   • AnswerAids stays presentational — no fetch/model/Supabase import.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import AnswerAids from "./AnswerAids.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TERMS = ["idempotency keys", "circuit breaker"];
const READY = { status: "ready", terms: TERMS };

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(props) {
  await act(async () => root.render(createElement(AnswerAids, props)));
}

// Native buttons whose trimmed text (the accessible name for a plain button) is
// exactly the term. Read from document.body so a portal would still be seen.
function termButtons() {
  return [...document.body.querySelectorAll("button")].filter((b) => TERMS.includes((b.textContent || "").trim()));
}

describe("a ready techTerms renders accessible-named buttons in its own group", () => {
  it("renders each term as a native <button> whose accessible name IS the term (anti-Tooltip)", async () => {
    await render({ techTerms: READY });
    for (const term of TERMS) {
      const btn = termButtons().find((b) => (b.textContent || "").trim() === term);
      expect(btn, `no button named ${JSON.stringify(term)}`).toBeTruthy();
      expect(btn.tagName).toBe("BUTTON");
      // The disclosure wiring to an inline detail region.
      expect(btn.getAttribute("aria-expanded")).not.toBeNull();
      expect(btn.getAttribute("aria-controls")).toBeTruthy();
    }
  });

  it("renders an unconditional honesty lead with the group", async () => {
    await render({ techTerms: READY });
    // Copy is 1c's; this only pins that SOME honesty warning is present whenever
    // the group renders, never the exact words.
    expect((document.body.textContent || "").toLowerCase()).toMatch(/honest|be aware|speak to|only use/);
  });

  it("early-return: a card whose ONLY group is tech-terms still renders (|| hasTechTermsGroup)", async () => {
    // No buzzwords, no anchor, no project example — on HEAD this returns null.
    await render({ techTerms: READY });
    expect(termButtons().length).toBe(TERMS.length);
  });

  it("coexists with the posting-words group when both are present", async () => {
    await render({ buzzwords: ["latency", "SLA"], techTerms: READY });
    expect((document.body.textContent || "")).toContain("latency");
    expect(termButtons().length).toBe(TERMS.length);
  });
});

describe("terms render ONLY under status === 'ready'", () => {
  it("a failed list renders no term buttons", async () => {
    await render({ techTerms: { status: "failed" } });
    expect(termButtons()).toEqual([]);
  });

  it("a pending list renders no term buttons", async () => {
    await render({ techTerms: { status: "pending" } });
    expect(termButtons()).toEqual([]);
  });

  it("a ready-but-empty list renders no term buttons", async () => {
    await render({ techTerms: { status: "ready", terms: [] } });
    expect(termButtons()).toEqual([]);
  });
});

describe("AnswerAids stays presentational", () => {
  it("imports no fetch, model client or Supabase symbol", () => {
    const src = readFileSync(path.resolve(process.cwd(), "app/copilot/AnswerAids.js"), "utf8");
    expect(src).not.toMatch(/@\/lib\/supabase/);
    expect(src).not.toMatch(/geminiClient|getServerEnv/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/answerClient|techTermsLive|techTermDetailClient/);
  });
});
