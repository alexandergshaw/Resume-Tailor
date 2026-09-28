// @vitest-environment jsdom
//
// N56 half (b), the REACHABILITY leg (AC-8): a splice refusal, driven by a
// real click on the real accept control, must not tell the candidate their
// saved file is missing when it is not. Today the hook maps EVERY unapplied
// splice to `NO_ENGINE_BYTES_REASON` (useCompanyResearch.js:375-378), so a
// letter whose bytes are present but whose paragraph text has drifted out of
// the docx is refused with a confidently wrong cause and a remedy
// ("regenerate the cover letter") that would destroy the only thing that could
// fix it.
//
// WHY not-found AND NOT the two-card same-paragraph case (PL-7 / AC-8 note).
// The two-card same-paragraph refusal (R2 `stale-plan`) is the defect half (a)
// REMOVES. A guard driven through it would pass, then vacuum the moment half
// (a) lands. So this drives R3 `not-found`, which persists after (a): a
// paragraph present in `coverLetterResultLines` but absent from the engine
// docx (a hand-edited letter, template drift). The refusal is durable; the
// honesty requirement on it is durable.
//
// REACHABILITY: articles arrive through the real `/api/company-research`
// fetch, the card is ticked as the dialog pre-selects it, and the accept is a
// real click on the real "Insert into cover letter" control -- never a direct
// `research.acceptFacts(...)` call. jsdom note: MUI's Dialog portals to
// document.body, never the mount container.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// A paragraph that is DEFINITELY not in the engine document, and long enough
// (>40 chars) to be chosen as the intro target by `introIndex`.
const ABSENT_PARAGRAPH =
  "This entire paragraph was typed by hand and appears nowhere in the generated cover letter document at all.";

const ARTICLE = {
  id: "art-seed",
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "Acme Newsroom",
  date: "2026-02-01",
  summary: "Acme did a thing.",
  suggestion: "Acme's new Dublin telemetry lab is exactly the work I want to do.",
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
let researchQueue = [];
let putBodies = [];
let research = null;
let container = null;
let root = null;
let acceptPromise = null;
let lastSelection = null;
let initialEntry = null;
const EMPTY = [];

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  const r = research.researchByJob[JOB_ID] || {};
  return createElement(CompanyResearchDialog, {
    open: research.companyResearch.open,
    company: research.companyResearch.company,
    needsCompany: !!r.needsCompany,
    loading: !!r.loading,
    error: r.error || "",
    articles: r.articles || EMPTY,
    warnings: r.warnings || EMPTY,
    busy: !!research.companyResearch.busy,
    acceptError: research.companyResearch.acceptError || "",
    acceptNotice: research.companyResearch.acceptNotice || "",
    coverLetterLines: tailoringMap[JOB_ID]?.coverLetterResultLines || EMPTY,
    onClose: () => research.closeCompanyResearch(),
    onApply: () => {},
    // Production binds `onAccept={research.acceptFacts}` (app/page.js). The
    // selection/promise are captured only so the test can await the async splice.
    onAccept: (selection) => {
      lastSelection = selection;
      acceptPromise = research.acceptFacts(selection);
      return acceptPromise;
    },
    onResearch: () => {},
    onAddUrl: () => {},
  });
}

function entryClean() {
  return {
    status: "done",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
  };
}

// Engine bytes PRESENT, but the intro paragraph in the text has drifted out of
// the docx -> the splice reaches `not-found`, NOT the missing-bytes pre-check
// (R1) and NOT `stale-plan` (the plan's `before` equals the current line).
function entryNotFound() {
  const lines = [...ENGINE_LINES];
  lines[1] = ABSENT_PARAGRAPH;
  return {
    status: "done",
    coverLetterResultLines: lines,
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
  };
}

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchQueue = [];
  putBodies = [];
  research = null;
  acceptPromise = null;
  lastSelection = null;
  initialEntry = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) {
      return json({ articles: researchQueue.shift() || [], warnings: [] });
    }
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision });
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

async function openSession(entry) {
  initialEntry = entry;
  researchQueue.push([ARTICLE]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry } }));
  });
  await act(async () => {
    research.openCompanyResearch(JOB);
  });
  await flush();
}

function checkboxes() {
  return [...document.querySelectorAll('input[type="checkbox"]')];
}
function acceptControl() {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Insert into cover letter");
}
function suggestionFieldValues() {
  return [...document.querySelectorAll("textarea")]
    .filter((t) => t.getAttribute("aria-hidden") !== "true")
    .map((t) => t.value);
}

async function clickAccept() {
  const button = acceptControl();
  expect(
    button,
    `no "Insert into cover letter" control; buttons were: ${[...document.querySelectorAll("button")]
      .map((b) => JSON.stringify((b.textContent || "").trim()))
      .join(", ")}`,
  ).toBeTruthy();
  expect(button.disabled).toBe(false);
  acceptPromise = null;
  lastSelection = null;
  await act(async () => {
    button.click();
  });
  expect(acceptPromise, "the accept control was clicked but no accept was started").toBeTruthy();
  await act(async () => {
    await acceptPromise;
  });
  await flush(2);
}

// ---------------------------------------------------------------------------
// Harness sanity. If any of these is red, every verdict below is an instrument
// failure, not a product finding.
// ---------------------------------------------------------------------------

describe("harness sanity", () => {
  it("the fixture is a real engine cover letter and the card really rendered", async () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
    await openSession(entryClean());
    expect(suggestionFieldValues()).toEqual([ARTICLE.suggestion]);
    expect(checkboxes().map((b) => b.checked)).toEqual([true]);
    expect(acceptControl(), "no reachable accept control on the pick screen").toBeTruthy();
  });

  it("CONTROL: the absent paragraph really is absent from the engine document", () => {
    // Without this, the `not-found` scenario below could be a `stale-plan` or a
    // success in disguise. The absent line is not one of the engine's lines.
    expect(ENGINE_LINES).not.toContain(ABSENT_PARAGRAPH);
  });
});

// ---------------------------------------------------------------------------
// AC-8 -- the refusal must not name a false cause. RED on HEAD.
// ---------------------------------------------------------------------------

describe("a splice refusal with the bytes PRESENT must not claim the file is missing (AC-8)", () => {
  it("clicking accept on a drifted letter shows an honest reason, not the missing-file copy", async () => {
    await openSession(entryNotFound());
    // Pre-check must NOT be the one firing: the bytes are present.
    expect(initialEntry.coverLetterDocxB64.length).toBeGreaterThan(100000);
    await clickAccept();

    const reason = research.companyResearch.acceptError || "";
    // It IS refused (a non-empty, rendered reason).
    expect(reason.length, "the accept was not refused at all -- wrong scenario").toBeGreaterThan(0);
    expect(document.body.textContent || "", "the reason is not rendered in the dialog").toContain(reason);
    // The dialog stays open so the candidate can act on it.
    expect(research.companyResearch.open).toBe(true);

    // THE ASSERTION (RED on HEAD): the reason must not mis-attribute the cause.
    expect(reason, "the refusal claims the saved file is missing when it is present").not.toMatch(
      /saved file is missing/i,
    );
    expect(reason, "the refusal offers 'regenerate', which would destroy the bytes the fix needs").not.toMatch(
      /regenerat/i,
    );
    // And it must name no developer internals.
    expect(reason).not.toMatch(/stale|not-found|docx|b64|base64|lineIndex|object ?Object/i);
  });

  it("CONTROL: a single-card accept on a CLEAN letter SUCCEEDS (the guard is not 'refuse everything')", async () => {
    // GREEN on HEAD and after the fix. Without it, the red above is equally
    // explained by an accept that is broken for every input.
    await openSession(entryClean());
    await clickAccept();
    expect(
      research.companyResearch.acceptError || "",
      "a clean single-card accept was refused -- the harness cannot produce a success",
    ).toBe("");
    // It really did something: a write was made and the fact reached the text.
    expect(putBodies.length).toBeGreaterThan(0);
  });
});

// WHAT THIS FILE CANNOT CATCH. It stops at the client: the route, the RPC and
// the `inserted_facts` column are not exercised (same limit
// acceptFactIdDerivation.test.js declares). It asserts the refusal reason is
// not the missing-file copy and names no internals; it does not judge whether
// the replacement sentence reads well -- that is factRefusalMessage.test.js's
// AC-12 bar over the mapping's values.
