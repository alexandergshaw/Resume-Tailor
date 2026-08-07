// AC-N3: the worked example stops being picked from seven hand-authored
// archetypes (idealProjectNarrative.js) and is written fresh, per question,
// by the model — grounded in the actual posting instead of a stock story.
// Reported failure: "the example projects are always this shit", the same
// product story pasted back across twenty practice questions run against one
// posting. Seven templates cannot not repeat; a generator that reads the
// posting can.
//
// This module owns the two halves of that: the prompt asking the model for
// the example (`buildIdealProjectPrompt`), and the gate deciding whether its
// answer is safe to show (`normalizeIdealProject`). idealProjectNarrative.js
// — the deterministic archetype table — is untouched and stays the FALLBACK;
// the caller (app/api/copilot/answer/route.js) only ever shows what comes
// out of `normalizeIdealProject`, and falls back to the deterministic
// archetype for everything else, including a validation reject.
//
// THE SAFETY STORY MOVED, AND GOT STRICTER. R-130/R-135/R-138 kept this
// block honest by construction: idealProjectNarrative.js's every figure is a
// hand-authored constant, and `buildProject` never receives the posting text
// at all — so a posting's own salary band, headcount or experience floor
// could not reach `project` even by accident. That argument was STRUCTURAL,
// not enforced by a check, and it does not survive this change: a model that
// writes the example FROM the posting has the posting in its context, which
// is the one thing the old guarantee depended on being absent. So the
// guarantee moves from the generator to `normalizeIdealProject` below, and
// gets stricter to compensate — see that function's own comment for the
// rule that replaces it.

import {
  MAX_BODY_WORDS,
  MAX_TOTAL_WORDS,
  MIN_BODY_WORDS,
  SECTION_LABELS,
} from "./idealProjectNarrative.js";

// Mirrors app/api/copilot/answer/route.js's own MAX_POSTING_CHARS. Restated
// here rather than imported from the route (a lib module importing from a
// route file would run the wrong direction) so this module is safe to call
// with an uncapped description on its own, not only from behind the route's
// existing cap.
const MAX_POSTING_CHARS = 20000;

// Sits beside POINTS_SYSTEM/ANSWER_SYSTEM in the route, so it gets the same
// treatment: a short statement of WHAT this call is for, with every hard
// constraint (shape, invented figures, third person) carried by the prompt
// itself rather than assumed here.
export const IDEAL_PROJECT_SYSTEM = [
  "You write a single hypothetical BENCHMARK project for an interview-prep tool — a worked example of what a strong candidate for a role might describe, never a real project and never the reader's own.",
  "Return ONLY the JSON object requested — no prose outside it, no markdown code fences.",
  "Every figure you write is invented: realistic-sounding and internally consistent with the story, never copied from anything stated in the job posting you are given.",
].join(" ");

// `question` only nudges which KIND of project the example is about — the
// posting still supplies the setting, capability and methodology, exactly
// the way idealProjectNarrative.js's own slots do. An empty question must
// not break the prompt, since live mode's very first question has no prior
// context to bias toward.
function questionBiasLine(question) {
  const q = String(question || "").trim();
  if (!q) return "No specific interview question is driving the choice — pick whatever project shape best fits the posting below.";
  return `The candidate was just asked: "${q}" — let that bias which KIND of project the example is about, without inventing anything the posting itself does not support.`;
}

// Returns "" for a missing/blank posting (never throws — a caller with
// nothing to ground the example in should get nothing to send the model,
// the same "no posting selected -> no block" contract idealProject.js's own
// null return follows) and never throws on missing arguments at all, so a
// caller can wire this in without a defensive guard of its own.
export function buildIdealProjectPrompt({ description, question } = {}) {
  const posting = String(description || "").trim().slice(0, MAX_POSTING_CHARS);
  if (!posting) return "";

  const shapeLine = SECTION_LABELS.map((label) => `"${label}"`).join(", ");

  return [
    "You are writing a BENCHMARK worked example for a candidate preparing to interview for the job posting below: a hypothetical project a strong candidate for THIS role might describe, invented for the purpose — not a real project, and not the candidate's own.",
    "",
    "--- JOB POSTING ---",
    posting,
    "--- END JOB POSTING ---",
    "",
    questionBiasLine(question),
    "",
    'Return ONLY JSON of this exact shape: { "title": string, "sections": [ { "label": string, "body": string }, ... ], "outcomes": [ { "metric": string, "figure": string }, ... ] }',
    `"sections" must have exactly 4 entries, labelled in this exact order: ${shapeLine}. "${SECTION_LABELS[0]}" is what was broken before the project, "${SECTION_LABELS[1]}" is what the project built, "${SECTION_LABELS[2]}" is how the work actually ran, "${SECTION_LABELS[3]}" is the measured outcome.`,
    `Each section's "body" is one skimmable sentence, ${MIN_BODY_WORDS}-${MAX_BODY_WORDS} words. The title plus all four bodies together must total no more than ${MAX_TOTAL_WORDS} words — this has to be read in one glance, mid-interview.`,
    '"outcomes" must have exactly 3 entries. Each "metric" names a CATEGORY of number with no digit in it at all (for example "adoption rate"). Each "figure" is a specific number for that category (for example "34% -> 71% of teachers active weekly").',
    'Write every word in third person. Never use "I", "my", "we" or "our" anywhere in the response — this describes a hypothetical project, not something the reader did.',
    "Never reuse a number that appears anywhere in the job posting above — not its salary or compensation band, not a years-of-experience requirement, not a headcount, not a campus or site count, not any other figure it states. Every number in your response must be invented: realistic and internally consistent with the story you are telling, but never copied or derived from a number the posting itself contains.",
  ].join("\n");
}

// Third-person guard, split the way idealProjectNarrative.test.js's own
// equivalent check is (capital-only "I", case-insensitive "my"/"we"/"our"):
// a stray lowercase "i" is common English and must not trip this, but the
// capitalized pronoun always means the same thing it means in the archetype
// copy this stands beside.
const FIRST_PERSON_PATTERNS = [/\bI\b/, /\bmy\b/i, /\bwe\b/i, /\bour\b/i];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Leftover template tokens and stringified junk a model can hand back when
// its own JSON generation half-fails — none of it is safe to render as a
// benchmark a candidate reads mid-question.
function hasLeftoverJunk(text) {
  return /[{}]/.test(text) || /undefined/i.test(text) || /\[object/i.test(text);
}

// Every digit RUN in `text`, thousands-separators stripped so "78,496",
// "78 496" and "78.496" all compare equal — three forms a real posting (or a
// model echoing one back) actually used for the same figure: comma, a space,
// and a period used the European way. A comma is always a separator, the way
// it always was; a space or a period only counts as ONE when it is followed
// by exactly three digits and not a fourth — that is a thousands GROUP, and
// checking for exactly three digits (via the `(?!\d)` lookahead) is what
// keeps a decimal like "4.1" from collapsing into "41": there is one digit
// after its period, not three, so it never enters the grouped alternative at
// all and survives as the separate runs "4" and "1". "$105.974" and "78 496"
// do have exactly three digits after their separator, so they group the same
// way "78,496" does. The plain `\d+` alternative is the fallback for
// everything else — a lone "12" in "12 campuses", "9" in "9 weeks" — so
// matching still stops there and doesn't reach into the following word.
// OUT OF SCOPE: numbers spelled out as words ("twelve campuses") — a
// digit-run rule has no way to see them, and no amount of separator-handling
// changes that; it was considered and deliberately left unhandled.
function digitRuns(text) {
  const matches = String(text).match(/\d{1,3}(?:[,.\s]\d{3}(?!\d))+|\d+/g) || [];
  return matches.map((run) => run.replace(/[,.\s]/g, ""));
}

// Vouches for a model's JSON response, or returns null. Never repairs and
// never partially accepts: a half-valid example would still render as a
// benchmark, still be labelled as one, and nothing downstream would know it
// had been patched — so any single failure rejects the whole thing and the
// caller falls back to the deterministic archetype instead.
//
// THE RULE THAT REPLACES THE OLD STRUCTURAL GUARANTEE. Every fabricated
// figure in idealProjectNarrative.js was safe because that module never saw
// the posting — there was nothing for a salary band to be copied FROM. A
// model that reads the posting has neither property, and R-135's exact
// failure (a posting's own salary band, echoed back as if it were a project
// metric) is now the model's most likely mistake rather than a structurally
// impossible one, because the posting IS sitting in its context. The rule
// below is deliberately blunt rather than clever: every digit run the
// example contains (title, section bodies, outcome figures) is extracted,
// and the example is rejected if ANY of them occurs as a whole number
// anywhere in the posting. That one rule catches the salary band, the
// experience floor, the headcount and the campus count without trying to
// tell them apart — which is exactly the conclusion R-135 reached when
// mining the posting's own numbers was deleted instead of filtered.
export function normalizeIdealProject(parsed, { description } = {}) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const { title, sections, outcomes } = parsed;
  if (!isNonEmptyString(title)) return null;
  if (!Array.isArray(sections) || sections.length !== SECTION_LABELS.length) return null;
  if (!Array.isArray(outcomes) || outcomes.length !== 3) return null;

  for (let i = 0; i < SECTION_LABELS.length; i += 1) {
    const section = sections[i];
    if (!section || typeof section !== "object") return null;
    // Exact label, exact order — "whatever the model called them" is not
    // good enough, because the caller renders these labels directly and a
    // renamed or reordered set is not the shape idealProjectNarrative.test.js
    // already holds the templated example to.
    if (section.label !== SECTION_LABELS[i]) return null;
    if (!isNonEmptyString(section.body)) return null;
  }
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object") return null;
    if (!isNonEmptyString(outcome.metric)) return null;
    if (!isNonEmptyString(outcome.figure)) return null;
  }

  // Same length bounds the templated archetypes are held to, imported
  // rather than restated (see idealProjectNarrative.js's own export
  // comment), so a generated example and a templated one can never drift
  // into being different shapes of thing.
  let totalWords = wordCount(title);
  for (const section of sections) {
    const words = wordCount(section.body);
    if (words < MIN_BODY_WORDS || words > MAX_BODY_WORDS) return null;
    totalWords += words;
  }
  if (totalWords > MAX_TOTAL_WORDS) return null;

  // Every string the response carries, for the checks that scan the whole
  // thing rather than one field at a time.
  const allText = [title, ...sections.map((s) => s.body), ...outcomes.map((o) => `${o.metric} ${o.figure}`)];
  for (const text of allText) {
    if (FIRST_PERSON_PATTERNS.some((re) => re.test(text))) return null;
    if (hasLeftoverJunk(text)) return null;
  }

  for (const outcome of outcomes) {
    if (/\d/.test(outcome.metric)) return null;
    if (!/\d/.test(outcome.figure)) return null;
  }

  // The posting's own numbers can never come back — see this function's
  // header comment for why this is a blunt whole-number match rather than an
  // attempt to tell a salary apart from a metric.
  const postingNumbers = new Set(digitRuns(description));
  const exampleNumbers = digitRuns(allText.join(" "));
  if (exampleNumbers.some((n) => postingNumbers.has(n))) return null;

  // Built fresh rather than returned by reference into `parsed` — this
  // function is PURE, so a caller that goes on to mutate what it gets back
  // (or holds onto `parsed` itself) can never corrupt the other's view of
  // the same response.
  return {
    title,
    sections: sections.map((section, i) => ({ label: SECTION_LABELS[i], body: section.body })),
    outcomes: outcomes.map((outcome) => ({ metric: outcome.metric, figure: outcome.figure })),
  };
}
