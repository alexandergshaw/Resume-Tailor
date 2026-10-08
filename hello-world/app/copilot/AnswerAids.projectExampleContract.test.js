// @vitest-environment jsdom
//
// N143 seam 7 (T15) — the DOM contract and collapse for the invented-examples
// group (UX r1 §7.3 / UX-N143-1,-3,-13,-14,-15). This is the stable surface
// N144 restyles, so it is pinned structurally, not by pixels (pixel/height is
// owner/N144, not jsdom — measurement-instruments).
//
// RED on HEAD: AnswerAids renders no third group, no group header button, no
// separator for it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerAids from "./AnswerAids.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GROUP_LABEL = "Example projects (invented)";
const WORDS_LABEL = "Words from the posting to work in";

const READY = () => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
  engine: "gemini",
});

const anchor = { title: "Senior Engineer", company: "Initech", project: "Payments migration", description: [], matched: true, source: "resume" };

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
  await act(async () => {
    root.render(createElement(AnswerAids, props));
  });
  return container;
}

function click(el) {
  return act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("the invented-examples group is LAST, labelled, and its own dl (UX-N143-1,-3)", () => {
  it("[0-click default] renders the group open with content visible and no interaction", async () => {
    const el = await render({ anchor, buzzwords: ["latency", "SLA"], projectExample: READY() });
    expect(el.textContent).toContain(GROUP_LABEL);
    expect(el.textContent).toContain("Rebuilt the paging rotation");
  });

  it("places the examples group AFTER the posting-words group in DOM order", async () => {
    const el = await render({ anchor, buzzwords: ["latency", "SLA"], projectExample: READY() });
    const full = el.textContent || "";
    const wordsIdx = full.indexOf(WORDS_LABEL);
    const groupIdx = full.indexOf(GROUP_LABEL);
    expect(wordsIdx).toBeGreaterThanOrEqual(0);
    expect(groupIdx).toBeGreaterThan(wordsIdx);
  });

  it("names the group via a role=group whose accessible name is the header text", async () => {
    const el = await render({ anchor, buzzwords: ["latency"], projectExample: READY() });
    const group = el.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    const labelledBy = group.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const header = el.querySelector(`#${CSS.escape(labelledBy)}`) || document.getElementById(labelledBy);
    expect(header).not.toBeNull();
    expect(header.textContent).toContain(GROUP_LABEL);
  });

  it("uses no CSS `order` on any aids element (reading order = DOM order)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = (await import("node:path")).default;
    const src = readFileSync(path.resolve(process.cwd(), "app/copilot/AnswerAids.js"), "utf8");
    expect(src).not.toMatch(/\border:\s*\d/);
  });
});

describe("the group header is a native disclosure button, default open (UX-N143-13)", () => {
  it("renders a native <button> header with aria-expanded and aria-controls, expanded by default", async () => {
    const el = await render({ anchor, buzzwords: ["latency"], projectExample: READY() });
    const buttons = Array.from(el.querySelectorAll("button"));
    const header = buttons.find((b) => (b.textContent || "").includes(GROUP_LABEL));
    expect(header, "a native button whose name contains the group label").not.toBeUndefined();
    expect(header.tagName).toBe("BUTTON");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.getAttribute("aria-controls")).toBeTruthy();
  });

  it("collapsing via the header hides the group content and flips aria-expanded", async () => {
    const el = await render({ anchor, buzzwords: ["latency"], projectExample: READY() });
    const header = Array.from(el.querySelectorAll("button")).find((b) => (b.textContent || "").includes(GROUP_LABEL));
    expect(header, "header button present").not.toBeUndefined();
    await click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: the benchmark content is out of the DOM (or hidden), so the
    // candidate's chosen "hide" actually hides.
    expect(el.textContent).not.toContain("Rebuilt the paging rotation");
  });

  it("persists the collapse through createChoiceStore under the agreed key", async () => {
    // The persistence wiring the UX specifies (default open, storage-throw-safe
    // — the store's own tested behaviour). Pinned at the source so a build that
    // forgets persistence, or invents a second storage key, is visible.
    const { readFileSync } = await import("node:fs");
    const path = (await import("node:path")).default;
    const src = readFileSync(path.resolve(process.cwd(), "app/copilot/AnswerAids.js"), "utf8");
    expect(src).toContain("copilot-example-projects");
  });
});
