// THE SHARED CONTRACT for the per-term detail of the tech-buzzwords row.
//
// One term, opened on demand into a short general explanation. This module owns
// the two things both sides of that wire have to agree on -- the key a detail is
// stored and looked up under, and the longest term the detail route will accept
// -- so the client's store and the server's validation cannot drift apart.
// Everything here is PURE: no React, no network, no storage, no `app/` import.

import { normalizeQuestion } from "./questions.js";

// The longest term the detail route accepts. The generator drops any term longer
// than this (techTermsGen.js), so a chip the reader sees is always one the route
// will take.
export const TECH_TERM_MAX_CHARS = 80;

function text(value) {
  return typeof value === "string" ? normalizeQuestion(value) : "";
}

/**
 * The one key a detail record is stored and looked up under.
 *
 * THE KEY IS THE GENERATION GUARD, exactly as expansionKey's is: it carries the
 * normalised question, the term and the grounding, so a response that settles
 * under a key the UI no longer computes (a redraft, another posting, a different
 * term) is simply never read. No cancellation, no token, no bookkeeping.
 *
 * `engine` is optional and defaults to empty. It is in the key so a record
 * written under one engine is never served under another.
 *
 * Total by construction: never throws, always returns a string.
 */
export function techTermDetailKey({ question, term, applicationId, engine } = {}) {
  return [
    text(question),
    text(term),
    typeof applicationId === "string" ? applicationId.trim() : "",
    typeof engine === "string" ? engine.trim() : "",
  ].join("::");
}
