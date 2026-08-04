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
import { candidateUniverse } from "./universe.js";
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
    // The user's persisted "template" edits (recurring hand-edits promoted to the
    // library); applied at render alongside any client-sent request rules.
    editRules: Array.isArray(bundle.editRules) ? bundle.editRules : [],
    // Named personas: profile-reframing identities selectable per posting.
    personas: Array.isArray(bundle.personas) ? bundle.personas : [],
  };
}

// Merge two edit-rule lists into one, de-duplicated by the exact (case-sensitive)
// before->after pair — so a rule persisted in the library AND still sent from the
// client's local overlay is applied once, not twice.
export function mergeEditRules(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const r of list || []) {
      if (!r || typeof r.before !== "string" || typeof r.after !== "string" || r.before.length === 0) continue;
      const key = `${r.before}→${r.after}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ before: r.before, after: r.after });
    }
  }
  return out;
}

// Apply a saved persona to the data, merging its profile values and teaching subjects
// into the base profile. The persona's values override the profile's; teaching subjects
// are replaced when the persona provides them (empty list in persona means use base).
export function applyPersona(data, personaName) {
  const name = String(personaName || "").trim().toLowerCase();
  if (!name) return { data, persona: null };
  const persona = (data.personas || []).find((p) => String(p.name || "").toLowerCase() === name);
  if (!persona) return { data, persona: null };
  const values = { ...(data.profile?.values || {}), ...(persona.values || {}) };
  const subjects =
    Array.isArray(persona.default_teaching_subjects) && persona.default_teaching_subjects.length
      ? persona.default_teaching_subjects
      : data.profile?.default_teaching_subjects || [];
  return {
    data: {
      ...data,
      profile: { ...data.profile, values, default_teaching_subjects: subjects },
    },
    persona,
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

// Engineering / technical-domain vocabulary. A posting that names any of this is a
// technical role even when it's leadership-heavy — an "engineering manager" whose
// tech shows up as architecture/cloud/CI rather than raw languages — so it must NOT
// be treated as non-technical just because few bare technology tokens were tagged.
const TECH_DOMAIN_RE =
  /\b(software|engineer(?:s|ing)?|developer|programm(?:ing|er)|architect(?:ure)?|cloud|devops|kubernetes|docker|database|back-?end|front-?end|full-?stack|microservices|cyber ?security|data (?:science|engineering|scientist)|machine learning|artificial intelligence|web development|coding)\b/i;

// A posting reads as non-technical when there's NO engineering/technical-domain
// signal, the technical taxonomy barely fires, and there's real leadership /
// people / process signal — a culture-change director, program manager, or
// consultant, not a software role. `posting` is optional (the keyword-only form is
// kept for callers that don't have the text); when given, the domain guard runs.
// Deterministic — reads only the extracted keywords and the posting text.
export function isNonTechnicalPosting(keywords, posting = "") {
  if (TECH_DOMAIN_RE.test(String(posting || ""))) return false;
  const sum = (cat) => (keywords?.[cat] || []).reduce((n, k) => n + (k.score || 0), 0);
  const technical = sum("technology") + sum("tool_platform");
  const human = sum("soft_skill") + sum("methodology") + sum("domain");
  return technical <= 2 && human >= 4;
}

// Whether a focus area is "non-technical": curated with domain/leadership content
// but no tech stack, which makes the résumé's technical line lead with domain
// capabilities (see strategy.js) instead of the candidate's technologies.
function isNonTechnicalArea(area) {
  const nonEmpty = (v) => Array.isArray(v) && v.some((s) => typeof s === "string" && s.trim());
  return !!area && !nonEmpty(area.technical_capabilities) && nonEmpty(area.domain_capabilities);
}

// Guidance (never a silent document change) when a non-technical posting is being
// tailored with a technical — or no — focus, so the user knows how to stop the
// résumé leading with an irrelevant tech stack.
function nonTechnicalWarning(keywords, resolvedArea, posting = "") {
  if (!isNonTechnicalPosting(keywords, posting) || isNonTechnicalArea(resolvedArea)) return [];
  return [
    "This role reads as non-technical. Use the focus picker to pin (or create) a focus area with its technical capabilities left empty — the résumé and cover letter then lead with leadership and domain expertise instead of your tech stack.",
  ];
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
  // document-wide after slot filling, so lines and .docx stay in lockstep. Rules
  // persisted in the library (data.editRules) are the durable, cross-device
  // template edits; the request rules are the client's not-yet-persisted overlay.
  const allEditRules = mergeEditRules(data.editRules, editRules);
  const appliedEdits = allEditRules.length > 0 ? applyTextEdits(proposal.doc, allEditRules) : [];
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

// --- Hiring email (deterministic, template-free) ---------------------------
// The email is short plain text with a subject line, never a filled .docx —
// it must never go through the scanPlaceholders/fillDocx template pipeline
// the résumé and cover letter use above. This section assembles it directly
// from the posting and the user's own library.

// A few of the posting's requirements that the candidate's own library
// (skill_groups.json, via candidateUniverse) can genuinely back up — the
// intersection of what the posting asks for and what the candidate's
// universe actually contains, so the email never claims a capability the
// library doesn't support (AC-5: no fabrication).
export function topMatchingCapabilities(posting, data, limit = 3) {
  const { keywords } = resolveKeywords(posting, data);
  const universe = candidateUniverse(data.skillGroups, data.taxonomy);
  const seen = new Set();
  const flat = [];
  for (const category of Object.keys(keywords)) {
    if (category === "topic") continue; // RAKE-lite phrases are advisory only, not claimed skills
    for (const kw of keywords[category]) {
      const key = kw.canonical.toLowerCase();
      if (!universe.has(key) || seen.has(key)) continue;
      seen.add(key);
      flat.push(kw);
    }
  }
  flat.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  return flat.slice(0, limit).map((kw) => kw.canonical);
}

// Prose list joiner: "A", "A and B", "A, B, and C".
function joinWithAnd(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Assemble the subject + a handful of short paragraphs from the role/company,
// the posting-matched capabilities above, and the profile's headline values
// (name, current title/function, tenure) — no LLM, no template, deterministic
// for a given library + posting.
export function buildHiringEmailText({ role, organization, capabilities, profile }) {
  const values = profile?.values || {};
  const name = String(values.FULL_NAME || "").trim();
  const currentEmployer = String(values.CURRENT_EMPLOYER || "").trim();
  const primaryFunction = String(values.PRIMARY_FUNCTION || "").trim();
  const years = String(values.YEARS_OF_EXPERIENCE || "").trim();

  const roleLabel = role || "this role";
  const orgLabel = organization || "your team";
  const subject = `Application for ${role || "the open role"}${organization ? ` at ${organization}` : ""}`;

  const introParts = [primaryFunction ? `I'm a ${primaryFunction.toLowerCase()}` : "I'm writing"];
  if (years) introParts.push(`with ${years} years of experience`);
  if (currentEmployer) introParts.push(`currently at ${currentEmployer}`);

  // Addressed to a hiring committee, matching this repo's cover-letter
  // convention (see lib/document/coverLetterWeave.test.js) — the salutation
  // is always its own first line, never merged into the intro sentence.
  const bodyLines = [
    "Dear Hiring Committee,",
    `${introParts.join(" ")}, and I'm excited to apply for the ${roleLabel} role at ${orgLabel}.`,
  ];
  if (capabilities.length > 0) {
    bodyLines.push(
      `My background includes hands-on work with ${joinWithAnd(capabilities)}, which lines up closely with what this role calls for.`,
    );
  }
  bodyLines.push(
    `I've attached my résumé and cover letter for more detail, and I'd welcome the chance to talk about how I can contribute to ${orgLabel}.`,
  );
  // Sign-off is two lines when a name exists ("Best regards," then the name
  // on its own line); with no name, just the bare "Best regards," line.
  bodyLines.push("Best regards,");
  if (name) bodyLines.push(name);

  return { subject, bodyLines };
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

  async tailorResume({ jobPosting, jobPostingUrl, values, aggressiveness, userId, steeringInstructions, editRules, focusArea, keywordEdits, persona }) {
    const { text: posting, meta: scrapedMeta } = await resolvePostingText({ jobPosting, jobPostingUrl });
    const overrides = values && typeof values === "object" ? values : {};
    const baseData = toData(await loadLibrary({ userId }));
    const { data: pdata, persona: appliedPersona } = applyPersona(baseData, persona);
    const steered = resolveSteering(steeringInstructions, pdata.taxonomy, aggressiveness);
    const kwEdits = resolveKeywordEdits(keywordEdits, pdata.taxonomy);
    const effectiveFocus = focusArea && focusArea.trim() ? focusArea : appliedPersona?.focus_area || "";
    const r = await render(await getDefaultTemplateBuffer(), posting, {
      overrides,
      aggressiveness: steered.aggressiveness,
      data: pdata,
      steering: mergeDirectives(steered.steering, kwEdits),
      editRules: Array.isArray(editRules) ? editRules : [],
      focusAreaName: effectiveFocus,
      excludeCanonicals: kwEdits.excludeCanonicals,
    });
    const edits = editRuleOutputs(r.appliedEdits);
    const focus = focusOutputs(effectiveFocus, r.focusArea);
    // Advisory research is excluded from the document — report only.
    const advisory = resolveAdvisory({ posting, company: "", data: pdata });
    // Best-effort title/company so the saved file is named after the posting
    // ("<Company> - <Position> - Resume.docx") instead of falling back to a
    // generic default.
    const meta = postingMetaFor(posting, scrapedMeta);
    // How much of the posting's vocabulary the generated document actually
    // covers (report-only; drives the library-update prompt downstream).
    const match = computeMatch(posting, r.resultLines.join("\n"), pdata.taxonomy);

    const extraMeta = { ...steered.meta, ...edits.meta, ...focus.meta, ...kwEdits.meta };
    if (appliedPersona) extraMeta.persona = { name: appliedPersona.name };

    const report = buildReport({
      workflow: getWorkflow(),
      reportSlots: r.reportSlots,
      unfilled: r.unfilled,
      keywords: r.keywords,
      advisory,
      extraMeta,
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
      warnings: [
        ...steered.warnings,
        ...edits.warnings,
        ...focus.warnings,
        ...kwEdits.warnings,
        ...nonTechnicalWarning(r.keywords, r.focusArea, posting),
      ],
      degraded: false,
    };
  },

  // `tailoredResume` (the freshly tailored résumé, added for the Gemini-only
  // "ground the cover letter in the tailored résumé" feature) is accepted here
  // too via the options object but intentionally left out of the destructure —
  // this engine builds cover letters deterministically from the library and
  // posting, not from freeform résumé text, so the value is simply ignored.
  async tailorCoverLetter({ jobPosting, jobPostingUrl, jobTitle, companyName, values, aggressiveness, userId, steeringInstructions, editRules, focusArea, keywordEdits, coverVariant: requestedVariant, persona }) {
    const { text: posting, meta: scrapedMeta } = await resolvePostingText({ jobPosting, jobPostingUrl }, { required: false });
    const overrides = values && typeof values === "object" ? values : {};
    const baseData = toData(await loadLibrary({ userId }));
    const { data: pdata, persona: appliedPersona } = applyPersona(baseData, persona);
    const steered = resolveSteering(steeringInstructions, pdata.taxonomy, aggressiveness);
    const kwEdits = resolveKeywordEdits(keywordEdits, pdata.taxonomy);
    // Fall back to title/company from the scrape (URL) or parsed from the posting
    // when the caller didn't supply them (e.g. the manual paste flow), so the cover
    // letter is addressed correctly and its file is named like the résumé.
    const meta = postingMetaFor(posting, scrapedMeta);
    const role = cleanPostingTitle(String(jobTitle || "").trim()) || meta.jobTitle;
    const organization = String(companyName || "").trim() || meta.companyName;
    // Composed: structured facts from the Researcher; otherwise neutral fallbacks
    // so a slot never shows raw braces.
    const facts = resolveCoverFacts({ posting, company: organization, data: pdata });
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
    // industry toggle) wins outright; otherwise persona's cover_variant provides a
    // default, then teaching roles keep the adjunct letter, a non-technical
    // (leadership / change / consulting) role gets the leadership rewrite, staff
    // roles at higher-ed institutions get the campus-service variant, and
    // everything else gets the industry rewrite. Non-technical is checked before
    // staff so a non-technical role at a campus (e.g. a culture-change director)
    // gets leadership framing, not campus-service.
    const VALID_VARIANTS = ["teaching", "staff", "industry", "nontechnical"];
    const override = VALID_VARIANTS.includes(requestedVariant) ? requestedVariant : "";
    const detectedVariant = isTeachingPosting(posting)
      ? "teaching"
      : isNonTechnicalPosting(extractKeywords(posting, pdata.taxonomy), posting)
        ? "nontechnical"
        : isHigherEdPosting(posting)
          ? "staff"
          : "industry";
    const coverVariant = override || appliedPersona?.cover_variant || detectedVariant;
    const coverVariantSource = override ? "override" : appliedPersona?.cover_variant ? "persona" : "auto";
    const effectiveFocus = focusArea && focusArea.trim() ? focusArea : appliedPersona?.focus_area || "";
    const r = await render(await getCoverLetterTemplateBuffer({ variant: coverVariant }), posting, {
      overrides,
      seedByName,
      aggressiveness: steered.aggressiveness,
      maxKeywords: 4, // keep capability lists keyword-rich but not a wall
      serialAnd: true, // prose lists read "A, B, and C", not "A, B, C"
      data: pdata,
      steering: mergeDirectives(steered.steering, kwEdits),
      editRules: Array.isArray(editRules) ? editRules : [],
      focusAreaName: effectiveFocus,
      excludeCanonicals: kwEdits.excludeCanonicals,
    });
    const edits = editRuleOutputs(r.appliedEdits);
    const focus = focusOutputs(effectiveFocus, r.focusArea);

    const extraMeta = {
      document: "cover_letter",
      coverVariant,
      coverVariantSource,
      coverVariantDetected: detectedVariant,
      ...steered.meta,
      ...edits.meta,
      ...focus.meta,
      ...kwEdits.meta,
    };
    if (appliedPersona) extraMeta.persona = { name: appliedPersona.name };

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
          extraMeta,
        });
        // Cover letters are prose, not keyword walls — the score naturally runs
        // lower than the résumé's; the combined response uses the weakest doc.
        report.match = computeMatch(posting, r.resultLines.join("\n"), pdata.taxonomy);
        return report;
      })(),
      warnings: [...steered.warnings, ...edits.warnings, ...focus.warnings, ...kwEdits.warnings],
      degraded: false,
    };
  },

  // Deterministic hiring-email generation: no LLM, and — unlike tailorResume/
  // tailorCoverLetter above — no docx template pipeline at all (see the
  // "Hiring email" section above buildHiringEmailText). A short plain-text
  // note assembled from the role/company, the overlap between the posting
  // and the candidate's own library capabilities, and the profile's headline
  // values. `tailoredResume` is accepted here too (interface parity with the
  // Gemini engine, which grounds its email in the freshly tailored résumé
  // text) but intentionally left out of the destructure and ignored, exactly
  // like tailorCoverLetter above: this path draws from the library and
  // posting, not freeform résumé text.
  async tailorHiringEmail({ jobPosting, jobPostingUrl, jobTitle, companyName, userId, persona }) {
    const { text: posting, meta: scrapedMeta } = await resolvePostingText({ jobPosting, jobPostingUrl }, { required: false });
    const baseData = toData(await loadLibrary({ userId }));
    const { data: pdata } = applyPersona(baseData, persona);
    const meta = postingMetaFor(posting, scrapedMeta);
    const role = cleanPostingTitle(String(jobTitle || "").trim()) || meta.jobTitle;
    const organization = String(companyName || "").trim() || meta.companyName;
    const capabilities = topMatchingCapabilities(posting, pdata);
    const { subject, bodyLines } = buildHiringEmailText({ role, organization, capabilities, profile: pdata.profile });

    return { engine: "embedded", subject, bodyLines };
  },
};
