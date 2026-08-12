// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// PageTree.test.js and ExperienceTab.test.js are the precedents for
// rendering a whole component here.
//
// BulkActionsBar cannot literally reuse DeletePageDialog/MovePageDialog -
// both hard-code a single `page` prop and are outside this chunk's editable
// files - so it rebuilds their SHAPE (same FormDialog primitive and message
// cadence for delete; the same Dialog/List/ListItemButton layout for move)
// driven by lib/experience/bulkSelection.js's bulk-aware helpers instead of
// the single-page ones. These tests exercise that wiring directly, the same
// way PageTree.test.js exercises treeNav's wiring rather than re-testing
// treeNav's own pure logic.
//
// Research report (chunk 9) is wired here too: it fires
// POST /api/experience/research once per selected page via
// lib/tailor/runWithConcurrency.js, so global.fetch is mocked the same way
// ExperienceTab.test.js and AttachmentPanel.test.js already mock it. The
// engine gate (app/settings/engine.js's readEngine) is mocked so tests can
// choose "embedded" vs "gemini" without touching localStorage.
// lib/experience/researchReport.js's own prompt/reconciliation logic is
// NOT re-tested here - lib/experience/researchReport.test.js already pins
// it, and the route itself (mocking only Supabase + Gemini) is pinned by
// app/api/experience/research/route.test.js. This file's job is only: does
// clicking the button call the route once per selected page, can it not be
// double-fired, does it report per-page success/failure, and does the
// embedded engine refuse without ever calling fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import BulkActionsBar from "./BulkActionsBar.js";

vi.mock("../../settings/engine", () => ({
  readEngine: vi.fn(() => "gemini"),
}));

// PowerPoint generation is deterministic composition, not an AI feature - it
// never checks wantsEmbedded/readEngine (unlike Research report above it),
// so the engine mock exists only for that other describe block.
vi.mock("../../../lib/experience/deckTemplateStore.js", () => ({
  fetchDeckTemplate: vi.fn(),
  uploadDeckTemplate: vi.fn(),
}));

// Only triggerBlobDownload is mocked - a real DOM side effect (an <a> click
// through a blob: URL) that jsdom cannot usefully perform and that these
// tests have no reason to exercise. sanitizeFileNamePart stays real via
// importOriginal, since BulkActionsBar.js uses it for the download's file
// name and a fake would only prove the fake.
vi.mock("../../../lib/document/docx.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerBlobDownload: vi.fn() };
});

import { readEngine } from "../../settings/engine";
import { fetchDeckTemplate, uploadDeckTemplate } from "../../../lib/experience/deckTemplateStore.js";
import { triggerBlobDownload } from "../../../lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  readEngine.mockReturnValue("gemini");
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete global.fetch;
  vi.clearAllMocks();
});

function row(id, parentId, title) {
  return { id, user_id: "u1", parent_id: parentId, title, body: "", position: 0, archived_at: null, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" };
}

// Alpha
//   Boeing
//     Boeing detail
//   Ceiling
// Zulu
//   Zulu child
const PAGES = [
  row("n1", null, "Alpha"),
  row("n2", "n1", "Boeing"),
  row("n4", "n2", "Boeing detail"),
  row("n3", "n1", "Ceiling"),
  row("n7", null, "Zulu"),
  row("n8", "n7", "Zulu child"),
];

function baseProps(overrides) {
  return {
    pages: PAGES,
    selectedIds: new Set(),
    onDeleteSelected: vi.fn().mockResolvedValue({ ok: true }),
    onMoveSelected: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(BulkActionsBar, props));
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

// PowerPoint generation's chain (attachments fetch -> outline -> template
// fetch -> buildDeck's own JSZip reads/writes) is deep enough that some of
// jszip's own internal steps yield via a real timer, not just a microtask -
// an `await act(async () => {})` loop only ever drains microtasks, so it can
// spin its full iteration count without that timer ever getting a turn.
// This waits on an actual macrotask each iteration instead, so those steps
// get a genuine chance to run.
async function flushDeck(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
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

describe("visibility", () => {
  it("renders nothing when the selection is empty", async () => {
    await render(baseProps());
    expect(container.querySelector('[role="region"]')).toBeNull();
    expect(document.querySelector('[role="region"][aria-label="Bulk actions"]')).toBeNull();
  });

  it("renders a labelled region with the count once something is checked", async () => {
    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region.getAttribute("aria-label")).toBe("Bulk actions");
    expect(region.textContent).toContain("1 selected");
  });

  it("reachable in the tab order ahead of any tree row - not nested inside a role=tree", async () => {
    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    expect(container.querySelector('[role="tree"] [role="region"]')).toBeNull();
  });
});

describe("delete selected", () => {
  it("names the deduplicated total in the confirmation, not a naive sum of selected + descendants", async () => {
    // Alpha (n1) and its own child Boeing (n2) selected together: selected=2,
    // descendants=2 (Boeing detail + Ceiling), total=4 - a naive sum would
    // read 2 selected + 4 descendants(of n1 alone) = 6, over-stating the
    // blast radius.
    await render(baseProps({ selectedIds: new Set(["n1", "n2"]) }));
    await click(findButton("Delete selected"));
    expect(document.body.textContent).toContain("Delete 4 pages? This cannot be undone.");
    expect(document.body.textContent).not.toContain("6 pages");
  });

  it("calls onDeleteSelected with every checked id", async () => {
    const onDeleteSelected = vi.fn().mockResolvedValue({ ok: true });
    await render(baseProps({ selectedIds: new Set(["n3"]), onDeleteSelected }));
    await click(findButton("Delete selected"));
    expect(document.body.textContent).toContain("Delete 1 page? This cannot be undone.");

    // MUI's Dialog keeps its node mounted through its own exit transition
    // (real CSS-driven milliseconds, not something this test's act() calls
    // advance), so asserting `[role="dialog"]` vanishes synchronously would
    // be asserting an implementation timing detail, not behaviour -
    // ExperienceTab.test.js's own move/delete tests never do that either;
    // they assert the SIDE EFFECT (here, the exact ids handed to the
    // caller) instead, which is what this test does above.
    await click(findButton("Delete"));
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(onDeleteSelected).toHaveBeenCalledWith(["n3"]);
  });

  it("keeps the dialog open and surfaces the reason when the delete fails", async () => {
    const onDeleteSelected = vi.fn().mockResolvedValue({ ok: false, error: "2 of 2 pages could not be deleted." });
    await render(baseProps({ selectedIds: new Set(["n1", "n7"]), onDeleteSelected }));
    await click(findButton("Delete selected"));
    await click(findButton("Delete"));

    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("2 of 2 pages could not be deleted.");
  });
});

describe("move selected", () => {
  it("disables Move with a stated reason when no destination fits every selected page", async () => {
    const onMoveSelected = vi.fn();
    const all = new Set(PAGES.map((p) => p.id));
    await render(baseProps({ selectedIds: all, onMoveSelected }));

    const moveBtn = findButton("Move selected");
    expect(moveBtn).toBeDefined();
    expect(moveBtn.getAttribute("aria-disabled")).toBe("true");
    // B3-style: aria-disabled, never the native `disabled` attribute, so a
    // keyboard user can still reach (and hear) the explanation.
    expect(moveBtn.disabled).toBe(false);
    const describedBy = moveBtn.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy).textContent).toContain("No destination fits every selected page.");

    await click(moveBtn);
    expect(container.querySelector('[aria-label="Move to"]')).toBeNull();
    expect(onMoveSelected).not.toHaveBeenCalled();
  });

  it("lists legal destinations and moves on the first click", async () => {
    const onMoveSelected = vi.fn();
    await render(baseProps({ selectedIds: new Set(["n3"]), onMoveSelected }));

    const moveBtn = findButton("Move selected");
    expect(moveBtn.getAttribute("aria-disabled")).toBeNull();
    await click(moveBtn);

    const zuluTarget = [...document.querySelectorAll('[aria-label="Move to"] [role="button"]')].find(
      (b) => b.textContent.trim() === "Zulu",
    );
    expect(zuluTarget).toBeDefined();
    await click(zuluTarget);

    // Fire-and-close, same as MovePageDialog's own choose(): the move is
    // requested with no spinner and no await, one click after the picker
    // opens - the same click cost the single-page Move flow already has.
    expect(onMoveSelected).toHaveBeenCalledTimes(1);
    expect(onMoveSelected).toHaveBeenCalledWith(["n3"], "n7");
  });
});

// A minimal, valid .pptx fixture built with real jszip - same shape as
// lib/experience/pptxWriter.test.js's own templateZip() helper (content
// types, package rels, presentation.xml + its rels, one theme, one master,
// two layouts). The theme carries a marker name found nowhere else, so a
// test can prove the STORED template's bytes actually flowed through
// buildDeck rather than merely that generation "worked".
const MARKER_THEME_NAME = "BulkActionsBarBrandTheme";
const RELS_XML_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`;

function layoutXml(name, type) {
  return `<?xml version="1.0"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="${type}"><p:cSld name="${name}"/></p:sldLayout>`;
}

async function validTemplateZipBytes() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="${RELS_XML_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="${RELS_XML_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${MARKER_THEME_NAME}"><a:themeElements/></a:theme>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", layoutXml("Title Slide", "title"));
  zip.file("ppt/slideLayouts/slideLayout2.xml", layoutXml("Title and Content", "obj"));
  return zip.generateAsync({ type: "uint8array" });
}

function jsonAttachmentsResponse(attachments = []) {
  return jsonResponse(200, { attachments });
}

// Every selected page's attachments are fetched (GET
// /api/experience/attachments?pageId=...) as part of building the outline -
// see deckOutline.js's outlineFromPages, which needs { page, attachments }
// per entry. These tests never care what comes back (deckOutline.test.js
// and pptxWriter.test.js already pin content-shaping), so every call just
// answers with none.
function mockAttachmentsFetch() {
  global.fetch = vi.fn(() => Promise.resolve(jsonAttachmentsResponse([])));
}

// Deliberately tiny, non-decodable bytes - pptxWriter.js's buildDeck never
// inspects image content, only carries the bytes through, so a test only
// needs to prove THESE SPECIFIC bytes reach the produced zip.
const FAKE_IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6, 5]);

function okArrayBufferResponse(bytes) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// Once attachments can include an image, generating a deck makes TWO kinds
// of fetch call: the per-page attachments list (GET
// /api/experience/attachments?pageId=...) and, for each image attachment
// that list returns, a GET of its own signed `url` for the raw bytes. This
// router tells them apart by path so a single mock can answer both -
// `attachments` is returned for every attachments-list call (these tests
// only ever select one page), `imageFetch(url)` handles every other URL.
function mockFetchWithImageAttachments(attachments, imageFetch) {
  global.fetch = vi.fn((url) => {
    if (typeof url === "string" && url.startsWith("/api/experience/attachments")) {
      return Promise.resolve(jsonAttachmentsResponse(attachments));
    }
    return imageFetch(url);
  });
}

describe("PowerPoint", () => {
  beforeEach(() => {
    fetchDeckTemplate.mockReset().mockResolvedValue({ blob: null, name: null });
    uploadDeckTemplate.mockReset();
    triggerBlobDownload.mockReset();
  });

  it("is visible and named, and no longer permanently disabled now that it is wired up", async () => {
    mockAttachmentsFetch();
    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    const btn = findButton("PowerPoint");
    expect(btn).toBeDefined();
    expect(btn.getAttribute("aria-disabled")).toBeNull();
  });

  it("one click generates and downloads with no intermediate dialog", async () => {
    mockAttachmentsFetch();
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob, fileName] = triggerBlobDownload.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(fileName).toMatch(/\.pptx$/);
  });

  it("generates using the writer's built-in skeleton when no template was ever uploaded - never a blocker", async () => {
    fetchDeckTemplate.mockResolvedValue({ blob: null, name: null });
    mockAttachmentsFetch();
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob] = triggerBlobDownload.mock.calls[0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const themeXml = await zip.file("ppt/theme/theme1.xml").async("string");
    expect(themeXml).toContain("Default Theme"); // pptxWriter.js's own built-in theme name
  });

  it("uses the remembered template silently - fetched once, never re-selected by the user", async () => {
    const templateBytes = await validTemplateZipBytes();
    fetchDeckTemplate.mockResolvedValue({ blob: new Blob([templateBytes]), name: "CompanyBrand.pptx" });
    mockAttachmentsFetch();
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    expect(fetchDeckTemplate).toHaveBeenCalledTimes(1);
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob] = triggerBlobDownload.mock.calls[0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const themeXml = await zip.file("ppt/theme/theme1.xml").async("string");
    expect(themeXml).toContain(MARKER_THEME_NAME);
  });

  it("an unreadable stored template surfaces a message naming the file, and still offers generation without it", async () => {
    fetchDeckTemplate.mockResolvedValue({ blob: new Blob(["not a zip file"]), name: "Broken.pptx" });
    mockAttachmentsFetch();
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    expect(triggerBlobDownload).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Broken.pptx");

    const withoutTemplateBtn = findButton("Generate without it");
    expect(withoutTemplateBtn).toBeDefined();
    await click(withoutTemplateBtn);
    await flushDeck();

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
  });

  it("cannot be double-fired: extra clicks while generating send no extra request or download", async () => {
    let resolvers = [];
    global.fetch = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    const btn = findButton("PowerPoint");
    await click(btn);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-disabled")).toBe("true");

    await click(btn);
    await click(btn);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolvers.forEach((resolve) => resolve(jsonAttachmentsResponse([])));
    await flushDeck();
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-disabled")).toBeNull();

    // Resolve immediately from here on - this second click is proving the
    // button works again after finishing, not exercising the pending state.
    mockAttachmentsFetch();
    await click(btn);
    await flushDeck();
    expect(triggerBlobDownload).toHaveBeenCalledTimes(2);
  });

  it("the produced deck has a slide for each selected page - asserted against the real bytes via jszip, not a mock of the generator", async () => {
    mockAttachmentsFetch();
    // Alpha (n1) and Ceiling (n3) - both have an empty body in this file's
    // PAGES fixture, so deckOutline.js's outlineFromPages produces exactly
    // one title slide per page and nothing else.
    await render(baseProps({ selectedIds: new Set(["n1", "n3"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    const [blob] = triggerBlobDownload.mock.calls[0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort();
    expect(slidePaths).toHaveLength(2);

    const texts = await Promise.all(slidePaths.map((p) => zip.file(p).async("string")));
    expect(texts.some((t) => t.includes("Alpha"))).toBe(true);
    expect(texts.some((t) => t.includes("Ceiling"))).toBe(true);
  });

  // The actual gap this chunk exists to close: an "image" outline slide
  // (deckOutline.js's slidesForAttachment) only ever carried its
  // attachment's name/caption as text. Proving the picture is really in the
  // downloaded bytes - not just that some fetch happened - is the same
  // discipline pptxWriter.test.js uses: assert the produced zip, never a
  // mock of the generator.
  it("fetches an image attachment's own signed url and embeds its bytes in the downloaded deck", async () => {
    const attachment = {
      id: "att1",
      kind: "image",
      name: "topology.png",
      mime: "image/png",
      url: "https://signed.example/att1.png",
      notes: "System diagram",
    };
    mockFetchWithImageAttachments([attachment], (url) => {
      expect(url).toBe(attachment.url);
      return Promise.resolve(okArrayBufferResponse(FAKE_IMAGE_BYTES));
    });
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob] = triggerBlobDownload.mock.calls[0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const mediaPaths = Object.keys(zip.files).filter(
      (p) => /^ppt\/media\/[^/]+$/.test(p) && !zip.files[p].dir,
    );
    expect(mediaPaths).toHaveLength(1);
    const mediaBytes = await zip.file(mediaPaths[0]).async("uint8array");
    expect([...mediaBytes]).toEqual([...FAKE_IMAGE_BYTES]);
  });

  it("skips an image whose fetch fails (expired signed url) and still produces the deck with the caption-only slide", async () => {
    const attachment = {
      id: "att1",
      kind: "image",
      name: "topology.png",
      mime: "image/png",
      url: "https://signed.example/att1.png",
      notes: "System diagram",
    };
    mockFetchWithImageAttachments([attachment], () => Promise.reject(new Error("network down")));
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob] = triggerBlobDownload.mock.calls[0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const mediaPaths = Object.keys(zip.files).filter(
      (p) => /^ppt\/media\/[^/]+$/.test(p) && !zip.files[p].dir,
    );
    expect(mediaPaths).toHaveLength(0);

    const slideTexts = await Promise.all(
      Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .map((p) => zip.file(p).async("string")),
    );
    expect(slideTexts.some((t) => t.includes("topology.png"))).toBe(true);
  });

  it("skips an image whose signed url now 403s (expired) the same way, without failing the rest of the deck", async () => {
    const attachment = {
      id: "att1",
      kind: "image",
      name: "topology.png",
      mime: "image/png",
      url: "https://signed.example/att1.png",
      notes: "",
    };
    mockFetchWithImageAttachments([attachment], () => Promise.resolve({ ok: false, status: 403 }));
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    await click(findButton("PowerPoint"));
    await flushDeck();

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob] = triggerBlobDownload.mock.calls[0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const mediaPaths = Object.keys(zip.files).filter(
      (p) => /^ppt\/media\/[^/]+$/.test(p) && !zip.files[p].dir,
    );
    expect(mediaPaths).toHaveLength(0);
  });

  it("fetches image bytes concurrently but never more than 3 at once", async () => {
    const attachments = Array.from({ length: 5 }, (_, i) => ({
      id: `att${i}`,
      kind: "image",
      name: `img${i}.png`,
      mime: "image/png",
      url: `https://signed.example/att${i}.png`,
      notes: "",
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers = [];
    mockFetchWithImageAttachments(attachments, () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        resolvers.push(() => {
          inFlight -= 1;
          resolve(okArrayBufferResponse(FAKE_IMAGE_BYTES));
        });
      });
    });

    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    await click(findButton("PowerPoint"));

    // Let every fetch that's going to start on its own (no help from
    // resolving anything) actually fire.
    await flushDeck(5);
    expect(inFlight).toBe(3);
    expect(resolvers).toHaveLength(3);

    // Each resolution must be observed (an awaited flush) before the next
    // queued fetch is allowed to start, or the in-flight count this test
    // exists to pin becomes meaningless - so this loop is intentionally
    // sequential, not parallelized.
    while (resolvers.length > 0) {
      resolvers.shift()();
      await flushDeck(3);
    }
    await flushDeck();

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
  });
});

describe("PowerPoint template (secondary control)", () => {
  beforeEach(() => {
    fetchDeckTemplate.mockReset().mockResolvedValue({ blob: null, name: null });
    uploadDeckTemplate.mockReset();
  });

  it("changing the template is a control on the bar, not a step the generate click makes the user pass through first", async () => {
    mockAttachmentsFetch();
    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    // The PowerPoint button itself must still fire with zero prior setup -
    // covered by the "one click" test above - this test only pins that the
    // upload control exists as its OWN element, never gating that click.
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("uploads the chosen file via deckTemplateStore and reports its name", async () => {
    uploadDeckTemplate.mockResolvedValue({ error: null, name: "Brand.pptx" });
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    const fileInput = container.querySelector('input[type="file"]');
    const file = new File(["bytes"], "Brand.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    Object.defineProperty(fileInput, "files", { value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await flush();

    expect(uploadDeckTemplate).toHaveBeenCalledWith(file);
    expect(document.body.textContent).toContain("Brand.pptx");
  });
});

describe("research report", () => {
  it("runs on the first click with no dialog, POSTing pageId + the current engine for every selected page", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { page: { id: "r1" } }));
    readEngine.mockReturnValue("gemini");
    await render(baseProps({ selectedIds: new Set(["n1", "n3"]) }));

    const btn = findButton("Research report");
    expect(btn).toBeDefined();
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    await click(btn);
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const bodies = global.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body));
    expect(bodies.map((b) => b.pageId).sort()).toEqual(["n1", "n3"]);
    for (const b of bodies) expect(b.engine).toBe("gemini");
    for (const [url] of global.fetch.mock.calls) expect(url).toBe("/api/experience/research");
  });

  it("cannot be double-fired: a second click while a batch is still running sends no extra requests", async () => {
    let resolvers = [];
    global.fetch = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    await render(baseProps({ selectedIds: new Set(["n1"]) }));

    const btn = findButton("Research report");
    await click(btn);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-disabled")).toBe("true");

    await click(btn);
    await click(btn);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Resolve the in-flight request and confirm the button becomes usable
    // again rather than staying locked forever.
    resolvers.forEach((resolve) => resolve(jsonResponse(200, { page: { id: "r1" } })));
    await flush();
    expect(btn.getAttribute("aria-disabled")).toBeNull();

    await click(btn);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("reports success and failure per page rather than failing the whole batch on one error", async () => {
    global.fetch = vi.fn((url, opts) => {
      const { pageId } = JSON.parse(opts.body);
      if (pageId === "n3") return Promise.resolve(jsonResponse(502, { error: "Research failed. Please try again." }));
      return Promise.resolve(jsonResponse(200, { page: { id: `report-${pageId}` } }));
    });
    await render(baseProps({ selectedIds: new Set(["n1", "n3"]) }));

    await click(findButton("Research report"));
    await flush();

    expect(document.body.textContent).toContain("1");
    expect(document.body.textContent).toContain("Research failed. Please try again.");
  });

  it("refuses under the embedded engine without ever calling fetch, and creates no page", async () => {
    global.fetch = vi.fn();
    readEngine.mockReturnValue("embedded");
    await render(baseProps({ selectedIds: new Set(["n1", "n3"]) }));

    await click(findButton("Research report"));
    await flush();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.body.textContent.toLowerCase()).toContain("gemini engine");
  });
});

// "Add to library" opens ImportToLibraryDialog.js (a sibling chunk) over
// whichever pages are selected. lib/experience/tailorSources.js's own gate
// test (lib/experience/tailorSources.test.js) already pins the mining rules
// themselves - in particular that a page with any generated_kind set is
// NEVER a source. This file's job is only the WIRING: does the button
// reflect what the CURRENT selection would actually yield, and does the
// dialog it opens see fragments mined from the real selected rows (body,
// generated_kind and all - the same rows GET /api/experience already
// returns, per useExperiencePages.js) rather than a stub.
describe("add to library", () => {
  function pageWithBody(id, title, body, overrides = {}) {
    return { ...row(id, null, title), body, ...overrides };
  }

  it("is aria-disabled with a stated reason when the selection has no accomplishment material", async () => {
    const pages = [pageWithBody("b1", "Empty project", "")];
    await render(baseProps({ pages, selectedIds: new Set(["b1"]) }));

    const btn = findButton("Add to library");
    expect(btn).toBeDefined();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const describedBy = btn.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy).textContent).toContain("No accomplishment");

    await click(btn);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens a review dialog with candidate bullets mined only from the selected page(s)", async () => {
    const pages = [
      pageWithBody("b1", "Payments migration", "- Cut settlement from three days to one"),
      pageWithBody("b2", "Other project", "- Some other unrelated bullet that should not appear"),
    ];
    await render(baseProps({ pages, selectedIds: new Set(["b1"]) }));

    const btn = findButton("Add to library");
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    await click(btn);

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Cut settlement from three days to one");
    expect(document.body.textContent).not.toContain("Some other unrelated bullet");
  });

  it("never mines a selected page whose generated_kind is set, even though the page sits right there in the selection", async () => {
    const pages = [
      pageWithBody(
        "b1",
        "Research: Payments (2026-08-12)",
        "- Adopt logical replication for zero-downtime cutover",
        { generated_kind: "research" },
      ),
    ];
    await render(baseProps({ pages, selectedIds: new Set(["b1"]) }));

    const btn = findButton("Add to library");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("posts only the fragments the user keeps to the content-library endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { row: {} }));
    const pages = [
      pageWithBody(
        "b1",
        "Payments migration",
        "- Cut settlement from three days to one\n- Retired the legacy processor",
      ),
    ];
    await render(baseProps({ pages, selectedIds: new Set(["b1"]) }));

    await click(findButton("Add to library"));
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    await act(async () => {
      boxes[1].click();
    });

    await click(findButton("Add 1 to library"));
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/library/content-library");
    expect(JSON.parse(opts.body).text).toBe("Cut settlement from three days to one");
  });
});
