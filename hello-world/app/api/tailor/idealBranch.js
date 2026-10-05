// N105 Step 4 - the tailor route's Ideal branch, split into the two halves the
// route calls at different points. Both return `{ status, body }` (or data the
// route wraps) so the route stays the only place that builds a response.
//
//   gateIdealRequest   BEFORE the posting is scraped or any model is called:
//                      resolve the engine the run will actually use, then refuse
//                      (HTTP 422, no artifact) when it cannot run Ideal or the
//                      resume has no text.
//   runIdealBranch     AFTER the posting is known: run the pipeline and shape
//                      the response. The top level is the APPLICATION-READY
//                      resume (UX-42); the hypothetical rides in `ideal`.
//
// The branch is selected by the distinct `tailorMode` field and nothing else; it
// never reads `aggressiveness`, which stays clamped to 1..5 for every other run.
//
// A REGENERATE (N104) is this same request carrying the run it improves on; the
// branch hands it to regenerateBranch.js instead of running the pipeline plainly,
// and the response gains the closure report beside the usual body. A first run
// carries neither and is unchanged.
import { idealRefusalMessage } from "@/lib/tailor/tailorLevel";
import { runIdealPipeline } from "@/lib/llm/ideal/idealPipeline";
import { buildIdealRealMaterial } from "@/app/api/tailor/idealRealMaterial";
import { runRegenerateRequest } from "@/app/api/tailor/regenerateBranch";

// Ideal needs this engine; the refusal names it as the remedy.
const IDEAL_ENGINE = "gemini";

// The labels the engine picker shows (app/settings/engine.js, a client module
// this server file cannot import), so the refusal names what the user sees.
const ENGINE_LABELS = { embedded: "Embedded (no AI)", external: "Resume Tailor API" };

const FALLBACK_WARNING = "Resume Tailor API is not configured; generated with Gemini instead.";

function externalIsConfigured(engine) {
  return typeof engine.isConfigured === "function"
    ? Boolean(engine.isConfigured())
    : Boolean(process.env.RESUME_TAILOR_API_URL);
}

function refusal(code, extra, labels) {
  return {
    status: 422,
    body: {
      error: idealRefusalMessage(code, labels),
      refusal: { level: "ideal", code, ...extra },
    },
  };
}

/**
 * gateIdealRequest({ engineName, engine, getEngine, resumeText, resumeFileName })
 *
 *   => { refused: { status, body } }                 nothing may be generated
 *    | { engine, warnings }                          the engine the run will use
 *
 * The standard path discovers an unconfigured external service by catching
 * ENGINE_NOT_CONFIGURED from tailorResume and re-running on Gemini. Ideal must
 * not call tailorResume at all, so the same fallback is decided here, and only
 * THEN is `supportsIdeal` read: gating on the requested engine would refuse a
 * run that was about to land on Gemini.
 */
export function gateIdealRequest({ engineName, engine, getEngine, resumeText, resumeFileName }) {
  let resolved = engine;
  const warnings = [];
  if (engineName === "external" && !externalIsConfigured(engine)) {
    resolved = getEngine(IDEAL_ENGINE);
    warnings.push(FALLBACK_WARNING);
  }

  if (resolved.supportsIdeal !== true || typeof resolved.tailorIdeal !== "function") {
    return {
      refused: refusal(
        "engine-unsupported",
        { engine: resolved.name, requires: IDEAL_ENGINE },
        { engineLabel: ENGINE_LABELS[resolved.name] },
      ),
    };
  }
  if (!String(resumeText ?? "").trim()) {
    return { refused: refusal("empty-resume", {}, { fileName: resumeFileName }) };
  }
  return { engine: resolved, warnings };
}

// A stage error the chain or the orchestrator threw on purpose (its message is
// written for the user and ends "Nothing was produced.").
function isIdealFailure(err) {
  return err?.name === "IdealChainError";
}

/**
 * runIdealBranch({ engine, args, warnings, scraped })
 *
 *   args     what engine.tailorIdeal receives; args.resumeText also yields the
 *            real material the application-ready resume is checked against
 *   scraped  { description, company, jobTitle } from the posting URL, or ""s
 *
 * => { status, body }. A chain failure is a 4xx/5xx with the failed stage and NO
 * artifact: the run is atomic, a half-built pair is never returned (K7).
 */
export async function runIdealBranch({ engine, args, warnings, scraped, postingMeta }) {
  let out;
  let regeneration = null;
  try {
    const realMaterial = buildIdealRealMaterial(args.resumeText);
    regeneration = await runRegenerateRequest({ engine, args, realMaterial });
    out = regeneration ? regeneration.regenerated : await runIdealPipeline({ engine, args, realMaterial });
  } catch (err) {
    if (!isIdealFailure(err)) throw err;
    console.error("Error generating the Ideal resume pair:", err);
    return {
      status: err.code === "bad-input" ? 422 : 502,
      body: { error: err.message, failure: { stage: err.stage, code: err.code } },
    };
  }

  return {
    status: 200,
    body: {
      ...out,
      ...(regeneration
        ? {
            closure: regeneration.closure,
            confirm: regeneration.confirm,
            genuinelyUnqualified: regeneration.genuinelyUnqualified,
          }
        : {}),
      // The chain returns no bytes for the application-ready resume (the client
      // fills the user's template from `resultLines`), and the candidate's own
      // bytes are never forwarded: they would carry the pre-gate text.
      docxB64: "",
      coverLetterDocxB64: "",
      report: null,
      match: null,
      coverVariant: null,
      librarySuggestions: null,
      warnings,
      degraded: false,
      jobTitle: out.jobTitle || scraped.jobTitle || postingMeta.jobTitle,
      jobDescription: scraped.description,
      company: scraped.company || out.companyName || postingMeta.companyName || "",
      // Ideal is a resume-only run: no cover letter, no hiring email.
      coverLetterResult: "",
      coverLetterResultLines: [],
      coverLetterError: "",
      emailSubject: "",
      emailResultLines: [],
      emailError: "",
    },
  };
}
