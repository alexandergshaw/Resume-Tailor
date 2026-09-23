// N49/N51: the digest's "## Interview process" grammar -- the fixed heading,
// the strict per-line shape the attach step parses back, and the terminal-
// punctuation stripper several other modules share.
//
// IMPORTS NOTHING, DELIBERATELY (design.r3.md section 11.1; plan.r4.md
// diff-control R20). `lib/interviewPrep/prepConstants.js` reaches jsdom
// through several test-side importers, so if this module pulled in the
// given-name lexicon (directly or transitively) it would ship 100,000+ names
// to a client bundle through that path. Every export below is pure, total
// and never throws.

export const INTERVIEW_PROCESS_HEADING = "Interview process";

const GRAMMAR_LINE_RE = /^\s*[-*+]\s+(?:\*\*)?(Stage|Conducted by|Question):(?:\*\*)?[ \t]*(.*?)[ \t]*$/;
const KIND_OF = { Stage: "stage", "Conducted by": "role", Question: "question" };

/** True for a markdown heading line that names the interview-process
 *  section, tolerant of extra whitespace and case. */
export function isInterviewProcessHeading(line) {
  if (typeof line !== "string") return false;
  const m = /^##[ \t]+(.+?)[ \t]*$/.exec(line.trim());
  return !!m && m[1].replace(/\s+/g, " ").toLowerCase() === INTERVIEW_PROCESS_HEADING.toLowerCase();
}

/** STRICT parse of one grammar line, used for ATTACHMENT only: a drifted
 *  line simply does not attach (fails closed), it is never guessed at. */
export function parseGrammarLine(line) {
  if (typeof line !== "string") return null;
  const m = GRAMMAR_LINE_RE.exec(line);
  if (!m) return null;
  const item = m[2];
  const colon = line.indexOf(":");
  const itemOffset = item ? line.indexOf(item, colon + 1) : line.length;
  return { kind: KIND_OF[m[1]], item, itemOffset };
}

/** Removes the whole trailing run of sentence-final punctuation (and any
 *  whitespace between/after it). A fixpoint: stripTerminal(stripTerminal(x))
 *  === stripTerminal(x) for every x. Non-string input gives "". */
export function stripTerminal(text) {
  if (typeof text !== "string") return "";
  return text.trim().replace(/[.?!][.?!\s]*$/, "").trimEnd();
}
