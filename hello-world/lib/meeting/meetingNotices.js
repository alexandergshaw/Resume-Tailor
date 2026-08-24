// User-facing copy for the meeting copilot's three standing privacy/consent
// notices. Pure text logic only — no DOM, no React, no network — mirroring
// how lib/copilot/groundingNotice.js was split out of app/copilot/
// CopilotClient.js for the interview copilot: keeping the sentences here
// lets app/meeting/MeetingTranscript.js and whatever session-setup surface
// eventually gates recording (out of scope for this file — see this
// module's own docblock in the brief) unit-test the exact wording without
// mounting a component, and it gives the notices ONE place to be corrected
// if a fact about where audio or insights actually go ever changes.
//
// Every string below is pinned as a literal oracle in
// meetingNotices.test.js, the same discipline groundingNotice.test.js
// applies to CopilotClient.js's privacy notices — a "tidy up the wording"
// edit that quietly weakens a consent or privacy claim turns the test file
// red instead of shipping silently.

// Duplicated from app/copilot/CopilotClient.js's STT_PROVIDER_NAMES rather
// than imported from it. CopilotClient.js is 846 lines, already pinned by
// four of its own test files, and has no public export for this map today —
// adding one means editing a file this brief explicitly puts off-limits for
// a two-entry object. A future third copy would be a real signal to hoist
// this into a shared lib/ module instead; a second copy today is not that
// signal, and copying is the smaller risk of the two available right now.
const STT_PROVIDER_NAMES = { deepgram: "Deepgram", elevenlabs: "ElevenLabs" };

export function meetingSttProviderName(provider) {
  return STT_PROVIDER_NAMES[provider] || null;
}

// AC (recording consent): mirrors the interview copilot's own source-aware
// recording notice (see app/copilot/SessionSetup.js's `showConsent` Alert,
// the `source === "inperson"` ternary) because the underlying capture
// reality is identical here — a meeting recorded on a single shared
// in-person microphone picks up EVERYONE in the room, not just the user,
// while a call's two audio streams are the user's own mic and the other
// side's, structurally separate. That difference is exactly what determines
// whether all-party consent law is even in play, so the copy has to name it
// rather than speak generically of "the conversation" for both cases alike.
//
// `providerName` is threaded through, not hard-coded, for the same reason
// CopilotClient.js's own notice waits for `sttProviderName` to resolve
// before naming one (see its `F2` comment): a provider is not knowable
// until the token route responds, and naming the wrong one — or a stale
// default — would be worse than the brief hedge of omitting the clause
// until it is known. `null`/`undefined`/`""` all fall through to that same
// "provider not yet known" hedge.
export function recordingConsentNotice(source, providerName) {
  const providerClause = providerName ? ` to ${providerName}` : "";
  if (source === "inperson") {
    return `Recording notice: this in-person conversation is recorded and streamed${providerClause} for transcription. Everyone in the room is being recorded, not just you, so get their consent before you start; some regions require all-party consent.`;
  }
  return `Recording notice: audio is streamed${providerClause} for transcription. Make sure everyone on the call consents before you start; some regions require all-party consent.`;
}

// AC (engine caveat): the load-bearing fact this function exists to state is
// that AUDIO LEAVES THE MACHINE ON EVERY ENGINE, embedded included.
// CopilotClient.js already learned this the hard way — its own comment
// records that the embedded branch "used to claim recording itself 'runs on
// this server' — false, lib/copilot/stt/ streams audio to Deepgram/
// ElevenLabs on EVERY engine; only feedback generation is local, so the
// guarantee is scoped" (see roleModeDescription there). The meeting copilot
// reuses the same speech-to-text layer, so the same fact is true here for
// the same reason, and this notice has to repeat it rather than let
// "embedded" sound like a privacy mode for the recording itself. Choosing
// the embedded engine only moves where INSIGHTS are generated (on this
// server, no AI provider) — the transcription step upstream of that is
// unaffected and still reaches Deepgram or ElevenLabs.
export function engineCaveatNotice(engine, providerName) {
  const providerClause = providerName ? ` to ${providerName}` : " to a speech-to-text provider";
  if (engine === "embedded") {
    return `Audio still leaves this machine${providerClause} for transcription on every engine, including this one — choosing the embedded engine only keeps insight generation local (it reads the transcript on this server with no AI provider); it does not make the transcription itself local.`;
  }
  return `Audio leaves this machine${providerClause} for transcription, and the transcript is sent to Google Gemini to generate insights.`;
}

// AC (speaker attribution): a single shared in-person microphone has no
// structural signal for who is talking — there is one audio stream, not
// two — which is exactly why lib/meeting/insightContract.js's
// `meetingSpeakerLabel` maps the "room" routing value to no label at all
// rather than a guessed one. A user staring at an unlabelled transcript line
// with no explanation reads that as a bug, not as an honest limit, so this
// notice exists to say plainly why: one microphone is recording everyone,
// so turns are not attributed to a specific speaker. A call's two streams
// (the user's own mic, the other side's audio) ARE structurally separate —
// that is what lets "You"/"Others" be assigned correctly in the first
// place — so there is nothing to caveat there, and this returns "" rather
// than manufacture an explanation for a limitation that does not exist on
// that path.
export function speakerAttributionNotice(source) {
  if (source === "inperson") {
    return "One microphone is recording everyone in the room, so turns below are not attributed to a specific speaker.";
  }
  return "";
}
