### R-046 | area: practice-questions | parallel-safe: yes | automatable: yes

**Summary:** The deterministic question bank is genuinely deterministic, never empty, and never repeats a question the session already asked.

**Steps:**
1. Read `buildQuestionBank` and `nextPracticeQuestion` in `hello-world/lib/copilot/practiceQuestions.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/practiceQuestions.test.js` from `hello-world/`.

**Expected:** No `Math.random`, no `Date`; the same posting and asked-list always yield the same next question and the same wording. The bank is non-empty for a null, undefined, empty or whitespace-only posting. Technical questions are built from terms extracted from the posting's own description, falling back to a generic technical set when nothing is extractable. Types interleave rather than grouping. Dedupe runs through `normalizeQuestion`, tolerates non-strings and empty entries in the asked list, and a fully consumed bank returns exactly `{ question: "", type: "general", exhausted: true }`.

### R-047 | area: practice-questions | parallel-safe: yes | automatable: yes

**Summary:** The question route serves all three engine paths without ever dead-ending a practice session, and its asked-list cap keeps the questions most likely to be repeated.

**Steps:**
1. Read `app/api/copilot/question/route.js` in `hello-world/`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/question/route.test.js` from `hello-world/`.

**Expected:** No signed-in user returns 401 with "Sign in to use the interview copilot.". The embedded engine answers from the deterministic bank with `source: "embedded"` and never constructs a Gemini client. A Gemini throw, an unparseable response, an empty question, or a question duplicating one already asked all fall back to the bank and report `source: "fallback"` — never a 5xx, and never silently. `sanitizeAsked` keeps the MOST RECENT entries at the cap, not the first ones, and the anti-repeat comparison truncates the candidate the same way the stored entries were truncated. The response shape is identical across all three paths.

