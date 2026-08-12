// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// PageTree.test.js and JobDescriptionTab.test.js are the precedent for
// rendering a whole component here.
//
// What this file pins is the markup and the wiring around
// lib/experience/attachments.js's classifyAttachment, which cannot be
// exercised without a DOM: which button carries which accessible name, that
// the upload control is a real labelled <input type="file"> and not a
// drag-only trap, that a rejected upload surfaces the classifier's own
// reason text verbatim, and that a failed load reads differently on screen
// than an empty list. This repo has shipped a tab with five identically
// -named delete buttons before, which is why that case is the first test
// below.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AttachmentPanel from "./AttachmentPanel.js";

// D1's own test (below, "the GET route itself supplies kind") calls the
// real route handler instead of trusting a fixture. Only the Supabase
// boundary is mocked — @/lib/experience/apiAuth and classifyAttachment
// (from ../../../lib/experience/attachments, the same module AttachmentPanel
// itself imports) stay real, mirroring app/api/experience/routes.contract.test.js's
// own pattern of mocking the data layer, not the route.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/supabase/experienceAttachments", () => ({
  listAttachments: vi.fn(),
  createAttachment: vi.fn(),
  signedAttachmentUrl: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import * as attachmentsStore from "@/lib/supabase/experienceAttachments";
import { GET as attachmentsRouteGET } from "../../api/experience/attachments/route.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Strips the trailing zero-width space AttachmentPanel.js's own announcement
// helper appends on odd sequence numbers (mirrors PageEditor.js's
// ANNOUNCE_TOGGLE and PageEditor.test.js's own withoutZwsp of the same
// name): an invisible unicode character typed directly into a source file is
// easy to lose or mis-copy, so it is built from its code point here too.
const ZWSP = String.fromCodePoint(0x200b);
const ZWSP_RE = new RegExp(ZWSP, "g");
function withoutZwsp(text) {
  return text.replace(ZWSP_RE, "");
}

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
  vi.restoreAllMocks();
  delete global.fetch;
});

// Shaped like the row app/api/experience/attachments/route.js's GET
// actually returns (see supabase/migrations/20260812010000_experience_attachments.sql):
// the column is `page_id`, never `pageId`, and `kind` is a field the route
// derives with classifyAttachment before sending it, not a stored column —
// see the "the GET route itself supplies kind" describe block below, which
// proves that derivation against the real route handler rather than just
// asserting against this fixture.
function attachment(overrides = {}) {
  return {
    id: "a1",
    page_id: "page-1",
    name: "file.txt",
    kind: "text",
    bytes: 1024,
    notes: "",
    url: null,
    ...overrides,
  };
}

// Routes GET (initial load) by default; POST/PATCH/DELETE fall back to a
// generic ok response so a stray call in a test that isn't exercising that
// path doesn't throw. Tests that care about POST's body install their own
// fetch mock instead of using this helper.
function installFetch({ list = [], listOk = true, listError = "Could not load attachments." } = {}) {
  global.fetch = vi.fn((url, options = {}) => {
    const method = (options && options.method) || "GET";
    if (method === "GET") {
      if (!listOk) {
        return Promise.resolve({ ok: false, json: async () => ({ error: listError }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

async function mount(props = { pageId: "page-1" }) {
  await act(async () => {
    root.render(createElement(AttachmentPanel, props));
  });
  // The load effect fires via setTimeout(0) (see AttachmentPanel.js's own
  // comment on why), then awaits the mocked fetch. A real tick lets both
  // steps land before assertions run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// The accessible name a screen reader would announce: aria-label if present,
// otherwise the <label> associated by `for`. Mirrors JobDescriptionTab.test.js's
// helper of the same name.
function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = container.querySelector(`#${CSS.escape(labelledBy)}`);
    if (target) return target.textContent.trim();
  }
  if (el.id) {
    const label = container.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }
  return "";
}

// The real notes textareas, excluding MUI's aria-hidden auto-resize shadow
// (same filter JobDescriptionTab.test.js uses for its posting boxes).
function notesFields() {
  return [...container.querySelectorAll("textarea")].filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  );
}

async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

async function pickFile(input, file) {
  setInputFiles(input, [file]);
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

// React's onBlur is wired to the native "focusout" event, not "blur" —
// blur/focus don't bubble, so React's root-level delegation listens on
// their bubbling counterparts (focusin/focusout) instead.
async function blur(el) {
  await act(async () => {
    el.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  });
}

describe("delete button accessible names", () => {
  it("gives every delete button a distinct accessible name that includes its own file name", async () => {
    const list = [
      attachment({ id: "a1", name: "resume-draft.pdf", kind: "pdf", url: null }),
      attachment({ id: "a2", name: "screenshot.png", kind: "image", notes: "Login screen", url: "https://example.com/a2.png" }),
      attachment({ id: "a3", name: "demo.mp4", kind: "video", url: "https://example.com/a3.mp4" }),
      attachment({ id: "a4", name: "cover-letter.docx", kind: "text", url: null }),
      attachment({ id: "a5", name: "diagram.png", kind: "image", url: "https://example.com/a5.png" }),
    ];
    installFetch({ list });
    await mount({ pageId: "page-1" });

    const deleteButtons = [...container.querySelectorAll('[aria-label^="Delete "]')];
    expect(deleteButtons).toHaveLength(5);

    const names = deleteButtons.map((btn) => btn.getAttribute("aria-label"));
    // The load-bearing assertion: as many DISTINCT accessible names as
    // attachments, not five buttons all called "Delete".
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "Delete resume-draft.pdf",
      "Delete screenshot.png",
      "Delete demo.mp4",
      "Delete cover-letter.docx",
      "Delete diagram.png",
    ]);
  });
});

describe("keyboard-reachable upload", () => {
  it("exposes a real, labelled file input independent of drag-and-drop", async () => {
    installFetch({ list: [] });
    await mount({ pageId: "page-1" });

    const input = container.querySelector("#attachment-file-input");
    expect(input).not.toBeNull();
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("type")).toBe("file");

    const label = container.querySelector(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    expect(label.textContent.trim().length).toBeGreaterThan(0);
  });
});

describe("classifier-rejected uploads", () => {
  it("surfaces the classifier's own reason, including the limit and file name, for an oversized video", async () => {
    installFetch({ list: [] });
    await mount({ pageId: "page-1" });

    const input = container.querySelector("#attachment-file-input");
    const file = new File(["stub"], "big-video.mp4", { type: "video/mp4" });
    // jsdom would otherwise need 100+ MB of real bytes to produce this size;
    // override the getter instead, per the harness note on this hazard.
    Object.defineProperty(file, "size", { value: 101 * 1024 * 1024 });

    await pickFile(input, file);

    expect(container.textContent).toContain("100 MB");
    expect(container.textContent).toContain("big-video.mp4");
    // Not a generic fallback message — the classifier's own reason text.
    expect(container.textContent).not.toContain("Could not upload this file.");

    const postCalls = global.fetch.mock.calls.filter(([, opts]) => opts && opts.method === "POST");
    expect(postCalls).toHaveLength(0);
  });
});

// Accessibility finding: rejecting the SAME oversized file twice in a row —
// the expected shape of a retry, since onInputChange deliberately clears the
// input value so the same file can be re-picked — produced zero DOM
// mutations on the second rejection, measured with a MutationObserver.
// React bails out of a setState whose new value is Object.is-equal to what
// is already there, and a plain string is exactly equal on the second
// identical rejection, so the alert element sits there completely untouched
// the second time: a screen reader hears the first rejection and then
// nothing, reasonably concluding the retry worked. Mirrors
// PageEditor.test.js's own "gives a screen reader a real DOM mutation" test
// for the identical class of bug in that file's save-status region.
describe("a repeated identical upload rejection", () => {
  it("gives a screen reader a real DOM mutation the second time the same file is rejected", async () => {
    installFetch({ list: [] });
    await mount({ pageId: "page-1" });

    const input = container.querySelector("#attachment-file-input");
    const file = new File(["stub"], "big-video.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 101 * 1024 * 1024 });

    await pickFile(input, file);
    const alertRegion = [...container.querySelectorAll('[role="alert"]')].find((el) =>
      el.textContent.includes("big-video.mp4"),
    );
    expect(alertRegion).toBeTruthy();
    const afterFirst = alertRegion.textContent;

    let records = [];
    const observer = new window.MutationObserver((list) => {
      records.push(...list);
    });
    observer.observe(alertRegion, {
      childList: true,
      characterData: true,
      subtree: true,
      characterDataOldValue: true,
    });

    // The SAME file object, re-picked — onInputChange's own comment says
    // this is exactly what it clears the input value to allow.
    await pickFile(input, file);
    records.push(...observer.takeRecords());
    observer.disconnect();

    const afterSecond = alertRegion.textContent;
    // Sighted users see the identical message both times — that IS correct,
    // not the bug. The bug is a screen reader hearing nothing the second
    // time, which needs a real DOM write to not be true.
    expect(withoutZwsp(afterSecond)).toBe(withoutZwsp(afterFirst));
    const sawARealMutation = records.length > 0;
    const finalTextDiffers = afterSecond !== afterFirst;
    expect(sawARealMutation || finalTextDiffers).toBe(true);
  });
});

// notesErrors/deleteErrors already clear an id's entry outright (delete the
// key) before a retry — see saveNotes/removeAttachment — which was
// confirmed separately (via MutationObserver on the CardContent, not shown
// here) to already produce a genuine childList removal-then-insertion on
// every repeated failure: a real DOM mutation, unlike uploadError's
// classifier-rejection path, which has no clearing step before its early
// return and so leaves the SAME node completely untouched on a repeat. What
// that removal-then-insertion does NOT by itself guarantee is that the
// announced TEXT differs between the two failures. Reading the sequence
// number off the entry (`prev[id]?.seq`) resets it to undefined on every
// retry, because the clear step just deleted that entry — so a version of
// this mechanism that reads the seq that way lands on the same odd parity
// both times and renders IDENTICAL text in two different DOM nodes. The
// count has to live somewhere the clear does not reach; see nextSeqFor's
// own comment. Queried live (not via a stale reference) on both sides,
// because the clear-before-retry step means the second failure's alert
// really is a different DOM node from the first's.
describe("a repeated identical notes-save failure", () => {
  it("keeps the announcement's alternating parity across the clear-before-retry cycle, instead of resetting every time", async () => {
    const list = [attachment({ id: "a1", name: "clip.mp4", kind: "video", notes: "Old note", url: "https://example.com/a1.mp4" })];
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      if (method === "PATCH") return Promise.resolve({ ok: false, json: async () => ({ error: "Could not save this note." }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await mount({ pageId: "page-1" });

    const [field] = notesFields();
    await type(field, "First attempt");
    await blur(field);
    const firstAlert = [...container.querySelectorAll('[role="alert"]')].find((el) => el.textContent.includes("clip.mp4"));
    expect(firstAlert).toBeTruthy();
    const afterFirst = firstAlert.textContent;

    // Same field, same unchanged text, same failing PATCH — exactly a
    // retry with nothing edited.
    await blur(field);
    const secondAlert = [...container.querySelectorAll('[role="alert"]')].find((el) => el.textContent.includes("clip.mp4"));
    expect(secondAlert).toBeTruthy();
    const afterSecond = secondAlert.textContent;

    expect(withoutZwsp(afterSecond)).toBe(withoutZwsp(afterFirst));
    expect(afterSecond).not.toBe(afterFirst);
  });
});

describe("a repeated identical attachment-delete failure", () => {
  it("keeps the announcement's alternating parity across the clear-before-retry cycle, instead of resetting every time", async () => {
    const list = [attachment({ id: "a1", name: "resume-draft.pdf", kind: "pdf", url: null })];
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      if (method === "DELETE") return Promise.resolve({ ok: false, json: async () => ({ error: "Could not delete this attachment." }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await mount({ pageId: "page-1" });

    const deleteButton = container.querySelector('[aria-label="Delete resume-draft.pdf"]');
    await act(async () => {
      deleteButton.click();
    });
    const firstAlert = [...container.querySelectorAll('[role="alert"]')].find(
      (el) => el.textContent.includes("resume-draft.pdf") && el.textContent.includes("Could not delete"),
    );
    expect(firstAlert).toBeTruthy();
    const afterFirst = firstAlert.textContent;

    await act(async () => {
      deleteButton.click();
    });
    const secondAlert = [...container.querySelectorAll('[role="alert"]')].find(
      (el) => el.textContent.includes("resume-draft.pdf") && el.textContent.includes("Could not delete"),
    );
    expect(secondAlert).toBeTruthy();
    const afterSecond = secondAlert.textContent;

    expect(withoutZwsp(afterSecond)).toBe(withoutZwsp(afterFirst));
    expect(afterSecond).not.toBe(afterFirst);
  });
});

// Accessibility finding: the panel has no live region at all, so neither a
// successful upload nor a successful delete is announced to a screen reader
// — only failures are (via notesErrors/deleteErrors/uploadError). Mirrors
// PageEditor.js's own role="status" region for the equivalent gap there.
describe("upload and delete success announcements", () => {
  it("is a polite status region, empty at first, that announces when an attachment is added", async () => {
    installFetch({ list: [] });
    await mount({ pageId: "page-1" });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(withoutZwsp(status.textContent)).toBe("");

    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: [] }) });
      if (method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            attachment: { id: "new-1", page_id: "page-1", name: "resume.pdf", kind: "pdf", bytes: 10, notes: "", url: null },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const input = container.querySelector("#attachment-file-input");
    const file = new File(["hello"], "resume.pdf", { type: "application/pdf" });
    await pickFile(input, file);

    expect(withoutZwsp(status.textContent)).toContain("resume.pdf");
    expect(withoutZwsp(status.textContent).toLowerCase()).toContain("add");
  });

  it("announces when an attachment is removed", async () => {
    const list = [attachment({ id: "a1", name: "old-file.txt" })];
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      if (method === "DELETE") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await mount({ pageId: "page-1" });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    const deleteButton = container.querySelector('[aria-label="Delete old-file.txt"]');
    await act(async () => {
      deleteButton.click();
    });

    expect(withoutZwsp(status.textContent)).toContain("old-file.txt");
    expect(withoutZwsp(status.textContent).toLowerCase()).toContain("remov");
  });
});

// Accessibility finding: new cards append to the END of the list, so a
// keyboard user currently has to tab past every existing attachment to
// reach the one they just added. Moving focus there cuts a click for
// everyone and a long tab sequence for keyboard users.
describe("focus after a successful upload", () => {
  it("moves focus to the new attachment's notes field", async () => {
    const existing = [attachment({ id: "old-1", name: "already-here.txt" })];
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ attachments: existing }) });
      if (method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            attachment: { id: "new-1", page_id: "page-1", name: "resume.pdf", kind: "pdf", bytes: 10, notes: "", url: null },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await mount({ pageId: "page-1" });

    // Sanity: the new field is not the one already focused (there is no
    // focus at all yet), and it does not exist before the upload.
    expect(notesFields()).toHaveLength(1);

    const input = container.querySelector("#attachment-file-input");
    const file = new File(["hello"], "resume.pdf", { type: "application/pdf" });
    await pickFile(input, file);

    const fields = notesFields();
    expect(fields).toHaveLength(2);
    const newField = fields[1];
    expect(document.activeElement).toBe(newField);
  });
});

describe("attachment previews", () => {
  it("uses notes as the image thumbnail's alt text, falling back to the file name when notes are empty", async () => {
    const list = [
      attachment({ id: "img-with-notes", name: "screenshot.png", kind: "image", notes: "Login screen", url: "https://example.com/a.png" }),
      attachment({ id: "img-no-notes", name: "diagram.png", kind: "image", notes: "", url: "https://example.com/b.png" }),
    ];
    installFetch({ list });
    await mount({ pageId: "page-1" });

    const imgs = [...container.querySelectorAll("img")];
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("alt")).toBe("Login screen");
    expect(imgs[1].getAttribute("alt")).toBe("diagram.png");
  });

  it("renders a video attachment as a <video> element with controls", async () => {
    const list = [attachment({ id: "v1", name: "demo.mp4", kind: "video", notes: "", url: "https://example.com/demo.mp4" })];
    installFetch({ list });
    await mount({ pageId: "page-1" });

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("src")).toBe("https://example.com/demo.mp4");
  });

  // Accessibility finding: the video element has no accessible name at all
  // — announced as an unnamed player. Mirrors the image thumbnail's own
  // notes-falling-back-to-name pattern, tested just above.
  it("gives the video element an accessible name from its notes, falling back to the file name", async () => {
    const list = [
      attachment({ id: "v-with-notes", name: "demo.mp4", kind: "video", notes: "Product walkthrough", url: "https://example.com/a.mp4" }),
      attachment({ id: "v-no-notes", name: "clip.mov", kind: "video", notes: "", url: "https://example.com/b.mov" }),
    ];
    installFetch({ list });
    await mount({ pageId: "page-1" });

    const videos = [...container.querySelectorAll("video")];
    expect(videos).toHaveLength(2);
    expect(videos[0].getAttribute("aria-label")).toBe("Product walkthrough");
    expect(videos[1].getAttribute("aria-label")).toBe("clip.mov");
  });
});

// D1: the two tests above prove the PANEL renders correctly off a `kind`
// field — but only ever a fixture-invented one. `kind` is not a column of
// experience_attachments (see the migration); the route has to derive it.
// This test calls the ACTUAL GET route handler, off raw DB-row shaped input
// (page_id, mime, no kind column) with only the Supabase boundary mocked,
// captures its real JSON response, and feeds THAT — unmodified — into the
// panel. If the route stops deriving `kind` (or goes back to discarding it
// after computing it, which is the exact bug this defect was), this fails
// at the first assertion block, before the panel is even involved.
describe("D1: the GET route itself supplies kind, not just this file's fixtures", () => {
  const rows = () => [
    {
      id: "img-1",
      user_id: "user-1",
      page_id: "page-1",
      name: "screenshot.png",
      mime: "image/png",
      bytes: 2048,
      storage_path: "user-1/experience/page-1/img-1-screenshot.png",
      notes: "",
      transcript: "",
      created_at: "2026-08-12T00:00:00.000Z",
    },
    {
      id: "vid-1",
      user_id: "user-1",
      page_id: "page-1",
      name: "demo.mp4",
      mime: "video/mp4",
      bytes: 4096,
      storage_path: "user-1/experience/page-1/vid-1-demo.mp4",
      notes: "",
      transcript: "",
      created_at: "2026-08-12T00:00:01.000Z",
    },
    {
      id: "doc-1",
      user_id: "user-1",
      page_id: "page-1",
      name: "notes.txt",
      mime: "text/plain",
      bytes: 128,
      storage_path: "user-1/experience/page-1/doc-1-notes.txt",
      notes: "",
      transcript: "",
      created_at: "2026-08-12T00:00:02.000Z",
    },
  ];

  it("derives kind server-side and the panel renders an img and a video straight off that response", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    });
    attachmentsStore.listAttachments.mockResolvedValue({ attachments: rows(), error: null });
    attachmentsStore.signedAttachmentUrl.mockImplementation(async (_supabase, storagePath) => ({
      url: `https://example.com/signed/${storagePath}`,
      error: null,
    }));

    const res = await attachmentsRouteGET({ url: "http://localhost/api/experience/attachments?pageId=page-1" });
    expect(res.status).toBe(200);
    const data = await res.json();

    // The route derives kind itself (via classifyAttachment on the stored
    // mime/name) — this is not something the test handed it.
    expect(data.attachments.map((a) => a.kind)).toEqual(["image", "video", "text"]);
    // A signed URL is minted only for the kinds the panel previews inline.
    expect(data.attachments[0].url).toBe("https://example.com/signed/user-1/experience/page-1/img-1-screenshot.png");
    expect(data.attachments[1].url).toBe("https://example.com/signed/user-1/experience/page-1/vid-1-demo.mp4");
    expect(data.attachments[2].url).toBeNull();
    // The real column name, never the fixture's old invented `pageId`.
    expect(data.attachments[0].page_id).toBe("page-1");
    expect(data.attachments[0].pageId).toBeUndefined();

    // End-to-end: the route's own response, byte for byte, is what the
    // panel renders from — no fixture standing in for it.
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => data });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await mount({ pageId: "page-1" });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(data.attachments[0].url);

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe(data.attachments[1].url);

    // The label follows the real kind — not the "File" fallback every
    // attachment got back when `kind` was always undefined.
    expect(container.textContent).toContain("Image");
    expect(container.textContent).toContain("Video");
    expect(container.textContent).toContain("Text");
  });
});

describe("notes field", () => {
  it("labels each attachment's notes field, and editing one leaves the others untouched", async () => {
    const list = [
      attachment({ id: "a1", name: "resume-draft.pdf", kind: "pdf", notes: "First", url: null }),
      attachment({ id: "a2", name: "screenshot.png", kind: "image", notes: "Second", url: "https://example.com/a2.png" }),
      attachment({ id: "a3", name: "demo.mp4", kind: "video", notes: "Third", url: "https://example.com/a3.mp4" }),
    ];
    installFetch({ list });
    await mount({ pageId: "page-1" });

    const fields = notesFields();
    expect(fields).toHaveLength(3);
    // Same defect class as the delete buttons above: a screen reader's
    // form-field list must show three DISTINCT fields, each naming its own
    // file, not three fields all called "Notes for the AI".
    const names = fields.map((field) => accessibleName(field));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "Notes for the AI for resume-draft.pdf",
      "Notes for the AI for screenshot.png",
      "Notes for the AI for demo.mp4",
    ]);
    expect(fields.map((f) => f.value)).toEqual(["First", "Second", "Third"]);

    await type(fields[1], "Second, edited");

    const after = notesFields();
    expect(after.map((f) => f.value)).toEqual(["First", "Second, edited", "Third"]);
  });
});

describe("load states", () => {
  it("shows a progress indicator while the initial load is in flight, then clears it", async () => {
    let resolveList;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveList = resolve; }));

    await act(async () => {
      root.render(createElement(AttachmentPanel, { pageId: "page-1" }));
    });
    // Let the deferred load() fire (setTimeout(0)) without letting fetch
    // resolve yet, so the in-flight state is observable.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();

    await act(async () => {
      resolveList({ ok: true, json: async () => ({ attachments: [] }) });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("shows a visible error after a failed load, distinct from an empty list", async () => {
    installFetch({ listOk: false, listError: "Could not load attachments." });
    await mount({ pageId: "page-1" });

    expect(container.textContent).toContain("Could not load attachments.");
    // A failed load must not read the same as a successful empty one.
    expect(container.textContent).not.toContain("No attachments yet.");
  });

  it("shows the empty-state message after a successful load with no attachments", async () => {
    installFetch({ list: [] });
    await mount({ pageId: "page-1" });

    expect(container.textContent).toContain("No attachments yet.");
  });
});

describe("a failed notes save", () => {
  it("shows a visible error naming the file, keeps the typed text, and a Retry re-issues the save", async () => {
    // The video's notes field is the only description of that file the AI
    // ever gets - a failed save that vanishes silently loses it for real,
    // not cosmetically. This pins that a failure surfaces, names the file,
    // and never rolls the field back to what the server last had.
    const list = [attachment({ id: "a1", name: "clip.mp4", kind: "video", notes: "Old note", url: "https://example.com/a1.mp4" })];
    let patchCalls = 0;
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      }
      if (method === "PATCH") {
        patchCalls += 1;
        // First save fails; a retry with the same body succeeds.
        if (patchCalls === 1) {
          return Promise.resolve({ ok: false, json: async () => ({ error: "Could not save this note." }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ attachment: { ...list[0], notes: "New note" } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await mount({ pageId: "page-1" });

    const [field] = notesFields();
    await type(field, "New note");
    await blur(field);

    expect(patchCalls).toBe(1);
    // The error names the specific file, not a generic message.
    expect(container.textContent).toContain("clip.mp4");
    // The typed text is still on screen - the failed save must not roll it
    // back to the last-saved server value ("Old note").
    expect(notesFields()[0].value).toBe("New note");

    const retryButton = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Retry");
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton.click();
    });

    expect(patchCalls).toBe(2);
    // The retry re-issued the same PATCH and, having succeeded, the error
    // clears - but the text the user typed is still exactly what they typed.
    expect(container.textContent).not.toContain("Could not save the note for");
    expect(notesFields()[0].value).toBe("New note");
  });
});

// D3: removeAttachment's own comment claims the row is left in place "so the
// user can see the delete didn't take" - but nothing told them. Mirrors "a
// failed notes save" above: same shape (per-id error, Retry re-issues the
// same call), just for DELETE instead of PATCH.
describe("a failed attachment delete", () => {
  it("shows a visible error naming the file, and a Retry re-issues the delete", async () => {
    const list = [attachment({ id: "a1", name: "resume-draft.pdf", kind: "pdf", url: null })];
    let deleteCalls = 0;
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      }
      if (method === "DELETE") {
        deleteCalls += 1;
        // First delete fails; a retry succeeds.
        if (deleteCalls === 1) {
          return Promise.resolve({ ok: false, json: async () => ({ error: "Could not delete this attachment." }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await mount({ pageId: "page-1" });

    const deleteButton = container.querySelector('[aria-label="Delete resume-draft.pdf"]');
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton.click();
    });

    expect(deleteCalls).toBe(1);
    // The row is still there (the delete did not take) - and now something
    // besides its continued presence actually says so.
    expect(container.querySelector('[aria-label="Delete resume-draft.pdf"]')).not.toBeNull();
    const retryButton = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Retry");
    expect(retryButton).toBeTruthy();
    expect(container.textContent).toContain("resume-draft.pdf");
    expect(container.textContent).toContain("Could not delete");

    await act(async () => {
      retryButton.click();
    });

    expect(deleteCalls).toBe(2);
    // The retry succeeded: the row (and its error) are both gone now.
    expect(container.querySelector('[aria-label="Delete resume-draft.pdf"]')).toBeNull();
    expect(container.textContent).not.toContain("Could not delete");
  });
});

// D3, same class of bug as the notesErrors leak below: notesErrors is keyed
// by attachment id, and nothing ever clears it when the page changes. Two
// different pages can perfectly well contain an attachment with the same id
// (ids are unique per attachment, not scoped in any way the panel itself
// enforces) - proven directly by giving page one and page two an attachment
// that share an id.
describe("switching pages clears stale per-attachment error state", () => {
  it("does not carry a notes-save error from one page's attachment onto another page's panel", async () => {
    const SHARED_ID = "shared-1";
    const pageOneList = [attachment({ id: SHARED_ID, name: "on-page-one.txt", notes: "Old" })];
    const pageTwoList = [attachment({ id: SHARED_ID, name: "on-page-two.txt", notes: "Other" })];
    let currentPage = "page-1";

    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        const list = currentPage === "page-1" ? pageOneList : pageTwoList;
        return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
      }
      if (method === "PATCH") {
        return Promise.resolve({ ok: false, json: async () => ({ error: "Could not save this note." }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await mount({ pageId: "page-1" });

    const [field] = notesFields();
    await type(field, "New text");
    await blur(field);
    expect(container.textContent).toContain("on-page-one.txt");
    expect(container.textContent).toContain("Could not save the note for");

    // Switch pages - the attachment shown now has the SAME id, but belongs
    // to a different page and was never involved in the failed save above.
    currentPage = "page-2";
    await mount({ pageId: "page-2" });

    expect(container.textContent).toContain("on-page-two.txt");
    expect(container.textContent).not.toContain("Could not save the note for");
  });
});

// D3: an upload started on one page whose response arrives after the user
// has already switched to a different page must not be appended to
// whatever list happens to be on screen when it resolves.
describe("an upload that resolves after the user has switched pages", () => {
  it("does not append the late attachment to the new page's list", async () => {
    let resolveUpload;
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ attachments: [] }) });
      }
      if (method === "POST") {
        return new Promise((resolve) => {
          resolveUpload = resolve;
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await mount({ pageId: "page-1" });

    const input = container.querySelector("#attachment-file-input");
    const file = new File(["hello"], "late-upload.txt", { type: "text/plain" });
    await pickFile(input, file);

    // Switch pages while the upload from page one is still in flight.
    await mount({ pageId: "page-2" });
    expect(container.textContent).not.toContain("late-upload.txt");

    // Now the stale upload resolves.
    await act(async () => {
      resolveUpload({
        ok: true,
        json: async () => ({
          attachment: { id: "late", page_id: "page-1", name: "late-upload.txt", kind: "text", bytes: 5, notes: "", url: null },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // It must not have landed on page two's list.
    expect(container.textContent).not.toContain("late-upload.txt");
  });
});
