// The W-block (T3 design r7 section 12.1): the six lines every stage-10 agent
// prompt must carry, one after another, with nothing between them.
//
// The test-side bytes exist ONCE, here. Lane B's harness
// (stage10Regression.harness.test.js) and T2's harness (OQ-19(e)) both import
// this module, so a wording change at one call site in a workflow cannot hide
// behind a second, drifted copy of the lines in a test.
//
// Each line is a single-quoted string literal on purpose (design section 1.2
// W-1 (b)): none of the six lines contains a backtick, a dollar-brace pair or a
// single quote, so the repository's source tokenizer reads this file as plain
// strings and the export-reachability sweep can parse it.
//
// B-15 (AC section 5): none of the lines names the regression suite, a case, a
// refuter or a stage, so T2 can adopt the same bytes for a different workflow.

export const W_BLOCK_LINES = Object.freeze([
  'W1. In the Bash tool, begin every command with: export PATH="/usr/bin:/bin:$PATH";',
  'W2. node, npx and npm are not reachable from Bash here: run them from PowerShell, never from Bash.',
  'W3. Never take a verdict from an exit code or from a piped command; quote the summary line the runner itself prints (for vitest: the Test Files and Tests lines).',
  'W4. A command that did not report completion produced no result.',
  'W5. A vitest run that shows only skipped tests, "No test files found", or no Tests line produced no result.',
  'No result means blocked: report the step as blocked, never as pass or fail.',
]);

/**
 * Throws unless every prompt carries the six W-block lines contiguously and in
 * order. Accepts one prompt string or an array of prompts. An empty list is
 * refused: "no prompt was checked" must never read as "every prompt passed".
 *
 * @param {string | string[]} prompts
 */
export function assertEveryPromptCarriesWBlock(prompts) {
  const list = typeof prompts === 'string' ? [prompts] : prompts;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('assertEveryPromptCarriesWBlock: no prompt was given, so nothing was checked');
  }
  const block = W_BLOCK_LINES.join('\n');
  list.forEach((prompt, i) => {
    if (typeof prompt !== 'string') {
      throw new Error(`assertEveryPromptCarriesWBlock: prompt ${i} is not a string`);
    }
    if (prompt.includes(block)) return;
    const missing = W_BLOCK_LINES.filter((line) => !prompt.includes(line));
    if (missing.length > 0) {
      throw new Error(`prompt ${i}: missing ${missing.length} W-block line(s), first missing: ${missing[0]}`);
    }
    throw new Error(`prompt ${i}: all six W-block lines are present but not contiguous and in order`);
  });
}
