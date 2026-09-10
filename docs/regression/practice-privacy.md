### R-057 | area: practice-privacy | parallel-safe: yes | automatable: no

**Summary:** The practice screen never tells the candidate their camera data stays local while it is being uploaded, and consent for frames is read at send time rather than latched.

**Steps:**
1. Read `framesWillUpload`, `privacyNotice` and `onRetryCritique` in `hello-world/app/copilot/practice/PracticeClient.js`.
2. Read `runCritique` and `retryCritique` in `hello-world/app/copilot/practice/usePracticeAnswer.js`, noting what `lastCritiqueInputsRef` does and does not hold.
3. Read the practice-mode description in `hello-world/app/copilot/CopilotClient.js`.

**Expected:** The frames opt-in defaults to off and is disabled on the embedded engine. Frames are read from the retained frame ref at SEND time using the current opt-in, and are deliberately not part of the cached retry inputs — so turning the switch off and pressing Retry sends no frames.

**Narrowed (group H):** this case now covers ONLY the frames opt-in and the retry-reads-at-send-time guarantee, above. Its original Expected also asserted the whole privacy notice, and three of those clauses have since been deliberately retired by later features, leaving this case unsatisfiable at the same time as R-064 and R-081:

- "audio to Deepgram always" was retired by the pluggable-STT work; R-081 now requires the notice to name whichever provider the server actually selected, and to name none before that is known.
- "the recorded replay clip is never uploaded under any setting" was retired by the save-recordings feature; R-064 requires the notice to state the Supabase upload when saving is on.
- "No wording promises the video stays in the browser while frames are in flight" reads as false against the current wording, which discloses the still frames in one sentence and the clip staying local in the next — two independent destinations, deliberately worded so neither implies anything about the other.

R-064 is this case's successor for notice truthfulness and enumerates the same guarantees against the current three-control matrix. Retiring those clauses here, rather than deleting the case, keeps the frames-consent guarantee — the part nothing else covers — under test.

### R-064 | area: practice-privacy | parallel-safe: yes | automatable: no

**Summary:** The practice screen's privacy notice is true in every combination of the three independent controls, and consent is read at send time rather than latched.

**Steps:**
1. Read `privacyNotice`, `framesWillUpload`, the save switch and `onRetryCritique` in `hello-world/app/copilot/practice/PracticeClient.js`.
2. Read `persistAnswer` and `runCritique` in `hello-world/app/copilot/practice/usePracticeAnswer.js`, noting how the save preference and the frames opt-in are each read.
3. Read the practice-mode description in `hello-world/app/copilot/CopilotClient.js`.

**Expected:** The save switch defaults on and the frames opt-in defaults off; they are independent controls with independent wording, and neither implies the other's behavior. The notice names every real destination for the current settings: audio to whichever transcription provider the server actually reports, and to none before that is known (R-081 owns that clause in full); on the Gemini engine the answer transcript, posting details and prep context to Google, plus up to three still frames only when the frames switch is on; the video to the user's own account storage only when saving is on, private to them and deletable from the history. Nothing anywhere still claims the video never leaves the browser while saving is enabled. Both the frames opt-in and the save preference are re-read immediately before the corresponding request, so turning either off mid-flight prevents that upload — neither is latched at Done.

**Amended (group I):** the audio clause previously read "audio to Deepgram always". The pluggable-STT work retired that: the provider is a server-side choice and must be named only once known. R-057 had already been narrowed for the same reason but this case's own Expected was missed, leaving two cases in this document contradicting each other about the same sentence. Corrected here rather than deleted, since everything else this case pins is still live.

