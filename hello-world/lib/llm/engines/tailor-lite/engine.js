// The embedded, deterministic résumé + cover-letter engine. Implements the same
// in-process interface as geminiEngine / externalEngine so the registry can swap
// it in behind RESUME_ENGINE=embedded.
//
// Two workflows (RESUME_TAILOR_WORKFLOW): "legacy" (default) is plain local
// keyword extraction. "composed" runs the IN-HOUSE parser + researcher (no
// external services, no network) — both deterministic and done in this app:
//   - Parser = local taxonomy/RAKE extraction (parser.js).
//   - Researcher (researcher.js) is quarantined: ADVISORY ONLY for résumés
//     (report.advisory, never the .docx, so the document is byte-identical with
//     it present or not), and STRUCTURED FACTS only for cover letters
//     (ORGANIZATION_CONTEXT / ROLE_FOCUS), derived from the posting + company.
// Both workflows are fully deterministic and offline.

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
import { parsePosting } from "./parser.js";
import { research } from "./researcher.js";
import { parseSteering, applySteering, steerAggressiveness } from "./steering.js";
import { extractPostingMeta, cleanPostingTitle } from "../../postingMeta.js";
import { fetchUrlContent } from "../../../scrape/fetchUrlContent.js";
import { defaultLibraryData } from "./library/defaults.js";
import { loadLibrary } from "./library/loadLibrary.js";

export const ENGINE_VERSION = "tailor-lite-0.1.0";

// Map a library bundle ({ taxonomy, profile, skillGroups, contentLibrary, stopwords })
// to the `data` the strategy mapper consumes (where `library` is the content library).
// `taxonomy` + `skillGroups` ride along so keyword extraction, canonicalization, and
// the candidate universe all read from the SAME library — the bundled default here,
// or a per-user library once the loader (P2) supplies one.
function toData(bundle) {
  return {
    profile: bundle.profile,
    library: bundle.contentLibrary,
    skillGroups: bundle.skillGroups,
    taxonomy: bundle.taxonomy,
    stopwords: bundle.stopwords,
  };
}

const DEFAULT_DATA = toData(defaultLibraryData);

function getWorkflow() {
  return (process.env.RESUME_TAILOR_WORKFLOW || "legacy").trim().toLowerCase();
}

// Resolve a request to { text, meta } for the posting: use the supplied text,
// otherwise fetch it from `jobPostingUrl`. Tailoring stays deterministic and
// AI-free — only reading the posting from a URL touches the network. When fetched,
// `meta` carries the scraper's clean title/company (e.g. Workday's CXS JSON), which
// is more reliable than re-deriving them from the description text. With `required`
// (résumé / proposals) an unusable input throws; the cover letter is tolerant.
async function resolvePostingText({ jobPosting, jobPostingUrl }, { required = true } = {}) {
  const text = String(jobPosting || "").trim();
  if (text) return { text, meta: null };
  const url = String(jobPostingUrl || "").trim();
  if (!url) {
    if (required) throw new Error("A job posting (text or URL) is required for the embedded engine.");
    return { text: "", meta: null };
  }
  const scraped = await fetchUrlContent(url);
  if (scraped.error) {
    if (required) throw new Error(`Could not read the job posting from that URL: ${scraped.error}`);
    return { text: "", meta: null };
  }
  const description = String(scraped.description || "").trim();
  if (!description && required) {
    throw new Error("That URL did not contain a readable job posting. Paste the description text instead.");
  }
  return {
    text: description,
    meta: { jobTitle: String(scraped.title || "").trim(), companyName: String(scraped.company || "").trim() },
  };
}

// Best-effort title/company: prefer the scraper's structured values (a URL fetch),
// else parse them from the posting text. The title is run through cleanPostingTitle
// so board boilerplate ("Job Application for UX Engineer") never reaches the letter
// or the saved file name.
function postingMetaFor(posting, scrapedMeta) {
  const parsed = extractPostingMeta(posting);
  return {
    jobTitle: cleanPostingTitle((scrapedMeta && scrapedMeta.jobTitle) || parsed.jobTitle),
    companyName: (scrapedMeta && scrapedMeta.companyName) || parsed.companyName,
  };
}

// A posting is a teaching/academic role when it names teaching ACTIVITIES (not
// merely an academic employer — a developer/IT job at a university is still
// industry). A single strong signal (adjunct, lecturer, curriculum, …) decides it;
// otherwise two of the weaker activity signals must co-occur. Drives the cover
// letter framing (teaching vs. industry) so an industry role is not pitched as an
// adjunct-teaching application.
//
// NOTE: bare "faculty"/"students" are deliberately NOT strong signals — higher-ed
// postings for non-teaching roles routinely include "About <University>" boilerplate
// ("world-renowned faculty", "extraordinary students"), which must not flip framing.
// Only teaching-ROLE phrases ("faculty position", "teaching faculty") count.
// "coursework" is likewise NOT strong: industry postings say the candidate gained
// experience "through coursework, internships, projects", whereas teaching postings
// say they "develop coursework" — so it is only a weak (needs-corroboration) signal.
const TEACHING_STRONG_RE =
  /\b(?:adjunct|lecturer|professor|instructor|tenure[ -]?track|curriculum|syllab(?:us|i)|course materials|pedagog\w*|teaching (?:position|faculty|load)|faculty (?:position|appointment))\b/i;
const TEACHING_WEAK_RES = [
  /\bteach(?:es|ing)?\b/i,
  /\bstudents?\b/i,
  /\bstudent body\b/i,
  /\bcourses?\b/i,
  /\bcoursework\b/i,
  /\bclassroom\b/i,
  /\bsemester\b/i,
  /\blearners?\b/i,
  /\blectures?\b/i,
];
export function isTeachingPosting(posting) {
  const text = String(posting || "");
  if (!text.trim()) return false;
  if (TEACHING_STRONG_RE.test(text)) return true;
  let hits = 0;
  for (const re of TEACHING_WEAK_RES) {
    if (re.test(text)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

// Keywords for the posting. Both workflows are local; composed uses the in-house
// parser (taxonomy extraction + emphases). Deterministic, never degraded.
function resolveKeywords(posting, data) {
  if (getWorkflow() === "composed") {
    const { keywords, emphases } = parsePosting(posting, data.taxonomy);
    return { keywords, emphases };
  }
  return { keywords: extractKeywords(posting, data.taxonomy), emphases: [] };
}

// In-house researcher advisory for the résumé — ADVISORY ONLY, never inserted.
function resolveAdvisory({ posting, company, data }) {
  if (getWorkflow() !== "composed") return null;
  return research({ posting, company, taxonomy: data.taxonomy, skillGroups: data.skillGroups }).advisory;
}

// In-house researcher structured facts for the cover letter.
function resolveCoverFacts({ posting, company, data }) {
  if (getWorkflow() !== "composed") return {};
  return research({ posting, company, taxonomy: data.taxonomy, skillGroups: data.skillGroups }).facts;
}

// Scan a template, resolve keywords (legacy/composed), map placeholders.
// `aggressiveness` (1..5) drives how much gap-keyword insertion the strategy does.
async function buildProposal(buffer, posting, aggressiveness, maxKeywords, serialAnd, data = DEFAULT_DATA, steering = null) {
  const doc = await loadDocx(buffer);
  const rawSlots = scanPlaceholders(doc);
  const kw = resolveKeywords(posting, data);
  // Steering (the preview's "revise" box) boosts/removes canonicals before slot
  // mapping, so "emphasize React" actually changes what the document leads with.
  const keywords = steering?.hasDirectives ? applySteering(kw.keywords, steering) : kw.keywords;
  const slots = mapSlots(rawSlots, keywords, data, { aggressiveness, maxKeywords, serialAnd, posting });
  return { doc, slots, keywords, emphases: kw.emphases };
}

// Resolve final values and fill a template. `overrides` map slot keys to text;
// `seedByName` provides a per-name fallback used when a slot is otherwise empty.
// `maxKeywords` caps comma-joined capability lists (the cover letter reads better
// with shorter lists than the résumé). An empty final value leaves the
// {{placeholder}} visible (counts as unfilled).
async function render(buffer, posting, { overrides = {}, seedByName = {}, aggressiveness, maxKeywords, serialAnd, data = DEFAULT_DATA, steering = null } = {}) {
  const proposal = await buildProposal(buffer, posting, aggressiveness, maxKeywords, serialAnd, data, steering);
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
  };
}

// Resolve a free-text steering note into directives + the effective
// aggressiveness, plus the report/warning payloads that tell the user what the
// engine actually did with the note (or that it couldn't parse it).
function resolveSteering(steeringInstructions, taxonomy, aggressiveness) {
  const note = String(steeringInstructions || "").trim();
  if (!note) return { steering: null, aggressiveness, warnings: [], meta: {} };
  const steering = parseSteering(note, taxonomy);
  const eff = steerAggressiveness(aggressiveness, steering);
  if (!steering.hasDirectives) {
    return {
      steering: null,
      aggressiveness,
      warnings: [
        'The embedded engine applies revision notes as emphasize/avoid/aggressiveness directives, and couldn\'t find any in your note — try wording like "emphasize React", "remove Java", or "tone it down".',
      ],
      meta: {},
    };
  }
  return {
    steering,
    aggressiveness: eff,
    warnings: [],
    meta: {
      steering: {
        emphasized: steering.emphasize.map((t) => t.canonical),
        avoided: steering.avoid.map((t) => t.canonical),
        aggressiveness: eff ?? null,
      },
    },
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

  async getProposals({ jobPosting, jobPostingUrl, aggressiveness, userId }) {
    const { text: posting } = await resolvePostingText({ jobPosting, jobPostingUrl });
    const data = toData(await loadLibrary({ userId }));
    const { slots, keywords } = await buildProposal(
      await getDefaultTemplateBuffer(),
      posting,
      aggressiveness,
      undefined,
      undefined,
      data,
    );
    const advisory = resolveAdvisory({ posting, company: "", data });
    const out = {
      engine_version: ENGINE_VERSION,
      workflow: getWorkflow(),
      slots,
      keywords,
      warnings: [],
      degraded: false,
    };
    if (advisory) out.advisory = advisory;
    return out;
  },

  async tailorResume({ jobPosting, jobPostingUrl, values, aggressiveness, userId, steeringInstructions }) {
    const { text: posting, meta: scrapedMeta } = await resolvePostingText({ jobPosting, jobPostingUrl });
    const overrides = values && typeof values === "object" ? values : {};
    const data = toData(await loadLibrary({ userId }));
    const steered = resolveSteering(steeringInstructions, data.taxonomy, aggressiveness);
    const r = await render(await getDefaultTemplateBuffer(), posting, {
      overrides,
      aggressiveness: steered.aggressiveness,
      data,
      steering: steered.steering,
    });
    // Advisory research is excluded from the document — report only.
    const advisory = resolveAdvisory({ posting, company: "", data });
    // Best-effort title/company so the saved file is named after the posting
    // ("<Company> - <Position> - Resume.docx") instead of falling back to a
    // generic default.
    const meta = postingMetaFor(posting, scrapedMeta);

    return {
      engine: "embedded",
      result: r.resultLines.join("\n"),
      resultLines: r.resultLines,
      jobTitle: meta.jobTitle,
      companyName: meta.companyName,
      docxB64: r.docxB64,
      report: buildReport({
        workflow: getWorkflow(),
        reportSlots: r.reportSlots,
        unfilled: r.unfilled,
        keywords: r.keywords,
        advisory,
        extraMeta: steered.meta,
      }),
      warnings: steered.warnings,
      degraded: false,
    };
  },

  async tailorCoverLetter({ jobPosting, jobPostingUrl, jobTitle, companyName, values, aggressiveness, userId, steeringInstructions }) {
    const { text: posting, meta: scrapedMeta } = await resolvePostingText({ jobPosting, jobPostingUrl }, { required: false });
    const overrides = values && typeof values === "object" ? values : {};
    const data = toData(await loadLibrary({ userId }));
    const steered = resolveSteering(steeringInstructions, data.taxonomy, aggressiveness);
    // Fall back to title/company from the scrape (URL) or parsed from the posting
    // when the caller didn't supply them (e.g. the manual paste flow), so the cover
    // letter is addressed correctly and its file is named like the résumé.
    const meta = postingMetaFor(posting, scrapedMeta);
    const role = cleanPostingTitle(String(jobTitle || "").trim()) || meta.jobTitle;
    const organization = String(companyName || "").trim() || meta.companyName;
    // Composed: structured facts from the Researcher; otherwise neutral fallbacks
    // so a slot never shows raw braces.
    const facts = resolveCoverFacts({ posting, company: organization, data });
    const seedByName = {
      TARGET_ROLE: role || "the role",
      TARGET_ORGANIZATION: organization || "your organization",
      ORGANIZATION_CONTEXT: facts.ORGANIZATION_CONTEXT || "your organization's work",
      ROLE_FOCUS: facts.ROLE_FOCUS || "the priorities in your posting",
      JOB_RELEVANT_TECHNOLOGIES: "modern web and enterprise technologies",
      LEADERSHIP_CAPABILITIES: "technical leadership and cross-functional collaboration",
      DELIVERY_PRACTICES: "Agile delivery",
    };
    const r = await render(await getCoverLetterTemplateBuffer({ teaching: isTeachingPosting(posting) }), posting, {
      overrides,
      seedByName,
      aggressiveness: steered.aggressiveness,
      maxKeywords: 4, // keep capability lists keyword-rich but not a wall
      serialAnd: true, // prose lists read "A, B, and C", not "A, B, C"
      data,
      steering: steered.steering,
    });

    return {
      engine: "embedded",
      result: r.resultLines.join("\n"),
      resultLines: r.resultLines,
      jobTitle: role,
      companyName: organization,
      docxB64: r.docxB64,
      report: buildReport({
        workflow: getWorkflow(),
        reportSlots: r.reportSlots,
        unfilled: r.unfilled,
        keywords: r.keywords,
        extraMeta: { document: "cover_letter", ...steered.meta },
      }),
      warnings: steered.warnings,
      degraded: false,
    };
  },
};
