### R-102 | area: live-pace | parallel-safe: yes | automatable: yes

**Summary:** Live pace is measured from audio time or not reported at all, and shares one set of thresholds with practice mode.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/livePace.test.js lib/copilot/answerMetrics.test.js`.

**Expected:** All tests pass. `computeLivePace` returns `wordsPerMinute: null` with `measured: false` whenever it cannot measure — never `0`, and never a label without a measurement. `appendSpeechSample` DROPS frames whose `start`/`duration` are unusable rather than coercing them to `0`, and specifically does not treat `start === 0` as missing: a naive falsy check there is the exact bug class this guards, and a fabricated zero silently corrupts the reading. The slow/rushed thresholds are imported from `answerMetrics.js` (110/170), not restated — two copies would drift and live mode would then disagree with practice mode about what "rushed" means for the same speaker. `computeAnswerMetrics`'s own output is unchanged by that extraction, including its deliberate `"conversational"` fallback when the speech span or word count is zero, which is a not-enough-to-judge fallback and NOT a claim that 0 wpm was measured.

