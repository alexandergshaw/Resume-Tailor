### R-304 | area: copilot-interview-type | parallel-safe: yes | automatable: yes

**Summary:** Clearing `react-hooks/exhaustive-deps` warnings in `app/copilot/useTypeAnnouncements.js` and `app/copilot/CopilotClient.js` required adding stable extra identities (`answerCacheRef`, `draftGenRef`, `setStaleTypeChangeAt` to one `useCallback`; `resetTypeAnnouncements` to another) to two dependency arrays that a stale-closure regression test used to pin by EXACT source text -- so `CopilotClient.interviewTypeWiring.test.js`'s guard was widened from a verbatim regex match to a per-name membership check, or the lint fix itself would have failed this test as though it were the regression it exists to catch.

**Steps:**
1. From `hello-world`, run `npx eslint app/copilot/useTypeAnnouncements.js app/copilot/CopilotClient.js`.
2. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/CopilotClient.interviewTypeWiring.test.js`.
3. Read `dependencyNames()` (`CopilotClient.interviewTypeWiring.test.js`, near line 136) and its call site (near line 780), alongside the two widened arrays it checks: `useTypeAnnouncements.js`'s `onInterviewTypeChanged` callback and `CopilotClient.js`'s mode-switch callback (`:421-424`).

**Expected:** `eslint` reports zero warnings on both source files. All vitest cases pass. The test still FAILS if `mode`, `redraftCurrentAnswer`, `cueText` or `briefText` is missing from either array -- a real stale-closure regression -- because `dependencyNames()` parses only the array's own trailing bracketed group, never the handler's BODY, where `cueText`/`briefText` are also read for the ambient stamp; a handler-wide substring match would stay green with the dependency array itself emptied, which is the exact loophole this parsing choice closes. The test does NOT fail merely because a stable extra identity (a ref, or a `useState` setter) is appended to either array -- that is over-invalidation, a different property this test never claimed to cover, and is what `exhaustive-deps` requires here once the callbacks it flagged actually close over those values. Order is not asserted, because React does not read it.

