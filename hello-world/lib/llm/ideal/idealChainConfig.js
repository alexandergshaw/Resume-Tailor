// N105 Step 3b - the constants and JSON schemas the Gemini Ideal chain runs on.
// Pure data: no imports, no I/O. The chain itself is geminiIdealChain.js.
//
// ---------------------------------------------------------------------------
// THE DURATION BUDGET (PL-14 / R-9 / K13) - ONE NUMBER, READ TOGETHER
// ---------------------------------------------------------------------------
// The chain is at most FOUR sequential generateContent calls: an optional
// schema-free urlContext read (URL-only postings), posting analysis +
// keyword map, the hypothetical draft, then the application-ready draft.
//
// Every stage sets `config.httpOptions.timeout` (per call, client-side, and
// absent from the request body). Retries are bounded at ONE ATTEMPT, and that
// is a MEASURED property of the transport, not a setting this file can make:
// in the pinned @google/genai 2.6.0, `models.generateContent` goes through
// `apiCall`, which is a bare `fetch` unless the CLIENT was constructed with
// `httpOptions.retryOptions` - and the shared client from getGeminiClient()
// is constructed with only an apiKey. The "default maxRetries 2, so 3 requests
// per stage" figure in the research ledger (A9) describes the INTERACTIONS
// transport; it does not apply to this chain, which uses generateContent only.
//
// Two things follow, and both are deliberate:
//
//   * NO `retryOptions` KEY IS SET ON THE CALL. Per-call `retryOptions` is
//     IGNORED by generateContent (measured; see
//     app/api/experience/knowledge/route.js), so writing one here would be a
//     claim the transport does not honour. Setting it on the shared client is
//     refused too: getGeminiClient() memoises one client that other features
//     share, and a retry policy there would reach all of them.
//   * THE WORST CASE IS stages x attempts x timeout = 4 x 1 x 60 s = 240 s,
//     which fits under the 300 s `maxDuration` the tailor route declares in
//     Step 4 with 60 s left for the scrape and document extraction that run
//     before the chain. If the shared client ever gains retryOptions,
//     IDEAL_STAGE_ATTEMPTS is the number that stops being true; a wire test
//     (geminiIdealChain.test.js) counts requests against a failing server so
//     that change turns red instead of silently multiplying the chain.
const IDEAL_MAX_STAGES = 4;
const IDEAL_STAGE_ATTEMPTS = 1;
export const IDEAL_STAGE_TIMEOUT_MS = 60_000;
export const IDEAL_WORST_CASE_MS =
  IDEAL_MAX_STAGES * IDEAL_STAGE_ATTEMPTS * IDEAL_STAGE_TIMEOUT_MS;

// Explicit per-stage output ceilings (R-6). Thinking is switched off on every
// stage so the whole budget is output and a MAX_TOKENS stop can only mean the
// output itself was too long. A one-page resume is roughly 1.5k tokens, so
// these leave a wide margin; hitting one is a hard failure (K7), never a
// partial document.
export const IDEAL_READ_MAX_OUTPUT_TOKENS = 16384;
export const IDEAL_ANALYSIS_MAX_OUTPUT_TOKENS = 8192;
export const IDEAL_DRAFT_MAX_OUTPUT_TOKENS = 8192;

// Bounds on what stage 1 may hand to the later prompts, so a hostile or merely
// enormous posting cannot grow every downstream prompt without limit.
export const MAX_REQUIREMENTS = 60;
export const MAX_KEYWORDS = 60;

export const POSTING_ITEM_KINDS = [
  "requirement",
  "responsibility",
  "preferred",
  "leadership",
  "tool",
  "industry",
];

// The resume sections a keyword can be assigned to (AC-9).
export const KEYWORD_SECTIONS = ["headline", "summary", "competencies", "experience"];

/**
 * Stage 1 response schema: the posting's own requirement lines and the
 * prioritized keyword map. `responseJsonSchema` vocabulary only (type,
 * properties, required, items, enum, minItems) - research B7. Line COUNTS and
 * lengths of the drafts are enforced after generation, not assumed from here.
 */
export function buildAnalysisSchema() {
  return {
    type: "object",
    properties: {
      jobTitle: { type: "string" },
      companyName: { type: "string" },
      requirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            kind: { type: "string", enum: POSTING_ITEM_KINDS },
          },
          required: ["text", "kind"],
        },
      },
      keywordMap: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            section: { type: "string", enum: KEYWORD_SECTIONS },
            priority: { type: "integer" },
            requirementIndex: { type: "integer" },
          },
          required: ["keyword", "section", "priority"],
        },
      },
    },
    required: ["jobTitle", "companyName", "requirements", "keywordMap"],
  };
}

/**
 * Stages 2 and 3 response schema: one resume as an array of line strings,
 * pinned to the template's slot count with minItems/maxItems (R-7).
 */
export function buildDraftSchema(lineCount) {
  return {
    type: "object",
    properties: {
      resultLines: {
        type: "array",
        items: { type: "string" },
        minItems: lineCount,
        maxItems: lineCount,
      },
    },
    required: ["resultLines"],
  };
}
