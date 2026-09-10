### R-252 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** The interview copilot picks the project pages that answer the question being asked, instead of whichever pages happen to sit at the top of the sidebar.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/knowledgeBase.test.js lib/copilot/projectStories.relevance.test.js app/api/copilot/answer/route.knowledgeBase.test.js`.
2. Read `buildKnowledgeBaseBlock` in `hello-world/lib/experience/knowledgeBase.js`.

**Expected:** All tests pass. Reported: "the sample answers and live interview answers need to do a much better job of drawing from the knowledge base."

**The cause was structural, not editorial.** `app/api/copilot/answer/route.js` called `buildProjectStoriesBlock(pages)` with **no question**. `lib/supabase/experiencePages.js`'s `listPages` orders by `position`, so the pages handed to the model were the top of the user's own sidebar tree, cut off at 6000 characters — byte-identical for every question ever asked, and for a knowledge base of any size most of it was permanently invisible. The résumé got 12000 characters and the job posting 20000 over the same request.

Ranking is now overlap of `significantTerms` against `title + body`, descending, ties broken by the page's own `position` — **the same rule `lib/meeting/meetingContext.js` already used**, which is now a fact rather than a wish: `rankMeetingPages` is `rankPagesByRelevance`, one function imported by both, so the two surfaces cannot disagree about what "relevant" means. The budget rose to 12000, at parity with the résumé.

**A page that does not fit whole is EXCERPTED by whole blocks, never cut mid-sentence.** Blocks are headings, paragraphs, list items and fenced code, each an exact contiguous substring of the page's own source; they are scored with the same overlap rule one level down, emitted in document order, with the heading a selected block sits under restored above it and `[…]` marking a gap. Two implementations were considered and rejected for verified reasons, both recorded here because both look right: `lib/text/summarize.js`'s `rankSentences` opens with `.replace(/\s+/g, " ")` and splits only on `[.!?]` followed by a capital, so a bullet list — which is what an engineering notebook page mostly is — collapses into ONE "sentence"; and `lib/experience/markdown.js`'s `parseMarkdown` carries **no source offsets**, so anything rebuilt from its tokens is a re-rendering that drops `**`, link hrefs and list markers, putting text in the prompt the user never wrote and silently breaking `BULLET_LINE_RE` for the deterministic engine.

**Packing STOPS at the first page that does not fit; excerpting SKIPS within a page.** The asymmetry is deliberate. `buildProjectStoriesBlock` could skip because its list was unranked, so skipping cost nothing; a *relevance-ranked* list that skips silently promotes a shorter, less relevant page over a longer, more relevant one and neither the model nor the user can tell. Inside a page the opposite holds: the page is already labelled an excerpt and its gaps are already marked, so taking a smaller lower-ranked block after skipping an oversized one misleads nobody and recovers real material.

**Eligibility is a REQUIRED parameter with no default, and that is what keeps two rules from being harmonised by accident.** The copilot passes `isEligiblePage` (archived *and* model-generated pages excluded — a research report spoken aloud as your own experience is a lie you do not know you are telling); the meeting copilot's rule is archived-only, because the user directed that any page in their tree is theirs. The module itself decides neither. Meeting notes saved back into the knowledge base deliberately do not set `generated_kind` (`app/api/meeting/save/route.js`), so they still flow into interview answers.

### R-253 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** The live answer ranks against what was actually said, not against the word "Them".

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.knowledgeBase.test.js -t "speaker labels"`.
2. Read `stripLinePrefixes` in `hello-world/lib/experience/knowledgeBase.js` and the ranking query in `app/api/copilot/answer/route.js`.

**Expected:** All tests pass. **This defect was caught in design and never shipped, which is the only reason it is cheap.** Live mode sends `context` as a labelled transcript — `useLiveSession.js`'s `resolveTranscriptLabel` writes `"Them: "`, `"You: "`, or a user-entered display name. `significantTerms` tokenises `/[a-z0-9]{4,}/`, so `"them"` clears the four-character bar, appears once per interviewer turn, and becomes the single most frequent token in the whole ranking query — scoring every page containing the word "them" above zero and surfacing a page whose only overlap with the interview is a label this app itself wrote. Named speakers are worse, because they are unbounded.

`lib/meeting/meetingContext.js`'s `stripSpeakerLabels` exists for exactly this, one domain over, and **could not be reused**: it is anchored on `MEETING_LABELS` (`"Others"`/`"You"`), a closed set containing neither `"Them"` nor a display name. `stripLinePrefixes` is the label-agnostic generalisation — it drops a leading `"<prefix>: "` only when the colon is followed by a space, the prefix is at most five words and forty characters, and the prefix contains none of `.` `!` `?`. All four clauses have their own case: an earlier draft covered only the word count, and a mutation harness proved the other three could be deleted with every test still green.

**Stripping applies to the RANKING QUERY ONLY.** The prompt's own conversation block keeps its labels, because who said what is real information to a reader. A case pins that too.

**Why this needed its own case at all:** a poisoned ranking does not throw, does not warn, and still returns pages. It returns the wrong ones. Only an ordering assertion catches it, and only if both pages are asserted present first — comparing two `indexOf` results is satisfied by `-1` when a heading is missing altogether.

### R-254 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** A page is never named in the prompt without something under it, and never cited back unless it was really shown.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/experience/knowledgeBase.test.js lib/copilot/pageCitations.test.js lib/copilot/answerLines.pageSources.test.js lib/copilot/sampleAnswerState.pageSources.test.js app/copilot/AnswerLines.pageSources.test.js`.
2. Read `resolvePageSources` in `hello-world/lib/copilot/pageCitations.js`.

**Expected:** All tests pass.

**Each point now reports the page it came from**, using `lib/meeting/insightContract.js`'s proven pattern: every included page carries its own id in its prompt heading, the model is asked which page each point drew on, and **every returned id is validated against the ids actually shown**. Anything else becomes no citation at all. One rule is stricter than the meeting copilot's: the **title comes from what was shown, never from the model**, because a model that copies an id correctly and paraphrases the title produces a citation the user cannot recognise as their own page, and we already hold the real value. The deterministic engine reports its source directly and is deliberately NOT whitelist-validated — its citation is true by construction, and re-validating it against a prompt budget that was never applied would downgrade a real citation and tell the user the model invented a line they wrote themselves.

**A page heading with nothing under it is never emitted, and this one nearly shipped.** At a tight budget an early implementation emitted `## Payments migration (page id: p1) — excerpted; this page continues beyond what is shown here.` and no body: a real page title, a real citable page id, an explicit claim that the page continues, and zero content — an invitation to invent a project and attribute the invention to a page the candidate really has, which they then read aloud in an interview. The honest outcome is to say nothing about that page at all. `formatAttachment` takes the same position when it states in words that a video was not watched rather than leaving a bare filename.

**The test that caused it is the more useful lesson.** A budget assertion (`block.length <= budget`) is vacuously true against an empty block, so it was paired with a positive control (`block.length > 0`) — correct instinct. But the fixture's page bodies were a single unbroken 1200-character line, which no honest excerpt can fit into a small budget, so the only way to satisfy both was to invent the heading-only block. The control now uses prose-plus-bullets, which is what a project page actually is, and it is paired with a case asserting the opposite boundary: an unsplittable page that cannot fit yields an empty block. **Whenever a control asserts "it must say something", the case asserting "and here it must say nothing" is what pins the boundary.**

**Citations must survive the cache.** `pageSources` is written to and read from both caches alongside `cues`/`buzzwords`/`anchor`/`idealProject`, defaulting to `[]` for entries cached before the field existed. A field that reaches the renderer but not the cache produces an answer that shows its sources when freshly drafted and loses them on the second ask, for the same question, with nothing on screen explaining why — the failure `useDraftAnswer.js` already names for `cues`.

**And the citation has to reach the SCREEN, which only a rendering test can say.** `app/copilot/AnswerLines.pageSources.test.js` (added to step 1) is the only test in this repo that mounts `AnswerLines.js`, the single component every answer surface renders its bullets through. It pins that a line's `pageSource` renders as READABLE TEXT inside the SAME `<li>` as its point, in reading order — never colour alone (WCAG 1.4.1), never a sibling element a screen reader announces as a separate item — and that a line with no `pageSource` renders no placeholder and no empty wrapper, so a draft with no citations at all is byte-identical to before the field existed. A citation validated perfectly by `resolvePageSources` and then dropped, or rendered detached from its point, fails this case's whole purpose while every pure test above stays green.

**What was deliberately NOT done, with the reason.** `lib/copilot/answerGrounding.js`'s `groundingFor` did not grow a knowledge-base field. It runs on the CLIENT at cache-read time, and the client has no view of the knowledge base by design; a route-returned fingerprint stored on the entry would be compared against itself and always match — a field that looks like a guard and is not, which is worse than none. So editing a project page does not invalidate an answer already cached in the same live session. If that is ever fixed, the fix is a server-side max-`updated_at` endpoint, not a fourth client-side field.

### R-255 | area: copilot-knowledge-base | parallel-safe: yes | automatable: no

**Summary:** With a real knowledge base, a behavioural answer names one of your actual projects and its actual numbers.

**Steps:**
1. Sign in and open Professional Experience. Ensure at least eight project pages exist, with the one relevant to the question you will ask placed **low in the sidebar**, not at the top. Give it markdown bullets carrying a concrete metric.
2. Attach a PDF to that page and write a note on the attachment naming a number.
3. Open `/copilot`, select the posting, and ask a "tell me about a time" question that matches that page.
4. Confirm the drafted answer names that project and uses its own detail, not a generic résumé line.
5. Confirm each answer line shows which page it came from, as readable text — not colour alone — with no extra click to reveal it.
6. Ask the same question again and confirm the sources are still shown on the cached answer.
7. Switch the engine to embedded and repeat step 3. Confirm the answer is still built from that page, and that every word of it literally occurs on the page.
8. Ask a question that matches NO page. Confirm no page is cited and no unrelated page is spoken as your story.

**Expected:** Step 4 is the whole point of the feature and is what the original report was about. Step 8 is the honesty half: `matched: false` means the page was merely the first eligible one on file, not the one the question is about, and presenting it as a story is the deterministic engine's version of inventing relevance — before this change a beekeeping-club page was drafted as `"Situation: Beekeeping club minutes."` in answer to a question about migrating a payments ledger.

**Manual because this repo structurally cannot test it:** `vitest.config.js` defaults to `environment: "node"`, and the automated cases above verify the retrieval and the citation logic, not what a candidate actually reads on screen mid-interview.

### R-256 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** A page the model was shown but that said nothing is never in the prompt, and never citable.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/knowledgeBase.test.js lib/copilot/pageSourceTitle.test.js app/api/copilot/answer/route.knowledgeBase.test.js`.
2. Read `contributesMaterial` and `hasProseContent` in `hello-world/lib/experience/knowledgeBase.js`.

**Expected:** All tests pass. Every case below was found by a whole-diff review AFTER the feature was built, tested and green, and every one of them reached the model at the real production budget of 12000 characters. They share one shape: **the prompt names a page and gives the model nothing to say about it**, in a prompt that also demands the model cite page ids — so the citation validates, and the user is told a fabricated point came from a page they really own.

**Four ways an empty page reached the prompt.**

1. **Page stubs.** The block builder this replaced filtered on `p.title || p.body`; the port dropped that guard and nothing replaced it. Creating a page and filling it in later is the ordinary way to use the tree, so `## Draft page I never wrote (page id: empty2)` shipped to the model with nothing behind it. Eligibility now requires a non-empty body **or** at least one attachment line. The check sits at the eligibility stage, not in the packing loop, deliberately: an empty stub must not be counted into "N pages not included to fit the budget", because the budget is not why it was left out.
2. **A table of contents as an excerpt.** Block packing is skip-and-continue, so when every *content* block exceeds a page's share, the only blocks that fit are the page's own `##` headings. A 26863-character page produced **186 characters** of headings and elision markers. An excerpt must now contain prose, or the page is skipped.
3. **Rationing against pages that do not exist.** `EXCERPT_SHARE_DIVISOR` stops a long top-ranked page starving pages two and three. It was applied unconditionally, so a single relevant page got **3973 of 12000 characters** — less than the 6000-char cap this whole change exists to raise, in exactly the one-relevant-page case the feature is about. The divisor now applies only while another candidate could still use the budget.
4. **A citation with no name.** A page needs a title *or* a body to be eligible, so a blank title with a real body is legitimate and common. The deterministic engine passed `title: ""` through to the renderer, producing **"From your  page."** — the sentence with its subject missing — read aloud mid-interview. `buildKnowledgeBaseBlock` already defended the identical field with `"Untitled project"`; that asymmetry is what marked it as a bug rather than a choice. Both paths now share the constant.

**Also fixed here, all found by the same pass:** a blank point returned by the model voided **every** citation on the answer, because `points` was filtered and sliced while `pageIds` was passed through untouched and the length check then failed (the all-or-nothing pairing rule is right; normalising only one of the two arrays was the bug — they are now paired by index *before* filtering); an elision marker claimed material was dropped between two blocks when the only thing between them was a restored heading; the honesty sentence was assembled last, so a clamp would have eaten it while the attachment lines it guards survived; a heading indented two spaces was a heading to the renderer and a paragraph to the segmenter, silently breaking heading-context restoration; and a body line of three dashes was indistinguishable from the page separator, letting the model read one page as two and attribute the second half to no id.

**The test that could not catch case 2 is the lesson worth keeping.** A case named "never emits a page heading with nothing under it" already existed and passed. Its fixture was a body with **no headings at all**, so `splitBlocks` yielded one oversized paragraph, the excerpt came back empty, and the guard fired — exercising a different branch from the one the defect lives in. A test can assert exactly the right rule against a state the system never reaches and stay green forever while the real state goes unhandled.

### R-257 | area: copilot-knowledge-base | parallel-safe: yes | automatable: no

**Summary:** The ranker cannot see the subject of a technical question, and this is knowingly unfixed.

**Steps:**
1. From `hello-world`, write a throwaway vitest file importing `significantTerms` from `lib/copilot/projectStories.js` (the repo alias needs vitest to resolve) and run it over: `"Walk me through how you scaled our API to handle 10x traffic using AWS, SQL and Go."`
2. Confirm the result is `["walk","through","scaled","handle","traffic","using"]`.

**Expected:** It is. **`API`, `AWS`, `SQL`, `Go` and `10x` are all dropped**, by the tokenizer's four-character floor, symmetrically on the query side and the page side — so for a technical interview the highest-signal tokens in the entire corpus are exactly the ones the ranker throws away, and every term that survives is a non-discriminating verb.

The same measurement on a behavioural question shows the second half of the problem: scoring a page of pure interview boilerplate ("a time when... the approach... the situation...") against a page that really documents convincing a skeptical stakeholder gives the **boilerplate 6 and the real page 4**. Unweighted set-overlap has no way to know that "time", "about", "what" and "situation" carry no information.

**This is recorded rather than fixed, deliberately, and it is the next chunk.** The fix is BM25 over the pages already in memory — no vector store, no embeddings, no new dependency — shipped together with lowering the token floor, because dropping the floor is only safe once IDF exists to discount common terms. It changes `significantTerms`/`overlapScore`, which `lib/meeting/insightsLocal.js` and `lib/meeting/meetingContext.js` both import, so it is a shared-contract change across two domains and gets its own acceptance criteria, tests and review rather than being bolted onto the end of this one.

**One thing it does NOT subsume, contrary to the obvious reading:** `stripLinePrefixes`. The argument that IDF would handle "Them" appearing once per interviewer turn is wrong — BM25 weights a query term by how many *documents* contain it, not by how often it repeats in the query, so if few pages contain "them" its IDF is *high* and it would poison the ranking exactly as before. The stripper stays.

**Also deferred, with reasons, so none of it is silently dropped:** restating the interview question at the tail of the prompt (Google's published guidance is explicit that the query belongs after long context, and roughly 11000 tokens currently sit between them — but it changes the prompt for users with no knowledge base at all, breaking a pinned byte-identity guarantee, and it is general prompt work rather than knowledge-base work); reordering the stable blocks so the prompt has a cacheable prefix (void while the question sits at position 1, so it must ship with the item above); `thinkingConfig` with a zero budget, which is likely the largest latency lever on this route but needs an A/B, because thinking may be buying the answer quality this work exists to improve; migrating to `responseSchema`, which cannot express the arity constraint the citation safety property rests on and risks stalling the first streamed frame without `propertyOrdering`; and narrowing the `select("*")` projections in `listPages`/`listAttachmentsByPage`, which are shared data-access functions where narrowing for two known callers is how a third breaks silently.

### R-258 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** The deterministic engine will not speak one of your pages unless the question is really about it — and will not stay silent about a page just because a boilerplate page outscored it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/storyMatchHonesty.test.js lib/copilot/starBeatOrder.test.js app/api/copilot/answer/route.knowledgeBase.test.js`.
2. Read `clearsHonestyGate` and the selection loop in `hello-world/lib/copilot/projectStories.js`.

**Expected:** All tests pass. **`matched` is not a relevance score — it is the gate that decides whether the app may speak one of the candidate's own pages as their experience, and (since this group) whether it tells them in writing which page an answer came from.** It took four attempts to get right, and the failures are recorded because each looked correct when it shipped.

**Attempt 1 — `overlapScore > 0`.** Bare set overlap on `/[a-z0-9]{4,}/`. Asked *"Tell me about a time you disagreed with your manager"*, it answered with a **beekeeping page**, because "time" and "with" occur on it:
```
Situation: Beekeeping club minutes.
Action: We spent time each spring checking the hives with the club members.
```
**Attempt 2 — document frequency plus a hand-written boilerplate list.** Still opened on `"time"` alone (*"Tell me about a time you failed"* → an unrelated Settlement pipeline page), still opened on `"worked"` + `"project"`, and now also **rejected genuine matches**: two pages both mentioning Kafka made "kafka" look common, so *"Tell me about your Kafka experience"* matched nothing.

**Attempt 3 — the current rule.** Question terms minus the repo's existing 169-word stopword list (the same list `lib/copilot/resumeAnchor.js` already uses for the same reason — see its "C3 regression" comment), minus a small `INTERVIEW_SCAFFOLDING` set for words that are content-free *specifically in an interview question* and so are absent from a general-purpose list. Match on **two distinctive terms, or one that appears in the page's TITLE**. The document-frequency map is gone: over a few dozen personal pages it carries no information and was the direct cause of the Kafka rejection.

**Attempt 4 — ask the gate about the right page.** The selection loop still picked its winner on the RAW score, scaffolding included, and only then applied the gate — so a page called **"Interview prep"** (a page real users keep) took the argmax on "time"/"difficult"/"problem", failed the gate, and the genuinely relevant page was never considered. The loop now tracks both the raw argmax and the best gate-clearing candidate, and prefers the latter.

**Known and accepted, not a defect to re-fix:** a codenamed page ("Project Northstar", with Kubernetes only in the body) still fails a one-term question, because the single-term branch requires the term to be in the title. Declining to speak is the safe direction; the real answer is R-257's ranking work.

**Two other fixes ride here.** The STAR **Result** beat could be a bullet appearing *earlier* in the page than the Action it supposedly resulted from — it is now chosen by document position after the Action, or omitted entirely, because two honest beats beat three with a false one. And `grounding.pages` — which drives the sample-answer caption — was derived from `matched`, so a page that cleared the gate but yielded no bullets (any page written as prose rather than a list, which is the common case) produced a caption claiming "and your own project pages" over an answer containing none of them. It is now `pageSources.some(Boolean)`: true by construction.

**A fix nothing can catch is a fix nobody can keep.** That last one survived a sabotage run — reverting it left the whole suite green — because every existing fixture used a bulleted page, where the two derivations agree. The prose-page case now has its own test, and it was sabotage-checked before being believed.

