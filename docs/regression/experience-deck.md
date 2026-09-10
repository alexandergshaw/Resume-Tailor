### R-198 | area: experience-deck | parallel-safe: yes | automatable: yes

**Summary:** A generated deck follows an uploaded template and opens without repair.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/deckOutline.test.js lib/experience/pptxTemplate.test.js lib/experience/pptxWriter.test.js lib/experience/deckTemplateStore.test.js`.

**Expected:** All pass, including:

- The template's `ppt/theme/*`, `ppt/slideMasters/*` and `ppt/slideLayouts/*` come through BYTE-IDENTICAL and the new slides reference them. Regenerating those parts is exactly how a templated deck comes out looking like a default deck, and it passes any test that only counts slides.
- Layouts are chosen by OOXML type, then by name, then by falling back to the first - never by a fixed index, which is why generated decks come out wrong against an unfamiliar template.
- Every slide is declared in `[Content_Types].xml`, referenced from the presentation rels, and listed in `sldIdLst`. An undeclared part makes PowerPoint call the file corrupt.
- An image extension is declared once per extension, and an image whose bytes are missing degrades to a caption-only slide with NO dangling relationship. A dangling rel is the other thing PowerPoint reports as corruption.
- Ampersands and angle brackets in a title are escaped. A project called R&D is ordinary and an unescaped ampersand makes the file unopenable.
- Prose before the first heading survives, and a video becomes a NAMED placeholder rather than being silently omitted - otherwise the user presents a deck missing something they attached and believed was included.

