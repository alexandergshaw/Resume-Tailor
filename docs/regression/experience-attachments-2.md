### R-243 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** A .zip can be attached to a project page, and adding it did not reclassify every Office document as an archive.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/experience/attachments.test.js lib/experience/pageContext.test.js app/components/experience/AttachmentPanel.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.
2. On a project page, upload a `.zip`. It is accepted, the card reads **Archive** with its own icon, and the upload box's own sentence says zip archives are allowed before you pick a file.
3. Upload a `.docx`, a `.pptx` and an `.xlsx` **from Windows**. All three must still read Text / Slides / Spreadsheet — NOT Archive.
4. Download the zip back and confirm it opens.
5. Press Ask AI on a page holding a zip. The pinned context must list the zip and say its contents were not read, and the zip's bytes must not be sent.

**Expected:** All four suites pass and the manual steps read as described.

**The whole difficulty is that every OOXML Office file IS a zip.** `.docx`, `.pptx` and `.xlsx` are zip containers, and Windows and several file managers report them with a generic `application/zip` or `application/x-zip-compressed` mime. This module's standing rule is mime-beats-extension, so mapping the zip mimes straight to a new `archive` kind silently reclassifies every Word, PowerPoint and Excel document uploaded from a Windows machine: they stop being read for the AI, and they start carrying a "contents not read" line that is false.

**The fix reuses the one precedent already in the file rather than inventing a second mechanism.** `AMBIGUOUS_SHEET_MIME` existed because Windows reports a plain `.csv` as `application/vnd.ms-excel` whenever Excel owns the file type. That single constant became `AMBIGUOUS_MIMES`, a deliberately short set: a mime in it is treated as a hint rather than as authoritative, and the EXTENSION wins whenever the extension has its own known mapping. `kindOf`'s structure is otherwise unchanged, so an UNambiguous mime still beats the extension — a file named `.zip` whose mime says `application/pdf` is still a pdf, and a test asserts it.

**Both halves are mutation-proven, not merely green.** Removing the two zip mimes from `AMBIGUOUS_MIMES` is the most likely careless edit here ("why is a zip mime in a list called ambiguous?"), and it is killed by "still calls a .docx a text file when the browser reports it as a zip" and "still calls a .pptx slides and an .xlsx a sheet when reported as a zip". Removing `zip: "archive"` from the extension table is killed by "accepts a .zip the browser reports with no mime type at all".

**An archive is inventory-only, and `pageContext.js` says so per line.** Nothing in this repo unzips anything and a zip's bytes are never handed to the model, so `archive` joins `slides` and `sheet` on the "contents not read" branch. It must NOT join `image`/`pdf`/`text`, whose bytes really are downloaded and attached to the same Ask AI request — disclaiming those would tell the model the opposite of what just happened. A test asserts a pdf sitting beside a zip is still not disclaimed, so a blanket disclaimer cannot pass.

**`archive` is deliberately absent from `DOWNLOADABLE_ATTACHMENT_KINDS`** in `ExperienceTab.js`, so a zip's bytes never reach the chat route. That set is `["text","image","pdf"]` and adding an opaque binary to it would hand the model bytes it cannot read.

**`.rar` and `.7z` are still refused, and that is asserted.** The request was zips. A pre-existing positive control named "does not widen the door for anything else" used `archive.zip` as its example of something unsupported; that example was MOVED to `.rar` rather than deleted, so the control still proves the door did not swing open while no longer contradicting a shipped feature. Deleting it outright would have been the easy way to a green suite and would have removed the only guard on that intent.

**Size: an archive uses the same 25 MB cap as everything that is not video.** Zips of real project artifacts will hit that ceiling sooner than most kinds; raising it is a deliberate product decision and has not been made.
### R-244 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** The attachments live region stops describing the page you just left, and the seven-times-repeated state reducer behind it is now one tested helper.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/experience/ --no-file-parallelism`.
2. On a project page with attachments, download or delete one, then click to a different project page. The status line must be empty — it must not still read `Downloaded "<the other page's file>"`.
3. Download something on the new page. It must still be announced, and downloading the same file twice in a row must still announce twice.

**Expected:** All 17 suites pass and the manual steps read as described.

**The live region was the last piece of per-page state nobody reset.** It is written by `scheduleDelete` ("Removed …"), `undoDelete` ("Restored …"), `uploadFile` ("Added …") and `downloadAttachment` ("Downloaded …"), and the `pageId` effect that already wipes `notesErrors`, `deleteErrors`, `downloadErrors`, `pendingDeletes` and `pendingFocus` simply never included it. The long comment above that effect is the file's own statement of why this class of state must be cleared; the region now joins it.

**The sequence number is preserved rather than reset, and the reason is narrower than it looks.** `announcedText` appends an invisible character on ODD sequence numbers, which is what makes two consecutive identical messages produce a real DOM mutation. Resetting the counter to 0 could in principle let the first announcement on the new page render byte-identical to what the region last held on the old page — and if those two updates were ever coalesced into one render, the reconciler would leave the text node untouched and the announcement would be silent.

**That coalescing is not reachable today**, and the code says so rather than implying a fix for a live bug: the clear runs in a deferred `setTimeout(0)` on the page change, and the next announcement needs a fresh user action, so the empty string always renders in between. Preserving the counter is defensive, costs nothing, and stays correct if either of those two facts ever changes. It is deliberately not covered by a test, because a test for it would have to fake a coalescing the public surface cannot produce.

**Seven copies of the same six-line reducer became one helper, and that refactor had a real risk of its own.** The body

```js
if (!(id in prev)) return prev;
const next = { ...prev }; delete next[id]; return next;
```

appeared seven times: in `clearPendingDelete`, and in the clears for notes errors, delete errors (twice), download errors (twice) and the in-flight download map. Collapsing them freed 23 lines, which is what made room for the fix — the file was at 898 against a 900-line ceiling enforced by `AttachmentCard.wiring.test.js`.

**The dangerous half is the bail-out, and a mutation run proved it was unpinned.** Returning the SAME object reference when the key is absent is what lets React skip the update entirely; most of these calls are clearing an entry that is not there, since every fresh attempt at a notes save, a delete or a download clears an error that usually does not exist. Deleting that one line — so the helper always spreads — left the ENTIRE experience suite green, because nothing observable changes; only the number of renders does. `withoutKey` is therefore exported (the precedent is `UNDO_WINDOW_MS`, exported for the same reason) and `AttachmentPanel.withoutKey.test.js` asserts reference identity with `toBe`, not `toEqual` — `toEqual` would pass against a copy, which is the exact mutation the test exists to catch.

**Recorded, not asserted:** `withoutKey` uses `key in map`, which walks the prototype chain, so `"constructor"` would take the copying branch. `lib/experience/attachments.js` guards that hazard with an `ownLookup` helper and needs to — its keys come from user-supplied filenames and mime types. These keys do not: all seven call sites pass an attachment id, and those are uuids. Asserting it would mean requiring a behaviour change for an unreachable input, so it is written down in the test file instead, for whoever widens what these maps are keyed by.

