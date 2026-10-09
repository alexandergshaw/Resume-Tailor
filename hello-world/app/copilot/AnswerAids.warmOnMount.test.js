// @vitest-environment jsdom
//
// N153 — REACHABILITY + the collapse ruling for the per-buzzword warm. A buzzword
// detail is warmed "as soon as it comes up on screen", driven the way a human
// reaches it: a REAL TechTermDetailScope wrapping a REAL AnswerAids, mounted at a
// real viewport, with NOTHING called directly. The warm lives in TechTermChip,
// which CollapsibleAid unmounts while the section is collapsed — so the structure
// gates the warm, not a flag.
//
// Collapse ruling (design §3, ledger N153-L3), the headline teeth:
//   • DESKTOP (>=600px, section open): the chips are mounted, so each resolvable
//     term is warmed on mount;
//   • MOBILE (<600px, section collapsed): the chips are NOT mounted, so NOTHING
//     is warmed until the candidate expands the section. A build that warmed from
//     TechTermsGroup unconditionally (option b) instead of per mounted chip would
//     fetch here and reds this case.
//
// RED on HEAD: the api has no keyFor/prefetch and the chip has no warm, so even
// the desktop mount issues zero requests today.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchTechTermDetail = vi.fn();
vi.mock("@/lib/copilot/techTermDetailClient", () => ({
  fetchTechTermDetail: (...args) => fetchTechTermDetail(...args),
}));

import AnswerAids from "./AnswerAids.js";
import { TechTermDetailScope } from "./useTechTermDetails.js";
import { resetTechTermDetailStore } from "@/lib/copilot/techTermDetailStore";
import { resetAllChoiceStores } from "@/lib/copilot/choiceStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport emulation (the realParents.collapsible.test.js pattern) --------
const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = DESKTOP;

function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}

window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

const TERMS = ["idempotency keys", "circuit breaker"];
const TECH_TERMS = { status: "ready", terms: TERMS };
const QUESTIONS = [{ id: "q1", question: "How do you make retries safe?", techTerms: TECH_TERMS }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

let container;
let root;

beforeEach(() => {
  resetTechTermDetailStore();
  resetAllChoiceStores();
  try {
    localStorage.clear();
  } catch {
    /* memory-authoritative anyway */
  }
  fetchTechTermDetail.mockReset();
  fetchTechTermDetail.mockResolvedValue({ detail: "An explanation.", empty: false });
  viewportWidth = DESKTOP;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount({ width = viewportWidth, onDetailOutcome } = {}) {
  viewportWidth = width;
  await act(async () =>
    root.render(
      createElement(
        TechTermDetailScope,
        { questions: QUESTIONS, request: REQUEST, onDetailOutcome },
        createElement(AnswerAids, { techTerms: TECH_TERMS }),
      ),
    ),
  );
}

// Lets the warm's queue microtask + the store settle land.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const chip = (name) => [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);

describe("desktop (section open): the chips warm on mount", () => {
  it("warms each resolvable term exactly once, with no interaction", async () => {
    await mount({ width: DESKTOP });
    await settle();
    // One warm per term — zero on HEAD (no prefetch) -> red there.
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(TERMS.length);
    const warmedTerms = fetchTechTermDetail.mock.calls.map((c) => c[0].term).sort();
    expect(warmedTerms).toEqual([...TERMS].sort());
    // Each call carries the explicit request fields the route needs.
    for (const call of fetchTechTermDetail.mock.calls) {
      expect(call[0]).toMatchObject({ question: "How do you make retries safe?", applicationId: "app-1", engine: "gemini" });
    }
  });

  it("opens no chip: every chip stays collapsed after the warm", async () => {
    await mount({ width: DESKTOP });
    await settle();
    for (const term of TERMS) {
      expect(chip(term).getAttribute("aria-expanded")).toBe("false");
    }
    // The warmed detail is in the store but not rendered (prefetch does not open).
    expect((document.body.textContent || "")).not.toContain("An explanation.");
  });

  it("a click after the warm opens the warmed record and issues no second request", async () => {
    await mount({ width: DESKTOP });
    await settle();
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(TERMS.length);

    await act(async () => {
      chip("idempotency keys").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(chip("idempotency keys").getAttribute("aria-expanded")).toBe("true");
    expect((document.body.textContent || "")).toContain("An explanation.");
    // No new call: the click opened a record the warm already filled.
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(TERMS.length);
  });

  it("the warm does NOT log an outcome (L1: the log records opens, not prefetches)", async () => {
    const onDetailOutcome = vi.fn();
    await mount({ width: DESKTOP, onDetailOutcome });
    await settle();
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(TERMS.length);
    expect(onDetailOutcome).not.toHaveBeenCalled();
  });
});

describe("mobile (section collapsed): nothing warms until the section is opened", () => {
  it("warms no term on a phone, because the chips are not mounted", async () => {
    await mount({ width: PHONE });
    await settle();
    // The buzzwords section is collapsed, so TechTermChip never mounts and the
    // per-chip warm never runs. A terms-on-screen warm (option b) would fetch here.
    expect(chip("idempotency keys")).toBeUndefined(); // chips are unmounted
    expect(fetchTechTermDetail).not.toHaveBeenCalled();
  });
});
