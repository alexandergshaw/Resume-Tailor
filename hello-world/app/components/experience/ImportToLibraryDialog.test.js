// @vitest-environment jsdom
//
// ImportToLibraryDialog is the review step between "candidate fragments
// mined from a project page" (lib/experience/tailorSources.js, gate-tested
// separately) and the tailoring library. It is the one deliberate exception
// to this app's minimize-clicks directive: a resume bullet goes out under
// the user's name, so choosing which candidates to keep is a REQUIRED step,
// not an optional one - these tests assert that choosing is respected (an
// unchecked fragment must never reach the network) and that the review
// itself costs as little as possible (everything starts checked).
//
// Per this chunk's own instructions, assertions target the OBSERVABLE
// outcome - the actual body of the POST to /api/library/content-library -
// never an implementation detail like "a function was called".

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ImportToLibraryDialog, { KEYWORD_JOIN_NAMES } from "./ImportToLibraryDialog.js";

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
  delete global.fetch;
  vi.clearAllMocks();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(ImportToLibraryDialog, props));
  });
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function documentButtons() {
  return [...document.querySelectorAll("button")];
}

function findButton(text) {
  return documentButtons().find((b) => b.textContent.trim() === text);
}

function documentCheckboxes() {
  return [...document.querySelectorAll('input[type="checkbox"]')];
}

function fragmentTextareas() {
  return [...document.querySelectorAll('textarea[aria-label="Fragment text"]')];
}

function slotSelects() {
  return [...document.querySelectorAll('select[aria-label="Slot"]')];
}

// React patches HTMLTextAreaElement's own `value` setter to track the "last
// value" it saw, so a plain `el.value = x` is invisible to it and no
// onChange fires. Going through the ORIGINAL (unpatched) prototype setter,
// then dispatching the native "input" event React actually listens for, is
// the standard way to simulate real typing without @testing-library.
function setTextValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

// A native <select> needs no such trick - React listens to the native
// "change" event directly (same pattern this file's own template-file-input
// test below already uses).
function chooseSlot(el, value) {
  el.value = value;
  el.dispatchEvent(new window.Event("change", { bubbles: true }));
}

const FRAGMENTS = [
  { text: "Cut settlement from three days to one", sourcePageId: "p1", sourceTitle: "Payments migration" },
  { text: "Retired the legacy processor", sourcePageId: "p1", sourceTitle: "Payments migration" },
];

function baseProps(overrides) {
  return {
    open: true,
    onClose: vi.fn(),
    fragments: FRAGMENTS,
    ...overrides,
  };
}

describe("review is required and cheap", () => {
  it("starts with every candidate fragment checked", async () => {
    await render(baseProps());
    const boxes = documentCheckboxes();
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("shows the fragment text (editable) and the project page it came from", async () => {
    await render(baseProps());
    const textareas = fragmentTextareas();
    expect(textareas.map((t) => t.value)).toContain("Cut settlement from three days to one");
    expect(document.body.textContent).toContain("Payments migration");
  });

  it("one button imports everything pre-selected", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { row: {} }));
    await render(baseProps());

    await click(findButton("Add 2 to library"));
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const bodies = global.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body));
    const texts = bodies.map((b) => b.text).sort();
    expect(texts).toEqual(["Cut settlement from three days to one", "Retired the legacy processor"].sort());
  });
});

describe("choosing what gets kept", () => {
  it("never sends an unchecked fragment to the server", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { row: {} }));
    await render(baseProps());

    const boxes = documentCheckboxes();
    await act(async () => {
      boxes[1].click();
    });

    await click(findButton("Add 1 to library"));
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.text).toBe("Cut settlement from three days to one");
  });

  it("posts each kept fragment with a real, non-fabricated shape the content-library endpoint accepts", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { row: {} }));
    await render(baseProps({ fragments: [FRAGMENTS[0]] }));

    await click(findButton("Add 1 to library"));
    await flush();

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/library/content-library");
    const body = JSON.parse(opts.body);
    expect(body.fabricated).toBe(false);
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots.length).toBeGreaterThan(0);
    expect(typeof body.frag_id).toBe("string");
    expect(body.frag_id.length).toBeGreaterThan(0);
  });
});

// The preview's entire reason to exist: prove it actually shows the
// difference between a mangled composition and a clean one. If it can't,
// the preview is decoration, not a safeguard.
describe("live composed preview (reads the real bundled template)", () => {
  it("shows the mid-sentence capital a full-sentence fragment produces, by default", async () => {
    await render(baseProps({ fragments: [FRAGMENTS[0]] }));
    await flush();
    // MEASURABLE_IMPACT's first occurrence in the bundled résumé template
    // sits right after "delivering" - substituting a full sentence there
    // yields a capital letter mid-sentence, exactly the defect this preview
    // exists to surface before the bullet reaches an actual resume.
    expect(document.body.textContent).toContain("delivering Cut settlement");
  });

  it("shows a clean composed line once the text is rewritten as a phrase", async () => {
    await render(baseProps({ fragments: [FRAGMENTS[0]] }));
    await flush();
    const textarea = fragmentTextareas()[0];
    await act(async () => {
      setTextValue(textarea, "reduced settlement time from three days to one");
    });
    await flush();

    expect(document.body.textContent).toContain("delivering reduced settlement time from three days to one");
    expect(document.body.textContent).not.toContain("delivering Cut settlement");
    expect(document.body.textContent).not.toContain("delivering Reduced");
  });

  it("recomposes against a different real skeleton line when the slot changes", async () => {
    await render(baseProps({ fragments: [FRAGMENTS[0]] }));
    await flush();
    expect(document.body.textContent).toContain("delivering Cut settlement");

    const select = slotSelects()[0];
    const otherOption = [...select.options].find((o) => o.value && o.value !== select.value);
    expect(otherOption).toBeDefined();
    await act(async () => {
      chooseSlot(select, otherOption.value);
    });
    await flush();

    // The old skeleton line (and its "delivering" framing) is gone - a
    // DIFFERENT real sentence from the template now carries the text.
    expect(document.body.textContent).not.toContain("delivering Cut settlement");
    expect(document.body.textContent).toContain("Cut settlement from three days to one");
  });

  it("posts the current edited text and the chosen slot, not the original mined text or a fixed default", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { row: {} }));
    await render(baseProps({ fragments: [FRAGMENTS[0]] }));
    await flush();

    const textarea = fragmentTextareas()[0];
    await act(async () => {
      setTextValue(textarea, "reduced settlement time from three days to one");
    });
    const select = slotSelects()[0];
    const otherOption = [...select.options].find((o) => o.value && o.value !== select.value);
    await act(async () => {
      chooseSlot(select, otherOption.value);
    });

    await click(findButton("Add 1 to library"));
    await flush();

    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.text).toBe("reduced settlement time from three days to one");
    expect(body.slots).toEqual([otherOption.value]);
  });
});

describe("no candidates", () => {
  it("never calls fetch and offers nothing to import when there is no candidate material", async () => {
    global.fetch = vi.fn();
    await render(baseProps({ fragments: [] }));

    expect(documentCheckboxes()).toHaveLength(0);
    expect(document.body.textContent.toLowerCase()).toContain("no accomplishment");
    expect(findButton("Add 0 to library")).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("per-fragment failure reporting", () => {
  it("reports success and failure per fragment rather than failing the whole import on one error", async () => {
    global.fetch = vi.fn((url, opts) => {
      const { text } = JSON.parse(opts.body);
      if (text === "Retired the legacy processor") {
        return Promise.resolve(jsonResponse(400, { error: "frag_id already exists." }));
      }
      return Promise.resolve(jsonResponse(200, { row: {} }));
    });
    await render(baseProps());

    await click(findButton("Add 2 to library"));
    await flush();

    expect(document.body.textContent).toContain("1");
    expect(document.body.textContent).toContain("frag_id already exists.");
  });
});

// DRIFT CANARY. lib/llm/engines/tailor-lite/strategy.js does not export its
// KEYWORD_JOIN dict (nothing under tailor-lite may be edited to add one -
// see this chunk's own scope), so KEYWORD_JOIN_NAMES in ImportToLibraryDialog.js
// is a hand-typed, manually-synced snapshot of that dict's keys. A comment
// asking a future editor to "keep this in sync" does not survive contact
// with a future edit - this codebase has already been bitten by exactly this
// shape once. This test reads strategy.js's OWN source text and re-derives
// the real key list, so a future KEYWORD_JOIN edit that isn't mirrored here
// fails the suite instead of silently letting this dialog offer (or keep
// excluding) a slot name that no longer matches reality.
//
// WHEN THIS FAILS: open lib/llm/engines/tailor-lite/strategy.js, find what
// changed in KEYWORD_JOIN, then decide per changed name whether it is
// resolved BEFORE LIBRARY_MATCH ever runs in mapOne (strategy.js's own
// numbered comments - "4) KEYWORD_JOIN" runs before "6) LIBRARY_MATCH") - if
// so it belongs in KEYWORD_JOIN_NAMES (a content-library fragment saved
// under it can never be selected); if a name was REMOVED from KEYWORD_JOIN,
// remove it from KEYWORD_JOIN_NAMES too, since it may now be a legitimate,
// LIBRARY_MATCH-reachable slot choice. Update ImportToLibraryDialog.js's
// KEYWORD_JOIN_NAMES to match, then re-run this file.
describe("drift canary: KEYWORD_JOIN_NAMES vs. strategy.js's real KEYWORD_JOIN", () => {
  // Anchored on the exact declaration shape strategy.js uses today
  // ("const KEYWORD_JOIN = { ... };" at 2-space indentation for each of its
  // own top-level keys, with any nested object's properties indented
  // further). If strategy.js's own shape changes enough that this stops
  // matching, the loud failures below (never a silent empty-set pass) are
  // the signal to update the pattern here, not just the exclusion list.
  // import.meta.dirname (a real filesystem path), not
  // fileURLToPath(new URL(rel, import.meta.url)) - under Vitest/Vite,
  // import.meta.url resolves to an http://localhost:.../@fs/... dev-server
  // pseudo-URL once it is combined into a `new URL(...)` expression (Vite's
  // own HMR module-graph plumbing, confirmed empirically), which
  // fileURLToPath then rejects outright as not a file: URL.
  const STRATEGY_PATH = path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "lib",
    "llm",
    "engines",
    "tailor-lite",
    "strategy.js",
  );

  function realKeywordJoinKeys() {
    const source = readFileSync(STRATEGY_PATH, "utf8");
    const blockMatch = source.match(/const KEYWORD_JOIN = \{([\s\S]*?)\n\};/);
    if (!blockMatch) {
      // Loud failure, not a silent empty comparison - this project has
      // shipped exactly that shape of bug before (an emoji scanner whose
      // regex errored on every file yet reported "clean").
      throw new Error(
        "Drift canary could not find strategy.js's KEYWORD_JOIN block at all - " +
          "the block-matching pattern in this test is stale and must be fixed " +
          "before this canary can mean anything again.",
      );
    }
    const keys = [...blockMatch[1].matchAll(/^ {2}([A-Z][A-Z0-9_]*): /gm)].map((m) => m[1]);
    if (keys.length === 0) {
      throw new Error(
        "Drift canary found the KEYWORD_JOIN block but extracted zero keys - " +
          "the key-matching pattern in this test is stale and must be fixed " +
          "before this canary can mean anything again.",
      );
    }
    return keys;
  }

  it("never lets KEYWORD_JOIN_NAMES silently drift from strategy.js's real KEYWORD_JOIN dict", () => {
    const actualKeys = realKeywordJoinKeys();
    const missingFromExclusion = actualKeys.filter((k) => !KEYWORD_JOIN_NAMES.has(k));
    const staleInExclusion = [...KEYWORD_JOIN_NAMES].filter((k) => !actualKeys.includes(k));

    expect(
      missingFromExclusion,
      `strategy.js's KEYWORD_JOIN now has ${JSON.stringify(missingFromExclusion)} that KEYWORD_JOIN_NAMES ` +
        "does not exclude - ImportToLibraryDialog would offer a slot the engine can never select. " +
        "See this describe block's own header comment for what to do.",
    ).toEqual([]);

    expect(
      staleInExclusion,
      `KEYWORD_JOIN_NAMES excludes ${JSON.stringify(staleInExclusion)}, which strategy.js's KEYWORD_JOIN ` +
        "no longer has - that name may now be a legitimate LIBRARY_MATCH-reachable slot. " +
        "See this describe block's own header comment for what to do.",
    ).toEqual([]);
  });
});
