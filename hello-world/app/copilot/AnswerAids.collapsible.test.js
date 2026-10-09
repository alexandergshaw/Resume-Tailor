// @vitest-environment jsdom
//
// N144a T3 — the three AnswerAids aid groups become CollapsibleAid sections,
// default collapsed below 600px and open from 600 up; the resume group stays
// always-visible with no header (docs/loop/N144a.plan.r1.md §2.3, ledger
// L2/L3/L4/L10/L11/L12/L13/L14). The examples group keeps its existing
// role=group + copilot-example-projects key; the two new sections do NOT
// introduce a second role=group (the landed first-match contract test).
//
// Driven the way a human reaches it: the real AnswerAids mounted under the real
// matchMedia-emulated viewport, headers found BY NAME, toggled by real clicks.
// jsdom has no layout, so this is declared structure / a11y, never geometry
// (plan §7.2; footprint is the owner pass §8). The matchMedia stub is
// load-bearing: without it useIsMobile() is permanently false and the mobile
// branch is invisible (plan §5/§6).
//
// RED on HEAD: AnswerAids today has no matchMedia-driven collapse — posting and
// tech are plain `dl`s with no header button, and examples defaults open at
// every width — so there are not three collapsed headers at 375. Intended red:
// the feature is absent.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchTechTermDetail = vi.fn();
vi.mock("@/lib/copilot/techTermDetailClient", () => ({
  fetchTechTermDetail: (...args) => fetchTechTermDetail(...args),
}));

import AnswerAids from "./AnswerAids.js";
import { TechTermDetailScope } from "./useTechTermDetails.js";
import { resetAllChoiceStores } from "@/lib/copilot/choiceStore.js";
import { resetTechTermDetailStore } from "@/lib/copilot/techTermDetailStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport emulation ------------------------------------------------------
const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = PHONE;

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

// --- labels and fixtures -----------------------------------------------------
const POSTING_LABEL = "Words from the posting to work in";
const TECH_LABEL = "Tech buzzwords";
const EX_LABEL = "Example projects (invented)";

const POSTING_WORD = "latency";
const TECH_LEAD = "Suggestions, not claims.";
const TECH_TERM = "idempotency keys";
const EX_TITLE = "Rebuilt the paging rotation";
const EX_LEAD = "Not from your resume.";

const KEYS = ["copilot-example-projects", "copilot-posting-words", "copilot-tech-buzzwords"];

const anchor = {
  title: "Senior Engineer",
  company: "Initech",
  project: "Payments migration",
  description: [],
  matched: true,
  source: "resume",
};
const ROLE_TEXT = "Senior Engineer at Initech";
const PROJECT_TEXT = "Payments migration";

const READY_EXAMPLE = () => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: EX_TITLE,
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
  engine: "gemini",
});
const TECH_READY = { status: "ready", terms: [TECH_TERM, "circuit breaker"] };

const ALL_FOUR = () => ({
  anchor,
  buzzwords: [POSTING_WORD, "SLA"],
  techTerms: TECH_READY,
  projectExample: READY_EXAMPLE(),
});

let container;
let root;

beforeEach(() => {
  resetAllChoiceStores();
  resetTechTermDetailStore();
  fetchTechTermDetail.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* memory-authoritative anyway */
  }
  viewportWidth = PHONE;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function accessibleName(el) {
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  return (clone.textContent || "").trim();
}

async function render(props, { width = viewportWidth, scope } = {}) {
  viewportWidth = width;
  const aids = createElement(AnswerAids, props);
  await act(async () => {
    root.render(scope ? createElement(TechTermDetailScope, scope, aids) : aids);
  });
  return container;
}

const header = (label) => [...container.querySelectorAll("button")].find((b) => accessibleName(b) === label);
const panelOf = (hdr) => {
  const id = hdr.getAttribute("aria-controls");
  return id ? container.querySelector(`#${CSS.escape(id)}`) : null;
};
const text = () => container.textContent || "";
async function click(el) {
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

// ---------------------------------------------------------------------------
// A1 — at 375 all three sections collapsed; resume group visible, no header.
// ---------------------------------------------------------------------------
describe("A1: at 375 the three aids collapse; the resume group stays visible with no header", () => {
  it("three named headers, each aria-expanded=false and no body content; resume content present", async () => {
    await render(ALL_FOUR(), { width: PHONE });

    for (const label of [POSTING_LABEL, TECH_LABEL, EX_LABEL]) {
      const hdr = header(label);
      expect(hdr, `header named "${label}"`).toBeTruthy();
      expect(hdr.getAttribute("aria-expanded")).toBe("false");
    }

    // Every collapsible body is unmounted: none of its content is on screen.
    expect(text()).not.toContain(POSTING_WORD);
    expect(text()).not.toContain(TECH_LEAD);
    expect(text()).not.toContain(TECH_TERM);
    expect(text()).not.toContain(EX_TITLE);

    // The resume group is NOT collapsed and has no header/button of its own.
    expect(text()).toContain(ROLE_TEXT);
    expect(text()).toContain(PROJECT_TEXT);
    const names = [...container.querySelectorAll("button")].map(accessibleName);
    expect(names.sort()).toEqual([EX_LABEL, TECH_LABEL, POSTING_LABEL].sort());
  });
});

// ---------------------------------------------------------------------------
// A2 — at 1200 all open, all content present, DOM order unchanged.
// ---------------------------------------------------------------------------
describe("A2: at 1200 every section is open and DOM order is resume -> posting -> tech -> examples", () => {
  it("three headers expanded=true, all content present, order preserved", async () => {
    await render(ALL_FOUR(), { width: DESKTOP });
    for (const label of [POSTING_LABEL, TECH_LABEL, EX_LABEL]) {
      expect(header(label).getAttribute("aria-expanded")).toBe("true");
    }
    const full = text();
    expect(full).toContain(POSTING_WORD);
    expect(full).toContain(TECH_LEAD);
    expect(full).toContain(EX_TITLE);
    const order = [ROLE_TEXT, POSTING_LABEL, TECH_LABEL, EX_LABEL].map((s) => full.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(Math.min(...order)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// A3 — the honesty word survives collapse (examples name carries "invented").
// Copy is unresolved for Tech (OD-1); the fixed decision is "use existing
// labels", so Tech's collapsed name is asserted to be exactly today's label.
// ---------------------------------------------------------------------------
describe("A3: collapsed honesty on the header's accessible name (375)", () => {
  it("the Examples header name contains 'invented'; the Tech header uses the existing label", async () => {
    await render(ALL_FOUR(), { width: PHONE });
    expect(accessibleName(header(EX_LABEL))).toContain("invented");
    expect(accessibleName(header(TECH_LABEL))).toBe(TECH_LABEL);
  });
});

// ---------------------------------------------------------------------------
// A4 — independent disclosures: opening one leaves the others collapsed.
// ---------------------------------------------------------------------------
describe("A4: the disclosures are independent (opening one does not open another)", () => {
  it("expanding Posting words at 375 leaves Tech and Examples collapsed", async () => {
    await render(ALL_FOUR(), { width: PHONE });
    await click(header(POSTING_LABEL));
    expect(header(POSTING_LABEL).getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain(POSTING_WORD);
    expect(header(TECH_LABEL).getAttribute("aria-expanded")).toBe("false");
    expect(header(EX_LABEL).getAttribute("aria-expanded")).toBe("false");
    expect(text()).not.toContain(TECH_LEAD);
    expect(text()).not.toContain(EX_TITLE);
  });
});

// ---------------------------------------------------------------------------
// A5 — persistence + the exact three storage keys.
// ---------------------------------------------------------------------------
describe("A5: a tapped-open section persists across remount; the three keys are exactly the agreed ones", () => {
  it("opens all three at 375, writes exactly the three keys, and stays open on remount", async () => {
    await render(ALL_FOUR(), { width: PHONE });
    await click(header(POSTING_LABEL));
    await click(header(TECH_LABEL));
    await click(header(EX_LABEL));

    // Nothing is written until a tap, so after three taps the ONLY keys are
    // these three (no stray fourth key, no renamed key).
    const stored = Object.keys(localStorage).sort();
    expect(stored).toEqual([...KEYS].sort());

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(ALL_FOUR(), { width: PHONE });
    for (const label of [POSTING_LABEL, TECH_LABEL, EX_LABEL]) {
      expect(header(label).getAttribute("aria-expanded")).toBe("true");
    }
  });
});

// ---------------------------------------------------------------------------
// A6 — exactly ONE role=group, and it is Examples (the first-match trap).
// ---------------------------------------------------------------------------
describe("A6: only the Examples section is role=group (Posting words must not become a second one)", () => {
  it("exactly one role=group, named by the Examples header, with Posting words present before it", async () => {
    await render(ALL_FOUR(), { width: PHONE });
    const groups = container.querySelectorAll('[role="group"]');
    expect(groups.length).toBe(1);
    const labelledBy = groups[0].getAttribute("aria-labelledby");
    const named = labelledBy ? container.querySelector(`#${CSS.escape(labelledBy)}`) : null;
    expect(named, "the role=group is named by a header").not.toBeNull();
    expect(accessibleName(named)).toBe(EX_LABEL);
    // Posting words renders before Examples — the exact arrangement the landed
    // `el.querySelector('[role="group"]')` first-match test relies on.
    expect(header(POSTING_LABEL)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A7 — the tech detail live region lives inside the body; open term survives
// a collapse/re-expand (the open set lives in the scope, not the chips). L11.
// ---------------------------------------------------------------------------
describe("A7: the tech live region is inside the body and an opened term survives re-expansion", () => {
  it("expand -> empty polite region whose id the chip controls; open a term -> detail; collapse/re-expand keeps it open", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "An idempotency key makes a retried request safe.", empty: false });
    await render(
      { techTerms: TECH_READY },
      {
        width: PHONE,
        scope: { questions: [{ id: "q1", question: "How do you make retries safe?", techTerms: TECH_READY }], request: { applicationId: "app-1", engine: "gemini" } },
      },
    );

    // Collapsed first: the region does not exist yet (body unmounted).
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();

    await click(header(TECH_LABEL));
    const region = container.querySelector('[aria-live="polite"]');
    expect(region, "a polite live region exists inside the expanded tech body").not.toBeNull();
    expect((region.textContent || "").trim()).toBe(""); // empty before any term opens
    // The region is inside the tech panel (the aria-controls target), not an
    // ancestor of it.
    expect(panelOf(header(TECH_LABEL)).contains(region)).toBe(true);

    const chip = [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === TECH_TERM);
    expect(chip, "the tech term chip").toBeTruthy();
    expect(chip.getAttribute("aria-controls")).toBe(region.id);

    await act(async () => {
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(text()).toContain("An idempotency key makes a retried request safe.");
    // N153 ADOPTION: expanding the section mounts BOTH chips, which prefetch both
    // terms' details (2 calls). Opening the clicked chip spends no further call.
    // RED on HEAD: a mounted chip warmed nothing, so only the click fetched (1).
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(2);

    // Collapse: the body (and the open-term detail) unmounts.
    await click(header(TECH_LABEL));
    expect(text()).not.toContain("An idempotency key makes a retried request safe.");

    // Re-expand: the term is STILL open (its open state lived in the scope, not
    // the chip), the detail returns, and nothing re-fetched — the remounted
    // chips re-warm but the store's settled records dedupe every call.
    await click(header(TECH_LABEL));
    expect(text()).toContain("An idempotency key makes a retried request safe.");
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// A8 — pending/failed bodies and the aria-busy placement.
// ---------------------------------------------------------------------------
describe("A8: aria-busy stays on the inner pending line, never on the header, panel or group wrapper", () => {
  it("tech pending: body hidden at 375; expand shows the pending line carrying aria-busy, ancestors clean", async () => {
    await render({ anchor, buzzwords: [POSTING_WORD], techTerms: { status: "pending" } }, { width: PHONE });
    expect(text()).not.toContain("Finding tech terms for this question");

    await click(header(TECH_LABEL));
    expect(text()).toContain("Finding tech terms for this question");

    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy, "the pending line carries aria-busy, as today").not.toBeNull();
    expect(busy.textContent || "").toContain("Finding tech terms for this question");

    const hdr = header(TECH_LABEL);
    const panel = panelOf(hdr);
    expect(hdr.getAttribute("aria-busy")).not.toBe("true");
    expect(panel.getAttribute("aria-busy")).not.toBe("true");
    // The busy node is a descendant of the panel, never the panel itself.
    expect(panel.contains(busy)).toBe(true);
    expect(busy).not.toBe(panel);
  });

  it("tech ready: no ancestor of the live region carries aria-busy", async () => {
    await render({ techTerms: TECH_READY }, { width: PHONE });
    await click(header(TECH_LABEL));
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    let node = region.parentElement;
    while (node && node !== container) {
      expect(node.getAttribute("aria-busy")).not.toBe("true");
      node = node.parentElement;
    }
  });
});

// ---------------------------------------------------------------------------
// A9 — N143/N150 copy unchanged when open at 1200 (no copy restated here).
// ---------------------------------------------------------------------------
describe("A9: the pinned N143/N150 leads are intact when the sections are open at 1200", () => {
  it("the example lead and the tech lead both render when open", async () => {
    await render(ALL_FOUR(), { width: DESKTOP });
    expect(text()).toContain(EX_LEAD);
    expect(text()).toContain(TECH_LEAD);
  });
});
