### R-210 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** Every posting source renders as something a person recognizes, and an AI-found posting says what was actually checked about it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedClient.test.js app/components/feed/FeedPostingCard.test.js`.

**Expected:** All pass, including:

- `SOURCE_LABELS` covers every source `ingestFeed` writes — greenhouse, lever, ashby, highered_rss, ai_search — and no label leaks snake_case. `sourceLabel` falls back to the RAW value for a source the map has not caught up to, never to "Unknown": hiding an unrecognized source erases the only clue anyone debugging a new adapter has. A missing source renders `""`, not the literal word "undefined".
- `sourceProvenance` returns text only for `ai_search`, is rendered as VISIBLE text on the card rather than in a tooltip (a tooltip is unreachable on touch and easy to miss, and this is the whole reason to trust a model-proposed posting), and is capped at 60 characters because it repeats on every AI card.
- It must not overstate. `lib/feed/llmSearch.js` proves the URL resolves to a page that reads like an individual posting (R-203); it proves nothing about the role's quality and nothing about whether the job is still open. The test asserts the absence of "still open", "guarantee", "vetted" and "high quality", **paired with a positive control** asserting the sentence is actually present — without which a card rendering nothing at all would pass.
- `remote_type` renders through `REMOTE_LABELS`, so "On-site" rather than the raw enum.

### R-211 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** The Live Feed's status readouts tell the truth about every source, and in words rather than colour.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedClient.test.js app/components/feed/FeedToolbar.test.js`.

**Expected:** All pass, including:

- `sourceHealthFailureCount` sums failures across EVERY source. The toolbar previously read `sourceHealth?.greenhouse?.failures` alone, so a total outage of Lever, Ashby, the higher-ed RSS feeds or AI search displayed as perfect health — wrong from the moment a second source was added, and worse once there were five.
- A `skipped` source is NOT a failure and is not counted. The AI-search source reports `skipped` whenever the engine choice, the missing key or the cadence gate says not to run this cycle (R-205), which on a correctly-configured deploy is most runs. Counting it would put a permanent warning on a healthy feed.
- `freshnessLabel` returns different WORDS for stale and fresh, both carrying the relative time, with the before-first-ingest state distinct from both. Staleness used to be signalled only by a dot changing from green to amber — colour carrying meaning with no text equivalent (WCAG 1.4.1). The dot remains as glanceable reinforcement; it is no longer the only signal.

### R-212 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** Every control in the Live Feed has a name a screen reader can reach and a voice-control user can say.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/feed/FeedPostingCard.test.js app/components/feed/FeedToolbar.test.js`.

**Expected:** All pass. The rules below are what the tests enforce, and each exists because the code violated it:

- **Every control has a non-empty accessible name.** MUI's `Tooltip` labels its DIRECT child, and several controls are wrapped in a `<span>` so a tooltip still shows while the button is disabled — which put the name on the span and left the button announced as nothing at all. The fix is an explicit `aria-label` on the control itself, which MUI cannot override because the child's own props are spread last.
- **A tooltip must never override a visible label** (WCAG 2.5.3). A button reading "Autofill profile" was named "Edit the profile used by Auto Fill and get your bookmarklet", so a voice-control user saying what they saw could not activate it. Tooltips that EXPLAIN carry `describeChild`, making them `aria-describedby` rather than the name. This applies to non-controls too: the source-error `Chip` had the identical defect and was initially fixed with no test noticing, because the first version of the check only inspected `button, a[href]`. It now inspects every element carrying an `aria-label`.
- **A card's control names identify WHICH posting.** Forty cards previously produced forty controls all named "Hide". Names carry the posting title and stay distinct within a card, and the card renders exactly its four controls — pinning the count alone let a mutant swap Auto Fill for a do-nothing decoy and pass every naming assertion.
- **The accessible-name model in these tests reflects what an AT resolves, not one technique.** It resolves `aria-labelledby` and `title` as well as `aria-label`, and it strips `aria-hidden`, `[hidden]` and `display:none` subtrees before falling back to text — an earlier version accepted a control whose only name was a hidden span, which reads as named to a naive helper and as nothing to a real user, and rejected a correct `aria-labelledby` implementation.
- **The posting title is an `h3`** (under `TabHeader`'s `h2`) and the card is an `<article>`. It was a bold `Box` inside a `div`: the feed read as one undifferentiated run of text with no way to move between postings.

### R-213 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** The extraction is actually wired in, and LiveFeedTab stays under the size limit.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedWiring.test.js`.

**Expected:** All pass. `LiveFeedTab.js` renders `FeedPostingCard`, `FeedToolbar` and `FeedFilterSummary`; contains no `label={posting.source}` and no `sourceHealth?.greenhouse?.failures`; calls `freshnessLabel` and `sourceHealthFailureCount`; and every component under `app/components/feed/` plus `LiveFeedTab.js` itself is under 1000 lines, with `LiveFeedTab.js` specifically under 900 (it was 1320; it is now 855).

**Why this file exists, and why it reads source text rather than behaviour:** every other test in this change gates a PIECE. All of them pass just as happily against a `LiveFeedTab.js` that still has every original defect, with the new components sitting beside it fully tested and never rendered — which would have closed R-209 on paper while changing nothing on screen. An independent audit demonstrated exactly that before this file was written. Reading source text is ordinarily a poor way to test anything; it is used here because the properties being pinned are about the shape of the source, and the alternative — mounting the whole tab — drags in network state and a 60-second refresh timer. Where a behavioural test is possible it lives in the component test files instead.

**Not gated, deliberately:** `FeedEmailAlerts.js`, `FeedSearchFields.js` and `FeedFilterSummary.js` have no behavioural tests, only the wiring assertion that they are rendered. They were extracted to get `LiveFeedTab.js` under the limit; extracting only the three originally planned components left it at 1006 lines.

