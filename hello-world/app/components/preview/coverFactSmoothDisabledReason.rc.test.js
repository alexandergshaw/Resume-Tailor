// @vitest-environment jsdom
//
// N94 (the N92 Wave 3 "8b" UX note) -- the Smooth control disabled on the
// embedded (no-LLM) engine used to carry no reason at all: a bare greyed icon
// that reads as broken rather than unavailable. It now follows the app's own
// established idiom for a control the embedded engine cannot offer, ChatPanel's
// N102 "Answer as me" switch: a VISIBLE note in the surface plus an
// aria-describedby on the disabled control pointing at it -- never a Tooltip
// (the strip's own comment: MUI's Tooltip can steal a control's accessible name,
// and each icon's aria-label IS the reachability contract the other tests key on).
//
// Asserted two ways: against InsertedFactsStrip directly (every prop wired by the
// test), and through the REAL DocumentPreviewMount on the embedded engine -- the
// production call site that actually decides `smoothDisabled` -- so a reason that
// exists in the strip but is never reachable from the app cannot pass.
//
// Not vacuous: the reason is asserted ABSENT when the control is enabled (so a
// build that always renders the note fails), the aria-label is asserted unchanged
// (so a reason that clobbered the name fails), and the describedby id must resolve
// to a real element carrying text.
//
// jsdom note: MUI Dialog portals into document.body -> queries go through
// document.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import InsertedFactsStrip from "@/app/components/preview/InsertedFactsStrip.js";
import { useCompanyResearch } from "@/app/hooks/useCompanyResearch.js";
import { useDocumentPreview } from "@/app/hooks/useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const SMOOTH_LABEL = "Smooth the transition into this fact";

const FACT_A = "Acme just opened a Dublin telemetry lab.";
const FACT_B = "Acme also hired forty engineers.";
const BODY_A = `I led the platform team. ${FACT_A} We shipped quickly.`;
const BODY_B = `I also built the tooling. ${FACT_B} It scaled well.`;

function factRecord(id, text, lineIndex, line) {
  return { id, text, lineIndex, offset: line.indexOf(text), url: `https://news.example.com/${id}`, title: `Source for ${id}` };
}

function twoFactEntry() {
  const lines = ["Dear Hiring Manager,", BODY_A, BODY_B, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "",
    coverVersionId: "ver-1",
    insertedFacts: [factRecord("art-a", FACT_A, 1, lines[1]), factRecord("art-b", FACT_B, 2, lines[2])],
  };
}

let probe;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function Probe({ engine }) {
  const [tailoringMap, setTailoringMap] = useState({ [JOB_ID]: twoFactEntry() });
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
  probe = { preview };
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research,
    chat: { askAiAbout: () => {} },
    tailorEngine: engine,
    previewReloadKey,
    scrapePreviewPosting: null,
    currentUser: null,
    resumeFile: null,
    coverLetterFile: null,
  });
}

beforeEach(() => {
  probe = null;
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) return json({ facts: [], removed: [], revision: null });
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

async function renderInto(element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await flush();
}

async function mountPreview(engine) {
  await renderInto(createElement(Probe, { engine }));
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

const smoothButtons = () => [...document.querySelectorAll(`[aria-label="${SMOOTH_LABEL}"]`)];

// The reason a control exposes through aria-describedby: the text of every
// element its idrefs resolve to ("" when it names none that exist).
function describedText(button) {
  const ids = (button.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
}

const REASON_PATTERN = /AI engine/i;
const GUIDANCE_PATTERN = /Gemini/i;

function stripFacts() {
  const e = twoFactEntry();
  return e.insertedFacts;
}

describe("InsertedFactsStrip: a Smooth control disabled for the embedded engine carries its reason", () => {
  it("every disabled Smooth control is described by a visible note naming the AI engine and what to do", async () => {
    await renderInto(createElement(InsertedFactsStrip, { facts: stripFacts(), smoothDisabled: true, movability: {} }));

    const buttons = smoothButtons();
    expect(buttons.length, "no Smooth control rendered -- the test is vacuous").toBe(2);
    for (const button of buttons) {
      expect(button.disabled, "the Smooth control is not disabled -- the premise changed").toBe(true);
      const reason = describedText(button);
      expect(reason, "a disabled Smooth control exposes no accessible reason (aria-describedby is missing or dangling)").not.toBe("");
      expect(reason).toMatch(REASON_PATTERN);
      expect(reason, "the reason must say what to do, as ChatPanel's does").toMatch(GUIDANCE_PATTERN);
    }
  });

  it("the reason is VISIBLE text, rendered once for the strip (not hover-only, not one per row)", async () => {
    await renderInto(createElement(InsertedFactsStrip, { facts: stripFacts(), smoothDisabled: true, movability: {} }));

    const ids = new Set(smoothButtons().map((b) => b.getAttribute("aria-describedby")));
    expect(ids.size, "the rows point at different notes -- expected one shared note").toBe(1);
    const note = document.getElementById([...ids][0]);
    expect(note, "the describedby id resolves to nothing").toBeTruthy();
    expect(note.hidden, "the note is hidden").toBe(false);
    expect(document.body.textContent.match(/AI engine/gi)?.length, "the reason text is not rendered exactly once").toBe(1);
  });

  it("does NOT replace the control's accessible name (aria-label) with the reason", async () => {
    await renderInto(createElement(InsertedFactsStrip, { facts: stripFacts(), smoothDisabled: true, movability: {} }));
    for (const button of smoothButtons()) {
      expect(button.getAttribute("aria-label"), "the reason replaced the control's accessible name").toBe(SMOOTH_LABEL);
    }
  });

  it("CONTROL: an enabled Smooth control carries no reason, and the strip renders no note", async () => {
    await renderInto(createElement(InsertedFactsStrip, { facts: stripFacts(), smoothDisabled: false, movability: {} }));

    expect(smoothButtons().length).toBe(2);
    for (const button of smoothButtons()) {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-describedby"), "an enabled Smooth control claims a reason it does not have").toBeNull();
    }
    expect(document.body.textContent, "the strip shows a reason while nothing is disabled").not.toMatch(REASON_PATTERN);
  });
});

describe("through the real mount: the embedded engine's Smooth control exposes the reason", () => {
  it("on the embedded engine the disabled Smooth control is accessibly described", async () => {
    await mountPreview("embedded");

    expect(smoothButtons().length, "the Smooth control must still render (disabled), so its reason can").toBe(2);
    for (const button of smoothButtons()) {
      expect(button.disabled).toBe(true);
      const reason = describedText(button);
      expect(reason, "the production mount passes smoothDisabled but the disabled control exposes no reason").toMatch(REASON_PATTERN);
      expect(reason).toMatch(GUIDANCE_PATTERN);
    }
  });

  it("CONTROL: on the AI engine the Smooth control is enabled and carries no reason", async () => {
    await mountPreview("gemini");

    expect(smoothButtons().length).toBe(2);
    for (const button of smoothButtons()) {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-describedby")).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(REASON_PATTERN);
  });
});
