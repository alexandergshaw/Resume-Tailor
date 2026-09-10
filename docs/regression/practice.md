### R-141 | area: practice | parallel-safe: yes | automatable: yes

**Summary:** One practice rep costs two clicks, and a press that is waiting on a question can never fire late.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/practiceFlow.test.js`.
2. Read the two effects in `hello-world/app/copilot/practice/PracticeClient.js` that call `autoStartDecision` and `shouldQueueSampleAnswer`.

**Expected:** All tests pass. Reported: "the workflow for the practice page needs to be a lot less clicks. next question should kick off the 'start answering' and should also queue up the sample answer." Next question -> Start answering -> Done -> Show sample answer becomes Next question -> Done, with the sample answer already drafted.

**The hard part is that the question arrives asynchronously**, so the press ARMS an intent and the arrival consumes it. Every way the arrival can go wrong DISARMS rather than leaving a press pending — a pending press fires on some later, unrelated render, which in a recorded practice session means the recorder starting at the worst possible moment. The cases cover: the fetch failing, the bank being exhausted, the session never having been live, and the user pressing Start answering manually in the gap. `loading` outranks a non-empty `question`, because the PREVIOUS question is still on screen while the next one loads and starting there records an answer to the question the user just moved off.

`onRetryQuestion` does NOT arm: a retry recovers from a failed fetch, it is not a deliberate "give me the next one and let me answer it". "Try again" DOES arm, and calls the decision synchronously at the click rather than through the watcher effect — `resetAnswerState`/`abandonInProgressAnswer` change none of the five values the effect watches when the question is already on screen, so the effect would never re-fire and the shortcut would silently not work for that path.

**Recording starts immediately, with no countdown, and that is safe for a measured reason rather than an assumed one:** pace and filler are computed on the AUDIO clock, never wall-clock (see `livePace.js`'s header and `answerMetrics.js`'s `speechDurationSec`), so the seconds a candidate spends reading the question before speaking do not drag either reading down. Dividing by wall-clock time already burned this app once as BUG-1c.

**Queuing makes the sample answer READY, never SHOWN.** It writes the cache through the same path `prime` already uses and never touches `state`. Practice mode hides the sample answer behind a reveal on purpose — seeing a model answer before attempting one is what makes practice worthless — so this must stay a cache write. It is gated by its own generation ref so a slow queue for a question the user has moved past writes nothing, deduped per question via `normalizeQuestion` (the same key the cache uses, so case and whitespace differences do not pay twice), and its errors are swallowed: a failed queue leaves the user with today's behaviour, a request on reveal, never an error on screen.

