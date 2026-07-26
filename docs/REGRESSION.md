# Regression Suite

The living record of behavior that must keep working. Stage 10 of the development
loop runs this whole document once per group, before that group is pushed.

Rules:

- Acceptance criteria are appended here when a feature clears stage 9. A feature
  is not done until its AC lives in this file.
- Nothing is ever deleted because it became inconvenient. A case is removed only
  when the behavior it describes is deliberately retired, and the removal is
  stated in the commit that removes it.
- A case that cannot be automated still belongs here, marked `automatable: no`,
  with the manual steps written out. Blocked is not the same as passing.

## Case format

Each case is one `###` heading followed by the three labelled blocks. The stage 10
workflow parses this shape, so keep it exact.

`parallel-safe: no` means the case cannot run beside another case: it builds, starts
or restarts a server, writes to a shared output directory such as `.next`, depends on
a specific working-tree state, or mutates files. Read-only inspection and scoped test
runs are `parallel-safe: yes`.

### R-000 | area: example | parallel-safe: yes | automatable: yes

**Summary:** Template case. Copy this shape; do not run it.

**Steps:**
1. Describe the exact command or interaction, not a paraphrase.
2. One numbered step per action.

**Expected:** The observable result, specific enough that a reader can tell a pass
from a fail without judgement calls.

## Cases

### R-001 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** With a tailored resume supplied, the cover letter prompt grounds on it and drops the instruction that steered the model away from the resume's language.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/buildCoverLetterPrompt.test.js`.

**Expected:** All tests pass. The prompt built with a usable `tailoredResume` contains the tailored-resume header and the tailored text, also contains the original resume as background grounding, and does NOT contain the phrase "do not copy phrasing wholesale".

### R-002 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** Without a usable tailored resume, the prompt falls back to the original pre-feature behavior.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/buildCoverLetterPrompt.test.js`.

**Expected:** When `tailoredResume` is undefined, null, or carries only whitespace, the prompt contains the "Source resume (for factual grounding only" header including "do not copy phrasing wholesale", and does not contain the tailored-resume header.

### R-003 | area: cover-letter-structure | parallel-safe: yes | automatable: yes

**Summary:** Sourcing content from the resume must never loosen the letter's structural constraints. This is the guard against the feature silently degrading formatting.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/buildCoverLetterPrompt.test.js`.

**Expected:** In BOTH the tailored and fallback branches the prompt still contains: the exact output-line-count constraint derived from `templateLines.length`, the per-line budget wording "within +/-10%" and "Never exceed +15%.", the blank-template-lines rule, and the JSON-only output shape. The total-character constraint reflects the sum of the template line lengths.

### R-004 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** Client-supplied tailored resume lines take precedence over the resume tailored in the same request. This is what makes cover-only regeneration use the resume you are actually keeping.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/tailor/pickTailoredResume.test.js`.

**Expected:** All tests pass. Non-empty client lines win over a populated resume result; an empty, missing, or non-array client value falls through to the resume result; a null or undefined resume result yields an empty shape rather than throwing.

### R-005 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** The tailored resume text resolver treats unusable input as absent so the caller can fall back.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/resolveTailoredResumeText.test.js`.

**Expected:** All tests pass, including that a whitespace-only `result` falls through to `resultLines` rather than winning, and that `result` takes precedence over `resultLines` when both carry content.

### R-006 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** The tailoring route wires the tailored resume through to the engine, and the client sends its stored lines only on a cover-only revise. Not covered by unit tests: the client-side form append lives inside a React hook and is verified by inspection here.

**Steps:**
1. Read `hello-world/app/api/tailor/route.js` and locate the `tailorCoverLetter` call.
2. Read `hello-world/app/hooks/useDocumentPreview.js` and locate the `tailoredResumeLines` form append and the `applyCover` definition.

**Expected:** The route passes a `tailoredResume` option built by `pickTailoredResume`. The client appends `tailoredResumeLines` guarded by `applyCover`, and `applyCover` is defined as the cover scope AND not a focus change, so a focus change or a resume-scope revise falls through to the freshly tailored resume instead of stale stored lines.

### R-007 | area: engine-parity | parallel-safe: yes | automatable: yes

**Summary:** The embedded and external engines tolerate the new option without behavior change, and embedded output stays deterministic.

**Steps:**
1. From `hello-world`, run `npx vitest run`.

**Expected:** The full suite passes with no tailor-lite determinism failures. The embedded engine accepts `tailoredResume` via its options object without destructuring it; the external engine's outbound HTTP body is unchanged.

### R-008 | area: headless-tailoring | parallel-safe: yes | automatable: yes

**Summary:** Automated queue tailoring grounds the letter in the resume it just tailored, not a re-extraction of the original upload.

**Steps:**
1. Read `hello-world/lib/feed/tailorAndQueue.js` around the `tailorCoverLetterHeadless` call.
2. Read `hello-world/lib/llm/tailorForUserHeadless.js` for the `tailoredResume` parameter.

**Expected:** `tailorAndQueue.js` passes `tailoredResume` built from the resume draft it generated moments earlier, and `tailorCoverLetterHeadless` accepts and forwards it to the engine.

### R-009 | area: gates | parallel-safe: no | automatable: yes

**Summary:** Project gates are green. Exclusive because the build writes to shared output.

**Steps:**
1. From `hello-world`, run `npx eslint .`
2. From `hello-world`, run `npx vitest run`
3. From `hello-world`, run `npm run build`

**Expected:** eslint reports zero errors and zero warnings. vitest reports at least 816 passing tests with zero failures. The build compiles successfully. Note `tsc --noEmit` is not applicable: this project has `jsconfig.json` and no `tsconfig.json`.

### R-010 | area: cover-letter-quality | parallel-safe: no | automatable: no

**Summary:** End to end, a generated cover letter visibly reflects the tailored resume's emphasis and reads as letter prose rather than restated resume bullets.

**Steps:**
1. Sign in to the running app with a Gemini engine selection and a configured API key.
2. Tailor a resume and cover letter against a real posting.
3. Read the resulting letter against the tailored resume.

**Expected:** The letter's substance tracks the tailored resume's achievements and vocabulary, keeps the template's paragraph count and rhythm, and contains no fabricated employer, title, date, or metric. Requires a human read and a live API key, so it cannot be automated; record the outcome manually when run.
