// @vitest-environment jsdom
//
// N143 seam 7 (T14) — the honesty-of-status fixtures for the two invented
// project-example rows, rendered through the REAL AnswerAids component (the
// thing under test, per measurement-instruments). RED on HEAD: AnswerAids takes
// only { buzzwords, anchor } and renders neither row nor the invented-examples
// group, so with only example data supplied it returns null and renders "".
//
// The lie this file exists to prevent (AC-13/-14): an invented project read as
// the candidate's real work ends an interview. So every ready row must open
// with the invented lead; a pending/failed/no_match entry must NEVER surface as
// a ready benchmark; and an entry with a missing/false `hypothetical` flag must
// STILL render as hypothetical (ambiguous provenance renders AS hypothetical).
//
// Pinned strings are from UX r1 §3.2 (a TDD seat may assert them verbatim;
// changing one is a ruling, not an edit).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerAids from "./AnswerAids.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LEAD_BOLD = "Not from your resume.";
const GROUP_LABEL = "Example projects (invented)";
const DT_READY = "Ready example";
const DT_LIVE = "Example for this question";
const R1_WARMING = "Still being prepared. Shows from your next question.";
const R1_NO_MATCH = "No close match for this question.";
const R1_FAILED = "Couldn't prepare examples for this posting.";
const R2_PENDING = "Writing one for this question";
const R2_FAILED = "Couldn't write one this time.";

const READY = (over = {}) => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within the target"],
  hypothetical: true,
  engine: "gemini",
  ...over,
});

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
  // Read document.body, not just container: MUI portals (Tooltip/Popper) land
  // on body, and we want to see everything the component produced.
  return { text: document.body.textContent || "", root: container };
}

describe("Row 1 ready — the invented lead and the content (T14 / AC-13)", () => {
  it("[positive control] renders the group, the lead, the title and the bullets", async () => {
    const { text } = await render({ projectExample: READY() });
    expect(text).toContain(GROUP_LABEL);
    expect(text).toContain(DT_READY);
    expect(text).toContain(LEAD_BOLD);
    expect(text).toMatch(/invented/i);
    expect(text).toContain("Rebuilt the paging rotation");
    expect(text).toContain("Cut alert noise from 5 to 1 per shift");
  });

  it("renders the bullets as real list items under a ready entry", async () => {
    const { root: el } = await render({ projectExample: READY() });
    const items = el.querySelectorAll("li");
    const bulletTexts = Array.from(items).map((li) => li.textContent);
    expect(bulletTexts.some((t) => t.includes("Mean time to ack within the target"))).toBe(true);
  });
});

describe("Row 1 pending/no_match/failed — quiet lines, never a fabricated benchmark (AC-14 ii)", () => {
  it("pending shows the warming line and NO bullets, NO title", async () => {
    const { root: el, text } = await render({ projectExample: { status: "pending" } });
    expect(text).toContain(R1_WARMING);
    expect(text).not.toContain("Rebuilt the paging rotation");
    expect(el.querySelectorAll("li").length).toBe(0);
  });

  it("no_match shows the no-close-match line and no benchmark content", async () => {
    const { root: el, text } = await render({ projectExample: { status: "no_match" } });
    expect(text).toContain(R1_NO_MATCH);
    expect(el.querySelectorAll("li").length).toBe(0);
  });

  it("failed shows the failed line and no benchmark content", async () => {
    const { root: el, text } = await render({ projectExample: { status: "failed" } });
    expect(text).toContain(R1_FAILED);
    expect(el.querySelectorAll("li").length).toBe(0);
  });

  it("[mutation control] a pending entry that still carries stale content never renders it as ready", async () => {
    // A consumer that reads the carried title/bullets regardless of status
    // reds here — the no-overclaim breaking fixture (AC-14 iii).
    const { text } = await render({
      projectExample: { ...READY(), status: "pending" },
    });
    expect(text).toContain(R1_WARMING);
    expect(text).not.toContain("Rebuilt the paging rotation");
    expect(text).not.toContain("Cut alert noise from 5 to 1 per shift");
  });
});

describe("ambiguous provenance renders AS hypothetical (AC-13 / UX 4.3)", () => {
  it("a ready entry with hypothetical missing still shows the invented lead", async () => {
    const row = READY();
    delete row.hypothetical;
    const { text } = await render({ projectExample: row });
    expect(text).toContain(LEAD_BOLD);
    expect(text).toContain("Rebuilt the paging rotation");
  });

  it("a ready entry with hypothetical:false still shows the invented lead (never a real-project treatment)", async () => {
    const { text } = await render({ projectExample: READY({ hypothetical: false }) });
    expect(text).toContain(LEAD_BOLD);
  });
});

describe("Row 2 — live example states (T14 / AC-10)", () => {
  it("[positive control] a ready Row 2 renders its own lead and content", async () => {
    const { text } = await render({ projectExampleLive: READY({ title: "Scaled a read-replica fleet" }) });
    expect(text).toContain(DT_LIVE);
    expect(text).toContain(LEAD_BOLD);
    expect(text).toContain("Scaled a read-replica fleet");
  });

  it("Row 2 pending shows a STATIC skeleton (no pulse/wave) with aria-busy and no benchmark text", async () => {
    const { root: el, text } = await render({
      projectExample: READY(),
      projectExampleLive: { status: "pending" },
    });
    expect(text).toContain(R2_PENDING);
    const skeletons = el.querySelectorAll(".MuiSkeleton-root");
    expect(skeletons.length).toBeGreaterThan(0);
    for (const sk of skeletons) {
      expect(sk.className).not.toMatch(/MuiSkeleton-pulse|MuiSkeleton-wave/);
    }
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("Row 2 failed shows the failed line, no skeleton", async () => {
    const { root: el, text } = await render({
      projectExample: READY(),
      projectExampleLive: { status: "failed" },
    });
    expect(text).toContain(R2_FAILED);
    expect(el.querySelectorAll(".MuiSkeleton-root").length).toBe(0);
  });
});

describe("the group's existence boundary (UX-N143-2)", () => {
  it("renders the examples group when ONLY example data exists (no anchor, no buzzwords)", async () => {
    const { text } = await render({ anchor: null, buzzwords: [], projectExample: READY() });
    expect(text).toContain(GROUP_LABEL);
  });

  it("still renders nothing at all when there is truly nothing to show", async () => {
    const { text } = await render({ anchor: null, buzzwords: [] });
    expect(text.trim()).toBe("");
  });

  it("the component gains no fetch/model/Supabase import — it stays presentational", async () => {
    // jsdom gives import.meta.url a non-file scheme, so read from cwd
    // (vitest runs from hello-world).
    const { readFileSync } = await import("node:fs");
    const path = (await import("node:path")).default;
    const src = readFileSync(path.resolve(process.cwd(), "app/copilot/AnswerAids.js"), "utf8");
    expect(src).not.toMatch(/fetch\(|getGeminiClient|generateContent|interactions\.create/);
    expect(src).not.toMatch(/@\/lib\/supabase|createClient/);
  });
});
