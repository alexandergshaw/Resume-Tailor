### R-192 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** An uploaded file's storage key can never escape its owner's prefix, and a rejected upload explains itself.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/attachments.test.js app/components/experience/AttachmentPanel.test.js`.

**Expected:** All tests pass. The safety invariant runs 30 hostile filenames and checks each against BOTH the literal segment and `segment.normalize("NFKC")` - the normalized form is the general statement, because a key containing no separator today is worthless if one downstream normalization pass would create one.

Specifics that were each a real defect:

- The sanitize pipeline order is fixed: normalize and percent-decode to a FIXED POINT together, then strip forbidden characters, collapse separators, strip `..` repeatedly, trim leading dots and trailing dots/spaces, rename Windows reserved device names, and truncate LAST. Normalizing once at the start still let `%EF%BC%8F` through as a fullwidth solidus, because nothing re-normalized what the decode produced.
- The attachment's uuid is IN the key. Seven inputs - four of them fixtures in an earlier draft - collapsed onto the single key `file`, so any junk-named upload could overwrite a real note.
- Caps are INCLUSIVE (exactly 100 MB of video is accepted) and the reason names both the limit and the filename on every path.
- Every delete button's accessible name includes its own file name; N attachments produce N distinct names.
- A failed notes save shows a visible error with Retry and does NOT roll back the typed text. The notes field is the only thing a model ever sees about a video, since video bytes are never sent as context.

### R-200 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** Deleting an attachment is undoable for five seconds, and leaving the page resolves the pending deletion rather than losing track of it.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/experience/AttachmentPanel.test.js`.

**Expected:** All pass, including: the DELETE has NOT fired before the window elapses (asserted by call count - a delete that fires immediately and one that fires after five seconds are both "called"); Undo restores the row to its ORIGINAL position, anchored by its neighbour's id rather than an index, so cascading undos land correctly; several deletions can be pending independently; and a page switch or unmount FLUSHES pending deletions rather than cancelling them, so the user's view and the database never diverge.

### R-214 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** A project page accepts PowerPoint and Excel files, tells the two apart on screen, and never implies the AI opened either one.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/attachments.test.js lib/experience/pageContext.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.

**Expected:** All pass. `classifyAttachment` answers `slides` for PowerPoint/Keynote/OpenDocument presentations and `sheet` for Excel/Numbers/OpenDocument spreadsheets, by mime type or by extension; the panel labels each distinctly; the pinned AI context names the kind and states once that no file's contents were read.

Load-bearing specifics, each of which was a real defect or one an audit proved could ship undetected:

- **The mime fixtures carry a `.bin` name on purpose.** An earlier draft named them `deck.pptx`, `book.xlsx` and so on - and because `kindOf` falls back to the extension, deleting the ENTIRE office mime table left the spreadsheet case green. Twelve of the fourteen mime strings the block exists to pin were unfalsifiable. A fixture whose two candidate paths reach the same answer proves neither of them ran.
- **The macro-enabled mime keys are stored lower-case.** `kindFromMime` lowercases its input, so `application/vnd.ms-excel.sheet.macroEnabled.12` written in the casing Windows actually sends can never match its own table entry. The fixtures deliberately use the real casing.
- **A `.csv` that Windows reports as `application/vnd.ms-excel` stays `text`.** Excel registers itself as the csv handler on most Windows machines, so this is the common case, not an edge one. It is the ONLY mime treated as ambiguous - `notes.txt` served as `application/pdf` is still a PDF, and `deck.txt` served as `application/vnd.ms-powerpoint` is still a deck. A wholesale precedence flip is the failure mode, and those two are the positive controls that catch it.
- **A bare `.key` file is not a Keynote deck.** `server.key` is a PEM private key far more often. Only the unambiguous `application/vnd.apple.keynote` mime classifies one.
- **The panel asks the SHARED classifier.** A private copy of the type table inside `AttachmentPanel.js` that happened to agree would produce identical markup and identical requests, so nothing else in the file could tell them apart. The test spies on the real module and asserts it was consulted.
- **The kind is text, not an icon.** Each kind renders its own decorative icon, but `Slides`/`Spreadsheet` is written out beside the file size - the icons are asserted distinct from each other AND from the generic file icon, and asserted `aria-hidden`.
- **Neither kind is previewed inline**, because the GET route mints no signed URL for them and an `<img>` would render broken. An image alongside them is the positive control, or "previews nothing at all" passes.
- **Only the deck and spreadsheet lines say "contents not read", and it must stay that way.** A draft of this change put the disclaimer on the `Attachments:` header instead, covering every kind, on the premise that a page attachment's bytes are never forwarded to the model. That premise is false: pressing Ask AI in `ExperienceTab.js` pins the context and then downloads every attachment whose kind is in `DOWNLOADABLE_ATTACHMENT_KINDS` (image, pdf, text) and hands the bytes to `addChatAttachments`, which turns them into inline data and extracted text on the same turn. The header version therefore told the model it had not read three files it was being handed in the same request - false in the more dangerous direction, and a test had already locked it in. A deck or a spreadsheet is downloaded by nothing, which is exactly why those two need the sentence. The test asserts both halves: `not read` present on slides/sheet, absent on image/pdf/text, absent from the header, and absent entirely from a page with no attachments.
- **The extension and mime tables are looked up with `hasOwnProperty`, not `table[key]`.** A plain-object lookup walks the prototype chain, so `notes.constructor` resolved to a FUNCTION - truthy, not the string `"other"` - and sailed through the unsupported-type check into an accepted upload with a function as its kind. `payload.__proto__` did the same with an object. Both survive `extensionOf`'s lower-casing, which is what makes them reachable at all. Pre-existing, found while verifying this change, and fixed at all three lookup sites.

**Known gap, deliberately not closed here:** `lib/experience/deckOutline.js` returns no slides for these kinds, so an attached `.pptx` does not appear in a deck generated FROM that page. That matches how `pdf` and `text` already behave; changing it needs a new slide kind in `deckOutline.js` and a matching branch in both of `pptxWriter.js`'s switches.

### R-215 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** A file whose name contains characters Supabase Storage refuses can still be attached, and an upload that does fail says which file and why.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/attachments.test.js lib/supabase/experienceAttachments.test.js app/api/experience/attachments/route.upload.test.js`.

**Expected:** All pass.

**The report that produced this case:** uploading `Centralized PR Standards [Autosaved] [Autosaved].pptx` to a project page answered `Could not save this attachment.` and nothing else. Two independent defects had to line up for that:

- **`storagePathFor` built a key storage refuses.** storage-api's `isValidKey` accepts only `` /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/ ``, and that `\w` carries no `u` flag, so it is ASCII `[A-Za-z0-9_]` and every non-ASCII character is outside the set too. Square brackets are outside it. `@supabase/storage-js` does no client-side key validation, so the object was refused server-side. PowerPoint appends `[Autosaved]` to its own autosave copies, and `[Compatibility Mode]` likewise, so this is an ordinary filename rather than an exotic one.
- **The route reported every cause with one string.** The genericization is half-right and stays: a failed INSERT can carry Postgres's `duplicate key value violates unique constraint`, which tells a caller that someone else's row holds that id. But it was applied to the storage-upload failure too, which is about the caller's own file. Two different causes - a rejected key and a bucket restriction - were indistinguishable to the user and to anyone diagnosing it.

Load-bearing specifics, several of which are here because a mutation run proved the first draft of these tests could not catch them:

- **The charset assertion runs over all 30 hostile names**, added INTO the existing R-192 invariant loop rather than beside it. A key that satisfies every traversal rule and still cannot be written is worth nothing.
- **Characters are escaped, never deleted.** Asserting `contains "Autosaved"` and `no brackets` passes just as well against a sanitizer that silently eats characters, so the test names the replacement (`_Autosaved_`) instead. Deletion is visibly wrong only once nothing safe is left: a wholly non-ASCII stem would collapse to `.pptx`, whose leading dot the trim stage then eats, leaving a key with no extension.
- **Two replacement rules, deliberately.** Disallowed ASCII becomes `_`, so the common case reads naturally. Non-ASCII becomes `u<hex code point>`, which keeps different scripts distinct. The older "does not merge names that differ only by case or by script" case cannot enforce that on its own: it contrasts a two-character name with a three-character one, so collapsing everything to `_` still yields different keys and survives it. A same-length pair is what forces the code points to be carried.
- **Escaping iterates by code point.** By UTF-16 unit an emoji becomes its two surrogate halves - still pure ASCII, still passing every charset assertion - so the test names the expected `u1f389`.
- **Truncation stays last.** A hex escape turns one code point into five, so a name that measured short before the escape can overflow `MAX_SEGMENT` only after it.
- **An ordinary name is returned byte-for-byte.** `notes.md`, `Q3 Review (final) v2.pptx`, `R&D deck.pptx`, `budget+forecast,v2.xlsx` keep every character - the positive control that stops "escape everything" from passing.
- **Only the upload stage is reported verbatim.** `createAttachment` returns `stage: "upload" | "insert" | "unknown"`; the route answers 400 naming the file and carrying the storage reason for `"upload"`, and keeps the generic 500 for everything else, including an error carrying no stage at all.
- **`lib/supabase/experienceAttachments.test.js` exists because the route test cannot cover this.** That test mocks this module and supplies a `stage` of its own invention, so it pins what the route DOES with a stage and nothing about whether the store produces the right one. Deleting the `stage: "upload"` tag, or mislabelling the INSERT failure as an upload - which would hand Postgres's duplicate-key text straight to the client - left the entire route suite green.

**Known gap:** `lib/supabase/materials.js`'s `safeMaterialName` replaces only path separators, so the supplementary-materials locker still refuses the same filenames. It cannot take this same fix as-is: its storage key has no id in it and doubles as the displayed file name, and it uploads with `upsert: true`, so any non-injective escape silently overwrites one file with another and any escape at all changes what the user sees in their list.

### R-238 | area: experience-attachments | parallel-safe: yes | automatable: partly

**Summary:** Every attachment on a project page can be downloaded again, under the name it was uploaded with, from a control that never leaves the tab order.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/experience/AttachmentPanel.download.test.js lib/supabase/experienceAttachments.download.test.js app/components/experience/AttachmentPanel.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.
2. Open a project page in the Professional Experience tab that has attachments of several kinds — at least one PDF or Office file (no inline preview) and one image or video (inline preview). Confirm EVERY card has a download control, not just the previewable ones.
3. Download a `.pptx` or `.xlsx`. Confirm the saved file opens, and that its name is the name it was uploaded with — not `<uuid>-<sanitized>`, which is what it is stored as.
4. Upload a file whose name is not plain ASCII and contains parentheses — `café report (v2).pdf` is the case this was built against — then download it. The saved name must be byte-identical to what was uploaded.
5. Tab to a download control with the keyboard and activate it with Enter. Confirm focus is still on that control afterwards and the tab order has not jumped.
6. With devtools' network tab open, download a large video and press the same control several more times while it is running. Exactly one request must be issued. The control must stay focusable throughout and show a spinner.
7. Fail a download deliberately (devtools offline, or delete the object in Supabase Storage and reload). Confirm an error naming that file appears on that card with a Retry, the row is not removed, and Retry succeeds once the cause is removed.
8. Fail a download on page A, then switch to page B and back. The error must be gone, not waiting there.

**Expected:** All four suites pass and the manual steps read as described.

**Until this shipped, an attachment was write-only for every kind except image and video.** Those two get a short-lived signed URL purely so the card can preview them inline; `app/api/experience/attachments/route.js`'s GET mints one for nothing else, so a PDF, a deck, a spreadsheet or a text file had no route back to the user's disk at all.

**There is deliberately no API route for this, and that is the load-bearing design decision.** `lib/supabase/server.js` builds its client from the anon key plus the caller's cookies — not a service-role key — so a route handler's storage read would run under exactly the same RLS identity as the browser's and buy no privileged access. The same feature already reads these same bytes client-side at `ExperienceTab.js`'s Ask-AI path, the `resumes` bucket owner-scopes anything under `${uid}/...` via `auth.uid()::text = (storage.foldername(name))[1]`, and `route.js` already spreads the whole row (`{ ...row, kind, url }`) so `storage_path` is on the wire today. Adding a route would have meant serving user-uploaded bytes from this app's own origin — a new, permanent XSS obligation (`Content-Disposition` plus `nosniff` plus a CSP sandbox) taken on for no security gain.

**`createSignedUrl(path, ttl, { download: name })` must never be used to name a download.** It is the obvious shortcut and it is broken: `@supabase/storage-js` builds the query with `URLSearchParams`, which percent-encodes, and then wraps the entire URL in `encodeURI`, which escapes the `%` signs a second time. Measured — `café report (v2).pdf` arrives as `caf%25C3%25A9+report+%2528v2%2529.pdf`. Passing the name to the anchor's `download` property instead has no encoding layer at all, which is what step 4 checks and what `"round-trips a name that is not plain ASCII"` pins.

**The re-entry guard is a `useRef`, and a `useState` guard cannot work.** A state update is not visible to a handler already queued in the same tick, so a real double-tap fires two reads — two files in the downloads folder and two `triggerBlobDownload` calls racing over one name. `scheduleDelete` in the same file guards identically. **The test for this only works if both clicks land inside a SINGLE `act()`**: two separate `await act()` calls let React flush the first click's state before the second arrives, so a broken state-based guard passes. That distinction is the whole test.

**Nothing is disabled while a download runs.** `aria-busy` plus a spinner carries the in-flight state instead. A control that leaves the tab order at the moment it is used throws keyboard focus to the top of the document, which this repo has shipped before.

**Success is announced exactly once, and a second "Downloading…" announcement would silently break it.** `announcedText` appends its invisible toggle on ODD sequence numbers, so a path that bumps the counter twice per cycle returns to the starting parity, renders a byte-identical string, and React's reconciler leaves the text node untouched — no DOM mutation, so no live region fires. The failure mode is nasty: it is silent from the SECOND download of any file onward, which is the ordinary repeat case. Note this is the reconciler, not a `setState` bailout — `bumpAnnouncement` returns a fresh object every call, so the `Object.is` bailout can never fire here.

**Three defects lived in the seam between the new handler and machinery 300 lines away, and every one of them shipped green.** They were found by a review pass over the whole diff, not by any test:
- `downloadErrors` was the one per-id map the `pageId`-change effect never cleared, even though the comment above that effect is a written specification of exactly why it must be. A failed download on page A was still sitting there on return, and — since ids are unique per attachment but scoped to nothing the panel enforces — could render against a DIFFERENT page's attachment sharing that id, naming the wrong file, with a Retry wired to the other one.
- The handler had a `finally` and no `catch`, alone among the file's six async handlers. `createClient()` throws when the public env vars are missing and `triggerBlobDownload` touches `URL.createObjectURL` and `link.click()`; either throw merely rejected an `onClick`'s promise, leaving the user with no file, no alert and nothing said.
- The post-`await` writes ignored `pageIdRef`, which exists for precisely this and which `uploadFile` already uses. A download is the slowest async operation in the panel — seconds for a 100 MB video — so it is the MOST likely to resolve after a page switch, announcing into a page it has nothing to do with. Note the page-switch clear does not cover this: the write lands after that effect's deferred clear has already run.

**The gate was proven by mutation, not by being green.** Ten mutants were generated against the shipped source — removing the page-switch clear, replacing each `pageIdRef` guard with a constant, deleting the `catch`, pinning the error `seq` to a constant, swapping the ref guard for state, saving under `storage_path` instead of `name`, overriding the alert's `role`, dropping `aria-busy`, and collapsing every control's accessible name to a bare "Download". **All ten were killed by their own named test**, and the source was verified byte-identical afterwards. Two of those tests did not exist before the mutation pass: the throw branch was entirely ungated, and no test failed the same file twice to prove the error `seq` was live.

**One vacuous test was caught before hand-off and is worth remembering.** "Renders each one as a real, enabled control" iterated the download buttons and asserted each was a `BUTTON`, not disabled, and in the tab order — and passed against a panel with no download control at all, because a `for` over an empty list satisfies every assertion inside it. It now asserts the count first.

**`vi.restoreAllMocks()` does not clear a `vi.fn()` from a `vi.mock` factory.** It restores only `vi.spyOn` registrations, so `triggerBlobDownload`'s call history survived every test in the file and later `not.toHaveBeenCalled()` assertions failed against a perfectly correct component. `BulkActionsBar.test.js` already knew this and resets the same helper. The reset must be `mockReset`, not `mockClear` — two tests install a throwing implementation, and `mockClear` leaves it in place to blow up everything after them.

**`AttachmentPanel.js` finished at 947 lines against a 950 tripwire.** The next thing added to it must extract the per-card render body into its own component first. An extraction there needs a wiring test that mounts the PANEL against a mocked card and asserts it rendered once per attachment — a refactor in this repo has already shipped with the new component fully tested and never imported.

**Recorded and deliberately not done:** `triggerBlobDownload` lives in `lib/document/docx.js`, which imports JSZip at module scope, so the Experience tab now ships a zip library it never calls; that helper also revokes its object URL outside a `finally`, so a throwing `click()` leaks it; `ExperienceTab.js` still hand-rolls the same storage read that `downloadAttachmentBlob` now owns; and all three Retry buttons in this panel unmount themselves on click, dropping focus to `<body>`. Each is a separate chunk.
### R-240 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** Ask AI reads an attachment's bytes through the shared store function instead of its own copy of it.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/experience/ExperienceTab.test.js`.
2. Open a project page with a text, image, PDF and video attachment and use Ask AI. The first three must reach the chat as real files; the video must not.

**Expected:** All 22 tests pass and the manual step reads as described.

**`ExperienceTab.js` hand-rolled the read that `downloadAttachmentBlob` owns**, with a second `"resumes"` literal and a second piece of error handling. Both copies were correct, which is exactly why it survived — two correct copies drift apart on the next change to either.

**The test wraps the REAL store function in a spy rather than stubbing it.** The behaviour assertions ("the bytes reach the chat", "the video's bytes are never downloaded") pass just as happily against an inline copy — they did, for as long as one existed — so on their own they could never have caught the helper being added, being correct, and never being wired up. The spy answers the one question they cannot: was the shared module asked? Because the wrapper still runs the real implementation against the mocked Supabase client, the end-to-end path is still tested at the same time.

**Video exclusion is unchanged and still happens BEFORE any read is attempted.** The filter on `DOWNLOADABLE_ATTACHMENT_KINDS` and `storage_path` is byte-for-byte what it was. A shared helper must not become a way for video bytes to reach the model.
### R-241 | area: experience-attachments | parallel-safe: yes | automatable: partly

**Summary:** One attachment's card is its own component, and none of the panel's three Retry buttons throws keyboard focus to the top of the document any more.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/experience/AttachmentCard.wiring.test.js app/components/experience/AttachmentPanel.retryFocus.test.js app/components/experience/AttachmentPanel.test.js app/components/experience/AttachmentPanel.download.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.
2. On a project page with several attachments, confirm nothing about a card looks or reads differently from before: same file name, kind and size line, same notes field, same Download and Delete controls, same inline preview for image and video.
3. Make a notes save fail (devtools offline), then Tab to the Retry and press Enter. Focus must land in that attachment's notes field. Press Enter on Retry again while still offline — the alert and its Retry must survive being focused, and must not vanish as you tab onto them.
4. Make a download fail, Retry with the keyboard, and confirm focus returns to that row's own Download button — the row that failed, not the first row.
5. Make a delete fail, wait out the five-second undo window, then Retry. If it fails again, focus stays on that row's Delete button. If it succeeds, focus moves to the NEXT row's Delete button — or the previous row's if you deleted the last one, or the upload control if it was the only attachment.
6. Start a delete Retry on a slow connection, then click into a different attachment's notes field and type. When the delete resolves, the caret must stay where you put it.
7. Start a delete Retry, then switch to a different project page before it resolves. Nothing on the new page may be removed, and focus must not jump.

**Expected:** All five suites pass and the manual steps read as described.

**The extraction had to come first, and its test is about the CALLER.** `AttachmentPanel.js` was 947 lines against a 1000-line ceiling and the focus fix could not fit. `AttachmentCard.js` took the per-card render body out (947 → 802). `AttachmentCard.wiring.test.js` therefore asserts the shape of the PANEL — that it renders one card per attachment, each with its own row's data, and that the card's markup is genuinely gone rather than duplicated — because a refactor in this repo has already shipped with three new components sitting beside their caller, fully tested and never imported. Piece-level tests structurally cannot catch that: they import the piece directly.

**Its line-count assertion is a CEILING, not a shrink-proof, and that distinction was learned the hard way.** It was first written as "under 880" against the freshly-extracted 802-line file. The focus fix then legitimately added ~80 lines, and the gate started failing for a correct change — at which point the temptation is to shave comments to hit a number, which is precisely how a useful assertion gets deleted by someone who reasonably concludes it is noise. The real proof that the markup moved is the assertion that no card is built inline. The number exists only to stop the file drifting back toward 1000 unnoticed.

**All three Retry buttons unmounted themselves on click.** Each handler cleared its own per-id error entry as its first synchronous act, which removed the Alert — and the Retry inside it, which is the element the user is standing on. Focus fell to `<body>`. Inherited by all three from the notes and delete alerts; gated now because the panel has since grown an explicit rule that a control must never leave the tab order at the moment it is used.

**The notes Retry is the one with a second, invisible trigger, and the fix is in `saveNotes`, not in the focus code.** Once a Retry puts the caret into the notes field, the next Retry is pressed from inside that field — and a browser moves focus to the button on MOUSEDOWN, firing `focusout`, which runs the very same `saveNotes` that clears the error. The alert and the button being pressed unmount before mouseup, the click never lands, and focus falls to `<body>`: the exact defect this work removes, reappearing on every retry after the first. Tabbing to the Retry does the same. So a notes error is now cleared only when its PATCH actually SUCCEEDS. `removeAttachment` and `downloadAttachment` still clear up front, and that stays correct for them — a React `onClick` fires after mouseup, so their click has already landed by the time the alert goes.

**The delete Retry is the only one whose focus target is decided after an `await`, and that makes it the only one that can steal focus.** A success removes the very row the click happened on, so the target cannot be chosen at click time. The consequence is that it can land seconds later, by which point the user may be typing somewhere else — and since leaving a notes field saves it, an unconditional `focus()` would also fire a PATCH of a half-typed note. Those requests therefore carry `ifLost`, and the effect honours them only when focus is genuinely unattended (`document.activeElement` is null, `<body>`, or disconnected).

**Gating EVERY focus move that way is wrong, and was caught by a test rather than by argument.** Once the notes alert survives a retry, the Retry button is still connected and focused when the effect runs, so a blanket "only if focus was lost" check drops the request and focus never reaches the notes field. The remediation agent tried the literal instruction, watched `puts focus on that attachment's notes field` go red, and carried the gate on the request instead. Requests set synchronously inside their own click stay unconditional — moving focus is what the user just asked for.

**A focus request is consumed exactly once.** Left pending when its target does not exist, it re-fires on every later render — and `onNotesInput` calls `setAttachments` on every keystroke, so the last target would be re-grabbed once per character and typing into a notes field would become impossible. It is now always cleared, with a terminal fallback to the upload input so an unresolvable request cannot leave focus on `<body>`.

**`pendingFocus`, the three ref maps and `removeAttachment`'s post-await writes all joined rules the panel already had.** The `pageId` effect wipes them, and `removeAttachment` now captures the pageId it started under, exactly as `uploadFile` and `downloadAttachment` do. Without those, a Retry resolving after a page switch removed a row from the new page's list, announced the old page's file name into its live region, and planted a focus request that could land on an unrelated attachment sharing the same id.

**Known and deliberately NOT fixed here:** switching pages leaves the previous page's last status announcement sitting in the live region — `statusAnnouncement` is set legitimately by `scheduleDelete` at click time and nothing resets it on a page change. Same family as the per-id maps, pre-existing, and out of this change's scope; the page-switch test says so in a comment rather than asserting it. Recorded as its own follow-up.

**Four of the review's findings were real and one was not, and the difference was established by running it.** The claim that swapping `onDelete={scheduleDelete}` with `onRetryDelete={removeAttachment}` survives the suite is false: it fails 8 tests in `AttachmentPanel.test.js`, which drives the undo window through the real Delete button. Run an adversarial finding before adopting it, in either direction.

**`AttachmentPanel.js` finished at 898 against a 900-line ceiling.** Two lines of headroom is not headroom. The next change to this file extracts something first — the cheapest candidate is the six-line "delete this key if present" state reducer, which appears five times and would free roughly 18 lines.
