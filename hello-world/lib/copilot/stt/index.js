// Speech-to-text provider abstraction for the interview copilot.
//
// The copilot needs a live transcription socket: raw 16 kHz mono PCM16 audio
// goes in, interim/final transcripts with timing come back out. Deepgram
// (./deepgram.js) and ElevenLabs Scribe v2 Realtime (./elevenlabs.js) are
// this app's two providers today, chosen server-side by STT_PROVIDER (see
// lib/config/env.js and "Provider selection" below). Both
// `lib/copilot/session.js` (live interview) and
// `lib/copilot/practiceSession.js` (practice mode) are written against this
// contract — not against a specific provider's implementation — so adding a
// provider is additive rather than a rewrite of either consumer.
//
// ## The provider interface
//
// Every provider is a class constructed with
// `{ speaker, onTranscript, onStatus, onError, token }` and exposes:
//
//   connect()
//     Async. Opens the connection. If a `token` was handed to the
//     constructor, connect() uses it as-is; otherwise it mints its own
//     short-lived credential along the way (see ./token.js) — see
//     "Provider selection" below for why this matters beyond avoiding a
//     redundant request. Resolves once the socket is actually open and
//     ready to accept audio; rejects if the connection could not be
//     established.
//
//   send(arrayBuffer)
//     Streams one chunk of audio. Always called with a 16 kHz mono PCM16
//     `ArrayBuffer` — that's exactly what `lib/copilot/capture.js`'s
//     PcmPipeline produces, and every provider receives exactly that
//     regardless of what wire format its own backend actually wants. A
//     provider whose backend needs a different format converts internally;
//     callers never branch on which provider is in use.
//
//   close()
//     Tears the connection down. Idempotent: calling it more than once, or
//     before connect() ever resolved, must not throw and must not emit any
//     further onStatus/onError/onTranscript callback. Consumers rely on
//     this — both CopilotSession and PracticeSession call close() during
//     their own stop() and must not see a stale callback land afterward.
//
// ## The callbacks
//
//   onStatus(status)
//     `status` is exactly one of "connecting" | "open" | "closed" — do not
//     invent a new value. CopilotSession.aggregateStatus() and
//     PracticeSession's own status mapping translate these into the UI's
//     vocabulary; a value outside this set breaks both of them silently.
//
//   onError(error)
//     `error` is an Error. Not necessarily fatal to the connection — see
//     each consumer for how it reacts (PracticeSession, for example,
//     reports onStatus("error") but leaves the session running).
//
//   onTranscript({ speaker, transcript, isFinal, speechFinal, start, duration })
//     - `speaker` is whatever the caller passed as `speaker` at
//       construction, echoed back unchanged — lets a consumer juggling
//       multiple sources (CopilotSession has one per audio source) tell
//       them apart.
//     - `transcript` is the trimmed text for this frame, interim or final.
//     - `isFinal` is true once this frame's text is locked (a later interim
//       will not revise the same span).
//     - `speechFinal` means the SPEAKER finished an utterance (end of
//       turn) — not merely that this one frame is final. This is the exact
//       signal `session.js` and `app/copilot/CopilotClient.js` use to
//       trigger question detection, and it fires once per utterance, not
//       once per final frame. A provider that has no equivalent native
//       signal must still decide when an utterance ended and set this
//       accordingly — consumers do not fall back to isFinal for this.
//     - `start` / `duration` are seconds relative to the start of the
//       stream (audio-clock time, not wall-clock arrival time), or
//       `undefined` when the provider did not supply timing for this
//       frame. `lib/copilot/answerWindow.js` and
//       `app/copilot/practice/usePracticeAnswer.js` use these to decide
//       which words belong to an answer — getting the units or the
//       reference point wrong here silently corrupts every delivery number
//       practice mode reports, without ever throwing.
//     - `textAlreadyDelivered` (R-127): true when this frame's `transcript`
//       is an EXACT re-delivery — same text, same `start`, same `duration`
//       — of a `transcript` this same instance already delivered on an
//       earlier isFinal:true frame. ElevenLabs' commit_strategy=vad sends a
//       committed_transcript(_with_timestamps) for an utterance it already
//       sent as a final_transcript(_with_timestamps) moments earlier, purely
//       to carry `speechFinal: true` — the frame still has to be delivered
//       (consumers need that `speechFinal`), but a consumer that ACCUMULATES
//       transcript text (a running word count, a session transcript, an
//       assembled question) must not append this frame's text a second
//       time, or it silently doubles word count, filler count, and
//       words-per-minute. Absent/falsy — NEVER explicitly `false` — on
//       every other frame, so a consumer that has never heard of this field
//       (Deepgram's frames, and any test written before it existed) sees a
//       byte-identical object to before it existed. Deepgram never sets
//       this: its `speech_final` rides on the SAME message as `is_final`
//       (see deepgram.js), so it has no separate "commit" message to
//       re-deliver a span from in the first place.
//
// ## Provider selection
//
// createSttStream({ provider, speaker, onTranscript, onStatus, onError })
// resolves to an instance of the selected provider, not yet connected — the
// caller still calls connect() on it itself, exactly as it would after
// constructing a provider directly. Selection is a plain lookup by provider
// name, the same shape as THEM_CAPTURE_BY_SOURCE in session.js: an
// unrecognized or omitted name falls back to Deepgram rather than throwing,
// so a bad or missing value degrades to today's behavior instead of
// breaking the session.
//
// `provider` is normally left for createSttStream to determine itself: it
// fetches the token (./token.js), reads the `provider` field the server
// included in that response (see app/api/copilot/token/route.js), and uses
// that for the lookup above — the server decides which provider is live,
// not a client-side env var. Passing `provider` explicitly overrides the
// lookup but does not skip the fetch (see below); no current caller passes
// it.
//
// createSttStream fetches exactly ONE token per call and threads it — along
// with whichever provider ends up selected — into the constructed
// instance's `token` option, so connect() has no need to mint a second one.
// That is not just avoiding waste: a provider whose token is single-use
// (consumed on first use, as ElevenLabs Scribe v2 Realtime's is) would have
// a real, minted-and-abandoned credential to account for if selection and
// connection each fetched their own. If the fetch itself fails, selection
// still falls back to Deepgram and the constructed instance simply gets no
// token — its own connect() will then attempt (and fail) its own fetch,
// which is where the real error belongs, not in createSttStream.
//
// A provider built directly (`new DeepgramStream({...})`, bypassing
// createSttStream — this is what lib/copilot/stt/deepgram.test.js does) has
// no upstream fetch to reuse and simply fetches its own token inside
// connect(), unchanged from before this module existed.

import { DeepgramStream } from "./deepgram";
import { ElevenLabsStream } from "./elevenlabs";
import { fetchSttToken } from "./token";

const PROVIDERS = {
  deepgram: DeepgramStream,
  elevenlabs: ElevenLabsStream,
};

export async function createSttStream({
  provider,
  speaker,
  onTranscript,
  onStatus,
  onError,
} = {}) {
  let selected = provider;
  let token;
  try {
    const body = await fetchSttToken();
    token = body?.token;
    if (!selected) selected = body?.provider;
  } catch {
    // Couldn't fetch a token at all — fall through with no token and let
    // the default provider's own connect() attempt (and fail) its own
    // fetch, so the real error surfaces there instead of this function
    // throwing a confusing "provider selection failed" error before the
    // caller even has a stream to call connect() on.
  }
  const ProviderClass = PROVIDERS[selected] || DeepgramStream;
  return new ProviderClass({ speaker, onTranscript, onStatus, onError, token });
}
