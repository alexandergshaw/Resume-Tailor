### R-191 | area: experience-markdown | parallel-safe: yes | automatable: yes

**Summary:** The page-body markdown parser cannot emit a navigable dangerous URL from any block context, and never silently discards what the user typed.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/markdown.test.js app/components/experience/MarkdownPreview.test.js`.

**Expected:** All tests pass, including:

- Every dangerous scheme tried in EVERY block context - heading, list item, task item, ordered item, blockquote, inside emphasis, nested list - not just a bare paragraph. An implementation that parsed first and sanitized the tree afterwards, visiting only paragraph blocks, passed an earlier draft while leaving live `javascript:` links in all the others.
- URLs are checked STRUCTURALLY by walking the tree for any href-like property, not by searching JSON for the substring `"link"`. A token renamed to `unsafe-link` passed the earlier draft with its href fully intact, because the character before `link` was a hyphen rather than a quote.
- An ALLOWLIST (http, https, mailto, single-leading-slash paths). `file:`, `blob:`, `about:`, `view-source:`, `intent:`, `filesystem:`, `//evil.com` and `/\evil.com` are all rejected. The last one is protocol-relative via the WHATWG backslash equivalence and was found during verification; it had been marked SAME-ORIGIN, which also stripped it of `rel="noopener noreferrer"`.
- Safe URLs in non-canonical form (uppercase scheme, leading whitespace, leading C0 control, a tab inside the scheme) STILL produce links. Under an allowlist those defences are invisible to a dangerous-scheme fixture, so without these positive controls three real defects survived - each of which would silently turn a pasted link into plain text.
- CRLF input parses identically to LF. In JavaScript `.` does not match `\r`, so a regex anchored `(.*)$` fails on every line of a document pasted from Word or Outlook, dropping a fenced code block's entire contents. Windows machine; that paste is the common case.
- Malformed input keeps the user's characters. A mutant that deleted any paragraph containing a bracket or a pipe passed an earlier draft, because "did not throw" and "is an array" are both true of an empty array.
- `MarkdownPreview` shifts body headings down one level so the page title stays the only `h1`, puts `rel="noopener noreferrer"` on external links only, and renders no `<script>` element for `<script>` text while still showing that text.

