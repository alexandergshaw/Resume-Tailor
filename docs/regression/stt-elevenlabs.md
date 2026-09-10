### R-077 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** The ElevenLabs provider speaks the documented wire protocol, including the fields the service requires but the copilot's own pipeline knows nothing about.

**Steps:**
1. Read `connect()` and `send()` in `hello-world/lib/copilot/stt/elevenlabs.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js` from `hello-world/`.

**Expected:** The socket is opened with `model_id=scribe_v2_realtime`, `audio_format=pcm_16000`, `include_timestamps=true`, `commit_strategy=vad` and the token. `send()` accepts the same 16 kHz mono PCM16 `ArrayBuffer` every caller already passes, base64-encodes it into `audio_base_64`, and sends `message_type: "input_audio_chunk"` with `sample_rate: 16000` and `commit: false` — `commit` is documented as required, and `false` is the correct value under a VAD commit strategy where the server decides utterance boundaries. The base64 round-trips the original bytes exactly, including 0x00 and 0xFF and across the internal encode-loop boundary. Nothing is sent when the socket is not open.

### R-078 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** The ElevenLabs transcript mapping, which is where this provider silently succeeds or silently corrupts everything downstream.

**Steps:**
1. Read the message-type switch and the span derivation in `hello-world/lib/copilot/stt/elevenlabs.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js` from `hello-world/`.

**Expected:** `partial_transcript` maps to isFinal false / speechFinal false; `final_transcript` and `final_transcript_with_timestamps` map to isFinal true / speechFinal FALSE; `committed_transcript` and `committed_transcript_with_timestamps` map to isFinal true / speechFinal TRUE. That last mapping is the one that makes live-mode question detection work at all — under `commit_strategy=vad` a commit IS the end-of-utterance signal, the role Deepgram's `speech_final` plays — so it is asserted directly rather than incidentally. `start` and `duration` derive from the `words` array using only entries whose `type` is `word`, excluding spacing and audio-event entries. When there is no usable `words` array, BOTH are `undefined` and never a fabricated 0: `answerWindow.js` reads undefined as "no timing available", so a 0 would silently corrupt every practice-mode delivery number without ever throwing. Empty or whitespace-only text is skipped, and `session_started` and `committed_transcript_entities` never reach `onTranscript`.

### R-079 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** The tripwire for the wire format differing from the documentation. This provider was implemented against published docs and has never been exercised against the live service, so a protocol mismatch must announce itself rather than presenting as a session that transcribes nothing.

**Steps:**
1. Read the error handling and the unknown-message-type reporting in `hello-world/lib/copilot/stt/elevenlabs.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js` from `hello-world/`.

**Expected:** Every documented error `message_type` routes to `onError` with a useful message and is not treated as unrecognized. An UNRECOGNIZED `message_type` is reported through `onError` exactly ONCE per session, naming the type — it must fire, and it must not spam once per message. An abnormal socket close surfaces through `onError` in addition to `onStatus("closed")`, while a close initiated by the module's own `close()` does not. The module carries a comment recording that it was written against documentation rather than verified against the live service, so the provenance of its assumptions is legible to the next reader.

### R-127 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** A committed_transcript(_with_timestamps) that only re-delivers the span of the final_transcript(_with_timestamps) that already landed is delivered for `speechFinal` but never counted twice.

**Steps:**
1. Read `_emitTranscript` in `hello-world/lib/copilot/stt/elevenlabs.js` and the `textAlreadyDelivered` field documented on `onTranscript` in `hello-world/lib/copilot/stt/index.js`.
2. Read the guards in `hello-world/app/copilot/practice/usePracticeAnswer.js`'s `recordTranscriptEvent` (via `acceptedAnswerFinal` in `hello-world/lib/copilot/answerWindow.js`), `hello-world/app/copilot/practice/PracticeClient.js`'s `onTranscript` handler, and `hello-world/app/copilot/useLiveSession.js`'s `onTranscript` handler (moved out of `CopilotClient.js` in group M).
3. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js lib/copilot/stt/deepgram.test.js lib/copilot/answerWindow.test.js` from `hello-world/`.

**Expected:** `ElevenLabsStream` retains the last isFinal:true frame's `{ text, start, duration }` it delivered; a later isFinal:true frame whose text, start, AND duration all exactly match it is still delivered (consumers need its `speechFinal: true`) but carries `textAlreadyDelivered: true`. The match requires all three fields — two genuinely different utterances that happen to share the same words but start at different times are both delivered, un-flagged, and a frame with no usable `words` array (start/duration both `undefined`) is never treated as a match either, since `undefined === undefined` proves nothing about whether it's really the same span. The flag is absent (never explicit `false`) on every other frame, so Deepgram's frames — proven by an explicit no-regression case — and any consumer written before the flag existed see byte-identical objects. `acceptedAnswerFinal` (answerWindow.js) rejects a final carrying the flag even when it is otherwise perfectly in-window and collecting; `usePracticeAnswer.js`'s `recordTranscriptEvent`, `PracticeClient.js`'s session-transcript append and pace-sampler feed, and `CopilotClient.js`'s `appendFinal`/`recordSpeechSample`/interviewer-utterance assembly all skip the TEXT for a flagged frame while still honouring `speechFinal` for question detection. Before this fix a five-entry answer transcript rendered as A, A, B, B, C and reported word count / filler count / words-per-minute at roughly double the true value.

### R-261 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** One ElevenLabs commit produces one utterance, not two — the defect that silently doubled every question and every model call in a real interview.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.commitPair.test.js lib/copilot/stt/elevenlabs.test.js`.
2. Read `_emitTranscript` in `hello-world/lib/copilot/stt/elevenlabs.js`.

**Expected:** All pass. **This amends R-127, whose stated rule is now wrong** — R-127 says a re-delivery "requires all three fields" and that "a frame with no usable `words` array is never treated as a match either". That rule cannot see the case that actually occurs.

A live session recorded on 2026-08-25 (`interview-log-live-2026-08-25-1644.json`) shows every one of its five utterances delivered **twice**, 66–114ms apart, both frames carrying `speechFinal: true` — so both came from the `committed_transcript` / `committed_transcript_with_timestamps` branches. ElevenLabs emits BOTH members of that pair for one commit when `include_timestamps` is on. The first carries no `start`/`duration` at all; the second carries both. R-127's rule requires numeric spans on *both* sides, so the untimed member defeated it on 100% of finals. The module's own comment called this "a rare residual double-count".

What it cost, measured in that log: **six `question.added` events for three spoken questions, and six drafted answers** — two concurrent model calls per question, contending with each other (ids 5 and 6 are the same question; one took 4.0s, its twin 9.2s). Every downstream dedupe is defeated by construction: `acceptQuestion` in `useLiveSession.js` deliberately falls THROUGH its back-to-back guard when the prior card is still `loading` (AC-P4.4), and the twin always arrives ~70ms later, always while loading. For the first question the two copies did not even share text — the heuristic missed "Talk to me about…", so both went to the remote confirm, which rewrote one to "Tell me what appealed…" and the other to "Talk to me about what appealed…": two normalized keys, two cards, two drafts, from one sentence.

**The corrected rule is text-first.** Text equality decides whether two finals are candidates at all; the span decides only among those. Both spans numeric → re-delivery iff equal (R-127's case, unchanged). Exactly one side numeric → re-delivery (the commit pair). Neither numeric → unproven, delivered (unchanged). ElevenLabs' published AsyncAPI spec carries **no id, sequence number or utterance marker** on any transcript message, so text is not a shortcut here — it is the only correlation the protocol offers.

**And the remembered final always holds the best span known for its commit.** Two halves, in opposite directions, and a peer review with a 31-mutant harness found the second one by building the implementation the first draft of this rule admitted:
- A suppressed frame must not overwrite the remembered final. Otherwise `timed(1) → untimed → timed(12)` compares the third frame against the untimed twin, matches, and a real utterance vanishes.
- **Except that it upgrades the remembered span when the suppressed twin has one the remembered frame lacks.** Otherwise `untimed → timed(1) → timed(30)` — the order this provider actually delivers — leaves the memory untimed, so the third frame also matches "exactly one side has a span" and a real utterance vanishes here instead. "Keep the richer original" is only correct when the timed member leads.

Accepted residual, stated rather than rediscovered: two identical utterances that each arrive with **no** timed member cannot be told apart and the second is suppressed. Unreachable while `INCLUDE_TIMESTAMPS` is on, since every commit then has a timed member whose span differs.

**Also here:** `message_type: "warning"` is in ElevenLabs' documented server-to-client list and was unhandled, so a real warning arrived as "this module … has not been verified against the live service" — telling the user their wire format had drifted when it had not. It now has its own case and is deliberately NOT in `ERROR_MESSAGE_TYPES`.

