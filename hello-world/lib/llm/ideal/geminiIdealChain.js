// N105 Step 3b - the Gemini Ideal CHAIN: up to four sequential generateContent
// calls orchestrated here, in our code. NOT one composite call.
//
//   stage 0  read     (URL-only postings) urlContext tool, NO schema -> posting text
//   stage 1  analysis posting requirements + prioritized keyword map (schema)
//   stage 2  hypothetical  the best-case reference draft (schema)
//   stage 3  application-ready  the strictly truthful draft (schema)
//
// WHY A CHAIN (research A11/B10, plan P-F4). On the configured model
// (gemini-2.5-flash) Google documents a tool and a JSON schema in ONE request
// as a Gemini-3-only preview (R-1), so no stage here carries both: stage 0 has
// the tool and no schema, the later stages have the schema and no tool, and a
// URL-only posting reaches them as TEXT. There is deliberately no Gemini-3
// model constant: every stage targets `getServerEnv().geminiModel`.
//
// WHY STAGES 2 AND 3 ARE SEQUENTIAL (design D-16). The application-ready draft
// is written with the hypothetical in view as a statement of target emphasis;
// it must exist first. No Promise.all across them.
//
// ATOMICITY (K7, UX-11). The function returns only when EVERY stage completed.
// Any stage that is truncated, blocked, unparseable or malformed throws, and
// the hypothetical already written is discarded with it: there is no partial
// artifact to ship. The checks live in idealStageResult.js.
//
// Every `config` field is nested INSIDE `config` (gemini-tools-nesting): the
// SDK silently drops anything else, with no warning.
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import {
  IDEAL_ANALYSIS_MAX_OUTPUT_TOKENS,
  IDEAL_DRAFT_MAX_OUTPUT_TOKENS,
  IDEAL_READ_MAX_OUTPUT_TOKENS,
  IDEAL_STAGE_TIMEOUT_MS,
  buildAnalysisSchema,
  buildDraftSchema,
} from "@/lib/llm/ideal/idealChainConfig";
import {
  buildAnalysisPrompt,
  buildApplicationReadyPrompt,
  buildHypotheticalPrompt,
  buildPostingReadPrompt,
} from "@/lib/llm/ideal/idealChainPrompts";
import {
  normalizeAnalysis,
  normalizeDraft,
  parseStageJson,
  readStageText,
  stageError,
} from "@/lib/llm/ideal/idealStageResult";

// The stage-0 prompt tells the model to answer with exactly this word when the
// page cannot be read; tolerate the case and punctuation a model may add.
const UNREADABLE_PATTERN = /^\W*unreadable\W*$/i;

// Per-call options shared by every stage. `httpOptions.timeout` is a CLIENT-side
// abort bound (absent from the request body); see idealChainConfig.js for why
// there is no retry key and what bounds the attempts. Thinking is off so the
// output ceiling is the whole budget.
function stageConfig(maxOutputTokens) {
  return {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens,
    httpOptions: { timeout: IDEAL_STAGE_TIMEOUT_MS },
  };
}

// One generateContent call -> the text of a COMPLETE response. A transport
// failure (HTTP error, client-side timeout abort) is rethrown as a stage error
// so the caller sees which step failed; the original is kept as `cause`.
async function runStage({ client, model, stage, prompt, config, urlRead = false }) {
  let response;
  try {
    response = await client.models.generateContent({ model, contents: prompt, config });
  } catch (cause) {
    throw stageError(stage, "model-call", `The model call for the ${stage} step did not complete. Nothing was produced.`, cause);
  }
  return readStageText(response, stage, { urlRead });
}

function assertHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw stageError("input", "bad-input", "The job posting link is not a web address. Nothing was produced.");
  }
  return parsed.href;
}

// Stage 0. Schema-free by construction: the tool is the ONLY special key.
async function readPostingFromUrl({ client, model, jobPostingUrl }) {
  const text = await runStage({
    client,
    model,
    stage: "read",
    prompt: buildPostingReadPrompt(assertHttpUrl(jobPostingUrl)),
    config: { ...stageConfig(IDEAL_READ_MAX_OUTPUT_TOKENS), tools: [{ urlContext: {} }] },
    urlRead: true,
  });
  if (UNREADABLE_PATTERN.test(text)) {
    throw stageError("read", "empty", "The job posting link could not be read. Nothing was produced.");
  }
  return text;
}

// A schema stage: JSON mime + schema, and NO tool.
async function runSchemaStage({ client, model, stage, prompt, schema, maxOutputTokens }) {
  const text = await runStage({
    client,
    model,
    stage,
    prompt,
    config: {
      ...stageConfig(maxOutputTokens),
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    },
  });
  return parseStageJson(text, stage);
}

/**
 * The whole Ideal chain. Resolves with the frozen engine shape (design section
 * 2) or throws a stage error (`err.stage`, `err.code`); never returns a partial.
 *
 *   { postingAnalysis, keywordMap,
 *     hypothetical:              { result, resultLines, jobTitle, companyName },
 *     applicationReadyCandidate: { result, resultLines, jobTitle, companyName } }
 *
 * Input is validated BEFORE the first request, so a refusal spends nothing.
 * `client`/`model` default to the app-wide client and configured model; they
 * are parameters only so a caller can pass a client built over a test server.
 */
export async function runIdealChain(
  { jobPosting, jobPostingUrl, resumeText, resumeFileName, templateLines, additionalContext, contextDocuments } = {},
  options = {},
) {
  const slots = Array.isArray(templateLines) ? templateLines.filter((line) => typeof line === "string") : [];
  if (slots.length === 0) {
    throw stageError("input", "bad-input", "Template lines are required to preserve resume layout fidelity.");
  }
  if (typeof resumeText !== "string" || !resumeText.trim()) {
    throw stageError("input", "bad-input", "The resume had no readable text, so there is nothing to ground an application-ready resume in.");
  }

  let postingText = typeof jobPosting === "string" ? jobPosting.trim() : "";
  if (!postingText && !jobPostingUrl) {
    throw stageError("input", "bad-input", "A job posting (text or link) is required.");
  }

  const client = options.client ?? getGeminiClient();
  const model = options.model ?? getServerEnv().geminiModel;

  // Pasted/scraped text wins; the URL is read only when there is no text.
  if (!postingText) {
    postingText = await readPostingFromUrl({ client, model, jobPostingUrl });
  }

  const analysisResult = normalizeAnalysis(
    await runSchemaStage({
      client,
      model,
      stage: "analysis",
      prompt: buildAnalysisPrompt({ postingText }),
      schema: buildAnalysisSchema(),
      maxOutputTokens: IDEAL_ANALYSIS_MAX_OUTPUT_TOKENS,
    }),
  );
  const { jobTitle, companyName, postingAnalysis, keywordMap } = analysisResult;
  const analysis = { postingAnalysis, keywordMap };
  const candidate = { resumeText, resumeFileName, additionalContext, contextDocuments };

  const hypotheticalDraft = normalizeDraft(
    await runSchemaStage({
      client,
      model,
      stage: "hypothetical",
      prompt: buildHypotheticalPrompt({ postingText, analysis, templateLines: slots, ...candidate }),
      schema: buildDraftSchema(slots.length),
      maxOutputTokens: IDEAL_DRAFT_MAX_OUTPUT_TOKENS,
    }),
    slots.length,
    "hypothetical",
  );

  const applicationReadyDraft = normalizeDraft(
    await runSchemaStage({
      client,
      model,
      stage: "application-ready",
      prompt: buildApplicationReadyPrompt({
        postingText,
        analysis,
        hypothetical: hypotheticalDraft,
        templateLines: slots,
        ...candidate,
      }),
      schema: buildDraftSchema(slots.length),
      maxOutputTokens: IDEAL_DRAFT_MAX_OUTPUT_TOKENS,
    }),
    slots.length,
    "application-ready",
  );

  return {
    postingAnalysis,
    keywordMap,
    hypothetical: { ...hypotheticalDraft, jobTitle, companyName },
    applicationReadyCandidate: { ...applicationReadyDraft, jobTitle, companyName },
  };
}
