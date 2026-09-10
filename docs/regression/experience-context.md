### R-245 | area: experience-context | parallel-safe: yes | automatable: yes

**Summary:** The attachment inventory helpers are public, so a second feature can reuse the honesty rules instead of re-implementing them — and a public caller can no longer manufacture a line for a file that does not exist.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/ app/components/experience/ app/api/experience/ --no-file-parallelism`.
2. Press Ask AI on a project page holding several kinds of attachment. The pinned context must read exactly as it did before: a PDF and an image with no disclaimer, a deck, spreadsheet or zip marked "contents not read", and a video saying whether it was transcribed.

**Expected:** All suites pass and the pinned context is unchanged.

**Why they became public.** The live meeting copilot builds context spanning MANY pages, so it cannot use `buildPageContext`, which budgets and returns one blob for ONE page. It still has to produce inventory lines under identical rules. This module is the single enforcement point for "a line reads ONLY name/kind/notes/transcript — never bytes, `storage_path` or `url`", and a second implementation would be a second place for that to drift. The drift would not look like a bug; it would look like a model confidently quoting a file nobody read.

**The guard, and the precedent that demanded it.** `formatAttachment` now returns `""` for anything that is not a usable attachment — not an object, or no name after trimming. Its own defaults previously turned `null` into `- Untitled file (file)`: an inventory line for a file that does not exist. Inside this module that was unreachable, because `formatAttachments` filtered its list first.

`lib/copilot/groundingNotice.js` records what that reasoning cost last time. `submittedDocsClause` was module-private with exactly one caller that always checked `hasResume || hasCoverLetter`, so the `(false, false)` case was unreachable and a missing branch was harmless — until it became a public `lib/` export, at which point it silently returned a clause claiming a document had been sent when neither existed. **A public export cannot promise that its one careful caller stays its only caller.**

**`formatAttachments` did not already drop empty strings.** Its filter checks object shape (`entry && typeof entry === "object"`), which passes `{}` and `{ name: "   " }` — objects, but not usable attachments. With the guard returning `""` for those, a `.filter(Boolean)` was added before the join so a blank line can never land inside an inventory.

**Nothing a valid attachment produces changed**, and the existing tests are what prove it: they pin the exact line text for every kind, the video wording, the slides/sheet/archive disclaimer, the field caps and the truncation notices.

