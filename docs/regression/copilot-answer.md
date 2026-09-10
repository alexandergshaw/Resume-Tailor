### R-264 | area: copilot-answer | parallel-safe: yes | automatable: yes

**Summary:** An answer states a fact about the employer only if that fact was checked against a page the search actually read.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/companyFacts.test.js lib/copilot/companyFactsSource.test.js lib/copilot/companyDirected.test.js lib/copilot/factCitations.test.js lib/copilot/answerPrompts.companyFacts.test.js lib/copilot/answerPrompts.test.js app/api/copilot/answer/route.companyFacts.test.js`.
2. Read `buildCompanyFacts` in `hello-world/lib/copilot/companyFactsSource.js`.

**Expected:** All pass. Asked "What do you know about Purple Wave?" — an online heavy-equipment and farm-machinery auction company — the copilot produced *"Purple Wave is dedicated to delivering innovative solutions and enabling product teams through cutting-edge platform technology"* and *"**My research indicates** a strong focus on continuous improvement."* Not one sentence was a fact about the employer; all of it was job-description vocabulary reflected back, and the second asserted research that never happened, for the candidate to read out loud in an interview.

The cause was structural: `buildPointsPrompt` had **no company source of any kind**. The grounded, link-checked company brief that already existed reached a separate panel opened by a voice cue that (see R-263) could not fire.

**Corroboration reuses the machinery this repo already has for exactly this problem, and the ORDER is not negotiable:** `extractGroundingSources` → **`resolveGroundedSources` first** → `isGroundedUrl`. `lib/meeting/referenceContract.js`'s header documents why: grounding `web.uri` is sometimes a publisher URL and sometimes a `vertexaisearch.cloud.google.com/grounding-api-redirect/…` link, so comparing a model's URL against a raw redirect is false for every link forever — the feature returns zero facts and is indistinguishable from a model that searched nothing.

**A claim that is not corroborated is DROPPED, not softened.** There is no useful weaker version of a fact the candidate cannot stand behind. `referenceContract.js` is the precedent and states the same reasoning for meeting links.

**The prompt has three states and they are genuinely three.** No employer known → nothing added, and `FROZEN_POINTS_PROMPT_NO_PAGES` passes byte-for-byte. Employer known with surviving facts → the block, the authority sentence, and `factIds` in the JSON shape. **Employer known with no surviving facts → no heading, no empty block, no `factIds`, and an explicit instruction to assert nothing about the employer.** Collapsing the last two into the first is the easy way to keep the byte-identity guarantee and it silently removes the only instruction that stops the model inventing. An empty heading is worse than silence — this repo has already shipped a heading-only block that invited fabrication.

**The instruction names the phrasings.** The prompt already said "never invent" about experience and the model still wrote "My research indicates", so that phrase is banned by name.

**`factIds` is validated against the whitelist of facts actually shown**, following `pageCitations.js` exactly, including its four non-obvious rules: the whitelist supplies the displayed values, the positional pairing is all-or-nothing on length, `[]` is not an array of nulls, and it never throws. **`factIds` is declared AFTER `points` in the shape line** — the streaming parser anchors on `/"points"\s*:\s*\[/`, so an earlier field delays the first streamed bullet for no benefit.

**"Is this question about the employer" is a structural rule, not a score.** This repo spent four rounds on a hand-tuned word score for a similar gate and each fix moved the hole rather than closing it. Two conditions only: the employer is NAMED (data from the posting row, so it differs per user and cannot be tuned), or a determiner from the closed set `{the, this, your}` precedes the head noun `{company, organisation, organization}` **and the head noun ends the phrase** — without that boundary guard, which `voiceCues.js` already solved for its own cue, "What is the company culture like?" reads as a question about the employer and so does "the company you worked for".

**`buildCompanyFacts` never rejects.** Every failure — no company, no key, a network error, unparseable output, no grounding metadata, every fact dropped — returns `[]`. It rides beside an answer the candidate is waiting on and must never be able to fail the request it rides beside.

### R-265 | area: copilot-answer | parallel-safe: yes | automatable: yes

**Summary:** The live answer path stops paying for work it already did — thinking it does not need, and Supabase queries whose answers cannot have changed.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/api/copilot/answer/ lib/copilot/answerSessionCache.test.js lib/copilot/answerAids.test.js`.
2. Read the streaming call's `config` in `hello-world/app/api/copilot/answer/route.js` and `createTtlCache` in `hello-world/lib/copilot/answerSessionCache.js`.

**Expected:** All pass. Measured from the 2026-08-25 session: 4–10 seconds from a detected question to a drafted answer. Three contributors sat in front of the first token, and R-261 removed the largest (two model calls per spoken question). The other two are here.

**`gemini-2.5-flash` defaults to dynamic thinking**, and the route passed no `thinkingConfig`, so every live answer burned thinking time before emitting anything — and because the response is streamed JSON, that is time the candidate spends looking at an empty card. `config.thinkingConfig.thinkingBudget: 0`, verified against Google's own documentation for the Generate Content API this route calls: range 0–24576 for this model, 0 documented as turning thinking off and reducing latency. **The newer Interactions API's `thinking_level` is a different API with no "off" for this model — do not substitute it.** Scoped to the streaming points call, the one the candidate waits on mid-interview; practice mode is deliberately untouched.

**`auth.getUser()` plus four Supabase queries ran on every question**, for data that cannot change during an interview. They now run once per `${userId}::${applicationId}`, TTL 10 minutes against an injected clock.

**`kb`, `story` and `grounding` are deliberately NOT cached.** `buildKnowledgeBaseBlock` ranks pages against the question, so a cached block answers question two with question one's page selection — an answer built from the wrong project, with every test green. This is the single most likely way to get the cache wrong, which is why it is asserted on ORDER (the page the question is about is the first heading in that question's block), not on presence: both pages fit the budget, so a presence assertion passes against a question-blind block.

**Stale and miss are the same event.** A stale entry is deleted and reloaded, never served once and never served-then-refreshed in the background — serving a résumé the user has since edited is exactly what the correctness clause forbids. A rejected load is not cached, or one bad round trip becomes ten minutes of answers built from nothing. The cache stores the **promise**, so two questions detected within a second of each other collapse into one round trip.

**`auth.getUser()` is NOT cached, and that is not an oversight** — its result is what produces the cache key. Keying on the access token instead would be a correctness regression.

**Also here:** `normalizeModelPoints`, `generateIdealProjectExample` and `answerAids` moved out of the route into `lib/copilot/answerAids.js` — the same extraction `answerPrompts.js` already made from the same file, taking it from 804 lines to 663. The proof that it is behaviour-preserving is that the pre-existing route tests pass unchanged on both sides of it.

