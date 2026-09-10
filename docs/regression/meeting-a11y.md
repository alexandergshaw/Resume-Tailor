### R-302 | area: meeting-a11y | parallel-safe: yes | automatable: yes

**Summary:** `app/meeting/MeetingInsightList.js` and `app/meeting/MeetingTranscript.js` each keep a local copy of the app's visually-hidden clip-rect style, and both copies are unit-bearing and byte-identical to the canonical `visuallyHidden` export in `lib/copilot/answerStatus.js:81-91` again -- closing the same "shipped invisibly because a length had no unit" defect the sweep below exists to catch, this time in the two files that previously carried it.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/visuallyHiddenUnits.sweep.test.js app/meeting/meetingVisuallyHidden.test.js`.
2. Read the three copies side by side: `lib/copilot/answerStatus.js:81-91` (the canonical `visuallyHidden` object), `app/meeting/MeetingInsightList.js:44-54`, `app/meeting/MeetingTranscript.js:40-50`.

**Expected:** All tests pass. `visuallyHiddenUnits.sweep.test.js` strips comments before scanning source for hand-written clip-rect objects (so prose quoting the OLD broken object does not self-report) and asserts every length in every such object carries a real CSS unit -- `px`, `%` or `em` -- rather than a bare number, which is what let the previous copy in this pair render as ordinary, visible, focusable text instead of being clipped to a 1px box. `meetingVisuallyHidden.test.js` separately measures the COMPUTED box size of each component's rendered clip-rect element through the live jsdom cascade and confirms it collapses to the expected near-zero dimensions -- the outcome the unit-bearing values exist to produce, not merely their presence in source. Together the two suites prove both that the values are well-formed AND that they actually do what visually-hidden markup is for.

**What this case does not, and cannot, prove going forward.** Nothing in either suite asserts the three copies stay IDENTICAL to each other if `answerStatus.js`'s canonical object is edited later (e.g. to `clipPath`) without updating the two local copies in step with it -- both suites would stay green with the copies silently diverged. That is a known gap in the current coverage, not a defect landed by this chunk; closing it would mean adding a deep-equal assertion between each local object and the imported `visuallyHidden` to `meetingVisuallyHidden.test.js`.

