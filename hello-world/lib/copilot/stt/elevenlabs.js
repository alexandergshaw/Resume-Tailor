// Browser-side ElevenLabs Scribe v2 Realtime streaming client — the
// ElevenLabs implementation of the speech-to-text provider contract
// documented in ./index.js. See that file's header comment for the
// interface every provider (this one and ./deepgram.js) must satisfy.
//
// PROVENANCE: this module was written against ElevenLabs' published
// documentation —
//   https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
//   https://elevenlabs.io/docs/api-reference/tokens/create
// — not verified against the live service, because there is no ElevenLabs
// API key in the environment this was built in. Every field name, message
// shape, and default below is traceable to those two pages, not to an
// observed wire capture. If a real session connects and opens but never
// produces a transcript, treat that as a sign this file's assumptions may
// be stale against the live protocol, not as proof the code is correct —
// see AC-F2-4 in the feature spec this shipped under: unrecognized
// message_type values are surfaced loudly (below) for exactly this reason.
//
// Flow: fetch a short-lived, single-use token from our own
// /api/copilot/token route (see app/api/copilot/token/route.js), open a
// WebSocket straight to ElevenLabs' realtime Scribe endpoint (authenticated
// via a `token` query parameter — unlike Deepgram, which uses a
// Sec-WebSocket-Protocol subprotocol, ElevenLabs takes it directly in the
// URL), stream raw 16 kHz mono PCM16 as base64 text inside JSON messages
// (ElevenLabs' realtime protocol has no binary-frame path — this is the
// biggest structural difference from Deepgram), and surface
// interim/final/committed transcripts through the same
// onTranscript/onStatus/onError callbacks DeepgramStream does.

import { fetchSttToken } from "./token";

const REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

// The only model this class speaks to — not user-selectable.
const MODEL_ID = "scribe_v2_realtime";

// Raw 16 kHz mono PCM16 is what PcmPipeline (lib/copilot/capture.js) always
// produces, and also happens to be ElevenLabs' documented default — but
// it's sent explicitly rather than relied on, so a change to that default
// upstream can never silently change what this socket expects to receive.
const AUDIO_FORMAT = "pcm_16000";
// Hz value carried on every input_audio_chunk message's `sample_rate`
// field (see send() below) — must stay in lockstep with AUDIO_FORMAT above.
const SAMPLE_RATE_HZ = 16000;

// "vad" (rather than "manual") means ElevenLabs itself decides utterance
// boundaries from voice-activity detection and announces them by sending a
// committed_transcript(_with_timestamps) message — see the long comment on
// the committed_transcript case in _handleMessage below for why that commit
// is what this module treats as speechFinal:true.
const COMMIT_STRATEGY = "vad";

// Requests word-level start/end timestamps on the *_with_timestamps
// messages. Without this, `words` is absent entirely and every frame's
// start/duration below would have to be undefined for lack of data — so
// this is not optional given this module's contract obligations.
const INCLUDE_TIMESTAMPS = true;

// JUDGEMENT CALL: ElevenLabs' documented query parameters also include
// vad_threshold, vad_silence_threshold_secs, min_speech_duration_ms and
// min_silence_duration_ms, all without documented defaults. The feature
// spec this module was built against only mandates the five parameters
// above; rather than invent numbers for the VAD tuning knobs with no
// documented default to anchor them to, this module omits them and lets
// ElevenLabs apply whatever its own service-side defaults are. If those
// defaults turn out to make VAD commits too eager or too sluggish for
// practice/live mode's question-detection timing, that is the first place
// to look — add named constants for these here rather than passing magic
// numbers.

// Message types that carry an error rather than a transcript. ElevenLabs
// documents several distinct error `message_type` values rather than one
// generic "error" — all of them carry a human-readable `error` string and
// none of them end the session on their own from the server's side, so all
// are routed to onError the same way instead of being treated as unknown
// message types (which would additionally trip the loud one-time report in
// _handleMessage's default branch).
const ERROR_MESSAGE_TYPES = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "input_error",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
  "transcriber_error",
]);

// Chunk size for the base64 loop below: large enough that a ~4 KB PCM16
// chunk (16 kHz * 16-bit mono / 8 chunks-per-second, the cadence
// PcmPipeline actually runs at) needs only a single iteration, small enough
// to stay well under engines' call-argument limits for
// String.fromCharCode.apply on this ~8x/second hot path. `bytes.subarray`
// is a view, not a copy, so this allocates one intermediate string per 32 KB
// of audio rather than one per byte or one giant argument list per chunk.
const BASE64_CHUNK_SIZE = 0x8000;

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

// `words` entries carry `type: "word" | "spacing" | "audio_event"` —
// spacing and audio-event entries are not speech and must not shift the
// span. Per AC-F2-3: `start` is the first word-type entry's `start`,
// `duration` is the last word-type entry's `end` minus that `start`.
// Non-numeric or missing fields (or no `words` at all, which is the case
// for every message type except the two *_with_timestamps ones) yield
// `undefined` for both — never a guessed 0, since answerWindow.js and
// usePracticeAnswer.js treat undefined as "no timing" but would silently
// mis-measure every downstream metric against a fabricated zero.
function deriveSpan(words) {
  const spoken = Array.isArray(words) ? words.filter((w) => w?.type === "word") : [];
  if (spoken.length === 0) return { start: undefined, duration: undefined };
  const first = spoken[0];
  const last = spoken[spoken.length - 1];
  if (typeof first.start !== "number" || typeof last.end !== "number") {
    return { start: undefined, duration: undefined };
  }
  return { start: first.start, duration: last.end - first.start };
}

export class ElevenLabsStream {
  // AC-M1.2.8: Scribe v2 Realtime is batch-only for diarization — the
  // realtime protocol this module speaks has no diarization parameter and no
  // per-word speaker field to read one from (see the module header above).
  // Declared statically, mirroring DeepgramStream.supportsDiarization, so a
  // caller (createSttStream in ./index.js) can tell the two providers apart
  // without constructing either one. This is the ONLY change this class
  // makes for AC-M1.2 — R-077 and R-078's assertions below must still pass
  // unchanged.
  static supportsDiarization = false;

  // `token`, if provided, is an already-minted, single-use credential from
  // one upstream fetch (see createSttStream in ./index.js) — connect()
  // below uses it as-is instead of minting its own. This matters more here
  // than for Deepgram: ElevenLabs' token is consumed on first use, so a
  // second, redundant mint would be a real, wasted credential rather than
  // just an extra request. Omitted when constructed directly, in which case
  // connect() mints its own token itself.
  constructor({ speaker = "them", onTranscript, onStatus, onError, token } = {}) {
    this.speaker = speaker;
    this.onTranscript = onTranscript || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this._closing = false;
    this._closed = false;
    this._token = token;
    // AC-F2-4: an unrecognized message_type must be reported through
    // onError exactly once per session, not once per message — a chatty
    // socket sending the same unknown type repeatedly must not flood the
    // caller with duplicate errors.
    this._reportedUnknownType = false;
    // R-127 fix: the last isFinal:true frame's { text, start, duration }
    // this instance delivered. ElevenLabs' commit_strategy=vad means a
    // committed_transcript(_with_timestamps) is sent for an utterance
    // ElevenLabs has ALREADY sent as a final_transcript(_with_timestamps)
    // moments earlier — same text, same span — purely to carry
    // speechFinal:true (see the committed_transcript case in
    // _handleMessage below). Every consumer of onTranscript that appends
    // TEXT on isFinal was therefore counting that one utterance's words
    // twice: a 5-entry answer transcript rendered as A, A, B, B, C, and
    // reported word count / filler count / words-per-minute were all
    // roughly double the true value. This retains just enough to recognise
    // an exact re-delivery of the same span, one utterance at a time — see
    // _emitTranscript.
    this._lastFinal = null;
  }

  async connect() {
    let token = this._token;
    if (!token) {
      const body = await fetchSttToken();
      token = body.token;
      if (!token) throw new Error("Token route returned no token.");
    }
    const qs = new URLSearchParams({
      model_id: MODEL_ID,
      audio_format: AUDIO_FORMAT,
      commit_strategy: COMMIT_STRATEGY,
      include_timestamps: String(INCLUDE_TIMESTAMPS),
      token,
    }).toString();
    const ws = new WebSocket(`${REALTIME_URL}?${qs}`);
    this.ws = ws;
    this.onStatus("connecting");

    ws.addEventListener("close", () => {
      // `_closing` is only set by our own close() below. Anything else —
      // network drop, idle timeout, sleep/resume, the server hanging up —
      // is an ABNORMAL close, and AC-F2-4 requires that to surface through
      // onError, not just as a silent-looking onStatus("closed") that reads
      // exactly like a deliberate, successful teardown.
      if (this._closing) return;
      this.onError(new Error("ElevenLabs realtime connection closed unexpectedly."));
      this.onStatus("closed");
    });

    ws.addEventListener("message", (evt) => {
      // Guards against a message that was already in flight landing after
      // our own close() ran — close() promises no further callbacks once
      // it's been called (see ./index.js's contract comment).
      if (this._closing) return;
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      this._handleMessage(msg);
    });

    // Resolve once the socket is actually open (or reject if it errors first).
    await new Promise((resolve, reject) => {
      ws.addEventListener(
        "open",
        () => {
          this.onStatus("open");
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        () => reject(new Error("Could not connect to ElevenLabs.")),
        { once: true },
      );
    });
  }

  _handleMessage(msg) {
    const type = msg?.message_type;

    if (ERROR_MESSAGE_TYPES.has(type)) {
      // Not necessarily fatal — see ./index.js's contract comment on
      // onError — so the session keeps running; the caller decides what to
      // do with it.
      this.onError(
        new Error(`ElevenLabs reported ${type}: ${msg?.error || "no further detail given."}`),
      );
      return;
    }

    switch (type) {
      case "session_started":
      case "committed_transcript_entities":
        // Known message types this module deliberately does not forward:
        // session_started is connection metadata, not a transcript
        // (AC-F2-3); committed_transcript_entities annotates a transcript
        // already emitted via committed_transcript(_with_timestamps) rather
        // than carrying new transcript text of its own.
        return;
      case "partial_transcript":
        this._emitTranscript(msg, { isFinal: false, speechFinal: false });
        return;
      case "final_transcript":
      case "final_transcript_with_timestamps":
        // A final_transcript locks in ONE frame's text — it says nothing
        // about whether the speaker is done talking, so speechFinal stays
        // false here.
        this._emitTranscript(msg, { isFinal: true, speechFinal: false });
        return;
      case "committed_transcript":
      case "committed_transcript_with_timestamps":
        // THE mapping this provider exists to get right: with
        // commit_strategy=vad (see the constant above), ElevenLabs commits
        // an utterance on its own initiative once its VAD decides the
        // speaker has stopped. That commit IS the end-of-utterance signal —
        // there is no separate "utterance ended" message the way Deepgram
        // has speech_final on a Results frame — so committed_transcript(_
        // with_timestamps) maps to speechFinal:true. This is what
        // CopilotClient's question-detection logic (and session.js) key off
        // of; get this mapping wrong and live mode still transcribes but
        // never detects a finished question.
        this._emitTranscript(msg, { isFinal: true, speechFinal: true });
        return;
      default:
        // AC-F2-4: this module is unverified against the live service, so a
        // message_type outside everything documented above must be reported
        // loudly rather than silently dropped — a session that connects and
        // transcribes nothing because the wire format drifted must not look
        // like a quiet, healthy one.
        if (!this._reportedUnknownType) {
          this._reportedUnknownType = true;
          this.onError(
            new Error(
              `ElevenLabs sent an unrecognized message_type "${type}" — this module was ` +
                "written against ElevenLabs' documented protocol and has not been verified " +
                "against the live service, so the wire format may have changed.",
            ),
          );
        }
    }
  }

  _emitTranscript(msg, { isFinal, speechFinal }) {
    const transcript = typeof msg?.text === "string" ? msg.text.trim() : "";
    // Empty or whitespace-only text is skipped, exactly as the Deepgram
    // path skips an empty/whitespace-only transcript (AC-F2-3).
    if (!transcript) return;
    const { start, duration } = deriveSpan(msg?.words);

    // R-127 fix: does this final exactly re-deliver the span this instance
    // JUST delivered? Only a NUMERIC start/duration can prove that — a
    // message with no words array (or none of its entries numeric;
    // deriveSpan above) yields `undefined` for both, and
    // `undefined === undefined` proves nothing about whether this is a
    // re-delivery of the last utterance or a second, genuinely untimed one.
    // Treated the same way isFinalInAnswerWindow (lib/copilot/answerWindow.js)
    // treats an unknown `start` elsewhere in this codebase: unproven, so it
    // does NOT dedupe — the safer failure here is a rare residual
    // double-count for an untimed frame, never silently swallowing real
    // speech. A genuinely repeated phrase has a different `start`, so real
    // repeated speech can never be swallowed by this check.
    const last = this._lastFinal;
    const textAlreadyDelivered =
      isFinal &&
      !!last &&
      last.text === transcript &&
      typeof last.start === "number" &&
      typeof start === "number" &&
      last.start === start &&
      typeof last.duration === "number" &&
      typeof duration === "number" &&
      last.duration === duration;

    if (isFinal) this._lastFinal = { text: transcript, start, duration };

    const frame = { speaker: this.speaker, transcript, isFinal, speechFinal, start, duration };
    // Contract (see ./index.js's onTranscript doc): absent/falsy means
    // "append" — the key is only ever set when true, so Deepgram's frames
    // (and every ElevenLabs frame that isn't a re-delivery) are byte-
    // identical to before this flag existed.
    if (textAlreadyDelivered) frame.textAlreadyDelivered = true;
    this.onTranscript(frame);
  }

  send(arrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Audio is base64 inside a JSON text message here, not a binary frame —
    // the conversion lives entirely in this method so no caller has to know
    // which provider (or wire format) is active (./index.js's contract).
    // `commit` is a documented REQUIRED field on input_audio_chunk (the
    // feature spec's own protocol summary called it optional, but that
    // summary was a derived artefact — the fetched documentation is the
    // authority and lists it as required, so it is sent explicitly on every
    // chunk). `false` is the semantically correct constant, not just a
    // placeholder: under commit_strategy=vad (see the constant above)
    // ElevenLabs' own VAD decides utterance boundaries, so the client never
    // forces one — do not "fix" this to `true`, which would commit on every
    // ~128 ms chunk instead. `previous_text` is omitted; this class has no
    // prior transcript context to seed a session with.
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: arrayBufferToBase64(arrayBuffer),
        sample_rate: SAMPLE_RATE_HZ,
        commit: false,
      }),
    );
  }

  close() {
    // Idempotent: a second call (or a call before connect() ever resolved)
    // must not throw and must not emit any further callback — see
    // ./index.js's contract comment. `_closed` guards THIS method being
    // called more than once; `_closing` (set alongside it) also silences
    // the WebSocket's own async "close"/"message" listeners above so a
    // deliberate close can't turn into a second, unsolicited-looking error.
    if (this._closed) return;
    this._closed = true;
    this._closing = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore — best effort teardown
      }
      this.ws = null;
    }
    this.onStatus("closed");
  }
}
