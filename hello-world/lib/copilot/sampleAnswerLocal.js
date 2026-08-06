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
  ACHIEVEMENT_VERBS,
  MOTIVATION_LINE_RE,
  combineMaterial,
  deriveAnswerFromPoints,
  literallyMentioned,
  pastWorkExperienceLine,
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

// Resume bullets are written verb-initial ("Led a team...", "Reduced
// p99..."); relevantExperienceLine lowercases that leading word so the
// phrase reads mid-sentence in a bullet point, but spoken as its own
// sentence that reads as a subject-less fragment. Reuses answerLocal.js's
// ACHIEVEMENT_VERBS to detect the shape and prefix "I " so it reads as a
// grammatical first-person clause.
const LEADING_ACHIEVEMENT_VERB_RE = new RegExp(`^${ACHIEVEMENT_VERBS.source}`, "i");

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

// AC-H9.32: for the behavioral/leadership shape, each point carries its STAR
// label, matching the exact convention POINTS_SYSTEM already uses in
// app/api/copilot/answer/route.js. Every point below is built from the same
// mined material and the same mining-hazard defenses as before (BUG-1
// through BUG-5) — only the packaging changed, from unlabeled sentences
// joined into one paragraph to individually labeled, complete bullets.
function behavioralAnswer({ headline, expRef, seed }) {
  // The line only counts as an anchor once it's actually speakable in first
  // person (BUG-3) — a candidate line that isn't verb-initial gets dropped
  // rather than guessed at, so it shouldn't count as "having an example"
  // either.
  const firstPersonExpRef = firstPersonExperienceClause(expRef);
  const hasAnchor = Boolean(headline.company) || Boolean(firstPersonExpRef);

  if (!hasAnchor) {
    return [
      `Situation: ${sentence(
        pick(seed, [
          "I don't have a specific story pulled from my materials for this one",
          "nothing specific from my background is on file to point to here",
        ]),
      )}`,
      `Action: ${sentence(
        "in general, when I run into a situation like that, I take ownership of the problem and keep the people it affects informed",
      )}`,
      `Result: ${sentence("I don't consider it finished until there's a result I can point to")}`,
    ];
  }

  const points = [];
  points.push(
    `Situation: ${sentence(
      headline.company
        ? headline.title
          ? `as ${headline.title} at ${headline.company}, I ran into a situation that put this to the test`
          : `at ${headline.company}, I ran into a situation that put this to the test`
        : "I can point to a specific example here",
    )}`,
  );

  points.push(
    `Task: ${sentence(
      "I made it my job to own the outcome, not just contribute to it, so I got clear on what success looked like before I started",
    )}`,
  );

  // A result may only be spoken alongside the text it came from (BUG-2): a
  // resume bullet with its own embedded number already states its own
  // result ("...by 40%...", "...with zero downtime"), so that single line is
  // spoken once, as the Result point when it carries a metric and as the
  // Action point otherwise. A metric mined from a different line — a
  // different story — is never spoken here at all.
  const expRefHasMetric = Boolean(expRef) && Boolean(profileMetric(expRef));

  if (firstPersonExpRef && !expRefHasMetric) {
    points.push(`Action: ${sentence(firstPersonExpRef)}`);
  }

  if (firstPersonExpRef && expRefHasMetric) {
    points.push(`Result: ${sentence(firstPersonExpRef)}`);
  }

  return points;
}

function technicalAnswer({ skills, expRef, seed }) {
  const parts = [
    sentence(
      pick(seed, [
        "I'd start by clarifying the requirements and constraints, then sketch my approach before diving into details",
        "I'd restate the problem and pin down the constraints first, then walk through my approach out loud",
        "I'd ask a clarifying question or two, state my assumptions, and then lay out my approach",
      ]),
    ),
  ];

  if (expRef) {
    parts.push(sentence(`that's close to work I've actually done — ${expRef}`));
  } else if (skills.length) {
    parts.push(sentence(`I'd ground it in my hands-on experience with ${skills.slice(0, 3).join(", ")}`));
  }

  parts.push(
    sentence(
      "I'd call out the trade-offs explicitly — time versus space, or simplicity versus scale — and explain which one I'm optimizing for and why",
    ),
  );

  parts.push(sentence("finally, I'd say how I'd test it and handle the edge cases before calling it done"));

  return parts;
}

function generalAnswer({ headline, skills, expRef, pastWorkExpRef, motivationRef, seed }) {
  const hasAnchor = Boolean(expRef) || Boolean(headline.company) || skills.length > 0;

  if (!hasAnchor) {
    return [
      sentence(
        "I don't have specific résumé details on file for this one, but broadly, I look for roles where I can apply what I know and keep growing",
      ),
      sentence("and I'd want to talk through the specifics with you rather than speak in generalities"),
    ];
  }

  // The experience beat must actually be past work (BUG-5): relevantExperienceLine
  // scores purely on keyword overlap, so a cover letter's "I am applying
  // for..." opener can out-score a real accomplishment and get quoted as
  // though it were an example of experience. pastWorkExpRef is already
  // filtered for that; spoken in first person the same way the behavioral
  // shape speaks its own example, as a sentence that stands on its own
  // rather than "for example, <quote>".
  const firstPersonExpRef = firstPersonExperienceClause(pastWorkExpRef);

  const parts = [];
  if (firstPersonExpRef) {
    parts.push(sentence(firstPersonExpRef));
  } else if (headline.company) {
    parts.push(
      sentence(
        headline.title
          ? `my most relevant experience is from ${headline.company}, where I worked as ${headline.title}`
          : `my most relevant experience is from ${headline.company}`,
      ),
    );
  }

  if (skills.length) {
    parts.push(sentence(`the strengths I'd bring are ${skills.slice(0, 3).join(", ")}`));
  }

  // When the material has a genuine motivation line, close on it framed as
  // motivation (BUG-5) instead of the generic closing — it's real content
  // the candidate wrote, it just belongs here, not as the experience quote.
  if (motivationRef) {
    parts.push(sentence(`what draws me to this role is that ${motivationReason(motivationRef)}`));
  } else {
    parts.push(
      sentence(
        pick(seed, [
          "and that combination is exactly why I think this role is a strong fit for me",
          "and that's the background I'd bring to this specific role",
          "and it's why I'm genuinely excited about this opportunity",
        ]),
      ),
    );
  }

  return parts;
}

// AC-H9.35: draft the sample answer as bullet points, grounded only in the
// candidate's real material. Returns { points: string[], answer: string,
// type }. `points` are complete, speakable sentences (STAR-labeled for the
// behavioral shape); `answer` is DERIVED from `points` via
// deriveAnswerFromPoints — never generated separately, so it can never drift
// from what the points actually say (AC-H9.33). `type` is the scaffold
// actually used to shape the answer — the question's own classification,
// unless it classified as "general" and the interview type pushes it toward
// a technical or STAR shape (resolveScaffoldType, shared with
// draftAnswerLocal so both engines make the same call).
export function draftSampleAnswerLocal({
  question,
  profile = "",
  resume = "",
  coverLetter = "",
  interviewType,
} = {}) {
  const q = String(question || "").trim();
  const normalizedInterviewType = normalizeInterviewType(interviewType);
  const type = resolveScaffoldType(classifyQuestionType(q), normalizedInterviewType);
  const descriptor = interviewTypeDescriptor(normalizedInterviewType);

  const material = combineMaterial(profile, resume, coverLetter);
  // Mine a wider pool than the default before filtering to a literal match
  // (BUG-1) so a taxonomy inference bumping a real skill out of the top few
  // doesn't also cost that real skill its spot once the inference is
  // dropped.
  const skills = profileSkills(material, 12).filter((s) => literallyMentioned(s, material));
  const headline = profileHeadline(material);
  const expRef = usableExperienceLine(relevantExperienceLine(material, q));
  const seed = q || material;

  let rawPoints;
  if (type === "behavioral") {
    // The behavioral/STAR shape needs its example to actually be past work
    // (BUG-4), which the shared relevantExperienceLine doesn't guarantee.
    const behavioralExpRef = pastWorkExperienceLine(material, q);
    rawPoints = behavioralAnswer({ headline, expRef: behavioralExpRef, seed });
  } else if (type === "technical") rawPoints = technicalAnswer({ skills, expRef, seed });
  else {
    // The general shape's experience beat needs the same past-work guarantee
    // (BUG-5), plus a genuine motivation line, if the material has one, to
    // frame the closing beat with instead of the generic pick().
    const generalExpRef = pastWorkExperienceLine(material, q);
    const generalMotivationRef = motivationLine(material, q);
    rawPoints = generalAnswer({
      headline,
      skills,
      expRef,
      pastWorkExpRef: generalExpRef,
      motivationRef: generalMotivationRef,
      seed,
    });
  }

  // A short-format interview (a recruiter phone screen) gets the crispest
  // cut of the narrative instead of the fuller one — the descriptor's
  // lengthTarget shaping the answer the same way it shapes the Gemini
  // prompt (AC-G2-D-6/AC-H9.32).
  const usable = rawPoints.filter((p) => typeof p === "string" && p.trim());
  const points = descriptor.lengthTarget.maxWords <= CRISP_MAX_WORDS ? usable.slice(0, CRISP_SENTENCE_COUNT) : usable;

  return {
    points,
    answer: deriveAnswerFromPoints(points),
    type,
  };
}
