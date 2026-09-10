### R-199 | area: experience-askai | parallel-safe: yes | automatable: yes

**Summary:** Ask AI pins the whole page, spends its context budget deliberately, and is honest about what the model cannot see.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/pageContext.test.js app/components/experience/PageEditor.test.js app/components/experience/ExperienceTab.test.js`.

**Expected:** All pass, including:

- The title, breadcrumb and attachment inventory survive even when a long body must be cut, and the truncation is STATED. The chat route truncates silently, and a model answering from a body cut mid-sentence gives a confident answer about half a project with nobody aware.
- Attachment bytes, storage paths and signed URLs never enter the pinned context.
- A video contributes its notes and any cached transcript, and says so when it has NEITHER - the bytes are not forwarded to the model, so a bare filename would read as though the model had watched it.

