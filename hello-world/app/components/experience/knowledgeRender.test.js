// @vitest-environment jsdom
//
// The rendering half of the safety story: the source sweep next door proves
// nothing in the feature's own source spells `href`; this file proves that no
// MODEL-AUTHORED string can produce one either.
//
// Both a summary and an answer are rendered through MarkdownPreview, whose
// `renderLink` seam has a trap in it that the sweep cannot see. Returning
// `undefined` is the seam's OWN DOCUMENTED IDIOM ("Returning `undefined` ...
// falls through to the rendering below"), and the branch it falls through to
// renders `href={token.href}` UNGATED for a same-origin path and for
// `mailto:`. So a renderLink written exactly the way the component recommends
// lets a model mint live, same-origin anchors inside a grounded answer.
//
// That is why two of the ten rows below are `[L7](/api/experience/pages/1)`
// and `[L8](mailto:a@b)` - the two shapes that pass sanitizeUrl and reach the
// ungated branch. A suite without them cannot tell a correct implementation
// from the one an implementer will actually write, and the last describe block
// in this file demonstrates exactly that by running the same markdown through
// the recommended-but-wrong seam.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../hooks/useKnowledgeScope", () => ({ useKnowledgeScope: vi.fn() }));

import { useKnowledgeScope } from "../../hooks/useKnowledgeScope";
import KnowledgePanel from "./KnowledgePanel.js";
import MarkdownPreview from "./MarkdownPreview.js";
import { renderInertLink } from "./knowledgePanelStyles.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Ten links a model could write, with distinct labels so the survival count is
// unambiguous, plus a raw HTML tag. Rows 1-6 and 9 are refused by
// lib/experience/markdown.js's own sanitizeUrl; rows 7 and 8 are NOT - they
// reach MarkdownPreview's ungated same-origin/mailto branch, and they are the
// reason renderInertLink has to be TOTAL rather than selective.
const HOSTILE = [
  "[L1](javascript:alert(1))",
  "[L2](data:text/html,<script>alert(1)</script>)",
  "[L3](vbscript://acme.com/m)",
  "[L4](intent://acme.com/#Intent;scheme=http;end)",
  "[L5](//evil.example/y)",
  "[L6](https://acme.com@evil.example/story)",
  "[L7](/api/experience/pages/1)",
  "[L8](mailto:a@b)",
  "[L9](/\\evil.example/y)",
  "[L10](  https://acme.com/y  )",
  "<img src=x onerror=alert(1)>",
].join("\n\n");

const LABELS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"];

let container;
let root;

function page(id, over = {}) {
  return {
    id,
    title: `Title ${id}`,
    parent_id: null,
    position: 0,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    archived_at: null,
    ...over,
  };
}

const PAGES = [page("p1", { title: "Payments platform" })];

function hookState(over = {}) {
  return {
    scope: { pageId: null, title: null, pageCount: 1 },
    summary: { id: "sum-1", status: "ready", generated_at: "2026-09-05T10:00:00.000Z" },
    questions: [],
    hasMore: false,
    view: {
      state: "content",
      summaryText: HOSTILE,
      error: "",
      counts: { pagesFetched: 1, pagesInScope: 1, pagesEligible: 1, pagesWithMaterial: 1, pagesRanked: 1, pagesIncluded: 1 },
      anomalyStage: null,
      omitted: [],
      truncatedRead: false,
      residueRemoved: 0,
      generatedAt: "2026-09-05T10:00:00.000Z",
    },
    coverage: { total: 1, included: 1, excluded: 0, byReason: {}, attachmentsSkipped: 0, consistent: true },
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
    bodyExpanded: true,
    setBodyExpanded: vi.fn(),
    lastAnswer: {
      id: "q-1",
      status: "ready",
      question: "what?",
      answer: HOSTILE,
      citations: [],
      answered_from_pages: true,
      retrieval_outcome: null,
      error: "",
    },
    askError: "",
    pendingDelete: null,
    undoDelete: vi.fn(),
    announce: vi.fn(),
    generate: vi.fn(),
    ask: vi.fn(),
    removeQuestion: vi.fn(),
    clearQuestions: vi.fn(),
    downloadLog: vi.fn(),
    ...over,
  };
}

async function renderPanel(over = {}) {
  useKnowledgeScope.mockReturnValue(hookState(over));
  await act(async () => {
    root.render(
      createElement(KnowledgePanel, {
        scopePageId: null,
        pages: PAGES,
        loading: false,
        signedOut: false,
        error: "",
        onSelectPage: vi.fn(),
      }),
    );
  });
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
  vi.clearAllMocks();
});

describe("no model-authored string produces a live link in the knowledge panel", () => {
  it("[control] renders the labels first - so a zero-anchor assertion cannot pass because nothing rendered", async () => {
    await renderPanel();
    for (const label of LABELS) {
      expect(container.textContent, `${label} did not survive as text`).toContain(label);
    }
  });

  it("renders ZERO <a> elements", async () => {
    await renderPanel();
    expect([...container.querySelectorAll("a")]).toHaveLength(0);
  });

  it("renders ZERO elements carrying an href attribute of ANY value", async () => {
    // Not `a[href]`: MUI's `component="a"` and any future element could carry
    // one, and an href="" is as much a finding as an href="javascript:...".
    await renderPanel();
    expect([...container.querySelectorAll("[href]")].map((el) => el.outerHTML)).toEqual([]);
  });

  it("renders no script element, no img element and no inline event-handler ATTRIBUTE", async () => {
    // Asserted on the DOM, never on innerHTML. The raw tag is supposed to
    // survive as escaped TEXT - `&lt;img src=x onerror=alert(1)&gt;` - so a
    // substring search of innerHTML for "onerror=" would fail on exactly the
    // correct rendering, and passing it would mean the text had been dropped.
    // What actually matters is that no ELEMENT carries such an attribute.
    await renderPanel();
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);

    const handlerAttrs = [...container.querySelectorAll("*")].flatMap((el) =>
      [...el.attributes].map((a) => a.name).filter((n) => /^on[a-z]/i.test(n)),
    );
    expect(handlerAttrs).toEqual([]);
    // and the tag itself did survive as text rather than being deleted
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("holds for the ANSWER as well as the summary, and for both at once", async () => {
    await renderPanel();
    const answer = container.querySelector("[data-kb-answer]");
    expect(answer, "the answer block did not render").not.toBeNull();
    for (const label of LABELS) expect(answer.textContent).toContain(label);
    expect(answer.querySelectorAll("[href]")).toHaveLength(0);
  });

  it("holds when the summary is the ONLY thing rendered", async () => {
    await renderPanel({ lastAnswer: null });
    expect(container.textContent).toContain("L7");
    expect(container.querySelectorAll("[href]")).toHaveLength(0);
  });
});

describe("renderInertLink is TOTAL - the property the two same-origin rows exist to pin", () => {
  it("returns an element for every token and never the seam's fall-through value", () => {
    for (const href of ["/api/experience/pages/1", "mailto:a@b", "https://acme.com/y", "", null, undefined]) {
      const out = renderInertLink({ href, external: true, key: "k", children: "L" });
      expect(out, `renderInertLink returned undefined for ${String(href)}`).not.toBeUndefined();
    }
  });

  it("[mutation gate] the seam's own recommended `undefined` DOES mint live anchors for exactly the same-origin and mailto rows", async () => {
    // Run the identical markdown through MarkdownPreview with the renderLink
    // the component's own documentation suggests. If this ever stops producing
    // anchors, the two rows above have stopped being load-bearing and this
    // whole file would pass against an implementation that returns undefined.
    await act(async () => {
      root.render(createElement(MarkdownPreview, { markdown: HOSTILE, renderLink: () => undefined }));
    });

    const hrefs = [...container.querySelectorAll("[href]")].map((el) => el.getAttribute("href"));
    expect(hrefs).toContain("/api/experience/pages/1");
    expect(hrefs).toContain("mailto:a@b");
  });

  it("[mutation gate] and the panel's own renderLink refuses those same two", async () => {
    await act(async () => {
      root.render(createElement(MarkdownPreview, { markdown: HOSTILE, renderLink: renderInertLink }));
    });
    expect(container.querySelectorAll("[href]")).toHaveLength(0);
    expect(container.textContent).toContain("L7");
    expect(container.textContent).toContain("L8");
  });
});
