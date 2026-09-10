### R-003 | area: cover-letter-structure | parallel-safe: yes | automatable: yes

**Summary:** Sourcing content from the resume must never loosen the letter's structural constraints. This is the guard against the feature silently degrading formatting.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/buildCoverLetterPrompt.test.js`.

**Expected:** In BOTH the tailored and fallback branches the prompt still contains: the exact output-line-count constraint derived from `templateLines.length`, the per-line budget wording "within +/-10%" and "Never exceed +15%.", the blank-template-lines rule, and the JSON-only output shape. The total-character constraint reflects the sum of the template line lengths.

