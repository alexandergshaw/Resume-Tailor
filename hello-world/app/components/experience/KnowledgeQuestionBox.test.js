// @vitest-environment jsdom
//
// The grounded question box. Written before
// app/components/experience/KnowledgeQuestionBox.js exists.
//
// WHAT THE MEASUREMENTS FORCE HERE, and why each is asserted the way it is:
//
//   * The control must not be confusable with the shipped `Ask AI` at
//     PageEditor.js:225, which pins a page into the global chat panel. The
//     two cheapest disambiguations are both defects — MUI 9.0.1's Tooltip
//     OVERWRITES the child's accessible name and its text is absent from the
//     DOM before hover, and an aria-label differing from visible text puts
//     that visible text outside the accessible name (WCAG 2.5.3). So the fix
//     is different WORDS ("Answer from these pages", never the token AI), a
//     different SHAPE (a multiline field plus a submit, not a bare button)
//     and a different PLACE. This file asserts the words and the shape.
//
//   * `helperText` auto-wires aria-describedby to a GENERATED id, and
//     supplying slotProps.htmlInput["aria-describedby"] REPLACES it silently.
//     So both targets are spelled out, and this file asserts both ids resolve
//     to elements that exist.
//
//   * `aria-disabled` keeps tabIndex 0 and the click handler STILL FIRES, so
//     the early return is the actual control. The assertion is therefore "the
//     handler did nothing", never "the click was blocked" — and never
//     document.activeElement, because jsdom lets .focus() succeed on a
//     natively disabled button.
//
//   * A citation is a BUTTON, never a link: no page in this app has a URL
//     (measured: zero anchors). A citation to a page that no longer exists is
//     plain text, never a dead control.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import KnowledgeQuestionBox from "./KnowledgeQuestionBox.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function page(id, over = {}) {
  return { id, title: `Title ${id}`, parent_id: null, position: 0, updated_at: "2026-09-01T00:00:00.000Z", archived_at: null, ...over };
}

const PAGES = [page("p1", { title: "Payments platform" }), page("p2", { title: "Kafka migration" }), page("p3", { title: "Archived notes", archived_at: "2026-08-01T00:00:00.000Z" })];

function outcome(over = {}) {
  return {
    version: 1,
    counts: { pagesFetched: 3, pagesInScope: 3, pagesEligible: 3, pagesWithMaterial: 3, pagesRanked: 3, pagesIncluded: 3, attachmentsSkipped: 0, ...(over.counts || {}) },
    countsViolation: null,
    anomaly: null,
    citations: { counts: {}, countsViolation: null, anomaly: null },
    model: {},
    refused: over.refused || [],
    truncatedRead: false,
  };
}

function answerRow(over = {}) {
  return {
    id: "q-1",
    question: "How did we cut p99 latency?",
    answer: "We batched the writes.",
    citations: [{ pageId: "p1" }],
    answered_from_pages: true,
    retrieval_outcome: outcome(),
    status: "ready",
    error: null,
    created_at: "2026-09-05T11:00:00.000Z",
    ...over,
  };
}

function render(over = {}) {
  const props = {
    pagesInScope: 3,
    pages: PAGES,
    draft: "",
    onDraftChange: vi.fn(),
    onAsk: vi.fn(),
    busy: false,
    askError: "",
    answer: null,
    onSelectPage: vi.fn(),
    ...over,
  };
  act(() => {
    root.render(createElement(KnowledgeQuestionBox, props));
  });
  return props;
}

const text = () => container.textContent;
const buttons = () => [...container.querySelectorAll("button")];
const buttonNamed = (name) => buttons().find((b) => (b.textContent || "").trim().toLowerCase().includes(name.toLowerCase()));
const field = () => container.querySelector("textarea:not([aria-hidden])") || container.querySelector("textarea");
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// ==========================================================================

describe("KnowledgeQuestionBox — a different control from the Ask AI already in this tab", () => {
  it("is a multiline field plus a submit, not a bare one-press button", () => {
    render();
    expect(field()).not.toBeNull();
    expect(field().tagName).toBe("TEXTAREA");
    expect(buttonNamed("Answer from these pages")).toBeTruthy();
  });

  it("states the grounding constraint in the control itself, and never uses the token AI", () => {
    render();
    const submit = buttonNamed("Answer from these pages");
    expect(submit.textContent.trim()).toBe("Answer from these pages");
    for (const b of buttons()) {
      expect(/\bAI\b/.test(b.textContent || ""), `control "${b.textContent}" reuses the shipped vocabulary`).toBe(false);
    }
  });

  it("carries no aria-label that differs from its visible text", () => {
    render();
    const submit = buttonNamed("Answer from these pages");
    const label = submit.getAttribute("aria-label");
    expect(label === null || label.includes("Answer from these pages")).toBe(true);
  });

  it("spells out BOTH describedby targets, and both resolve to real elements", () => {
    render({ askError: "That question could not be answered: the model call did not complete." });
    const described = field().getAttribute("aria-describedby");
    expect(described, "the field has no aria-describedby").toBeTruthy();
    const ids = described.split(/\s+/).filter(Boolean);
    // helperText auto-wires ONE generated id and slotProps.htmlInput replaces
    // it silently — so two ids, both resolving, is the whole property.
    expect(ids.length).toBe(2);
    for (const id of ids) {
      expect(document.getElementById(id), `aria-describedby names ${id}, which does not exist`).not.toBeNull();
    }
  });
});

// ==========================================================================

describe("KnowledgeQuestionBox — a blocked submit is aria-disabled, never disabled and never dimmed", () => {
  it("keeps the busy control in the tab order and swaps its label at full contrast", () => {
    render({ busy: true, draft: "why" });
    const submit = buttonNamed("Looking through 3 pages");
    expect(submit).toBeTruthy();
    expect(submit.hasAttribute("disabled")).toBe(false);
    expect(submit.tabIndex).toBe(0);
    expect(submit.getAttribute("aria-disabled")).toBe("true");
  });

  it("lets the click fire and does nothing with it — the early return is the real block", () => {
    const props = render({ busy: true, draft: "why" });
    click(buttonNamed("Looking through 3 pages"));
    expect(props.onAsk.mock.calls.length).toBe(0);
  });

  it("blocks an empty draft the same way, and says why", () => {
    const props = render({ draft: "   " });
    const submit = buttonNamed("Answer from these pages");
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    click(submit);
    expect(props.onAsk.mock.calls.length).toBe(0);
    expect(text().toLowerCase()).toContain("type a question");
  });

  it("asks once when there is something to ask", () => {
    const props = render({ draft: "How did we cut p99 latency?" });
    const submit = buttonNamed("Answer from these pages");
    expect(submit.getAttribute("aria-disabled")).not.toBe("true");
    click(submit);
    expect(props.onAsk.mock.calls.length).toBe(1);
  });
});

// ==========================================================================

describe("KnowledgeQuestionBox — the answer and its sources", () => {
  it("lists the pages the answer used as BUTTONS that change the selection, with zero anchors", () => {
    const props = render({ answer: answerRow() });
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(container.querySelectorAll("[href]").length).toBe(0);
    const source = buttonNamed("Payments platform");
    expect(source).toBeTruthy();
    click(source);
    expect(props.onSelectPage.mock.calls).toEqual([["p1"]]);
  });

  it("renders a citation to a DELETED page as plain text, never a dead control", () => {
    render({ answer: answerRow({ citations: [{ pageId: "ghost" }] }) });
    expect(buttons().some((b) => (b.textContent || "").includes("ghost"))).toBe(false);
    expect(text()).toContain("A page this answer used has since been deleted.");
    expect(container.querySelectorAll("a").length).toBe(0);
  });

  it("renders a citation to an ARCHIVED page as plain text too, and names it", () => {
    render({ answer: answerRow({ citations: [{ pageId: "p3" }] }) });
    const asButton = buttons().find((b) => (b.textContent || "").includes("Archived notes"));
    expect(asButton).toBeUndefined();
    expect(text()).toContain("Archived notes");
    expect(text()).toContain("archived");
  });

  it("gives the three no-citation outcomes three different sentences", () => {
    const seen = [];
    for (const answered of [true, false, null]) {
      render({ answer: answerRow({ citations: [], answered_from_pages: answered }) });
      seen.push(container.querySelector("[data-kb-sources]").textContent.trim());
    }
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(3);
    // The discriminator is WHAT HAPPENED, not what is absent.
    expect(seen[0]).toContain("did not name which ones");
    expect(seen[1]).toContain("could not answer this from these pages");
    expect(seen[2]).toContain("did not return its sources in a form we could read");
  });

  it("puts the shortfall sentence NEXT TO the answer, not only in the panel's coverage notice", () => {
    render({
      answer: answerRow({
        answered_from_pages: false,
        citations: [],
        retrieval_outcome: outcome({ counts: { pagesFetched: 20, pagesInScope: 20, pagesEligible: 20, pagesWithMaterial: 20, pagesRanked: 20, pagesIncluded: 8 } }),
      }),
    });
    const shortfall = container.querySelector("[data-kb-shortfall]");
    expect(shortfall).not.toBeNull();
    expect(shortfall.textContent).toContain("8");
    expect(shortfall.textContent).toContain("20");
    expect(text()).toContain("not finding it here does not mean it is not written down");
  });

  it("draws no shortfall sentence when every page with material was in the context", () => {
    render({ answer: answerRow() });
    expect(container.querySelector("[data-kb-shortfall]")).toBeNull();
  });

  it("discloses, as a count, the sources the model named that matched no page in this scope", () => {
    render({ answer: answerRow({ retrieval_outcome: outcome({ refused: [{ reason: "not-in-scope", count: 2 }] }) }) });
    expect(text()).toContain("2 sources the model named did not match any page in this scope");
  });

  it("says a failed question failed, and does not present the empty answer as an answer", () => {
    render({ answer: answerRow({ status: "failed", answer: "", citations: [], answered_from_pages: null, error: "The model returned no text at all." }) });
    expect(text()).toContain("That question could not be answered: The model returned no text at all.");
    expect(container.querySelector("[data-kb-sources]")).toBeNull();
  });

  it("surfaces a refusal that never became a row at all", () => {
    render({ askError: "Answering from your pages needs the Gemini engine. Switch off the embedded engine and try again." });
    expect(text()).toContain("Switch off the embedded engine");
  });
});
