// @vitest-environment jsdom
//
// N35 / 4b -- PB1 from `chunks/N40/plan.check.r2.md`.
//
// WHAT THIS PINS. `resolveDocumentBlob`'s verbatim-serve branch is
// `if (!edited && engineDocxB64) return base64ToDocxBlob(engineDocxB64)`
// (`lib/document/docx.js:559`). It needs the engine bytes to be NON-EMPTY,
// not merely `edited === false`. Plan r3 §2.2 proves the no-rebuild claim for
// one entry shape and generalises it to all of them. Two ordinary states
// leave the cover scope with `edited` false and NO engine bytes:
//
//   * the restored chip -- `app/page.js:1320-1332` rebuilds the chip from
//     `generated_cover_letters.content_lines` and sets no `coverLetterDocxB64`
//     at all (there is no `docx_path` column on that table, F-11);
//   * the version switch -- `app/hooks/useDocumentPreview.js:243-256` sets
//     `coverLetterDocxB64: ""` and `edited: withEditedScope(entry,"cover",false)`.
//
// In both, plan r3 §7.10 step 5 SKIPS the splice (its first guard is a
// non-empty `coverLetterDocxB64`), step 9 leaves the bytes alone, and the
// accept proceeds text-only with no notice. The candidate then downloads the
// accepted fact inside their GENERIC UPLOADED TEMPLATE -- measured by the plan
// checker at 8,992 bytes against the engine letter's 726,408 -- through
// `buildDocxFromUploadedTemplate`, which is N54's defect site. So the chunk
// does not merely inherit N54: it routes a NEW payload onto a rebuild the
// candidate would not otherwise have triggered on that letter.
//
// THE DECISION THIS FILE ENCODES (the owner's ruling carried into 4b): the
// accept is REFUSED when the engine's copy of the letter is absent, with a
// plain reason the candidate can act on, and nothing is written.
//
// WHY THESE ARE NOT HAND-BUILT ARGUMENT OBJECTS. `editedForScope` exists
// THREE times in this repo (`previewBlob.js:40` exported, `docx.js:598`
// module-private, `StatusBar.js:23` a local copy). A test that imports one of
// them and assembles its own args proves nothing about which copy production
// reads. Every byte assertion below goes through a REAL production entry
// point: the mounted `useDocumentPreview.downloadDocumentPreview` -> the real
// `createDocumentDownloaders().downloadDocxFiles`, and the real
// `buildPreviewBlob` at the exact seam `useDriveDocuments.js:591` calls.
//
// REACHABILITY. The last describe mounts the REAL `CompanyResearchDialog` and
// CLICKS the real accept control, because "a plain on-screen reason" is a
// claim about what a human sees, and a direct `acceptFacts()` call cannot
// settle it.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const h = vi.hoisted(() => ({ downloads: [], storage: {} }));

vi.mock("@/lib/document/download.js", () => ({
  triggerBlobDownload: (blob, fileName) => {
    h.downloads.push({ blob, fileName });
  },
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pos-1" }, error: null }) }) }),
    }),
    storage: {
      from: () => ({
        download: async (path) => {
          const blob = h.storage[path];
          return blob ? { data: blob, error: null } : { data: null, error: { message: "not found" } };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";
import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { createDocumentDownloaders, buildMinimalistDocx } from "@/lib/document/docx.js";
import { buildPreviewBlob, previewBlobArgs } from "@/lib/document/previewBlob.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const FACT_TEXT = "Acme opened a Dublin telemetry lab in 2026.";
const FACT_URL = "https://acme.example.com/newsroom/dublin-lab";
const SELECTION = {
  facts: [
    {
      id: "art-1",
      text: FACT_TEXT,
      url: FACT_URL,
      title: "Acme opens Dublin telemetry lab",
      source: "Acme Newsroom",
      placement: "current",
      textOrigin: "template",
    },
  ],
  declinedUrls: [],
};

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let COVER_TEMPLATE_FILE = null;

async function blobToB64(blob) {
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

beforeAll(async () => {
  // A REAL engine cover letter, not a stub: the byte comparisons below are
  // only meaningful against a document the product actually produces.
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
  const tpl = await buildMinimalistDocx(
    [{ primaryLine: "Generic", secondaryLine: "Sub", details: ["d1", "d2"] }],
    "Generic CL",
  );
  COVER_TEMPLATE_FILE = new File([tpl], "cl-template.docx", { type: DOCX_MIME });
});

// ---------------------------------------------------------------------------
// Entry shapes. These are the THREE states plan.check.r2 separates, built the
// way the shipping code leaves them -- not three variations on one fixture.
// ---------------------------------------------------------------------------

function baseEntry(over = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterPreviewHtml: undefined,
    coverVersionId: "ver-1",
    ...over,
  };
}
// In-session, unedited: the shape plan r3 §2.2 traces. Engine bytes present.
const entryInSession = () => baseEntry({ coverLetterDocxB64: ENGINE_B64 });
// Restored chip: page.js:1320-1332 sets NO coverLetterDocxB64 key at all.
const entryRestoredChip = () => {
  const e = baseEntry({ docxPath: "" });
  delete e.coverLetterDocxB64;
  return e;
};
// Version-switched: useDocumentPreview.js:255 sets it to the empty string.
const entryVersionSwitched = () => baseEntry({ coverLetterDocxB64: "" });

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let api = null; // useDocumentPreview
let research = null; // useCompanyResearch
let currentMap = null; // the live tailoring map, read back instead of guessed
let container = null;
let root = null;
let fetchCalls = [];
let putResponder = null;

function Probe({ initialMap, downloadDocxFiles, renderDialog }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  currentMap = tailoringMap;
  const updateTailoringJob = (jobId, updater) =>
    setTailoringMap((c) => ({
      ...c,
      [jobId]: typeof updater === "function" ? updater(c[jobId] || {}) : { ...(c[jobId] || {}), ...updater },
    }));
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob,
    resumeFile: null,
    coverLetterFile: COVER_TEMPLATE_FILE,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles,
    startBackgroundResearch: () => {},
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  if (!renderDialog) return null;
  return createElement(CompanyResearchDialog, {
    open: research.companyResearch.open,
    company: research.companyResearch.company,
    needsCompany: false,
    loading: false,
    error: "",
    articles: [
      {
        id: "art-1",
        title: "Acme opens Dublin telemetry lab",
        url: FACT_URL,
        source: "Acme Newsroom",
        summary: FACT_TEXT,
        suggestion: FACT_TEXT,
      },
    ],
    warnings: [],
    busy: !!research.companyResearch.busy,
    acceptError: research.companyResearch.acceptError || "",
    acceptNotice: research.companyResearch.acceptNotice || "",
    factsState: research.acceptedFactsByJob?.[JOB_ID] || { facts: [], removed: [], revision: null },
    coverLetterLines: tailoringMap[JOB_ID]?.coverLetterResultLines || [],
    onClose: () => research.closeCompanyResearch(),
    onAccept: (selection) => research.acceptFacts(selection),
    onResearch: () => {},
    onAddUrl: () => {},
  });
}

function makeDownloaders() {
  return createDocumentDownloaders({
    resumeFile: null,
    coverLetterFile: COVER_TEMPLATE_FILE,
    tailoringMap: {},
    applicationData: [],
  });
}

async function mount(entry, { renderDialog = false } = {}) {
  const { downloadDocxFiles } = makeDownloaders();
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry }, downloadDocxFiles, renderDialog }));
  });
  await act(async () => {
    api.openResumePreview(JOB, { tab: "cover" });
    research.openCompanyResearch(JOB);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.downloads.length = 0;
  api = null;
  research = null;
  fetchCalls = [];
  putResponder = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    fetchCalls.push({ url: String(url), method, body: init.body });
    if (String(url).includes("/api/company-research")) {
      return new Response(JSON.stringify({ articles: [], warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/api/accepted-facts")) {
      if (putResponder) return putResponder({ url: String(url), method, body: init.body });
      return new Response(
        JSON.stringify({ facts: [], removed: [], revision: 1, versionSaved: false, previousFacts: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.fetch;
});

function acceptedFactsWrites() {
  return fetchCalls.filter((c) => c.url.includes("/api/accepted-facts") && c.method !== "GET");
}

// ---------------------------------------------------------------------------
// Harness sanity control. Standing repo practice: a no-op that must be GREEN
// before any RED below is read as a product failure, plus a fixture control
// proving the engine document really was built.
// ---------------------------------------------------------------------------

describe("harness sanity control", () => {
  it("the fixture is a real engine cover letter with real bytes", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
    expect(COVER_TEMPLATE_FILE).toBeInstanceOf(File);
  });

  it("the uploaded generic template really is a DIFFERENT document from the engine letter", async () => {
    // Without this, "the download was rebuilt onto the generic template" and
    // "the download is the engine letter" would be indistinguishable.
    const tplB64 = Buffer.from(await COVER_TEMPLATE_FILE.arrayBuffer()).toString("base64");
    expect(tplB64).not.toBe(ENGINE_B64);
    expect(tplB64.length).toBeLessThan(ENGINE_B64.length / 2);
  });
});

// ---------------------------------------------------------------------------
// PB1 (a): the refusal itself, through the real hook.
// ---------------------------------------------------------------------------

describe("accepting a fact is refused when the engine's copy of the letter is absent (PB1)", () => {
  it("refuses on a RESTORED CHIP, writes nothing, and sends no PUT", async () => {
    const entry = entryRestoredChip();
    await mount(entry);

    let result;
    await act(async () => {
      result = await research.acceptFacts(SELECTION);
    });

    expect(result.ok).toBe(false);
    // The refusal happens before any network write. A refused POST/PUT would
    // still spend a rate-limit token, so "no request" is the assertion, not
    // "the request failed".
    expect(acceptedFactsWrites()).toHaveLength(0);
    // Nothing on the entry moved: not the text, not the bytes, not `edited`.
    expect(research.companyResearch.acceptError).toBeTruthy();
    expect(typeof research.companyResearch.acceptError).toBe("string");
  });

  it("refuses after a COVER VERSION SWITCH (coverLetterDocxB64 === '')", async () => {
    await mount(entryVersionSwitched());
    let result;
    await act(async () => {
      result = await research.acceptFacts(SELECTION);
    });
    expect(result.ok).toBe(false);
    expect(acceptedFactsWrites()).toHaveLength(0);
    expect(research.companyResearch.acceptError).toBeTruthy();
  });

  it("CONTROL: the same accept SUCCEEDS on an in-session letter that has its engine bytes", async () => {
    // Without this the refusal above is indistinguishable from an accept that
    // is broken for every input -- a guard that refuses everything.
    await mount(entryInSession());
    let result;
    await act(async () => {
      result = await research.acceptFacts(SELECTION);
    });
    expect(result.ok).toBe(true);
    expect(acceptedFactsWrites()).toHaveLength(1);
    expect(research.companyResearch.acceptError || "").toBe("");
  });

  it("CONTROL: an entry with NO cover letter at all is not caught by the guard", async () => {
    // The guard is about a letter whose BYTES are missing, not about the
    // absence of a letter. An email-only accept must still go through.
    const entry = baseEntry({ coverLetterResultLines: [], coverLetterDocxB64: "" });
    await mount(entry);
    let result;
    await act(async () => {
      result = await research.acceptFacts(SELECTION);
    });
    expect(result.ok).toBe(true);
    expect(acceptedFactsWrites()).toHaveLength(1);
  });

  it("leaves the document EXACTLY as it was -- text, bytes and edited flag", async () => {
    const entry = entryRestoredChip();
    const beforeLines = [...entry.coverLetterResultLines];
    await mount(entry);
    await act(async () => {
      await research.acceptFacts(SELECTION);
    });
    expect(api.resumePreview.jobId).toBe(JOB_ID);
    const live = currentMap[JOB_ID];
    // The fact never entered the letter's text.
    expect(live.coverLetterResultLines.join("\n")).not.toContain(FACT_TEXT);
    expect(live.coverLetterResultLines).toEqual(beforeLines);
    // The bytes field was not invented, and no version pointer moved.
    expect(live.coverLetterDocxB64 ?? "").toBe("");
    expect(live.coverVersionId).toBe("ver-1");
    // And the accept did not mark the letter hand-edited as a side effect --
    // read through the SAME helper production reads, on the live entry.
    const blobArgs = previewBlobArgs(live, "cover", { coverLetterFile: COVER_TEMPLATE_FILE });
    expect(blobArgs.edited).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PB1 (b): the byte paths. Three of the five can serve a cover document; the
// other two are pinned by `lib/acceptedFacts/coverBytePaths.census.test.js`,
// which is a call-site census with its own canary (they are drag handlers on
// components whose payload builders read no cover field at all).
// ---------------------------------------------------------------------------

describe("no download or save path can ship a fact inside the generic uploaded template (PB1, paths 1-3)", () => {
  // The text the dialog would hand the download after the accept: the entry's
  // CURRENT stored lines, exactly as DocumentPreviewDialog's view-mode payload
  // supplies them.
  function activeText() {
    return (currentMap[JOB_ID].coverLetterResultLines || []).join("\n");
  }

  it("PATH 1 preview download: a refused accept on a restored chip leaves the served bytes fact-free", async () => {
    const entry = entryRestoredChip();
    await mount(entry);
    await act(async () => {
      await research.acceptFacts(SELECTION);
    });
    const text = activeText();
    await act(async () => {
      await api.downloadDocumentPreview("cover", { text });
    });
    const served = h.downloads.length ? await blobToB64(h.downloads[h.downloads.length - 1].blob) : null;
    // Something was served (the candidate is not blocked from downloading
    // their letter) ...
    expect(served).not.toBeNull();
    // ... and it does not carry the fact, because the accept never happened.
    expect(await docxContainsText(served)).toBe(false);
  });

  it("PATH 1 CONTROL: the same download DOES carry the fact after a successful in-session accept", async () => {
    // The over-fire control for the whole path-1 leg. If this is not true,
    // the assertion above is satisfied by a download that never works.
    const entry = entryInSession();
    await mount(entry);
    await act(async () => {
      await research.acceptFacts(SELECTION);
    });
    const text = activeText();
    expect(text).toContain(FACT_TEXT);
    await act(async () => {
      await api.downloadDocumentPreview("cover", { text });
    });
    const served = h.downloads.length ? await blobToB64(h.downloads[h.downloads.length - 1].blob) : null;
    expect(served).not.toBeNull();
    expect(await docxContainsText(served)).toBe(true);
    // And it is the SPLICED document served verbatim -- not a rebuild. The
    // expected value is read back off the live entry, so this control cannot
    // agree with the implementation by construction.
    expect(served).toBe(currentMap[JOB_ID].coverLetterDocxB64);
    expect(served).not.toBe(ENGINE_B64);
  });

  it("PATH 2 Drive save / preview render seam: a bytes-less cover never rebuilds a fact", async () => {
    // The exact call `app/hooks/useDriveDocuments.js:591` makes, with the
    // `activeText` `DocumentPreviewDialog.js:512` supplies. Driven from the
    // LIVE entry after a real accept attempt, not from a hand-built fixture,
    // so a guard that refuses in the hook but still mutates the entry is
    // caught here rather than assumed away.
    for (const build of [entryRestoredChip, entryVersionSwitched]) {
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await mount(build());
      await act(async () => {
        await research.acceptFacts(SELECTION);
      });
      const live = currentMap[JOB_ID];
      const text = activeText();
      const args = previewBlobArgs(live, "cover", { coverLetterFile: COVER_TEMPLATE_FILE, text });
      // This is the defect PB1 names, in one line: `edited` is false and yet
      // there are no engine bytes, so the verbatim branch cannot be taken.
      // The fix is upstream -- the accept never happened -- not here.
      expect(args.edited).toBe(false);
      expect(args.engineDocxB64).toBe("");
      const blob = await buildPreviewBlob(live, "cover", { coverLetterFile: COVER_TEMPLATE_FILE, text });
      expect(await docxContainsText(blob ? await blobToB64(blob) : null)).toBe(false);
    }
  });

  it("PATH 3 chip download: the page.js argument shape cannot ship a fact without engine bytes", async () => {
    await mount(entryVersionSwitched());
    await act(async () => {
      await research.acceptFacts(SELECTION);
    });
    const live = currentMap[JOB_ID];
    const { downloadDocxFiles } = makeDownloaders();
    h.downloads.length = 0;
    // `app/page.js:2066`'s argument shape, filled from the live entry.
    const err = await downloadDocxFiles({
      jobTitle: "Staff Engineer",
      company: "Acme",
      result: live.result || "",
      resultLines: live.resultLines || [],
      coverLetterResultLines: live.coverLetterResultLines || [],
      docxB64: live.docxB64 || "",
      coverLetterDocxB64: live.coverLetterDocxB64 || "",
    });
    expect(err).toBeNull();
    const served = h.downloads.length ? await blobToB64(h.downloads[h.downloads.length - 1].blob) : null;
    expect(await docxContainsText(served)).toBe(false);

    // CONTROL: with the engine bytes present the same call serves them
    // verbatim, so the assertion above is not satisfied by a download that
    // never produces anything.
    h.downloads.length = 0;
    await downloadDocxFiles({
      jobTitle: "Staff Engineer",
      company: "Acme",
      result: "",
      resultLines: [],
      coverLetterResultLines: [...ENGINE_LINES],
      docxB64: "",
      coverLetterDocxB64: ENGINE_B64,
    });
    const verbatim = await blobToB64(h.downloads[h.downloads.length - 1].blob);
    expect(verbatim).toBe(ENGINE_B64);
  });

  it("PATH 1 with no uploaded template: the candidate is told, not silently given nothing", async () => {
    // plan.check.r2 row 1c. The refusal copy here is the DOWNLOAD's, which
    // already ships; this pins that the accept guard does not replace it with
    // silence.
    const saved = COVER_TEMPLATE_FILE;
    COVER_TEMPLATE_FILE = null;
    try {
      const entry = entryRestoredChip();
      await mount(entry);
      await act(async () => {
        await api.downloadDocumentPreview("cover", { text: entry.coverLetterResultLines.join("\n") });
      });
      expect(api.resumePreview.error.cover).toBeTruthy();
      expect(h.downloads).toHaveLength(0);
    } finally {
      COVER_TEMPLATE_FILE = saved;
    }
  });
});

// A docx "contains" check that reads the real document, not the base64 string:
// base64 of a zip tells you nothing about its text, and `expect(b64).toContain(FACT)`
// would be green for every input. Unzips word/document.xml and reads it.
async function docxContainsText(b64) {
  if (!b64) return false;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const xml = await zip.file("word/document.xml").async("string");
  const plain = xml.replace(/<[^>]+>/g, "");
  return plain.includes(FACT_TEXT);
}

// ---------------------------------------------------------------------------
// PB1 (c): what the candidate sees. REACHABILITY -- the real dialog, the real
// control, a real click.
// ---------------------------------------------------------------------------

describe("the candidate is given a plain, actionable reason on screen (PB1)", () => {
  function acceptButton() {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.filter((b) => /insert|accept|add to/i.test(b.textContent || ""));
  }

  it("clicking the real accept control on a restored chip shows the reason in the dialog", async () => {
    await mount(entryRestoredChip(), { renderDialog: true });
    // MUI's Dialog portals to document.body, never into the mount container.
    expect(container.textContent).toBe("");
    expect(document.body.textContent.length).toBeGreaterThan(0);

    const candidates = acceptButton();
    // The label is matched loosely on purpose: this pins that ONE reachable
    // accept control exists in the dialog, not what it is called. Today's
    // two-step "Next: arrange" -> "Insert into cover letter" flow puts no
    // accept control on the first screen at all, which is why this is red.
    expect(
      candidates.length,
      `no accept control in the research dialog; buttons were: ${[...document.querySelectorAll("button")]
        .map((b) => JSON.stringify(b.textContent))
        .join(", ")}`,
    ).toBeGreaterThan(0);
    await act(async () => {
      candidates[candidates.length - 1].click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const shown = document.body.textContent || "";
    const reason = research.companyResearch.acceptError || "";
    expect(reason.length).toBeGreaterThan(20);
    // It is actually rendered, not merely held in state.
    expect(shown).toContain(reason);
    // The dialog stays open so the candidate can act on it.
    expect(research.companyResearch.open).toBe(true);
  });

  it("the reason names the document and a remedy, and uses no developer vocabulary", async () => {
    await mount(entryVersionSwitched(), { renderDialog: true });
    await act(async () => {
      await research.acceptFacts(SELECTION);
    });
    const reason = research.companyResearch.acceptError || "";
    expect(reason).toMatch(/cover letter/i);
    // A reachable remedy, not a dead end: the candidate can regenerate the
    // letter in this session and then accept.
    expect(reason).toMatch(/regenerat/i);
    // "Plain" with teeth: no internals leaking into the candidate's copy.
    expect(reason).not.toMatch(/undefined|null|base64|b64|docx64|coverLetterDocxB64|resolveDocumentBlob|buildDocxFromUploadedTemplate/i);
    // And not a bare status code or a stringified object.
    expect(reason).not.toMatch(/^\[object|^\d+$/);
  });

  it("CONTROL: no reason is shown when the accept succeeds", async () => {
    // Without this, a dialog that renders the same banner unconditionally
    // would satisfy every assertion above.
    await mount(entryInSession(), { renderDialog: true });
    await act(async () => {
      await research.acceptFacts(SELECTION);
    });
    expect(research.companyResearch.acceptError || "").toBe("");
    const shown = document.body.textContent || "";
    expect(shown).not.toMatch(/regenerat/i);
  });
});

// WHAT THIS FILE CANNOT CATCH. It measures the CLIENT decision. If a future
// change moves the refusal to the server, every assertion here about "no PUT"
// becomes wrong rather than stale, and the file must be re-read, not patched.
// It also cannot see a rebuild that preserves the fact text but damages the
// document some other way (N54's soft line breaks are the live example) --
// `docxContainsText` answers one question only.
