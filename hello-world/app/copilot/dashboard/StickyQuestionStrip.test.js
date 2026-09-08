// @vitest-environment jsdom
//
// ARCH-sticky. CurrentQuestionPanel moved OUT of CopilotDashboard.js and into
// this strip (mounted once per client, above the bounded live wrapper /
// PracticeControls row — see CopilotClient.js/PracticeClient.js's own mount
// sites). CopilotDashboard.render.test.js used to pin this panel's rendered
// content; those assertions move here with it, because after the relocation
// render.test.js never renders this panel at all.
//
// WHAT IS NOT ASSERTED HERE, AND WHY: jsdom has no layout engine, so nothing
// about the cap actually binding, the strip actually sticking, or it
// occluding (or not occluding) anything is checked — those are the manual
// browser checks stickyQuestionGuards.test.js's own header names. This file
// covers the one thing jsdom CAN see: what CurrentQuestionPanel/
// StickyQuestionStrip put on screen for a given set of props.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import StickyQuestionStrip from "./StickyQuestionStrip.js";
import { LIVE_COPY, PRACTICE_COPY } from "@/lib/copilot/dashboardCopy";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Tell me about a time you disagreed with your manager.";

function entry(overrides = {}) {
  return { id: "q1", question: QUESTION, provisional: false, ...overrides };
}

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
  // ARCH-sticky §3.4: useStickyTop.js writes two custom properties and a
  // scroll-padding onto document.documentElement and removes them on
  // unmount — asserted directly in useStickyTop.test.js, cleaned up here so
  // one test's DOM state can never leak into the next.
  document.documentElement.style.removeProperty("--sticky-top");
  document.documentElement.style.removeProperty("--sticky-pad");
  document.documentElement.style.scrollPaddingTop = "";
});

async function render(props) {
  await act(async () => {
    root.render(createElement(StickyQuestionStrip, props));
  });
}

function text() {
  return container.textContent || "";
}

function heading() {
  const h3 = container.querySelector("h1,h2,h3,h4,h5,h6");
  return h3 ? { level: Number(h3.tagName.slice(1)), text: h3.textContent.trim() } : null;
}

describe("StickyQuestionStrip: the plain (RealPanel) state", () => {
  it("renders the title at h3 — one level above where it sat inside CopilotDashboard's own h3", async () => {
    // ARCH-sticky §4: the strip has no container heading of its own, so the
    // question's heading rises to h3 (a SIBLING of "Live dashboard", not a
    // child of it) — see copilotHeadingOrder.test.js's G-1 for the
    // client-scoped proof that this sits correctly relative to the rest of
    // the page; this only proves the strip itself asks for h3.
    await render({ questions: [entry()] });
    expect(heading()).toEqual({ level: 3, text: LIVE_COPY.currentQuestionTitle });
    expect(text()).toContain(QUESTION);
  });

  it("falls back to the noQuestion copy when there is nothing to show yet", async () => {
    await render({ questions: [] });
    expect(text()).toContain(LIVE_COPY.noQuestion);
    expect(text()).not.toContain(QUESTION);
  });

  it("merges a partial `copy` object over the live defaults rather than replacing them", async () => {
    // ARCH-sticky §2.7/F10: `dashboardCopy()` merges over a module-local
    // default so a caller supplying only PART of the copy object still gets
    // a complete one — the exact failure mode a residual `{...undefined}`
    // import would silently reproduce.
    await render({ questions: [entry()], copy: { title: "Practice dashboard" } });
    expect(heading()).toEqual({ level: 3, text: LIVE_COPY.currentQuestionTitle });
  });
});

describe("StickyQuestionStrip: the provisional (AccentPanel) state — [R-166]", () => {
  it('a provisional entry gets the accent card and its "Unconfirmed" chip', async () => {
    // This branch describes a REAL detected utterance of unclear speaker —
    // the opposite uncertainty from a guess about the future — and shares
    // the accent wrapper the (now-removed) prediction panels used. Removing
    // that wrapper along with its other callers would silently take this
    // with it, and the candidate's own speech would then be presented as
    // the interviewer's question with nothing to tell them apart.
    await render({ questions: [entry({ provisional: true })] });
    expect(text()).toContain("Unconfirmed");
    expect(text()).toContain(QUESTION);
    expect(text()).toContain("Not confirmed as the interviewer");
  });
});

describe("StickyQuestionStrip: the held (HeldQuestionPanel) state", () => {
  it("shows the badge, the question, and a release control naming the arrival count", async () => {
    await render({
      questions: [entry()],
      pinnedId: "q1",
      held: true,
      newerQuestionCount: 2,
      onReleasePin: () => {},
    });
    expect(text()).toMatch(/held on screen/i);
    expect(text()).toContain(QUESTION);
    const release = [...container.querySelectorAll("button")].find((b) => /release hold/i.test(b.textContent));
    expect(release).toBeTruthy();
    expect(release.textContent).toMatch(/2 newer questions/);
  });

  it("says just \"Release hold\" with no count when nothing newer has arrived", async () => {
    await render({ questions: [entry()], pinnedId: "q1", held: true, newerQuestionCount: 0, onReleasePin: () => {} });
    const release = [...container.querySelectorAll("button")].find((b) => /release hold/i.test(b.textContent));
    expect(release.textContent.trim()).toBe("Release hold");
  });

  it("calls onReleasePin when the release control is clicked", async () => {
    let released = 0;
    await render({
      questions: [entry()],
      pinnedId: "q1",
      held: true,
      newerQuestionCount: 1,
      onReleasePin: () => {
        released += 1;
      },
    });
    const release = [...container.querySelectorAll("button")].find((b) => /release hold/i.test(b.textContent));
    await act(async () => {
      release.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(released).toBe(1);
  });

  it("swaps the caption once the session is no longer live — Defect 3", async () => {
    await render({ questions: [entry()], pinnedId: "q1", held: true, live: true });
    expect(text()).toMatch(/detection and drafting keep running/i);

    await render({ questions: [entry()], pinnedId: "q1", held: true, live: false });
    expect(text()).toMatch(/this session has ended/i);
  });

  it("held is checked before provisional — a held AND provisional entry still gets the warning treatment", async () => {
    await render({ questions: [entry({ provisional: true })], pinnedId: "q1", held: true, newerQuestionCount: 0 });
    expect(text()).toMatch(/held on screen/i);
    expect(text()).not.toContain("Unconfirmed");
  });
});

describe("StickyQuestionStrip: practice mode's own wording", () => {
  it("renders PRACTICE_COPY's noQuestion sentence, not live's", async () => {
    await render({ questions: [], copy: PRACTICE_COPY });
    expect(text()).toContain(PRACTICE_COPY.noQuestion);
    expect(text()).not.toContain(LIVE_COPY.noQuestion);
  });

  it("practice mode never reaches the held branch — it passes no pinnedId/held at all", async () => {
    // PracticeClient.js's own mount site (below) passes only `questions` and
    // `copy` — `held` defaults to `false` here exactly as it used to default
    // on CopilotDashboard, which is what keeps practice byte-identical.
    await render({ questions: [entry()], copy: PRACTICE_COPY });
    expect(text()).not.toMatch(/held on screen/i);
  });
});

describe("both mount predicates — the strip must not pin the no-question fallback over Start", () => {
  // jsdom's own URL implementation does not round-trip through
  // node:url's fileURLToPath the way it does in this suite's node-
  // environment test files, so this file reads by plain path instead — the
  // same pattern CopilotDashboard.render.test.js (also jsdom) already uses.
  const CLIENT_SOURCE = readFileSync(path.join(process.cwd(), "app/copilot/CopilotClient.js"), "utf8");
  const PRACTICE_SOURCE = readFileSync(
    path.join(process.cwd(), "app/copilot/practice/PracticeClient.js"),
    "utf8",
  );

  it("live: mountStrip is `questions.length > 0 || held`", () => {
    // The `|| held` disjunct is redundant in production (questionPin.js:
    // 70-79 guarantees held implies questions.length > 0) and exists solely
    // so CopilotClient.wiring.test.js:243-257 can reach the held branch with
    // questions === [] (it mocks useLiveSession, and `questions` is this
    // component's own useState([]) rather than a hook field) — see the
    // `mountStrip` declaration's own comment in CopilotClient.js.
    expect(CLIENT_SOURCE).toMatch(/const mountStrip = questions\.length > 0 \|\| held;/);
  });

  it("live: the strip's mount site is gated on mountStrip, and sits ahead of the bounded wrapper", () => {
    const mountIdx = CLIENT_SOURCE.indexOf("mountStrip ? (");
    const stickyIdx = CLIENT_SOURCE.indexOf("<StickyQuestionStrip", mountIdx);
    const wrapperOpen = CLIENT_SOURCE.indexOf("ref={liveWrapperRef}");
    expect(mountIdx).toBeGreaterThan(-1);
    expect(stickyIdx).toBeGreaterThan(mountIdx);
    expect(stickyIdx).toBeLessThan(wrapperOpen);
  });

  it("practice: mounted only once dashboardQuestions is non-empty — the same array's own emptiness check", () => {
    // PracticeClient.js:319-320's `if (!currentQuestionText) return [];` is
    // the SAME fact this predicate reads — a pre-session mount would pin
    // PRACTICE_COPY.noQuestion over PracticeControls, the component that
    // holds Start, just above this mount site.
    expect(PRACTICE_SOURCE).toMatch(/dashboardQuestions\.length > 0 \? \(\s*<StickyQuestionStrip/);
  });

  it("practice: the mount site sits after <PracticeControls closes, not before", () => {
    const controlsClose = PRACTICE_SOURCE.indexOf("downloadLogEnabled={sessionLog.hasLog}");
    const stickyIdx = PRACTICE_SOURCE.indexOf("<StickyQuestionStrip");
    expect(controlsClose).toBeGreaterThan(-1);
    expect(stickyIdx).toBeGreaterThan(controlsClose);
  });
});
