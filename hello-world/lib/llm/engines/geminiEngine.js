import {
  generateTailoredResumeDraft,
  generateTailoredCoverLetterDraft,
  generateTailoredHiringEmailDraft,
} from "@/lib/llm/tailorResume";

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
export const geminiEngine = {
  name: "gemini",

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
};
