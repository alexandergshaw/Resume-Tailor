// The one-line description under the copilot tab's title, per mode. Pure, no
// React: moved out of app/copilot/CopilotClient.js as a line-budget extraction
// (N145 Wave B needed headroom there for the Row 1 retry wiring), sibling to
// groundingNotice.js, captureNotices.js and identityProps.js, split out of that
// same file for the same reason. The wording is moved VERBATIM; the behaviour
// that pins it (the three mode descriptions, the privacy scoping of the "Speak
// as" line, the phone-while-live omission) is covered by
// CopilotClient.roles.test.js, CopilotClient.mobileStack.test.js and this
// module's own test.

// AC-Q10.4/AC-R1.11: the "Speak as" one-liner. BUG (privacy audit):
// embedded branch used to claim recording itself "runs on this server" —
// false, lib/copilot/stt/ streams audio to Deepgram/ElevenLabs on EVERY
// engine; only feedback generation is local, so the guarantee is scoped.
function roleModeDescription(isEmbedded, sttProviderName) {
  return isEmbedded
    ? "Answer a workplace situation out loud in a professional role’s register, then record yourself answering it and reveal a model answer for its cadence and vocabulary — the model answer is generated on this server with no AI provider, so nothing is sent to Google. Recording still sends your audio to a speech-to-text provider, and once you press Done, sends it here for feedback — see the notice above the recording controls for what is sent, and where."
    : `Answer a workplace situation out loud in a professional role’s register, then record yourself answering it and reveal a model answer for its cadence and vocabulary. Recording sends audio${sttProviderName ? ` to ${sttProviderName}` : ""} for transcription and, once you press Done, sends it for feedback to Google Gemini — see the notice above the recording controls for exactly what that sends. Revealing a model answer also sends the role and the situation text to Google.`;
}

// `undefined` (no description rendered) while a phone is mid-session: N144b, a
// phone live needs the screen for the answer, and the mode cannot change while
// live anyway. Otherwise the mode's own line.
export function copilotTabDescription({ mode, live, isMobile, isEmbedded, sttProviderName }) {
  if (live && isMobile) return undefined;
  if (mode === "roles") return roleModeDescription(isEmbedded, sttProviderName);
  if (mode === "practice") {
    // "nothing else is recorded or shared" was false: on the Gemini
    // engine, the answer transcript, posting details, and prep
    // context all go to Google for the critique. The detailed
    // notice below (PracticeClient) states exactly what leaves on
    // the current engine — this one-liner defers to it rather
    // than making its own (previously false) blanket claim.
    // F2: the STT destination is only named once it's actually
    // known (see the mount-time fetch in CopilotClient) — never guessed.
    return `Practice speaking out loud with your camera and mic — see the notice below for what's sent ${sttProviderName ? `to ${sttProviderName} or Gemini` : "to Gemini"}.`;
  }
  return "Live transcription, question detection, and suggested answers during interviews.";
}
