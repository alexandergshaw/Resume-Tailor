// @vitest-environment jsdom
//
// The knowledge panel's data hook. Written before app/hooks/useKnowledgeScope.js
// exists.
//
// Pattern: app/hooks/useTechWatch.test.js / useApplicationDigests.test.js —
// mount the hook through a tiny Probe under react-dom's createRoot + act and
// read its return value between actions. There is no @testing-library in this
// repo.
//
// WHAT THIS FILE IS ACTUALLY GUARDING, in the order the plan ranks it:
//
//   1. The FOUR summary states that look identical from outside — content
//      present; the scope genuinely had nothing; the pipeline received input
//      and produced nothing; and a record written before this feature stored
//      a retrieval record at all. Three of them render as "nothing here"
//      under any implementation that does not separate them ON PURPOSE, and
//      the third one is the one that hides a wiring bug (buildKnowledgeBaseBlock's
//      `isEligible` has no default and falls back to `() => false`, which
//      returns a byte-identical object to an empty scope on every field).
//
//   2. Omitted pages are NAMED, never counted. The owner has already asked
//      "which ones?" of another notice in this app that gave only a count.
//
//   3. Auto-generation is gated on the STORED ROW, never on mount.
//      app/page.js renders ExperienceTab conditionally, so the tab unmounts on
//      every main-tab switch and every ref-based "already fired" guard inside
//      it is destroyed and rebuilt. A mount-gated trigger bills a model call
//      per tab switch, per research batch, per meeting save.
//
//   4. ONE localStorage key holding a bounded map. jsdom enforces NO QUOTA AT
//      ALL (5000 keys written, no throw), so a key-per-scope design passes
//      every test in this harness and fails only in production, silently,
//      through the try/catch the repo idiom requires. A count assertion on
//      `localStorage.length` is the only thing that can catch it here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

// Mocked at the EXACT relative specifier the hook imports, because this repo's
// vitest config does not unify "@/lib/..." and "../../lib/..." into one module
// id (TechWatchPanel.js:12-15 records the same trap).
vi.mock("../../lib/document/download.js", () => ({ triggerBlobDownload: vi.fn() }));

import { triggerBlobDownload } from "../../lib/document/download.js";
import {
  useKnowledgeScope,
  KB_PANEL_STORAGE_KEY,
  AUTO_GENERATE_DEBOUNCE_MS,
  UNDO_WINDOW_MS,
  MAX_DRAFT_CHARS,
  MAX_REMEMBERED_SCOPES,
} from "./useKnowledgeScope.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let api;
let calls;

function Probe(props) {
  api = useKnowledgeScope(props);
  return null;
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush();
}

async function rerender(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush();
}

async function flush(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function page(id, over = {}) {
  return {
    id,
    title: `Title ${id}`,
    parent_id: null,
    position: 0,
    body: "words",
    updated_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    archived_at: null,
    generated_kind: null,
    ...over,
  };
}

const PAGES = [page("p1", { title: "Payments platform" }), page("p2", { title: "Kafka migration" }), page("p3", { title: "Old notes" })];

function outcome(over = {}) {
  return {
    version: 1,
    counts: {
      pagesFetched: 3,
      pagesInScope: 3,
      pagesEligible: 3,
      pagesWithMaterial: 2,
      pagesRanked: 2,
      pagesIncluded: 1,
      attachmentsSkipped: 0,
      ...(over.counts || {}),
    },
    countsViolation: null,
    anomaly: null,
    citations: { counts: { citationsClaimed: 0, citationsResolved: 0, citationsRendered: 0 }, countsViolation: null, anomaly: null },
    model: { called: true, responseTextKind: "text", finishReason: "STOP", blockReason: null, envelopeParsed: "ok", answerChars: 20 },
    refused: [],
    truncatedRead: false,
    ...over,
  };
}

function summaryRow(over = {}) {
  return {
    id: "sum-1",
    scope_page_id: null,
    summary: "## Overview\nThe payments work.",
    source_pages: [
      { id: "p1", title: "Payments platform", updated_at: "2026-09-01T00:00:00.000Z", parent_id: null, position: 0, included: true, reason: "included", rank: 0, excerpted: false },
      { id: "p2", title: "Kafka migration", updated_at: "2026-09-01T00:00:00.000Z", parent_id: null, position: 1, included: false, reason: "budget", rank: 1, excerpted: false },
      { id: "p3", title: "Old notes", updated_at: "2026-09-01T00:00:00.000Z", parent_id: null, position: 2, included: false, reason: "no-material", rank: null, excerpted: false },
    ],
    retrieval_outcome: outcome(),
    model: "gemini-2.5",
    engine: "gemini",
    status: "ready",
    error: null,
    generated_at: "2026-09-05T10:00:00.000Z",
    ...over,
  };
}

function questionRow(over = {}) {
  return {
    id: "q-1",
    question: "How did we cut p99 latency?",
    answer: "By batching the writes.",
    citations: [{ pageId: "p1" }],
    answered_from_pages: true,
    retrieval_outcome: outcome(),
    status: "ready",
    error: null,
    created_at: "2026-09-05T11:00:00.000Z",
    ...over,
  };
}

// A fetch router that records every call. Every test asserts the number of
// recorded calls of a kind BEFORE asserting anything about their contents.
function router({ get, post, question, del } = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const method = (init && init.method) || "GET";
      const body = init && init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method, body });
      if (method === "GET") return get ? get(String(url)) : json({ summary: null, questions: [], hasMore: false });
      if (method === "DELETE") return del ? del(body) : json({ deleted: 1 });
      if (String(url).includes("/question")) return question ? question(body) : json({ question: questionRow() });
      return post ? post(body) : json({ summary: summaryRow() });
    })
  );
}

const gets = () => calls.filter((c) => c.method === "GET");
const summaryPosts = () => calls.filter((c) => c.method === "POST" && !c.url.includes("/question"));
const questionPosts = () => calls.filter((c) => c.method === "POST" && c.url.includes("/question"));
const deletes = () => calls.filter((c) => c.method === "DELETE");

const BASE = { scopePageId: null, pages: PAGES, loading: false, signedOut: false, error: "" };

beforeEach(() => {
  vi.useFakeTimers();
  api = undefined;
  calls = [];
  window.localStorage.clear();
  vi.mocked(triggerBlobDownload).mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ==========================================================================

describe("useKnowledgeScope — the load", () => {
  it("reads the stored row for the root scope in one GET, with no scopePageId parameter", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [questionRow()], hasMore: false }) });
    await mount(BASE);

    expect(gets().length).toBe(1);
    expect(gets()[0].url).toContain("/api/experience/knowledge");
    expect(gets()[0].url).not.toContain("scopePageId=");
    expect(api.summary.id).toBe("sum-1");
    expect(api.questions.length).toBe(1);
  });

  it("names the page in the query string for a page scope, and reloads when the scope changes", async () => {
    router({ get: () => json({ summary: null, questions: [], hasMore: false }) });
    await mount({ ...BASE, scopePageId: "p1" });
    expect(gets().length).toBe(1);
    expect(gets()[0].url).toContain("scopePageId=p1");

    await rerender({ ...BASE, scopePageId: "p2" });
    expect(gets().length).toBe(2);
    expect(gets()[1].url).toContain("scopePageId=p2");
  });

  it("a failed read is NEVER an empty knowledge base: it sets loadError and generates nothing", async () => {
    router({ get: () => json({ error: "Could not read the summary." }, 500) });
    await mount(BASE);
    await advance(AUTO_GENERATE_DEBOUNCE_MS * 4);

    expect(api.loadError).toBe("Could not read the summary.");
    expect(api.summary).toBeNull();
    expect(summaryPosts().length).toBe(0);
  });

  it("does not load at all while the tab is loading, signed out, or in error", async () => {
    router();
    await mount({ ...BASE, loading: true });
    expect(gets().length).toBe(0);

    await rerender({ ...BASE, signedOut: true });
    expect(gets().length).toBe(0);

    await rerender({ ...BASE, error: "Could not load your pages." });
    expect(gets().length).toBe(0);
  });
});

// ==========================================================================

describe("useKnowledgeScope — the four states that look identical from outside", () => {
  async function withSummary(row) {
    router({ get: () => json({ summary: row, questions: [], hasMore: false }) });
    await mount(BASE);
    await advance(AUTO_GENERATE_DEBOUNCE_MS * 2);
  }

  it("STATE 1 — content present", async () => {
    await withSummary(summaryRow());
    expect(api.view.state).toBe("content");
    expect(api.view.summaryText).toContain("The payments work.");
    expect(api.coverage.total).toBe(3);
    expect(api.coverage.included).toBe(1);
    expect(api.coverage.consistent).toBe(true);
  });

  it("STATE 2 — the scope genuinely had nothing: pagesInScope is 0", async () => {
    await withSummary(
      summaryRow({
        summary: "",
        source_pages: [],
        retrieval_outcome: outcome({
          counts: { pagesFetched: 0, pagesInScope: 0, pagesEligible: 0, pagesWithMaterial: 0, pagesRanked: 0, pagesIncluded: 0, attachmentsSkipped: 0 },
        }),
      })
    );
    expect(api.view.state).toBe("empty-scope");
  });

  it("STATE 3 — input arrived and nothing came out: pagesInScope > 0 and pagesIncluded === 0, and it is NEVER state 2", async () => {
    await withSummary(
      summaryRow({
        summary: "",
        status: "failed",
        error: "No page in this scope could be included in the model's context.",
        source_pages: [
          { id: "p1", title: "Payments platform", included: false, reason: "no-material", rank: null, excerpted: false, updated_at: "2026-09-01T00:00:00.000Z", parent_id: null, position: 0 },
        ],
        retrieval_outcome: outcome({
          counts: { pagesFetched: 3, pagesInScope: 3, pagesEligible: 3, pagesWithMaterial: 0, pagesRanked: 0, pagesIncluded: 0, attachmentsSkipped: 0 },
          anomaly: { stage: "pagesWithMaterial", from: "pagesEligible", to: "pagesWithMaterial", inputCount: 3, outputCount: 0 },
        }),
      })
    );
    expect(api.view.state).toBe("zero-out");
    // The stage that ate everything is what separates a wiring bug from a
    // genuinely empty scope, so it has to reach the panel.
    expect(api.view.anomalyStage).toBe("pagesWithMaterial");
    expect(api.view.counts.pagesInScope).toBe(3);
  });

  it("STATE 4 — a record written before this feature stored a retrieval record: retrieval_outcome is SQL NULL", async () => {
    await withSummary(summaryRow({ retrieval_outcome: null }));
    expect(api.view.state).toBe("legacy");
    // "no evidence" is not "no problem": a legacy row has nothing to be
    // consistent WITH, so the coverage claim is refused rather than assumed.
    expect(api.coverage.consistent).toBe(false);
    // The prose is still real and still shown.
    expect(api.view.summaryText).toContain("The payments work.");
  });

  it("all four states are distinct values — a suite that mapped two of them to one word would pass every case above individually", async () => {
    const seen = [];
    for (const [label, row] of [
      ["content", summaryRow()],
      ["empty", summaryRow({ source_pages: [], retrieval_outcome: outcome({ counts: { pagesFetched: 0, pagesInScope: 0, pagesEligible: 0, pagesWithMaterial: 0, pagesRanked: 0, pagesIncluded: 0 } }) })],
      ["zero-out", summaryRow({ source_pages: [], retrieval_outcome: outcome({ counts: { pagesFetched: 3, pagesInScope: 3, pagesEligible: 3, pagesWithMaterial: 0, pagesRanked: 0, pagesIncluded: 0 } }) })],
      ["legacy", summaryRow({ retrieval_outcome: null })],
    ]) {
      await withSummary(row);
      seen.push([label, api.view.state]);
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    expect(seen.length).toBe(4);
    expect(new Set(seen.map(([, state]) => state)).size).toBe(4);
  });

  it("a plain failure is its own state, distinct from all four", async () => {
    await withSummary(summaryRow({ status: "failed", summary: "", error: "The model returned no text at all." }));
    expect(api.view.state).toBe("failed");
    expect(api.view.error).toBe("The model returned no text at all.");
  });

  it("no stored row at all is its own state, and it is not 'the scope had nothing'", async () => {
    router({ get: () => json({ summary: null, questions: [], hasMore: false }), post: () => new Promise(() => {}) });
    await mount({ ...BASE, pages: PAGES });
    expect(api.view.state).toBe("none");
  });
});

// ==========================================================================

describe("useKnowledgeScope — omitted pages are NAMED, never counted", () => {
  it("returns every excluded page with its own title and its own reason", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [], hasMore: false }) });
    await mount(BASE);

    expect(api.view.omitted.length).toBe(2);
    expect(api.view.omitted.map((p) => p.title)).toEqual(["Kafka migration", "Old notes"]);
    expect(api.view.omitted.map((p) => p.reason)).toEqual(["budget", "no-material"]);
    // The included page is not in the list.
    expect(api.view.omitted.map((p) => p.id)).not.toContain("p1");
  });

  it("names a page that has since been DELETED from the tree, using the stored title — the live tree cannot resolve it", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [], hasMore: false }) });
    await mount({ ...BASE, pages: [PAGES[0]] });

    expect(api.view.omitted.length).toBe(2);
    expect(api.view.omitted.map((p) => p.title)).toContain("Kafka migration");
  });
});

// ==========================================================================

describe("useKnowledgeScope — auto-generation is gated on the STORED ROW, never on mount", () => {
  it("generates once when there is no stored row, after the selection settles", async () => {
    router({ get: () => json({ summary: null, questions: [], hasMore: false }) });
    await mount(BASE);
    expect(summaryPosts().length).toBe(0);

    await advance(AUTO_GENERATE_DEBOUNCE_MS + 1);
    expect(summaryPosts().length).toBe(1);
    expect(summaryPosts()[0].body).toEqual({ scopePageId: null });

    await advance(AUTO_GENERATE_DEBOUNCE_MS * 5);
    expect(summaryPosts().length).toBe(1);
  });

  it("does NOT generate when a ready row exists", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [], hasMore: false }) });
    await mount(BASE);
    await advance(AUTO_GENERATE_DEBOUNCE_MS * 5);
    expect(summaryPosts().length).toBe(0);
  });

  it("does NOT generate when a FAILED row exists — the row's existence is the gate, or a scope that reliably fails bills forever", async () => {
    router({ get: () => json({ summary: summaryRow({ status: "failed", summary: "", error: "boom" }), questions: [], hasMore: false }) });
    await mount(BASE);
    await advance(AUTO_GENERATE_DEBOUNCE_MS * 5);
    expect(summaryPosts().length).toBe(0);
  });

  it("does NOT generate while the panel is collapsed — a collapsed panel is the user saying they do not want it", async () => {
    window.localStorage.setItem(KB_PANEL_STORAGE_KEY, JSON.stringify({ v: 1, open: false, scopes: {}, order: [] }));
    router({ get: () => json({ summary: null, questions: [], hasMore: false }) });
    await mount(BASE);
    await advance(AUTO_GENERATE_DEBOUNCE_MS * 5);
    expect(api.open).toBe(false);
    expect(summaryPosts().length).toBe(0);
  });

  it("fires for the LAST scope only when the user arrows down the tree", async () => {
    router({ get: () => json({ summary: null, questions: [], hasMore: false }) });
    await mount({ ...BASE, scopePageId: "p1" });
    await advance(Math.floor(AUTO_GENERATE_DEBOUNCE_MS / 4));
    await rerender({ ...BASE, scopePageId: "p2" });
    await advance(Math.floor(AUTO_GENERATE_DEBOUNCE_MS / 4));
    await rerender({ ...BASE, scopePageId: "p3" });
    expect(summaryPosts().length).toBe(0);

    await advance(AUTO_GENERATE_DEBOUNCE_MS + 1);
    expect(summaryPosts().length).toBe(1);
    expect(summaryPosts()[0].body.scopePageId).toBe("p3");
  });

  it("does not auto-retry a scope whose attempt failed in THIS session", async () => {
    router({
      get: () => json({ summary: null, questions: [], hasMore: false }),
      post: () => json({ error: "The model call did not complete." }, 502),
    });
    await mount(BASE);
    await advance(AUTO_GENERATE_DEBOUNCE_MS + 1);
    expect(summaryPosts().length).toBe(1);

    await advance(AUTO_GENERATE_DEBOUNCE_MS * 10);
    expect(summaryPosts().length).toBe(1);
  });

  it("an explicit regenerate always sends force: true, even over a ready row", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [], hasMore: false }) });
    await mount(BASE);
    await act(async () => {
      await api.generate();
    });
    expect(summaryPosts().length).toBe(1);
    expect(summaryPosts()[0].body).toEqual({ scopePageId: null, force: true });
  });
});

// ==========================================================================

describe("useKnowledgeScope — persistence is ONE key holding a bounded map", () => {
  it("writes exactly one localStorage key, whatever the scope", async () => {
    router();
    await mount({ ...BASE, scopePageId: "p1" });
    await act(async () => api.setDraft("first"));
    await rerender({ ...BASE, scopePageId: "p2" });
    await act(async () => api.setDraft("second"));
    await rerender({ ...BASE, scopePageId: "p3" });
    await act(async () => api.setDraft("third"));

    // jsdom enforces no quota at all, so a key-per-scope design passes every
    // behavioural test in this harness. Counting the keys is the only thing
    // that catches it before production.
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.key(0)).toBe(KB_PANEL_STORAGE_KEY);
  });

  it("keeps the draft per scope, so a citation that changes the scope cannot destroy it", async () => {
    router();
    await mount({ ...BASE, scopePageId: "p1" });
    await act(async () => api.setDraft("about payments"));
    await rerender({ ...BASE, scopePageId: "p2" });
    expect(api.draft).toBe("");
    await rerender({ ...BASE, scopePageId: "p1" });
    expect(api.draft).toBe("about payments");
  });

  it("keeps panel-open GLOBAL, so the layout does not change shape as the user arrows down the tree", async () => {
    router();
    await mount({ ...BASE, scopePageId: "p1" });
    await act(async () => api.setOpen(false));
    await rerender({ ...BASE, scopePageId: "p2" });
    expect(api.open).toBe(false);
  });

  it("caps the draft at 2000 characters", async () => {
    router();
    await mount(BASE);
    await act(async () => api.setDraft("x".repeat(MAX_DRAFT_CHARS + 500)));
    expect(api.draft.length).toBe(MAX_DRAFT_CHARS);
  });

  it("bounds the remembered scopes with an LRU order", async () => {
    router();
    await mount({ ...BASE, scopePageId: null });
    for (let i = 0; i < MAX_REMEMBERED_SCOPES + 5; i += 1) {
      await rerender({ ...BASE, scopePageId: `p${i}`, pages: [...PAGES, page(`p${i}`)] });
      await act(async () => api.setDraft(`draft ${i}`));
    }
    const stored = JSON.parse(window.localStorage.getItem(KB_PANEL_STORAGE_KEY));
    expect(Object.keys(stored.scopes).length).toBeLessThanOrEqual(MAX_REMEMBERED_SCOPES);
    expect(stored.order.length).toBeLessThanOrEqual(MAX_REMEMBERED_SCOPES);
  });

  it("prunes a scope whose page is gone, but NEVER the root sentinel and NEVER during a load", async () => {
    const sentinel = "00000000-0000-0000-0000-000000000000";
    window.localStorage.setItem(
      KB_PANEL_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        open: true,
        scopes: { [sentinel]: { draft: "root draft", historyOpen: false, bodyExpanded: false }, "p1": { draft: "kept", historyOpen: false, bodyExpanded: false }, "ghost": { draft: "orphan", historyOpen: false, bodyExpanded: false } },
        order: [sentinel, "p1", "ghost"],
      })
    );
    router();
    // Pruning during a load would wipe every draft the user has.
    await mount({ ...BASE, loading: true });
    let stored = JSON.parse(window.localStorage.getItem(KB_PANEL_STORAGE_KEY));
    expect(Object.keys(stored.scopes).sort()).toEqual([sentinel, "ghost", "p1"].sort());

    await rerender(BASE);
    stored = JSON.parse(window.localStorage.getItem(KB_PANEL_STORAGE_KEY));
    expect(Object.keys(stored.scopes).sort()).toEqual([sentinel, "p1"].sort());
    expect(stored.scopes[sentinel].draft).toBe("root draft");
  });

  it("never persists under an optimistic temp- id", async () => {
    router();
    await mount({ ...BASE, scopePageId: "temp-1757000000000-abc", pages: [...PAGES, page("temp-1757000000000-abc")] });
    await act(async () => api.setDraft("typed while the page was still being created"));
    expect(api.draft).toBe("typed while the page was still being created");
    const raw = window.localStorage.getItem(KB_PANEL_STORAGE_KEY);
    expect(raw === null || !raw.includes("temp-1757000000000-abc")).toBe(true);
  });

  it("a throwing localStorage never reverts the in-session choice", async () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      router();
      await mount(BASE);
      await act(async () => api.setOpen(false));
      expect(api.open).toBe(false);
      await act(async () => api.setDraft("still typed"));
      expect(api.draft).toBe("still typed");
    } finally {
      window.localStorage.setItem = original;
    }
  });
});

// ==========================================================================

describe("useKnowledgeScope — asking", () => {
  it("posts the question, prepends the row, and clears the draft only on success", async () => {
    router({
      get: () => json({ summary: summaryRow(), questions: [], hasMore: false }),
      question: () => json({ question: questionRow() }),
    });
    await mount(BASE);
    await act(async () => api.setDraft("How did we cut p99 latency?"));
    await act(async () => {
      await api.ask();
    });

    expect(questionPosts().length).toBe(1);
    expect(questionPosts()[0].body).toEqual({ scopePageId: null, question: "How did we cut p99 latency?" });
    expect(api.questions.length).toBe(1);
    expect(api.lastAnswer.id).toBe("q-1");
    expect(api.draft).toBe("");
  });

  it("keeps the draft when the ask fails, so Try again is one press", async () => {
    router({
      get: () => json({ summary: summaryRow(), questions: [], hasMore: false }),
      question: () => json({ error: "The model call did not complete.", question: questionRow({ status: "failed", answer: "", citations: [], answered_from_pages: null }) }, 502),
    });
    await mount(BASE);
    await act(async () => api.setDraft("what happened"));
    await act(async () => {
      await api.ask();
    });

    expect(api.draft).toBe("what happened");
    // The row still exists — a failed attempt that vanished would leave the
    // history looking like the question was never asked.
    expect(api.questions.length).toBe(1);
    expect(api.questions[0].status).toBe("failed");
  });

  it("refuses an empty draft without spending a request", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [], hasMore: false }) });
    await mount(BASE);
    await act(async () => api.setDraft("   "));
    await act(async () => {
      await api.ask();
    });
    expect(questionPosts().length).toBe(0);
  });
});

// ==========================================================================

describe("useKnowledgeScope — removing a question is an undo, not a confirm", () => {
  it("removes the row from view immediately and defers the real DELETE by the undo window", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [questionRow()], hasMore: false }) });
    await mount(BASE);
    expect(api.questions.length).toBe(1);

    await act(async () => api.removeQuestion("q-1"));
    expect(api.questions.length).toBe(0);
    expect(api.pendingDelete.id).toBe("q-1");
    expect(deletes().length).toBe(0);

    await advance(UNDO_WINDOW_MS + 1);
    expect(deletes().length).toBe(1);
    expect(deletes()[0].body).toEqual({ id: "q-1" });
  });

  it("undo puts the row back and issues no DELETE at all", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [questionRow()], hasMore: false }) });
    await mount(BASE);
    await act(async () => api.removeQuestion("q-1"));
    await act(async () => api.undoDelete());

    expect(api.questions.length).toBe(1);
    expect(api.pendingDelete).toBeNull();
    await advance(UNDO_WINDOW_MS * 3);
    expect(deletes().length).toBe(0);
  });

  it("clearing the scope sends one DELETE naming the scope, not a row", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [questionRow(), questionRow({ id: "q-2" })], hasMore: false }) });
    await mount({ ...BASE, scopePageId: "p1" });
    await act(async () => {
      await api.clearQuestions();
    });
    expect(deletes().length).toBe(1);
    expect(deletes()[0].body).toEqual({ scopePageId: "p1", all: true });
    expect(api.questions.length).toBe(0);
  });
});

// ==========================================================================

describe("useKnowledgeScope — the log", () => {
  it("builds it from the stored rows, names the omitted pages, and never writes the question text", async () => {
    router({ get: () => json({ summary: summaryRow(), questions: [questionRow({ question: "SENTINELQUESTION about my salary" })], hasMore: false }) });
    await mount(BASE);
    await act(async () => api.downloadLog());

    expect(vi.mocked(triggerBlobDownload).mock.calls.length).toBe(1);
    const [blob, fileName] = vi.mocked(triggerBlobDownload).mock.calls[0];
    const text = await blob.text();
    // Positive assertions FIRST, so the absence assertion below cannot pass
    // vacuously against an empty string.
    expect(text).toContain("Knowledge base scope summary log");
    expect(text).toContain("Kafka migration");
    expect(text).toContain("excluded: budget");
    expect(text).not.toContain("SENTINELQUESTION");
    expect(fileName).toMatch(/\.md$/);
  });

  it("is enabled in every state, including the one with no row at all", async () => {
    router({ get: () => json({ summary: null, questions: [], hasMore: false }), post: () => new Promise(() => {}) });
    await mount(BASE);
    await act(async () => api.downloadLog());
    expect(vi.mocked(triggerBlobDownload).mock.calls.length).toBe(1);
  });
});
