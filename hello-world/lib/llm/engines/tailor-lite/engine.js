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
  applyTextEdits,
  documentLines,
  serializeDocx,
} from "./docxModel.js";
import { extractKeywords, canonicalize, categorize } from "./keywords.js";
import { mapSlotsDetailed } from "./strategy.js";
import { parsePosting } from "./parser.js";
import { research } from "./researcher.js";
import { parseSteering, applySteering, steerAggressiveness } from "./steering.js";
import { computeMatch } from "./matchReport.js";
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
// Weak signals split in two tiers. CORE terms describe the act of teaching;
// SUPPORT terms (students, courses) are ambient in EVERY higher-ed posting —
// a university web-specialist role "serving a diverse population of students"
// with a degree in "a course of study related to the field" is staff, not
// faculty. Weak detection therefore requires at least one CORE hit; support
// terms only corroborate.
const TEACHING_WEAK_CORE_RES = [
  /\bteach(?:es|ing)?\b/i,
  /\bcoursework\b/i,
  /\bclassroom\b/i,
  /\bsemester\b/i,
  /\blearners?\b/i,
  /\blectures?\b/i,
];
const TEACHING_WEAK_SUPPORT_RES = [
  /\bstudents?\b/i,
  /\bstudent body\b/i,
  /\bcourses?\b/i,
];
export function isTeachingPosting(posting) {
  const text = String(posting || "");
  if (!text.trim()) return false;
  if (TEACHING_STRONG_RE.test(text)) return true;
  let coreHits = 0;
  for (const re of TEACHING_WEAK_CORE_RES) if (re.test(text)) coreHits += 1;
  if (coreHits === 0) return false;
  let supportHits = 0;
  for (const re of TEACHING_WEAK_SUPPORT_RES) if (re.test(text)) supportHits += 1;
  return coreHits + supportHits >= 2;
}

// A higher-education employer (university/college staff context) — used to pick
// the campus-staff cover letter framing for non-teaching roles at institutions.
// Requires two distinct signals so "college degree required" alone in a
// corporate posting doesn't flip it.
const HIGHERED_SIGNAL_RES = [
  /\buniversit\w+\b/i,
  /\bcampus\b/i,
  /\bhigher education\b/i,
  /\bfaculty\b/i,
  /\bprovost\b/i,
  /\bacademic (?:affairs|programs|departments?)\b/i,
  /\bstudent affairs\b/i,
  /\bcommunity college\b/i,
];
export function isHigherEdPosting(posting) {
  const text = String(posting || "");
  if (!text.trim()) return false;
  let hits = 0;
  for (const re of HIGHERED_SIGNAL_RES) {
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
async function buildProposal(buffer, posting, aggressiveness, maxKeywords, serialAnd, data = DEFAULT_DATA, steering = null, focusAreaName = "", excludeCanonicals = null) {
  const doc = await loadDocx(buffer);
  const rawSlots = scanPlaceholders(doc);
  const kw = resolveKeywords(posting, data);
  // Steering (the preview's "revise" box) and buzzword toggles boost/remove
  // canonicals before slot mapping, so "emphasize React" actually changes what
  // the document leads with.
  const keywords = steering?.hasDirectives ? applySteering(kw.keywords, steering) : kw.keywords;
  const mapped = mapSlotsDetailed(rawSlots, keywords, data, {
    aggressiveness,
    maxKeywords,
    serialAnd,
    posting,
    focusAreaName,
    excludeCanonicals,
  });
  return { doc, slots: mapped.slots, keywords, emphases: kw.emphases, focusArea: mapped.focusArea };
}

// Resolve final values and fill a template. `overrides` map slot keys to text;
// `seedByName` provides a per-name fallback used when a slot is otherwise empty.
// `maxKeywords` caps comma-joined capability lists (the cover letter reads better
// with shorter lists than the résumé). An empty final value leaves the
// {{placeholder}} visible (counts as unfilled).
async function render(buffer, posting, { overrides = {}, seedByName = {}, aggressiveness, maxKeywords, serialAnd, data = DEFAULT_DATA, steering = null, editRules = [], focusAreaName = "", excludeCanonicals = null } = {}) {
  const proposal = await buildProposal(buffer, posting, aggressiveness, maxKeywords, serialAnd, data, steering, focusAreaName, excludeCanonicals);
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
  // Promoted recurring hand-edits — the user's "effective template" — applied
  // document-wide after slot filling, so lines and .docx stay in lockstep.
  const appliedEdits = editRules.length > 0 ? applyTextEdits(proposal.doc, editRules) : [];
  return {
    docxB64: await serializeDocx(proposal.doc),
    resultLines: documentLines(proposal.doc),
    reportSlots,
    unfilled,
    keywords: proposal.keywords,
    emphases: proposal.emphases,
    appliedEdits,
    focusArea: proposal.focusArea,
  };
}

// Focus-selection payloads for the report/warnings: which area drove the
// tailoring, whether the user pinned it, and an honest warning when a pinned
// name isn't in the library (auto-detection was used instead).
function focusOutputs(requestedName, chosenArea) {
  const requested = String(requestedName || "").trim();
  const chosen = chosenArea?.name || null;
  const overrideApplied = !!(requested && chosen && chosen.toLowerCase() === requested.toLowerCase());
  const meta = {
    focus: {
      name: chosen,
      source: overrideApplied ? "override" : chosen ? "auto" : "none",
      ...(requested ? { requested } : {}),
    },
  };
  const warnings =
    requested && !overrideApplied
      ? [`Focus area "${requested}" isn't in your library — auto-detection was used instead.`]
      : [];
  return { meta, warnings };
}

// Applied-edit-rule payloads for the report/warnings, so automatic rewrites
// are always visible rather than silent.
function editRuleOutputs(appliedEdits) {
  if (!appliedEdits || appliedEdits.length === 0) return { meta: {}, warnings: [] };
  const shown = appliedEdits
    .slice(0, 3)
    .map((r) => `"${r.before}" → ${r.after ? `"${r.after}"` : "(removed)"}`)
    .join(", ");
  const more = appliedEdits.length > 3 ? ` (+${appliedEdits.length - 3} more)` : "";
  return {
    meta: { editRules: { applied: appliedEdits.map((r) => ({ before: r.before, after: r.after })) } },
    warnings: [`Applied your recurring edit${appliedEdits.length === 1 ? "" : "s"}: ${shown}${more}.`],
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

// Resolve the previewer's buzzword toggles into steering-shaped directives plus
// the exclusion set for focus-area lists. Boosts need a taxonomy category to be
// applicable (the mapper ranks by category), so unknown boost names warn
// honestly; exclusions work for any name — they filter by canonical (alias-
// aware) or raw match.
function resolveKeywordEdits(keywordEdits, taxonomy) {
  const boostNames = Array.isArray(keywordEdits?.boost) ? keywordEdits.boost : [];
  const excludeNames = Array.isArray(keywordEdits?.exclude) ? keywordEdits.exclude : [];
  if (boostNames.length === 0 && excludeNames.length === 0) {
    return { emphasize: [], avoid: [], excludeCanonicals: null, warnings: [], meta: {} };
  }

  const emphasize = [];
  const unknown = [];
  for (const raw of boostNames) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const canonical = canonicalize(name, taxonomy);
    const category = canonical ? categorize(name, taxonomy) : null;
    if (canonical && category) emphasize.push({ canonical, category });
    else unknown.push(name);
  }

  const avoid = [];
  const excludeCanonicals = new Set();
  for (const raw of excludeNames) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const canonical = canonicalize(name, taxonomy) || name;
    avoid.push({ canonical });
    excludeCanonicals.add(canonical.toLowerCase());
    excludeCanonicals.add(name.toLowerCase());
  }

  const warnings = unknown.length
    ? [
        `Can't emphasize ${unknown.map((n) => `"${n}"`).join(", ")} — not in your library's taxonomy. Scan the posting or add ${unknown.length === 1 ? "it" : "them"} in /library first.`,
      ]
    : [];
  const applied = emphasize.length > 0 || avoid.length > 0;
  return {
    emphasize,
    avoid,
    excludeCanonicals: excludeCanonicals.size > 0 ? excludeCanonicals : null,
    warnings,
    meta: applied
      ? {
          keywordEdits: {
            boosted: emphasize.map((e) => e.canonical),
            excluded: [...new Set(avoid.map((a) => a.canonical))],
          },
        }
      : {},
  };
}

// Fold the buzzword toggles into the (possibly null) parsed steering so both
// ride the same applySteering pass; an exclusion beats a boost of the same term.
function mergeDirectives(steering, kwEdits) {
  if (kwEdits.emphasize.length === 0 && kwEdits.avoid.length === 0) return steering;
  const base = steering || { emphasize: [], avoid: [], aggressivenessDelta: 0, hasDirectives: false };
  const avoid = [...base.avoid, ...kwEdits.avoid];
  const avoided = new Set(avoid.map((t) => t.canonical.toLowerCase()));
  const emphasize = [...base.emphasize, ...kwEdits.emphasize].filter(
    (t) => !avoided.has(t.canonical.toLowerCase()),
  );
  return { ...base, emphasize, avoid, hasDirectives: true };
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

  async tailorResume({ jobPosting, jobPostingUrl, values, aggressiveness, userId, steeringInstructions, editRules, focusArea, keywordEdits }) {
    const { text: posting, meta: scrapedMeta } = await resolvePostingText({ jobPosting, jobPostingUrl });
    const overrides = values && typeof values === "object" ? values : {};
    const data = toData(await loadLibrary({ userId }));
    const steered = resolveSteering(steeringInstructions, data.taxonomy, aggressiveness);
    const kwEdits = resolveKeywordEdits(keywordEdits, data.taxonomy);
    const r = await render(await getDefaultTemplateBuffer(), posting, {
      overrides,
      aggressiveness: steered.aggressiveness,
      data,
      steering: mergeDirectives(steered.steering, kwEdits),
      editRules: Array.isArray(editRules) ? editRules : [],
      focusAreaName: focusArea,
      excludeCanonicals: kwEdits.excludeCanonicals,
    });
    const edits = editRuleOutputs(r.appliedEdits);
    const focus = focusOutputs(focusArea, r.focusArea);
    // Advisory research is excluded from the document — report only.
    const advisory = resolveAdvisory({ posting, company: "", data });
    // Best-effort title/company so the saved file is named after the posting
    // ("<Company> - <Position> - Resume.docx") instead of falling back to a
    // generic default.
    const meta = postingMetaFor(posting, scrapedMeta);
    // How much of the posting's vocabulary the generated document actually
    // covers (report-only; drives the library-update prompt downstream).
    const match = computeMatch(posting, r.resultLines.join("\n"), data.taxonomy);

    const report = buildReport({
      workflow: getWorkflow(),
      reportSlots: r.reportSlots,
      unfilled: r.unfilled,
      keywords: r.keywords,
      advisory,
      extraMeta: { ...steered.meta, ...edits.meta, ...focus.meta, ...kwEdits.meta },
    });
    report.match = match;

    return {
      engine: "embedded",
      result: r.resultLines.join("\n"),
      resultLines: r.resultLines,
      jobTitle: meta.jobTitle,
      companyName: meta.companyName,
      docxB64: r.docxB64,
      report,
      warnings: [...steered.warnings, ...edits.warnings, ...focus.warnings, ...kwEdits.warnings],
      degraded: false,
    };
  },

  async tailorCoverLetter({ jobPosting, jobPostingUrl, jobTitle, companyName, values, aggressiveness, userId, steeringInstructions, editRules, focusArea, keywordEdits, coverVariant: requestedVariant }) {
    const { text: posting, meta: scrapedMeta } = await resolvePostingText({ jobPosting, jobPostingUrl }, { required: false });
    const overrides = values && typeof values === "object" ? values : {};
    const data = toData(await loadLibrary({ userId }));
    const steered = resolveSteering(steeringInstructions, data.taxonomy, aggressiveness);
    const kwEdits = resolveKeywordEdits(keywordEdits, data.taxonomy);
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
    // Pick the letter framing: a user override (the previewer's teaching/staff/
    // industry toggle) wins outright; otherwise teaching roles keep the adjunct
    // letter, staff roles at higher-ed institutions get the campus-service
    // variant, and everything else gets the industry rewrite.
    const VALID_VARIANTS = ["teaching", "staff", "industry"];
    const override = VALID_VARIANTS.includes(requestedVariant) ? requestedVariant : "";
    const detectedVariant = isTeachingPosting(posting)
      ? "teaching"
      : isHigherEdPosting(posting)
        ? "staff"
        : "industry";
    const coverVariant = override || detectedVariant;
    const coverVariantSource = override ? "override" : "auto";
    const r = await render(await getCoverLetterTemplateBuffer({ variant: coverVariant }), posting, {
      overrides,
      seedByName,
      aggressiveness: steered.aggressiveness,
      maxKeywords: 4, // keep capability lists keyword-rich but not a wall
      serialAnd: true, // prose lists read "A, B, and C", not "A, B, C"
      data,
      steering: mergeDirectives(steered.steering, kwEdits),
      editRules: Array.isArray(editRules) ? editRules : [],
      focusAreaName: focusArea,
      excludeCanonicals: kwEdits.excludeCanonicals,
    });
    const edits = editRuleOutputs(r.appliedEdits);
    const focus = focusOutputs(focusArea, r.focusArea);

    return {
      engine: "embedded",
      result: r.resultLines.join("\n"),
      resultLines: r.resultLines,
      jobTitle: role,
      companyName: organization,
      docxB64: r.docxB64,
      report: (() => {
        const report = buildReport({
          workflow: getWorkflow(),
          reportSlots: r.reportSlots,
          unfilled: r.unfilled,
          keywords: r.keywords,
          extraMeta: {
            document: "cover_letter",
            coverVariant,
            coverVariantSource,
            coverVariantDetected: detectedVariant,
            ...steered.meta,
            ...edits.meta,
            ...focus.meta,
            ...kwEdits.meta,
          },
        });
        // Cover letters are prose, not keyword walls — the score naturally runs
        // lower than the résumé's; the combined response uses the weakest doc.
        report.match = computeMatch(posting, r.resultLines.join("\n"), data.taxonomy);
        return report;
      })(),
      warnings: [...steered.warnings, ...edits.warnings, ...focus.warnings, ...kwEdits.warnings],
      degraded: false,
    };
  },
};
