// @vitest-environment jsdom
//
// N154 — REACHABILITY + the collapse ruling + no-poison for the per-bullet "More
// detail" control, driven the way a human reaches it: a REAL
// ProjectBulletDetailScope wrapping a REAL AnswerAids, mounted at a real
// viewport, with NOTHING called directly. The control lives inside each ready
// bullet's <li>, which CollapsibleAid unmounts while the example group is
// collapsed — so the structure gates the warm, not a flag.
//
// RED on HEAD: useProjectBulletDetails.js does not exist (collection fails), and
// AnswerAids renders no per-bullet control, so there is nothing to warm or click.
//
// The teeth:
//   • R1  — a control renders per ready bullet of BOTH rows, and is interactive.
//   • R5  — DESKTOP (group open): one warm per bullet (a null keyFor -> zero
//            warms reds this); MOBILE (group collapsed): zero warms.
//   • R2  — a click after a warm opens the warmed record, issues no 2nd request.
//   • R12 — a rejecting/slow fetcher leaves both example rows intact.
//   • R6/R7 — the control is prose, never an <li>; the invented lead precedes
//            every [data-bullet-detail] node; a ready row's <li> count is the
//            bullet count.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchProjectBulletDetail = vi.fn();
vi.mock("@/lib/copilot/projectBulletDetailClient", () => ({
  fetchProjectBulletDetail: (...args) => fetchProjectBulletDetail(...args),
}));

import AnswerAids from "./AnswerAids.js";
import { ProjectBulletDetailScope } from "./useProjectBulletDetails.js";
import { resetProjectBulletDetailStore } from "@/lib/copilot/projectBulletDetailStore";
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

const ROW1 = {
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within the target"],
  hypothetical: true,
  engine: "gemini",
};
const ROW2 = {
  status: "ready",
  competency: "",
  domain: "SRE",
  title: "Scaled a read-replica fleet",
  bullets: ["Added read replicas behind a proxy", "Cut p99 latency materially"],
  hypothetical: true,
  engine: "gemini",
};
const ALL_BULLETS = [...ROW1.bullets, ...ROW2.bullets];
const QUESTIONS = [{ id: "q1", question: "Tell me about an incident.", projectExample: ROW1, projectExampleLive: ROW2 }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

let container;
let root;

beforeEach(() => {
  resetProjectBulletDetailStore();
  resetAllChoiceStores();
  try {
    localStorage.clear();
  } catch {
    /* memory-authoritative anyway */
  }
  fetchProjectBulletDetail.mockReset();
  fetchProjectBulletDetail.mockResolvedValue({ detail: "A strong candidate might describe the trade-offs.", empty: false });
  viewportWidth = DESKTOP;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount({ width = viewportWidth } = {}) {
  viewportWidth = width;
  await act(async () =>
    root.render(
      createElement(
        ProjectBulletDetailScope,
        { questions: QUESTIONS, request: REQUEST },
        createElement(AnswerAids, { projectExample: ROW1, projectExampleLive: ROW2 }),
      ),
    ),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const detailButtons = () =>
  [...document.body.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("More detail"));

// The "More detail" control for the bullet whose <li> text contains `bulletText`.
function controlForBullet(bulletText) {
  const li = [...document.body.querySelectorAll("li")].find((n) => (n.textContent || "").includes(bulletText));
  return li ? [...li.querySelectorAll("button")].find((b) => (b.textContent || "").includes("More detail")) : undefined;
}

describe("R1 — a control renders per ready bullet of BOTH rows, interactive", () => {
  it("renders one 'More detail' control per bullet across Row 1 and Row 2", async () => {
    await mount({ width: DESKTOP });
    await settle();
    expect(detailButtons().length).toBe(ALL_BULLETS.length);
    for (const b of detailButtons()) expect(b.disabled).toBe(false);
    for (const bullet of ALL_BULLETS) expect(controlForBullet(bullet), bullet).toBeTruthy();
  });
});

describe("R5 — desktop warms once per bullet; mobile (collapsed) warms nothing", () => {
  it("DESKTOP: warms each resolvable bullet exactly once, with no interaction", async () => {
    await mount({ width: DESKTOP });
    await settle();
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(ALL_BULLETS.length);
    const warmed = fetchProjectBulletDetail.mock.calls.map((c) => c[0].bullet).sort();
    expect(warmed).toEqual([...ALL_BULLETS].sort());
    for (const call of fetchProjectBulletDetail.mock.calls) {
      expect(call[0]).toMatchObject({ question: "Tell me about an incident.", applicationId: "app-1", engine: "gemini" });
      expect(typeof call[0].title).toBe("string");
      expect(Number.isInteger(call[0].bulletIndex)).toBe(true);
    }
  });

  it("MOBILE: the example group is collapsed, so no control mounts and nothing warms", async () => {
    await mount({ width: PHONE });
    await settle();
    expect(detailButtons().length).toBe(0);
    expect(fetchProjectBulletDetail).not.toHaveBeenCalled();
  });

  it("DESKTOP: a warm opens no control and renders no detail", async () => {
    await mount({ width: DESKTOP });
    await settle();
    for (const b of detailButtons()) expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent || "").not.toContain("A strong candidate might describe the trade-offs.");
  });
});

describe("R2 — a click after a warm opens the warmed record, no second request", () => {
  it("opens the detail and issues no new fetch", async () => {
    await mount({ width: DESKTOP });
    await settle();
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(ALL_BULLETS.length);

    const btn = controlForBullet("Cut alert noise from 5 to 1 per shift");
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent || "").toContain("A strong candidate might describe the trade-offs.");
    // No new call: the click opened a record the warm already filled.
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(ALL_BULLETS.length);
  });
});

describe("R12 — a failing/slow detail never alters the example rows", () => {
  it("a rejecting fetcher leaves both rows' titles and bullets intact", async () => {
    fetchProjectBulletDetail.mockReset();
    fetchProjectBulletDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "http" }));
    await mount({ width: DESKTOP });
    await settle();
    const text = document.body.textContent || "";
    expect(text).toContain(ROW1.title);
    expect(text).toContain(ROW2.title);
    for (const bullet of ALL_BULLETS) expect(text).toContain(bullet);
  });

  it("a never-resolving fetcher does not block the rows from rendering", async () => {
    fetchProjectBulletDetail.mockReset();
    fetchProjectBulletDetail.mockImplementation(() => new Promise(() => {}));
    await mount({ width: DESKTOP });
    // No settle: the rows must already be on screen, nothing on the detail path is awaited.
    const text = document.body.textContent || "";
    expect(text).toContain(ROW1.title);
    expect(text).toContain("Cut alert noise from 5 to 1 per shift");
  });
});

describe("R6/R7 — the control is prose, never an <li>; DOM order and li count", () => {
  it("a ready row's <li> count equals its bullet count (the control adds no <li>)", async () => {
    await mount({ width: DESKTOP });
    await settle();
    // No buzzwords / tech terms in this fixture, so every <li> is an example bullet.
    expect(container.querySelectorAll("li").length).toBe(ALL_BULLETS.length);
  });

  it("the invented lead precedes every [data-bullet-detail] node in DOM order", async () => {
    await mount({ width: DESKTOP });
    await settle();
    const lead = [...container.querySelectorAll("*")].find((n) => (n.textContent || "").includes("Not from your resume."));
    expect(lead, "the invented lead is on screen").toBeTruthy();
    const marked = container.querySelectorAll("[data-bullet-detail]");
    expect(marked.length).toBeGreaterThan(0);
    for (const node of marked) {
      // lead comes before node: DOCUMENT_POSITION_FOLLOWING (4) set on the result.
      expect(lead.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
