// Browser-side Deepgram streaming client — the Deepgram implementation of
// the speech-to-text provider contract documented in ./index.js.
//
// Flow: fetch a short-lived token from our own /api/copilot/token route, open a
// WebSocket straight to Deepgram's live listen endpoint (authenticated via the
// Sec-WebSocket-Protocol subprotocol, since browsers can't set Authorization
// headers on WebSockets), stream raw 16 kHz linear16 PCM, and surface interim +
// final transcripts through callbacks.
//
// AC-M1.2: Deepgram can additionally diarize — separate same-mic speakers by
// an integer `speaker` id carried on each entry of
// `channel.alternatives[0].words[]`. This is requested with `diarize_model=v1`
// (the older `diarize=true` boolean is documented deprecated — see the
// DIARIZE_PARAM comment below) and is strictly additive: everything in this
// file that ran before diarization existed still runs unchanged when
// `diarize` is not requested (R-076), and even when it IS requested, a
// Results frame whose `words[]` turns out unusable degrades to that same
// pre-diarization behaviour rather than to silence (AC-M1.2.7).

import { fetchSttToken } from "./token";

const LISTEN_URL = "wss://api.deepgram.com/v1/listen";

// linear16 @ 16 kHz mono is what the capture pipeline produces. encoding /
// sample_rate / channels are required for raw PCM. endpointing=300 makes
// Deepgram mark `speech_final` after ~300 ms of silence — our "question is
// finished, go answer it" signal in later phases.
//
// R-076: this object is the frozen, verified-correct baseline query string
// when diarization is off (or not requested at all) — do not reorder,
// reformat, or add to it. `deepgram.diarize.test.js` compares the built query
// string against a literal copy of it byte for byte. Diarization is layered
// on top, in connect() below, by appending a further query parameter — never
// by editing this object.
const DEFAULT_PARAMS = {
  model: "nova-3",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
  interim_results: "true",
  smart_format: "true",
  punctuate: "true",
  endpointing: "300",
};

// AC-M1.2.3: the current, non-deprecated way to request diarization on
// Deepgram's live endpoint. NOT `diarize=true` (deprecated) and not both —
// this is the only diarization parameter this module ever sends.
const DIARIZE_PARAM = "diarize_model=v1";

export class DeepgramStream {
  // AC-M1.1.2: declared statically so a caller (createSttStream in
  // ./index.js) can tell whether THIS provider is capable of diarization
  // without constructing an instance or inspecting its options.
  static supportsDiarization = true;

  // `token`, if provided, is an already-minted credential from a single
  // upstream fetch (see createSttStream in ./index.js) — connect() below
  // uses it as-is instead of fetching its own. Omitted when constructed
  // directly (as lib/copilot/stt/deepgram.test.js does), in which case
  // connect() fetches its own token itself, exactly as before this option
  // existed.
  //
  // `diarize` (AC-M1.2.1) defaults to false, exactly like every option this
  // class had before this feature — a constructor call that never mentions
  // it (every call site before this change, and deepgram.test.js) behaves
  // exactly as before.
  constructor({ speaker = "them", onTranscript, onStatus, onError, token, diarize = false } = {}) {
    this.speaker = speaker;
    this.onTranscript = onTranscript || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this._closing = false;
    this._token = token;
    this._diarize = !!diarize;
  }

  async connect() {
    let token = this._token;
    if (!token) {
      const body = await fetchSttToken();
      token = body.token;
      if (!token) throw new Error("Token route returned no token.");
    }
    // R-076: DEFAULT_PARAMS itself is never touched. When diarization is
    // requested, `diarize_model=v1` is appended to the already-built string
    // — the diarize-off case above stays byte-identical to HEAD because this
    // append simply does not happen.
    let qs = new URLSearchParams(DEFAULT_PARAMS).toString();
    if (this._diarize) qs += `&${DIARIZE_PARAM}`;
    const ws = new WebSocket(`${LISTEN_URL}?${qs}`, ["token", token]);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.onStatus("connecting");

    ws.addEventListener("close", () => {
      if (!this._closing) this.onStatus("closed");
    });

    ws.addEventListener("message", (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      // Ignore Metadata / UtteranceEnd / SpeechStarted frames — we only care
      // about transcript Results here.
      if (msg.type && msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];

      // AC-M1.2.4/.7: diarization changes where the frame's TEXT comes from.
      // Only attempt the words[]-based split when diarization was actually
      // requested — a non-diarized connection must never even inspect
      // `words`, so a frame that happens to carry per-word `speaker` ids
      // (real Deepgram responses can) still produces exactly today's single,
      // whole-frame call with no `speakerTag` key at all.
      if (this._diarize) {
        const words = Array.isArray(alt?.words) ? alt.words : [];
        const hasDiarizedWords = words.some((w) => typeof w?.speaker === "number");
        if (hasDiarizedWords) {
          this._emitDiarizedRuns(msg, words);
          return;
        }
        // Falls through to the whole-frame path below: missing/empty words,
        // or a words array with no numeric `speaker` on any entry, is a
        // provider hiccup, not a reason to go silent (AC-M1.2.7).
      }

      const transcript = alt?.transcript?.trim();
      if (!transcript) return;
      this.onTranscript({
        speaker: this.speaker,
        transcript,
        isFinal: !!msg.is_final,
        speechFinal: !!msg.speech_final,
        // Purely additive: `start` and `duration` are the audio-time offset
        // (seconds since this connection's first audio) and length of the
        // window this Results frame covers — present on every frame,
        // interim or final. Existing consumers (the live copilot session,
        // and practice mode before this change) destructure only the
        // fields above and simply ignore these, so forwarding them changes
        // nothing for them. Practice mode's answer collector uses them to
        // bound an answer by when the words were actually SPOKEN rather
        // than by when this event happened to arrive — see
        // PracticeClient.js.
        start: typeof msg.start === "number" ? msg.start : undefined,
        duration: typeof msg.duration === "number" ? msg.duration : undefined,
        // No `speakerTag` key here at all — see the AC-M1.1.6 comment on
        // _emitDiarizedRuns below for why `speakerTag: undefined` would be
        // the wrong fix and would still pass toHaveBeenCalledWith-style
        // assertions while quietly changing this object's shape.
      });
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
        () => reject(new Error("Could not connect to Deepgram.")),
        { once: true },
      );
    });
  }

  // AC-M1.2.5/.6: splits one diarized Results frame into one onTranscript
  // call per contiguous run of same-speaker words, in word order. Only
  // called once the caller (the "message" listener above) has already
  // confirmed `words` has at least one entry carrying a numeric `speaker` —
  // this method does not itself decide whether to fall back.
  _emitDiarizedRuns(msg, words) {
    // Group into contiguous runs by speaker identity. A shared mic produces
    // words in speaking order, so a speaker change in the array IS a turn
    // change — no sorting or bucketing by id, just consecutive equal
    // `speaker` values.
    const runs = [];
    for (const w of words) {
      const current = runs[runs.length - 1];
      if (current && current.speaker === w.speaker) {
        current.words.push(w);
      } else {
        runs.push({ speaker: w.speaker, words: [w] });
      }
    }

    // AC-M1.2.6: a run whose joined text is empty or whitespace-only is
    // skipped entirely — it must not produce a call, blank or otherwise.
    // Built (not filtered-in-place) so the loop below can find "the last run
    // actually emitted" by index into THIS array, not into `runs`.
    const built = runs
      .map((run) => ({
        speaker: run.speaker,
        words: run.words,
        // Prefer punctuated_word (carries case/punctuation smart_format
        // adds) over the bare word, per entry — then join and trim once for
        // the whole run, exactly like the non-diarized path trims
        // alt.transcript.
        text: run.words
          .map((w) => (w.punctuated_word !== undefined ? w.punctuated_word : w.word))
          .join(" ")
          .trim(),
      }))
      .filter((run) => run.text !== "");

    // AC-M1.2.6: if every run in the frame was blank, the frame produces
    // nothing at all — not even the frame's speech_final, which has nowhere
    // left to land.
    if (built.length === 0) return;

    const isFinal = !!msg.is_final;
    const speechFinal = !!msg.speech_final;
    const lastIndex = built.length - 1;

    built.forEach((run, i) => {
      const first = run.words[0];
      const last = run.words[run.words.length - 1];
      // AC-M1.2.5: start/duration are numbers ONLY when the underlying word
      // timings are themselves numbers — never a fabricated 0 (R-078's own
      // lesson, paid for once already on the ElevenLabs path; see
      // deriveSpan in ./elevenlabs.js for the sibling of this logic).
      const hasSpan = typeof first?.start === "number" && typeof last?.end === "number";
      this.onTranscript({
        speaker: this.speaker,
        transcript: run.text,
        isFinal,
        // AC-M1.2.5: speech_final lands on the LAST RUN ACTUALLY EMITTED
        // only — everything earlier gets false, whether or not a blank run
        // was skipped after it (AC-M1.2.6 moves it forward in that case,
        // which "last emitted" already captures for free).
        speechFinal: i === lastIndex ? speechFinal : false,
        start: hasSpan ? first.start : undefined,
        duration: hasSpan ? last.end - first.start : undefined,
        // AC-M1.1.6: always present here (this method only runs once the
        // caller has confirmed `words` carries usable speaker ids) — unlike
        // the whole-frame path, which never sets this key at all.
        speakerTag: run.speaker,
      });
    });
  }

  send(arrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(arrayBuffer);
    }
  }

  close() {
    this._closing = true;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          // Ask Deepgram to flush pending audio and close gracefully.
          this.ws.send(JSON.stringify({ type: "CloseStream" }));
        }
        this.ws.close();
      } catch {
        // ignore — best effort teardown
      }
      this.ws = null;
    }
    this.onStatus("closed");
  }
}
