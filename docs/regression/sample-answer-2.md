### R-133 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The posting words offered for an answer are about the question on screen, and are absent rather than constant when nothing fits.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/postingBuzzwordsRelevance.test.js lib/copilot/postingBuzzwords.test.js`.

**Expected:** All tests pass. Two different questions against the SAME posting produce different lists — asserted directly, because the reported bug was that they did not. A question about higher-education technology platforms surfaces "Education" and "SQL" and does NOT surface "CRM", "SDLC" or "Artificial Intelligence"; a salary-expectations question surfaces nothing at all.

Relevance runs two independent signals against `question + points`, and both are needed. **Canonical intersection** runs the SAME `extractKeywords` over the question/draft that already ran over the posting, so an alias the taxonomy knows resolves the same way on both sides ("higher education" → `Education`); a second, cheaper heuristic would let the two disagree about what a term means. **Word overlap** covers everything the taxonomy has no alias for, with a deliberately dumb trailing-`s`/`es` plural fold so a question saying "CRMs" matches a posting term "CRM".

Word overlap requires **all** of a term's significant words to be covered, not any one of them. This is load-bearing and was found by testing: with "any", the word "salary" in a salary-expectations question matched the posting's own "Salary range:" line through the RAKE topic tier, and the section filled up with coincidental single-word overlap — the same class of noise the whole case exists to remove. A term whose words are all stopwords or shorter than three characters (a bare "Go", "R", "C") can never clear that bar and is reachable only via canonical intersection.

`literallyMentioned(canonical, description)` still runs FIRST and independently of relevance: a term can be exactly what the question is about and is still dropped if the posting never said it (the "team" → "Microsoft Teams" hazard). `MAX_BUZZWORDS` is 4. Order is overlap count, then tier, then extractor score, then discovery order — fully deterministic for one (posting, question) pair. A taxonomy failure on EITHER extraction degrades the section to `[]` rather than breaking the answer around it.

**Known limitation, deliberately not fixed here — read this before "improving" the gate.** Both relevance signals require the term's own concept to be present in the question or draft already, so this row now CONFIRMS vocabulary rather than SUGGESTING it. Demonstrated: against an infrastructure posting naming Kubernetes and Terraform, the question "How do you approach infrastructure work?" returns `[]` even with a draft saying "container platform", "infrastructure modules", "pipeline" and "deploys" — because none of it contains the literal words "Kubernetes" or "Terraform", and the taxonomy resolves no shared canonical. Arguably that is the case where naming Kubernetes would help most.

Fixing it needs deterministic topical relatedness, and the two obvious sources do not provide it. Widening to "same taxonomy CATEGORY" is far too coarse — every technical question would surface every technical term, which is the constant list this case exists to eliminate, wearing a different hat. Bridging through `skill_groups.json` was investigated and rejected: those groups are the USER'S OWN résumé vocabulary, not a general ontology (they contain "Drupal", "Zoom", "Git" and no Kubernetes at all), so they would invent relationships rather than find them. The current gate is kept because it demonstrably fixed the reported failure and produces genuinely per-question output on real postings; a future fix needs a real relatedness source, not a looser threshold. Anyone loosening this must first re-run the three-questions-one-posting check at the top of this case.

### R-134 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A résumé bullet is never presented as a job title or an employer, and the project survives when the header cannot be read.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/resumeAnchorPlausibility.test.js lib/copilot/resumeAnchor.test.js`.

**Expected:** All tests pass. The reported string — "Collaborated with business leaders at and development teams to translate product roadmaps into detailed requirements" — is asserted unproducible. A field earns display only if it still reads as a NAME once out of the parser: at most 6 words and 60 characters, capitalised, not opening with a verb from the shared `ACHIEVEMENT_VERBS` (imported, never re-declared), and carrying no sentence punctuation mid-string. "Product Curriculum Lead", "Senior Software Engineer", "VP of Product", "Acme Learning" and "Acme, Inc." all survive.

**`title` and `company` are gated as a PAIR, not independently, and that is the subtle part.** On the reported résumé the company half is obviously garbage, but the title half — "Collaborated with business leaders" — passes all four checks on its own: four words, capitalised, no stray punctuation, and "collaborated" is not in `ACHIEVEMENT_VERBS`. Gating in isolation would therefore still have rendered half the original bug as "Closest role on your resume". They are not independent observations: `parseHeader` tears both out of the same clump of header lines by splitting on commas, pipes, "at" and "@", so one non-empty field failing is evidence the SPLIT landed wrong, not that one half happens to be bad. One failing blanks both. A field that is merely ABSENT — the parser legitimately found no second segment — is not evidence of anything and never contaminates a good sibling; only non-empty text that fails the check does.

`project` and `description` are unchanged by a failed header gate: they come from the role's own bullets, they are still true, and the UI labels the row "From your resume" instead of naming a role. `matched` keeps its exact meaning — the gate changes which FIELDS are shown, never which role is selected. `parseEmploymentHistory` is deliberately untouched: it is best-effort by design, it is shared with the résumé-tailoring flow, and every résumé layout it cannot read would otherwise become a new special case in a parser serving two callers.

`gateHeaderPair` is exported alongside `resumeAnchor` for one specific reason: `parseHeader` splits every segment on `,\s+`, so a comma-bearing company like "Acme, Inc." can never reach `resumeAnchor`'s output as one string and no résumé fixture can route it through. Asserting the gate's own verdict on that literal is the only way to pin that a real comma-bearing employer is not rejected.

### R-136 | area: sample-answer | parallel-safe: yes | automatable: no

**Summary:** The reading aids under a drafted answer read as one organised thing, in two groups, with the candidate's own material first.

**Steps:**
1. Open `/copilot`, pick a posting whose application has a submitted résumé, and draft an answer in live mode. Repeat in practice mode, and check the dashboard's current-answer panel, the question-feed card, and practice's sample-answer panel.
2. **In Safari, with VoiceOver on, reach the posting-words row in PRACTICE mode** and confirm the terms are announced as a list with an item count. Practice mode captures with `getUserMedia`, so Safari is a supported route here — live mode's Chrome/Edge-only constraint does NOT cover this component.
3. Narrow the viewport below the `sm` breakpoint and confirm each label is visibly closer to its OWN value than to the next label.
4. Read `app/copilot/AnswerAids.js` and count: distinct `variant=` values and distinct `Chip` style objects.

**Expected:** Two description lists inside one wrapper, grouped by WHOSE material it is: the candidate's role and project first, a divider, then the posting's words. Both `dl`s share one grid style constant and one `Aid` row component. Exactly **two** `variant` values (`caption` on `dt`, `body2` on every value) and exactly **one** `Chip` style. The `description` phrases are subordinate by COLOUR, not by a third font size.

This case exists because the user's report was not only about content: "the text/styling is all over the place. chips, then a header, then bold, then smaller, then a separate section" and "this section needs to be far more organized". The previous layout stacked four visual languages in one flat `dl` and put the posting-derived keyword row ABOVE the candidate's own résumé material.

Below `md` (**amended: this was `sm` until the mobile pass -- see R-157/R-159's group; the two-column form starved the value column to ~8px at exactly 600px, where the dashboard's own grid also flips to two columns**) the grid collapses to one column, ordered `dt, dd, dt, dd`, and **the gap inside a pair must be smaller than the gap between pairs** — `rowGap` is tightened at `xs` with a matching `dt` top margin (first row excepted). A single uniform `rowGap` puts a label exactly as far from its own value as from the next label, destroying the pairing on a phone; the layout this replaced did not have that flaw, and step 3 exists to catch it. Empty states: a group with no populated row renders neither its `dl` nor the divider; both groups empty renders `null`. A résumé whose header failed R-134's gate still renders its group, labelled "From your resume". No heading element is introduced at any point (R-125).

The buzzword `ul` carries an explicit `role="list"`. This is NOT redundant and must not be deleted as such: its `sx` sets `listStyle: "none"`, which strips the implicit `list` role in Safari/VoiceOver, and the chips are then announced as loose text with no indication of how many terms there are or that they form a set.

The group divider carries `role="separator"` and is **decorative reinforcement only — it does not carry the grouping.** Measured contrast against `--bg-soft` is 1.28:1 in both themes, and `--border-strong` only reaches 1.76:1, so it cannot meet WCAG 1.4.11's 3:1 floor and must never be treated as a meaningful graphical object. The grouping is carried by the row labels, each of which already names whose material it is ("Closest role on your resume", "Words from the posting to work in"). Do not "fix" the divider's colour under the impression it is load-bearing; if the grouping ever needs to be programmatic, give the lists accessible names instead.

**Known limitation, accepted deliberately:** `display: grid` on a `<dl>` can drop the description-list role in WebKit, and this component IS reachable in Safari via practice mode — the earlier justification that only Chrome and Edge matter was simply wrong, since that constraint belongs to live mode's `getDisplayMedia` capture, not to this component. The limitation is benign: no text depends on the role, labels remain visible text immediately before their values in DOM order, and the content is complete and correctly ordered either way. Moving the grid off the `dl` would require wrapping each pair in a `div`, which breaks column alignment across rows.

