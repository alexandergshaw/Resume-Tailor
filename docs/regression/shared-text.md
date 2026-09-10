### R-251 | area: shared-text | parallel-safe: yes | automatable: yes

**Summary:** One `significantTerms` tokenizer instead of four — with the one copy that was never a duplicate deliberately left alone, and both halves of that pinned.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/ lib/meeting/ app/api/meeting/ --no-file-parallelism`.
2. Confirm `lib/copilot/projectStories.js` exports `significantTerms` and `overlapScore`, and that `lib/meeting/insightsLocal.js` and `lib/meeting/meetingContext.js` import them rather than defining their own.
3. Confirm `lib/copilot/resumeAnchor.js` STILL defines its own, with a comment saying why.

**Expected:** All suites pass and the three points above hold.

**Three copies were byte-identical; the fourth was not, and that is the whole story.** `projectStories.js`, `insightsLocal.js` and `meetingContext.js` each had the same lowercase-and-match-`/[a-z0-9]{4,}/g` tokenizer, with `overlapScore` beside it. Both were consolidated into `projectStories.js` — both, because leaving one duplicated keeps exactly the drift risk the exercise removes, and `overlapScore`'s body is a call to `significantTerms`.

**`resumeAnchor.js`'s copy is a deliberate variant and merging it would silently reintroduce a fixed bug.** It differs three ways: a **three**-character floor instead of four, a **stopword** filter, and a **bare-number** filter. Its own comment records the regression that last one exists for — an unrelated Barista role scored a match on a systems-design question purely because both mentioned "200". Folded into the shared four-character unfiltered version, all three protections vanish and nothing about the shared function's own tests would notice.

**The task described all four as "near-identical".** They are not, and the difference is invisible unless the bodies are read side by side. That is the general hazard in any de-duplication: the copies that look alike get merged, and the one that was carefully different gets merged too.

**So the guard pins BOTH halves.** `significantTerms.shared.test.js` asserts the merge really happened — no private `function significantTerms` remains in the two consumers, AND they import from the canonical home, because "no local copy" is equally true of a module that stopped using the tokenizer at all. It then asserts the holdout still EXISTS, still has its three-character floor and stopword filter, and carries its comment. `resumeAnchor.test.js`'s pre-existing "C3 regression" case pins what the variant DOES; this file pins that it is still there to do it.

**The shared implementation is checked against a frozen literal oracle**, inlined rather than imported — the pre-consolidation body, run over eight inputs. A test that merely called the shared function could never notice it drifting, because it would drift with it.

**Mutation-proven.** Three mutations, all killed by their own named tests: the shared tokenizer drifting to a three-character floor; a consumer quietly regrowing its private copy (killed by both halves of the anti-duplication pair); and someone "finishing the job" by merging `resumeAnchor` (killed by the holdout assertion).

**A test example that proved nothing, caught by the implementer.** The contrast case originally used `"200"` — three characters, which the shared tokenizer drops on its LENGTH floor and the variant drops on its bare-number FILTER. Same outcome, different reasons, no difference demonstrated. It now uses a four-digit run, which clears the shared floor and isolates the filter as the thing that actually differs. The implementer refused to edit the test and reported it, which is what surfaced it.

**Home choice.** `projectStories.js` is a feature module, and generic text helpers living there is a little odd — but it is where they were established, `insightsLocal.js` already imported from `lib/copilot/`, and crucially that file has **no imports of its own**, so importing from it pulls in nothing else. Dependency direction after the change is strictly one-way: `insightsLocal.js → meetingContext.js → projectStories.js`, with no cycle.

**Deliberately not consolidated:** `app/api/meeting/references/route.js`'s `cacheTerms` (a superset — stopwords, sorting and a cap, for a deterministic cache key), and `MIN_BULLET_LENGTH`/`BULLET_LINE_RE`, whose duplication `insightsLocal.js` already justifies in its own comment.

