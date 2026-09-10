### R-081 | area: copilot-privacy | parallel-safe: yes | automatable: no

**Summary:** The copilot tells the user which transcription service actually receives their audio, rather than a hardcoded name.

**Steps:**
1. Read how the provider display name is obtained and used in `hello-world/app/copilot/CopilotClient.js`.
2. Read the privacy notice construction in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** The destination name is derived from the provider the server reports, not hardcoded to either vendor. Before the provider is known the notice omits the destination clause entirely rather than guessing or naming a placeholder. The engine clause, the camera-frames clause and the save-recordings clause are independent of this and unchanged. The provider probe uses the non-minting GET, so simply opening the copilot does not consume a transcription credential.

### R-091 | area: copilot-privacy | parallel-safe: yes | automatable: no

**Summary:** The practice-mode privacy notice names the submitted resume and cover letter as things a sample answer sends, because it does send them.

**Steps:**
1. Read the `engineNotice` construction in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** The document clause is governed by whether documents are actually going to be sent, in all four states. (1) No posting selected: no document clause at all — the sample-answer clause names only the question and the prep context. (2) Posting selected and the documents load has settled with at least one document found: both Gemini branches state definitely that revealing a sample answer sends that question, the prep context AND the submitted documents, and that the critique sends them too. (3) Posting selected, load settled, NEITHER document found: no document clause, because the routes skip the document sections entirely when both are empty and nothing is sent. (4) Posting selected but the load has not settled or has failed: conditional phrasing ("any resume or cover letter you submitted for it") — never a definite claim, and never silence, because a user who is not warned while documents ARE about to be sent is the worse failure. The embedded branch states that sample answers are drafted on the server too, and still claims nothing is sent to Google, in every one of those states. The camera-frames clause, the save-recordings clause and the transcription-provider clause remain independent of all of this and unchanged.

**Amended twice (group H):** originally the document clause was unconditional on both Gemini branches. It was first narrowed to "a posting is selected" — which was still wrong, and was caught in that group's own stage-10 run: an application with no `resume_used_id`/`cover_letter_id` fetches nothing and sends nothing, so naming Gemini as a recipient was still claiming a destination that was not receiving data, the exact defect this case exists to prevent. Selection is not the condition; documents actually existing is.

### R-098 | area: copilot-privacy | parallel-safe: yes | automatable: no

**Summary:** Live mode's document-grounding disclosure cannot be dismissed away while the documents are still being sent.

**Steps:**
1. Read the `postingGroundingNotice` derivation and its render site in `hello-world/app/copilot/CopilotClient.js`.
2. Confirm the render site is NOT inside the `showConsent` conditional.

**Expected:** The notice renders in its own always-visible element, outside the dismissible consent Alert. This is the point of the case: the consent Alert has an `onClose`, and it is shown before the user has selected anything, so a user who dismisses it and THEN selects a posting would otherwise have their submitted resume and cover letter sent to Gemini with no notice on screen at all. The notice is empty when no posting is selected, and empty when a posting is selected whose application turns out to have no submitted documents — in that case the route sends none, so claiming otherwise would name a destination receiving nothing (the same rule R-091 enforces for practice mode). While the documents load is still in flight or has failed, the wording is conditional rather than definite, because the answer is genuinely unknown at that moment and silence would leave the user unwarned if documents do exist. On the embedded engine it states that nothing about the application is sent to Google. The fact is stated in exactly one place, so the two sites cannot drift.

**Amended (regression pass, defect 1):** the "empty when a posting is selected whose application turns out to have no submitted documents" clause above stopped being the whole rule once R-227's company-research cue shipped: that cue reaches this exact state (posting selected, non-embedded engine, document load settled, neither document found) and always uses Gemini, so `postingGroundingNotice` now names that destination there instead of staying silent — see R-227's own "silent branch was the wrong answer" note. The corrected rule: that branch is empty ONLY when the posting additionally has no company on file (`hasCompany: false`) — `companyBriefRequest`/`useCompanyBrief` never issue a company-research request for a companyless posting, so there is nothing left to disclose. `postingGroundingNotice` shipped with no such guard at all — every fixture in `groundingNotice.test.js` fixed `company: "Acme Corp"`, so a titled, companyless posting (reachable: `normalizePostingRows` drops a row only when it has NEITHER a title nor a company) was never exercised, and the branch asserted a Gemini request while `useCompanyBrief`'s fetch could never fire for it. Guarded now, matching `companyResearchDestination`'s own `hasCompany` check exactly; `groundingNotice.test.js` pins both outcomes.

### R-259 | area: copilot-privacy | parallel-safe: yes | automatable: yes

**Summary:** Both copilot surfaces tell you that your project pages and attachment file names are sent, and the sentence is true wherever it appears.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/knowledgeBaseDisclosure.test.js lib/copilot/practiceNotices.test.js lib/copilot/practiceNotices.noPreDraft.test.js lib/copilot/groundingNotice.test.js app/copilot/answerLineContrast.test.js`.
2. Read `KNOWLEDGE_BASE_CLAUSE` in `hello-world/lib/copilot/practiceNotices.js` and its three importers.

**Expected:** All tests pass. This is the `BUG-H5` class the notice modules already name in their own headers — **a new feature silently falsifying an existing disclosure** — and this group shipped it twice before catching it.

**First: the payload changed and no notice said so.** The answer route now sends up to 12000 characters of project-page prose *and an inventory of attachment file names, kinds and saved notes*, on every non-embedded draft, whether or not a posting is selected. The attachment inventory is a new **category** of data, and file names are sensitive in a way page bodies are not — `2024-severance-agreement.pdf`, `offer-letter-competitor.pdf`. The clause is unconditional on the Gemini path, because gating it on whether the user has pages would need a count the client does not have until after the first send — too late to disclose anything.

**Second: only half the pair was fixed.** Practice mode got the clause; **live mode did not**, and `postingGroundingNotice` returns the empty string outright when no posting is selected — the ordinary live state. So live mode disclosed *nothing* about a transfer it performs on every drafted answer. Same route, same payload, one surface telling the truth.

**Third: the sentence was true only where it happened to land.** It opened "It also sends…", and on most branches the preceding sentence is not an act of drafting. On one branch the result was outright false: *"…asking to research the company also sends its name, this job's title and the posting text to Google Gemini. **It** also sends your project pages…"* — telling the user their pages leave the browser when they request company research, when they actually go on every answer. A pinned test asserted that exact string as correct. **The clause now names its own subject**, so it is true wherever it is appended, and there is still exactly one description of the payload, imported by all three callers rather than copied.

**Also here:** the sample-answer panel used to contradict itself — bullets reading "From your Payments migration page." above a caption reading "from your prep context **only** — no submitted resume or cover letter was found." And the citation itself failed contrast at **3.90:1** against the 4.5:1 required for 12px text on the panel fill it renders on, in the default light theme; R-228 had already settled that rule and stated that new surfaces use `--text-secondary` (6.67:1). **That half is automated by `app/copilot/answerLineContrast.test.js`, added to step 1**, and it asserts BOTH halves deliberately: the computed ratio against `--bg-soft` — the fill of all three panels that render `AnswerLines` — in both themes, which a token change could silently break, and the token `AnswerLines.js` actually names, which is what R-228's rule is written in terms of. Either assertion alone is weak; a token swap satisfies the ratio check while breaking the rule, and a ratio drift satisfies the token check while breaking the user.

