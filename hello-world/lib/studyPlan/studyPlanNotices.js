// Pure copy selectors for the study plan (N157 SC-C): which egress notice to
// show for the client's engine, and the one template filler every study-plan
// surface uses. Design r2 section 4.4. No imports beyond the copy registry, no
// IO, no React.
//
// WHY THE NOTICE IS CHOSEN HERE AND NOT INLINE. The egress notice is a privacy
// claim about what leaves the browser, so it is selected by the engine the
// CLIENT chose and it OVER-STATES on any doubt: only a positively-embedded
// engine gets the "nothing is sent to an AI provider" copy. An unknown or
// missing engine, and the "external" engine, read as the Gemini notice, because
// the one dangerous direction is a false claim that nothing is sent. The server
// may still force the embedded engine, which the client cannot see; the Gemini
// notice then claims more egress than happens, which is the safe error.

import { STUDY_COPY } from "./studyPlanCopy.js";

/**
 * The egress notice for the client's engine choice: the embedded copy for the
 * embedded engine only, the Gemini copy for everything else.
 *
 * @param {{ engine?: string } | undefined} options
 * @returns {string}
 */
export function buildStudyPlanNotice(options) {
  return options?.engine === "embedded" ? STUDY_COPY.notice.embedded : STUDY_COPY.notice.gemini;
}

/**
 * Fills a copy template's `<slot>` markers from `slots`. A replacer FUNCTION is
 * used for every fill, never a replacement string, so a `$&` in a company name
 * or an error message is literal text and not a back-reference.
 *
 * @param {string} template
 * @param {Record<string, string | number>} slots
 * @returns {string}
 */
export function fillStudyCopy(template, slots) {
  return Object.entries(slots).reduce(
    (out, [key, value]) => out.replaceAll(`<${key}>`, () => String(value)),
    template,
  );
}
