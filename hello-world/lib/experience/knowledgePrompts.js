// The two prompts the knowledge-page scope pipeline sends to the model, and
// the one parser that turns a response back into a value this app trusts.
//
// Pure strings and pure parsing: no fetch, no Supabase, no React. Neither
// prompt is derived from lib/copilot/answerPrompts.js's own wording — that
// module answers a live interview question over a different budget and a
// different authority sentence, and copying its strings would couple two
// prompts that must be free to diverge.
//
// TWO RULES THAT SHAPE BOTH PROMPTS, EACH EARNED BY A MEASURED DEFECT:
//
//  1. THE OUTPUT SHAPE IS SPECIFIED POSITIVELY, NEVER ONLY FORBIDDEN. "An
//     overview of every page beneath this one" is exactly the prompt that
//     makes a model reach for a table (1c U-6 #11), and this app's markdown
//     renderer has no table support at all — it renders one as literal pipe
//     characters. Telling the model "do not use a table" still puts the
//     concept of a table in front of it; the fix that actually works is
//     never naming tables or images at all, and instead fully specifying
//     what a good answer looks like (short prose paragraphs, an occasional
//     "-" bulleted list, headings no deeper than "###") so there is nothing
//     left for a table to be reached for.
//
//  2. NEITHER PROMPT ASKS THE MODEL TO AUTHOR A CITATION IN PROSE. A sibling
//     feature's prompt was corrected for exactly this: a model-invented URL
//     or markdown link inside the answer text is exactly what
//     lib/tracking/citationResidue.js's residue scanner strips out downstream
//     (Wave 5), so asking for one spends the model's effort manufacturing
//     text another module is going to remove. The question prompt instead
//     asks for page ids in a SEPARATE, STRUCTURED JSON field
//     (`citedPageIds`) — a citation is a fact about which pages were used,
//     reported once, not a link woven into the prose and repeated per claim.
//     `resolveCitedPageIds` (knowledgeScope.js) is the only thing that turns
//     that field into a stored citation, and it does so by id against a
//     whitelist, never by trusting the model's own link syntax.

// The character budget for the packed context block, and the label the
// pipeline's own exclusion notices use. AC-4.4 keeps this repo's existing
// 12000 (already MAX_PAGES_CHARS at app/api/copilot/answer/route.js), with
// its justification replaced rather than its value: the "single relevant
// page gets 3,973 characters" reasoning describes a pre-fix defect, not this
// checkout's behaviour — a lone relevant page today receives 11,597 of
// 12,000 (§7 C10). NOTICE_RESERVE_CHARS (knowledgeBase.js:127) is subtracted
// from the caller's budget before page packing starts, so the EFFECTIVE
// per-page budget is 400 characters less than the nominal one; stated here
// as its own constant so a reader does not have to re-derive it and get 12000
// wrong by assuming no reserve exists.
export const KNOWLEDGE_BUDGET = 12000;
export const KNOWLEDGE_BUDGET_LABEL = "context budget";
export const KNOWLEDGE_EFFECTIVE_PAGE_BUDGET = 11600; // 12000 - NOTICE_RESERVE_CHARS (400)

const SHAPE_INSTRUCTIONS =
  "Write in short prose paragraphs, two to four sentences each. Use an occasional bulleted list -- " +
  'lines starting with "-" -- only where a flat list of items genuinely reads better than a paragraph. ' +
  'Use a heading only when it helps orient the reader, and never nest headings deeper than "###".';

// buildScopeSummaryPrompt({ block, scopeLabel, pagesInScope, pagesIncluded }) -> string.
//
// `block` is the exact context block buildKnowledgeBaseBlock produced (Wave 4
// caller), reproduced byte-for-byte -- this function never rewrites, trims or
// re-escapes it. `pagesInScope`/`pagesIncluded` drive a plain-English
// coverage caveat so the model does not describe a partial scope as though it
// were the whole one; when either is missing the caveat degrades to a
// content-only version rather than guessing a count.
export function buildScopeSummaryPrompt(input) {
  const src = input && typeof input === "object" ? input : {};
  const block = typeof src.block === "string" ? src.block : "";
  const scopeLabel = typeof src.scopeLabel === "string" && src.scopeLabel ? src.scopeLabel : "this knowledge base";
  const pagesInScope = Number.isInteger(src.pagesInScope) ? src.pagesInScope : null;
  const pagesIncluded = Number.isInteger(src.pagesIncluded) ? src.pagesIncluded : null;

  const coverageNote =
    pagesInScope !== null && pagesIncluded !== null && pagesIncluded < pagesInScope
      ? ` Only ${pagesIncluded} of ${pagesInScope} pages in this scope are shown to you below; say only what these pages actually support.`
      : " Say only what the pages shown to you below actually support.";

  return [
    `You are summarising the user's own knowledge-base pages for ${scopeLabel}.`,
    "Below is the material from those pages, exactly as the user wrote it.",
    SHAPE_INSTRUCTIONS,
    `Write an honest overview of what this material covers.${coverageNote} Do not invent facts, employers, ` +
      "projects or outcomes that are not in the material below.",
    "Return ONLY one JSON document of this exact shape, with no surrounding prose: " +
      '{"answer": "<the overview, written with the shape above>"}',
    "----- KNOWLEDGE BASE MATERIAL -----",
    block,
  ].join("\n\n");
}

// buildScopeAnswerPrompt({ block, scopeLabel, question }) -> string.
//
// Same block/shape discipline as the summary prompt, plus the structured
// citation field: the model is told the id in each page heading's
// parentheses, asked to report which ids it actually drew on, and explicitly
// told NOT to write a link or a reference mark inside the answer text itself
// -- see this file's header for why that instruction exists at all.
export function buildScopeAnswerPrompt(input) {
  const src = input && typeof input === "object" ? input : {};
  const block = typeof src.block === "string" ? src.block : "";
  const scopeLabel = typeof src.scopeLabel === "string" && src.scopeLabel ? src.scopeLabel : "this knowledge base";
  const question = typeof src.question === "string" ? src.question : "";

  return [
    `You are answering one question using only the user's own knowledge-base pages for ${scopeLabel}.`,
    "Below is the material from those pages, exactly as the user wrote it. Each page is introduced by " +
      "its own heading, which names that page's id in parentheses.",
    SHAPE_INSTRUCTIONS,
    "Answer only from the material below. If it does not contain enough to answer, say so plainly " +
      "instead of guessing or filling gaps from outside knowledge.",
    "Report which pages you actually drew on by their page id (the id in each heading's parentheses), " +
      'in a "citedPageIds" field -- never by title, and never by writing a link or a reference mark ' +
      "inside the answer text itself.",
    "Return ONLY one JSON document of this exact shape, with no surrounding prose: " +
      '{"answer": "<the answer, written with the shape above>", ' +
      '"citedPageIds": ["<page id>", "..."], "answeredFromPages": true or false}',
    "----- KNOWLEDGE BASE MATERIAL -----",
    block,
    "----- QUESTION -----",
    question,
  ].join("\n\n");
}

// The single fenced-code-block matcher, used with the GLOBAL flag so every
// fence in the text is found -- never just the first. That is the hardening
// itself: lib/llm/extractEmployment.js's parseModelJson uses this same
// pattern non-greedy and un-global, so it takes the FIRST fenced block and
// silently discards everything after it. 1g measured the attack that makes
// that a security defect here: a hostile page body can instruct the model to
// open its reply with a decoy JSON fence -- one with a real, in-scope
// citedPageIds it read out of the block's own heading -- followed by the
// model's own honest fence. The non-greedy, first-match parser would return
// the decoy, which then passes the citation whitelist and renders as grounded
// and cited while the model's real answer is discarded without a trace.
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

function findFences(text) {
  const matches = [];
  let m;
  // A fresh RegExp per call: FENCE_RE carries the `g` flag, whose `lastIndex`
  // is mutated by `.exec`, so reusing the module-level constant across calls
  // without resetting it would silently start each later call mid-string.
  const re = new RegExp(FENCE_RE.source, FENCE_RE.flags);
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: re.lastIndex, content: m[1] });
  }
  return matches;
}

function envelopeFailure(reason) {
  return { ok: false, answer: "", citedPageIds: [], answeredFromPages: null, reason };
}

// parseAnswerEnvelope(rawText) -> { ok, answer, citedPageIds, answeredFromPages, reason }.
//
// reason ∈ "ok" | "multi-fence" | "trailing-text" | "not-json" | "wrong-shape".
//
// ONE WHOLE JSON DOCUMENT OR A FAILURE -- NEVER A SALVAGE (SEC-K3):
//  - More than one fenced block anywhere in the text is a rejection. Neither
//    fence is read, because there is no principled way to prefer one over the
//    other, and preferring either one is exactly the decoy-fence exploit this
//    hardening exists to close.
//  - Exactly one fenced block is accepted only when nothing but whitespace
//    sits before or after it -- trailing prose ("P.S. ..."), a preamble
//    ("Sure, here you go:"), or any other non-whitespace outside the fence is
//    a rejection, not a thing to be trimmed away and forgiven.
//  - No fence at all falls back to treating the WHOLE trimmed text as the
//    JSON document itself (the model replied bare, as
//    `responseMimeType: "application/json"` usually produces).
//
// FIELDS ARE READ BY NAME, INDIVIDUALLY, NEVER SPREAD AND NEVER
// Object.assign-ED into anything. JSON.parse places a `__proto__` key as an
// ordinary OWN property, never touching the real prototype chain by itself
// -- but `Object.assign(target, parsed)` copies it back out via a normal
// property SET, which DOES trigger the exotic `__proto__` accessor and swaps
// `target`'s prototype (1g, measured). Reading `parsed.answer` and
// `parsed.citedPageIds` one at a time, as this function does, never performs
// that copy.
//
// `citedPageIds` is passed through UNFILTERED when present, and defaults to
// `[]` when absent entirely -- the summary prompt never asks for it, so a
// caller sharing this one parser across both prompts must not have the
// summary path fail as "wrong-shape" for omitting a field it was never asked
// to supply. Validating each individual id (a real string? a real page in
// scope?) is resolveCitedPageIds's job, one module over, not this parser's.
//
// `answeredFromPages` is `true`/`false` only when the parsed value is
// actually a boolean; anything else -- omitted, a string, a number --
// becomes `null`, the SQL-NULL "the pipeline ran but this is unclear" state
// (see the migration's own column comment), never guessed at.
export function parseAnswerEnvelope(rawText) {
  const text = typeof rawText === "string" ? rawText : "";
  const trimmed = text.trim();
  if (!trimmed) return envelopeFailure("not-json");

  const fences = findFences(trimmed);
  let jsonText;

  if (fences.length > 1) {
    return envelopeFailure("multi-fence");
  }
  if (fences.length === 1) {
    const fence = fences[0];
    const before = trimmed.slice(0, fence.start);
    const after = trimmed.slice(fence.end);
    if (before.trim() !== "" || after.trim() !== "") {
      return envelopeFailure("trailing-text");
    }
    jsonText = fence.content.trim();
  } else {
    jsonText = trimmed;
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return envelopeFailure("not-json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return envelopeFailure("wrong-shape");
  }

  const answer = parsed.answer;
  if (typeof answer !== "string") return envelopeFailure("wrong-shape");

  const citedPageIdsRaw = parsed.citedPageIds;
  const citedPageIds = citedPageIdsRaw === undefined ? [] : citedPageIdsRaw;
  if (!Array.isArray(citedPageIds)) return envelopeFailure("wrong-shape");

  const answeredFromPagesRaw = parsed.answeredFromPages;
  const answeredFromPages = typeof answeredFromPagesRaw === "boolean" ? answeredFromPagesRaw : null;

  return { ok: true, answer, citedPageIds, answeredFromPages, reason: "ok" };
}
