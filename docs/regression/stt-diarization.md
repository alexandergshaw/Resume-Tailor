### R-145 | area: stt-diarization | parallel-safe: yes | automatable: yes

**Summary:** Deepgram diarization is strictly additive, and a diarized frame is split per speaker. The pre-diarization wire behaviour is what R-076 pins, and this feature must not disturb a single byte of it.

**Steps:**
1. Read `DEFAULT_PARAMS`, `connect()` and `_emitDiarizedRuns` in `hello-world/lib/copilot/stt/deepgram.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/` from `hello-world/`.

**Expected:** With diarization off or unrequested, the query string equals the frozen literal `model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=300` exactly, and `speakerTag` is an ABSENT key on the emitted frame -- not `speakerTag: undefined`, which vitest's `toHaveBeenCalledWith` would ignore while the object shape silently changed. With diarization on, `diarize_model=v1` is appended and nothing else changes; the deprecated `diarize=true` boolean is never sent, and never both. A diarized frame emits one call per contiguous run of same-speaker words, preferring `punctuated_word`, with each run's own `start`/`duration` derived from its own first and last word -- both ABSENT, never a fabricated `0`, when the underlying timings are missing (R-078's lesson: a `0` corrupts every derived delivery number without throwing). The frame's `speech_final` lands on the LAST run actually emitted; blank runs are skipped; a frame whose runs are all blank emits nothing. An unusable `words` array -- missing, `[]`, or no numeric `speaker` on any entry -- falls back to today's single whole-frame call rather than to silence.

