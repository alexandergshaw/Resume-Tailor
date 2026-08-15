// @vitest-environment jsdom
//
// D10: every card in this feed used to render a "Draft answer"/"Redraft"
// button with the SAME accessible name — a screen-reader user tabbing
// through a multi-question session heard "Draft answer button", "Draft
// answer button", ... with no way to tell which question each one belongs
// to. Rendered with react-dom/client (no @testing-library/react in this
// repo), the same idiom app/components/JobDescriptionTab.test.js already
// established as precedent for a full-DOM render under this suite's
// per-file jsdom opt-in.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import QuestionFeed from "./QuestionFeed.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function question(id, text, overrides = {}) {
  return {
    id,
    question: text,
    at: Date.now(),
    status: "idle",
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    type: null,
    error: "",
    speakerTag: null,
    provisional: false,
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(QuestionFeed, props));
  });
}

function draftButtons() {
  return [...container.querySelectorAll("button")].filter((b) =>
    /draft|redraft/i.test(b.getAttribute("aria-label") || b.textContent),
  );
}

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

describe("D10: each card's draft button names its own question", () => {
  it("gives two cards distinct accessible names", async () => {
    await render({
      questions: [
        question(1, "Tell me about a conflict you resolved."),
        question(2, "Why do you want to leave your current role?"),
      ],
      onDraft: vi.fn(),
    });
    const buttons = draftButtons();
    expect(buttons).toHaveLength(2);
    const names = buttons.map((b) => b.getAttribute("aria-label"));
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("Tell me about a conflict you resolved.");
    expect(names[1]).toContain("Why do you want to leave your current role?");
  });

  it("still shows the plain visible label — aria-label adds to it, not replaces the point of it", async () => {
    await render({
      questions: [question(1, "Describe a time you disagreed with a teammate.", { status: "done" })],
      onDraft: vi.fn(),
    });
    const [button] = draftButtons();
    expect(button.textContent).toBe("Redraft");
    expect(button.getAttribute("aria-label")).toBe(
      "Redraft: Describe a time you disagreed with a teammate.",
    );
  });

  // Control: proves the distinct-names assertion can actually fail, not
  // just pass vacuously — the SAME check run against the pre-D10 shape
  // (every button sharing one generic name) must fail.
  it("[control] the distinct-names check fails against the old (broken) shape", () => {
    const oldNames = ["Draft answer", "Draft answer", "Draft answer"];
    expect(new Set(oldNames).size).not.toBe(oldNames.length);
  });
});
