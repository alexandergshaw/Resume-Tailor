/** CRLF -> LF normalization, applied to BOTH sides of any generated-vs-committed comparison in
 * this toolchain. This repo has core.autocrlf=true; a file with no .gitattributes exemption is
 * smudged to CRLF on checkout, so skipping this would fail the drift check on every clean clone. */
export function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n");
}
