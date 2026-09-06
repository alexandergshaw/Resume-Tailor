// @vitest-environment jsdom
//
// The render side of the digest's citations: the markers, the source list,
// and -- the reason this file is long -- the FOUR STATES THAT LOOK ALIKE.
//
// Three of them are a zero and one of them is a null, and until wave 4a there
// was no data with which to tell any of them apart, so the panel showed the
// same nothing for all four:
//
//   1. citations present                 -> markers + a numbered list
//   2. the model genuinely found nothing -> "no web search ran" (LEGITIMATE)
//   3. citations arrived and none were placed (THE DEFECT this chunk exists to
//      close) -> says so, and lists what Google did return
//   4. citation_outcome IS NULL -> the row predates the fix and its publisher
//      URLs were destroyed at write time. NOT "found nothing".
//
// The single most important assertion in this file is negative and appears in
// three places: a user is NEVER shown "no sources" when the truth is "we could
// not place them." Each of 2/3/4 asserts its own string AND asserts the other
// two strings are absent, so an implementation that collapses any pair turns
// six assertions red rather than one.
//
// Idiom: createRoot + act, per app/components/experience/MarkdownPreview.test.js.
// There is no @testing-library in this repo (no package.json entry, no
// node_modules/@testing-library, no dom-accessibility-api), so an accessible
// name cannot be computed -- which is precisely why AC-F3 requires an EXPLICIT
// aria-label, and why every name assertion below reads getAttribute.
//
// Style is asserted at SOURCE level, not through getComputedStyle. Measured
// reasons, not laziness: `var()` never resolves in jsdom, the `outline`
// shorthand is dropped by its parser, and `:focus-visible` matching is flaky
// (5 true / 5 false in 10 readings). A flaky falsifier is worse than a manual
// check. The pixel outcomes are the named manual checks MC-A1/A2/A7.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import DigestPanel from "./DigestPanel.js";
import { markdownStamp } from "../../../lib/tracking/renderCitedMarkdown.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const panelSrc = read("./DigestPanel.js");
const dialogSrc = read("../AppViewDialog.js");
const previewSrc = read("../experience/MarkdownPreview.js");

// ---------------------------------------------------------------- the strings
// Normative copy (1c §0.3). Asserted as literals so a rewording is a
// deliberate act rather than a silent drift.
const S = {
  scope:
    "Each number marks the passage Google's search attributed to that source — not a check that the claim is true.",
  cited: "Sources for the numbered claims above",
  also: "Also searched — not attached to any passage",
  alsoWhy:
    "Google's search returned these pages for this research, but they could not be tied to a specific passage here, so they carry no number.",
  legacy: "Links this research quoted — not from Google's search",
  legacyWhy:
    "These links were written by the model in an earlier version of this feature. Nothing matched them against what Google's search returned, and some point at pages that do not exist. Research again to replace them.",
  noSearch: "No web search ran for this research, so nothing below has a source behind it.",
  placedNoneWithEntries:
    "Google's search ran, but none of what it returned could be tied to a specific passage here. What it did return is listed below.",
  placedNoneEmpty:
    "Google's search ran, but it returned nothing that could be attached to this research.",
  stamp:
    "This research was changed after its citations were recorded, so the numbers have been removed. The sources are listed below, unnumbered. Research again for a fresh, numbered version.",
  redirect: "These links open through Google's search redirect, not directly at the publisher.",
  truncated: "This research was cut short and may be incomplete.",
  preFeature:
    "This research predates source tracking, so nothing here was checked against Google's search.",
};

// ------------------------------------------------------------------ fixtures
const REUTERS = "https://www.reuters.com/business/nimbus-series-c";
const REUTERS_ALT = "https://reuters.com/business/nimbus-series-c";
const TECHCRUNCH = "https://techcrunch.com/nimbus-depots";
const REDIRECT_A =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123";
const REDIRECT_B =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/XyZ789";

// "Nimbus raised a Series C." ends at 25; the document ends at 58.
const MD = "Nimbus raised a Series C. It runs depots in twelve cities.";
// "Nimbus raised a Series C." ends at 25; the document ends at 52.
const MD_TWO_SPELLINGS = "Nimbus raised a Series C. Reuters covered the round.";

/** An outcome record shaped exactly as lib/tracking/digestCitations.js writes one. */
function outcomeFor(markdown, { placed = 0, annotations = placed, ...rest } = {}) {
  const stamp = markdownStamp(markdown);
  return {
    version: 1,
    surface: "interactions",
    searched: true,
    truncated: false,
    residueClean: true,
    counts: {
      annotations,
      urlsUsable: annotations,
      spansUsable: placed,
      splicesSafe: placed,
      placed,
    },
    refused: { count: 0, reasons: {}, spanReasons: {} },
    len: stamp.len,
    hash: stamp.hash,
    previous: null,
    ...rest,
  };
}

const CITED = {
  application_id: "app-1",
  status: "ready",
  markdown: MD,
  updated_at: "2026-09-05T12:00:00.000Z",
  researched_at: "2026-09-05T12:00:00.000Z",
  sources: [
    { url: REUTERS, title: "Nimbus raises Series C", start: 0, end: 25 },
    { url: TECHCRUNCH, title: "Nimbus depot network", start: 26, end: 58 },
  ],
  citation_outcome: outcomeFor(MD, { placed: 2 }),
};

// --------------------------------------------------------------- the harness
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

async function render(digest, props = {}) {
  await act(async () => {
    root.render(
      createElement(DigestPanel, {
        digest,
        nowTs: Date.parse("2026-09-05T13:00:00.000Z"),
        ...props,
      })
    );
  });
}

const markers = () => [...container.querySelectorAll("a[data-citation-marker]")];
const group = (name) => container.querySelector(`[data-fn-group="${name}"]`);
const groupNames = () =>
  [...container.querySelectorAll("[data-fn-group]")].map((el) => el.getAttribute("data-fn-group"));
const anchors = () => [...container.querySelectorAll("a")];
const text = () => container.textContent || "";

/** The three "which zero is this" strings, so absence can be asserted as a set. */
function statesClaimed() {
  const body = text();
  return {
    noSearch: body.includes(S.noSearch),
    placedNone: body.includes(S.placedNoneWithEntries) || body.includes(S.placedNoneEmpty),
    preFeature: body.includes(S.preFeature),
  };
}

// ============================================================================
describe("state 1 - citations present: markers link out to their source", () => {
  it("renders one anchor per placed citation, each a real http(s) link", async () => {
    await render(CITED);
    expect(markers()).toHaveLength(2);
    for (const a of markers()) {
      expect(a.getAttribute("href")).toMatch(/^https?:\/\//);
    }
    expect(markers().map((a) => a.getAttribute("href"))).toEqual([REUTERS, TECHCRUNCH]);
  });

  it("opens every marker in a new tab, safely - both attributes, not one", async () => {
    await render(CITED);
    for (const a of markers()) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("gives every marker an explicit accessible name that is never just a digit", async () => {
    await render(CITED);
    const labels = markers().map((a) => a.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Source 1: Nimbus raises Series C",
      "Source 2: Nimbus depot network",
    ]);
    for (const label of labels) {
      expect(/^\W*\d+\W*$/.test(label || "")).toBe(false);
    }
  });

  it("numbers the markers itself, in document order, with the digits as the only text", async () => {
    await render(CITED);
    expect(markers().map((a) => a.textContent)).toEqual(["1", "2"]);
    expect(markers().map((a) => a.getAttribute("data-citation-marker"))).toEqual(["1", "2"]);
  });

  it("keeps the brackets out of textContent, so the body carries no [n] residue", async () => {
    await render(CITED);
    const body = container.querySelector("[data-digest-body]");
    expect(body).not.toBeNull();
    expect(/\[\d+\]/.test(body.textContent)).toBe(false);
  });

  it("renders the numbered source list as a real <ol>, one entry per marker number", async () => {
    await render(CITED);
    const cited = group("cited");
    expect(cited).not.toBeNull();
    const items = [...cited.querySelectorAll("ol > li")];
    expect(items).toHaveLength(2);
    expect(items.map((li) => li.querySelector("a")?.getAttribute("href"))).toEqual([
      REUTERS,
      TECHCRUNCH,
    ]);
  });

  it("shows the publisher on every entry, so the reader can recognise the source", async () => {
    await render(CITED);
    const entries = [...group("cited").querySelectorAll("ol > li")];
    expect(entries[0].textContent).toContain("Nimbus raises Series C");
    expect(entries[0].textContent).toContain("reuters.com");
    expect(entries[1].textContent).toContain("techcrunch.com");
  });

  it("carries the scope line and the section heading as REAL headings", async () => {
    await render(CITED);
    expect(text()).toContain(S.scope);
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe(S.cited);
    // AC-F13(a)'s negative half: an unrendered group contributes no heading.
    expect(groupNames()).toEqual(["cited"]);
  });

  it("makes every entry open in a new tab too", async () => {
    await render(CITED);
    const entryAnchors = [...group("cited").querySelectorAll("a")];
    expect(entryAnchors.length).toBeGreaterThan(0);
    for (const a of entryAnchors) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("renders no refusal disclosure and no other group on a fully cited digest", async () => {
    await render(CITED);
    expect(statesClaimed()).toEqual({ noSearch: false, placedNone: false, preFeature: false });
    expect(group("also-searched")).toBeNull();
    expect(group("no-provenance")).toBeNull();
  });
});

// ============================================================================
describe("marker-to-source correspondence", () => {
  it("gives entry n the href of the FIRST marker carrying n, not a positional zip", async () => {
    await render(CITED);
    const markerHrefs = new Map();
    for (const a of markers()) {
      const n = a.getAttribute("data-citation-marker");
      if (!markerHrefs.has(n)) markerHrefs.set(n, a.getAttribute("href"));
    }
    const entryHrefs = [...group("cited").querySelectorAll("ol > li")].map(
      (li, i) => [String(i + 1), li.querySelector("a")?.getAttribute("href")]
    );
    for (const [n, href] of entryHrefs) {
      expect(href).toBe(markerHrefs.get(n));
    }
  });

  it("folds two spellings of one page onto ONE number and ONE entry", async () => {
    const digest = {
      ...CITED,
      markdown: MD_TWO_SPELLINGS,
      sources: [
        { url: REUTERS, title: "Nimbus raises Series C", start: 0, end: 25 },
        { url: REUTERS_ALT, title: "Nimbus raises Series C", start: 26, end: 52 },
      ],
      citation_outcome: outcomeFor(MD_TWO_SPELLINGS, { placed: 2 }),
    };
    await render(digest);
    expect(markers().map((a) => a.textContent)).toEqual(["1", "1"]);
    expect([...group("cited").querySelectorAll("ol > li")]).toHaveLength(1);
    // Navigation is decided by the marker's OWN href, never by the entry's.
    expect(markers().map((a) => a.getAttribute("href"))).toEqual([REUTERS, REUTERS_ALT]);
  });

  it("never indexes a parallel array by a marker number", () => {
    // AC-F6, source-level half. `sources[n]`/`sources[n-1]` is the shape that
    // makes a mis-paired citation possible at all.
    expect(panelSrc).not.toMatch(/sources\s*\[\s*[a-zA-Z_$]/);
    expect(panelSrc).not.toMatch(/sources\s*\[\s*\d/);
  });
});

// ============================================================================
describe("state 2 - the model genuinely found nothing (LEGITIMATE)", () => {
  const digest = {
    ...CITED,
    sources: [],
    citation_outcome: outcomeFor(MD, {
      placed: 0,
      annotations: 0,
      searched: false,
    }),
  };

  it("says plainly that no web search ran", async () => {
    await render(digest);
    expect(text()).toContain(S.noSearch);
  });

  it("says NOTHING that would be true of the other three states", async () => {
    await render(digest);
    expect(statesClaimed()).toEqual({ noSearch: true, placedNone: false, preFeature: false });
  });

  it("renders no source block at all - no empty heading, no empty list", async () => {
    await render(digest);
    expect(groupNames()).toEqual([]);
    expect(container.querySelector("ol")).toBeNull();
    expect(text()).not.toContain(S.cited);
  });

  it("puts the notice ABOVE the prose, because no marker exists to attach it to", async () => {
    await render(digest);
    const body = container.querySelector("[data-digest-body]");
    const notice = container.querySelector("[data-digest-notice]");
    expect(notice).not.toBeNull();
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(notice.compareDocumentPosition(body) & 4).toBeTruthy();
  });
});

// ============================================================================
describe("state 3 - citations arrived and NONE were placed (THE DEFECT)", () => {
  const digest = {
    ...CITED,
    sources: [
      { url: REUTERS, title: "Nimbus raises Series C" },
      { url: TECHCRUNCH, title: "Nimbus depot network" },
      { url: "https://ft.com/nimbus", title: "Nimbus, quietly" },
    ],
    citation_outcome: outcomeFor(MD, { placed: 0, annotations: 3 }),
  };

  it("NEVER tells the user no search ran, and never claims the row predates the feature", async () => {
    await render(digest);
    expect(statesClaimed()).toEqual({ noSearch: false, placedNone: true, preFeature: false });
  });

  it("says the search ran and names what it returned", async () => {
    await render(digest);
    expect(text()).toContain(S.placedNoneWithEntries);
  });

  it("lists every returned page under 'Also searched', unnumbered", async () => {
    await render(digest);
    const also = group("also-searched");
    expect(also).not.toBeNull();
    expect(also.querySelector("h3")?.textContent).toBe(S.also);
    expect(text()).toContain(S.alsoWhy);
    const items = [...also.querySelectorAll("ul > li")];
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.querySelector("a")?.getAttribute("href"))).toEqual([
      REUTERS,
      TECHCRUNCH,
      "https://ft.com/nimbus",
    ]);
    for (const li of items) {
      expect(/^\s*\[?\d+[\].]/.test(li.textContent)).toBe(false);
    }
    expect(markers()).toHaveLength(0);
    expect(group("cited")).toBeNull();
  });

  it("uses the other variant when the search returned nothing usable at all", async () => {
    await render({ ...digest, sources: [] });
    expect(text()).toContain(S.placedNoneEmpty);
    expect(text()).not.toContain(S.placedNoneWithEntries);
    expect(groupNames()).toEqual([]);
  });

  it("is never rendered as the legacy state, and never as 'no sources'", async () => {
    await render(digest);
    expect(group("no-provenance")).toBeNull();
    expect(text()).not.toContain(S.legacy);
  });
});

// ============================================================================
describe("state 4 - citation_outcome is SQL NULL: the row predates the fix", () => {
  const LEGACY_MD =
    "Nimbus raised a Series C.1 It runs depots.\n\n[1]: https://www.reuters.com/business/x";
  const digest = {
    application_id: "app-1",
    status: "ready",
    markdown: LEGACY_MD,
    updated_at: "2026-08-01T09:00:00.000Z",
    sources: [{ url: REUTERS, title: "Nimbus raises Series C" }],
    citation_outcome: null,
  };

  it("is NOT rendered as 'the model found nothing', in either variant", async () => {
    await render(digest);
    expect(statesClaimed()).toEqual({ noSearch: false, placedNone: false, preFeature: true });
  });

  it("puts its links in their own group, claiming NO search provenance", async () => {
    await render(digest);
    expect(groupNames()).toEqual(["no-provenance"]);
    expect(group("no-provenance").querySelector("h3")?.textContent).toBe(S.legacy);
    expect(text()).toContain(S.legacyWhy);
    expect(group("also-searched")).toBeNull();
    expect(group("cited")).toBeNull();
  });

  it("keeps a legacy entry clickable but never gives it a marker's affordance", async () => {
    await render(digest);
    const a = group("no-provenance").querySelector("a");
    expect(a?.getAttribute("href")).toBe(REUTERS);
    expect(a?.hasAttribute("data-citation-marker")).toBe(false);
    expect(markers()).toHaveLength(0);
  });

  it("never re-interprets the old-shape markdown as verified footnotes", async () => {
    await render(digest);
    expect(container.querySelectorAll("[data-citation-marker]")).toHaveLength(0);
    expect(container.querySelector("ol[data-fn-list]")).toBeNull();
  });

  it("treats an absent field the same as an explicit null", async () => {
    const { citation_outcome, ...noField } = digest;
    void citation_outcome;
    await render(noField);
    expect(statesClaimed().preFeature).toBe(true);
    expect(groupNames()).toEqual(["no-provenance"]);
  });

  it("takes the legacy path for an outcome shape this build cannot read", async () => {
    await render({ ...digest, citation_outcome: { version: 99, counts: { placed: 1 } } });
    expect(markers()).toHaveLength(0);
    expect(text()).not.toContain(S.noSearch);
  });
});

// ============================================================================
describe("a refused URL renders as text, with no anchor anywhere", () => {
  it("refuses a javascript: source and still shows it as inert text", async () => {
    await render({
      ...CITED,
      sources: [{ url: "javascript:alert(1)", title: "Nimbus latest" }],
      citation_outcome: outcomeFor(MD, { placed: 0, annotations: 1 }),
    });
    const also = group("also-searched");
    expect(also.textContent).toContain("Nimbus latest");
    expect(also.querySelector("a")).toBeNull();
  });

  it("refuses the userinfo shape a scheme-prefix test would admit", async () => {
    await render({
      ...CITED,
      sources: [{ url: "https://acme.com@evil.example/x", title: "acme.com" }],
      citation_outcome: outcomeFor(MD, { placed: 0, annotations: 1 }),
    });
    expect(group("also-searched").querySelector("a")).toBeNull();
    expect(text()).not.toContain("evil.example");
  });

  it("never emits href=\"\", href=\"#\", or an anchor with no href", async () => {
    await render({
      ...CITED,
      sources: [
        { title: "no url at all" },
        "a bare string",
        null,
        { url: "  https://acme.com/padded  ", title: "padded" },
        { url: REUTERS, title: "Nimbus raises Series C" },
      ],
      citation_outcome: outcomeFor(MD, { placed: 0, annotations: 5 }),
    });
    for (const a of anchors()) {
      const href = a.getAttribute("href");
      expect(href).toMatch(/^https?:\/\//);
      expect(href).not.toBe("#");
    }
    // The padded string is refused rather than trimmed: a trimmed href is a
    // different string from the one that was checked.
    expect(anchors().map((a) => a.getAttribute("href"))).toEqual([REUTERS]);
  });

  it("never renders an entry with no text", async () => {
    await render({
      ...CITED,
      sources: [{ title: "x" }, "bare", null],
      citation_outcome: outcomeFor(MD, { placed: 0, annotations: 3 }),
    });
    for (const li of container.querySelectorAll("li")) {
      expect(li.textContent.trim().length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
describe("the integrity stamp - a row whose prose changed after stamping", () => {
  it("removes every number rather than printing one that points nowhere", async () => {
    // A same-length word swap: invisible to a length check, which is why the
    // hash is the load-bearing half.
    const mutated = MD.replace("twelve", "eleven");
    await render({ ...CITED, markdown: `${mutated} `.slice(0, MD.length) });
    expect(markers()).toHaveLength(0);
    expect(text()).toContain(S.stamp);
    expect(container.querySelector("ol")).toBeNull();
  });

  it("degrades the whole set into 'Also searched' rather than inventing a fourth group", async () => {
    const mutated = `${MD.replace("twelve", "eleven")} `.slice(0, MD.length);
    await render({ ...CITED, markdown: mutated });
    expect(groupNames()).toEqual(["also-searched"]);
    expect([...group("also-searched").querySelectorAll("li")]).toHaveLength(2);
  });

  it("refuses every span when the record does not describe the spans it was handed", async () => {
    // The F-2 hole: new markdown, a matching stamp, one-run-old spans.
    await render({
      ...CITED,
      citation_outcome: outcomeFor(MD, { placed: 1, annotations: 2 }),
    });
    expect(markers()).toHaveLength(0);
    expect(text()).toContain(S.stamp);
  });
});

// ============================================================================
describe("the non-publisher host is never named as the source", () => {
  const digest = {
    ...CITED,
    sources: [
      { url: REDIRECT_A, title: "Nimbus raises Series C", start: 0, end: 25 },
      { url: REDIRECT_B, title: "Nimbus depot network", start: 26, end: 58 },
    ],
    citation_outcome: outcomeFor(MD, { placed: 2 }),
  };

  it("shows the title and suppresses the redirector's host", async () => {
    await render(digest);
    for (const li of container.querySelectorAll("li")) {
      expect(li.textContent).not.toContain("vertexaisearch");
      expect(li.textContent).not.toContain("cloud.google.com");
    }
    expect(text()).toContain("Nimbus raises Series C");
  });

  it("labels the destination honestly, exactly once", async () => {
    await render(digest);
    expect(container.querySelector("[data-fn-nonpublisher]")).not.toBeNull();
    const hits = text().split(S.redirect).length - 1;
    expect(hits).toBe(1);
  });

  it("negative control: a publisher-shaped digest shows its hosts and no such line", async () => {
    await render(CITED);
    expect(container.querySelector("[data-fn-nonpublisher]")).toBeNull();
    expect(text()).not.toContain(S.redirect);
    expect(text()).toContain("reuters.com");
  });

  it("keeps the href untouched - the rule changes what is said, never where it goes", async () => {
    await render(digest);
    expect(markers().map((a) => a.getAttribute("href"))).toEqual([REDIRECT_A, REDIRECT_B]);
  });
});

// ============================================================================
describe("entry composition", () => {
  it("renders the host once when the title IS the host", async () => {
    await render({
      ...CITED,
      sources: [{ url: REUTERS, title: "reuters.com", start: 0, end: 25 }],
      citation_outcome: outcomeFor(MD, { placed: 1 }),
    });
    const li = container.querySelector("[data-fn-group='cited'] li");
    const hits = li.textContent.split("reuters.com").length - 1;
    expect(hits).toBe(1);
  });

  it("falls back to the host when the annotation carried no title", async () => {
    await render({
      ...CITED,
      sources: [{ url: REUTERS, start: 0, end: 25 }],
      citation_outcome: outcomeFor(MD, { placed: 1 }),
    });
    expect(markers()[0].getAttribute("aria-label")).toBe("Source 1: reuters.com");
  });

  it("truncates a very long label at a word boundary rather than mid-word", async () => {
    const long = `${"Nimbus ".repeat(20)}raises`;
    await render({
      ...CITED,
      sources: [{ url: REUTERS, title: long, start: 0, end: 25 }],
      citation_outcome: outcomeFor(MD, { placed: 1 }),
    });
    const label = markers()[0].getAttribute("aria-label");
    expect(label.length).toBeLessThanOrEqual("Source 1: ".length + 81);
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toMatch(/\S…$/);
  });
});

// ============================================================================
describe("states that must not throw", () => {
  it("survives sources being a non-array", async () => {
    await render({ ...CITED, sources: { url: REUTERS } });
    expect(markers()).toHaveLength(0);
    expect(text().length).toBeGreaterThan(0);
  });

  it("survives no digest at all", async () => {
    await render(null);
    expect(text()).toContain("Not researched yet");
  });

  it("discloses a truncated interaction", async () => {
    await render({
      ...CITED,
      citation_outcome: outcomeFor(MD, { placed: 2, truncated: true }),
    });
    expect(text()).toContain(S.truncated);
    expect(markers()).toHaveLength(2);
  });

  it("says the LATEST research failed, and when the shown prose is from", async () => {
    await render({
      ...CITED,
      status: "failed",
      error: "Gemini timed out",
      researched_at: "2026-09-05T11:00:00.000Z",
      updated_at: "2026-09-05T12:59:00.000Z",
    });
    expect(text()).toContain("The latest research failed.");
    expect(text()).toContain("2h ago");
    expect(text()).toContain("Gemini timed out");
    // Never the honest-looking lie: "Researched a minute ago" on stale prose.
    expect(text()).not.toMatch(/Researched 1m ago/);
  });

  it("renders no citation UI whatsoever for prose with nothing citation-shaped", async () => {
    const md = "Nimbus is a logistics company.";
    await render({
      ...CITED,
      markdown: md,
      sources: [],
      citation_outcome: outcomeFor(md, { placed: 0, annotations: 0 }),
    });
    expect(groupNames()).toEqual([]);
    expect(text()).not.toContain(S.cited);
    expect(text()).not.toContain(S.scope);
  });
});

// ============================================================================
describe("Research again destroys the only copy, so it asks first", () => {
  it("does not re-research on the first click", async () => {
    const onResearchAgain = vi.fn();
    await render(CITED, { onResearchAgain });
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Research again"
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResearchAgain).toHaveBeenCalledTimes(0);
    expect(container.querySelector("[data-confirm-research]")).not.toBeNull();
    expect(container.querySelector("[data-confirm-research]").textContent).toContain("2 sources");
  });

  it("re-researches exactly once when the destructive button is pressed", async () => {
    const onResearchAgain = vi.fn();
    await render(CITED, { onResearchAgain });
    const open = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Research again"
    );
    await act(async () => {
      open.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirm = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Replace research"
    );
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResearchAgain).toHaveBeenCalledTimes(1);
    expect(onResearchAgain).toHaveBeenCalledWith("app-1");
  });

  it("restores the resting control, and researches nothing, when the user keeps what they have", async () => {
    const onResearchAgain = vi.fn();
    await render(CITED, { onResearchAgain });
    const open = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Research again"
    );
    await act(async () => {
      open.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const keep = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Keep what I have"
    );
    await act(async () => {
      keep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResearchAgain).toHaveBeenCalledTimes(0);
    expect(container.querySelector("[data-confirm-research]")).toBeNull();
  });

  it("cannot be opened while research is already running", async () => {
    const onResearchAgain = vi.fn();
    await render(CITED, { onResearchAgain, researching: true });
    const button = [...container.querySelectorAll("button")].find((b) =>
      /Research/.test(b.textContent)
    );
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-confirm-research]")).toBeNull();
    expect(onResearchAgain).toHaveBeenCalledTimes(0);
  });
});

// ============================================================================
describe("the research log", () => {
  it("offers a download control whenever there is an outcome record to explain", async () => {
    await render(CITED);
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Download research log"
    );
    expect(button).toBeTruthy();
  });

  it("names hosts, never full URLs, and never the user", async () => {
    // Privacy is asserted by EXCLUSION with a positive control: the log must
    // contain the host (so the assertion is not vacuous) and must not contain
    // the path that would identify the article.
    let captured = "";
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      captured = blob.__text || "";
      return "blob:stub";
    };
    URL.revokeObjectURL = () => {};
    const OriginalBlob = globalThis.Blob;
    globalThis.Blob = class extends OriginalBlob {
      constructor(parts, options) {
        super(parts, options);
        this.__text = parts.join("");
      }
    };
    try {
      await render(CITED);
      const button = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Download research log"
      );
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    } finally {
      URL.createObjectURL = createObjectURL;
      globalThis.Blob = OriginalBlob;
    }
    expect(captured).toContain("reuters.com");
    expect(captured).not.toContain("nimbus-series-c");
    expect(captured).not.toContain(REUTERS);
    expect(captured).toContain("placed");
  });
});

// ============================================================================
describe("the URL gate, and the craft rulings that cannot be checked at runtime", () => {
  it("takes every href from the shared gate and from nothing else", () => {
    // hrefSafety.sweep.test.js enforces this repo-wide; asserted here too so a
    // regression names THIS module rather than a generic sweep row.
    expect(panelSrc).toContain("safeExternalHref");
    const hrefSites = panelSrc.match(/href=\{([^}]*)\}/g) || [];
    expect(hrefSites.length).toBeGreaterThan(0);
    for (const site of hrefSites) {
      expect(site).toMatch(/href=\{(safeExternalHref\(|markerHref\b|entryHref\b)/);
    }
    expect(panelSrc).toMatch(/const markerHref = safeExternalHref\(/);
    expect(panelSrc).toMatch(/const entryHref = safeExternalHref\(/);
  });

  it("scopes the one link style away from the marker in the SELECTOR, with the longhand", () => {
    expect(panelSrc).toContain('"& a:not([data-citation-marker])"');
    expect(panelSrc).toContain("textDecorationLine");
    expect(panelSrc).not.toMatch(/\btextDecoration:/);
  });

  it("declares the focus ring as longhands, never the dropped shorthand, and never bare :focus", () => {
    expect(panelSrc).toContain("&:focus-visible");
    expect(panelSrc).toContain("outlineStyle");
    expect(panelSrc).not.toMatch(/\boutline:\s*["']/);
    expect(panelSrc).not.toMatch(/"&:focus"/);
  });

  it("puts no Tooltip on a marker, so nothing overwrites its accessible name", () => {
    expect(panelSrc).not.toContain("Tooltip");
  });

  it("uses --text-secondary and never --text-muted, which fails contrast in light", () => {
    expect(panelSrc).toContain("--text-secondary");
    expect(panelSrc).not.toContain("--text-muted");
  });

  it("leaves the native list counters alone, in both spellings", () => {
    expect(panelSrc).not.toContain("listStyleType");
    expect(panelSrc).not.toMatch(/listStyle\b/);
  });

  it("never clamps or ellipsises a source title in CSS", () => {
    expect(panelSrc).not.toContain("WebkitLineClamp");
    expect(panelSrc).not.toContain("textOverflow");
  });

  it("adds no motion and nothing collapsible", () => {
    expect(panelSrc).not.toMatch(/\btransition\b/);
    expect(panelSrc).not.toContain("Accordion");
    expect(panelSrc).not.toContain("Collapse");
  });
});

// ============================================================================
describe("adoption - the module is rendered, not merely written", () => {
  it("AppViewDialog renders DigestPanel from its own module", () => {
    expect(dialogSrc).toContain("<DigestPanel");
    expect(dialogSrc).toMatch(/import DigestPanel from ".\/tracking\/DigestPanel/);
  });

  it("AppViewDialog no longer carries its own copy of the panel", () => {
    // The only one of the three that can fail when someone imports the new
    // module and leaves the old one rendering.
    expect(dialogSrc).not.toMatch(/function DigestPanel/);
  });

  it("keeps the digest on the real markdown parser", () => {
    expect(panelSrc).toContain("MarkdownPreview");
    expect(panelSrc).not.toContain("FormattedContent");
  });

  it("MarkdownPreview's renderLink seam is optional and defaults to today's rendering", () => {
    expect(previewSrc).toMatch(/renderLink/);
    // The gated external branch must survive the change.
    expect(previewSrc).toMatch(/const href = safeExternalHref\(token\.href\)/);
    expect(previewSrc).toMatch(/href=\{href\}/);
  });
});
