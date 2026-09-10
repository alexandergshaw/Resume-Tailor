### R-069 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** Body-language feedback actually reaches the user. It is appended to a capped list, so without a reserved slot it is silently deleted and the panel then declares it unavailable for an answer that was measured and scored.

**Steps:**
1. Read `buildDeliveryNotes` in `hello-world/lib/copilot/critiqueLocal.js` and `sanitizeCritique` in `hello-world/app/api/copilot/critique/route.js`, specifically how the body-language line is budgeted against `MAX_LIST`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueLocal.test.js app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** On the embedded path, an answer with a fully measured body-language summary AND a mic-muted note still returns the body-language note — the other notes are capped to `MAX_LIST - 1` first. On the Gemini path, a model response carrying a full set of delivery items PLUS a body-language line still delivers the body-language line. The body-language line has its own longer length clamp so a fully measured note is not truncated mid-sentence and does not lose its final fact. The note is identifiable by a prefix that tolerates common variants without double-prefixing.

### R-070 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** Turning the camera off costs the user nothing. An unmeasurable component is excluded and the weights renormalised, never scored zero and blamed.

**Steps:**
1. Read `computeBodyLanguageScore` in `hello-world/lib/copilot/critiqueBodyLanguage.js` and how `computeDeliveryScore` in `hello-world/lib/copilot/critiqueLocal.js` consumes it.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueBodyLanguage.test.js lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** `computeBodyLanguageScore` returns null, not zero, when nothing was measurable. An answer given with the camera off scores identically to an otherwise identical answer that never had a camera, asserted by comparing composite scores rather than internals. The composite stays an integer within 0-100 across no summary, an all-null summary, camera off and fully measured. The too-close and too-far framing penalties scale with their ratios rather than being flat deductions, and lean is scored in exactly one place rather than penalised twice.

### R-071 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** Every body-language sentence claims exactly what was measured and nothing more. This feature tells a person things about their own body, so the vocabulary is a correctness property.

**Steps:**
1. Read `buildBodyLanguageFacts`, `bodyLanguageDeliveryNote` and `normalizeBodyLanguage` in `hello-world/lib/copilot/critiqueBodyLanguage.js`, and `bodyLanguageInstruction` in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueBodyLanguage.test.js` from `hello-world/`.

**Expected:** A null aggregate produces no sentence at all, in either direction — it never becomes praise and never becomes criticism. Head orientation is described as facing the camera and never as eye contact, gaze or attention. Percentages state the visible-face denominator rather than implying whole-answer coverage, and `partiallyOff` adds a coverage caveat. Face fill is described as the face, not the person filling the frame. Hands out of frame is reported as not measured, never as stillness. No fact is emitted whose rounded percentage reads as 0. Ratios and angles are clamped, so a malformed client summary cannot print impossible values into either the user-facing note or the facts block sent to Gemini as ground truth. No emotion, confidence, nerves, personality or appearance vocabulary appears anywhere, including in the model instruction, which also forbids commenting on a signal absent from the supplied facts.

### R-072 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** The model cannot manufacture body-language content out of nothing, and the response contract is unchanged for existing consumers.

**Steps:**
1. Read `sanitizeCritique` and the `allowBodyLanguage` gate in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** When nothing was measured and no frames were sent, body-language content is dropped from the WHOLE delivery channel — not merely from the dedicated field — so a model that writes it into `delivery` instead cannot bypass the gate. The measured facts are supplied to the model as ground truth it is told not to contradict. The response still carries exactly its established key set, `source` is still set by the server from the path actually taken, `star` is still null unless the question is behavioral, the score is still clamped to an integer 0-100, and the embedded path still never constructs a Gemini client and never parses frames.

### R-073 | area: bl-feedback | parallel-safe: yes | automatable: no

**Summary:** The feedback panel says who actually looked at the video, and why body language is missing when it is.

**Steps:**
1. Read the provenance caption and the unavailable state in `hello-world/app/copilot/practice/AnswerFeedback.js`.
2. Read what `PracticeClient` passes it, specifically the frames-sent boolean and the body-language reason.

**Expected:** The caption keys on whether frames were ACTUALLY sent, not on which engine ran. With the frames opt-in off — the default — the Gemini path reads the same as the embedded path: measured numbers only, nobody reviewed the video. The Gemini-failed-and-fell-back case does not claim a visual review either. When body language is unavailable the panel states the specific reason carried from the sampler rather than a generic message, and never hides the section silently or renders empty rows. The panel's body-language feedback is distinct from the raw measurements `AnswerReview` shows on the same screen, and the two never contradict each other.

