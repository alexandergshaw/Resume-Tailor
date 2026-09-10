### R-197 | area: experience-research | parallel-safe: yes | automatable: yes

**Summary:** A research report cites only sources the search actually visited, and refuses rather than fabricating when it cannot search.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/researchReport.test.js app/api/experience/research/route.test.js`.

**Expected:** All pass, including:

- A citation absent from `groundingMetadata` is demoted to plain text with its claim intact. Fabricated citations are worse than none because they look checkable - this is the lesson `app/api/company-research/route.js` already records in its own comments.
- A grounded source still matches when the metadata carries tracking parameters, a fragment or a trailing slash the model's citation lacks. Comparing raw strings drops REAL citations and teaches the reader to distrust the filter instead of the model.
- A different path on the same host is NOT corroborated - host-only matching would wave through any page on a site the search happened to touch.
- No grounding at all marks the report ungrounded rather than presenting it as researched.
- The embedded engine refuses and creates no page. There is no offline equivalent of a web search; fabricating one from the page's own text and calling it research is the failure this guards.
- The route is owner-scoped: another user's page is a 404.

