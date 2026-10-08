// @vitest-environment jsdom
//
// N143 fix round F1, m5 -- the practice-mode half of the owner probe's evidence.
//
// AC-N143-Q's discriminators (docs/loop/N143.probe.md) need the session log to
// say, for each shown pick, which entry won AND what else was in the pool: "the
// pool had a better entry" (selection picked wrong), "every entry clusters on
// one competency" (the pool is too narrow) and "nothing in the pool fits" (the
// model ignored the role's domain) cannot be told apart from the winner alone.
// The server puts `fitScore` and `poolTags` on the ready / no_match value; this
// pins that the practice log carries them into the downloadable record, and
// that a status that has none (pending, failed) logs none.
//
// Same harness as usePracticeSessionLog.test.js: a probe mounted with createRoot
// and `act`, driven by re-rendering with updated props, asserted only through
// the hook's own returned surface plus the real Markdown renderer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/sessionLogArchive", () => ({
  downloadSessionLogArchive: vi.fn(() => Promise.resolve()),
}));

import { usePracticeSessionLog } from "./usePracticeSessionLog.js";
import { renderSessionLogMarkdown } from "@/lib/copilot/sessionLog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_PROPS = {
  start: () => {},
  posting: null,
  interviewType: "general",
  currentQuestionText: "",
  questionError: "",
  finals: [],
  captureError: "",
  captureWarning: "",
  answering: false,
  answerMetrics: null,
  critique: null,
  critiqueStatus: "idle",
  critiqueError: "",
};

function Probe({ hookProps, onState }) {
  onState(usePracticeSessionLog(hookProps));
  return null;
}

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const captured = {};
  let current = { ...BASE_PROPS };
  function renderNow() {
    act(() => {
      root.render(createElement(Probe, { hookProps: current, onState: (s) => Object.assign(captured, s) }));
    });
  }
  renderNow();
  return {
    captured,
    update(patch) {
      current = { ...current, ...patch };
      renderNow();
      return captured;
    },
  };
}

const shown = (snapshot) => (snapshot?.events || []).filter((e) => e.type === "projectExample.shown");

const POOL_TAGS = [
  { competency: "incident response", domain: "SRE", title: "Rebuilt the paging rotation" },
  { competency: "curriculum design", domain: "K-12 teaching", title: "Rebuilt the fractions unit" },
  { competency: "capacity planning", domain: "cloud infrastructure", title: "Forecast the quarter's load" },
];

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("projectExample.shown carries the probe's evidence (m5)", () => {
  it("[positive control] a ready pick logs its tag AND the fit score AND the whole pool", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({
      projectExample: {
        status: "ready",
        competency: "incident response",
        domain: "SRE",
        title: "Rebuilt the paging rotation",
        bullets: ["Cut pages from 9 to 2", "Halved the backlog"],
        hypothetical: true,
        fitScore: 2,
        poolTags: POOL_TAGS,
      },
    });
    const events = shown(captured.sessionLogSnapshot());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "ready", competency: "incident response", domain: "SRE", fitScore: 2 });
    expect(events[0].poolTags).toEqual(POOL_TAGS);
    // Tags and titles only: the example's own bullets are not in the log.
    expect(JSON.stringify(events[0])).not.toContain("Cut pages from 9 to 2");
  });

  it("a no_match logs the near-miss score and the pool it failed to match", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ projectExample: { status: "no_match", fitScore: 0, poolTags: POOL_TAGS } });
    const [event] = shown(captured.sessionLogSnapshot());
    expect(event.status).toBe("no_match");
    expect(event.fitScore).toBe(0);
    expect(event.poolTags).toHaveLength(3);
  });

  it("[mutation control] a pending or failed value logs no score and no pool", () => {
    for (const projectExample of [{ status: "pending" }, { status: "failed" }]) {
      const { captured, update } = mountProbe();
      act(() => captured.onStart());
      update({ projectExample });
      const [event] = shown(captured.sessionLogSnapshot());
      expect(event.status).toBe(projectExample.status);
      expect(event).not.toHaveProperty("fitScore");
      expect(event).not.toHaveProperty("poolTags");
    }
  });

  it("reaches the downloadable Markdown, where the owner reads it", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ projectExample: { status: "no_match", fitScore: 0, poolTags: POOL_TAGS } });
    const markdown = renderSessionLogMarkdown(captured.sessionLogSnapshot());
    expect(markdown).toContain("projectExample.shown");
    expect(markdown).toContain("Rebuilt the fractions unit");
    expect(markdown).toContain("capacity planning");
  });

  it("carries no user id, posting or resume text", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ projectExample: { status: "ready", competency: "c", domain: "d", fitScore: 1, poolTags: POOL_TAGS } });
    const text = JSON.stringify(shown(captured.sessionLogSnapshot()));
    expect(text).not.toMatch(/user[._]?id|userId|resume|description/i);
  });
});
