// @vitest-environment jsdom
//
// N61 (LIVE DEFECT, blocker) -- CO-VISIBILITY FROM THE RESUME TAB, reached the
// way a candidate reaches it: mount the REAL DocumentPreviewMount (rendering the
// REAL DocumentPreviewDialog + REAL InsertedFactsStrip), insert facts into the
// cover letter through the REAL accept path, then SWITCH TO THE RESUME TAB and
// require that the review strip is still present and each fact still removable
// from there. removeInsertedFact is NEVER called directly; the strip is driven
// render-and-click, because a source scan cannot prove a user can reach the
// control and this repo has twice shipped a surface a scan certified and no user
// could reach (loop-tdd rule 2/5).
//
// THE DEFECT (DocumentPreviewMount.js ~:101-102 on HEAD):
//   const insertedFactsStrip =
//     activeScope === "cover" && insertedFacts.length > 0 ? <InsertedFactsStrip.../> : null;
// The strip is gated on the ACTIVE TAB. But the Combine control (an egress that
// builds an employer-bound document FROM THE COVER LETTER'S LINES) is reachable
// from EVERY tab. So a candidate with facts in the letter can switch to the
// resume tab -- where the strip is gone -- and ship those facts with no review
// surface visible. OWNER RULING: the strip renders whenever there are inserted
// facts, ON ANY TAB. These tests fail RED on HEAD because the strip is absent on
// the resume tab; the reference (drop the `activeScope === "cover"` conjunct)
// turns them green.
//
// jsdom note: MUI's Dialog portals into document.body, so every DOM query goes
// through `document`. jsdom does no layout, so "visible" here means "rendered
// and not display:none / visibility:hidden / [hidden] on itself or an ancestor"
// -- pixel visibility cannot be asserted in jsdom and is called out in the
// report, not faked (loop-tdd jsdom rule).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "../hooks/useCompanyResearch.js";
import { useDocumentPreview } from "../hooks/useDocumentPreview.js";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
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
// Three coalescing facts for the chained-removal case. Distinct full sentences,
// none a substring of another (loop-tdd "reconstructing fixture" trap): a
// mis-cut span cannot coincidentally reconstruct a survivor.
const FA = { id: "art-a", text: "Acme just opened a Dublin telemetry lab.", url: "https://news.example.com/acme/dublin", title: "Dublin lab", placement: "intro" };
const FB = { id: "art-b", text: "The firm doubled its research headcount last year.", url: "https://news.example.com/acme/headcount", title: "Headcount", placement: "intro" };
const FC = { id: "art-c", text: "Its platform now serves nine million active users.", url: "https://news.example.com/acme/platform", title: "Platform", placement: "intro" };

// A resume body so the RESUME scope is available (previewScopeAvailable keys on
// a non-empty `result`) -- the tab a candidate can switch to. resumePreviewHtml
// is supplied so the resume view renders without a docx parse (ensureLoaded
// prefers scopes[scope].html); irrelevant to the strip, which is scope-agnostic.
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

// BOTH documents present: resume (via `result`) AND cover letter (via the engine
// bytes/lines), so the resume tab is switchable and "Combine" is offered.
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
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
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

// Insert facts through the REAL accept path (all "intro" placement -> coalesce
// onto one paragraph in a single accept).
async function insertFactsViaAccept(facts) {
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
  await act(async () => {
    await probe.research.acceptFacts({ facts, declinedUrls: [] });
  });
  await flush();
}

function tabByLabel(label) {
  return [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || "").trim().startsWith(label));
}

// Switch to the résumé tab the way a candidate clicks it, then settle.
async function switchToResumeTab() {
  const resumeTab = tabByLabel("Resume");
  if (!resumeTab) throw new Error("résumé tab not rendered -- fixture does not have a résumé");
  await act(async () => {
    resumeTab.click();
  });
  await flush();
}

// True iff `el` is present and neither it nor any ancestor up to <body> is
// display:none / visibility:hidden / [hidden]. jsdom has no layout, so this is
// the strongest "visible" available here -- it does catch a fix that mounts the
// strip on the résumé tab but hides it with a style, which is exactly the
// "hidden-but-mounted node" the brief asks be excluded.
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

function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}
function stripHeading() {
  return [...document.querySelectorAll("*")].find((n) => (n.textContent || "").trim() === "Added from research");
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function storedRecord() {
  return probe.tailoringMap[JOB_ID]?.insertedFacts || [];
}
function coalescedLine() {
  return coverLines().find((l) => l.includes(FA.text) || l.includes(FB.text) || l.includes(FC.text)) || "";
}
function readabilitySeam(line) {
  return /\s{2,}|\s[.,;:!?]|^\s|\s$/.test(String(line));
}
function anySeam() {
  return coverLines().some((l) => readabilitySeam(l));
}

// Click the Remove control at strip position `i`, then wait for the removal
// (which awaits a real docx (de)serialize) to settle.
async function clickRemoveAt(i = 0) {
  await flush();
  const before = removeButtons().length;
  await act(async () => {
    removeButtons()[i].click();
  });
  for (let n = 0; n < 25; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (removeButtons().length !== before) break;
  }
  await flush();
}

describe("instrument sanity (canaries)", () => {
  it("isDisplayed clears a plain node and bites a hidden one", () => {
    const shown = document.createElement("div");
    document.body.appendChild(shown);
    expect(isDisplayed(shown)).toBe(true);
    const hiddenWrap = document.createElement("div");
    hiddenWrap.style.display = "none";
    const child = document.createElement("span");
    hiddenWrap.appendChild(child);
    document.body.appendChild(hiddenWrap);
    expect(isDisplayed(child), "isDisplayed did not see an ancestor's display:none").toBe(false);
    shown.remove();
    hiddenWrap.remove();
  });
  it("the readability-seam detector bites malformed prose and clears clean prose", () => {
    expect(readabilitySeam("A team.  Beyond that .")).toBe(true);
    expect(readabilitySeam("A perfectly ordinary sentence about work.")).toBe(false);
  });
});

describe("N61 co-visibility: the review strip is present on the RÉSUMÉ tab (AC-N61.21)", () => {
  it("with facts in the letter, switching to the résumé tab still shows the strip and each fact is removable there", async () => {
    await mount({ [JOB_ID]: entryBothDocs() });
    await openCoverPreview();
    await insertFactsViaAccept([FACT]);

    // Non-vacuity #1: the fact really landed in the download-rebuild source, and
    // the strip is present WHILE STILL on the cover tab (baseline).
    expect(coverLines().join("\n"), "fact never inserted -- co-visibility test would be vacuous").toContain(FACT.text);
    expect(removeButtons().length, "strip not rendered on the cover tab -- baseline broken").toBe(1);

    // Switch to the résumé tab, and PROVE the switch happened (else the whole
    // test is vacuous -- loop-tdd non-vacuity requirement).
    await switchToResumeTab();
    expect(tabByLabel("Resume").getAttribute("aria-selected"), "the résumé tab did not become selected").toBe("true");
    expect(tabByLabel("Cover letter").getAttribute("aria-selected"), "the cover tab is still selected -- tab never switched").toBe("false");
    expect(document.body.textContent, "résumé body not shown -- the tab did not actually switch content").toContain("telemetry platforms");

    // THE PROPERTY (RED on HEAD): the strip and its one-click Remove control are
    // present AND displayed (not a hidden-but-mounted node) from the résumé tab.
    const heading = stripHeading();
    expect(heading, "the 'Added from research' strip is absent on the résumé tab").toBeTruthy();
    expect(isDisplayed(heading), "the strip is mounted but hidden on the résumé tab").toBe(true);
    expect(removeButtons().length, "no Remove control on the résumé tab -- a fact can egress unreviewed").toBe(1);
    expect(isDisplayed(removeButtons()[0]), "the Remove control is mounted but hidden on the résumé tab").toBe(true);

    // And it actually WORKS from here: one click removes the fact from the
    // download-rebuild source (not merely from the on-screen text).
    window.confirm = () => {
      throw new Error("removal must not open a confirmation dialog");
    };
    await clickRemoveAt(0);
    expect(coverLines().join("\n"), "removal from the résumé tab did not change the cover letter").not.toContain(FACT.text);
    expect(removeButtons().length, "the removed fact's row is still on screen").toBe(0);
  });

  it("CONTROL: with NO facts, the strip is absent on the résumé tab (the strip is not hardwired on)", async () => {
    // Distinguishes "strip whenever facts exist" from "strip always" (loop-tdd:
    // a test that stays green when the mechanism is hardwired on measures
    // nothing). This is GREEN on HEAD and must stay green after the fix.
    await mount({ [JOB_ID]: entryBothDocs() });
    await openCoverPreview();
    await switchToResumeTab();
    expect(tabByLabel("Resume").getAttribute("aria-selected")).toBe("true");
    expect(storedRecord().length, "an inserted fact leaked into the no-facts control").toBe(0);
    expect(stripHeading(), "the strip rendered with no facts -- it is hardwired on").toBeFalsy();
    expect(removeButtons().length).toBe(0);
  });
});

describe("N61 co-visibility: chained removal from the RÉSUMÉ tab preserves survivors (AC-N61.14/.16/.21)", () => {
  it("two chained removals from the résumé tab both take, the third stays intact and located", async () => {
    await mount({ [JOB_ID]: entryBothDocs() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);

    // Non-vacuity: three coalesced facts really landed on one paragraph.
    const line = coalescedLine();
    expect(line, "FA not on the coalesced line").toContain(FA.text);
    expect(line, "FB not on the coalesced line").toContain(FB.text);
    expect(line, "FC not on the coalesced line").toContain(FC.text);
    expect(removeButtons().length, "three facts did not produce three rows -- fixture broke").toBe(3);

    // Move to the résumé tab and prove the switch (else chained-removal-from-the-
    // other-tab is vacuous).
    await switchToResumeTab();
    expect(tabByLabel("Resume").getAttribute("aria-selected"), "résumé tab not selected -- chain would be vacuous").toBe("true");
    expect(removeButtons().length, "no strip on the résumé tab -- the chain cannot even start").toBe(3);

    window.confirm = () => {
      throw new Error("removal must not open a confirmation dialog");
    };

    // First removal (front): FA leaves, FB and FC survive.
    await clickRemoveAt(0);
    expect(coalescedLine(), "FA was not removed").not.toContain(FA.text);
    expect(coalescedLine(), "FB vanished when only FA was removed").toContain(FB.text);
    expect(coalescedLine(), "FC vanished when only FA was removed").toContain(FC.text);
    expect(removeButtons().length, "second Remove control not reachable -- the chain is vacuous").toBe(2);

    // Second removal (the NEW front, FB): the stranding bug shipped once was
    // order-dependent and only surfaced when chained. FB must actually leave and
    // FC must remain, whole and correctly located.
    await clickRemoveAt(0);
    expect(coalescedLine(), "FB is STILL in the download-rebuild source -- stranded survivor").not.toContain(FB.text);
    expect(coalescedLine(), "FC vanished when FB was removed").toContain(FC.text);
    expect(removeButtons().length, "FB's row did not leave the strip").toBe(1);

    // The stranded survivor's stored record still locates its own text (the
    // class invariant, over the survivor, not just the removed fact).
    const surv = storedRecord();
    expect(surv.map((r) => r.id)).toEqual([FC.id]);
    const survLine = coverLines()[surv[0].lineIndex];
    expect(
      String(survLine ?? "").slice(surv[0].offset, surv[0].offset + surv[0].text.length),
      "survivor FC's stored offset is stale after two résumé-tab removals",
    ).toBe(FC.text);
    expect(anySeam(), "chained removal left a readability seam").toBe(false);
  });
});
