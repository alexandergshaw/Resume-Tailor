// @vitest-environment jsdom
//
// N35 / 4b -- PM2 from `chunks/N40/plan.check.r2.md`.
//
// WHAT THIS PINS. Plan r3 step A9 gives the "Research company" button a
// `commitDraft()` so the candidate's in-flight typing is flushed before the
// accept reads the letter. `DocumentPreviewDialog#commitDraft` (:256-271)
// returns early only on `mode !== "edit"`: in edit mode it calls
// `onSave?.(tab, {text, html})` UNCONDITIONALLY, never comparing the text to
// what is stored. That prop is `preview.saveDocumentPreview`, which sets
// `edited: withEditedScope(entry, "cover", true)` unconditionally
// (`app/hooks/useDocumentPreview.js:465`) and takes the `pristineCoverLines`
// snapshot (:452-457).
//
// So, with A9 as written: open the preview, switch to edit mode on the cover
// tab, TYPE NOTHING, click "Research company" -- and the letter is now
// hand-edited. Plan r3 §7.10 step 5 then skips the docx splice, the bytes and
// the text diverge, every later download rebuilds through
// `buildDocxFromUploadedTemplate` (N54), and PB2's pristine hazard is armed.
// That directly contradicts §2.3's "does not widen the population that meets
// it (the letter was already hand-edited)": here the candidate did not edit
// anything in any sense they would recognise.
//
// THE PAIR. These two legs are each other's controls and neither is
// sufficient alone:
//   * FLUSH  -- typing IS committed by the click, without waiting out the
//     600 ms auto-save debounce. RED today, because today's button has no
//     `commitDraft()` at all (`DocumentPreviewDialog.js:675/679`).
//   * NO-MARK -- typing NOTHING leaves the scope unedited. GREEN today for
//     the wrong reason (there is no flush to misfire yet) and RED against
//     A9 as the plan words it. Disclosed as such; it is the guard, not the
//     discovery.
//
// REACHABILITY. This mounts the REAL `DocumentPreviewMount` over the REAL
// `useDocumentPreview` and `useCompanyResearch`, and CLICKS the real buttons.
// A direct `saveDocumentPreview()` call would prove nothing about which
// control reaches it -- and "which control reaches it" is the entire finding.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "nf" } }) }) },
  }),
}));
vi.mock("@/lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { useDocumentPreview } from "@/app/hooks/useDocumentPreview.js";
import { useCompanyResearch } from "@/app/hooks/useCompanyResearch.js";
import { editedForScope } from "@/lib/document/previewBlob.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom (pinned ^29.1.1 here) implements NO `HTMLElement.prototype.innerText`,
// and `commitDraft` reads exactly that. Per-file polyfill, like
// `DocumentPreviewDialog.drive.test.js` and `DocumentPreviewMount.test.js`
// already carry -- never vitest.setup.js, which is outside this seat's files.
//
// DELIBERATELY NOT those files' `textContent` polyfill. `textContent`
// CONCATENATES block children with no separator, so
// `<p>A</p><p>B</p>` reads as "AB" where a real browser's `innerText` reads
// "A\nB". Everything in this file turns on whether the editor's text equals
// the stored text, and `saveDocumentPreview` splits it on "\n" -- with the
// weaker polyfill, entering edit mode and touching nothing would look like a
// rewrite of the whole letter into one line, and both legs below would be
// measuring the polyfill instead of the product.
let removeInnerTextPolyfill = null;
const BLOCK_TAGS = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE)$/;
beforeAll(() => {
  if (!("innerText" in document.createElement("div"))) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        const blocks = [...this.children].filter((el) => BLOCK_TAGS.test(el.tagName));
        if (blocks.length === 0) return this.textContent;
        return blocks.map((el) => el.textContent).join("\n");
      },
      set(value) {
        this.textContent = value;
      },
    });
    removeInnerTextPolyfill = () => {
      delete HTMLElement.prototype.innerText;
    };
  }
});
afterAll(() => {
  removeInnerTextPolyfill?.();
});

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme" };
const COVER_LINES = [
  "Dear Hiring Manager,",
  "I am writing to apply for the Staff Engineer position at Acme.",
  "In my current role at Mutual of Omaha, I lead an engineering team of five on web platform engineering initiatives.",
  "I would welcome the chance to discuss how my background fits your team.",
  "Sincerely,",
];
const ENGINE_BYTES = "UEsDBBQABgAIAAAAIQCbFAKESTANDINBYTES";

let currentMap = null;
let preview = null;
let research = null;
let container = null;
let root = null;

function Probe() {
  const [tailoringMap, setTailoringMap] = useState({
    [JOB_ID]: {
      status: "done",
      result: "RESUME TEXT",
      resultLines: ["RESUME TEXT"],
      docxB64: "",
      docxPath: "",
      coverLetterResultLines: [...COVER_LINES],
      // Supplied so the dialog's `ensureLoaded` takes its `saved` branch and
      // never parses a .docx: this file is about the research button's flush,
      // not about docx rendering, and a parse failure would show an error
      // panel instead of the editor.
      coverLetterPreviewHtml: COVER_LINES.map((l) => `<p>${l}</p>`).join(""),
      coverLetterDocxB64: ENGINE_BYTES,
      coverVersionId: "ver-1",
    },
  });
  const [reloadKey, setPreviewReloadKey] = useState(0);
  currentMap = tailoringMap;
  preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((c) => ({
        ...c,
        [jobId]: typeof updater === "function" ? updater(c[jobId] || {}) : { ...(c[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: async () => null,
    startBackgroundResearch: () => {},
    setPreviewReloadKey,
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research,
    chat: null,
    tailorEngine: "embedded",
    previewReloadKey: reloadKey,
    scrapePreviewPosting: null,
    currentUser: { id: "user-1" },
    resumeFile: null,
    coverLetterFile: null,
  });
}

function buttonsByText(re) {
  return [...document.querySelectorAll("button")].filter((b) => re.test((b.textContent || "").trim()));
}
function editorEl() {
  return document.querySelector('[contenteditable="true"]');
}
function entry() {
  return currentMap[JOB_ID];
}

async function openCoverPreviewInEditMode() {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await act(async () => {
    preview.openResumePreview(JOB, { tab: "cover" });
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const edit = buttonsByText(/^Edit$/)[0];
  expect(edit, "no Edit button in the open preview").toBeTruthy();
  await act(async () => {
    edit.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(editorEl(), "edit mode did not produce a contenteditable surface").toBeTruthy();
}

async function clickResearchCompany() {
  const btns = buttonsByText(/^Research company/);
  expect(
    btns.length,
    `no "Research company" button; buttons were: ${[...document.querySelectorAll("button")]
      .map((b) => JSON.stringify((b.textContent || "").trim()))
      .join(", ")}`,
  ).toBe(1);
  await act(async () => {
    btns[0].click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  currentMap = null;
  preview = null;
  research = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ articles: [], warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.fetch;
});

// ---------------------------------------------------------------------------
// Harness sanity controls. These must be GREEN before either leg below is
// read as a statement about the product.
// ---------------------------------------------------------------------------

describe("harness sanity control", () => {
  it("the real Mount renders the real dialog, portalled to document.body", async () => {
    await openCoverPreviewInEditMode();
    expect(container.textContent).toBe("");
    expect(document.body.textContent).toContain("Staff Engineer");
    // The cover tab is the active one, so the research button is reachable.
    expect(buttonsByText(/^Research company/)).toHaveLength(1);
  });

  it("the entry starts unedited, with its engine bytes and no pristine snapshot", async () => {
    await openCoverPreviewInEditMode();
    expect(editedForScope(entry(), "cover")).toBe(false);
    expect(entry().coverLetterDocxB64).toBe(ENGINE_BYTES);
    expect(entry().pristineCoverLines).toBeUndefined();
  });

  it("typing and waiting out the debounce DOES mark the scope edited -- so the miss below is a miss", async () => {
    // Establishes that `saveDocumentPreview` reaches this entry at all. Without
    // it, "edited is still false" could mean the harness is not wired up.
    await openCoverPreviewInEditMode();
    const editor = editorEl();
    editor.innerHTML = "<p>Dear Hiring Manager,</p><p>Something I typed.</p>";
    await act(async () => {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(editedForScope(entry(), "cover")).toBe(true);
    expect(entry().coverLetterResultLines.join("\n")).toContain("Something I typed.");
  });
});

// ---------------------------------------------------------------------------
// PM2, leg 1: the flush A9 exists to add. RED today.
// ---------------------------------------------------------------------------

describe("opening company research flushes the candidate's in-flight typing (PM2, leg 1)", () => {
  it("commits typed text at the click, without waiting out the auto-save debounce", async () => {
    await openCoverPreviewInEditMode();
    const editor = editorEl();
    editor.innerHTML = "<p>Dear Hiring Manager,</p><p>A sentence I typed but did not pause after.</p>";
    await act(async () => {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Deliberately NO wait: the 600 ms debounce has not fired. This is the
    // state the accept would otherwise read a stale letter in.
    expect(entry().coverLetterResultLines.join("\n")).not.toContain("A sentence I typed");

    await clickResearchCompany();

    expect(entry().coverLetterResultLines.join("\n")).toContain("A sentence I typed but did not pause after.");
    // And the dialog really did open -- the flush must not have replaced the
    // button's own job.
    expect(research.companyResearch.open).toBe(true);
    expect(research.companyResearch.jobId).toBe(JOB_ID);
  });
});

// ---------------------------------------------------------------------------
// PM2, leg 2: the guard. GREEN today for the wrong reason -- disclosed in the
// header -- and RED against step A9 as plan r3 words it.
// ---------------------------------------------------------------------------

describe("opening company research does NOT mark the letter hand-edited when nothing was typed (PM2, leg 2)", () => {
  it("leaves edited.cover false after entering edit mode and clicking straight through", async () => {
    await openCoverPreviewInEditMode();
    expect(editedForScope(entry(), "cover")).toBe(false);

    await clickResearchCompany();

    expect(editedForScope(entry(), "cover")).toBe(false);
    // The consequences, asserted directly rather than trusted to follow: no
    // pristine snapshot was taken, and the engine bytes are still there, so
    // the accept's docx splice is still reachable (plan r3 §7.10 step 5) and
    // the download still takes the verbatim-serve branch.
    expect(entry().pristineCoverLines).toBeUndefined();
    expect(entry().coverLetterDocxB64).toBe(ENGINE_BYTES);
    expect(entry().coverLetterResultLines).toEqual(COVER_LINES);
  });

  it("leaves it false even when the editor has re-serialised the same text differently", async () => {
    // The nastier case, and the one a naive `text === scopes[tab].text` guard
    // gets wrong: the candidate types a character and deletes it, so the
    // editor's `innerText` round-trips to the same VALUE through different
    // DOM. If the comparison is by identity or by HTML, this marks the letter
    // edited with nothing typed.
    await openCoverPreviewInEditMode();
    const editor = editorEl();
    editor.innerHTML = COVER_LINES.map((l) => `<p>${l}</p>`).join("");
    await act(async () => {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickResearchCompany();
    expect(editedForScope(entry(), "cover")).toBe(false);
    expect(entry().coverLetterResultLines).toEqual(COVER_LINES);
  });

  it("leaves it false when the editor merely LOSES FOCUS with nothing typed", async () => {
    // Found while building this file, and NOT in plan.check.r2: the editor's
    // own `onBlur` already calls `commitDraft()` unconditionally
    // (`DocumentPreviewDialog.js:857`). In a real browser, clicking ANY
    // control after entering edit mode blurs the contenteditable and marks
    // the letter hand-edited -- so the hazard PM2 attributes to step A9 is
    // partly reachable on `main` today, and a fix that only guards the
    // research button's own `commitDraft()` does not close it.
    //
    // jsdom does NOT move focus on a synthetic MouseEvent, so a `.click()`
    // cannot witness this. React wires `onBlur` to `focusout`, so the real
    // handler is driven here by dispatching `focusout` directly -- the same
    // event a browser blur produces.
    await openCoverPreviewInEditMode();
    const editor = editorEl();
    await act(async () => {
      editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(editedForScope(entry(), "cover")).toBe(false);
    expect(entry().pristineCoverLines).toBeUndefined();
    expect(entry().coverLetterDocxB64).toBe(ENGINE_BYTES);
  });

  it("does not mark the OTHER scope either", async () => {
    await openCoverPreviewInEditMode();
    await clickResearchCompany();
    expect(editedForScope(entry(), "resume")).toBe(false);
    expect(entry().pristineResumeLines).toBeUndefined();
  });
});

// WHAT THIS FILE CANNOT CATCH. It measures the tailoring entry, not the
// download. A build that keeps `edited.cover` false but clears
// `coverLetterDocxB64` on the same click would pass leg 2's flag assertion --
// which is why the bytes and the lines are asserted beside it, and why
// `app/hooks/acceptNoEngineBytes.test.js` drives the actual byte paths.
// It also cannot see the 600 ms debounce firing LATER and marking the scope
// edited after the accept has already read the letter; that ordering belongs
// with the accept's own test.

// ---------------------------------------------------------------------------
// verify.r1.md B2/B3/M5 (fix round). Everything above this line seeds the
// editor from `coverLetterPreviewHtml: COVER_LINES.map(l => "<p>"+l+"</p>").join("")`
// -- exactly one `<p>` per stored line, built BY THIS FILE so its own
// `innerText` round-trips to `COVER_LINES.join("\n")` identically. That makes
// a text-only comparison, an html comparison and a trimmed comparison all
// indistinguishable (verify.r1.md M5: mutants V-html and V-trim survive
// 62/62 against that fixture). It also never happens in production: an
// unedited engine letter's `coverLetterPreviewHtml` is `undefined`, so the
// editor is seeded from a REAL parsed .docx render, whose blank paragraphs
// make its `innerText` differ from `coverLetterResultLines.join("\n")` --
// measured on a real letter at 15 rendered lines against 8 stored
// (verify.r1.md B2). Everything below drives the SAME guard against that
// real shape instead, and against a formatting-only edit (B3).
// ---------------------------------------------------------------------------

function ProbeReal({ engineB64, engineLines }) {
  const [tailoringMap, setTailoringMap] = useState({
    [JOB_ID]: {
      status: "done",
      result: "RESUME TEXT",
      resultLines: ["RESUME TEXT"],
      docxB64: "",
      docxPath: "",
      coverLetterResultLines: [...engineLines],
      // Undefined, unlike COVER_LINES' hand-built fixture above -- this is
      // the real shape a never-edited engine letter has in production, so
      // `ensureLoaded` takes the PARSE branch instead of the "saved" one.
      coverLetterPreviewHtml: undefined,
      coverLetterDocxB64: engineB64,
      coverVersionId: "ver-1",
    },
  });
  const [reloadKey, setPreviewReloadKey] = useState(0);
  currentMap = tailoringMap;
  preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((c) => ({
        ...c,
        [jobId]: typeof updater === "function" ? updater(c[jobId] || {}) : { ...(c[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: async () => null,
    startBackgroundResearch: () => {},
    setPreviewReloadKey,
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research,
    chat: null,
    tailorEngine: "embedded",
    previewReloadKey: reloadKey,
    scrapePreviewPosting: null,
    currentUser: { id: "user-1" },
    resumeFile: null,
    coverLetterFile: null,
  });
}

async function openRealCoverPreviewInEditMode(engineB64, engineLines) {
  await act(async () => {
    root.render(createElement(ProbeReal, { engineB64, engineLines }));
  });
  await act(async () => {
    preview.openResumePreview(JOB, { tab: "cover" });
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const edit = buttonsByText(/^Edit$/)[0];
  expect(edit, "no Edit button in the open preview").toBeTruthy();
  await act(async () => {
    edit.click();
  });
  // A real .docx parse (JSZip + XML) takes more than a couple of microtask
  // ticks -- unlike the hand-built fixture above, whose `saved` branch
  // resolves synchronously. Poll instead of guessing a fixed tick count.
  for (let i = 0; i < 50 && !editorEl(); i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  expect(editorEl(), "edit mode did not produce a contenteditable surface").toBeTruthy();
}

describe("the guard against a REAL parsed engine letter, not a hand-built fixture (B2)", () => {
  let ENGINE_B64 = "";
  let ENGINE_LINES = [];

  beforeAll(async () => {
    const cl = await embeddedEngine.tailorCoverLetter({
      jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
      jobTitle: "Staff Engineer",
      companyName: "Acme",
    });
    ENGINE_B64 = cl.docxB64;
    ENGINE_LINES = cl.resultLines;
  });

  it("CONTROL: the real engine letter's rendered text really does differ from its stored lines", async () => {
    // Without this, a "guard did not fire" result below could mean the
    // fixture happens to round-trip cleanly instead of the guard actually
    // doing its job against a real divergence.
    await openRealCoverPreviewInEditMode(ENGINE_B64, ENGINE_LINES);
    expect(editorEl().innerText).not.toBe(ENGINE_LINES.join("\n"));
  });

  it("blurring the unedited, REALLY-parsed letter with nothing typed does not mark it hand-edited", async () => {
    await openRealCoverPreviewInEditMode(ENGINE_B64, ENGINE_LINES);
    await act(async () => {
      editorEl().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(editedForScope(entry(), "cover")).toBe(false);
    expect(entry().coverLetterResultLines).toEqual(ENGINE_LINES);
    expect(entry().coverLetterDocxB64).toBe(ENGINE_B64);
  });

  it("clicking Research company on the REALLY-parsed letter with nothing typed does not mark it hand-edited", async () => {
    await openRealCoverPreviewInEditMode(ENGINE_B64, ENGINE_LINES);
    await clickResearchCompany();
    expect(editedForScope(entry(), "cover")).toBe(false);
    expect(entry().coverLetterResultLines).toEqual(ENGINE_LINES);
  });
});

describe("a formatting-only edit is still committed (B3)", () => {
  it("bolding a run of text, with the text itself unchanged, still saves", async () => {
    await openCoverPreviewInEditMode();
    const editor = editorEl();
    // Same TEXT as the seed (COVER_LINES joined), different HTML -- exactly
    // what Bold/Italic/Underline/Align/font-size do: they rewrite innerHTML
    // and leave innerText alone.
    editor.innerHTML = ["<p><b>Dear Hiring Manager,</b></p>", ...COVER_LINES.slice(1).map((l) => `<p>${l}</p>`)].join("");
    expect(editor.innerText).toBe(COVER_LINES.join("\n"));
    await act(async () => {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(entry().coverLetterPreviewHtml || "").toContain("<b>Dear Hiring Manager,</b>");
    expect(editedForScope(entry(), "cover")).toBe(true);
  });
});
