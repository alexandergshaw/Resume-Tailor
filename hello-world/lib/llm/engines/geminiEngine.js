import {
  generateTailoredResumeDraft,
  generateTailoredCoverLetterDraft,
  generateTailoredHiringEmailDraft,
} from "@/lib/llm/tailorResume";
import { runIdealChain } from "@/lib/llm/ideal/geminiIdealChain";

// Gemini document-generation engine: the existing LLM line-rewrite pipeline,
// wrapped in the shared engine interface so it can be swapped with the external
// Resume Tailor API behind /api/tailor.
//
// All three engine methods return the normalized shape consumed by the route:
//   resume:       { engine, result, resultLines, jobTitle, companyName }
//   coverLetter:  { engine, result, resultLines }
//   hiringEmail:  { engine, subject, bodyLines }
// Gemini fills the user's uploaded template client-side, so it never returns a
// finished document (no docxB64) — the hiring email never had a template to
// begin with; it's short plain text, not a filled document.
//
// N105 (the Ideal level) is an engine CAPABILITY: `supportsIdeal` is true here
// and `tailorIdeal` runs the chain in lib/llm/ideal/geminiIdealChain.js. Gemini
// is the only engine that has it - embedded is deterministic and cannot author
// a hypothetical, and external never receives the user's resume text, so it
// cannot ground an application-ready draft (research F-1). The route refuses
// the Ideal level for any engine whose flag is not true, on the engine that
// is RESOLVED after the external->gemini fallback.
//   ideal:  { engine, postingAnalysis, keywordMap,
//             hypothetical:              { result, resultLines, jobTitle, companyName },
//             applicationReadyCandidate: { result, resultLines, jobTitle, companyName } }
export const geminiEngine = {
  name: "gemini",

  supportsIdeal: true,

  async tailorResume(options) {
    const draft = await generateTailoredResumeDraft(options);
    return { engine: "gemini", ...draft };
  },

  async tailorCoverLetter(options) {
    const draft = await generateTailoredCoverLetterDraft(options);
    return { engine: "gemini", ...draft };
  },

  async tailorHiringEmail(options) {
    const draft = await generateTailoredHiringEmailDraft(options);
    return { engine: "gemini", ...draft };
  },

  async tailorIdeal(options) {
    const chain = await runIdealChain(options);
    return { engine: "gemini", ...chain };
  },
};
