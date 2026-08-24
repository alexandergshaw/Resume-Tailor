// @vitest-environment jsdom
//
// Gates the EXTRACTION of one attachment's card out of AttachmentPanel.js and
// into AttachmentCard.js — the change itself, not the pieces.
//
// This file exists because a refactor in this repo has already shipped inert:
// three new components sat beside a 1320-line caller, fully tested, and the
// caller never imported any of them. Every piece-level test passed, because a
// piece-level test imports the piece directly. The regression case would have
// been marked closed with nothing changed on screen.
//
// So the assertions here are deliberately about the SHAPE OF THE CALLER:
// that AttachmentPanel renders AttachmentCard once per attachment, that the
// markup it replaced is genuinely gone rather than duplicated, and that the
// file actually shrank. Reading source text is normally a poor test and is
// the right tool here, because the property being asserted IS the shape of
// the source.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../../lib/supabase/client", () => ({ createClient: vi.fn() }));
// Vitest resolves a specifier to a module id before swapping it, so this one
// mock covers the panel's import whether it is written with or without the
// .js suffix.
vi.mock("../../../lib/document/download", () => ({ triggerBlobDownload: vi.fn() }));

// A stub that records exactly what it was handed and renders something
// findable. If the panel keeps rendering the card inline instead of calling
// this component, `calls` stays empty and every assertion below fails.
const { cardCalls } = vi.hoisted(() => ({ cardCalls: [] }));
vi.mock("./AttachmentCard.js", () => ({
  default: function MockAttachmentCard(props) {
    cardCalls.push(props);
    return createElement(
      "div",
      { "data-testid": "mock-attachment-card", "data-name": props.attachment?.name || "" },
      props.attachment?.name || "",
    );
  },
}));

import AttachmentPanel from "./AttachmentPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Resolved from process.cwd(), the way every other source-text test in this
// repo does it (CompanyBriefPanel.test.js, CopilotClient.roles.test.js).
// `new URL(..., import.meta.url)` does NOT work here - vitest does not hand
// this file a file: URL, so fileURLToPath throws at module scope and the
// whole suite fails to collect before a single test runs.
const PANEL_PATH = path.join(process.cwd(), "app/components/experience/AttachmentPanel.js");
const PANEL_SOURCE = readFileSync(PANEL_PATH, "utf8");

let container;
let root;

beforeEach(() => {
  cardCalls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  delete global.fetch;
});

function attachment(overrides = {}) {
  return {
    id: "a1",
    page_id: "page-1",
    name: "file.txt",
    kind: "text",
    bytes: 1024,
    notes: "",
    url: null,
    storage_path: "user-1/experience/page-1/a1-file.txt",
    ...overrides,
  };
}

function installFetch(list = []) {
  global.fetch = vi.fn((url, options = {}) => {
    const method = (options && options.method) || "GET";
    if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

async function mount(props = { pageId: "page-1" }) {
  await act(async () => {
    root.render(createElement(AttachmentPanel, props));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("AttachmentPanel renders AttachmentCard", () => {
  it("renders exactly one card per attachment, each given its own row", async () => {
    installFetch([
      attachment({ id: "a1", name: "resume-draft.pdf", kind: "pdf" }),
      attachment({ id: "a2", name: "kickoff.pptx", kind: "slides" }),
      attachment({ id: "a3", name: "q3.xlsx", kind: "sheet" }),
    ]);
    await mount();

    expect(cardCalls).toHaveLength(3);
    // Each card got ITS OWN attachment, in list order - not the same one
    // three times, which is what a mis-threaded `.map` produces and which a
    // bare count would not catch.
    expect(cardCalls.map((p) => p.attachment.name)).toEqual([
      "resume-draft.pdf",
      "kickoff.pptx",
      "q3.xlsx",
    ]);
    expect(container.querySelectorAll('[data-testid="mock-attachment-card"]')).toHaveLength(3);
  });

  it("renders no cards for an empty list, and still says so", async () => {
    // Positive control in the other direction: a panel that rendered a card
    // unconditionally would pass the test above.
    installFetch([]);
    await mount();

    expect(cardCalls).toHaveLength(0);
    expect(container.textContent).toContain("No attachments yet.");
  });

  it("hands each card the handlers it needs, as functions", async () => {
    // A prop wired to `undefined` is valid React and fails silently at the
    // moment the user clicks - no gate in this repo catches it except an
    // assertion like this one.
    installFetch([attachment({ id: "a1", name: "resume-draft.pdf", kind: "pdf" })]);
    await mount();

    const [props] = cardCalls;
    for (const name of ["onNotesInput", "onSaveNotes", "onDownload", "onDelete", "onRetryDelete"]) {
      expect(typeof props[name], `${name} must be a function`).toBe("function");
    }
  });
});

describe("the markup really moved", () => {
  it("no longer builds a card inline", () => {
    // An extraction that ADDS the component while leaving the original JSX in
    // place renders every card twice and passes a naive import check. These
    // strings are the card's own markup and must now live only in
    // AttachmentCard.js.
    expect(PANEL_SOURCE).toContain("<AttachmentCard");
    expect(PANEL_SOURCE).not.toContain("Notes for the AI");
    expect(PANEL_SOURCE).not.toContain("Download ${attachment.name}");
    expect(PANEL_SOURCE).not.toContain("Delete ${attachment.name}");
  });

  it("stays well inside the ceiling that forced the extraction", () => {
    // 948 lines before the extraction, 802 straight after it. It is not 802
    // now, and that is legitimate: the focus mechanism landed in this file
    // immediately afterwards, which is the whole reason the card had to come
    // out first.
    //
    // So this is a CEILING, not a shrink-proof, and it is deliberately not
    // tuned to the current count — a bound that sits one line above reality
    // turns every future comment into a fight with the test, which is how a
    // useful assertion gets deleted by someone who reasonably concludes it is
    // noise. The real proof that the markup moved is the assertion above,
    // which fails if a single line of the card is still built here. This
    // number exists to keep the file from drifting back toward the 1000-line
    // limit unnoticed: cross it and the next thing to add is another
    // extraction, not another line.
    const lines = PANEL_SOURCE.split("\n").length;
    expect(lines).toBeLessThan(900);
  });
});
