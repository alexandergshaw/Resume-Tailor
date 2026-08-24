// @vitest-environment jsdom
//
// PowerPoint and Excel attachments on a project page — the markup and the
// wiring that cannot be exercised without a DOM. A sibling of
// AttachmentPanel.test.js rather than another block inside it: that file is
// already past this repo's 1000-line ceiling, so growing it further is not
// an option.
//
// What this pins is the part a pure classifier test cannot reach: that a
// deck and a spreadsheet are actually SENT (the panel classifies before it
// POSTs, so a classifier fix that never reached the panel would still leave
// the upload refused), that the two kinds are told apart on screen by
// something other than colour, and that the GET route derives their kind
// itself instead of a fixture asserting what a fixture already said.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AttachmentPanel from "./AttachmentPanel.js";

// Only the Supabase boundary is mocked — apiAuth and classifyAttachment stay
// real, so the route test below exercises the same classifier the panel uses.
// Mirrors AttachmentPanel.test.js's own mock set.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
// `downloadAttachmentBlob` is listed even though nothing in THIS file clicks a
// download: a vi.mock factory replaces the module wholesale, so an export the
// panel imports but the factory omits is simply absent, and the first test
// here that ever reaches the download path would die on that rather than on
// anything it was written to check.
vi.mock("@/lib/supabase/experienceAttachments", () => ({
  listAttachments: vi.fn(),
  createAttachment: vi.fn(),
  signedAttachmentUrl: vi.fn(),
  downloadAttachmentBlob: vi.fn(),
}));

// The REAL classifier, wrapped in a spy - not a stub. The panel imports it by
// relative path and the route by the "@/" alias, and vitest resolves both to
// this one module id, so a single spy sees every call from either side.
//
// It exists to gate the rule that a second, private copy of the type table
// must never grow inside the panel. A duplicate that happens to AGREE with
// this module produces identical markup and identical requests, so nothing
// else in this file can tell the two apart; "was the shared module asked"
// can.
vi.mock("@/lib/experience/attachments", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, classifyAttachment: vi.fn(real.classifyAttachment) };
});

import { createClient } from "@/lib/supabase/server";
import * as attachmentsStore from "@/lib/supabase/experienceAttachments";
import { classifyAttachment } from "@/lib/experience/attachments";
import { GET as attachmentsRouteGET } from "../../api/experience/attachments/route.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

function installFetch({ list = [], onPost } = {}) {
  global.fetch = vi.fn((url, options = {}) => {
    const method = (options && options.method) || "GET";
    if (method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ attachments: list }) });
    }
    if (method === "POST" && onPost) return Promise.resolve(onPost(url, options));
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

async function pickFile(input, file) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

function fileInput() {
  return container.querySelector('input[type="file"]');
}

function postCalls() {
  return (global.fetch.mock.calls || []).filter(([, options]) => (options || {}).method === "POST");
}

// The one icon a card renders for its own kind. MUI stamps every icon with a
// data-testid, and a card carries several: the kind icon, one per action
// control (delete, download), and one per Alert that happens to be showing
// (each severity renders its own). Previously this filtered the action icon
// out BY NAME, which meant every new action control silently broke the helper
// until someone remembered to extend the list.
//
// Excluding by CONTAINER instead - anything inside a button or an Alert is
// chrome, not the card's kind - keeps that from recurring. The Alert half is
// not exercised by any test here today (none of them puts a card into a
// failure state), and is included so that the first one that does gets a real
// answer rather than a confusing off-by-one. The exact count is still
// asserted by the callers rather than taking [0] blind, so a card that
// stopped rendering a kind icon at all still fails loudly.
function kindIconOf(card) {
  return [...card.querySelectorAll("svg[data-testid]")]
    .filter((el) => !el.closest("button") && !el.closest(".MuiAlert-root"))
    .map((el) => el.getAttribute("data-testid"));
}

function cards() {
  return [...container.querySelectorAll(".MuiCard-root")];
}

describe("a deck and a spreadsheet on screen", () => {
  const mixedList = [
    attachment({ id: "a1", name: "kickoff.pptx", kind: "slides" }),
    attachment({ id: "a2", name: "q3.xlsx", kind: "sheet" }),
    attachment({ id: "a3", name: "notes.txt", kind: "text" }),
    attachment({ id: "a4", name: "shot.png", kind: "image", url: "https://example.com/a4.png" }),
  ];

  it("names each kind in text, and gives each its own icon", async () => {
    // Colour and icon shape alone never carry meaning here — the kind is
    // written out beside the file size, which is what a screen reader (and
    // anyone who does not recognise the glyph) actually gets.
    installFetch({ list: mixedList });
    await mount();

    const [deck, sheet, text] = cards();
    expect(cards()).toHaveLength(4);

    expect(deck.textContent).toContain("kickoff.pptx");
    expect(deck.textContent).toContain("Slides");
    expect(sheet.textContent).toContain("q3.xlsx");
    expect(sheet.textContent).toContain("Spreadsheet");
    // Positive control: the kinds that already had labels still have theirs.
    expect(text.textContent).toContain("Text");

    const deckIcon = kindIconOf(deck);
    const sheetIcon = kindIconOf(sheet);
    const textIcon = kindIconOf(text);
    expect(deckIcon).toHaveLength(1);
    expect(sheetIcon).toHaveLength(1);
    expect(textIcon).toHaveLength(1);
    expect(new Set([deckIcon[0], sheetIcon[0], textIcon[0]]).size).toBe(3);
  });

  it("previews neither of them inline", async () => {
    // The GET route mints no signed url for these kinds, so an <img> or a
    // <video> here would have nothing to load and would render broken.
    installFetch({ list: mixedList });
    await mount();

    const [deck, sheet, , image] = cards();
    expect(deck.querySelector("img")).toBeNull();
    expect(deck.querySelector("video")).toBeNull();
    expect(sheet.querySelector("img")).toBeNull();
    expect(sheet.querySelector("video")).toBeNull();
    // Positive control: a panel that had stopped previewing anything at all
    // would pass every assertion above.
    expect(image.querySelector("img")).not.toBeNull();
  });

  it("keeps the kind icon decorative, since the label already says it", async () => {
    // An icon that exposes its own accessible name would make a screen reader
    // read the kind twice, once as a graphic.
    //
    // A guard, not a gate: MUI's SvgIcon is already aria-hidden unless given
    // titleAccess, so this passes both before and after this change. It is
    // here to fail the day someone reaches for titleAccess to "improve" it.
    installFetch({ list: [attachment({ id: "a1", name: "kickoff.pptx", kind: "slides" })] });
    await mount();
    const [icon] = kindIconOf(cards()[0]);
    const svg = container.querySelector(`svg[data-testid="${icon}"]`);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("says decks and spreadsheets are welcome, without dropping either cap", async () => {
    // The upload box is the only place a user finds out what is allowed
    // before picking a file. Accepting a .pptx while still saying "a file,
    // image or video" leaves them guessing.
    installFetch({ list: [] });
    await mount();
    expect(container.textContent).toContain("PowerPoint");
    expect(container.textContent).toContain("Excel");
    expect(container.textContent).toContain("100 MB");
    expect(container.textContent).toContain("25 MB");
  });
});

describe("uploading a deck or a spreadsheet", () => {
  it("sends a .pptx and shows the card it comes back as", async () => {
    // The panel classifies BEFORE it posts. A classifier that accepts .pptx
    // proves nothing on its own if this call never leaves the browser.
    installFetch({
      list: [],
      onPost: () => ({
        ok: true,
        json: async () => ({
          attachment: attachment({ id: "new-1", name: "kickoff.pptx", kind: "slides", bytes: 1 }),
        }),
      }),
    });
    await mount();

    await pickFile(fileInput(), new File(["x"], "kickoff.pptx", { type: PPTX }));

    expect(postCalls()).toHaveLength(1);
    expect(postCalls()[0][0]).toBe("/api/experience/attachments");
    expect(container.textContent).toContain("kickoff.pptx");
    expect(container.textContent).not.toContain("not a supported file type");
    // …and it decided that by asking the shared module, not a private copy.
    expect(classifyAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: "kickoff.pptx" }));
  });

  it("sends an .xlsx the browser reports with no mime type at all", async () => {
    // Safari and several file managers hand over an empty `type`, so the
    // extension is all the panel has to go on.
    installFetch({
      list: [],
      onPost: () => ({
        ok: true,
        json: async () => ({
          attachment: attachment({ id: "new-2", name: "q3.xlsx", kind: "sheet", bytes: 1 }),
        }),
      }),
    });
    await mount();

    await pickFile(fileInput(), new File(["x"], "q3.xlsx", { type: "" }));

    expect(postCalls()).toHaveLength(1);
    expect(container.textContent).toContain("q3.xlsx");
  });

  it("still refuses a genuinely unsupported file without posting it", async () => {
    // Positive control for both tests above: a panel that simply stopped
    // classifying would pass them and upload anything.
    installFetch({ list: [] });
    await mount();

    await pickFile(fileInput(), new File(["x"], "setup.exe", { type: "application/octet-stream" }));

    expect(postCalls()).toHaveLength(0);
    expect(container.textContent).toContain("not a supported file type");
  });
});

describe("the GET route derives these kinds itself", () => {
  const row = (over) => ({
    user_id: "user-1",
    page_id: "page-1",
    bytes: 2048,
    notes: "",
    transcript: "",
    created_at: "2026-08-12T00:00:00.000Z",
    ...over,
  });

  it("returns slides/sheet and mints no preview link for either", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    });
    attachmentsStore.listAttachments.mockResolvedValue({
      attachments: [
        row({ id: "d1", name: "kickoff.pptx", mime: PPTX, storage_path: "user-1/experience/page-1/d1-kickoff.pptx" }),
        row({ id: "s1", name: "q3.xlsx", mime: XLSX, storage_path: "user-1/experience/page-1/s1-q3.xlsx" }),
        row({ id: "i1", name: "shot.png", mime: "image/png", storage_path: "user-1/experience/page-1/i1-shot.png" }),
      ],
      error: null,
    });
    attachmentsStore.signedAttachmentUrl.mockImplementation(async (_supabase, storagePath) => ({
      url: `https://example.com/signed/${storagePath}`,
      error: null,
    }));

    const res = await attachmentsRouteGET({ url: "http://localhost/api/experience/attachments?pageId=page-1" });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.attachments.map((a) => a.kind)).toEqual(["slides", "sheet", "image"]);
    // Neither is previewed inline, so neither should cost a signed URL — and
    // the image alongside them proves the route still mints one when it
    // should, rather than having stopped minting them altogether.
    expect(data.attachments[0].url).toBeNull();
    expect(data.attachments[1].url).toBeNull();
    expect(data.attachments[2].url).toBe("https://example.com/signed/user-1/experience/page-1/i1-shot.png");
    expect(attachmentsStore.signedAttachmentUrl).toHaveBeenCalledTimes(1);
  });
});
