// The embedded, deterministic résumé + cover-letter engine. Implements the same
// in-process interface as geminiEngine / externalEngine so the registry can swap
// it in behind RESUME_ENGINE=embedded.
//
// Two workflows (RESUME_TAILOR_WORKFLOW): "legacy" (default) is fully local — no
// network, byte-deterministic. "composed" swaps ONLY Step 2 (keyword extraction)
// for the external Parser and adds the Researcher, mapping both back into the
// same local Keyword model / fill core — so strict adherence is preserved:
//   - Parser keywords map to {canonical,category,score}; fill core is unchanged.
//   - Researcher is quarantined: ADVISORY ONLY for résumés (report.advisory,
//     never the .docx, so the document is byte-identical research-on/off), and
//     STRUCTURED FACTS only for cover letters (ORGANIZATION_CONTEXT / ROLE_FOCUS).
// Every external call falls back to the local path (flagging `degraded`), so the
// deterministic core is never blocked by a downstream outage.

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
import { fetchParserKeywords } from "./parser.js";
import { fetchResearch } from "./researcher.js";
import profile from "./data/profile.json";
import library from "./data/content_library.json";
import skillGroups from "./data/skill_groups.json";

export const ENGINE_VERSION = "tailor-lite-0.1.0";

const DATA = { profile, library, skillGroups };

function getWorkflow() {
  return (process.env.RESUME_TAILOR_WORKFLOW || "legacy").trim().toLowerCase();
}

// Keywords for the posting. Legacy: local taxonomy extraction. Composed: the
// Parser, mapped to the local Keyword model — falling back to local (degraded)
// if the Parser is unconfigured or unreachable.
async function resolveKeywords(posting) {
  if (getWorkflow() !== "composed") {
    return { keywords: extractKeywords(posting), emphases: [], degraded: false, warnings: [] };
  }
  try {
    const parsed = await fetchParserKeywords(posting);
    if (parsed) return { keywords: parsed.keywords, emphases: parsed.emphases, degraded: false, warnings: [] };
    return {
      keywords: extractKeywords(posting),
      emphases: [],
      degraded: true,
      warnings: ["Parser not configured; used local keyword extraction."],
    };
  } catch (err) {
    return {
      keywords: extractKeywords(posting),
      emphases: [],
      degraded: true,
      warnings: [`Parser unavailable (${err?.message || "error"}); used local keyword extraction.`],
    };
  }
}

// Researcher overview/news for the résumé — ADVISORY ONLY, never inserted.
async function resolveAdvisory({ posting, emphases, company }) {
  if (getWorkflow() !== "composed") return null;
  try {
    const research = await fetchResearch({ posting, emphases, company });
    return research ? research.advisory : null;
  } catch {
    return null;
  }
}

// Researcher structured facts for the cover letter (industry / essential skills).
async function resolveCoverFacts({ posting, company }) {
  if (getWorkflow() !== "composed") return {};
  try {
    const research = await fetchResearch({ posting, company });
    return research ? research.facts : {};
  } catch {
    return {};
  }
}

// Scan a template, resolve keywords (legacy/composed), map placeholders.
async function buildProposal(buffer, posting) {
  const doc = await loadDocx(buffer);
  const rawSlots = scanPlaceholders(doc);
  const kw = await resolveKeywords(posting);
  const slots = mapSlots(rawSlots, kw.keywords, DATA);
  return { doc, slots, keywords: kw.keywords, emphases: kw.emphases, degraded: kw.degraded, warnings: kw.warnings };
}

// Resolve final values and fill a template. `overrides` map slot keys to text;
// `seedByName` provides a per-name fallback used when a slot is otherwise empty.
// An empty final value leaves the {{placeholder}} visible (counts as unfilled).
async function render(buffer, posting, { overrides = {}, seedByName = {} } = {}) {
  const proposal = await buildProposal(buffer, posting);
  const finalValues = {};
  const unfilled = [];
  const reportSlots = proposal.slots.map((slot) => {
    const overridden = Object.prototype.hasOwnProperty.call(overrides, slot.key);
    let value = overridden ? String(overrides[slot.key] ?? "") : slot.value;
    let source = overridden ? "overridden" : slot.value ? "proposed" : "unfilled";
    if (value.trim().length === 0 && Object.prototype.hasOwnProperty.call(seedByName, slot.name)) {
      value = String(seedByName[slot.name] ?? "");
      if (value.trim().length > 0) source = "proposed";
    }
    if (value.trim().length === 0) unfilled.push(slot.key);
    else finalValues[slot.key] = value;
    return { ...slot, final_value: value, source };
  });

  fillDocx(proposal.doc, finalValues);
  return {
    docxB64: await serializeDocx(proposal.doc),
    resultLines: documentLines(proposal.doc),
    reportSlots,
    unfilled,
    keywords: proposal.keywords,
    emphases: proposal.emphases,
    degraded: proposal.degraded,
    warnings: proposal.warnings,
  };
}

function buildReport({ workflow, reportSlots, unfilled, keywords, advisory, extraMeta = {} }) {
  const report = {
    engine_version: ENGINE_VERSION,
    workflow,
    slots: reportSlots,
    unfilled,
    keywords,
    meta: { renderer: "local", workflow, ...extraMeta },
  };
  if (advisory) report.advisory = advisory;
  return report;
}

export const embeddedEngine = {
  name: "embedded",

  isConfigured() {
    return true;
  },

  async getProposals({ jobPosting }) {
    const posting = String(jobPosting || "").trim();
    if (!posting) throw new Error("A job posting is required for the embedded engine.");
    const { slots, keywords, emphases, degraded, warnings } = await buildProposal(
      await getDefaultTemplateBuffer(),
      posting,
    );
    const advisory = await resolveAdvisory({ posting, emphases, company: "" });
    const out = {
      engine_version: ENGINE_VERSION,
      workflow: getWorkflow(),
      slots,
      keywords,
      warnings,
      degraded,
    };
    if (advisory) out.advisory = advisory;
    return out;
  },

  async tailorResume({ jobPosting, values }) {
    const posting = String(jobPosting || "").trim();
    if (!posting) throw new Error("A job posting is required for the embedded engine.");
    const overrides = values && typeof values === "object" ? values : {};
    const r = await render(await getDefaultTemplateBuffer(), posting, { overrides });
    // Advisory research is excluded from the document — report only.
    const advisory = await resolveAdvisory({ posting, emphases: r.emphases, company: "" });

    return {
      engine: "embedded",
      result: r.resultLines.join("\n"),
      resultLines: r.resultLines,
      jobTitle: "",
      companyName: "",
      docxB64: r.docxB64,
      report: buildReport({
        workflow: getWorkflow(),
        reportSlots: r.reportSlots,
        unfilled: r.unfilled,
        keywords: r.keywords,
        advisory,
      }),
      warnings: r.warnings,
      degraded: r.degraded,
    };
  },

  async tailorCoverLetter({ jobPosting, jobTitle, companyName, values }) {
    const posting = String(jobPosting || "").trim();
    const overrides = values && typeof values === "object" ? values : {};
    // Composed: structured facts from the Researcher; otherwise neutral fallbacks
    // so a slot never shows raw braces.
    const facts = await resolveCoverFacts({ posting, company: companyName });
    const seedByName = {
      TARGET_ROLE: String(jobTitle || "").trim() || "the role",
      TARGET_ORGANIZATION: String(companyName || "").trim() || "your organization",
      ORGANIZATION_CONTEXT: facts.ORGANIZATION_CONTEXT || "your organization's work",
      ROLE_FOCUS: facts.ROLE_FOCUS || "the priorities in your posting",
      JOB_RELEVANT_TECHNOLOGIES: "modern web and enterprise technologies",
      LEADERSHIP_CAPABILITIES: "technical leadership and cross-functional collaboration",
      DELIVERY_PRACTICES: "Agile delivery",
    };
    const r = await render(await getCoverLetterTemplateBuffer(), posting, { overrides, seedByName });

    return {
      engine: "embedded",
      result: r.resultLines.join("\n"),
      resultLines: r.resultLines,
      jobTitle: String(jobTitle || ""),
      companyName: String(companyName || ""),
      docxB64: r.docxB64,
      report: buildReport({
        workflow: getWorkflow(),
        reportSlots: r.reportSlots,
        unfilled: r.unfilled,
        keywords: r.keywords,
        extraMeta: { document: "cover_letter" },
      }),
      warnings: r.warnings,
      degraded: r.degraded,
    };
  },
};
