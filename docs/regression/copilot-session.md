### R-246 | area: copilot-session | parallel-safe: yes | automatable: yes

**Summary:** `CopilotSession` can run without attributing speakers at all, for a meeting on one shared microphone — and the interview path is byte-for-byte unchanged.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/ --no-file-parallelism`.
2. Start an interview session in-person and confirm it behaves exactly as before: turns labelled You/Them, the "still working out who is who" behaviour intact, and the provider-cannot-diarize warning still appearing when it applies.

**Expected:** All 91 copilot suites pass, and in-person interview behaviour is unchanged.

**Why a meeting must not use `speakerIdentity.js`.** That module decides who "you" is with `youScore = wordShare - 2 * questionRate`, justified in its own header by "the candidate talks the most and asks the fewest questions; the interviewer does the opposite". In a work meeting the user is very often the quietest person present and very often the one asking, so the formula is not slightly off — it is systematically backwards. The same header records that a naive version elected the wrong speaker twice on real audio and then went **silently deaf**, because question detection routes off the identity gate rather than off the display label.

**"Just don't call it" was not available**, which is why this is a code change rather than a client-side choice: the constructor built the identity unconditionally for `source === "inperson"`, and two methods called it on every frame and every assembled utterance. A null instance throws.

**The new option is `attributeSpeakers`, defaulting to `true`.** That default is the entire safety argument: `session.test.js`, `session.inperson.test.js` and `session.silent.test.js` all construct without it, so they exercise the old path and are the real regression gate. Six seams changed — the constructor's identity, `_resolveSpeakerLabel`, `_emitUtterance`, `_handleInPersonFrame`'s assembly key, the `diarize` request, and the warning.

**With attribution off, a turn is `"room"` — not `"them"`.** One shared microphone is one unattributed voice, and `"them"` would be a claim about who spoke. `evaluate` is unconditionally `true`, because there is no conservative gate to consult and a meeting has no "the other person asked this" notion; every turn is potential material.

**Diarization is not requested rather than requested-and-discarded.** Asking a provider to separate speakers still costs the request and, on Deepgram, selects a different model.

**The warning is suppressed, not deleted, and a test pins the difference.** Its wording names live pace and filler-word readings "for you" — meaningless in a meeting, and describing a degradation that has not happened. The default path must still emit it, so the test asserts both directions.

**`tab` and `system` are inert under the option**, and a test says so rather than assuming it. Those paths open two independent sockets and never built an identity, so their separation is structural; the risk being guarded is a future change collapsing them to one voice.

