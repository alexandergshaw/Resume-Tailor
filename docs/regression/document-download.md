### R-239 | area: document-download | parallel-safe: yes | automatable: yes

**Summary:** `triggerBlobDownload` lives in its own module, and no longer leaks an object URL when the click it makes throws.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/document/download.test.js app/components/experience/BulkActionsBar.test.js app/components/experience/AttachmentPanel.download.test.js`.
2. Confirm `lib/document/download.js` exists and holds the function, and that `lib/document/docx.js` re-exports it.
3. Download a tailored résumé from the main tab, a deck from the Experience tab's bulk actions, and an attachment from a project page. All three must still save.

**Expected:** All three suites pass and every download still works.

**The defect was six callers deep and had no test at all.** `URL.revokeObjectURL(url)` and `link.remove()` sat after `link.click()` with nothing guarding them, so a throwing click leaked the object URL and left a stray anchor in the DOM. An object URL keeps its whole Blob alive for as long as the mapping exists, and in a single-page app that never unloads that is the rest of the tab's life — a user retrying a failing 100 MB video download a few times pins hundreds of megabytes. `lib/copilot/sessionLogArchive.js` had already fixed the same idiom in its own copy, with a comment saying why, and the canonical helper was never brought along.

**It had no coverage because every test that touches a caller MOCKS it.** jsdom implements neither `URL.createObjectURL` nor a real download, so `BulkActionsBar.test.js` and `AttachmentPanel.download.test.js` both stub it — correctly, for their own purposes. That left the function itself as the one part of the download path nothing exercised. `lib/document/download.test.js` installs `URL.createObjectURL`/`revokeObjectURL` itself and patches `HTMLAnchorElement.prototype.click` to capture the anchor, since the helper removes it before returning.

**The re-export must be the SAME function object, and a test asserts it.** Six callers still import from `docx.js`. A wrapper, or a leftover copy of the old body, would leave every one of them on the unfixed version while the new tests stayed green — the exact shape of a fix that ships inert.

**The bundle argument that motivated this was wrong, and is recorded so nobody re-derives it.** The stated reason was that the Experience tab pulls JSZip through `docx.js` for a function that has nothing to do with DOCX. It does not follow: `lib/experience/pptxWriter.js` imports JSZip directly and `BulkActionsBar.js` imports pptxWriter, so that tab has shipped JSZip since the deck feature. `BulkActionsBar.js` also needs `sanitizeFileNamePart`, which stays in `docx.js`, and `app/page.js` imports `docx.js` into the root bundle regardless. The move was kept for cohesion and to give the fix a testable home — not for bytes.

