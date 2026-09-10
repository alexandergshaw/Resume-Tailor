### R-023 | area: version-diff | parallel-safe: yes | automatable: yes

**Summary:** Change classification is precise. Over-marking makes the highlight useless, so identical content must produce zero marks.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/document/versionDiff.classifyLineChanges.test.js lib/document/versionDiff.markChangedParagraphs.test.js lib/document/versionDiff.markVersionChanges.test.js`.

**Expected:** All pass, including: identical inputs produce an empty result; an empty previous version produces an empty result (a first version must not mark everything); whitespace-only differences count as unchanged; an inserted line is marked without marking its neighbours; and the input render model is never mutated, with unaffected paragraphs returned by the same object reference.

### R-024 | area: version-diff | parallel-safe: yes | automatable: yes

**Summary:** The shared HTML renderer stays byte-identical for documents with no highlights. Every preview, the combined download and the PDF path all flow through it.

**Steps:**
1. Read the run-style assembly in `renderModelToHtml` in `lib/document/docxPreview.js`.

**Expected:** The highlight entry is a conditional that yields an empty string when `mark` is absent, and the style array is filtered for falsy entries before joining. A model with no marks therefore produces exactly the previous output.

### R-025 | area: version-diff | parallel-safe: yes | automatable: yes

**Summary:** Highlighting never fails silently on hand-edited documents. Those render from saved HTML and bypass the model entirely, so an annotated model would never be built.

**Steps:**
1. Read the highlight enablement logic in `app/components/DocumentPreviewDialog.js` and `app/components/preview/HighlightToggle.js`.

**Expected:** When a scope has saved edited HTML, the toggle is disabled and states why. It does not silently appear active while showing no highlights.

