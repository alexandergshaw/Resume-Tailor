// @vitest-environment jsdom
//
// N61 (S3/S4) -- REMOVAL, reached the way a candidate reaches it: mount the
// REAL DocumentPreviewMount (which renders the REAL DocumentPreviewDialog),
// insert a fact through the real accept path, then click the REAL one-click
// Remove control and assert the DOCUMENT changed. removeInsertedFact is NEVER
// called directly -- a source-scan or a direct handler call cannot prove a user
// can reach the control, and reachability is the single most-repeated defect in
// this repo (loop-tdd rule 5). Mounting via the MOUNT, not the Dialog, is
// deliberate: if the Mount fails to thread onRemoveFact, the button is inert
// and the fact does not leave -- exactly the wiring bug a Dialog-only harness
// would hide (loop-traps: "a harness that wires the component differently from
// production hides the wiring bug").
//
// What is asserted is the DOWNLOAD-REBUILD SOURCE (coverLetterResultLines), not
// only the on-screen text: a fact still present in the lines the download
// rebuilds from is a fact that still egresses (AC-N61.19).
//
// jsdom note: MUI's Dialog portals into document.body, so every DOM query goes
// through `document`.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
// A researched fact with a real, openable source url (so the strip offers a
// source link, AC-N61.10). Distinctive full sentence -> a clean excision.
const FACT = {
  id: "art-dublin",
  text: "Acme just opened a Dublin telemetry lab.",
  url: "https://news.example.com/acme/dublin-lab",
  title: "Acme opens a Dublin telemetry lab",
  placement: "intro",
};

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

let store = { facts: [], removed: [], revision: null };
let putBodies = [];
let probe = null;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function entryWithEngineLetter(overrides = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    ...overrides,
  };
}

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  const preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: () => {},
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 50,
    contextFiles: [],
    downloadDocxFiles: {},
    startBackgroundResearch: research.startBackgroundResearch,
    setPreviewReloadKey,
    onDocumentEdited: () => {},
    currentUser: null,
    onCheckDuplicate: () => {},
  });
  probe = { tailoringMap, setTailoringMap, research, preview };
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research,
    chat: { askAiAbout: () => {} },
    tailorEngine: "embedded",
    previewReloadKey,
    scrapePreviewPosting: null,
    currentUser: null,
    resumeFile: null,
    coverLetterFile: null,
  });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision, versionSaved: !!body.coverVersion });
    }
    return json({});
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete globalThis.fetch;
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
  });
  await flush();
}

// Open the preview on the cover tab, the way page.js does.
async function openCoverPreview() {
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

// Insert one fact through the REAL accept path (the setup -- insertion's own
// reachability is a separate, S5/S6 concern). openCompanyResearch sets the
// job the accept binds to; acceptFacts splices + PUTs + updates state.
async function insertFactViaAccept() {
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
  await act(async () => {
    await probe.research.acceptFacts({ facts: [FACT], declinedUrls: [] });
  });
  await flush();
}

function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}
// Click the fact's Remove control the way a candidate does. Settles the render
// first (in production seconds pass between insert and click; the settle keeps
// the click off a not-yet-committed frame), then drains the removal -- which on
// the bytes path awaits a real docx (de)serialize, so microtask flushes alone
// are not enough; we advance real time until the removal has settled.
async function clickRemove(i = 0) {
  await flush();
  await act(async () => {
    removeButtons()[i].click();
  });
  for (let n = 0; n < 20; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (removeButtons().length === 0) break;
  }
  await flush();
}
function downloadButton() {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Download .docx");
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

describe("removal is reachable by render-and-click (AC-N61.14/.15/.18)", () => {
  it("clicking the one-click Remove control removes the fact from the download-rebuild source", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();

    // Non-vacuity: the fact really landed in the lines the download rebuilds
    // from, and exactly one removal control is on screen (else "gone" and "one
    // click" are both vacuous).
    expect(coverLines().join("\n"), "the fact was never inserted -- removal test would be vacuous").toContain(FACT.text);
    expect(removeButtons().length, "no removal control rendered -- the strip is not wired into the modal").toBe(1);

    // One click, no confirm: a confirm() would guard the WRONG direction.
    window.confirm = () => {
      throw new Error("removal must not open a confirmation dialog");
    };
    await clickRemove();

    expect(coverLines().join("\n"), "the fact is STILL in the lines the download rebuilds from").not.toContain(FACT.text);
    expect(removeButtons().length, "the removed fact's row is still on screen").toBe(0);
    // the paragraph left behind is readable (no seam)
    for (const line of coverLines()) {
      expect(/\s{2,}|\s[.,;:!?]/.test(line), `readability seam in: ${JSON.stringify(line)}`).toBe(false);
    }
  });

  it("every egress control co-renders with the removable fact (AC-N61.21)", async () => {
    // The safety line: a fact cannot reach an employer from a surface where it
    // was not highlighted+removable. The Download .docx control and the removal
    // strip must be in the SAME open modal.
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    expect(removeButtons().length, "no removal control").toBe(1);
    expect(downloadButton(), "the Download .docx egress control is not co-rendered with the removal strip").toBeTruthy();
  });

  it("the removal is recorded so a later research run does not silently re-add it (AC-N61.20)", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    const beforeCount = putBodies.length;
    await clickRemove();
    expect(putBodies.length, "removal made no write to the store").toBeGreaterThan(beforeCount);
    const put = putBodies[putBodies.length - 1];
    // the removed fact is dropped from the stored set...
    expect(put.facts.map((f) => f.id)).not.toContain(FACT.id);
    // ...its identity is recorded in the retracted log...
    expect(put.declinedUrls, "the removed fact's identity was not recorded").toContain(FACT.url);
    // ...and the saved cover version no longer carries the fact.
    expect(put.coverVersion, "removal must send a coverVersion or the store diverges").toBeTruthy();
    expect(JSON.stringify(put.coverVersion.lines)).not.toContain(FACT.text);
  });
});

describe("removal in the no-bytes (version-switch) state (AC-N61.19)", () => {
  it("removes the fact even when the session's cover bytes are gone, without the accept-path refusal", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    expect(coverLines().join("\n")).toContain(FACT.text);

    // Simulate a version-switch / restored-chip: coverLetterDocxB64 cleared
    // (exactly what selectDocumentVersion writes), lines still present. The
    // accept path REFUSES here (NO_ENGINE_BYTES_REASON); removal must not.
    await act(async () => {
      probe.setTailoringMap((m) => ({ ...m, [JOB_ID]: { ...m[JOB_ID], coverLetterDocxB64: "" } }));
    });
    await flush();

    await clickRemove();

    expect(coverLines().join("\n"), "removal was blocked in the no-bytes state -- the fact is trapped in the letter").not.toContain(FACT.text);
    expect(probe.research.companyResearch.acceptError || "", "removal raised the accept path's missing-bytes refusal").toBe("");
  });
});

describe("removal preserves the candidate's own edits (AC-N61.17)", () => {
  it("a hand edit on the cover letter survives removal, and it does not rebuild from the generic template", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();

    // The candidate hand-edits another paragraph (marked cover edited, a
    // distinctive phrase added to a line that is NOT the fact's).
    const HAND_EDIT = "I am personally relocating to Dublin this spring.";
    await act(async () => {
      probe.setTailoringMap((m) => {
        const cur = m[JOB_ID];
        const lines = [...cur.coverLetterResultLines];
        lines[lines.length - 2] = `${lines[lines.length - 2]} ${HAND_EDIT}`;
        return { ...m, [JOB_ID]: { ...cur, coverLetterResultLines: lines, edited: { resume: false, cover: true } } };
      });
    });
    await flush();
    expect(coverLines().join("\n")).toContain(HAND_EDIT);

    await clickRemove();

    expect(coverLines().join("\n"), "the fact was not removed").not.toContain(FACT.text);
    expect(coverLines().join("\n"), "removal discarded the candidate's hand edit").toContain(HAND_EDIT);
    expect(probe.tailoringMap[JOB_ID].edited.cover, "the cover's hand-edited flag was cleared by removal").toBe(true);
  });
});
