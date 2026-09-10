### R-247 | area: meeting-copilot | parallel-safe: yes | automatable: yes

**Summary:** The meeting copilot's shared contract — what an insight is, how it stays identified across reads, and what may be claimed about where it came from.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/meeting/insightContract.test.js --no-file-parallelism`.

**Expected:** All 27 tests pass.

**It lands before anything else because three consumers normalize through it**: the Gemini-backed insights route, the deterministic no-LLM path, and the client. They cannot drift on these rules, because all three call these functions.

**The load-bearing rule is the attribution downgrade.** An insight claiming `source.kind === "page"` for a `pageId` that was NOT in the context actually assembled for that call is rewritten to `{ kind: "model", pageId: null, pageTitle: null }`, keeping its text. A model handed four pages will cite a fifth it remembers, or invent a plausible id. Letting that through puts "your page X says…" on screen for a page that contributed nothing — and the user can then no longer tell their own notes from the model's invention, which is the entire reason a source is shown. A non-page source may never carry a page id either; that is the same claim through the back door.

**The insight is kept when its attribution is stripped.** A mis-attributed point may still be worth saying; what is not allowed is the false provenance.

**Ids are a deterministic FNV-1a hash of normalized text**, not a uuid, a timestamp or a counter. They have to be stable across separate reads for two reasons: the client accumulates insights over a meeting without showing the same point twice, and `knownInsightIds` goes back to the server so a read can skip what is already on screen. Normalization folds case, surrounding whitespace and one trailing run of punctuation, because a model asked twice rephrases trivially and those are the same point to a human. `Math.random`/`Date.now` are also unavailable in some execution contexts here.

**`changed` on a topic is computed in this module, never asked of the model.** A model asked "did the topic change?" says yes far too often, and the UI uses this to decide whether to interrupt the user mid-meeting with a new topic.

**Everything else is defensive because this runs live**: an unusable text, an unrecognised insight kind, a duplicate within one read, an id the client already has, more insights than the cap, and a model returning `undefined`, `null`, a bare string or an array of junk — none may throw into a running meeting.

**Both vocabularies are asserted exactly, with `toEqual`.** A lower bound cannot detect an ADDED source kind, and adding one is the single direction this contract can quietly go wrong.

### R-248 | area: meeting-copilot | parallel-safe: yes | automatable: partly

**Summary:** The meeting copilot's server, client pipeline and views — transcription, the debounced insight loop, the knowledge-base context, and the no-LLM path.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/meeting/ app/meeting/ app/api/meeting/ --no-file-parallelism`.
2. Confirm `npm run build` lists `ƒ /api/meeting/insights` and `ƒ /api/meeting/save`.
3. With a real meeting running, confirm insights arrive after a pause in speech and not during a burst, and that the nudge control returns one immediately.
4. On the embedded engine, confirm insights still arrive, that none of them is a composed "point" attributed to the model, and that the notice still says audio reaches the speech provider on every engine.

**Expected:** All suites pass; the manual steps read as described.

**Four defects were found by review AFTER every suite was green, and every one lived in a seam between two agents.** Each is now pinned.

**The route analysed the OLDEST speech, permanently.** `slice(0, MAX_TRANSCRIPT_CHARS)` keeps characters 0–8000 — the START of the meeting. The client sends a window of recent turns, which passes 8000 characters after roughly a hundred turns, so from then on every read saw only the opening minutes while the prompt said "TRANSCRIPT SO FAR (most recent last)". An hour-long meeting would have frozen its topic and its insights on the opening small talk while still spending a model call every twenty seconds. It now keeps the END and opens the window on a turn boundary. Nothing caught it because no test ever sent an over-length transcript.

**`topic` was an object on the wire and a string everywhere downstream.** The route returned `normalizeTopic`'s whole `{ text, changed, confidence }`; every consumer treated it as a string. The heading read "Not yet identified" for the entire meeting, and the stored object went back to the server as the literal `"[object Object]"` — pasted into the prompt as the previous topic AND concatenated into the page-ranking query, where "object" became a scoring term. **Two client test files pinned `topic` as a string, the route test pinned it as an object, and all three were green.** That is what a contradiction between two agents looks like from inside either one. The wire now carries `topic` (string), `topicChanged` and `topicConfidence`, and `changed` stays server-computed — a model asked "did the topic change?" says yes far too often.

**After a dropped socket, pressing Start did nothing.** `start()` early-returns when a session ref exists, and nothing cleared that ref when a source errored — so the recovery path the hook's own header documents was inert, silently, until the user found and pressed Stop. There is no reconnect anywhere in the STT layer, so this WAS the recovery path. The ref is now cleared when the session goes terminal, and the accumulated transcript still survives it.

**The embedded engine counted the speaker label as meeting content.** The transcript reaches the local path with `You: ` / `Others: ` prefixes, and the tokenizer matches four-plus-letter words, so `"others"` was the most frequent term in any call-mode meeting. The topic became literally "others, …", and a page whose only overlap with the conversation was that word scored above zero and was surfaced as worth pulling up. Labels are stripped once before term counting; the prompt still shows the model the labelled transcript.

**The attachment inventory was never fetched at all.** `listPages` returns rows from `experience_pages`; attachments live in `experience_attachments`, and the route never queried them. So `page.attachments` was always undefined, no attachment was ever mentioned to the model, and the honesty notice could never fire — an apparatus fully unit-tested against a page shape the data layer never produces. A single `user_id`-scoped `listAttachmentsByPage` query now grafts them on, with a per-page cap and an "N attachments not listed" notice.

**The honesty rule that made all of this worth doing.** `pageContext.js` disclaims "contents not read" for slides, sheets and archives and deliberately NOT for images, PDFs or text — because in the Ask AI flow those bytes really are attached to the same request. A meeting read sends no bytes, so reusing `formatAttachment` (which is required — a second copy is how those rules drift) inherits a silence that is false here. A blanket sentence states that no attachment contents were read. Without it the model is handed `- Q3 board deck.pdf (PDF) - notes: revenue slide` and will say out loud, in a real meeting, "your board deck shows revenue up 12%."

**The two normalization paths are deliberately asymmetric, and unifying them is a bug.** The model path validates a page citation against the pages that fitted the prompt budget; the local path validates against the pages it actually read. An earlier version applied the budget to both, which downgraded the local path's verifiably-true citations to "the model made this up" — the exact opposite of the truth, and it stripped the one thing that makes the no-LLM path worth having. The comment names re-unification as the bug it prevents, because "for symmetry" is exactly how it would come back.

**The embedded path may never claim authorship.** The invariant is `source.kind` is never `"model"` — not, as an earlier draft had it, that it never emits `kind: "point"`. Quoting a user's own bullet verbatim is surfacing, not composing, and labelling it a "Gap" on screen was simply wrong. It can point at what the user wrote and at what the room asked; it cannot compose.

**A near-miss worth recording.** During its own mutation check an agent rewrote a source file with PowerShell `Out-File -Encoding utf8`, which re-encoded it and corrupted every non-ASCII character — including the `[-*•–—]` bullet-detection character class, which would have silently stopped recognising three of four bullet markers. It restored from a byte-exact backup and reported it. Verified independently afterwards: the regex is intact and the tree carries no replacement characters. **Never write a source file in this repo through a shell redirection.**

### R-249 | area: meeting-copilot | parallel-safe: yes | automatable: partly

**Summary:** The meeting copilot is on the Professional Experience view, and a finished meeting becomes an ordinary page in the knowledge base.

**Steps:**
1. From `hello-world`, run `npx vitest run app/meeting/ app/components/experience/ lib/meeting/meetingPage.test.js --no-file-parallelism`.
2. Open the Professional Experience tab. A single "Start a meeting" control is visible even with NO pages yet. Pressing it starts recording — one click, no dialog, no source picker first.
3. Talk. The transcript fills; after a pause, insights appear. Press the nudge control and one arrives immediately.
4. Press Stop. A new page appears in the tree, selected, titled after the topic and the date.
5. Open that page. The topic and the discussion points are at the top; the transcript is below, under a heading saying it is a recording of several people. Each point that came from one of your pages names it.
6. Confirm the new page is an ORDINARY page: it is not badged as generated, and its material is eligible for résumé tailoring and interview answers like any other page.

**Expected:** All suites pass and the manual steps read as described.

**The saved meeting is deliberately NOT marked `generated_kind`.** User instruction, verbatim: *"don't distinguish between my experience and not my experience when using meetings or pages to tailor resumes or respond in interviews. if it's recorded, it's because it's my exp and i want it used."* Both `lib/copilot/projectStories.js` and `lib/experience/tailorSources.js` skip any row with that column set, so marking it would have made the feature useless for its main purpose while looking correct. This reverses the architecture's own recommendation, on the user's explicit direction.

**That moves the honesty burden onto the page's SHAPE, and this is where it lives.** A transcript contains other people's words, and `/api/copilot/answer` instructs the model to speak project-page material as the candidate's own experience. So the body leads with the topic and the user's own discussion points — the part that is genuinely theirs and the part worth mining — and the transcript sits below under a heading that says plainly it is a recording of everyone in the room or on the call. **Nothing is withheld; it is labelled.** The research-page exclusion was deliberately NOT reversed on the same instruction: that filter exists because a research page is model-written web research whose claims a user "cannot defend in an interview and did not write", which protects the user rather than filtering them.

**A `"room"` turn is written into the page with no speaker label at all.** Not "Room:", not "Speaker:". One shared microphone genuinely cannot attribute a turn, and inventing an attribution inside a page that later becomes interview material is exactly the failure this whole feature has been avoiding. A call's two structural streams do get "You" and "Others", through the one shared `meetingSpeakerLabel` — `buildTranscriptText` was exported rather than reimplemented so that rule has one home.

**Stopping is one action and the microphone stops first.** `stop()` is called unconditionally and before anything that can fail; leaving the mic recording because a POST failed is the worst possible coupling, and a test asserts it. There is no confirmation dialog: the result is an ordinary editable page, so a dialog would tax the common correct case to guard a slip that costs nothing.

**A failed save keeps the entire meeting on screen and offers Retry.** There is no server-side record of a meeting until that POST succeeds — losing the transcript because the last step failed would be the most destructive thing this feature could do. State is cleared only once a save has actually returned a page.

**The page tree learns about the new page through a callback, and that is the whole mechanism.** `MeetingPanel` creates the page entirely server-side and cannot update `pages`, because that state lives in the `useExperiencePages` instance `ExperienceTab` owns. This repo has already shipped this exact bug once — `BulkActionsBar` generates research pages and takes `onPagesChanged` for precisely this reason, its own comment saying it "cannot, without holding the page list itself, update `pages` in place". `onMeetingSaved` is **hard-called, never `?.()`**: optional chaining on a callback converts a wiring bug from a loud crash into a silent no-op, and this repo has lost a feature to that before.

**Two anti-inert tests exist because a refactor here has already shipped dead.** `MeetingPanel.test.js` mocks the two views and asserts the panel actually renders them — every one of their own tests passes whether or not anything imports them. `ExperienceTab.meeting.test.js` does the same one level up, and additionally drives `onMeetingSaved` and asserts a second page-list GET is issued, which is the seam above.

**The panel is rendered OUTSIDE the zero-pages early return**, so a brand-new user with nothing in their knowledge base can still record a meeting — and their first page can be one.

### R-250 | area: meeting-copilot | parallel-safe: yes | automatable: partly

**Summary:** A meeting discussion point can be backed by reference links that are checked against pages a search actually visited — and anything that cannot be verified is refused, with the refusal stated on screen.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/ lib/meeting/ app/meeting/ app/api/meeting/ --no-file-parallelism`.
2. In a live meeting, press the find-sources control on a point. **Verified links must actually appear** — the failure this feature shipped with was returning an empty list forever, so an empty result is the thing to be suspicious of.
3. Confirm the card says how many suggestions were refused, rather than silently showing a shorter list.
4. Switch to the embedded engine and press it again: it must refuse with a clear message, not fall back to links from the model's memory.
5. Two points must not share each other's links; a failed lookup must keep what is on screen and offer Retry; and the Retry on each card must be distinguishable by name.

**Expected:** All suites pass and the manual steps read as described.

**The premise: language models invent plausible URLs.** A fabricated link read aloud in a real meeting is far worse than no link, because the user stakes their credibility on it in front of colleagues. The default is refusal; a link earns its place only by corroboration.

## The defect that made this feature ship dead, and why every test passed

`normalizeReferences` compared the MODEL's url against the RAW grounding uris. Google's grounding metadata routinely holds `vertexaisearch.cloud.google.com/grounding-api-redirect/...` links, which are not comparable to a publisher url — so the comparison was false for every link, forever. Every card would have read "N suggestions could not be verified" with no links, and **that is indistinguishable from the model behaving badly**, so nobody would have suspected the code.

**All 100 tests passed because every fixture used the SAME array for both the model's links and the grounding.** Two agents built correct halves against opposite beliefs about one field, and each half's tests described a world in which the other could not exist. `referenceContract.test.js` now carries a fixture policy forbidding a self-grounded case, and keeps a `describe("the publisher world")` block so both readings stay covered.

**This could not be settled empirically here: there is no Gemini API key in this environment, so no grounded feature can be exercised locally.** The fix therefore works under BOTH readings.

**The pipeline is RESOLVE, THEN CORROBORATE**, in this order:
1. Every grounded uri is fetched and replaced by its `finalUrl` (a publisher uri resolves to itself; a redirect resolves to the real page). Unresolvable uris fall back to themselves rather than losing that evidence — `enrichArticles`' policy, taken exactly.
2. The model's links are de-duplicated by normalized key.
3. Each distinct link is corroborated against the RESOLVED set.
4. **The url that was corroborated is the url that ships.** There is no later step that can rewrite it.

That last point closes a second defect: the original code corroborated the model's url and then overwrote it with wherever a second fetch landed, unchecked — so a publisher 301 to a marketing homepage, a rebrand, or an open redirect on a grounded host became a link the user read aloud believing it was verified.

## What corroboration compares, and what it deliberately does not fold

`isGroundedHost` (six existing consumers, unchanged) asks "did the model touch this site". That is the wrong question here: a model that genuinely searched `react.dev` will happily cite `react.dev/learn/a-page-that-never-existed`.

`pageIdentityKey` compares **protocol, host, port, path and query**.

- **The query is part of the identity.** Folding it out let `en.wikipedia.org/w/index.php?title=Totally_Invented_Page` pass when grounding held `?title=Kubernetes`, and `youtube.com/watch?v=FAKE` pass for `?v=REAL`. For a query-addressed site the query IS the page. Only known tracking parameters (`utm_*`, `gclid`, `fbclid`, `ref`) are folded.
- **The path is case-SENSITIVE**, and this was reverted after first being folded. A path is case-sensitive by specification — only the host is not — and most documentation sites 404 on the wrong case. Folding it would mean a model citing `/Learn/X` against a grounded `/learn/X` passes and the user opens a dead link **having been told it was verified**. A real link honestly refused is the smaller harm, and it is the direction every other decision here leans.
- Host case, a leading `www.`, a trailing dot on the host and a doubled slash ARE folded — those genuinely resolve to the same resource.
- Userinfo (`user:pw@host`) is refused outright; scheme and port are compared, so a TLS downgrade or a surprise port cannot pass while the UI's host chip still reads the bare domain.
- Never `startsWith`: `/horizontal-pod-autoscale-walkthrough/` must not pass on the strength of `/horizontal-pod-autoscale/`.

## Refusal, honesty and the messages

Uncorroborated links are **dropped, not demoted** to plain text as `reconcileCitations` does — the user asked for something they could open and quote, so an unverifiable reference has no value as text either.

`dropped` counts **distinct** refused links. It originally incremented before dedup, so one fabricated url cited three ways (trailing slash / `www.` / `?utm=`) reported "3 suggestions could not be verified" — the sentence that exists to be honest about integrity, inflating.

Three distinct messages for three distinct facts: N refused, nothing citable found, and no search happened at all.

## The cache, which took three corrections

1. **The raw insight sentence**, copied from `techwatch/lifecycle`'s global-key reasoning. That does not transfer: that route keys on a technology id, while an insight is a sentence about ONE meeting. It would essentially never hit — defeating the only reason to cache — and it wrote private meeting content into a shared, non-user-scoped key under a comment claiming it was "the same fact for every user".
2. **Sorted significant terms** fixed the hit rate and destroyed word order but not the words. A "4+ characters, not a stopword" filter makes a term long, not generic: an employer name, a codename or a colleague's surname all clear it.
3. **A digest of the terms**, so equivalent questions share a bucket and nothing readable reaches shared storage. It is a 128-bit SHA-256 truncation, NOT `insightId` — that is a 32-bit FNV-1a whose birthday bound is ~77k in a shared week-long namespace, and a collision means one topic's links served for an unrelated one. `insightId` was deliberately not widened: it is a persisted identity clients round-trip as `knownInsightIds`, so widening it would invalidate every id in flight.

**The tokenizer keeps what distinguishes a documentation page.** `/[a-z0-9]{4,}/` dropped every token under four characters, so "Java 17" and "Java 21" shared a bucket — as did Kubernetes 1.29/1.31, React 18/19, HTTP/2 and HTTP/3, and, worst, "does support" and "does **not** support", because "not" is three letters. Someone would have asked about a Java 21 migration and been served the Java 17 docs from a global week-long cache, presented as verified. Versions are kept whole, negations are significant, and the cap takes terms in **document order** — sorting before slicing meant two long insights differing only past the twelfth term collided.

**A failed lookup is never cached.** The producer returns an error object that `cached()` treats as truthy, so one upstream blip poisoned that bucket for a week, globally, and Retry re-served the failure. It now throws, which `cached()` never writes.

**An empty term set skips the cache entirely** rather than hashing `""`, which would collapse every such request onto one shared bucket.

## The client and the card

**A 200 carrying `error` is a failure.** The route deliberately answers 200-with-error (progressive enhancement; a 5xx would read as the whole meeting breaking), and the client only checked `!res.ok` — so with Gemini down the card rendered the confident claim "this point could not be checked against search results" with **no error and no Retry**, and with the failure cached for a week it stayed that way.

**Each card's Retry names its own point.** `Retry finding sources for: <insight text>`. Two cards in an error state previously produced two identical "Retry" controls plus the list-level one — the exact bug that file's own comment forbids repeating.

**The interaction is audible.** `aria-busy` on the control, a named spinner, an accessible name that changes while loading (an `aria-label` overrides the visible text node, so the visible change alone was invisible), and a polite live region for progress and results. A failure is announced only by its `role="alert"`, never twice.

**The request has a deadline** (25s) and a timeout is an ordinary retryable failure. A grounded search plus several page fetches could otherwise sit on "Finding sources…" through the part of the meeting the user wanted it for.

**A stale lookup cannot land in a later meeting.** Insight ids are a deterministic hash of normalized text, so the same point in two meetings has the same id — an in-flight lookup from a previous meeting would otherwise resolve straight into the new one's state. Guarded by the session id, the same idiom the insight loop uses.

## Why links are not attached to every insight automatically

Nothing in this repo can produce a verified url quickly: a grounded search takes tens of seconds by this repo's own repeated measurement, and the insight loop's floor is 20 seconds. Doing it inline would mean either shipping fabricated citations or collapsing the loop to roughly one read per 30 seconds and making the panel visibly lag the room. So it is a per-point action, the same "progressive enhancement over an already-rendered panel" shape `techwatch/lifecycle` uses.

## Open question this raised about EXISTING features

If grounding uris really are redirects, then `lib/techwatch/lifecycleSearch.js` and `lib/feed/llmSearch.js` — which match on host only, presuming publisher hosts — have been silently discarding every result. That would also explain why `company-research` built title-token-overlap matching instead of comparing urls. **Unverified**: it needs one live grounded call, which this environment cannot make. Worth checking against a deployment before trusting either feature's output.

