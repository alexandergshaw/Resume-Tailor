// @vitest-environment jsdom
//
// ARCH §4e/AC-6: AnswerLines is the one place a drafted answer's lines are
// rendered (see AnswerLines.js's own doc), so it is also the one place the
// knowledge-base citation lib/copilot/answerPoints.js's answerLines()
// resolves per line has to actually reach the screen. Two claims:
//
//   1. A line carrying a `pageSource` renders it, as READABLE TEXT (never
//      colour alone — WCAG 1.4.1), inside the SAME `<li>` as its point, in
//      reading order, so a screen reader announces them as one item.
//   2. A line with no `pageSource` renders nothing extra for it — no
//      placeholder, no empty row — and a whole draft with no citations at
//      all renders byte-identical to before the field existed (AC-6.3).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerLines from "./AnswerLines.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});

async function render(lines) {
  await act(async () => {
    root.render(createElement(AnswerLines, { lines }));
  });
  return container;
}

describe("AnswerLines — per-point knowledge-base citation", () => {
  it("renders the page title, as text, inside the same <li> as the point", async () => {
    const el = await render([
      { label: "", cue: "", point: "We moved settlement onto Kafka.", pageSource: { id: "p1", title: "Payments migration" } },
    ]);
    const items = el.querySelectorAll("li");
    expect(items).toHaveLength(1);
    // Same <li>, not a sibling element and not a separate list — reading
    // order is point, then source, inside one item (AC-6.4's "one item").
    expect(items[0].textContent).toContain("We moved settlement onto Kafka.");
    expect(items[0].textContent).toContain("Payments migration");
    expect(items[0].textContent).toMatch(/from your/i);
    // Real text content, not merely a colour/style difference a screen
    // reader or a black-and-white printout would lose (WCAG 1.4.1).
    const sourceNode = Array.from(items[0].querySelectorAll("span")).find((n) =>
      /Payments migration/.test(n.textContent || ""),
    );
    expect(sourceNode).toBeTruthy();
    expect(sourceNode.textContent.trim().length).toBeGreaterThan(0);
  });

  it("renders nothing extra for a line with no page source", async () => {
    const el = await render([
      { label: "", cue: "", point: "We moved settlement onto Kafka.", pageSource: null },
    ]);
    const li = el.querySelector("li");
    expect(li.textContent).not.toMatch(/from your/i);
    // No placeholder/empty wrapper left behind for the missing citation: a
    // line with neither a cue nor a page source is plain text with no child
    // elements at all inside its <li>.
    expect(li.children.length).toBe(0);
  });

  it("renders byte-identical output to a draft with no citations at all when every line carries none (AC-6.3)", async () => {
    const lines = [
      { label: "Situation", cue: "The migration", point: "We were losing settlements.", pageSource: null },
      { label: "", cue: "", point: "We rebuilt it on Kafka.", pageSource: null },
    ];
    const el = await render(lines);
    expect(el.textContent).not.toMatch(/from your/i);
    expect(el.querySelectorAll("li")).toHaveLength(2);
  });

  it("handles a mixed draft — only the lines with a source show one", async () => {
    const el = await render([
      { label: "", cue: "", point: "Point one.", pageSource: { id: "p1", title: "Payments migration" } },
      { label: "", cue: "", point: "Point two.", pageSource: null },
    ]);
    const items = el.querySelectorAll("li");
    expect(items[0].textContent).toMatch(/from your/i);
    expect(items[1].textContent).not.toMatch(/from your/i);
  });
});
