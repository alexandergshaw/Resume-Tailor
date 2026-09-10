### R-322 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** The cue is never repeated. Every bulleted line used to print its own words twice — a bold few-word "cue" in front of a sentence that already contained those exact words. Measured over the embedded engine's whole corpus before the fix: **3,137 of 3,137** cued lines carried their cue's normalised tokens as a contiguous run inside their own point, and **zero** cues anywhere added a word the point did not already contain. The bold is now a span INSIDE the sentence rather than a copy in front of it.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/answerPoints.cueEmphasis.test.js`.
2. In the app, with the embedded engine selected, draft a live answer for any question with a résumé attached.

**Expected:** No bulleted line shows the same words twice. The bold text at the front of each line is part of that line's own sentence, and the sentence is not restated after it — there is no `**X** — X` shape and no em dash joining a cue to its point. Recorded: median rendered line **18 → 11** words in live mode, **23 → 16** in practice from this change alone.

### R-323 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** Practice mode's sample-answer bullets are short, and short for a reason that is stated rather than enforced by truncation: no bullet is ever clipped, so a bullet over the ceiling is a whole line of the candidate's own material that had no shorter sibling.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/answerCarriers.test.js`.
2. Draft practice sample answers with a résumé attached, for a behavioral, a technical and a general question.

**Expected:** R-322's check holds in practice mode too. No sample-answer bullet runs past **12 words** UNLESS the candidate's material offers nothing shorter, or the bullet is quoted from a matched project page — and in both of those cases the bullet is a WHOLE line, never one ending in `…`. Every bullet is still a complete sentence that stands on its own. Recorded: practice median rendered **23 → 11**, maximum **27 → 20**, and the maximum is the exempt page bullet.

### R-324 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** Emphasis survives the cue removal, including on STAR-labelled lines, where the label leaves the bold and keeps a weight of its own. **1,823** rendered lines (live **1,112**) carry no STAR label and DO carry a cue, so a pure drop with no replacement span would have left them with no emphasis at all.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/AnswerLines.emphasis.test.js`.
2. Draft a live general or technical answer (no STAR labels) and read the bullets.
3. Draft a practice behavioral answer (STAR labels) and read the bullets.
4. Find a bullet whose whole sentence is six words or fewer.

**Expected:** In step 2 each bullet still has bold text at its front and that bold text is **part of** the sentence. In step 3 the `Situation:` / `Task:` / `Action:` / `Result:` label is still visibly heavier than the surrounding text but is **not** inside the bold span — that span is now the cue's words inside the sentence (**1,314** lines change this way). In step 4 the bullet shows no bold at all. **No bold span begins or ends in the middle of a word, and no bold span ends on a comma or a colon.**

### R-325 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** No bullet quotes a job title as an example of work. `rankedExperienceLines` scores a line on question overlap plus a "signal" bit that a DATE RANGE satisfies, so a CV position header out-ranked every accomplishment bullet beneath it. Measured before the fix on the flagship material: the position header was quoted on **23 of 56** practice cells and **49 of 56** live ones.

**Steps:**
1. Attach a résumé whose Experience section opens `Senior Engineer, Acme Payments | 2019 - Present` followed by ordinary accomplishment bullets. Ask *"Tell me about yourself."* in **both** modes.
2. Repeat with the top line as `Senior Engineer, Acme Payments — 2019` (a single terminal date rather than a range).
3. Repeat with the top line as `Engineer, Acme | 2019 - 2021` — a one-word title and a one-word employer.
4. Repeat with `Managed Engineering, Design and Product Teams, 2019 - 2021` as the résumé's **only** accomplishment line.

**Expected:** In steps 1–3 the concrete example is an accomplishment bullet, never the position header, in both modes. Step 3 is the shape a substring-matching classifier misses; step 2 is the shape a range-only date regex misses. In step 4 the line **is still quoted** — the classifier misreads it as a header, and demotion rather than deletion is why it survives as the only thing on file.

### R-326 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A cover letter is never quoted as work. The practice technical shape was the one path that passed an UNFILTERED experience line where the behavioral and general shapes passed a past-work-filtered one, so a motivation sentence — which out-scores a real accomplishment on keyword overlap alone — was quoted back as something the candidate had done.

**Steps:**
1. Attach a cover letter reading *"I am applying for this role because I want to work on developer tooling."* and nothing else. Select interview type **technical** and draft a practice sample answer.
2. Repeat with two real accomplishment lines in the same cover letter alongside that sentence.

**Expected:** No bullet presents the motivation sentence as an example of past work in either case. Step 2 is the worse of the two — real accomplishments are on file and the motivation line was quoted anyway. The sentence may still appear in the general shape's CLOSING beat, framed as motivation (`I'm drawn here because …`), which is where it belongs.

### R-327 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** Live's metric is never borrowed from another line. In the no-documents branch the metric was mined from the whole profile while the example was mined from one line, so the app could state that the outcome of the story on line A was the figure on line B.

**Steps:**
1. With **no** résumé and **no** cover letter attached, set a profile containing a story on one line and an unrelated quantified figure on another.
2. Draft a live answer for a behavioral question.

**Expected:** The `Result:` bullet does not present that figure as the outcome of that story. Either the figure comes from the same line the example does, or the beat falls back to *"(a metric or clear impact)"*.

### R-328 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** No bullet ends in `….`. One `relevantExperienceLine` call in the tree was not wrapped in `usableExperienceLine`, so a profile line past `cleanLine`'s 140-character clamp was quoted with a mid-word ellipsis in it. Measured before the fix: **56 points**, 12.5% of live's cells, and live's worst rendered line was **29 words**.

**Steps:**
1. With **no** documents attached, set a profile whose top line runs past 140 characters.
2. Draft live answers across several interview types.

**Expected:** No live bullet shows a mid-word ellipsis. A quote that visibly stops mid-word is never something a person would say out loud, so the beat drops the example rather than clipping it.

### R-329 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A one-word project page title does not become a Situation beat. `Situation: API.` is a label plus a noun, not a sentence, and padding it into one would put words in the candidate's mouth that the page does not contain — every point that producer returns is marked page-derived, so an invented sentence would ship carrying the page citation.

**Steps:**
1. Create a project page titled with a single word, with at least one bullet, and make it the best match for a behavioral question.
2. Draft a practice sample answer.

**Expected:** The answer is the résumé-grounded one, not `Situation: <word>.`, and it is not empty. A two-word title is still accepted — the floor is a minimum, not a ban.

### R-330 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** The spoken answer still matches the bullets. The prose read back on the practice sample answer is derived from the points and never generated separately, so it cannot drift from what the bullets say.

**Steps:**
1. Draft a practice sample answer and compare the spoken prose with the bullets, word for word.

**Expected:** Word-for-word identical. **It is SHORTER than before this change in both modes, and that is intended** — the derivation is unchanged, the points are shorter.

### R-331 | area: copilot-answers | parallel-safe: no | automatable: no

**Summary:** A model-written cue still shows. The cue-duplication rule fires only when a cue's normalised tokens are a verbatim contiguous run of its own point, so a cue that genuinely paraphrases survives untouched — which is the shape the Gemini path supplies. **Manual: this case needs the live service and cannot be automated.**

**Steps:**
1. With the Gemini engine selected, draft an answer whose cues genuinely paraphrase their bullets.
2. Construct (or wait for) a model cue differing from its bullet only by punctuation — `"Cut CI time in-half"` against `"Cut CI time in half"`.

**Expected:** In step 1 the cue is still rendered in front of its bullet, in the old two-part form: label and cue inside one `<strong>`, an em dash, then the sentence. In step 2 the whole bullet does **not** render in bold — a run covering the entire point is treated as the identity case and the cue is dropped with no span.

### R-332 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A skill the candidate never wrote is never claimed. The no-documents mining branch did not filter mined skills through `literallyMentioned` where the has-documents branch did, so a taxonomy inference — "team" canonicalised to the product **Microsoft Teams** — shipped as a claimed skill. Measured before the fix: 6 live cells.

**Steps:**
1. With a **profile only** — no résumé, no cover letter — whose text contains the word "teams" and never contains "Microsoft", ask *"Tell me about yourself."* in live mode across several interview types.

**Expected:** No bullet names **Microsoft Teams**, or any other skill whose canonical name does not literally occur in the profile.

### R-333 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A résumé with no short bullets still gets a real example. A length rule applied as an admission test returns nothing on such a résumé, and the answer then states that nothing is on file while the candidate's résumé is open. Measured: under a hard ceiling this material grounds **0 of 56** practice cells; with the ceiling applied as a preference and a fallback, **56 of 56**.

**Steps:**
1. Attach a résumé that is a position header plus ONE accomplishment line longer than 12 words, plus a skills line.
2. Draft practice sample answers across all interview types and questions.

**Expected:** The bullet quotes **that accomplishment line**, whole, never the position header, and **no bullet says nothing is on file**. Recorded: 56 of 56 cells, on all three shapes. The bullet is over the 12-word ceiling and that is correct — the ceiling is a tie-break between candidates, not an admission test.

### R-334 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** Live's bullets are short. Attributing every live rendered line to its producer showed the long tail was made of four grounding CARRIERS — the coaching sentence in front of the example, not the example — at 9 to 13 fixed words each. Cutting them to a short imperative plus "e.g." costs **zero** grounding, because the carrier is template prose and was never part of what makes a point grounded.

**Steps:**
1. With a résumé attached, draft live answers for a behavioral, a technical and a general question.

**Expected:** Each bullet that carries a concrete example reads as a short instruction followed by the example — `Action: Describe it — e.g. …`, `Ground it — e.g. …`, `Anchor it — e.g. …` — never the old full-sentence preamble. The Situation beat names the company and title directly rather than saying *"a specific project at X as Y"*, **and still reads as an instruction, not as a bare company-and-title**. Recorded: live's longest bullet **25 → 20** words; bullets of 20 or more words **153 → 27** of 1,976; **typical bullet length does not change (median 11 before and after) — this is a tail cut, not a shortening of the typical line**; and the number of bullets grounded in the candidate's own material does not change (**280 of 448** cells). The UNGROUNDED arm of each carrier is deliberately unchanged — with no example to carry, the instruction is the point.

### R-335 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A matched project page is still quoted and still cited. The page bullet is exempt from both the past-work filter and the length ceiling: it is the single most relevant thing the candidate has, a page they wrote that matched this question, and it is true by construction because the drafter read it itself. It is also what sets both modes' tails, and nothing bounds it beyond `cleanLine`'s 140 characters.

**Steps:**
1. Create a project page whose FIRST bullet is 15 words and does NOT start with an achievement verb — e.g. *"the reconciliation ledger we rebuilt now closes the books in under an hour every night"*.
2. Draft answers in **both** modes for a general and a technical question that the page matches.

**Expected:** The bullet is quoted **whole**, never truncated, and the line *"From your <page title> page."* still renders underneath it. It must survive both the past-work filter (it is not verb-initial, so an unguarded filter drops it) and the 12-word ceiling (it composes to more than 12, so an unguarded ceiling deselects it). Recorded: it is what sets both tails — practice **20** words on the general shape, live **20** on the behavioral. Note that a producer building a SENTENCE out of the bullet capitalises its first letter, so a check for the bullet inside a point has to be case-insensitive.

### R-336 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A misread accomplishment loses its place in the queue, not its place in the answer — and the rule's COST is pinned as well as its benefit. The header classifier cannot be made correct: a verb-initial, title-cased, multi-segment accomplishment that names a job is indistinguishable from `<title>, <employer> | <dates>` by structure alone, and is misread on **8 of 8** and **4 of 5** held-out sets built to find it. **THREE halves, all required.**

**Steps:**
1. Attach a résumé whose only work line is LONGER than the ceiling and whose position header is shorter. Ask a technical question in practice mode.
2. Remove the work line entirely, leaving only the header and a skills line. Ask the same technical question.
3. Put the long work line back and replace the header with `Owned Sales Engineering, Support and Onboarding | 2019 - 2022` — a real accomplishment the classifier misreads as a header. Ask the same question across all 56 (question, interview type) pairs.

**Expected:** (i) the bullet quotes the **work line**, over the ceiling, and never the header. (ii) the bullet now quotes the **header**, because it is all there is — demotion, not deletion, is what keeps it reachable, and the alternative is telling the candidate nothing is on file while their résumé is open. (iii) the bullet quotes the **work line** (14 words, over the ceiling), **not** the 12-word misread line, on all 56 cells.

**(iii) is where this design LOSES two words per cell**, and it is recorded here so that a future change back to an unconfined ordering rule shows up as a diff rather than as a silent improvement in the grounding table. The grounding metric cannot arbitrate it: the source set is filtered with the SAME classifier that orders the candidate list, so the cell that ships the misread accomplishment records as ungrounded BY DEFINITION. An ordering rule that lets the length preference reach past a real accomplishment to a shorter job title passes (ii), fails (i) on 23 of 56 cells, and fails (iii) on 56 of 56.

### R-337 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** Every bullet stands on its own with its bold label covered up. A bullet here is read aloud, under pressure, out of order, next to three siblings, with a label in front of it that is navigation rather than content — so it has to survive being read by itself, without the bullet above it and with nothing on screen to resolve a pronoun against. This is a STRUCTURAL gate, not a judgement of prose: it cannot see interior anaphora, free relatives, or whether a sentence reads well.

**Steps:**
1. Draft answers in **both** modes for a behavioral, a technical and a general question with a résumé attached.
2. Read each bullet with the STAR label hidden.

**Expected:** Each one is a complete sentence: it **starts with a capital and ends with a full stop**, it **does not open with `And` / `But` / `So`** (which would make it a fragment of the bullet above), it **does not open with `It` / `This` / `That` / `They`** (which would have nothing to refer to), and it **is not a bare noun phrase** — `Action: Your steps — e.g. …` and `Situation: Acme Payments, Senior Engineer.` are both failures of this case, and neither may ship. Recorded: live **1,976 of 1,976**; practice **1,155 of 1,317** before this change, with exactly **three** known exceptions after it — a page-title Situation beat (`Situation: <page title>.`, 27 points) and two general-shape closing beats that open on `And` (12 and 5 points), 44 points in all. **A fourth exception is a regression.** Closing the remaining three needs a referent model and a predicated Situation beat for the page-story producer, both of which are their own work.

### R-352 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A drafted bullet can be opened for more detail, in both modes, and what appears under it is sub-bullets about THAT bullet. This is the workflow the feature exists for: the answer appears, the candidate needs to go deeper on one line, and the detail arrives under that line rather than replacing the answer or opening a dialog. **The bullet's own sentence is deliberately NOT the button** — the control is a "More detail" row directly beneath it — because a ButtonBase wrapping the sentence sets `user-select: none` (the answer stops being selectable mid-interview) and is a centred inline-flex (a multi-sentence paragraph breaks at the 320px floor). That deviation from the literal request is recorded here rather than left to be discovered.

**Steps:**
1. Draft an answer in live mode with a posting selected and at least one Professional Experience page whose title shares two distinctive terms with the question.
2. Click **More detail** on the first bullet.
3. Click it again. Then click it a third time.
4. Repeat all of the above in practice mode.

**Expected:** (i) sub-bullets appear as a nested list inside the SAME `<li>` as the bullet, indented under it, with the parent sentence unchanged above them. (ii) The second click collapses it: the nested list is **gone from the DOM**, not merely hidden, and `aria-expanded` returns to `false`. (iii) The third click re-opens it instantly with **zero** network requests — the content is cached on the normalised bullet TEXT, so it survives a collapse and survives a redraft that reproduces the same sentence. (iv) No other bullet changes in any of the three steps. (v) Nothing scrolls.

### R-353 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A sub-bullet is about ITS OWN parent bullet, not about the answer in general. The failure this case exists to catch is the one an implementation falls into by default: rank the page's lines against the QUESTION, and all six bullets get the same three sub-bullets. That satisfies every shape rule in the feature and is worthless, because the reader clicked one bullet and was handed the answer again.

**Steps:**
1. Draft a six-bullet answer against a project page that carries at least six distinct bullet lines.
2. Expand every one of the six.
3. Find a bullet whose subject nothing else on the page is about, and expand that one.

**Expected:** (i) No sub-bullet text appears under two different parents — the six sets are **disjoint**, because each page line is assigned to the one point of the answer it scores highest against. (ii) Each set reads as being about its own parent: its overlap with the parent beats its overlap with every sibling. (iii) The bullet with nothing further to say shows the explicit "nothing more" sentence rather than three sub-bullets about another subject. (iv) A page line that IS one of the answer's own points is never handed back as detail about another one.

### R-354 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** The embedded engine expands bullets with **zero** model calls and zero egress, and says so. Engine choice governs every AI feature in this app, so a Gemini-only expansion is an unfinished one — and the deterministic path is the privacy-preferred default here, not a degraded fallback, because every sentence it emits is a line the candidate wrote on one of their own pages, quoted whole.

**Steps:**
1. Set the engine to **Embedded**. Draft an answer and expand a bullet.
2. Read the caption under the sub-bullets.
3. Switch to **Gemini** and expand a bullet on a fresh answer. Read that caption.
4. With the engine on Gemini, break the provider (invalid key, or block the host).

**Expected:** (i) No outbound model request at all on Embedded, and sub-bullets still appear. (ii) The caption names the engine AND the material: "Found on this server with no AI provider in your `<page>` page." (iii) On Gemini the caption says Gemini. (iv) A failed Gemini call shows a **visible error with Retry** and never silently degrades to the deterministic path — a silent fallback would make the caption lie about which engine produced the text, which is the defect one level up that `sourceCaption` already had to be fixed for.

### R-355 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** Expanding bullet N elaborates bullet N. Two independent index shifts sit between what is rendered and the array the server validates against, and getting either wrong elaborates the WRONG bullet silently, with the right count and the right citation shape. **Both halves of this have already been got wrong once on paper**: the rendered line index is not the source index (a point that is nothing but its own STAR label is dropped AFTER the map), and the raw points array carries STAR labels while the rendered point does not — so a route comparing them raw would 400 every labelled point, which is most points on the behavioural path.

**Steps:**
1. Draft an answer whose points include a label-only entry (a bare `Situation:` with no sentence) as well as ordinary labelled points.
2. Expand each rendered bullet in turn and confirm the detail matches the bullet clicked.
3. Expand a bullet on an answer whose points are all labelled (`Situation: …`, `Action: …`).

**Expected:** (i) Every expansion elaborates the bullet it was opened from. (ii) A labelled point expands normally — a 400 here means the label strip was dropped from the server's identity check. (iii) The server refuses, with no model call and no database read, a request whose index does not name the sentence it claims to.

### R-356 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** "Nothing more to say" is a SUCCESS and looks like one; a failure looks like a failure; a switched-off feature says so and offers no Retry. Four sites in the answer route return `502 { error: "Could not generate an answer." }` on an empty result, and on two of them — the embedded branches — nothing had failed. Copying that precedent here would paint a red error alert over a truthful "there is nothing more here", which the candidate cannot tell apart from a broken feature mid-interview.

**Steps:**
1. Expand a bullet whose page has nothing further about it.
2. Expand a bullet with the network offline.
3. Set `COPILOT_EXPANSION_DISABLED=1` and expand a bullet.

**Expected:** (i) An explicit sentence, **not** styled as an error: no alert, no severity colour, no icon, no Retry (retrying an honest empty buys the same answer twice), no empty list (an empty `<ul>` announces "list, 0 items"), and `aria-expanded` stays `true`. (ii) An `Alert` with `role="alert"` and a **Retry** that re-issues exactly one request; a timeout says "That took too long to look up." rather than a generic failure. (iii) A sentence saying the feature is unavailable, with **no Retry** — retrying something an operator switched off is a lie. In all three, the parent bullet's own text is byte-identical and its control stays enabled.

### R-357 | area: copilot-answers | parallel-safe: no | automatable: yes

**Summary:** The spend is bounded before anything is spent. This is the app's second authenticated, paid, per-click endpoint and the first a user can fire once per bullet per answer, so all four controls are checked as one case. **`RESUME_ENGINE=embedded` is NOT an off switch** and must never be described as one: the engine resolver returns on the client's own `body.engine` before it ever reads the server env, so a client sending `engine: "gemini"` gets a model call whatever the server default says.

**Steps:**
1. Render a six-bullet answer and touch nothing.
2. Expand one bullet and click the control repeatedly while the request is in flight.
3. Fire more than 40 expansion requests inside ten minutes as one user, then expand a bullet as a DIFFERENT user.
4. Set `COPILOT_EXPANSION_DISABLED=1` and expand.

**Expected:** (i) **Zero** expansion requests — nothing is prefetched, including through practice mode's silent queue. (ii) One request, not one per click: a second click means "I still want this", and queueing would double the spend for a byte-identical result. Collapsing mid-flight is allowed and is **not** a cancel — the result lands in the cache and cannot reopen the panel. (iii) The over-bound request is refused with 429 and rate-limit headers, and the second user is **unaffected** — the bound is keyed on the server-resolved user id, never on a body field or an address. (iv) 503 with no model client constructed and no database client constructed.

### R-358 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** Expansion does not disturb the bullet it hangs off. The bullet's single emphasised run and its "From your `<page>` page." citation are both produced by expressions this feature does not touch, and the citation must stay visible with zero extra clicks — it is never moved into the panel or behind the disclosure.

**Steps:**
1. Draft an answer with an emphasised run in one bullet and a knowledge-base citation under it.
2. Expand that bullet. Collapse it.
3. Expand a bullet that has a citation and one that does not.

**Expected:** (i) Exactly **one** bolded run in the parent bullet, in the same place, in every state — the expansion subtree contains no bold or italic text of any kind, including the control's own label. (ii) The citation stays where it was: still inside the same `<li>`, still **before** the control, still plain readable text, in every state. (iii) Reading order inside the bullet is text, then citation, then control, then panel. (iv) A bullet with no citation gains no placeholder.

### R-359 | area: copilot-answers | parallel-safe: yes | automatable: no

**Summary:** The citation reveal is a **popover, not a modal**, and it never steals the answer. A `Popover`/`Dialog` traps focus, sets `aria-hidden` on the rest of the app and locks page scroll — over the sentence the candidate is reading aloud. It is portalled out of the answer pane on purpose, because that pane is its own scroll container at `md` and up and an in-flow overlay would be clipped by its edge. jsdom has no layout engine at all (`getBoundingClientRect()` returns zeros and the popper positions everything at the origin), so **nothing about position is asserted anywhere** and this case is the only check there is.

**Steps:**
1. Draft an answer with a knowledge-base citation, on a desktop window, in the dashboard's answer panel.
2. Hover the citation. While it is open, scroll the answer pane and click a bullet's "More detail" control.
3. Repeat with the citation on the **last** bullet, at the very bottom of the pane.

**Expected:** (i) The panel appears near the citation, fully visible, **not clipped by the pane's edge** and not off-screen. (ii) The page and the pane still scroll; the answer behind it is still readable and still reachable, and nothing is focus-trapped. (iii) On the last bullet the panel flips above the citation rather than being cut off.

### R-360 | area: copilot-answers | parallel-safe: yes | automatable: no

**Summary:** The reveal is legible on a phone. This is a tool used at 320px mid-interview, the panel carries the longest strings in the feature (a whole markdown block, plus a section list), and jsdom cannot lay out a single pixel of it. One measurement in particular is **unavailable in the test environment and is only checkable here**: jsdom resolves `text-align` on a `<button>` to the UA default `center` even when an author class rule that matches the element declares `left`, so the caption's left alignment is asserted only as a cascade *input*, never as a rendered result.

**Steps:**
1. At a 320px viewport, tap the citation on a bullet whose page has a long section body.
2. Tap a citation on a page with eight or more headings.
3. Rotate to landscape with the panel open.

**Expected:** (i) The panel fits the viewport, wraps rather than overflowing horizontally, the quote scrolls inside its own box if it must, and nothing is cut off. (ii) The citation caption itself wraps to multiple lines **left-aligned, not centred**, and its tap target is comfortably large. (iii) The section list is readable and capped, ending in "and N more." (iv) Rotation does not leave the panel stranded off-screen or overlapping the answer's first bullet.

### R-361 | area: copilot-answers | parallel-safe: yes | automatable: partly

**Summary:** Hover, focus and tap all reach it, and WCAG 1.4.13's three obligations hold in a real browser. Hover alone is unreachable by keyboard and does not exist on touch, where a spurious `mouseleave` arrives right after the tap — which is why activation **latches**. The timings are pinned by tests; whether 0ms open / 200ms close *feels* right to a hand moving across a phone is not, and is what this case is for.

**Steps:**
1. Mouse: hover the citation, then move the pointer **onto the panel** and read it; then move away entirely.
2. Keyboard: Tab to the citation, press Enter, Tab away, come back, press Escape.
3. Touch: tap the citation, scroll the page, tap elsewhere.

**Expected:** (i) It opens on hover, **survives the pointer travelling onto it**, and closes shortly after the pointer leaves both. (ii) Focus alone opens it; Enter latches it open so it survives a blur; Escape closes it **without moving focus**, and focus is still on the citation. (iii) Tap opens it and it **stays open** — a tap must never open-then-immediately-close; a second tap, or a tap outside, closes it. In all three, nothing closes on a timer.

### R-362 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** The blurb is the candidate's own heading or **nothing**. A section is not stored anywhere in this app — it is re-derived from a verbatim four-token run against the candidate's own page body — and naming one the data cannot support is the same class of error as the false-employer bug: something confident and wrong about their own material, read aloud in an interview. Where the run is absent or ambiguous the app must say **less**, not guess.

**Steps:**
1. Write a page with `## Automating compatibility checks` over a bullet; ask a question that draws on it; draft on the **embedded** engine, then on **Gemini**.
2. Write a page where the same phrase appears under two different headings, and draft an answer that uses it.
3. Draft an answer where the model paraphrases entirely, quoting none of the page's own words.
4. Give a page a heading of ten words and draft from it.
5. Edit the page to add a section, do **not** redraft, and reopen the same cached answer.

**Expected:** (i) "From your `<page>` page, under Automating compatibility checks." on **both** engines, with the panel showing that exact block. (ii) **No section named** — the ambiguous case falls back to the page alone. (iii) No section, no blurb, no control, and the citation line is byte-identical to what it was before this feature. (iv) No section, and **no truncated heading and no ellipsis and no em dash anywhere** — a heading is used whole or not at all. (v) The cached answer keeps whatever it was drafted with and never invents a section from the edited page.

