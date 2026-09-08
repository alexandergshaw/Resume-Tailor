// Zero-cost SPOKEN sample answers — the embedded engine's counterpart to
// app/api/copilot/answer/route.js's "answer" mode Gemini call. This
// assembles the sample answer as bullet points — each a complete,
// first-person sentence a candidate could actually say out loud in practice
// mode (AC-H9) — built only from real material: the candidate's prep notes
// plus, when available, the résumé and cover letter they actually submitted
// for the selected application (lib/copilot/applicationDocs.js). The flowing
// `answer` string is derived from those same points (deriveAnswerFromPoints,
// answerLocal.js), never generated separately.
//
// Grounding is structural, not a rule applied after the fact: every mining
// helper below (reused from answerLocal.js) only ever returns text that
// literally appears in the material it was given, so a sentence that cites
// one of those results can never name an employer, project, metric, or
// skill the candidate didn't actually submit. The connective sentences that
// hold the narrative together (the STAR "task" beat, the technical
// trade-off/validation beats) are deliberately generic — statements of
// approach a candidate can truthfully make regardless of what's on file —
// never a specific claim about the candidate's history. When there is no
// real material to cite at all, the shape functions below say so plainly
// instead of inventing a situation, a company, or a result. No network, no
// API key, no randomness beyond the deterministic phrasing picker already
// used by answerLocal.js.

import {
  LEADING_ACHIEVEMENT_VERB_RE,
  MOTIVATION_LINE_RE,
  combineMaterial,
  deriveAnswerFromPoints,
  groundingClause,
  literallyMentioned,
  profileHeadline,
  profileMetric,
  profileSkills,
  relevantExperienceLine,
  resolveScaffoldType,
  usableExperienceLine,
} from "./answerLocal.js";
import { classifyQuestionType } from "./questionType.js";
import { normalizeInterviewType, interviewType as interviewTypeDescriptor } from "./interviewTypes.js";
import { pick } from "@/lib/text/phrasing";
import { starPointsFromStory } from "./projectStories.js";
import { MAX_POINT_WORDS, pointWordCount } from "./pointLength.js";

// A short interview format (a recruiter phone screen) gets the crispest cut
// of the narrative rather than the full one — see draftSampleAnswerLocal.
const CRISP_MAX_WORDS = 130;
const CRISP_SENTENCE_COUNT = 2;

// A mined skill (profileSkills), the "team" -> "Microsoft Teams" mining
// hazard, the motivation-line-as-example hazard, and the wider skill pool
// mined before filtering to literal mentions are all shared defenses now
// exported from answerLocal.js (literallyMentioned, MOTIVATION_LINE_RE,
// pastWorkExperienceLine, usableExperienceLine, combineMaterial) — reused
// here rather than re-derived, and reused by draftAnswerLocal's own
// grounding over submitted documents (AC-H4.19).

// The scaffold prose a mined clause is composed into, in words. Every one of
// the four mined-clause carriers below is at most this, so the ceiling
// groundingClause applies is a ceiling on the RENDERED bullet rather than on
// the quote inside it. `firstPersonExperienceClause` prepends "I ", and that
// word counts.
const MINED_CARRIER_FIXED_WORDS = 2;

// Resume bullets are written verb-initial ("Led a team...", "Reduced
// p99..."); relevantExperienceLine lowercases that leading word so the
// phrase reads mid-sentence in a bullet point, but spoken as its own
// sentence that reads as a subject-less fragment. LEADING_ACHIEVEMENT_VERB_RE
// (answerLocal.js, beside the ACHIEVEMENT_VERBS it is built from) detects the
// shape; "I " is prefixed so it reads as a grammatical first-person clause.
function firstPersonExperienceClause(line) {
  const t = String(line || "").trim();
  return t && LEADING_ACHIEVEMENT_VERB_RE.test(t) ? `I ${t}` : "";
}

// The mirror image of pastWorkExperienceLine: the candidate's own words for
// why they want this specific role, for framing the general shape's CLOSING
// beat as motivation instead of letting it masquerade as a work example
// (BUG-5). Filters material down to the lines MOTIVATION_LINE_RE already
// uses to disqualify an experience line, then lets relevantExperienceLine
// pick whichever of those best matches the question. Empty when the material
// has no such line.
function motivationLine(material, question) {
  const motivationOnly = String(material || "")
    .split(/\r?\n+/)
    .filter((line) => MOTIVATION_LINE_RE.test(line.replace(/^[\s•\-*–—>]+/, "").trim()))
    .join("\n");
  return usableExperienceLine(relevantExperienceLine(motivationOnly, question));
}

// A motivation line often reads "I'm applying for X because Y" — X just
// repeats context the answer already established (the role/company), Y is
// the actual reason the candidate wrote down. When the line has that shape,
// speak just the reason; otherwise speak the line as written rather than
// guessing at a split that isn't there.
function motivationReason(line) {
  const t = String(line || "").trim();
  if (!t) return "";
  const match = t.match(/\bbecause\b\s+(.*)$/i);
  return match ? match[1].trim() : t;
}

function sentence(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

// WHERE the candidate was, as a clause they could say out loud, for the two
// beats that open on their most recent role (the behavioral Situation and the
// general shape's experience beat).
//
// The title and the company come from profileHeadline, which reads them out of
// an employment header — NOT through cleanLine — so unlike a mined résumé
// bullet they carry no 140-character bound, and no amount of fixed prose can
// guarantee the composed beat stays inside the ceiling. A real header can run
// to nine words of title and employer on its own. So the beat names the title
// only while naming it fits, and drops back to the company alone when it does
// not: a bullet that names one true thing is better than one that names two
// and runs past the point where anyone skims it.
//
// `label` is the STAR label the caller will prefix, counted here because it is
// part of the rendered bullet.
function roleClause(headline, label = "") {
  if (!headline.company) return "";
  const fixed = label ? pointWordCount(label) : 0;
  const withTitle = headline.title ? `I was ${headline.title} at ${headline.company}` : "";
  if (withTitle && fixed + pointWordCount(withTitle) <= MAX_POINT_WORDS) return withTitle;
  return `I was at ${headline.company}`;
}

function situationClause(headline) {
  return roleClause(headline, "Situation:") || "I can point to a specific example here";
}

// AC-H9.32: for the behavioral/leadership shape, each point carries its STAR
// label, matching the exact convention POINTS_SYSTEM already uses in
// app/api/copilot/answer/route.js. Every point below is built from the same
// mined material and the same mining-hazard defenses as before (BUG-1
// through BUG-5) — only the packaging changed, from unlabeled sentences
// joined into one paragraph to individually labeled, complete bullets.
//
// Every shape function below now returns { points, pageIndices } rather than
// a bare array: `pageIndices` names which entries of `points` are text that
// came from `story` (ARCH §3.6's per-point pageSources), so the caller can
// attribute exactly those lines and null everything else — a connective
// sentence carrying a page citation would be a lie about provenance.
function behavioralAnswer({ headline, expRef, seed, story }) {
  // AC-5.2: a story is only ever spoken when it actually matched the
  // question — an unmatched first-eligible page must never be presented as
  // though it were chosen for this question. This is the ONE place that
  // check happens for the full-narrative override; every other use of
  // `story` below is already reached only when this same condition holds
  // (see draftSampleAnswerLocal, which never passes an unmatched story in).
  if (story) {
    const storyPoints = starPointsFromStory(story);
    // Every beat here — Situation from the page's own title, Action/Result
    // from its own bullets — is literally the page's text, so all of them
    // are page-derived (ARCH §3.6).
    if (storyPoints) {
      const all = storyPoints.map((_, i) => i);
      return { points: storyPoints, pageIndices: all, groundedIndices: all };
    }
  }

  // The line only counts as an anchor once it's actually speakable in first
  // person (BUG-3) — a candidate line that isn't verb-initial gets dropped
  // rather than guessed at, so it shouldn't count as "having an example"
  // either.
  const firstPersonExpRef = firstPersonExperienceClause(expRef);
  const hasAnchor = Boolean(headline.company) || Boolean(firstPersonExpRef);

  if (!hasAnchor) {
    return {
      points: [
        `Situation: ${sentence(
          pick(seed, [
            "I don't have a specific story on file for this one",
            "nothing specific from my background is on file here",
          ]),
        )}`,
        `Action: ${sentence("I take ownership of the problem and keep people informed")}`,
        `Result: ${sentence("I don't finish until I have a result to point to")}`,
      ],
      pageIndices: [],
      groundedIndices: [],
    };
  }

  const points = [];
  points.push(`Situation: ${sentence(situationClause(headline))}`);

  points.push(`Task: ${sentence("I owned the outcome, not just my part of it")}`);

  // A result may only be spoken alongside the text it came from (BUG-2): a
  // resume bullet with its own embedded number already states its own
  // result ("...by 40%...", "...with zero downtime"), so that single line is
  // spoken once, as the Result point when it carries a metric and as the
  // Action point otherwise. A metric mined from a different line — a
  // different story — is never spoken here at all.
  const expRefHasMetric = Boolean(expRef) && Boolean(profileMetric(expRef));
  const groundedIndices = [];

  if (firstPersonExpRef && !expRefHasMetric) {
    points.push(`Action: ${sentence(firstPersonExpRef)}`);
    groundedIndices.push(points.length - 1);
  }

  if (firstPersonExpRef && expRefHasMetric) {
    points.push(`Result: ${sentence(firstPersonExpRef)}`);
    groundedIndices.push(points.length - 1);
  }

  return { points, pageIndices: [], groundedIndices };
}

function technicalAnswer({ skills, expRef, seed, story }) {
  const parts = [
    sentence(
      pick(seed, [
        "I'd start by clarifying the requirements and constraints",
        "I'd restate the problem and pin down the constraints first",
        "I'd ask a clarifying question, then state my assumptions",
      ]),
    ),
  ];

  // AC-5.1: a technical question draws its approach from the best-matching
  // page's own bullets, phrased only in words that literally occur on the
  // page — preferred over the résumé/profile expRef, which is the same
  // preference order the behavioral shape's full override already applies.
  // `story` is null here whenever it didn't actually match (draftSample
  // AnswerLocal never passes an unmatched one in), so this is silently a
  // no-op — falls through to `expRef` exactly as before — for every caller
  // that predates project pages as a source (AC-3.6's byte-identity guard).
  const pageClause = story?.bullets?.[0] || "";
  const groundedClause = pageClause || expRef;
  const pageIndices = [];
  const groundedIndices = [];

  if (groundedClause) {
    // The carrier this beat used to open with — "that's close to work I've
    // actually done — <quote>" — was eight fixed words in front of a sentence
    // that already said the same thing, and it opened on a demonstrative whose
    // antecedent is the interview question rather than anything in the line,
    // so read by itself with its label covered up it did not stand up. The
    // clause speaks for itself, in first person where the line allows it — the
    // same two-word wrap the behavioral and general shapes already use.
    parts.push(sentence(firstPersonExperienceClause(groundedClause) || groundedClause));
    groundedIndices.push(parts.length - 1);
    if (pageClause) pageIndices.push(parts.length - 1);
  } else if (skills.length) {
    parts.push(sentence(`I'd ground it in my experience with ${skills.slice(0, 3).join(", ")}`));
    groundedIndices.push(parts.length - 1);
  }

  parts.push(sentence("I'd call out the trade-offs and say which one I'm optimizing for"));

  parts.push(sentence("finally, I'd say how I'd test it and handle edge cases"));

  return { points: parts, pageIndices, groundedIndices };
}

function generalAnswer({ headline, skills, expRef, pastWorkExpRef, motivationRef, seed, story }) {
  // AC-5.1: the general shape's experience beat prefers a matched page
  // bullet over pastWorkExpRef, same preference order as the technical
  // shape above. Falls through to nothing (pageClause === "") whenever
  // `story` is null/unmatched, which is the existing byte-identical path.
  const pageClause = story?.bullets?.[0] || "";
  // `motivationRef` counts as an anchor in its own right. It used to be
  // covered incidentally, because `expRef` was unfiltered and a cover letter's
  // "I am applying for this role because..." opener out-scores a real
  // accomplishment on keyword overlap — so the shape had "material" only by
  // way of the very line it is forbidden to quote as experience. Now that
  // expRef is past-work-filtered, a candidate whose only file is a cover
  // letter would otherwise be told nothing is on file while the sentence they
  // wrote about why they want the job sits right there.
  const hasAnchor =
    Boolean(expRef) || Boolean(headline.company) || skills.length > 0 || Boolean(pageClause) || Boolean(motivationRef);

  if (!hasAnchor) {
    return {
      points: [
        sentence("I don't have specific résumé details on file for this one"),
        sentence("I'd rather talk through the specifics with you than generalise"),
      ],
      pageIndices: [],
      groundedIndices: [],
    };
  }

  // The experience beat must actually be past work (BUG-5): relevantExperienceLine
  // scores purely on keyword overlap, so a cover letter's "I am applying
  // for..." opener can out-score a real accomplishment and get quoted as
  // though it were an example of experience. pastWorkExpRef is already
  // filtered for that; spoken in first person the same way the behavioral
  // shape speaks its own example, as a sentence that stands on its own
  // rather than "for example, <quote>".
  const firstPersonExpRef = firstPersonExperienceClause(pastWorkExpRef);
  // A page bullet has no such verb-initial guarantee, so it gets its own
  // first-person wrap rather than being forced through
  // firstPersonExperienceClause (which would silently drop it whenever it
  // isn't achievement-verb-initial, discarding real material that DID match
  // the question).
  const firstPersonPageClause = pageClause ? firstPersonExperienceClause(pageClause) || `I can point to this: ${pageClause}` : "";

  const parts = [];
  const pageIndices = [];
  const groundedIndices = [];
  if (firstPersonPageClause) {
    parts.push(sentence(firstPersonPageClause));
    pageIndices.push(parts.length - 1);
    groundedIndices.push(parts.length - 1);
  } else if (firstPersonExpRef) {
    parts.push(sentence(firstPersonExpRef));
    groundedIndices.push(parts.length - 1);
  } else if (headline.company) {
    parts.push(sentence(roleClause(headline)));
  }

  if (skills.length) {
    parts.push(sentence(`the strengths I'd bring are ${skills.slice(0, 3).join(", ")}`));
    groundedIndices.push(parts.length - 1);
  }

  // When the material has a genuine motivation line, close on it framed as
  // motivation (BUG-5) instead of the generic closing — it's real content
  // the candidate wrote, it just belongs here, not as the experience quote.
  if (motivationRef) {
    parts.push(sentence(`I'm drawn here because ${motivationReason(motivationRef)}`));
    groundedIndices.push(parts.length - 1);
  } else {
    parts.push(
      sentence(
        pick(seed, [
          "and that combination is why I think I'd fit this role",
          "and that's the background I'd bring to this specific role",
          "and it's why I'm genuinely excited about this opportunity",
        ]),
      ),
    );
  }

  return { points: parts, pageIndices, groundedIndices };
}

// AC-H9.35: draft the sample answer as bullet points, grounded only in the
// candidate's real material. Returns { points: string[], answer: string,
// type, pageSources }. `points` are complete, speakable sentences
// (STAR-labeled for the behavioral shape); `answer` is DERIVED from `points`
// via deriveAnswerFromPoints — never generated separately, so it can never
// drift from what the points actually say (AC-H9.33). `type` is the scaffold
// actually used to shape the answer — the question's own classification,
// unless it classified as "general" and the interview type pushes it toward
// a technical or STAR shape (resolveScaffoldType, shared with
// draftAnswerLocal so both engines make the same call).
//
// `story` (ARCH §3.6) is lib/copilot/projectStories.js's selectBestStory
// return value, selected ONCE by the caller (app/api/copilot/answer/route.js)
// and handed down here rather than re-selected inside — the structural fix
// for D7's asymmetry, where the embedded engine's own behavioral override
// and the route's separate resumeAnchor fallback used to run two different
// selectBestStory calls and could pick two different pages for one question.
// Used only when `story.matched === true` (AC-5.2): an unmatched
// first-eligible page is never spoken as though it were chosen for this
// question, so `story === null` and `story.matched === false` are the SAME
// case below — both fall through to material mined from
// profile/resume/coverLetter exactly as this function behaved before project
// pages existed as a source. That byte-identity is what every pre-existing
// test in sampleAnswerLocal.test.js still pins.
//
// `pageSources[i]` is `{ id: story.pageId, title: story.title }` for exactly
// the points whose text came from the page (the whole STAR override, or the
// one grounding clause the technical/general shapes prefer over
// expRef/pastWorkExpRef) and `null` for every generic connective beat — a
// connective sentence carrying a page citation would be a lie about
// provenance. This citation is never whitelist-validated the way the Gemini
// path's is (lib/copilot/pageCitations.js) — it doesn't need to be: it
// quotes a bullet verbatim out of a page this function read itself, so it is
// true by construction (ARCH §4e).
export function draftSampleAnswerLocal({
  question,
  profile = "",
  resume = "",
  coverLetter = "",
  interviewType,
  story = null,
} = {}) {
  const q = String(question || "").trim();
  const normalizedInterviewType = normalizeInterviewType(interviewType);
  const type = resolveScaffoldType(classifyQuestionType(q), normalizedInterviewType);
  const descriptor = interviewTypeDescriptor(normalizedInterviewType);
  const effectiveStory = story && story.matched ? story : null;

  const material = combineMaterial(profile, resume, coverLetter);
  // Mine a wider pool than the default before filtering to a literal match
  // (BUG-1) so a taxonomy inference bumping a real skill out of the top few
  // doesn't also cost that real skill its spot once the inference is
  // dropped.
  const skills = profileSkills(material, 12).filter((s) => literallyMentioned(s, material));
  const headline = profileHeadline(material);
  const seed = q || material;

  // The example each shape may quote, chosen once, the same way live mode
  // chooses its own (groundingClause, answerLocal.js): employment headers
  // demoted behind real accomplishments, and the ceiling applied as a
  // preference over the accomplishments only.
  //
  // TWO variants, because the shapes differ in what they can SPEAK, not in
  // what counts as good material: the behavioral and general shapes say their
  // example in the first person, so a line that is not achievement-verb-initial
  // cannot be spoken by them at all and must not be selected for them. The
  // technical shape quotes it as written and has no such restriction.
  const commonSelection = { ceiling: MAX_POINT_WORDS, fixedWords: MINED_CARRIER_FIXED_WORDS };
  const expRef = groundingClause(material, q, commonSelection);
  const firstPersonRef = groundingClause(material, q, { ...commonSelection, firstPerson: true });

  let rawResult;
  if (type === "behavioral") {
    rawResult = behavioralAnswer({ headline, expRef: firstPersonRef, seed, story: effectiveStory });
  } else if (type === "technical") {
    // This beat used to receive the UNFILTERED experience line where the
    // behavioral and general shapes below received a past-work-filtered one,
    // so a cover letter's "I am applying for this role because..." opener —
    // which out-scores a real accomplishment on keyword overlap alone — was
    // quoted back as an example of work the candidate had done, on material
    // that had real accomplishments on file alongside it.
    rawResult = technicalAnswer({ skills, expRef, seed, story: effectiveStory });
  } else {
    // The general shape's experience beat needs the same past-work guarantee
    // (BUG-5), plus a genuine motivation line, if the material has one, to
    // frame the closing beat with instead of the generic pick().
    const generalMotivationRef = motivationLine(material, q);
    rawResult = generalAnswer({
      headline,
      skills,
      expRef,
      pastWorkExpRef: firstPersonRef,
      motivationRef: generalMotivationRef,
      seed,
      story: effectiveStory,
    });
  }

  const pageIndexSet = new Set(rawResult.pageIndices);
  const groundedIndexSet = new Set(rawResult.groundedIndices || []);
  const usableEntries = rawResult.points
    .map((p, i) => ({ point: p, fromPage: pageIndexSet.has(i), grounded: groundedIndexSet.has(i) }))
    .filter((entry) => typeof entry.point === "string" && entry.point.trim());

  // A short-format interview (a recruiter phone screen) gets the crispest
  // cut of the narrative instead of the fuller one — the descriptor's
  // lengthTarget shaping the answer the same way it shapes the Gemini
  // prompt (AC-G2-D-6/AC-H9.32). `pageIndices` was computed against
  // `rawResult.points`, so `fromPage` is carried alongside each entry through
  // both the blank-entry filter and this crisp cut, rather than recomputed
  // against a post-filter index — the same ordering hazard answerPoints.js's
  // answerLines already guards against for its own positional pairing.
  //
  // THE CUT KEEPS THE EXAMPLE. Taking the first two beats and stopping used to
  // hand a recruiter phone screen the two beats that contain no material — the
  // scene-setter and the generic ownership statement — and drop the only
  // sentence quoting anything the candidate actually did. That is exactly
  // backwards for the format the cut exists to serve, and it broke the
  // guarantee every other path here keeps: that a cell whose material offers a
  // line the shape can speak produces an answer containing at least one
  // grounded point. So when the plain cut would keep no grounded beat and one
  // exists further down, it takes the last kept slot. Order is preserved —
  // the example still comes after the beat that sets it up.
  let finalEntries = usableEntries;
  if (descriptor.lengthTarget.maxWords <= CRISP_MAX_WORDS) {
    finalEntries = usableEntries.slice(0, CRISP_SENTENCE_COUNT);
    if (finalEntries.length && !finalEntries.some((entry) => entry.grounded)) {
      const example = usableEntries.find((entry) => entry.grounded);
      if (example) finalEntries = [...finalEntries.slice(0, -1), example];
    }
  }

  const points = finalEntries.map((entry) => entry.point);
  const pageSources = finalEntries.map((entry) =>
    entry.fromPage && effectiveStory && effectiveStory.pageId
      ? { id: effectiveStory.pageId, title: effectiveStory.title }
      : null,
  );

  return {
    points,
    answer: deriveAnswerFromPoints(points),
    type,
    pageSources,
  };
}
