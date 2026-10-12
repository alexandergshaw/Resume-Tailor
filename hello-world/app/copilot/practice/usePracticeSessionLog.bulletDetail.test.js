// @vitest-environment jsdom
//
// N158 -- practice mode logs the ideal-project bullet-detail outcome, as live does.
//
// Live (CopilotClient.js) hands its ProjectBulletDetailScope an `onDetailOutcome`
// that writes `projectExample.bulletDetail` with the outcome's status and code
// and nothing else. Practice mounted the same scope with no callback, so the same
// failure was invisible in the downloadable practice log. This pins both halves
// of the fix: the hook's `logProjectBulletDetail` writes exactly that event (the
// {status, code}-only shape, never the bullet, the question, the title or the
// elaboration), and PracticeClient.js actually hands it to the scope -- a hook
// method nobody passes down is the silent-absence this census exists to catch.
//
// Same harness as usePracticeSessionLog.projectExample.test.js: a probe mounted
// with createRoot and `act`, asserted through the hook's returned surface only.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/copilot/sessionLogArchive", () => ({
  downloadSessionLogArchive: vi.fn(() => Promise.resolve()),
}));

import { usePracticeSessionLog } from "./usePracticeSessionLog.js";
import { stripComments } from "../../../lib/sourceScan/tokenizeSource.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = "projectExample.bulletDetail";

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

function Probe({ onState }) {
  onState(usePracticeSessionLog(BASE_PROPS));
  return null;
}

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const captured = {};
  act(() => {
    root.render(createElement(Probe, { onState: (s) => Object.assign(captured, s) }));
  });
  return captured;
}

const detailEvents = (snapshot) => (snapshot?.events || []).filter((e) => e.type === EVENT);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("logProjectBulletDetail writes projectExample.bulletDetail as {status, code} only", () => {
  it("[positive control] a done outcome is logged with its status, and no code field", () => {
    const captured = mountProbe();
    act(() => captured.onStart());
    act(() => captured.logProjectBulletDetail({ status: "done", code: null }));
    const events = detailEvents(captured.sessionLogSnapshot());
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("done");
    // The log omits an undefined field, so a null code leaves no `code` key at
    // all -- the same shape live's `code: outcome.code ?? undefined` produces.
    expect(Object.keys(events[0]).sort()).toEqual(["status", "t", "type"]);
  });

  it("an error outcome carries its code", () => {
    const captured = mountProbe();
    act(() => captured.onStart());
    act(() => captured.logProjectBulletDetail({ status: "error", code: "timeout" }));
    const [event] = detailEvents(captured.sessionLogSnapshot());
    expect(event).toMatchObject({ status: "error", code: "timeout" });
    expect(Object.keys(event).sort()).toEqual(["code", "status", "t", "type"]);
  });

  it("[mutation control] any content the outcome carries never reaches the log", () => {
    const captured = mountProbe();
    act(() => captured.onStart());
    act(() =>
      captured.logProjectBulletDetail({
        status: "error",
        code: "timeout",
        bullet: "BULLET-TEXT-SENTINEL",
        question: "QUESTION-TEXT-SENTINEL",
        title: "TITLE-TEXT-SENTINEL",
        detail: "ELABORATION-TEXT-SENTINEL",
        text: "RAW-TEXT-SENTINEL",
        userId: "USER-ID-SENTINEL",
      }),
    );
    const serialized = JSON.stringify(captured.sessionLogSnapshot());
    expect(detailEvents(captured.sessionLogSnapshot())).toHaveLength(1);
    expect(serialized).not.toMatch(/SENTINEL/);
  });

  it("is a silent no-op before a session starts, and tolerates a missing outcome", () => {
    const captured = mountProbe();
    expect(() => captured.logProjectBulletDetail({ status: "done", code: null })).not.toThrow();
    expect(captured.sessionLogSnapshot()).toBeNull();
    act(() => captured.onStart());
    expect(() => captured.logProjectBulletDetail(undefined)).not.toThrow();
  });
});

describe("PracticeClient.js hands the scope the logger (wiring)", () => {
  const code = stripComments(readFileSync(path.resolve(process.cwd(), "app/copilot/practice/PracticeClient.js"), "utf8"));
  // The opening tag of a scope mount, through the first `>` that is not half of
  // an arrow (`=>`), so an inline callback cannot truncate the window early.
  const openingTag = (name) => new RegExp(`<${name}\\b(?:=>|[^>])*>`).exec(code)?.[0] ?? "";

  it("[canary] the sibling term scope's opening tag is found and carries its logger", () => {
    expect(openingTag("TechTermDetailScope")).toContain("onDetailOutcome={sessionLog.logTechTermDetail}");
  });

  it("the ProjectBulletDetailScope mount passes onDetailOutcome={sessionLog.logProjectBulletDetail}", () => {
    const tag = openingTag("ProjectBulletDetailScope");
    expect(tag).toContain("questions=");
    expect(tag).toContain("onDetailOutcome={sessionLog.logProjectBulletDetail}");
  });
});
