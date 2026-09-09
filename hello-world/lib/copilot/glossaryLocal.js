// THE EMBEDDED PATH -- a verbatim-quoting glossary, not a refusal and not an
// empty box.
//
// `wantsEmbedded` returns true for an explicit "embedded" request, for
// RESUME_ENGINE=embedded, and -- the case that matters -- WHENEVER NO GEMINI KEY
// IS CONFIGURED AT ALL. So on a keyless deployment this is the whole feature,
// and saying so plainly is more useful than pretending otherwise.
//
// WHY QUOTING RATHER THAN REFUSING. This repo has decided this shape once
// already, in `askLocal.js`: "A refusal was the cheap option and was rejected...
// retrieval does not need a model... Every line this returns is copied
// character-for-character out of the candidate's own material." The bundled
// taxonomy contains ZERO conceptual terms, so nothing here can DEFINE a term
// deterministically and nothing can ANTICIPATE one. But something can QUOTE.
//
// IT ANSWERS A DIFFERENT QUESTION, AND THE UI MUST SAY SO. The Gemini path
// answers "what does this term mean?"; this one answers "why is this term here?"
// Both are useful thirty seconds before an interview. Conflating them is the
// failure -- which is why every term here carries an empty `definition` and a
// verbatim `evidence` sentence, and why the row's status is its own value rather
// than a thin `partial`.
//
// ZERO OUTBOUND, ZERO CLIENT: no model client is constructed on this path, no
// server env is read, and no grounded call is made.

import { explicitTermsFor, evidenceFor } from "./glossaryAnchors.js";
import { MAX_EXPLICIT_TERMS } from "./glossaryConstants.js";

/** A quoted sentence may run longer than a mined evidence snippet: it IS the content. */
const MAX_QUOTE_CHARS = 280;

/**
 * The `quotes-only` row for one posting. Terms are the A-terms and nothing else:
 * taxonomy canonicals the posting literally states, each with the sentence it
 * appears in, verbatim.
 *
 * `research_total` and `research_cursor` are both 0, so the worker's queue query
 * -- which selects on `research_pending`, a generated column over exactly that
 * pair -- can never select this row. A `quotes-only` row is finished by
 * construction, not by a flag someone has to remember to set.
 */
export function buildQuotesOnlyTerms(description) {
  const text = String(description || "");
  const terms = [];
  for (const term of explicitTermsFor(text).slice(0, MAX_EXPLICIT_TERMS)) {
    const evidence = evidenceFor(text, term);
    // NO AFFORDANCE WITHOUT CONTENT. A term with neither a definition nor a
    // quote would render as a dotted underline that opens an empty box, which is
    // the unacceptable answer -- so it is not stored at all.
    if (!evidence) continue;
    terms.push({
      term,
      kind: "explicit",
      category: "other",
      evidence: evidence.slice(0, MAX_QUOTE_CHARS),
      definition: "",
      provenance: "recalled",
    });
  }
  return terms;
}
