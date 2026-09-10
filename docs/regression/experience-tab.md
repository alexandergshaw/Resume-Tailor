### R-193 | area: experience-tab | parallel-safe: no | automatable: no

**Summary:** The whole tab works end to end against a real signed-in account and a real database.

**Steps:**
1. Sign in, open the Professional Experience tab.
2. Create a top-level page; rename it; type a markdown body with a heading, a list, a task item, a fenced code block and a link; switch to Preview.
3. Create a sub-page under it, then a sub-sub-page. Collapse and expand each level.
4. Drag a page onto another to re-parent it; then move a different page using the Move dialog.
5. Upload an image, a PDF and a short video to a page. Type notes on each. Reload the page and confirm all three, and the notes, survive.
6. Delete a page that HAS sub-pages. Read the confirmation text before confirming.
7. Reload the browser while on this tab.

**Expected:** Every operation persists across the reload. The delete confirmation names the exact number of sub-pages that will go with it. Step 7 returns to the Professional Experience tab rather than bouncing to Materials - the same restore-whitelist bug that silently affected Interview Copilot until this feature fixed it.

**Why manual:** the app is auth-gated and no test in the repo drives a real Supabase session or real Storage. A green suite says nothing about whether upload, signed-URL playback, or the delete cascade actually work against the live services.

### R-194 | area: experience-tab | parallel-safe: no | automatable: no

**Summary:** Every operation in the tab can be performed with the keyboard alone.

**Steps:**
1. Unplug or ignore the mouse entirely. Sign in and Tab to the Professional Experience tab.
2. Enter the tree. Using only arrows, Home, End and type-ahead, move to a nested page.
3. From the focused row, Tab to its action buttons and use each one: add a sub-page, rename, move (via the dialog), delete.
4. Tab into the editor, type a body, switch to Preview and back.
5. Tab into the attachments panel, reach the file input, and open the picker with the keyboard.
6. Tab out of the tree entirely and confirm focus leaves rather than cycling inside it.

**Expected:** Every step is possible. Focus is visible at all times. No step requires a drag. Tab is never swallowed.

**Why this case exists:** re-parenting shipped as drag-and-drop only, which is unreachable by keyboard and invisible to assistive technology. It was fixed, and an accessibility sweep then found three MORE actions with hardcoded `tabIndex={-1}` in the same file. Automated tests assert the attribute; only walking it end to end proves the whole path is usable.

