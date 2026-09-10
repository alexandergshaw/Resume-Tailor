### R-048 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** An answer contains the words the candidate actually spoke between Start and Done — bounded by AUDIO time, not by when the transcript happened to arrive. Bounding by arrival time dropped the closing sentence of every answer and attributed pre-Start speech to it.

**Steps:**
1. Read `isFinalInAnswerWindow` and `deriveSpeechSpan` in `hello-world/lib/copilot/answerWindow.js`.
2. Read the `start`/`duration` passthrough in `hello-world/lib/copilot/deepgram.js` and the drain in `doneAnswer` in `hello-world/app/copilot/practice/usePracticeAnswer.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/answerWindow.test.js lib/copilot/stt/deepgram.test.js` from `hello-world/`.

**Expected:** A final whose audio start precedes the answer's start offset is excluded. While the end offset is still null — the answer is in progress or draining — a final at or after the start offset is included, which is what catches the last sentence still in flight when Done is pressed. `doneAnswer` does not close the window synchronously; it drains for a bounded period so a lost socket can never hang the UI. `deepgram.js`'s `start` and `duration` are additive: the pre-existing `speaker`, `transcript`, `isFinal` and `speechFinal` fields are unchanged in name and value, non-Results frames and empty transcripts are still ignored, and the live copilot path is unaffected.

### R-049 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** Pace is computed over the span the words actually cover, not the button-to-button wall clock, and no delivery number is ever `NaN` or `Infinity`.

**Steps:**
1. Read `computeAnswerMetrics` in `hello-world/lib/copilot/answerMetrics.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerMetrics.test.js` from `hello-world/`.

**Expected:** `wordsPerMinute` is derived from `speechDurationMs`, not from the wall-clock `durationMs`; both are reported, and the UI shows them as separate rows so they are never conflated. Zero, missing or negative durations produce 0 wpm rather than Infinity or NaN, and empty text returns zeros throughout. `hasMetric` delegates to `profileMetric` rather than duplicating the regex, and `micMuted` is carried through so the review can say the mic was off.

### R-050 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** A camera the candidate switched off is reported as off, not measured as a dark, motionless shot. The Camera control sets `track.enabled = false`, which leaves the track in the stream emitting black frames.

**Steps:**
1. Read `isTrackActive`, the sampling guard, and how `hadVideo` and `partiallyOff` are derived in `VideoFrameSampler` in `hello-world/lib/copilot/videoStats.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/videoStats.test.js` from `hello-world/`.

**Expected:** Sampling is skipped while the video track is disabled or muted, and `hadVideo` is derived from whether any VALID sample was captured — not from track presence. A camera off for the whole answer reports `hadVideo: false` and produces no lighting or steadiness claim at all. A camera off for part of the answer sets `partiallyOff`, which the review states, while the valid samples still produce honest numbers. No sample is taken while the offscreen video reports zero dimensions or a readyState below HAVE_CURRENT_DATA.

### R-051 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** A measurement flag that is false for lack of data is never presented as a finding. This is the difference between "we measured it and it was fine" and "we could not measure it".

**Steps:**
1. Read `summarizeVideoStats` and the `MIN_LUMA_SAMPLES` / `MIN_MOTION_SAMPLES` gates in `hello-world/lib/copilot/videoStats.js`.
2. Read `buildDeliveryNotes` and `computeDeliveryScore` in `hello-world/lib/copilot/critiqueLocal.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/videoStats.test.js lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** Empty or missing input returns `frames: 0`, `motionSamples: 0` and every flag false with no NaN. `veryStill` and `fidgety` cannot fire below the motion-sample gate — a single-sample answer must never claim the candidate was very still. `tooDark` and `tooBright` cannot fire below the luma gate. No lighting claim is emitted without luma samples and no steadiness claim without motion samples, and no visual claim of any kind when `hadVideo` is false. When nothing about delivery was measurable, the delivery component is excluded and the remaining weights renormalized rather than scored zero and blamed in the verdict.

### R-052 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** Filler counting does not overstate. Ambiguous words are counted separately from true fillers, and no filler matches inside a larger or hyphenated word.

**Steps:**
1. Read `FILLER_PHRASES`, `DISCOURSE_MARKER_PHRASES` and `phraseRegex` in `hello-world/lib/copilot/answerMetrics.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerMetrics.test.js` from `hello-world/`.

**Expected:** Um, uh, er, "you know", "sort of", "kind of" and "I mean" count as fillers. Like, right, actually, basically and literally are counted and displayed SEPARATELY as discourse markers that may be legitimate usage — they are not folded into the filler count. "unlike" never counts "like" and "right-hand" never counts "right": the boundary handling excludes letters, digits and hyphens on both sides. `fillerRate` is per 100 words and is 0 when there are no words.

### R-053 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** The replay recorder never blocks answering and never mixes one answer's video into another's clip.

**Steps:**
1. Read `pickSupportedMimeType` and the `AnswerRecorder` class in `hello-world/lib/copilot/answerRecorder.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerRecorder.test.js` from `hello-world/`.

**Expected:** With `MediaRecorder` missing or no supported mime type, `start()` is a no-op and `stop()` resolves null — replay is a bonus and its absence never blocks answering or the metrics. `stop()` ALWAYS settles: with a Blob on the stop event, and with null when unsupported, when nothing was recording, when no chunks arrived, or when the guard timeout elapses first. Each recording's `dataavailable` listener is bound to its OWN chunk array, so a chunk flushed late by a previous recorder cannot land in the next answer's clip. `stop()` is safe twice and without a matching `start()`; a throwing constructor or `start()` degrades to the no-op path.

### R-059 | area: practice-answer | parallel-safe: yes | automatable: no

**Summary:** No browser resource outlives the answer that created it. Every abandonment path finalizes the recorder and the sampler, and exactly one replay object URL exists at a time.

**Steps:**
1. Read `abandonInProgressAnswer`, `resetAnswerState`, the object-URL handling, and the generation guard in `hello-world/app/copilot/practice/usePracticeAnswer.js`.
2. Confirm every caller — posting change, next question, try again, session stop, the session's own unsolicited teardown, and unmount — goes through them.

**Expected:** Changing the posting, moving to the next question, retrying, stopping the session, an unsolicited teardown, and unmounting all finalize an in-progress answer: the sampler interval and its offscreen video are released, the recorder is stopped, and the pending drain is resolved rather than left hanging. The replay object URL is revoked before a new one replaces it and on every discard path. Post-await writes are dropped when their captured generation is stale, so a finished answer's review cannot land under a different question. The mic-muted flag is seeded from the current switch state at answer start, not only from a toggle fired mid-recording.

