// The prompt text /api/copilot/answer sends to Gemini, in both of its modes:
// the two system instructions, and the three functions that assemble a user
// prompt out of the question, the interview format, the candidate's prep
// notes, their own project pages, and the résumé/cover letter submitted for
// the selected application.
//
// WHY THIS IS ITS OWN MODULE: app/api/copilot/answer/route.js reached 987 of
// this project's hard 1000-line limit. This band of it is pure string
// assembly with no Supabase client, no Gemini client, no request and no
// response — a straight function of its arguments, the same discipline
// lib/copilot/practiceNotices.js and lib/copilot/groundingNotice.js already
// follow — so it is the part that can leave without taking any of the
// route's behaviour with it. The move is behaviour-preserving TO THE BYTE:
// route.test.js's two no-pages prompt cases pin exactly that, and they pass
// unchanged on both sides of this change.
//
// It also makes these builders directly testable. Until now they had only
// ever been exercised through a mocked `generateContent` call, which is why
// a prompt regression has been hard to localise — a changed sentence surfaced
// as a route assertion about a string, several layers away from the function
// that wrote it. answerPrompts.test.js calls them directly.
//
// AC-H4.17/AC-H4.18/AC-3.4's BYTE-IDENTITY GUARANTEE lives here now: with no
// résumé, no cover letter and no pages block, each builder must produce
// exactly what it produced before those sources existed. Every place either
// function's output can change is gated on the corresponding argument being
// truthy, and nothing in this module may add an unconditional line. What
// ENFORCES that is answerPrompts.test.js's FROZEN_POINTS_PROMPT_NO_PAGES /
// FROZEN_ANSWER_PROMPT_NO_PAGES — a full-string `toBe` per builder for the
// minimal input. Until those existed the only guards were `not.toContain`
// sweeps over five known strings, which an unconditional new line sails
// straight through; the guarantee was stated in three comments and checked
// nowhere.

import { submittedDocsPromptParts } from "@/lib/copilot/applicationDocsPrompt";

export const POINTS_SYSTEM = [
  "You are an interview coach helping a candidate answer questions during a LIVE interview.",
  "Given the question the interviewer just asked, produce concise talking points the candidate can glance at and speak from — NOT a script to read aloud.",
  "Return 3-5 short bullet points; each is one phrase or short sentence, specific and substantive.",
  "When a CANDIDATE BACKGROUND section or a YOUR OWN PROJECT PAGES section is provided, ground the points in it — reference their real companies, projects, metrics, and skills rather than inventing generic ones. For a \"tell me about a time...\" question, prefer a concrete story from YOUR OWN PROJECT PAGES when one is provided — it is the candidate's own account of a real project, more specific than a resume bullet. Never fabricate experience the background does not support; if it is thin, give strong generic points instead.",
  "For behavioral questions (\"tell me about a time...\"), prefix each point with its STAR label — \"Situation:\", \"Task:\", \"Action:\", \"Result:\".",
  "Keep every point skimmable — a person on camera must absorb it in a glance.",
].join(" ");

// AC-H9: the sample answer is a sequence of complete, speakable sentences —
// never glanceable fragments — built only from what was actually submitted
// (or the prep context, when nothing was submitted). `answer` is never asked
// of the model here: it is always derived server-side from `points`
// (deriveAnswerFromPoints, AC-H9.33).
export const ANSWER_SYSTEM = [
  "You are an interview coach drafting the sample answer a candidate could actually say out loud in a real interview, as a sequence of complete sentences — never glanceable fragments.",
  "The answer must be built only from the material provided below — the candidate's prep notes, their own project pages, and, when available, the résumé and cover letter they actually submitted for this application — never invented.",
  "Return 3-6 points; each point is one complete, natural spoken sentence, first person, and together they are the whole answer — no headings, no stage directions, nothing that isn't meant to be spoken aloud.",
  "For behavioral questions (\"tell me about a time...\"), prefix each point with its STAR label — \"Situation:\", \"Task:\", \"Action:\", \"Result:\".",
  // AC-K1.1: the cue is what the candidate actually reads mid-question; the
  // point behind it is the sentence they say. Asked of the model rather than
  // trimmed from the point afterwards because a model that knows which few
  // words carry the beat phrases them better than any mechanical shortener
  // can — but the shortener still runs over whatever comes back (resolveCues),
  // so a "cue" returned as a full sentence is trimmed rather than trusted.
  "Also return `cues`: exactly one per point, in the same order — each a 2-6 word prompt naming what that point is about, carrying the same STAR label where the point has one. A cue is a reminder, not a sentence: no verbs the point does not have, no punctuation at the end.",
].join(" ");

export function interviewFormatLines(descriptor) {
  return [
    "--- INTERVIEW FORMAT ---",
    `This is a ${descriptor.label} interview. ${descriptor.guidance}`,
    `Emphasize: ${descriptor.emphasis.join(", ")}.`,
  ];
}

// AC-H4.15: grounds live mode's talking points in the résumé and cover
// letter actually submitted for the selected application, in addition to
// the prep context — but never the posting description (AC-H7.27), which
// this function never receives at all. AC-H4.17: with neither `resume` nor
// `coverLetter` (no applicationId, or no documents found for it), this must
// produce byte-for-byte what it produced before grounding existed as a
// source — so the submitted-docs block below is only ever added when at
// least one of the two is actually present. It deliberately does NOT reuse
// applicationDocsPrompt.js's "no submitted resume or cover letter was
// available" note for the neither-found case: that note exists for
// answer-mode's framing (see buildAnswerPrompt) and adding any such note
// here would itself break this exact byte-identity requirement — see that
// module's own comment on checking groundingFlags and simply not calling
// submittedDocsPromptParts when it doesn't apply.
// `pagesBlock` (lib/experience/knowledgeBase.js's buildKnowledgeBaseBlock
// output) is "" whenever the caller has no eligible project pages, in which
// case every block and instruction below that mentions them is skipped and
// this function's output is byte-identical to what it produced before project
// pages existed as a source (mirroring AC-H4.17's byte-identity guarantee for
// the submitted-docs block above it) — that is what route.test.js's no-pages
// prompt cases still pin.
//
// AC-3 APPLIES TO THIS PROMPT TOO, and this is the higher-stakes one: THIS is
// what fires during the live interview, while buildAnswerPrompt is practice
// mode. The framing fixes landed only in the practice prompt, so the live one
// kept the exact hedge the acceptance criteria name as the defect ("may ground
// a concrete story"), emitted the pages AFTER the submitted documents, and
// never got the prefer-a-specific-detail instruction at all. A previous
// comment here argued AC-3 was answer-mode-only; AC-3 says no such thing.
export function buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter, pagesBlock) {
  const parts = [`The interviewer asked: "${question}"`, "", ...interviewFormatLines(descriptor)];
  if (profile) {
    parts.push(
      "",
      "--- CANDIDATE BACKGROUND (their resume / target role / prep notes; use to personalize) ---",
      profile,
    );
  }
  // AC-3.1: before the submitted documents, not after. A model handed a résumé
  // and a project page reaches for the résumé — it is shorter and already
  // answer-shaped — which is exactly the generic-answer defect this change
  // exists to fix.
  if (pagesBlock) {
    parts.push("", "--- YOUR OWN PROJECT PAGES (real projects they've documented) ---", pagesBlock);
  }
  if (resume || coverLetter) {
    parts.push(...submittedDocsPromptParts({ resume, coverLetter }));
  }
  if (context) {
    parts.push("", "Recent conversation (most recent last), for context:", context);
  }
  if (pagesBlock) {
    // AC-3.2, the same instruction buildAnswerPrompt already carries, worded
    // for talking points rather than spoken sentences.
    parts.push(
      "",
      "Prefer a specific detail from a project page — the project's name, the technology used, a concrete number, or the outcome — over a generic resume restatement, and name the project when a point draws on one.",
    );
  }
  // AC-6.2: points mode now asks for `pageIds` too, gated on `pagesBlock`
  // exactly as buildAnswerPrompt already gates its own `pageIds` request —
  // without this the model never returns one and resolvePageSources would
  // always resolve to nulls. Declared AFTER `points` in the JSON shape line
  // (ARCH §3.7): pointsFromPartialJson anchors on /"points"\s*:\s*\[/, so an
  // earlier field would delay the first streamed points frame for no
  // benefit.
  if (pagesBlock) {
    parts.push(
      "",
      'Return ONLY JSON of this exact shape: { "points": string[], "type": "behavioral" | "technical" | "general", "pageIds": (string | null)[] }',
    );
  } else {
    parts.push(
      "",
      'Return ONLY JSON of this exact shape: { "points": string[], "type": "behavioral" | "technical" | "general" }',
    );
  }
  parts.push("points: 3-5 concise talking points as described above.");
  if (pagesBlock) {
    parts.push(
      'pageIds: exactly one per point, same order — the exact "page id" from a YOUR OWN PROJECT PAGES heading that point drew a concrete detail from, or null when it did not draw on a page. Never invent an id and never cite a page you were not shown.',
    );
  }
  return parts.join("\n");
}

// How the spoken answer should be shaped for this format (AC-G2-D-4): a
// behavioral or leadership format wants a STAR narrative, a technical or
// system-design format wants approach-then-trade-offs, and a phone screen
// wants brevity over a story.
export function answerShapeInstruction(descriptor) {
  const groups = descriptor.questionGroups;
  if (groups.includes("behavioral") || groups.includes("leadership")) {
    return "Shape it as a STAR narrative: briefly set the situation and task, describe the actions the candidate personally took, and close with the result.";
  }
  if (groups.includes("technical") || groups.includes("system-design")) {
    return "Shape it as approach-then-trade-offs: state the approach first, then the trade-offs considered and how the candidate would validate the result.";
  }
  if (descriptor.value === "phone-screen") {
    return "Keep it a crisp, concise summary — a recruiter screen calls for brevity, not a long story.";
  }
  return "Shape it naturally for the question: lead with the point, then the concrete evidence behind it.";
}

// AC-H9.32: asks the model for `points` — 3-6 complete, speakable
// sentences, STAR-labeled for a behavioral/leadership shape — never a single
// prose `answer` field. The route derives `answer` from those points itself
// (deriveAnswerFromPoints, AC-H9.33); the model is never asked to generate
// prose separately.
// `pagesBlock` (lib/experience/knowledgeBase.js's buildKnowledgeBaseBlock
// output) is "" whenever the caller has no eligible project pages. Every
// place it changes this function's output — the block itself, the "no
// submitted resume or cover letter" notice, the authority sentence naming
// where a claim may come from, the "prefer a page's own detail" instruction,
// and the `pageIds` JSON field — is gated on it being truthy, so with no
// eligible pages this function's output is byte-identical to what it
// produced before project pages existed as a source (this is what
// route.test.js's no-pages prompt cases still pin — ARCH §6.7).
//
// AC-3.1: pages are the candidate's PRIMARY evidence for a behavioral or
// leadership answer, so the block is emitted before résumé/cover letter
// (not after, as it used to be) and the authority sentence names it FIRST —
// a model handed a résumé and a project page otherwise reaches for the
// résumé, because it is shorter and already answer-shaped, which is exactly
// the generic-answer defect this change exists to fix.
export function buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor, pagesBlock }) {
  const parts = [`The interviewer asked: "${question}"`, "", ...interviewFormatLines(descriptor)];
  if (profile) {
    parts.push("", "--- CANDIDATE PREP NOTES (their own notes on background / target role) ---", profile);
  }
  if (pagesBlock) {
    parts.push("", "--- YOUR OWN PROJECT PAGES (real projects they've documented) ---", pagesBlock);
  }
  if (resume) {
    parts.push("", "--- SUBMITTED RESUME (for this application) ---", resume);
  }
  if (coverLetter) {
    parts.push("", "--- SUBMITTED COVER LETTER (for this application) ---", coverLetter);
  }
  if (context) {
    parts.push("", "Recent conversation (most recent last), for context:", context);
  }
  if (!resume && !coverLetter) {
    parts.push(
      "",
      pagesBlock
        ? "No submitted resume or cover letter was available for this application — build the answer from the candidate prep notes, YOUR OWN PROJECT PAGES above, and conversation context."
        : "No submitted resume or cover letter was available for this application — build the answer from the candidate prep notes and conversation context alone.",
    );
  }
  const authoritySources = pagesBlock
    ? "YOUR OWN PROJECT PAGES, CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER"
    : "CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER";
  parts.push(
    "",
    `Write the actual spoken answer the candidate should give, as 3-6 points — each one a complete, speakable sentence, not a fragment — together totalling roughly ${descriptor.lengthTarget.minWords}-${descriptor.lengthTarget.maxWords} words.`,
    "Each point is first person, spoken register — no bullet markers beyond the STAR label where it applies, no headings, no stage directions, nothing but words meant to be said out loud.",
    answerShapeInstruction(descriptor),
  );
  if (pagesBlock) {
    // AC-3.2: without this, a model handed both a résumé and a project page
    // reaches for the résumé bullet — shorter and already answer-shaped —
    // over the candidate's own, more specific account of a real project.
    parts.push(
      "Prefer a specific detail from a project page — the project's name, the technology used, a concrete number, or the outcome — over a generic resume restatement, and name the project when the answer draws on one.",
    );
  }
  parts.push(
    `Every claim must come from the ${authoritySources} above — select, order, and phrase freely, but never invent an employer, project, metric, or credential that isn't there. If the material is thin, give a shorter, honest answer rather than inventing detail.`,
  );
  if (pagesBlock) {
    // AC-6.1/A3: the model names which page (by the id in that page's own
    // "## <title> (page id: <id>)" heading) each point actually drew a
    // concrete detail from — validated against the whitelist of pages the
    // prompt actually included before it ever reaches the candidate
    // (lib/copilot/pageCitations.js's resolvePageSources), the same pattern
    // lib/meeting/insightContract.js already uses for meeting insights.
    // `pageIds` is declared AFTER `points`/`cues` (ARCH §3.7): the streaming
    // path's pointsFromPartialJson anchors on /"points"\s*:\s*\[/ and stops
    // at that array's close, so an earlier field would delay the first
    // streamed points frame for no benefit.
    parts.push(
      'Return ONLY JSON of this exact shape: { "points": string[], "cues": string[], "type": "behavioral" | "technical" | "general", "pageIds": (string | null)[] }',
    );
  } else {
    parts.push(
      'Return ONLY JSON of this exact shape: { "points": string[], "cues": string[], "type": "behavioral" | "technical" | "general" }',
    );
  }
  parts.push(
    "cues: exactly one per point, same order — a 2-6 word prompt for that point, with the same STAR label where the point has one.",
  );
  if (pagesBlock) {
    parts.push(
      'pageIds: exactly one per point, same order — the exact "page id" from a YOUR OWN PROJECT PAGES heading that point drew a concrete detail from, or null when it did not draw on a page. Never invent an id and never cite a page you were not shown.',
    );
  }
  return parts.join("\n");
}
