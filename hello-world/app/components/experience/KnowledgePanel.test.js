// @vitest-environment jsdom
//
// The knowledge panel's markup. Written before
// app/components/experience/KnowledgePanel.js exists.
//
// The data hook is mocked, so this file tests RENDERING only — what a user
// sees in each state, and that four states which look identical from outside
// are four different sentences. useKnowledgeScope's own loading, gating and
// persistence behaviour is tested in app/hooks/useKnowledgeScope.test.js.
// TechWatchPanel.test.js is the precedent for both halves of that split.
//
// THREE THINGS THIS FILE EXISTS TO CATCH, none of which a pure function can
// be extracted for:
//
//   1. The control collision. "Ask AI" already exists as a shipped, app-wide
//      control and PageEditor.js:225 renders one INSIDE this very tab. A
//      second control nearby doing something else is a defect, and the two
//      cheapest disambiguations are BOTH defects: MUI 9.0.1's Tooltip
//      OVERWRITES a button's accessible name (and its text is not in the DOM
//      before hover), and an aria-label differing from visible text puts that
//      visible text outside the accessible name (WCAG 2.5.3). So this file
//      asserts different WORDS, a different SHAPE and no naming Tooltip.
//
//   2. Severity that survives monochrome. Each state's discriminator has to
//      be the GLYPH SILHOUETTE, the WEIGHT and the SENTENCE — never the
//      colour — so the assertions are on icon identity and on text, and never
//      on a colour value.
//
//   3. Omitted pages NAMED, never counted. The owner has already asked "which
//      ones?" of another notice in this app that gave only a count.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../hooks/useKnowledgeScope", () => ({ useKnowledgeScope: vi.fn() }));

import { useKnowledgeScope } from "../../hooks/useKnowledgeScope";
import KnowledgePanel from "./KnowledgePanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

let container;
let root;

function page(id, over = {}) {
  return { id, title: `Title ${id}`, parent_id: null, position: 0, updated_at: "2026-09-01T00:00:00.000Z", archived_at: null, ...over };
}

const PAGES = [page("p1", { title: "Payments platform" }), page("p2", { title: "Kafka migration" }), page("p3", { title: "Old notes" })];

function counts(over = {}) {
  return { pagesFetched: 3, pagesInScope: 3, pagesEligible: 3, pagesWithMaterial: 2, pagesRanked: 2, pagesIncluded: 1, attachmentsSkipped: 0, ...over };
}

function hookState(over = {}) {
  return {
    scope: { pageId: null, title: null, pageCount: 3 },
    summary: { id: "sum-1", status: "ready", generated_at: "2026-09-05T10:00:00.000Z" },
    questions: [],
    hasMore: false,
    view: {
      state: "content",
      summaryText: "## Overview\nThe payments work.",
      error: "",
      counts: counts(),
      anomalyStage: null,
      omitted: [
        { id: "p2", title: "Kafka migration", reason: "budget" },
        { id: "p3", title: "Old notes", reason: "no-material" },
      ],
      truncatedRead: false,
      residueRemoved: 0,
      generatedAt: "2026-09-05T10:00:00.000Z",
    },
    coverage: { total: 3, included: 1, excluded: 2, byReason: { budget: 1, "no-material": 1 }, attachmentsSkipped: 0, consistent: true },
    staleness: { added: [], removed: [], moved: [], changed: [], attachmentsNotCovered: true },
    loadError: "",
    busy: { generating: false, asking: false },
    announcement: { text: "", seq: 0 },
    draft: "",
    setDraft: vi.fn(),
    open: true,
    setOpen: vi.fn(),
    historyOpen: false,
    setHistoryOpen: vi.fn(),
    bodyExpanded: false,
    setBodyExpanded: vi.fn(),
    lastAnswer: null,
    askError: "",
    pendingDelete: null,
    undoDelete: vi.fn(),
    generate: vi.fn(),
    ask: vi.fn(),
    removeQuestion: vi.fn(),
    clearQuestions: vi.fn(),
    downloadLog: vi.fn(),
    ...over,
  };
}

function render(state, props = {}) {
  useKnowledgeScope.mockReturnValue(state);
  act(() => {
    root.render(
      createElement(KnowledgePanel, {
        scopePageId: null,
        pages: PAGES,
        loading: false,
        signedOut: false,
        error: "",
        onSelectPage: props.onSelectPage || vi.fn(),
        ...props,
      })
    );
  });
}

const text = () => container.textContent;
const region = () => container.querySelector('[role="region"]');
const status = () => container.querySelector('[role="status"]');
const buttons = () => [...container.querySelectorAll("button")];
const buttonNamed = (name) =>
  buttons().find((b) => (b.textContent || "").trim().toLowerCase().includes(name.toLowerCase()));
const iconIds = () => [...container.querySelectorAll("[data-testid]")].map((n) => n.getAttribute("data-testid"));

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

describe("KnowledgePanel — it cannot be confused with the Ask AI already in this tab", () => {
  it("is one labelled region with an h3 that never overclaims the whole knowledge base", () => {
    render(hookState());
    expect(container.querySelectorAll('[role="region"]').length).toBe(1);
    const labelId = region().getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const heading = document.getElementById(labelId);
    expect(heading).not.toBeNull();
    expect(heading.tagName).toBe("H3");
    expect(heading.textContent.trim()).toBe("Ask these pages");
    // "Ask this knowledge base" is false on a page scope, and a feature about
    // not overclaiming coverage must not overclaim in its own heading.
    expect(heading.textContent).not.toContain("knowledge base");
  });

  it("never puts the token AI on any control it renders", () => {
    render(hookState({ questions: [], view: { ...hookState().view } }));
    const labels = buttons().map((b) => (b.textContent || "").trim());
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(/\bAI\b/.test(label), `control "${label}" reuses the shipped Ask AI vocabulary`).toBe(false);
    }
  });

  it("puts the visible text of every labelled control inside its accessible name (WCAG 2.5.3)", () => {
    render(hookState());
    const labelled = [...container.querySelectorAll("[aria-label]")];
    // Assert the sweep's own reach before asserting anything about it.
    expect(Array.isArray(labelled)).toBe(true);
    for (const el of labelled) {
      const visible = (el.textContent || "").trim();
      if (!visible) continue;
      expect(el.getAttribute("aria-label").toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it("uses no title attribute and no naming Tooltip anywhere in the feature's own source", () => {
    for (const file of ["KnowledgePanel.js", "KnowledgeQuestionBox.js", "KnowledgeHistory.js"]) {
      const source = readFileSync(path.join(HERE, file), "utf8");
      expect(source.includes("@mui/material/Tooltip"), `${file} imports Tooltip`).toBe(false);
      expect(/\stitle=/.test(source), `${file} sets a title attribute`).toBe(false);
    }
  });

  it("renders zero anchors and zero href attributes — no page in this app has a URL", () => {
    render(hookState({ view: { ...hookState().view, summaryText: "See [Acme](https://acme.example/x) and [local](/api/experience/pages/1)." } }));
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(container.querySelectorAll("[href]").length).toBe(0);
    // The labels survive as text, so the refusal is a degradation and not a deletion.
    expect(text()).toContain("Acme");
    expect(text()).toContain("local");
  });
});

// ==========================================================================

describe("KnowledgePanel — the four states that look identical from outside", () => {
  const scenarios = {
    content: hookState(),
    "empty-scope": hookState({
      view: { ...hookState().view, state: "empty-scope", summaryText: "", omitted: [], counts: counts({ pagesFetched: 0, pagesInScope: 0, pagesEligible: 0, pagesWithMaterial: 0, pagesRanked: 0, pagesIncluded: 0 }) },
      coverage: { total: 0, included: 0, excluded: 0, byReason: {}, attachmentsSkipped: 0, consistent: true },
      scope: { pageId: null, title: null, pageCount: 0 },
    }),
    "zero-out": hookState({
      view: { ...hookState().view, state: "zero-out", summaryText: "", omitted: [{ id: "p1", title: "Payments platform", reason: "no-material" }], anomalyStage: "pagesWithMaterial", counts: counts({ pagesWithMaterial: 0, pagesRanked: 0, pagesIncluded: 0 }), error: "No page in this scope could be included in the model's context." },
      coverage: { total: 1, included: 0, excluded: 1, byReason: { "no-material": 1 }, attachmentsSkipped: 0, consistent: true },
    }),
    legacy: hookState({
      view: { ...hookState().view, state: "legacy", counts: null, omitted: [] },
      coverage: { total: 3, included: 1, excluded: 2, byReason: { budget: 1, "no-material": 1 }, attachmentsSkipped: 0, consistent: false },
    }),
  };

  it("renders four different sentences, and no two of them are the same string", () => {
    const sentences = {};
    for (const [name, state] of Object.entries(scenarios)) {
      render(state);
      sentences[name] = container.querySelector("[data-kb-coverage]").textContent.trim();
    }
    expect(Object.keys(sentences).length).toBe(4);
    expect(new Set(Object.values(sentences)).size).toBe(4);
  });

  it("NEVER renders the pipeline's zero output as 'nothing found'", () => {
    render(scenarios["zero-out"]);
    const line = container.querySelector("[data-kb-coverage]").textContent;
    // It names the count that went in, and the stage where it hit zero.
    expect(line).toContain("3");
    expect(line).toContain("pagesWithMaterial");
    expect(line.toLowerCase()).not.toContain("no pages yet");
    expect(line.toLowerCase()).not.toContain("nothing to summarise");
    // And it says plainly that what follows is not a summary of them.
    expect(text()).toContain("Nothing below describes them");
  });

  it("says a genuinely empty scope has nothing in it, in its own words", () => {
    render(scenarios["empty-scope"]);
    const line = container.querySelector("[data-kb-coverage]").textContent;
    expect(line.toLowerCase()).toContain("nothing to summarise");
    expect(line).not.toContain("pagesWithMaterial");
  });

  it("refuses the coverage claim on a record that predates the feature, and still shows the prose", () => {
    render(scenarios.legacy);
    const line = container.querySelector("[data-kb-coverage]").textContent;
    expect(line.toLowerCase()).toContain("cannot be confirmed");
    expect(text()).toContain("The payments work.");
  });

  it("distinguishes a stored record that DISAGREES with the summary from one that is simply absent", () => {
    render(
      hookState({
        coverage: { total: 3, included: 1, excluded: 2, byReason: {}, attachmentsSkipped: 0, consistent: false },
      })
    );
    const inconsistent = container.querySelector("[data-kb-coverage]").textContent.trim();
    render(scenarios.legacy);
    const legacy = container.querySelector("[data-kb-coverage]").textContent.trim();
    expect(inconsistent).not.toBe(legacy);
  });
});

// ==========================================================================

describe("KnowledgePanel — omitted pages are NAMED", () => {
  it("lists every left-out page by its own title and its own reason", () => {
    render(hookState());
    const rows = [...container.querySelectorAll("[data-kb-omitted-row]")];
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Kafka migration"),
      expect.stringContaining("Old notes"),
    ]);
    expect(rows[0].textContent).toContain("did not fit");
    expect(rows[1].textContent).toContain("nothing written in it");
  });

  it("shows the first ten and then offers the rest, rather than a bare count", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `x${i}`, title: `Page number ${i}`, reason: "budget" }));
    render(hookState({ view: { ...hookState().view, omitted: many }, coverage: { total: 15, included: 1, excluded: 14, byReason: { budget: 14 }, attachmentsSkipped: 0, consistent: true } }));
    expect(container.querySelectorAll("[data-kb-omitted-row]").length).toBe(10);
    const more = buttonNamed("Show all 14");
    expect(more).toBeTruthy();
    act(() => more.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelectorAll("[data-kb-omitted-row]").length).toBe(14);
  });

  it("draws no left-out section at all when nothing was left out", () => {
    render(hookState({ view: { ...hookState().view, omitted: [] }, coverage: { total: 3, included: 3, excluded: 0, byReason: {}, attachmentsSkipped: 0, consistent: true } }));
    expect(container.querySelectorAll("[data-kb-omitted-row]").length).toBe(0);
    expect(text()).not.toContain("Left out of this summary");
  });
});

// ==========================================================================

describe("KnowledgePanel — severity survives monochrome", () => {
  it("gives complete, partial and stale three different glyph silhouettes", () => {
    render(hookState({ view: { ...hookState().view, omitted: [] }, coverage: { total: 3, included: 3, excluded: 0, byReason: {}, attachmentsSkipped: 0, consistent: true } }));
    const complete = iconIds();

    render(hookState());
    const partial = iconIds();

    render(hookState({ staleness: { added: [page("p9")], removed: [], moved: [], changed: [], attachmentsNotCovered: true } }));
    const stale = iconIds();

    expect(complete).toContain("CheckCircleOutlinedIcon");
    expect(partial).toContain("PlaylistRemoveIcon");
    expect(stale).toContain("ReportProblemOutlinedIcon");
    // Three distinct outlines, not one shape in three colours.
    expect(new Set(["CheckCircleOutlinedIcon", "PlaylistRemoveIcon", "ReportProblemOutlinedIcon"]).size).toBe(3);
  });

  it("opens the two attention states with a bold lead-in and the complete state with none", () => {
    render(hookState({ view: { ...hookState().view, omitted: [] }, coverage: { total: 3, included: 3, excluded: 0, byReason: {}, attachmentsSkipped: 0, consistent: true } }));
    expect(container.querySelectorAll("[data-kb-lead-in]").length).toBe(0);

    render(hookState());
    const leadIns = [...container.querySelectorAll("[data-kb-lead-in]")];
    expect(leadIns.length).toBe(1);
    expect(leadIns[0].textContent).toContain("Not everything is in");
  });

  it("keeps coverage and freshness as two ordered lines, never merged into one", () => {
    render(hookState({ staleness: { added: [page("p9", { title: "New page" })], removed: [], moved: [], changed: [page("p1")], attachmentsNotCovered: true } }));
    const coverage = container.querySelector("[data-kb-coverage]");
    const freshness = container.querySelector("[data-kb-freshness]");
    expect(coverage).not.toBeNull();
    expect(freshness).not.toBeNull();
    expect(coverage).not.toBe(freshness);
    expect(freshness.textContent).toContain("Out of date");
    // "changed", never "edited" — applyMoves bumps updated_at on a drag.
    expect(freshness.textContent).toContain("changed");
    expect(freshness.textContent).not.toContain("edited");
  });

  it("draws no freshness line when nothing has changed", () => {
    render(hookState());
    expect(container.querySelector("[data-kb-freshness]")).toBeNull();
  });
});

// ==========================================================================

describe("KnowledgePanel — the log button", () => {
  it("is visible and enabled in every state, including the two where it is most needed", () => {
    for (const state of [
      hookState(),
      hookState({ summary: null, view: { ...hookState().view, state: "none", summaryText: "", omitted: [] } }),
      hookState({ view: { ...hookState().view, state: "failed", summaryText: "", error: "The model returned no text at all." } }),
      hookState({ view: { ...hookState().view, state: "zero-out", anomalyStage: "pagesEligible", summaryText: "" } }),
    ]) {
      render(state);
      const button = buttonNamed("Download log");
      expect(button, "Download log missing").toBeTruthy();
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(button.getAttribute("aria-disabled")).not.toBe("true");
    }
  });

  it("stays reachable when the panel body is collapsed", () => {
    render(hookState({ open: false }));
    expect(buttonNamed("Download log")).toBeTruthy();
  });

  it("calls the hook's own builder", () => {
    const state = hookState();
    render(state);
    act(() => buttonNamed("Download log").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(state.downloadLog.mock.calls.length).toBe(1);
  });
});

// ==========================================================================

describe("KnowledgePanel — collapse is a bare ternary and the live region sits outside it", () => {
  it("removes the body from the DOM when collapsed, rather than hiding it", () => {
    render(hookState());
    expect(text()).toContain("The payments work.");
    render(hookState({ open: false }));
    expect(text()).not.toContain("The payments work.");
  });

  it("keeps role=status mounted in both states — a live region inside a collapsed subtree is silent", () => {
    render(hookState({ announcement: { text: "Writing a summary of 3 pages…", seq: 1 } }));
    expect(status()).not.toBeNull();
    expect(status().textContent).toContain("Writing a summary of 3 pages…");

    render(hookState({ open: false, announcement: { text: "Summary updated", seq: 2 } }));
    expect(status()).not.toBeNull();
    expect(status().textContent).toContain("Summary updated");
  });

  it("imports no motion component and declares no motion", () => {
    const source = readFileSync(path.join(HERE, "KnowledgePanel.js"), "utf8");
    for (const banned of ["Collapse", "Fade", "Grow", "Slide", "Zoom", "Skeleton", "CircularProgress", "transition:", "animation:", "scrollIntoView"]) {
      expect(source.includes(banned), `${banned} present in KnowledgePanel.js`).toBe(false);
    }
  });

  it("uses none of the surfaces the aesthetics pass ruled out", () => {
    for (const file of ["KnowledgePanel.js", "KnowledgeQuestionBox.js", "KnowledgeHistory.js"]) {
      const source = readFileSync(path.join(HERE, file), "utf8");
      for (const banned of ["@mui/material/Card", "@mui/material/Paper", "@mui/material/Chip", "boxShadow", "elevation", "opacity"]) {
        expect(source.includes(banned), `${banned} present in ${file}`).toBe(false);
      }
    }
  });
});

// ==========================================================================

describe("KnowledgePanel — regenerating replaces, so it confirms in place", () => {
  it("asks inline, names what is lost, and puts focus on the non-destructive button", () => {
    const state = hookState();
    render(state);
    const trigger = buttonNamed("Regenerate summary");
    expect(trigger).toBeTruthy();
    act(() => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(text()).toContain("there is no earlier version to go back to");
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(0);
    expect(document.activeElement.textContent.trim()).toBe("Keep what I have");
    expect(state.generate.mock.calls.length).toBe(0);

    act(() => buttonNamed("Rewrite it").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(state.generate.mock.calls.length).toBe(1);
  });

  it("swaps the label rather than dimming it while a generation is in flight", () => {
    render(hookState({ busy: { generating: true, asking: false } }));
    const busy = buttonNamed("Generating…");
    expect(busy).toBeTruthy();
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.tabIndex).toBe(0);
  });

  it("an aria-disabled control's click handler still fires, so the early return is the real block", () => {
    const state = hookState({ busy: { generating: true, asking: false } });
    render(state);
    act(() => buttonNamed("Generating…").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(state.generate.mock.calls.length).toBe(0);
  });
});

// ==========================================================================

describe("KnowledgePanel — the states that are not the summary's", () => {
  it("renders nothing at all when signed out", () => {
    render(hookState(), { signedOut: true });
    expect(container.textContent).toBe("");
  });

  it("never presents a failed page load as an empty knowledge base", () => {
    render(hookState({ summary: null, view: { ...hookState().view, state: "none", summaryText: "", omitted: [] } }), {
      error: "Could not load your pages.",
    });
    expect(text().toLowerCase()).toContain("could not be loaded");
    expect(text().toLowerCase()).not.toContain("nothing to summarise");
  });

  it("says so, in words, when the read was truncated", () => {
    render(hookState({ view: { ...hookState().view, truncatedRead: true } }));
    expect(text()).toContain("not every page could be read");
  });

  it("says so, in words, when links were stripped out of the summary", () => {
    render(hookState({ view: { ...hookState().view, residueRemoved: 2 } }));
    expect(text().toLowerCase()).toContain("link");
  });

  it("keeps the previous summary on screen when a rewrite fails, and dates it", () => {
    render(
      hookState({
        view: { ...hookState().view, state: "failed", error: "The model returned no text at all.", summaryText: "## Overview\nThe payments work.", generatedAt: "2026-09-05T10:00:00.000Z" },
      })
    );
    expect(text()).toContain("The payments work.");
    expect(text()).toContain("The model returned no text at all.");
  });
});

// ==========================================================================

describe("KnowledgePanel — the scope line never overclaims", () => {
  it("names the whole base on the root scope", () => {
    render(hookState());
    expect(container.querySelector("[data-kb-scope]").textContent).toBe("Covers all 3 pages in your knowledge base.");
  });

  it("names the page and its sub-pages on a page scope", () => {
    render(hookState({ scope: { pageId: "p1", title: "Payments platform", pageCount: 7 } }), { scopePageId: "p1" });
    expect(container.querySelector("[data-kb-scope]").textContent).toBe("Covers “Payments platform” and its 6 sub-pages.");
  });

  it("says a leaf page has no sub-pages rather than claiming a subtree", () => {
    render(hookState({ scope: { pageId: "p1", title: "Payments platform", pageCount: 1 } }), { scopePageId: "p1" });
    expect(container.querySelector("[data-kb-scope]").textContent).toBe("Covers “Payments platform” only — it has no sub-pages.");
  });
});
