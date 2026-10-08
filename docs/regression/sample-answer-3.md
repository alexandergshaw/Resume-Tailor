### R-298 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** An answer aid says where its material actually came from, and never tells the candidate something is on their résumé when it came from a project page.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/AnswerAids.test.js`.
2. Read `roleLabel` and the no-role row in `hello-world/app/copilot/AnswerAids.js`, and where `answerAids` sets `source` in `hello-world/lib/copilot/answerAids.js`.

**Expected:** All tests pass. **This is not cosmetic: the user reads "on your resume", then says the claim out loud to an interviewer.** If it is not on their résumé, that is a bad moment this tool caused — the same standard R-134 and R-258 already hold the aids and the honesty gate to. Every label is driven by the aid's own `source`: `"resume"` renders the résumé wording, `"prep"` the prep notes, and `PROJECT_PAGE_SOURCE` (`lib/copilot/projectStories.js`) the project-page wording, with each of the other two wordings asserted ABSENT rather than merely the right one present.

**The defect this pins had two halves and only ever failed in the damaging direction.** `roleLabel` mapped `source === "prep"` to prep notes and EVERYTHING ELSE to "on your resume", and the no-role row — the one an upstream plausibility gate leaves behind when R-134 blanks a mis-parsed title and company while the description phrases survive — hardcoded "From your resume" regardless of source. A third source could therefore only ever be mislabelled, and page-derived material became a résumé claim by default. It was latent rather than live only because the answer route worked around it by leaving those fields empty: designing around a component that cannot tell the truth, rather than fixing it.

**An unknown source still falls back to the résumé wording, deliberately.** `undefined`, `null`, `""` and an unrecognised string all render the résumé sentence and never the literal "undefined" at the user. Making the KNOWN sources honest must not turn an absent source into rendered garbage, so the fallback is asserted for all four values rather than left to a reader's assumption.

**Three properties that must survive any future edit here are asserted alongside.** The closest-versus-most-recent distinction holds for EVERY source — `matched: false` means nothing overlapped, so calling it a closest match claims a relevance never computed (R-131's known limitation is why that state is ordinary rather than rare). Each `description` phrase stays on its own line and is never spliced (R-131: the `string[]` shape is what prevents "First phraseSecond phrase"). And `AnswerAids` still renders nothing at all when given nothing, which R-121 step 3 rests on.

**Why this needs a mounted test.** The property is which STRING the component renders for which `source` value, which is markup, not a decision that can be extracted into `lib/`; the file opts in with a `// @vitest-environment jsdom` docblock and mounts with `createRoot` + `act` (R-172). This is the only test in the repo that renders `AnswerAids.js`.

