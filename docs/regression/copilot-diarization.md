### R-219 | area: copilot-diarization | parallel-safe: yes | automatable: yes

**Summary:** Telling the copilot which voice is yours can never make it stop listening while that is the only voice it has heard.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/speakerIdentity.deafness.test.js lib/copilot/speakerIdentity.test.js lib/copilot/session.inperson.test.js`.

**Expected:** All pass.

**The mechanism:** on a shared room mic, diarization very often resolves BOTH voices to a single tag. `scoreSpeakers` still elects tag 0 as the user at low confidence, and `speakerDisplayLabel` renders it "Speaker 1" rather than "You" — so the transcript offers that row as a correctable one. A user who sees their own words under "Speaker 1" clicks "that's me". `setUserTag(0)` pins the override, and `shouldEvaluateAsQuestion(0)` answers false from then on, for the only tag that exists. `observe` accumulates evidence and only then skips `recompute()` while overridden, and nothing calls `reset()` mid-session — the distinction matters, because evidence continuing to grow is exactly what the new "has another tag been observed" check depends on. **One click, and every subsequent utterance — including every question — is skipped for the rest of the interview, with no way for the user to notice.**

- **The property, not a special case:** identity may suppress a tag only while some OTHER tag remains observed to carry the evaluation. Suppressing the user tag is only ever the claim "skip this one, the other voice is covered", and that claim is false when the user tag is the only tag evidence has ever seen.
- **Deliberate limit, stated so nobody reads the summary too broadly.** The guard asks whether another tag has EVER been observed, not whether one is still carrying turns. So if two tags are seen early, the user corrects one, and the diarizer then merges everyone back onto the corrected tag, suppression continues for the rest of the session. That is the same behaviour the two-voice positive control asserts, so it cannot be tightened without deleting the feature; closing it properly needs a recency notion the module does not have. Worth revisiting if merged-tag deafness is reported in the field.
- **The positive controls are what stop the fix from deleting the feature.** On a genuine two-voice session a correction must still suppress exactly the corrected tag; a third voice joining later must still be evaluated; and the moment a second voice appears on a previously single-voice session, suppression must begin. A fix that simply returned true always fails all three.
- **`swap()` set high confidence and the override flag even when it found no other tag to swap to** — pinning a belief nobody expressed and, through the same path, going deaf. It now leaves the state untouched when there is nothing to swap to. It has no production caller yet, which is exactly why it was worth fixing before one exists.
- **`scoreSpeakers` and its six clauses were not touched**, in particular the clause requiring the argmax to hold at least 40 words ABSOLUTE rather than a share — that one is load-bearing against a known counterexample where a candidate saying "Thanks for having me, how are you?" elects the interviewer as the user at high confidence.
- **Falsifiability was proven, not assumed:** restoring the unconditional suppression put exactly the two single-tag cases red and left the other seven green, which is the correct blast radius.

