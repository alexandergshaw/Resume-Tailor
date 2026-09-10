### R-082 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The sample answer shown for a practice question is keyed to that exact question, and revealing one never starts a duplicate request underneath one already in flight.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerState.test.js`.

**Expected:** All tests pass. `activeSampleAnswer` returns the empty state whenever the stored draft's question differs from the question on screen — this derivation, not any explicit reset call, is what clears the panel on Next question, a posting change and a fresh Start. `needsRedraft` always redrafts on force and from the idle/error states, NEVER redrafts while a request for the same question is loading, and from the done state redrafts only when the prep context, the interview type, or the selected application has changed since the draft was built.

### R-083 | area: sample-answer | parallel-safe: yes | automatable: no

**Summary:** The sample-answer toggle is available in every phase where a question is on screen, and never displays a draft belonging to a question that is no longer showing.

**Steps:**
1. Read the `SampleAnswer` render condition and the action row in `hello-world/app/copilot/practice/QuestionCard.js`.
2. Read `hello-world/app/copilot/practice/SampleAnswer.js`.

**Expected:** The toggle renders whenever a question is present AND no next-question request is in flight, and is never disabled by `answering` or `settling` — so it works before answering, while recording, while settling, and after the answer is done. It does not render at all when there is no question, nor while `loading` is true (the guard against the previous question's draft sitting under a "Getting your next question" spinner). Regenerate appears only when a draft is actually displayed; the error state offers Retry instead.

### R-087 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A spoken sample answer never claims experience the candidate's own documents do not contain. This is the guard against the app coaching someone to lie in an interview.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerLocal.test.js`.

**Expected:** All tests pass. Given a resume that says "Led a team of five engineers" and "four product teams" but never mentions Microsoft Teams, the answer does not name Microsoft Teams — a mined skill is spoken only when it literally appears in the source material. No bare standalone metric sentence is emitted, and a metric is never paired with a story it did not come from (the answer never contains a bare "The result" sentence carrying a figure mined from a different bullet). A quoted resume bullet is spoken in first person ("I led a team..."), never as a subject-less fragment. A cover letter's application or motivation line is never quoted as the concrete example, in either the behavioral or the general shape; when used at all it is framed as motivation. With no resume, cover letter or prep context the answer says plainly that there is nothing on file rather than inventing a situation. Output is deterministic.

### R-088 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Sample-answer grounding reads only the signed-in user's own submitted documents, and degrades to empty rather than throwing.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/applicationDocs.test.js`.

**Expected:** All tests pass. The `applications` lookup filters on BOTH `id` and `user_id` — the filter that stops one user's submitted resume or cover letter being read for another, and the reason this case exists. `fetchApplicationDocs` never throws, returning empty strings for: a missing applicationId, a missing userId, no matching row, a query error on the application lookup, a null `resume_used_id`, a null `cover_letter_id`, and a query error on either document fetch.

### R-089 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The two modes of the answer route stay separate: live mode's glanceable bullets are untouched by practice mode's fuller sample answer.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.test.js lib/copilot/answerLocal.test.js lib/copilot/answerClient.test.js`.

**Expected:** All tests pass. A request with no `mode`, or an unrecognized one, returns points and type exactly as before — this is the live-interview path and it must not move. An `answer` mode request returns points, answer, type and grounding, with grounding reporting which submitted documents were actually found, and both flags false when the application has none. On the embedded engine, answer mode drafts on-device and never constructs a Gemini client. Auth still 401s and a blank question still 400s. `draftAnswerLocal` with no interview type produces the original bullets; `resolveScaffoldType` only ever overrides a general classification, never an already-behavioral or already-technical one.

**Amended (group H):** this case originally required answer mode to return a single prose `answer` string and described it as "the practice-mode prose path". The sample answer is now bullet points by explicit instruction — see R-097, which owns that contract. `answer` still exists on the response but is derived from `points` rather than generated, and is no longer what the UI renders.

**Amended (group K):** "returns points and type exactly as before" no longer means the response has exactly those two keys. Both modes now also return `cues`, `buzzwords` and `resumeAnchor` (R-120). What this case still pins, and what it was always really about, is that `answer` and `grounding` remain ANSWER MODE'S ALONE — points mode must never grow either one — and that points mode's prompt and system instruction are untouched. The test asserts the full key set plus an explicit absence check for those two, rather than an exact-shape equality that would have to be rewritten by every later addition.

### R-097 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Practice mode's sample answer is bullet points, each a complete spoken sentence, with the prose form derived from them rather than generated separately.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerLocal.test.js lib/copilot/sampleAnswerState.test.js app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. Answer mode returns `points` as an array of complete, speakable sentences — not the glanceable fragments live mode's points mode returns — plus a derived `answer` string. For a behavioral or leadership shape each point carries its STAR label. `answer` is produced by stripping those labels from `points` and joining them, never requested from the model as a second field and never generated independently: one is generated, the other is computed from it, so the two can never drift apart. `draftSampleAnswerLocal` on the embedded engine returns the same `{ points, answer, type }` shape built the same way. This case exists because a later feature synthesizes speech from `answer`, and bullet fragments read aloud sound like fragments.

**Amended (group K):** the UI no longer renders `points` — it renders `cues`, a few words each (R-117). Everything above is unchanged and is precisely why: the request was for shorter bullets, and the tempting way to deliver it was to make `points` themselves fragments, which would have broken the sentence contract this case exists to protect and made the derived `answer` unspeakable. The shortening happens at the render boundary instead, so `points` stays a sequence of complete sentences and `answer` stays derived from it. `points` remains the fallback the UI renders when a draft carries no cues.

### R-117 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A drafted answer is read as a few words per beat, not as sentences, and shortening one never changes what it says.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/answerCues.test.js`.

**Expected:** All tests pass. `shortenToCue` trims a spoken answer sentence to roughly six words, keeping any STAR label verbatim (the label is the navigation between beats; shortening it defeats the point) and applying the budget only to the sentence behind it. It cuts at a clause boundary in preference to counting words, trying STRONG boundaries (punctuation, `because`, `which`, `while`, `before`, `after`) before WEAK ones (a bare `and`/`then`/`or`) — the order matters and is asserted directly: "Open with where and when" is one thought that a weak-first split would cut to "Open with where", which is not a prompt. A trailing enumeration is kept whole rather than cut at its first comma, because half a list of skills reads as a complete answer naming fewer skills than the candidate has. The leading first-person subject and filler openers are dropped, since every point in a sample answer starts "I" and the word therefore distinguishes nothing. A cue never ends on a dangling function word and never carries terminal punctuation or a mid-word ellipsis. Anything that shortens to nothing returns an empty string so the caller drops it rather than rendering a blank bullet.

`resolveCues` prefers the model's own cues, which read better than any mechanical trim, but ONLY when there is exactly one per point: a mismatched count means the model paired them differently than the points array reads, and a cue sitting against the wrong beat is worse than a mechanical one sitting against the right beat, so the whole supplied set is discarded rather than padded. Supplied cues are still put through `shortenToCue`, so a "cue" returned as a full sentence is trimmed rather than trusted.

**Amended (group L), part 2 — `deriveCues` no longer drops a blank, it holds the position.** The clause above says "anything that shortens to nothing returns an empty string so the caller drops it rather than rendering a blank bullet." `shortenToCue` still returns `""`, but `deriveCues` and `resolveCues` now KEEP that entry, so the returned array always has exactly one element per cleaned point. Dropping it was correct when a cue WAS the bullet; it became a defect the moment cues started pairing with points. Reproduced: a three-point answer containing one terse sentence ("I did.") yielded two cues for three points, and `answerLines`' all-or-nothing pairing then discarded EVERY cue in the draft — one short sentence anywhere silently removed the bold lead-ins from the whole answer, on all four surfaces, via four separate route paths. `answerLines` correspondingly pairs against the RAW cues array, never `cleanAnswerPoints(cues)`, because cleaning re-drops the placeholders and re-creates the bug. Cleaning POINTS and cleaning CUES are different operations now: a blank point is not a line, a blank cue is a line without a lead-in. The all-or-nothing rule itself is unchanged and still fires on a genuine count mismatch (a model returning two cues for three points).

**Amended (group L): a cue is no longer what the UI renders INSTEAD of the point — it is rendered in front of it.** Everything above is unchanged and still correct about what a cue IS. What was wrong was the render decision built on top of it. `answerBullets` returned the cues and used the full sentences only as a fallback, so a real three-point answer reached the user as "Product Curriculum Lead / Tech covered: SQL, APIs / Familiar with platforms" — the sentences behind those cues were drafted, cached, derived into `answer`, and never shown to anyone. The user's verdict was "this section is not helpful", and it was accurate: those fragments cannot be spoken and say nothing. The cue's purpose — a few words absorbed in the two seconds before you start talking — is real, so the fix is a bold cue lead-in followed by its sentence, not a reversal back to sentences alone. See R-132.

### R-118 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The posting's own vocabulary is offered as a list to work in, and the posting description still grounds nothing.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/postingBuzzwords.test.js app/api/copilot/answer/route.test.js lib/copilot/applicationDocs.test.js`.

**Expected:** All tests pass. This is the first time the posting description has been an input to `/api/copilot/answer` at all, and AC-H7.27 is unchanged: the description reaches the buzzword miner and nothing else. The route proves it on a request where a description IS present — neither the answer-mode prompt nor the points-mode prompt contains any of its text. The separation is structural rather than remembered: `fetchPostingDescription` is its own function beside `fetchApplicationDocs` precisely so no prompt builder is ever handed an object that happens to carry the description. Both prompts still receive only the submitted résumé/cover letter.

The distinction being drawn is deliberate and is the reason the constraint survives: material an answer is GENERATED from can make a candidate claim experience the posting described rather than experience they have; a list the candidate reads and chooses from cannot, because they decide which terms they can honestly say.

`postingBuzzwords` returns only terms that literally occur in the posting — a canonical taxonomy name is an inference, and telling someone to say "Microsoft Teams" because the posting said "team" would put a false term in their mouth in a live interview (the same recorded hazard R-087 and R-096 guard elsewhere). Relevance to the current question and draft outranks the extractor's own score AND outranks the taxonomy/RAKE tier, because this list answers "say these here", not "these are the important words in the posting". A posting the technology taxonomy barely matches still returns terms, via the RAKE topic tier. Output is capped, de-duplicated case-insensitively, and deterministic. `fetchPostingDescription` scopes on both `id` and `user_id`, and degrades to an empty string — never throws — for a missing id, a missing user, no row, a query error, no joined position, or a null/non-string description.

**Amended (group L): relevance now DECIDES membership, not just order, and "a posting the taxonomy barely matches still returns terms" is deleted — it was the bug.** The sentence above about relevance outranking score and tier was true and did nothing, because relevance was tested with `literallyMentioned(canonical, question + points)` — an exact substring match that almost never fires. With every candidate scoring zero, the ranking collapsed to the posting's global top terms, which are constant for a given posting. Reproduced: three unrelated questions against one posting returned the byte-identical array `["Education","CRM","Agile","SDLC","Artificial Intelligence","Communication"]`. The user reported it as "the words from the posting to work in are always the same". An irrelevant term is now dropped outright rather than ranked last, and there is deliberately **no top-terms fallback tier** — that fallback IS the constant list. A question nothing in the posting relates to yields `[]` and no row at all. See R-133.

### R-119 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The role and project offered beside an answer are the candidate's own, from the résumé they actually submitted, and are labelled honestly.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/resumeAnchor.test.js app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. `resumeAnchor` scores every parsed role against the question AND the drafted points, not the question alone — a question like "Tell me about a time you took ownership" is too short to discriminate, while the draft has already selected the material that mattered. The project is drawn from the bullets of the role just named, widening to the whole résumé only when that role has none: a project attributed to one employer while the label beside it names another is worse than no project at all. `pastWorkExperienceLine` is reused rather than re-derived, so a cover letter's "I am applying for..." opener can never be presented as a project (the same disqualification the drafted answer applies).

`matched` reports whether the role was chosen for OVERLAP or is merely the most recent one on file, and the UI's label changes with it — calling an unmatched role a "closest match" would claim a relevance that was never computed. Every returned value literally occurs in the material: the test walks each word of the project back to the résumé text. Returns null for empty material and for material where nothing parses as employment; returns a project with an empty role when a bullet is usable but no role header parses. The résumé is preferred over the prep-notes profile because the ask was specifically for the job title and company from the submitted résumé; the profile is the fallback only when no résumé was submitted. Deterministic.

**Amended (group L): "every returned value literally occurs in the material" was true of `title`/`company` and was not enough.** A value can be a verbatim quote from the résumé and still be a lie about what it IS. Reported verbatim: "Collaborated with business leaders **at** and development teams to translate product roadmaps into detailed requirements" — `roleText()` joining a title and company that `parseEmploymentHistory` had torn out of a wrapped, marker-less résumé bullet. Both halves occur literally in the résumé; neither is a job. `parseEmploymentHistory` is best-effort by design and is shared with the résumé-tailoring flow, so it was deliberately left alone; the plausibility gate lives in `resumeAnchor` because that is what PRESENTS these fields to a candidate. `project` and `description` survive a failed header gate — they come from the role's own bullets and are still true — and the UI falls back to a "From your resume" label. See R-134.

### R-120 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Both modes of the answer route carry the three reading aids, and every one of them degrades to absent rather than to an empty section.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. Answer mode returns points, cues, answer, type, grounding, buzzwords and resumeAnchor; points mode returns the same minus `answer`/`grounding` — those two remain answer mode's alone (R-089). The aids are computed identically for both modes and both engines from the same two pure modules, so live and practice can never show different aids for the same question and no aid depends on which engine drafted the answer. On the embedded path `cues` are always derived; on the Gemini path they are the model's when it returned one per point and derived otherwise, and that fallback is asserted with a deliberately mismatched model response.

With nothing to build from — no posting selected, no submitted résumé, no prep profile — `buzzwords` is empty and `resumeAnchor` is null, which the UI renders as no subsection at all. This is the load-bearing half of the case: an empty header under a drafted answer reads as a failure, and these are ordinary states, not errors.

**Amended (group L):** `idealProject` now carries a third field, `summary`, alongside `shape` and `metrics`. More importantly, the "degrades to absent" half of this case has a second, much commoner trigger than "nothing to build from": a posting IS selected and its documents ARE loaded, but nothing in it relates to the question being answered, so `buzzwords` is `[]`. That state is now ordinary rather than exceptional, and the route-level case asserts it directly — not only the everything-missing case this was originally written for.

### R-130 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The ideal-project benchmark can never be lifted into an answer as a claim, and never states a number the posting did not.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/idealProject.test.js app/api/copilot/answer/route.test.js`.
2. Read the ideal-project block in `hello-world/app/copilot/AnswerAids.js`.

**Expected:** All tests pass. This block describes work the candidate did NOT do — that is its purpose, and it is the only part of the sample-answer panel with that property. Everything about it exists to stop a candidate reading it under interview pressure and claiming it out loud, which is the failure R-087 exists to prevent, arriving from a new direction.

`idealProject` emits no digit sequence that is not literally present in the posting: the numbers it shows ("5+ years", "2M requests") are the posting's own, and everything else is a metric CATEGORY ("latency reduction %", "uptime / reliability %") — a kind of number to have ready, never a fabricated figure. Terms in `shape` survive the same `literallyMentioned` filter `postingBuzzwords` uses, so a taxonomy inference the posting never wrote can never appear. Blank, missing or non-string input returns `null`, so no posting selected renders no block at all rather than an empty header. Output is deterministic.

The rendered wording is third person throughout — "Roles like this look for:" and "Metrics to have ready:" — and is asserted to contain no first-person pronoun. It carries the accent treatment `PredictionPanel` uses (`var(--accent)` border, `var(--accent-soft)` background) plus a "Benchmark, not from your resume" chip, NOT the plain description-list styling the résumé-derived rows use. That visual separation is load-bearing, not decoration: it sits directly beside "Project to talk about", which is quoted from the candidate's real résumé, and a user glancing mid-interview must never mistake one for the other (the same argument as AC-I3.20). The chip deliberately carries no em dash — an em dash is not spoken at default screen-reader punctuation, so the contrast it was carrying would be lost.

**Amended (group L) — two of the three claims above no longer hold, and one is now stronger.**

1. **Posting numbers are gone entirely.** "The numbers it shows ('5+ years', '2M requests') are the posting's own" was the bug, not the safeguard. A user's posting stated "Salary range:78,496.00 -105,974.00" twice in two formats, and the block rendered `Metrics to have ready:78,496, $105,974, $78,496.00, $105,974.00` — the SALARY BAND, four times over (the dedupe key was the exact string), consuming the whole `MAX_METRICS` budget so the real categories were never reached. The grounding argument was sound and the conclusion was still wrong: a posting's digits are its salary, its years-of-experience floor and its headcount, and no regex separates those from a project metric because postings do not state project metrics. `POSTING_NUMBER_RE` and `postingNumbers` are deleted; `metrics` is now category phrases only and is asserted to contain **no digit at all**. `MAX_METRICS` is 3. See R-135.
2. **The accent box and the chip are gone.** The visual-separation ARGUMENT is unchanged and still load-bearing; what changed is where the disclosure lives. It moved into the row's own `dt`, which now reads "Ideal project — not from your resume". That is strictly stronger than the chip it replaces: it is permanent, it cannot be scrolled past as decoration, and a screen reader announces it as the TERM the value belongs to rather than as a stray label inside the value. The row keeps a single `2px` left rule in `var(--accent)`, and colour still never carries the meaning alone (WCAG 1.4.1) — the label text does. The accent-tinted box was one of four competing visual languages in a component the user described as "all over the place"; see R-136.
3. **`shape` is joined by a new `summary` sentence.** `shape` alone restated the buzzword chips two rows above it, which is why the user's verdict on this block was "there's no substance to the project section". The advisory sentence is still third person and still asserted to carry no first-person pronoun.

### R-131 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Every phrase shown to the candidate is a contiguous fragment of ONE source line — word membership is not enough.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/resumeAnchor.test.js lib/copilot/idealProject.test.js`.

**Expected:** All tests pass. `resumeAnchor`'s `description` is a `string[]`, one independently-shortened phrase per source bullet, and is NEVER joined into a single string anywhere — not in the module, not in `AnswerAids.js`, which renders one element per phrase. `project` and each `description` element are asserted to be contiguous substrings of a single line of the source material, not merely composed of words that appear somewhere in it.

This case exists because of BUG-K2, and the shape of that bug is the point. `description` was built by joining two bullets, producing "Built a payments migration platform serving Mentored four junior engineers through the promotion process" — two unrelated accomplishments spliced into one sentence, the first truncated mid-phrase. The module's own "never invents a word" test PASSED on it, because every individual word does occur in the résumé. A word-membership assertion is structurally incapable of catching phrase-level fabrication; only a contiguity assertion is. This is the same gap that let an earlier defect emit "Ubled the throughput" while a word-level check stayed green, and it will keep recurring wherever mined text is shown to a user, so the contiguity form is the one to reach for.

`description` excludes the bullet already used as `project`, is empty when the role has no second usable bullet, and the block does not render at all when empty. A motivation line is never surfaced as role scope, via the same `pastWorkExperienceLine` disqualification the drafted answer uses.

**Known limitation, deliberately not fixed here:** `significantTerms` filters through the shared tailor-lite stopword list, which contains "team". So a question about "leading a team" scores zero overlap against a bullet reading "Led a team of six engineers", and `matched` reports false — the label then honestly says "Most recent role" rather than "Closest role", but the role scoring is weaker than intended for common interview vocabulary. Fixing it needs a resumeAnchor-local allowlist reasoned about deliberately; the shared list must NOT be edited, since the tailoring pipeline depends on it.

### R-132 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A drafted answer is shown as a short cue AND the sentence behind it — never as a cue with its sentence thrown away.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/answerLines.test.js lib/copilot/answerPoints.test.js`.

**Expected:** All tests pass. `answerLines(cues, points)` returns one `{ label, cue, point }` per cleaned point and `point` is never empty. This replaces `answerBullets`, which returned the CUES ALONE and used the sentences only as a fallback — the reported bug, where a real three-point answer reached the user in its entirety as "Product Curriculum Lead / Tech covered: SQL, APIs / Familiar with platforms" while the speakable sentences behind them sat in the same response, unrendered.

`points` is the source of truth for how many lines there are: a cue with no point to head makes no sense (a cue for WHAT?), so the cleaned points array alone decides the length and cues attach to it, never the reverse. Cues pair POSITIONALLY and only when the two cleaned arrays are the same length — the same all-or-nothing rule `resolveCues` applies (R-117), for the same reason: a cue against the wrong beat sends a candidate down the wrong line of their own answer. Any mismatch, including a draft cached before cues existed, drops every cue and renders the sentences alone, which is byte-for-byte the pre-cue rendering.

A STAR label is carried exactly once, on `label`, stripped from both the point and its cue, so the UI never has to choose between two copies; `STAR_LABEL_RE` is imported from `answerLocal.js` rather than re-declared, because a second copy of the pattern the prompts emit is free to drift from the one they actually use. A cue is dropped to `""` for its own line when it is empty after label-stripping, equals its point modulo case and trailing punctuation, or is not strictly shorter by word count — a model that returns the sentence as its own cue must not render "X — X".

`answerBullets` is DELETED rather than kept alongside. Two functions rendering one answer is precisely the drift `answerPoints.js` was created to end, after its own filter had already diverged between two copies. Note that ESLint here does **not** catch a call to a deleted named export — no rule resolves named imports, and the call keeps `no-unused-vars` quiet — so `npm run build` is the only gate that catches it.

A point that is ONLY its own STAR label (the literal `"Situation:"`) is dropped from the result rather than rendered as a labelled blank bullet. It survives `cleanAnswerPoints` because it is non-blank, and only becomes empty after the label comes off — the same rule that module already applies to a blank point, applied one step later. The drop happens AFTER cue pairing is resolved (the cue is looked up by the pre-drop index inside the map, and the filter runs on the result), so dropping an entry from the MIDDLE of a draft cannot shift every later cue onto the wrong point.

All four surfaces render through one component, `app/copilot/AnswerLines.js`, rather than four hand-rolled copies of the `ul`/`li` markup — the four were verified byte-identical before being replaced, so nothing was silently flattened. The cue (with its label) is in a `<strong>`, semantic emphasis rather than a styled span, and the cue and its sentence stay inside ONE `<li>` in reading order so a screen reader announces them as a single item rather than two unrelated bullets.

**Known limitation, accepted deliberately:** the em dash separating cue from sentence is not spoken at default screen-reader punctuation settings, so the two run together audibly ("Product Curriculum Lead I spent three years as..."). Unlike R-130's chip, no MEANING is carried by the dash here — it separates a summary from its own expansion, both of which are read in full and in the right order — so the cost is a missing pause, not a lost distinction.

