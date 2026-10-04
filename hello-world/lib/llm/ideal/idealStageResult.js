// N105 Step 3b - reading ONE chain stage's response, and turning its text into
// the values the chain carries forward. Pure: takes a response object or a
// string, returns data or throws a stage error. No client, no I/O.
//
// THE RULE THIS FILE EXISTS TO ENFORCE (K7, R-5): a stage is either COMPLETE
// or it throws. The tailor path (tailorResume.js) never reads `finishReason`,
// so a schema-constrained document cut off at the output cap would parse as a
// shorter-but-valid-looking draft and ship. Here the finish reason is checked
// BEFORE the text is looked at, and only `STOP` passes - MAX_TOKENS, a safety
// block, a recitation stop, a missing candidate and a missing finish reason are
// all the same outcome: the whole run fails and produces no artifact.
import {
  KEYWORD_SECTIONS,
  MAX_KEYWORDS,
  MAX_REQUIREMENTS,
  POSTING_ITEM_KINDS,
} from "@/lib/llm/ideal/idealChainConfig";

// codes: "model-call" | "blocked" | "truncated" | "stopped" | "empty" |
//        "unparseable" | "invalid-shape" | "bad-input"
export function stageError(stage, code, message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.name = "IdealChainError";
  err.stage = stage;
  err.code = code;
  return err;
}

const URL_READ_SUCCESS = "URL_RETRIEVAL_STATUS_SUCCESS";

// The urlContext tool reports, per URL, whether it actually retrieved the page.
// A page behind a paywall or an error still yields fluent model text (an
// apology, a guess), which would then be analysed as if it were the posting.
// When the metadata is PRESENT and no URL succeeded, the read failed. When it
// is absent nothing can be concluded, so nothing is rejected on that basis.
function assertUrlWasRead(candidate, stage) {
  const urls = candidate?.urlContextMetadata?.urlMetadata;
  if (Array.isArray(urls) && urls.length > 0 && !urls.some((u) => u?.urlRetrievalStatus === URL_READ_SUCCESS)) {
    throw stageError(stage, "empty", "The job posting link could not be read. Nothing was produced.");
  }
}

/**
 * The text of a COMPLETE response, or a thrown stage error.
 *
 * `response.text` alone cannot tell a finished answer from a truncated one:
 * both are strings. The finish reason is the only thing that can.
 *
 * `urlRead` marks the schema-free urlContext stage, where the tool's own
 * retrieval status is checked as well.
 */
export function readStageText(response, stage, { urlRead = false } = {}) {
  const candidate = response?.candidates?.[0];
  if (!candidate) {
    const block = response?.promptFeedback?.blockReason;
    throw stageError(
      stage,
      "blocked",
      `The model returned no answer for the ${stage} step${block ? ` (blocked: ${block})` : ""}. Nothing was produced.`,
    );
  }
  const finishReason = candidate.finishReason ?? null;
  if (finishReason === "MAX_TOKENS") {
    throw stageError(
      stage,
      "truncated",
      `The model ran out of output space during the ${stage} step, so the result would have been incomplete. Nothing was produced.`,
    );
  }
  if (finishReason !== "STOP") {
    throw stageError(
      stage,
      "stopped",
      `The model stopped the ${stage} step early (${finishReason ?? "no finish reason"}). Nothing was produced.`,
    );
  }
  if (urlRead) assertUrlWasRead(candidate, stage);
  const text = typeof response.text === "string" ? response.text.trim() : "";
  if (!text) {
    throw stageError(stage, "empty", `The model returned an empty answer for the ${stage} step. Nothing was produced.`);
  }
  return text;
}

/** JSON.parse that throws a stage error. Strict on purpose: no regex rescue. */
export function parseStageJson(text, stage) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw stageError(stage, "unparseable", `The model's ${stage} answer was not valid JSON. Nothing was produced.`, cause);
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Stage 1 output -> { jobTitle, companyName, postingAnalysis, keywordMap }.
 *
 * Shape-validates and normalizes only. Whether a requirement or keyword is
 * actually IN the posting (AC-8/AC-9 grounding) is the orchestrator's job
 * (Step 3c), not this stage's: this is the model's claim, normalized.
 *
 * Ids are minted HERE (q1, q2, ...), never taken from the model, so the
 * span-identity discipline holds from the first stage on. A malformed ITEM is
 * dropped; a malformed ENVELOPE (a missing list) fails the stage.
 */
export function normalizeAnalysis(parsed, stage = "analysis") {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw stageError(stage, "invalid-shape", `The model's ${stage} answer was not an object. Nothing was produced.`);
  }
  if (!Array.isArray(parsed.requirements) || !Array.isArray(parsed.keywordMap)) {
    throw stageError(
      stage,
      "invalid-shape",
      `The model's ${stage} answer was missing its requirements or keyword list. Nothing was produced.`,
    );
  }

  const seenText = new Set();
  const requirements = [];
  // model index -> minted id, so a keyword's requirementIndex survives the
  // dropping of malformed items and the de-duplication below.
  const idByModelIndex = new Map();
  parsed.requirements.forEach((item, modelIndex) => {
    if (requirements.length >= MAX_REQUIREMENTS) return;
    const text = cleanText(typeof item === "string" ? item : item?.text);
    if (!text) return;
    const key = text.toLowerCase();
    if (seenText.has(key)) {
      idByModelIndex.set(modelIndex, requirements.find((r) => r.text.toLowerCase() === key).id);
      return;
    }
    seenText.add(key);
    const kind = POSTING_ITEM_KINDS.includes(item?.kind) ? item.kind : "requirement";
    const id = `q${requirements.length + 1}`;
    requirements.push({ id, text, kind });
    idByModelIndex.set(modelIndex, id);
  });

  const seenKeyword = new Set();
  const entries = [];
  parsed.keywordMap.forEach((item, order) => {
    const keyword = cleanText(item?.keyword);
    if (!keyword || !KEYWORD_SECTIONS.includes(item?.section)) return;
    const key = keyword.toLowerCase();
    if (seenKeyword.has(key)) return;
    seenKeyword.add(key);
    const priority = Number.isFinite(item.priority) && item.priority >= 1 ? Math.round(item.priority) : order + 1;
    entries.push({
      keyword,
      section: item.section,
      priority,
      requirementId: idByModelIndex.get(item.requirementIndex) ?? null,
      order,
    });
  });
  // Ordered by the stated priority signal (AC-9); ties keep the model's order.
  entries.sort((a, b) => a.priority - b.priority || a.order - b.order);

  return {
    jobTitle: cleanText(parsed.jobTitle),
    companyName: cleanText(parsed.companyName),
    postingAnalysis: { requirements },
    keywordMap: {
      entries: entries.slice(0, MAX_KEYWORDS).map(({ keyword, section, priority, requirementId }) => ({
        keyword,
        section,
        priority,
        requirementId,
      })),
    },
  };
}

function fitLinesToCount(lines, targetCount) {
  if (lines.length === targetCount) return lines;
  if (lines.length < targetCount) return [...lines, ...new Array(targetCount - lines.length).fill("")];
  return lines.slice(0, targetCount);
}

/**
 * Stage 2/3 output -> { result, resultLines }, fitted to the template's slot
 * count the same way the level 1-5 path fits (pad with blanks / cut the tail),
 * because the client fills the user's template slot by slot.
 *
 * Non-string entries and an all-blank draft fail the stage: a draft the model
 * "completed" as nothing is not a document.
 */
export function normalizeDraft(parsed, lineCount, stage) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.resultLines)) {
    throw stageError(stage, "invalid-shape", `The model's ${stage} answer had no resume lines. Nothing was produced.`);
  }
  if (parsed.resultLines.some((line) => typeof line !== "string")) {
    throw stageError(stage, "invalid-shape", `The model's ${stage} answer contained a non-text line. Nothing was produced.`);
  }
  if (!parsed.resultLines.some((line) => line.trim())) {
    throw stageError(stage, "empty", `The model's ${stage} answer was blank. Nothing was produced.`);
  }
  const resultLines = fitLinesToCount(parsed.resultLines, lineCount);
  return { result: resultLines.join("\n").trim(), resultLines };
}
