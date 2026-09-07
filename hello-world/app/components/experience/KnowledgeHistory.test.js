// @vitest-environment jsdom
//
// The per-scope question history. Written before
// app/components/experience/KnowledgeHistory.js exists.
//
// THE TWO DESTRUCTION RULES THIS FILE PINS, and why they differ:
//
//   * Deleting ONE question is one click plus a 5-second Undo, NOT a confirm.
//     AttachmentPanel.js:33's UNDO_WINDOW_MS = 5000 is the precedent, in this
//     very directory. Inside the undo window nothing has been destroyed, so
//     the repo's own rule — confirm only when the action destroys the only
//     copy (BulkActionsBar.js:462-468) — is satisfied rather than excepted.
//     An undo is strictly stronger than a confirm: it protects against the
//     mis-click AND the changed mind, and costs one click instead of two.
//
//   * Bulk Clear DOES confirm, inline, count named, autoFocus on the
//     non-destructive button — per-row undo cannot restore a set the user can
//     no longer enumerate, and N undo alerts would be worse than one confirm.
//     `Clear all` is not rendered at all at one row or fewer: a "Clear all"
//     over a single row is a worse-labelled delete button.
//
// The confirm is INLINE and never a nested dialog: a second modal inside a
// focus trap nests two traps and makes Escape ambiguous.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import KnowledgeHistory from "./KnowledgeHistory.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function page(id, over = {}) {
  return { id, title: `Title ${id}`, parent_id: null, position: 0, updated_at: "2026-09-01T00:00:00.000Z", archived_at: null, ...over };
}

const PAGES = [page("p1", { title: "Payments platform" })];

function outcome() {
  return {
    version: 1,
    counts: { pagesFetched: 3, pagesInScope: 3, pagesEligible: 3, pagesWithMaterial: 3, pagesRanked: 3, pagesIncluded: 3, attachmentsSkipped: 0 },
    countsViolation: null,
    anomaly: null,
    citations: { counts: {}, countsViolation: null, anomaly: null },
    model: {},
    refused: [],
    truncatedRead: false,
  };
}

function row(id, over = {}) {
  return {
    id,
    question: `Question ${id}?`,
    answer: `Answer body for ${id}.`,
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
    questions: [row("q-1"), row("q-2")],
    hasMore: false,
    pages: PAGES,
    open: true,
    onToggleOpen: vi.fn(),
    onSelectPage: vi.fn(),
    onDelete: vi.fn(),
    pendingDelete: null,
    onUndoDelete: vi.fn(),
    onClearAll: vi.fn(),
    ...over,
  };
  act(() => {
    root.render(createElement(KnowledgeHistory, props));
  });
  return props;
}

const text = () => container.textContent;
const buttons = () => [...container.querySelectorAll("button")];
const buttonNamed = (name) => buttons().find((b) => (b.textContent || "").trim().toLowerCase().includes(name.toLowerCase()));
const rows = () => [...container.querySelectorAll("[data-kb-history-row]")];
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

describe("KnowledgeHistory — nothing is drawn for nothing", () => {
  it("renders no section and no heading at zero entries", () => {
    render({ questions: [] });
    expect(container.textContent).toBe("");
  });

  it("draws a heading once there is something to head", () => {
    render();
    const heading = container.querySelector("h4");
    expect(heading).not.toBeNull();
    expect(heading.textContent).toContain("Earlier questions");
  });

  it("keeps the rows out of the DOM while collapsed, rather than hiding them", () => {
    render({ open: false });
    expect(rows().length).toBe(0);
    expect(text()).not.toContain("Answer body for q-1.");
    expect(container.querySelector("h4")).not.toBeNull();
  });
});

// ==========================================================================

describe("KnowledgeHistory — the list", () => {
  it("shows each entry collapsed to its question line, newest first", () => {
    render();
    expect(rows().length).toBe(2);
    expect(rows()[0].textContent).toContain("Question q-1?");
    expect(text()).not.toContain("Answer body for q-1.");
  });

  it("expands one entry without expanding the others", () => {
    render();
    const trigger = buttonNamed("Question q-1?");
    expect(trigger).toBeTruthy();
    click(trigger);
    expect(text()).toContain("Answer body for q-1.");
    expect(text()).not.toContain("Answer body for q-2.");
  });

  it("shows ten entries and then offers the rest by count", () => {
    render({ questions: Array.from({ length: 13 }, (_, i) => row(`q-${i}`)) });
    expect(rows().length).toBe(10);
    const more = buttonNamed("Show all 13");
    expect(more).toBeTruthy();
    click(more);
    expect(rows().length).toBe(13);
  });

  it("renders an expanded answer's sources as buttons, with zero anchors", () => {
    const props = render();
    click(buttonNamed("Question q-1?"));
    expect(container.querySelectorAll("a").length).toBe(0);
    const source = buttonNamed("Payments platform");
    expect(source).toBeTruthy();
    click(source);
    expect(props.onSelectPage.mock.calls).toEqual([["p1"]]);
  });
});

// ==========================================================================

describe("KnowledgeHistory — one question: undo, never confirm", () => {
  it("removes on one click, with no confirmation step in between", () => {
    const props = render();
    const remove = rows()[0].querySelector("[data-kb-history-remove]");
    expect(remove).toBeTruthy();
    click(remove);
    expect(props.onDelete.mock.calls).toEqual([["q-1"]]);
    expect(text()).not.toContain("Are you sure");
  });

  it("names the removed question in the undo notice, so the user can tell which one went", () => {
    render({ questions: [row("q-2")], pendingDelete: { id: "q-1", question: "How did we cut p99 latency?" } });
    expect(text()).toContain("Removed “How did we cut p99 latency?”");
    expect(buttonNamed("Undo")).toBeTruthy();
  });

  it("keeps the undo notice reachable even when it removed the last row", () => {
    const props = render({ questions: [], pendingDelete: { id: "q-1", question: "Only question" } });
    expect(buttonNamed("Undo")).toBeTruthy();
    click(buttonNamed("Undo"));
    expect(props.onUndoDelete.mock.calls.length).toBe(1);
  });
});

// ==========================================================================

describe("KnowledgeHistory — clearing the scope does confirm", () => {
  it("is not offered at one row — a Clear all over a single row is a worse-labelled delete", () => {
    render({ questions: [row("q-1")] });
    expect(buttonNamed("Clear all")).toBeUndefined();
  });

  it("confirms inline, names the count, and puts focus on the non-destructive button", () => {
    const props = render({ questions: [row("q-1"), row("q-2"), row("q-3")] });
    const trigger = buttonNamed("Clear all");
    expect(trigger).toBeTruthy();
    click(trigger);

    expect(text()).toContain("Delete all 3 questions for this scope? This cannot be undone.");
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(0);
    expect(document.activeElement.textContent.trim()).toBe("Keep them");
    expect(props.onClearAll.mock.calls.length).toBe(0);

    click(buttonNamed("Delete all 3"));
    expect(props.onClearAll.mock.calls.length).toBe(1);
  });

  it("says what a Clear leaves behind, because the log cannot rebuild rows that are gone", () => {
    render({ questions: [row("q-1"), row("q-2")] });
    click(buttonNamed("Clear all"));
    expect(text().toLowerCase()).toContain("download the log first");
  });

  it("backs out without deleting anything", () => {
    const props = render({ questions: [row("q-1"), row("q-2")] });
    click(buttonNamed("Clear all"));
    click(buttonNamed("Keep them"));
    expect(props.onClearAll.mock.calls.length).toBe(0);
    expect(buttonNamed("Clear all")).toBeTruthy();
  });
});
