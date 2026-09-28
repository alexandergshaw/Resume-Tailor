// @vitest-environment jsdom
//
// N61 (LIVE DEFECT, blocker) -- THE EGRESS CENSUS MUST BIND CO-VISIBILITY, NOT
// CO-RENDERING. The existing egress criterion (app/hooks/removeInsertedFact.rc.
// test.js: "every egress control co-renders with the removable fact") checks
// only that the Download control and the strip are in the SAME open modal -- so
// it passes on the cover tab and MISSES the defect entirely, because "inside the
// same dialog" is not "visible at the same time". The Combine control builds an
// employer-bound document FROM THE COVER LETTER'S LINES and is reachable from
// EVERY tab; on the résumé/email tabs the strip is gone (gated on
// activeScope === "cover" in DocumentPreviewMount.js) yet Combine still ships the
// facts. OWNER RULING: the strip renders whenever there are inserted facts, on
// ANY tab.
//
// THE PROPERTY THIS FILE BINDS: whenever the cover letter carries inserted facts,
// the review strip is VISIBLE on every tab from which an egress control can carry
// those facts out. Because Combine (and a Drive download of a saved cover) carry
// them from every tab, the owner ruling makes the strip visible on ALL tabs when
// facts exist -- which is strictly stronger and covers any future egress too.
// This is asserted by rendering the REAL DocumentPreviewMount and switching tabs,
// never by a source scan (a scan cannot tell "in the DOM" from "visible from
// here", which is the exact conflation the checker flagged).
//
// THE FIVE COVER-LETTER EGRESS SURFACES (enumerated below, no sixth found):
//   1. Download .docx        - DocumentPreviewDialog.js inline button (docx tabs)
//   2. Save to Drive         - DriveActions.js (#drive-save-control-label)
//   3. Download from Drive   - DriveActions.js (needs a stored reference)
//   4. Copy text             - CopyDocumentControl.js (every tab)
//   5. Download combined     - CombineDocumentsControl.js (every tab; the defect)
//
// jsdom does no layout, so "visible" means rendered and not display:none /
// visibility:hidden / [hidden] on itself or an ancestor -- see isDisplayed.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "../../hooks/useCompanyResearch.js";
import { useDocumentPreview } from "../../hooks/useDocumentPreview.js";
import DocumentPreviewMount from "../DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { SCOPES } from "@/lib/tailor/documentScopes.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const FACT = {
  id: "art-dublin",
  text: "Acme just opened a Dublin telemetry lab.",
  url: "https://news.example.com/acme/dublin-lab",
  title: "Acme opens a Dublin telemetry lab",
  placement: "intro",
};
const RESUME_BODY = "Alex Shaw. Staff Engineer with a decade building telemetry platforms.";

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
let probe = null;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// All THREE scopes present -- résumé (via `result`), cover letter (engine
// bytes/lines) AND hiring email (subject + lines) -- so every tab is switchable
// and the résumé/email tabs are real destinations a candidate can reach with
// Combine still one click away.
function entryBothDocs(overrides = {}) {
  return {
    status: "done",
    result: RESUME_BODY,
    resultLines: [RESUME_BODY],
    resumePreviewHtml: `<p>${RESUME_BODY}</p>`,
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    emailSubject: "Application: Staff Engineer",
    emailResultLines: ["Hello, please find my application attached.", "Best, Alex"],
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
  probe = null;
  // Connected + configured Drive, so the "Save to Drive" egress control is
  // present too (enriches the roster; the RED comes from Combine regardless).
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.startsWith("/api/drive/status") || u.includes("/api/drive/status")) {
      return json({ connected: true, configured: true, email: "u@example.com" });
    }
    if (u.includes("/api/drive/documents")) return json({ documents: {} });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
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

async function flush(times = 8) {
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

async function openCoverPreview() {
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

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

function tabByLabel(label) {
  return [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || "").trim().startsWith(label));
}
async function switchToTab(label) {
  const t = tabByLabel(label);
  if (!t) throw new Error(`tab not rendered: ${label}`);
  await act(async () => {
    t.click();
  });
  await flush();
}
const TAB_LABEL = { resume: "Resume", cover: "Cover letter", email: "Hiring email" };

function isDisplayed(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      if (node.hasAttribute("hidden")) return false;
      const style = node.style || {};
      if (style.display === "none") return false;
      if (style.visibility === "hidden" || style.visibility === "collapse") return false;
      const computed = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(node) : null;
      if (computed && (computed.display === "none" || computed.visibility === "hidden")) return false;
    }
    node = node.parentNode;
  }
  return !!el;
}

// --- The five egress matchers, over a DOM root. Each returns the element or null.
const EGRESS = {
  download: (r) => [...r.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Download .docx") || null,
  driveSave: (r) => r.querySelector("#drive-save-control-label"),
  driveDownload: (r) => [...r.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Download from Drive")) || null,
  copy: (r) => [...r.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("Copy text of the")) || null,
  combine: (r) => [...r.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Download combined")) || null,
};
const EGRESS_NAMES = Object.keys(EGRESS);

// Which present egress controls can carry the COVER letter's facts out from `tab`.
// Combine builds from the cover lines and a Drive download serves the saved cover,
// so both carry them from ANY tab; the per-scope controls carry them only from the
// cover tab (they act on the active scope).
function coverFactEgressFrom(root, tab) {
  const present = EGRESS_NAMES.filter((name) => !!EGRESS[name](root));
  return present.filter((name) => {
    if (name === "combine" || name === "driveDownload") return true;
    return tab === "cover";
  });
}

function stripHeading(r = document) {
  return [...r.querySelectorAll("*")].find((n) => (n.textContent || "").trim() === "Added from research") || null;
}
function stripVisible(r = document) {
  const h = stripHeading(r);
  return !!h && isDisplayed(h);
}
// The invariant, as a pure predicate so the canary exercises the SAME logic the
// live census does: a violation is "facts exist and a cover-fact egress is
// reachable, but the strip is not visible".
function coVisibilityViolation(root, tab, factsExist) {
  if (!factsExist) return false;
  const egress = coverFactEgressFrom(root, tab);
  return egress.length > 0 && !stripVisible(root);
}
function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}

// ---------------------------------------------------------------------------
// Canary FIRST -- prove the instrument discriminates before believing anything
// it says about the real dialog (loop-tdd: a sweep needs its own canary). This
// also PINS that a NEW egress control added on a strip-less tab is caught: the
// predicate keys on "any cover-fact egress present while the strip is absent",
// independent of which egress it is, so a future sixth surface trips it too.
// ---------------------------------------------------------------------------
describe("the co-visibility census discriminates (canary)", () => {
  it("all five egress matchers match a fabricated control of their kind (matchers are live)", () => {
    const box = document.createElement("div");
    box.innerHTML = [
      '<button>Download .docx</button>',
      '<button id="drive-save-control-label">Save to Drive</button>',
      '<button>Download from Drive</button>',
      '<button aria-label="Copy text of the cover letter">Copy text</button>',
      '<button>Download combined</button>',
    ].join("");
    document.body.appendChild(box);
    for (const name of EGRESS_NAMES) {
      expect(EGRESS[name](box), `matcher '${name}' is dead`).toBeTruthy();
    }
    box.remove();
  });

  it("a fabricated egress button with NO strip is a violation; adding the strip clears it", () => {
    const box = document.createElement("div");
    // A NEW egress surface, invented for this canary (a plain button labelled
    // like Combine) -- not one of the production controls.
    box.innerHTML = '<button>Download combined</button>';
    document.body.appendChild(box);
    expect(coverFactEgressFrom(box, "resume"), "the matcher did not see the fabricated egress").toContain("combine");
    expect(coVisibilityViolation(box, "resume", true), "an egress with no strip was not flagged").toBe(true);

    // Add the strip heading -> no longer a violation.
    const strip = document.createElement("div");
    strip.textContent = "Added from research";
    box.appendChild(strip);
    expect(stripVisible(box)).toBe(true);
    expect(coVisibilityViolation(box, "resume", true), "the strip is present yet still flagged").toBe(false);
    box.remove();
  });

  it("a strip hidden with display:none still counts as a violation (co-render is not co-visible)", () => {
    const box = document.createElement("div");
    box.innerHTML = '<button>Download combined</button><div style="display:none">Added from research</div>';
    document.body.appendChild(box);
    // The strip is in the DOM (co-rendered) but not visible -- exactly the
    // distinction the checker demanded. Must still be a violation.
    expect(stripHeading(box), "fabricated strip node missing").toBeTruthy();
    expect(stripVisible(box), "a display:none strip counted as visible").toBe(false);
    expect(coVisibilityViolation(box, "resume", true)).toBe(true);
    box.remove();
  });

  it("no egress present -> no violation even without a strip (the census is not trivially always-true)", () => {
    const box = document.createElement("div");
    box.innerHTML = "<button>Close</button>";
    document.body.appendChild(box);
    expect(coverFactEgressFrom(box, "resume")).toHaveLength(0);
    expect(coVisibilityViolation(box, "resume", true)).toBe(false);
    box.remove();
  });
});

// ---------------------------------------------------------------------------
// The roster -- enumerate the five egress surfaces and confirm there is no sixth.
// ---------------------------------------------------------------------------
describe("egress roster: exactly the five known cover-letter egress surfaces exist", () => {
  it("on the cover tab, the three always-on egress controls are present on the real dialog", async () => {
    await mount({ [JOB_ID]: entryBothDocs() });
    await openCoverPreview();
    await insertFactViaAccept();
    // download, copy, combine are deterministic here (both docx scopes
    // available). The two Drive controls depend on live Drive state (save needs a
    // resolved connection; download needs a stored reference) -- environment-
    // dependent, so their matchers are proven live against fabricated nodes in
    // the canary above rather than asserted present here.
    for (const name of ["download", "copy", "combine"]) {
      expect(EGRESS[name](document), `egress matcher '${name}' matched no real control on the cover tab`).toBeTruthy();
    }
  });

  it("no SIXTH egress surface: every byte-emitting control on the cover tab is one of the five", async () => {
    await mount({ [JOB_ID]: entryBothDocs() });
    await openCoverPreview();
    await insertFactViaAccept();
    // Every action-bar / drive / copy / combine control whose label carries
    // egress vocabulary (download / save … to drive / copy / combined) must be
    // accounted for by one of the five matchers. A new surface with the same
    // vocabulary but unrecognised by the roster would be caught here; a surface
    // with wholly new vocabulary is caught by the co-visibility invariant below
    // (strip on every tab), which does not depend on the roster.
    const EGRESS_VOCAB = /download|save.*drive|drive.*save|copy text|combined/i;
    const suspects = [...document.querySelectorAll("button")].filter((b) => {
      const label = `${b.textContent || ""} ${b.getAttribute("aria-label") || ""}`;
      return EGRESS_VOCAB.test(label);
    });
    expect(suspects.length, "no egress-vocabulary controls found -- roster canary is dead").toBeGreaterThan(0);
    const accounted = new Set();
    for (const name of EGRESS_NAMES) {
      const el = EGRESS[name](document);
      if (el) accounted.add(el);
    }
    const unaccounted = suspects.filter((b) => !accounted.has(b));
    expect(
      unaccounted.map((b) => (b.textContent || b.getAttribute("aria-label") || "").trim()),
      "an egress-vocabulary control is not one of the five known surfaces -- a sixth surface exists",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The binding: co-visibility on every tab. RED on HEAD for résumé and email.
// ---------------------------------------------------------------------------
describe("N61: the strip is co-visible wherever a cover-fact egress is reachable (AC-N61.21)", () => {
  for (const scope of SCOPES) {
    it(`from the ${scope} tab: a cover-fact egress is reachable, so the strip must be visible there`, async () => {
      await mount({ [JOB_ID]: entryBothDocs() });
      await openCoverPreview();
      await insertFactViaAccept();

      // Non-vacuity: the fact really exists, and (on cover) the strip is the
      // baseline present.
      expect(removeButtons().length, "fact never inserted -- census would be vacuous").toBeGreaterThanOrEqual(1);

      await switchToTab(TAB_LABEL[scope]);
      expect(tabByLabel(TAB_LABEL[scope]).getAttribute("aria-selected"), `did not switch to the ${scope} tab`).toBe("true");

      // Non-vacuity: from this tab, a cover-fact egress really IS reachable
      // (Combine at minimum) -- so the strip's absence here would be a real leak.
      const egress = coverFactEgressFrom(document, scope);
      expect(egress, `no cover-fact egress reachable from the ${scope} tab -- nothing to protect, test vacuous`).toContain("combine");

      // THE PROPERTY (RED on HEAD for résumé + email): the strip is co-VISIBLE.
      expect(
        coVisibilityViolation(document, scope, true),
        `a cover-fact egress (${egress.join(", ")}) is reachable from the ${scope} tab but the review strip is not visible -- facts can egress unreviewed`,
      ).toBe(false);
    });
  }

  it("CONTROL: with NO facts, the strip is absent on every tab (strip is not hardwired on)", async () => {
    // Distinguishes "strip whenever facts" from "strip always" -- a census that
    // stayed green against an always-on strip would measure nothing.
    await mount({ [JOB_ID]: entryBothDocs() });
    await openCoverPreview();
    for (const scope of SCOPES) {
      await switchToTab(TAB_LABEL[scope]);
      expect(stripVisible(document), `the strip is visible with no facts on the ${scope} tab -- hardwired on`).toBe(false);
    }
  });
});
