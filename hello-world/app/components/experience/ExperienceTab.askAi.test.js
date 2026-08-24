// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/JobDescriptionTab.test.js and app/components/experience/
// PageTree.test.js are the precedents for rendering a whole component here.
//
// This is the Ask AI half of ExperienceTab's test suite - pressing Ask AI on
// a project page pins the whole page as chat context and attaches whatever
// of its attachments the chat can actually read. The tab-shell tests
// (loading/signed-out/empty states, breadcrumbs, bulk actions, and the rest)
// live in the sibling ExperienceTab.test.js; both files share their fixtures
// and helpers (PAGE_ROOT/PAGE_CHILD, flush/click/jsonResponse, the
// PageEditor/AttachmentPanel mock bodies, etc.) via ./experienceTabTestHarness.js
// so the two files can never drift onto different assumptions about the same
// fixtures. PageEditor and AttachmentPanel are mocked out here for the same
// reason the shell file mocks them: a failure inside either must never be
// reported as a failure of this tab.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./PageEditor", async () => (await import("./experienceTabTestHarness.js")).pageEditorMockModule());
vi.mock("./AttachmentPanel", async () => (await import("./experienceTabTestHarness.js")).attachmentPanelMockModule());

// The Ask AI wiring downloads readable attachments straight from Supabase
// Storage (mirrors lib/supabase/materials.js's own downloadMaterialBlob) -
// `downloadMock` is `vi.hoisted` so the `vi.mock` factory below (which is
// itself hoisted above this file's own imports) can close over it, and each
// test configures its own return value per storage path.
const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ download: downloadMock }),
    },
  }),
}));

// The REAL store function, wrapped in a spy - not a stub. Reading an
// attachment's bytes out of the private bucket is `downloadAttachmentBlob`'s
// job (lib/supabase/experienceAttachments.js), and this component used to
// hand-roll its own copy of it, complete with a second `"resumes"` literal
// and a second piece of error handling.
//
// Wrapping rather than stubbing matters: the real implementation still runs
// against the mocked client above, so the existing "the bytes reach the chat"
// assertions keep testing the whole path end to end. The spy exists only to
// answer the one question those assertions cannot - was the SHARED module
// asked, or has a private copy quietly grown back? A duplicate that happened
// to behave identically would produce identical files and identical calls to
// `downloadMock`, so nothing else in this file could tell the two apart.
vi.mock("../../../lib/supabase/experienceAttachments", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, downloadAttachmentBlob: vi.fn(real.downloadAttachmentBlob) };
});

import { downloadAttachmentBlob } from "../../../lib/supabase/experienceAttachments";
import ExperienceTab from "./ExperienceTab.js";
import { flush, jsonResponse, click, PAGE_ROOT, PAGE_CHILD, makeRender } from "./experienceTabTestHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
const render = makeRender(() => root, ExperienceTab);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  downloadMock.mockReset();
  // A `vi.fn()` created inside a `vi.mock` factory is NOT cleared by
  // `vi.restoreAllMocks()` - that only restores `vi.spyOn` registrations, and
  // this config sets neither `clearMocks` nor `restoreMocks`. Left alone, its
  // call history accumulates across every test in the file and the
  // per-path assertions below start reading calls made by earlier tests.
  // `mockClear`, not `mockReset`: this spy wraps the REAL implementation and
  // `mockReset` would throw that away, leaving it returning undefined.
  downloadAttachmentBlob.mockClear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete global.fetch;
});

// The Ask AI feature: pressing it on a project page pins the whole page -
// body, breadcrumb, child pages, and an inventory of its attachments - as
// chat context, then downloads and attaches whatever attachments the chat
// can actually read (text/image/pdf - never video, see
// lib/experience/pageContext.js and app/api/chat/route.js for why). This
// exercises the REAL wiring end to end: the real useExperiencePages hook,
// the real GET /api/experience/attachments fetch, the real
// lib/experience/pageContext.buildPageContext, and the real download path -
// only PageEditor and AttachmentPanel are mocked (their own contracts are
// covered by their own test files).
describe("ExperienceTab -- Ask AI", () => {
  const PAGE_WITH_BODY = {
    ...PAGE_CHILD,
    body: "We migrated payments off the legacy processor.",
  };
  const PAGE_GRANDCHILD = {
    id: "p2c",
    parent_id: "p2",
    title: "Grandchild Page",
    body: "",
    position: 0,
    archived_at: null,
    created_at: "2026-01-02T12:00:00.000Z",
    updated_at: "2026-01-02T12:00:00.000Z",
  };

  const ATTACHMENTS = [
    {
      id: "a1",
      name: "topology.png",
      mime: "image/png",
      kind: "image",
      bytes: 100,
      storage_path: "u1/experience/p2/a1-topology.png",
      notes: "before the migration",
      transcript: "",
    },
    {
      id: "a2",
      name: "spec.pdf",
      mime: "application/pdf",
      kind: "pdf",
      bytes: 200,
      storage_path: "u1/experience/p2/a2-spec.pdf",
      notes: "",
      transcript: "",
    },
    {
      id: "a3",
      name: "notes.txt",
      mime: "text/plain",
      kind: "text",
      bytes: 50,
      storage_path: "u1/experience/p2/a3-notes.txt",
      notes: "read me first",
      transcript: "",
    },
    {
      id: "a4",
      name: "demo.mp4",
      mime: "video/mp4",
      kind: "video",
      bytes: 900,
      storage_path: "u1/experience/p2/a4-demo.mp4",
      notes: "",
      transcript: "",
    },
  ];

  function mockFetchWithAttachments() {
    return vi.fn((url) => {
      if (url === "/api/experience") {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_WITH_BODY, PAGE_GRANDCHILD] }));
      }
      if (url.startsWith("/api/experience/attachments")) {
        expect(url).toBe(`/api/experience/attachments?pageId=${PAGE_WITH_BODY.id}`);
        return Promise.resolve(jsonResponse(200, { attachments: ATTACHMENTS }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
  }

  async function selectChildPage() {
    // p2 sits under p1, collapsed by default - expand p1 first (same
    // precondition every other test in this file that reaches a nested row
    // uses), then select p2 itself.
    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const chevron = rootItem.firstElementChild.firstElementChild;
    await click(chevron);
    await click(container.querySelector('[role="treeitem"][data-page-id="p2"]'));
  }

  it("pins the body, breadcrumb, child page and attachment inventory, and attaches only the downloadable files", async () => {
    global.fetch = mockFetchWithAttachments();
    downloadMock.mockImplementation(async (path) => {
      const found = ATTACHMENTS.find((a) => a.storage_path === path);
      return { data: new Blob(["bytes"], { type: found?.mime || "application/octet-stream" }), error: null };
    });

    const askAiAbout = vi.fn();
    const addChatAttachments = vi.fn();
    await render({ askAiAbout, addChatAttachments });
    await flush();

    await selectChildPage();

    const askAiBtn = container.querySelector('[data-testid="mock-page-editor-ask-ai"]');
    expect(askAiBtn).not.toBeNull();
    await click(askAiBtn);
    await flush();

    expect(askAiAbout).toHaveBeenCalledTimes(1);
    const pinned = askAiAbout.mock.calls[0][0];
    expect(pinned.label).toContain("Child Page");
    expect(pinned.content).toContain("We migrated payments off the legacy processor.");
    expect(pinned.content).toContain("Root Page / Child Page");
    expect(pinned.content).toContain("Grandchild Page");
    expect(pinned.content).toContain("topology.png");
    expect(pinned.content).toContain("before the migration");
    expect(pinned.content).toContain("spec.pdf");
    expect(pinned.content).toContain("notes.txt");
    expect(pinned.content).toContain("read me first");
    expect(pinned.content).toContain("demo.mp4");
    // The video has no notes and no transcript - pageContext.js's own
    // contract says so in plain words rather than a bare filename that
    // would read as though the model watched it.
    expect(pinned.content.toLowerCase()).toMatch(/no transcript|not transcribed|no notes/);
    // Never the storage path or a signed URL.
    expect(pinned.content).not.toContain("u1/experience");

    expect(addChatAttachments).toHaveBeenCalledTimes(1);
    const attachedFiles = addChatAttachments.mock.calls[0][0];
    expect(attachedFiles.map((f) => f.name).sort()).toEqual(["notes.txt", "spec.pdf", "topology.png"]);

    // The video's bytes are never downloaded at all.
    const downloadedPaths = downloadMock.mock.calls.map(([path]) => path);
    expect(downloadedPaths).not.toContain("u1/experience/p2/a4-demo.mp4");
    expect(downloadedPaths.sort()).toEqual(
      ["u1/experience/p2/a1-topology.png", "u1/experience/p2/a2-spec.pdf", "u1/experience/p2/a3-notes.txt"].sort(),
    );
  });

  it("reads those bytes through the shared store function, not a private copy", async () => {
    // Gates the deduplication itself. The behaviour assertions above pass
    // just as happily against a hand-rolled `supabase.storage.from("resumes")
    // .download(...)` inline here - they did, for as long as one existed -
    // so without this the shared helper could be added, be correct, and never
    // actually be wired up. That is the single most common way a change like
    // this finishes with a green suite and nothing altered.
    global.fetch = mockFetchWithAttachments();
    downloadMock.mockImplementation(async (path) => {
      const found = ATTACHMENTS.find((a) => a.storage_path === path);
      return { data: new Blob(["bytes"], { type: found?.mime || "application/octet-stream" }), error: null };
    });

    const addChatAttachments = vi.fn();
    await render({ askAiAbout: vi.fn(), addChatAttachments });
    await flush();
    await selectChildPage();
    await click(container.querySelector('[data-testid="mock-page-editor-ask-ai"]'));
    await flush();

    const askedFor = downloadAttachmentBlob.mock.calls.map(([, path]) => path).sort();
    expect(askedFor).toEqual(
      ["u1/experience/p2/a1-topology.png", "u1/experience/p2/a2-spec.pdf", "u1/experience/p2/a3-notes.txt"].sort(),
    );
    // The video is still excluded before any read is attempted - the shared
    // helper must not have become a way to sneak its bytes in.
    expect(askedFor).not.toContain("u1/experience/p2/a4-demo.mp4");
    // And the files still actually arrive, so this is a rewiring rather than
    // a replacement of a working path with a spy.
    expect(addChatAttachments).toHaveBeenCalledTimes(1);
    expect(addChatAttachments.mock.calls[0][0].map((f) => f.name).sort()).toEqual([
      "notes.txt",
      "spec.pdf",
      "topology.png",
    ]);
  });

  it("still pins the page (title, body, breadcrumb) when the attachments fetch fails, and does not call addChatAttachments", async () => {
    global.fetch = vi.fn((url) => {
      if (url === "/api/experience") {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_WITH_BODY] }));
      }
      if (url.startsWith("/api/experience/attachments")) {
        return Promise.resolve(jsonResponse(500, { error: "boom" }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const askAiAbout = vi.fn();
    const addChatAttachments = vi.fn();
    await render({ askAiAbout, addChatAttachments });
    await flush();

    await selectChildPage();

    const askAiBtn = container.querySelector('[data-testid="mock-page-editor-ask-ai"]');
    await click(askAiBtn);
    await flush();

    expect(askAiAbout).toHaveBeenCalledTimes(1);
    const pinned = askAiAbout.mock.calls[0][0];
    expect(pinned.content).toContain("We migrated payments off the legacy processor.");
    expect(pinned.content).toContain("Root Page / Child Page");

    expect(addChatAttachments).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
