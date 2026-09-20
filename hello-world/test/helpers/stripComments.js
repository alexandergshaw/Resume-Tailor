import { readFileSync } from "node:fs";
import path from "node:path";

// Shared comment-stripping for source-text instruments -- tests that read a
// real .js file and assert something about its CODE, where a prose mention of
// the same symbol inside a comment must never satisfy (or defeat) the
// assertion. Several of these instruments used to carry their own byte-for-
// byte copy of this logic (route.test.js, finishAttempt.test.js,
// prepTriggerSeams.test.js, glossaryTriggerSeams.test.js, glossaryMount.test.js,
// and four PracticeClient/usePracticeCodeLanguage/PracticeSetup wiring tests),
// and every copy shared the same defect: it split on "\n" and matched a
// trailing `//` comment with `/.../ ` (no `/m`, no CRLF normalization). On a
// CRLF checkout (this repo's: core.autocrlf=true smudges every checkout to
// CRLF), `split("\n")` leaves a trailing "\r" on every line. `.` does not
// match "\r" and `$` with no `/m` flag matches only end-of-STRING, so the
// pattern never matches a line ending in "\r" -- the comment is never
// removed, and the instrument silently scans commented-out prose as if it
// were live code.
//
// Fixed here by normalizing line endings before splitting, so the exact same
// per-line regex behaves identically on LF and CRLF input.
function toLF(text) {
  return text.replace(/\r\n/g, "\n");
}

function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Strips a `//` run to end-of-line wherever it starts on that line -- a
 * TRAILING comment (code, then a comment) is removed just like a whole-line
 * one. Matches the discipline route.test.js's own header describes: safe for
 * a target file known (by hand) to carry no `//` inside a string or regex
 * literal.
 */
export function stripLineComments(text) {
  return stripBlockComments(toLF(text))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * Strips only lines that are ENTIRELY a comment (optional leading whitespace,
 * then `//`, to end of line). A trailing `//` comment after real code on the
 * same line is left in place -- the shape prepTriggerSeams.test.js,
 * glossaryTriggerSeams.test.js and glossaryMount.test.js use, since the
 * production files they scan are large enough that a blanket trailing-comment
 * strip risks eating a `//` that lives inside a string.
 */
export function stripCommentLines(text) {
  return stripBlockComments(toLF(text))
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

/**
 * Reads a source file and returns it with comments stripped, for the file-
 * reading instruments above. `filePath` may be absolute, or relative to the
 * repo root (`process.cwd()` under vitest). Pass `{ wholeLineOnly: true }` for
 * the `stripCommentLines` shape; the default is `stripLineComments`.
 *
 * @param {string} filePath
 * @param {{ wholeLineOnly?: boolean }} [options]
 */
export function codeOf(filePath, options = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = readFileSync(abs, "utf8");
  return options.wholeLineOnly ? stripCommentLines(raw) : stripLineComments(raw);
}
