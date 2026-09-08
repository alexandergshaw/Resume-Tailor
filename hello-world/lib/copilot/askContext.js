// The labelled context blocks the ask-AI box answers from, and the honesty
// flags that say which of them the answering branch actually had.
//
// A NEW, ZERO-IMPORT LEAF rather than a fourth caller of an existing renderer.
// Two renderers already exist for the tracked-application shape and NEITHER is
// server-side-safe here: `buildApplicationContextString`
// (lib/chat/chatbot.js) sits in a module whose very first import is
// `@/app/settings/engine`, which is `"use client"` + localStorage, and
// `renderApplicationsSection` (lib/chat/applicationContext.js) renders the
// WIRE-shaped projection the chat client posts, not the raw Supabase row this
// route fetches for itself. lib/chat/applicationContext.js's own header
// documents the client-module poisoning risk that keeps this file importing
// nothing at all.
//
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE. Half of a tracked application is
// the user's OWN record -- `applications.status`, and every
// `interview_stages.notes` / `interview_stages.interviewer_names` -- and the
// other half is SCRAPED THIRD-PARTY TEXT from an arbitrary job board
// (`positions.description`, `.company`, `.title`, `.url`). They must never
// share a label. An answer that reports the candidate's own private note back
// as something "the company said" is a fabrication about the employer, and the
// scraped half is attacker-controlled text that has to be attributable to the
// posting rather than to us. The two label constants below are therefore
// deliberately different in WORDING, not merely in position, and the route's
// suite asserts that on the built prompt (a model-output test cannot tell
// "labelled correctly" from "got lucky").

// The user's own record-keeping. Named in the second person because that is
// what stops the model repeating it back as a third-party fact.
const OWN_RECORD_LABEL =
  "YOUR OWN RECORD OF THIS APPLICATION (you wrote all of this yourself; never report it as something the employer said)";

// Scraped, attacker-controlled text. Anything drawn from here is attributable
// to the POSTING, never to the employer as fact -- a job ad is a claim.
const SCRAPED_POSTING_LABEL =
  "SCRAPED JOB POSTING (third-party text copied from the employer's public listing; attribute anything from it to the posting, never to us and never to the employer as established fact)";

const RESUME_LABEL = "YOUR SUBMITTED RESUME (the exact document sent for this application)";
const COVER_LETTER_LABEL = "YOUR SUBMITTED COVER LETTER (the exact document sent for this application)";
const PAGES_LABEL = "YOUR PROFESSIONAL EXPERIENCE PAGES (your own knowledge base, ranked for this question)";

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

function line(label, value) {
  const v = str(value);
  return v ? `${label}: ${v}` : "";
}

// One stage, rendered so the user's own free text is unmistakably theirs.
function renderStage(stage) {
  if (!stage || typeof stage !== "object") return "";
  const head = [str(stage.stage_name) || "Interview stage", str(stage.stage_type) ? `(${str(stage.stage_type)})` : ""]
    .filter(Boolean)
    .join(" ");
  const parts = [`- ${head}`];
  const scheduled = line("  Scheduled", stage.scheduled_at);
  if (scheduled) parts.push(scheduled);
  if (Number.isFinite(stage.duration_minutes)) parts.push(`  Duration: ${stage.duration_minutes} minutes`);
  const outcome = line("  Outcome", stage.outcome);
  if (outcome) parts.push(outcome);
  const names = line("  Interviewers you recorded", stage.interviewer_names);
  if (names) parts.push(names);
  const notes = line("  Your own notes", stage.notes);
  if (notes) parts.push(notes);
  return parts.join("\n");
}

function renderOwnRecord(tracking) {
  if (!tracking || typeof tracking !== "object") return "";
  const parts = [
    line("Status you set", tracking.status),
    line("You tracked this on", tracking.trackedAt),
    line("You applied on", tracking.appliedAt),
    line("The link you applied through", tracking.applicationUrl),
  ].filter(Boolean);

  const stages = Array.isArray(tracking.stages) ? tracking.stages.map(renderStage).filter(Boolean) : [];
  if (stages.length > 0) {
    parts.push(`Interview stages you have recorded:\n${stages.join("\n")}`);
  }
  return parts.join("\n");
}

function renderScrapedPosting(tracking) {
  if (!tracking || typeof tracking !== "object") return "";
  const parts = [
    line("Company", tracking.company),
    line("Title", tracking.title),
    line("Posting URL", tracking.url),
    line("Posted", tracking.postedAt),
  ].filter(Boolean);
  const description = str(tracking.description);
  if (description) parts.push(`Description as published:\n${description}`);
  return parts.join("\n");
}

/**
 * @param {{
 *   tracking?: object|null,
 *   resume?: string,
 *   coverLetter?: string,
 *   knowledge?: { block?: string, includedCount?: number, inScopeCount?: number, truncated?: boolean },
 * }} input
 * @returns {{ blocks: Array<{label: string, text: string}>, sources: object, empty: boolean }}
 *
 * `sources` is derived HERE, from the text that actually made it into a block
 * -- never asserted by the caller and never by the client. The shipped bug this
 * shape exists to prevent is a caption claiming "from your own project pages"
 * beside an answer that was drafted with no page text in it at all.
 */
export function buildAskBlocks({ tracking = null, resume = "", coverLetter = "", knowledge = {} } = {}) {
  const ownRecord = renderOwnRecord(tracking);
  const scraped = renderScrapedPosting(tracking);
  const resumeText = str(resume);
  const coverLetterText = str(coverLetter);
  const knowledgeBlock = str(knowledge?.block);

  const blocks = [];
  // ORDER IS LOAD-BEARING for the labelling guarantee, not for ranking: the
  // user's own record is rendered under its own heading BEFORE the scraped
  // half, so no note can ever be read as trailing content of the posting block.
  if (ownRecord) blocks.push({ label: OWN_RECORD_LABEL, text: ownRecord });
  if (scraped) blocks.push({ label: SCRAPED_POSTING_LABEL, text: scraped });
  if (resumeText) blocks.push({ label: RESUME_LABEL, text: resumeText });
  if (coverLetterText) blocks.push({ label: COVER_LETTER_LABEL, text: coverLetterText });
  if (knowledgeBlock) blocks.push({ label: PAGES_LABEL, text: knowledgeBlock });

  const inScopeCount = Number.isFinite(knowledge?.inScopeCount) ? knowledge.inScopeCount : 0;
  const includedCount = Number.isFinite(knowledge?.includedCount) ? knowledge.includedCount : 0;

  return {
    blocks,
    sources: {
      tracking: !!(ownRecord || scraped),
      resume: !!resumeText,
      coverLetter: !!coverLetterText,
      pagesInScope: inScopeCount,
      pagesIncluded: includedCount,
    },
    // Nothing at all to answer from. The route turns this into a refusal
    // BEFORE constructing a model client: calling the model with an empty
    // context would spend money to be told nothing is there.
    empty: blocks.length === 0,
  };
}

/**
 * The one sentence that tells the reader what the answer was actually built
 * from, plus the knowledge-base truncation count when the budget dropped
 * pages.
 *
 * DROPPED PAGE TITLES ARE NEVER NAMED. A dropped page's title reaching the
 * response lets its terms read as backed evidence for a page nothing ever
 * looked at -- the same reason the answer route keeps `kb.droppedPages` out of
 * its own response. The COUNT is reported here (and deliberately is not on that
 * route) because this answer is one the candidate typed a question for and is
 * deliberately reading, so the "a notice would flicker between glanced-at
 * answers" argument that governs there does not transfer.
 */
export function askSourceLine(sources, { truncated = false } = {}) {
  const had = [];
  if (sources?.tracking) had.push("this application's tracking row");
  if (sources?.resume) had.push("your submitted resume");
  if (sources?.coverLetter) had.push("your submitted cover letter");
  if (sources?.pagesIncluded > 0) {
    had.push(`${sources.pagesIncluded} of your ${sources.pagesInScope} experience pages`);
  }

  const parts = [];
  parts.push(had.length > 0 ? `Answered from: ${had.join(", ")}.` : "Answered from: nothing was available.");
  if (truncated && sources?.pagesInScope > sources?.pagesIncluded) {
    parts.push(
      `Your knowledge base did not fit: ${sources.pagesIncluded} of your ${sources.pagesInScope} pages were used, ` +
        "and the rest were the lowest-ranked for this question.",
    );
  } else if (sources?.pagesInScope > 0 && sources?.pagesIncluded === 0) {
    parts.push("None of your experience pages could be included for this question.");
  }
  return parts.join(" ");
}
