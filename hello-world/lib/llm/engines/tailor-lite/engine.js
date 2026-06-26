// The embedded, deterministic (no-LLM, no-network) résumé + cover-letter engine.
// Implements the same in-process interface as geminiEngine / externalEngine
// ({ name, isConfigured, getProposals, tailorResume, tailorCoverLetter }) so the
// existing engine registry can swap it in behind RESUME_ENGINE=embedded with no
// other app changes. It mirrors the external Resume Tailor API's data shapes
// (slots, keywords, report, docx_b64) so the UI stays backend-agnostic.

import { getDefaultTemplateBuffer } from "./defaultTemplate.js";
import { getCoverLetterTemplateBuffer } from "./coverLetterTemplate.js";
import {
  loadDocx,
  scanPlaceholders,
  fillDocx,
  documentLines,
  serializeDocx,
} from "./docxModel.js";
import { extractKeywords } from "./keywords.js";
import { mapSlots } from "./strategy.js";
import profile from "./data/profile.json";
import library from "./data/content_library.json";

export const ENGINE_VERSION = "tailor-lite-0.1.0";

const DATA = { profile, library };

// Scan a template, extract keywords, and map each placeholder to a strategy +
// proposed value. Shared by getProposals and the render path.
async function buildProposal(buffer, posting) {
  const doc = await loadDocx(buffer);
  const rawSlots = scanPlaceholders(doc);
  const keywords = extractKeywords(posting);
  const slots = mapSlots(rawSlots, keywords, DATA);
  return { doc, slots, keywords };
}

// Resolve final values and fill a template. `overrides` map slot keys
// (NAME::occurrence) to text; `seedByName` provides a per-name fallback used
// when a slot is otherwise empty (e.g. TARGET_ROLE from the job title). An empty
// final value leaves the {{placeholder}} visible and counts as unfilled.
async function render(buffer, posting, { overrides = {}, seedByName = {} } = {}) {
  const { doc, slots, keywords } = await buildProposal(buffer, posting);

  const finalValues = {};
  const unfilled = [];
  const reportSlots = slots.map((slot) => {
    const overridden = Object.prototype.hasOwnProperty.call(overrides, slot.key);
    let value = overridden ? String(overrides[slot.key] ?? "") : slot.value;
    let source = overridden ? "overridden" : slot.value ? "proposed" : "unfilled";
    if (
      value.trim().length === 0 &&
      Object.prototype.hasOwnProperty.call(seedByName, slot.name)
    ) {
      value = String(seedByName[slot.name] ?? "");
      if (value.trim().length > 0) source = "proposed";
    }
    if (value.trim().length === 0) unfilled.push(slot.key);
    else finalValues[slot.key] = value;
    return { ...slot, final_value: value, source };
  });

  fillDocx(doc, finalValues);
  return {
    docxB64: await serializeDocx(doc),
    resultLines: documentLines(doc),
    reportSlots,
    unfilled,
    keywords,
  };
}

function buildReport(reportSlots, unfilled, keywords, extraMeta = {}) {
  return {
    engine_version: ENGINE_VERSION,
    workflow: "legacy",
    slots: reportSlots,
    unfilled,
    keywords,
    meta: { renderer: "local", workflow: "legacy", ...extraMeta },
  };
}

export const embeddedEngine = {
  name: "embedded",

  // Always available — there is nothing to configure.
  isConfigured() {
    return true;
  },

  // Review data: every résumé placeholder slot with a proposed value, plus
  // keywords.
  async getProposals({ jobPosting }) {
    const posting = String(jobPosting || "").trim();
    if (!posting) throw new Error("A job posting is required for the embedded engine.");
    const { slots, keywords } = await buildProposal(await getDefaultTemplateBuffer(), posting);
    return {
      engine_version: ENGINE_VERSION,
      workflow: "legacy",
      slots,
      keywords,
      warnings: [],
      degraded: false,
    };
  },

  // Tailored résumé .docx (base64) plus a report. `values` overrides slots by
  // key; an empty value leaves the {{placeholder}} visible (counts as unfilled).
  async tailorResume({ jobPosting, values }) {
    const posting = String(jobPosting || "").trim();
    if (!posting) throw new Error("A job posting is required for the embedded engine.");
    const overrides = values && typeof values === "object" ? values : {};
    const { docxB64, resultLines, reportSlots, unfilled, keywords } = await render(
      await getDefaultTemplateBuffer(),
      posting,
      { overrides },
    );

    return {
      engine: "embedded",
      result: resultLines.join("\n"),
      resultLines,
      jobTitle: "",
      companyName: "",
      docxB64,
      report: buildReport(reportSlots, unfilled, keywords),
      warnings: [],
      degraded: false,
    };
  },

  // Tailored cover-letter .docx (base64) plus a report. Fills the bundled
  // cover-letter template from the profile + posting keywords; the target role
  // and organization are seeded from the job title / company (with neutral
  // fallbacks so the letter never shows a raw placeholder). `values` overrides
  // any slot by key.
  async tailorCoverLetter({ jobPosting, jobTitle, companyName, values }) {
    const posting = String(jobPosting || "").trim();
    const overrides = values && typeof values === "object" ? values : {};
    // Seed the role/org from the posting, and provide neutral fallbacks for the
    // keyword-join slots so an unmatched category never leaves a raw {{...}}.
    const seedByName = {
      TARGET_ROLE: String(jobTitle || "").trim() || "the role",
      TARGET_ORGANIZATION: String(companyName || "").trim() || "your organization",
      JOB_RELEVANT_TECHNOLOGIES: "modern web and enterprise technologies",
      LEADERSHIP_CAPABILITIES: "technical leadership and cross-functional collaboration",
      DELIVERY_PRACTICES: "Agile delivery",
    };
    const { docxB64, resultLines, reportSlots, unfilled, keywords } = await render(
      await getCoverLetterTemplateBuffer(),
      posting,
      { overrides, seedByName },
    );

    return {
      engine: "embedded",
      result: resultLines.join("\n"),
      resultLines,
      jobTitle: String(jobTitle || ""),
      companyName: String(companyName || ""),
      docxB64,
      report: buildReport(reportSlots, unfilled, keywords, { document: "cover_letter" }),
      warnings: [],
      degraded: false,
    };
  },
};
