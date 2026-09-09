// @vitest-environment jsdom
//
// The ask-AI box that mounts in the sticky strip beside the question and the
// speaking stats.
//
// WHAT jsdom CAN AND CANNOT SEE HERE, stated up front because getting this
// wrong is how a geometry test passes for the wrong reason: jsdom has NO layout
// engine, so `getBoundingClientRect()` returns zeroes for everything it is not
// explicitly handed and the answer panel's real pixel height is unmeasurable in
// this file. What IS measurable is DECLARED CSS, through
// app/theme/computedStyleAtWidth.js's `atWidth` -- which exists because MUI
// wraps BOTH halves of a responsive `sx` in a `@media (min-width:Npx)` block
// (the `xs` branch included, at min-width:0px) and jsdom evaluates no media
// FEATURES at all, so an unassisted getComputedStyle sees no `sx` rule apply at
// any width.
//
// So the "the answer costs the strip no height" claim is asserted through its
// MECHANISM -- the panel is `position: absolute`, therefore out of flow --
// rather than through a rect this environment cannot produce. The pixel
// measurement is a browser check.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import AskAiBox from "./AskAiBox.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth";
import { MAX_QUESTION_CHARS } from "@/lib/copilot/questionVocabulary";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = readFileSync(path.join(process.cwd(), "app/copilot/dashboard/AskAiBox.js"), "utf8");
const STRIP_SOURCE = readFileSync(
  path.join(process.cwd(), "app/copilot/dashboard/StickyQuestionStrip.js"),
  "utf8",
);

let container;
let root;
let fetchMock;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  global.fetch = fetchMock;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(AskAiBox, props));
  });
}

const input = () => container.querySelector("input[type='text'], input:not([type])");
const form = () => container.querySelector("form");

function respondWith(payload, { status = 200 } = {}) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

async function ask(text) {
  await act(async () => {
    const el = input();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

// ---------------------------------------------------------------------------
// A. It is a textbox, present without being opened
// ---------------------------------------------------------------------------
describe("the box is there to type into, with no step in front of it", () => {
  it("renders a real text input on mount, not a disclosure to click first", async () => {
    await render();
    expect(input()).not.toBeNull();
    // Minimise clicks: asking is type-then-Enter. No trigger, no dialog, no
    // confirmation between the user and their question.
    expect(form()).not.toBeNull();
  });

  it("does not steal focus on mount", async () => {
    // Mid-interview, a control that grabs focus when it appears takes the
    // keyboard away from whatever the candidate was doing.
    const before = document.activeElement;
    await render();
    expect(document.activeElement).toBe(before);
    expect(input().hasAttribute("autoFocus")).toBe(false);
  });

  it("names the field and the submit control without using aria-label", async () => {
    // NOT aria-label, deliberately: StickyQuestionStrip.test.js's AC-31 case
    // asserts that every [aria-label] inside the strip reads exactly "Speaking
    // stats" -- the guard that stops the stats row growing an interpolated
    // label which would re-announce a wpm figure over an interviewer. A real
    // <label for> and hidden button text give the same accessible names without
    // touching that guard. There is no Tooltip on either control, which is what
    // would otherwise STEAL the name and force an aria-label.
    await render();
    const field = input();
    const label = field.id && container.querySelector(`label[for='${field.id}']`);
    expect(label, "the ask field needs a real label").not.toBeNull();
    expect(label.textContent).toMatch(/ask/i);

    const submit = container.querySelector("button[type='submit']");
    expect(submit).not.toBeNull();
    expect(submit.textContent, "an icon-only control needs a name of its own").toMatch(/ask/i);

    // The whole component, so a future control cannot quietly reintroduce one.
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(0);
  });

  it("caps the field at the same number of characters the route refuses past", async () => {
    await render();
    // Imported, not hardcoded: a test asserting a copy of the literal cannot
    // change even when a future audit rules MAX_QUESTION_CHARS should.
    expect(input().getAttribute("maxLength")).toBe(String(MAX_QUESTION_CHARS));
  });
});

// ---------------------------------------------------------------------------
// B. Touch targets
// ---------------------------------------------------------------------------
describe("touch targets clear the 44px floor on phones", () => {
  it("declares a 44px minimum on the field and the submit button at xs", async () => {
    await render();
    const inputRoot = container.querySelector(".MuiInputBase-root");
    expect(inputRoot).not.toBeNull();
    const fieldMin = atWidth(375, () => getComputedStyle(inputRoot).minHeight);
    expect(fieldMin, "TOUCH_FIELD_SX must reach the InputBase root").toBe("44px");

    const submit = container.querySelector("button[type='submit']");
    const buttonMin = atWidth(375, () => getComputedStyle(submit).minHeight);
    expect(buttonMin).toBe("44px");
  });

  it("leaves the desktop size alone above xs", async () => {
    await render();
    const inputRoot = container.querySelector(".MuiInputBase-root");
    const at900 = atWidth(900, () => getComputedStyle(inputRoot).minHeight);
    expect(at900).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// C. The answer costs the strip no height
// ---------------------------------------------------------------------------
describe("an arriving answer never grows the sticky strip", () => {
  it("renders the answer in an absolutely positioned panel, out of flow", async () => {
    respondWith({ answer: "You cut reconciliation lag to 90 seconds.", sources: {}, engine: "embedded" });
    await render();
    await ask("what did I do about lag");

    const panel = container.querySelector("[data-ask-answer]");
    expect(panel, "the answer needs its own panel element").not.toBeNull();
    const position = atWidth(375, () => getComputedStyle(panel).position);
    // `absolute` is the entire mechanism: an out-of-flow box contributes zero
    // to its parent's content height, so the strip measures identically with
    // and without an answer on screen. A `static` or `relative` panel would
    // push the page down by its own height every time an answer arrives.
    expect(position).toBe("absolute");
  });

  it("keeps the same number of IN-FLOW children before and after an answer", async () => {
    respondWith({ answer: "An answer.", sources: {}, engine: "embedded" });
    await render();
    const inFlow = () =>
      [...container.firstElementChild.children].filter(
        (el) => atWidth(375, () => getComputedStyle(el).position) !== "absolute",
      ).length;
    const before = inFlow();
    await ask("anything");
    expect(container.querySelector("[data-ask-answer]")).not.toBeNull();
    expect(inFlow()).toBe(before);
  });

  it("keeps the field single-line so typing a long question cannot grow the strip", async () => {
    await render();
    expect(container.querySelector("textarea"), "a multiline field grows the strip as the user types").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D. Announcement discipline
// ---------------------------------------------------------------------------
describe("the answer is announced once, politely, and never grabs focus", () => {
  it("uses aria-live=polite and never assertive or role=alert", async () => {
    respondWith({ answer: "An answer.", sources: {}, engine: "embedded" });
    await render();
    await ask("anything");
    const live = container.querySelector("[data-ask-live]");
    expect(live).not.toBeNull();
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector("[aria-live='assertive']")).toBeNull();
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("keeps the pending caption OUT of the announced region", async () => {
    // The region carries the settled answer and nothing else. With the caption
    // inside it, every pending transition rewrote it -- so a screen reader read
    // "Asking: <the whole question>" aloud, over an interviewer, before every
    // answer. The panel still SHOWS the caption; it is simply not announced.
    respondWith({ answer: "The settled answer.", sources: {}, engine: "embedded" });
    await render();
    await ask("a question whose text must not be announced");
    const live = container.querySelector("[data-ask-live]");
    expect(live.textContent).toContain("The settled answer.");
    expect(live.textContent).not.toContain("a question whose text must not be announced");
    expect(live.textContent).not.toMatch(/asking/i);
    // …and the caption is still on screen, just outside the region.
    expect(container.querySelector("[data-ask-answer]").textContent).toContain(
      "a question whose text must not be announced",
    );
  });

  it("does not move focus when the answer arrives", async () => {
    respondWith({ answer: "An answer.", sources: {}, engine: "embedded" });
    await render();
    const field = input();
    field.focus();
    await ask("anything");
    expect(document.activeElement).toBe(field);
  });

  it("writes the live region exactly once per answer", async () => {
    respondWith({ answer: "An answer.", sources: {}, engine: "embedded" });
    await render();
    await ask("anything");
    const live = container.querySelector("[data-ask-live]");

    let writes = 0;
    const observer = new MutationObserver((records) => {
      writes += records.length;
    });
    observer.observe(live, { childList: true, characterData: true, subtree: true });

    respondWith({ answer: "A second, different answer.", sources: {}, engine: "embedded" });
    await ask("a second question");
    await act(async () => {});
    observer.disconnect();

    // TWO, not one, and the second is not an announcement. Submitting empties
    // the region (the previous answer is cleared rather than left standing --
    // a stale answer under a new question is worse than a blank space) and the
    // settle refills it. An emptying is not spoken; a fill is. What this bounds
    // is that NOTHING ELSE writes here: a spinner, a pending caption or a
    // per-chunk stream landing in this node would push this well past two and
    // would be read aloud over an interviewer.
    expect(writes).toBeGreaterThan(0);
    expect(writes, "one clear, one settle -- and nothing else").toBeLessThanOrEqual(2);
  });

  it("introduces no heading, so the copilot page's outline is untouched", async () => {
    respondWith({ answer: "An answer.", sources: {}, engine: "embedded" });
    await render();
    await ask("anything");
    expect(container.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E. What the user sees while waiting, and how it closes
// ---------------------------------------------------------------------------
describe("pending, dismissal and errors", () => {
  it("shows the question that is in flight while waiting", async () => {
    let release;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 200, json: async () => ({ answer: "done", sources: {} }) });
      }),
    );
    await render();
    await ask("what is my status");
    expect(container.textContent).toContain("what is my status");
    await act(async () => {
      release();
    });
    expect(container.textContent).toContain("done");
  });

  it("closes on Escape and returns focus to the field", async () => {
    respondWith({ answer: "An answer.", sources: {}, engine: "embedded" });
    await render();
    await ask("anything");
    expect(container.querySelector("[data-ask-answer]")).not.toBeNull();
    await act(async () => {
      container
        .querySelector("[data-ask-answer]")
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector("[data-ask-answer]")).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("never auto-dismisses -- the answer survives a re-render with a new question", async () => {
    respondWith({ answer: "An answer.", sources: {}, engine: "embedded" });
    await render({ applicationId: "app-1" });
    await ask("anything");
    await render({ applicationId: "app-1", currentQuestion: "a newly detected interview question" });
    expect(container.querySelector("[data-ask-answer]")).not.toBeNull();
  });

  it("shows the route's stated refusal rather than an empty answer", async () => {
    respondWith({ error: "Too many requests. Try again shortly." }, { status: 429 });
    await render();
    await ask("anything");
    const panel = container.querySelector("[data-ask-answer]");
    expect(panel.textContent).toMatch(/too many requests/i);
  });

  it("sends nothing at all for a blank question", async () => {
    await render();
    await ask("    ");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to its own route, never to /api/chat", async () => {
    respondWith({ answer: "ok", sources: {}, engine: "embedded" });
    await render({ applicationId: "app-9" });
    await ask("a question");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/copilot/ask");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.applicationId).toBe("app-9");
    expect(sent.question).toBe("a question");
    expect(SOURCE).not.toMatch(/api\/chat/);
  });
});

// ---------------------------------------------------------------------------
// F. It is mounted in the strip
// ---------------------------------------------------------------------------
describe("the strip mounts it", () => {
  it("renders AskAiBox as a direct child of the strip's outer sticky box", () => {
    expect(STRIP_SOURCE).toMatch(/import AskAiBox from "\.\/AskAiBox"/);
    expect(STRIP_SOURCE).toMatch(/<AskAiBox/);
    // Outside the capped, scrolling box -- inside it, the ask field would
    // scroll away with the question, which is the whole thing the strip exists
    // to prevent.
    const cappedBoxAt = STRIP_SOURCE.indexOf("overflowY: \"auto\"");
    const askAt = STRIP_SOURCE.indexOf("<AskAiBox");
    expect(cappedBoxAt).toBeGreaterThan(-1);
    expect(askAt).toBeGreaterThan(cappedBoxAt);
  });

  it("carries no guard of its own, so it renders in every state the strip renders", () => {
    // The three sources it answers from -- the tracking row, the submitted
    // documents and the knowledge base -- are all available BEFORE any question
    // is detected, so nothing about a question may gate it.
    const askAt = STRIP_SOURCE.indexOf("<AskAiBox");
    const line = STRIP_SOURCE.slice(STRIP_SOURCE.lastIndexOf("\n", askAt), askAt);
    expect(line, "no ternary or && guard in front of the ask box").not.toMatch(/\?|&&/);
  });

  it("is reachable PRE-SESSION anyway: both clients mount it in the else branch of their own strip ternary", () => {
    // THIS CASE REPLACES A KNOWN-LIMITATION PIN, and is the one edit to an
    // existing test this change makes. The pin read:
    //
    //   "KNOWN LIMITATION: it inherits the strip's own reachability and is
    //    absent where the strip renders null"
    //
    // and asserted that a stats-only strip whose row is not hosted renders
    // `container.innerHTML === ""` with no `input` anywhere -- which was true
    // of the strip and is STILL true of the strip (the case below re-asserts
    // exactly that, unweakened). What the pin's prose additionally claimed,
    // and what is no longer true, is the consequence it drew from that: "both
    // clients gate the whole strip on `mountStrip` ... so pre-session, the
    // state a candidate most wants this box in, it does not exist at all."
    // That is the limitation being removed, so the case that pins it has to
    // go; leaving it would assert the absence of the feature.
    //
    // The fix is the one the pin itself named -- a sibling mount in the two
    // clients -- shaped as the ELSE BRANCH of the existing `mountStrip`
    // ternary rather than as a free-standing sibling, so that "exactly one
    // instance in every state" is structural: two branches of one conditional
    // cannot both render. The behavioural half of this proof (a real
    // CopilotClient render, pre-session, with the request's `applicationId`
    // read off the wire) is app/copilot/askAiPreSession.test.js; what is
    // checked here is that the strip's own null state -- the reason the pin
    // existed -- is covered at both call sites.
    // Comments stripped before any of it: CopilotClient.js's own `:879` JSX
    // comment says "moved to <StickyQuestionStrip above", and prose naming an
    // element is not a second call site. Block comments (`{/* … */}`) and
    // whole-line `//` comments only — a mid-line `//` strip would truncate a
    // line holding a URL.
    const decomment = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    for (const [name, source] of [
      ["CopilotClient.js", decomment(readFileSync(path.join(process.cwd(), "app/copilot/CopilotClient.js"), "utf8"))],
      [
        "PracticeClient.js",
        decomment(readFileSync(path.join(process.cwd(), "app/copilot/practice/PracticeClient.js"), "utf8")),
      ],
    ]) {
      expect(source, `${name} must import the box`).toMatch(
        /import\s+AskAiBox\s+from\s+["'][^"']*dashboard\/AskAiBox["']/,
      );
      const askAt = source.indexOf("<AskAiBox");
      const stripAt = source.indexOf("<StickyQuestionStrip");
      expect(askAt, `${name} must mount the box`).toBeGreaterThan(-1);
      expect(stripAt, `${name} must still mount the strip`).toBeGreaterThan(-1);
      // Exactly one of each -- a second call site is invisible to every
      // first-index check and is how two ask boxes end up on screen together.
      expect(source.lastIndexOf("<AskAiBox"), `${name} mounts the box twice`).toBe(askAt);
      expect(source.lastIndexOf("<StickyQuestionStrip"), `${name} mounts the strip twice`).toBe(stripAt);
      // …and the box is in the ELSE branch of the strip's own ternary, which
      // is what makes the two mutually exclusive.
      const elseAt = stripAt + /\)\s*:\s*\(/.exec(source.slice(stripAt)).index;
      expect(askAt, `${name} must mount the box in the strip ternary's else branch`).toBeGreaterThan(elseAt);
    }
  });

  it("NARROWED LIMITATION: the strip's own stats-only collapse still takes the box with it", async () => {
    // What survives the fix above, stated exactly rather than left implied.
    // The client ternary is keyed on `mountStrip`, which the clients CAN
    // compute; it cannot see the strip's INTERNAL `statsOnly && measured &&
    // !showStats` early return, which depends on `statsHosted` -- a
    // measurement useStickyTop makes through the very Box that return
    // unmounts, and which no prop reports back out. So in the one remaining
    // state -- a live session, no question detected yet, at least one reading
    // measured, and a viewport too narrow to host the stats row -- the strip
    // renders null, the client is on the strip branch, and there is no ask
    // box. That state is DURING a session, never before one, so the
    // pre-session gap the pin was written for is genuinely closed; this is
    // the residue, and closing it needs a change inside
    // StickyQuestionStrip.js (mounting AskAiBox above its own early return,
    // or a prop that reports the collapse back out).
    const { default: StickyQuestionStrip } = await import("./StickyQuestionStrip.js");
    const header = document.createElement("header");
    header.setAttribute("data-app-header", "");
    document.body.appendChild(header);
    const originalRect = Element.prototype.getBoundingClientRect;
    Object.defineProperty(document.documentElement, "clientHeight", { value: 812, configurable: true });
    document.documentElement.style.fontSize = "16px";
    // A strip too NARROW to host the stats row: `isStatsHostable`'s width
    // clause refuses, so `showStats` is false and the early return fires.
    Element.prototype.getBoundingClientRect = function stubbed() {
      const isHeader = this.nodeType === 1 && this.hasAttribute("data-app-header");
      const width = isHeader ? 0 : 100;
      const height = isHeader ? 51 : 0;
      return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
    };
    try {
      await act(async () => {
        root.render(
          createElement(StickyQuestionStrip, {
            questions: [],
            statsOnly: true,
            sessionLive: true,
            pace: { measured: true, wordsPerMinute: 125, paceLabel: "conversational" },
            fillers: { measured: true, fillerRate: 1, fillerLabel: "clean" },
          }),
        );
      });
      expect(container.innerHTML).toBe("");
      expect(container.querySelector("input")).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      header.remove();
      document.documentElement.style.removeProperty("--sticky-top");
      document.documentElement.style.removeProperty("--sticky-pad");
      document.documentElement.style.scrollPaddingTop = "";
    }
  });

  it("threads applicationId and engine through the strip to the box", () => {
    const askAt = STRIP_SOURCE.indexOf("<AskAiBox");
    const mount = STRIP_SOURCE.slice(askAt, STRIP_SOURCE.indexOf("/>", askAt));
    expect(mount).toMatch(/applicationId=\{applicationId\}/);
    expect(mount).toMatch(/engine=\{engine\}/);
  });
});
