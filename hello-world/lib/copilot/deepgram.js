// Browser-side Deepgram streaming client.
//
// Flow: fetch a short-lived token from our own /api/copilot/token route, open a
// WebSocket straight to Deepgram's live listen endpoint (authenticated via the
// Sec-WebSocket-Protocol subprotocol, since browsers can't set Authorization
// headers on WebSockets), stream raw 16 kHz linear16 PCM, and surface interim +
// final transcripts through callbacks.

const LISTEN_URL = "wss://api.deepgram.com/v1/listen";

// linear16 @ 16 kHz mono is what the capture pipeline produces. encoding /
// sample_rate / channels are required for raw PCM. endpointing=300 makes
// Deepgram mark `speech_final` after ~300 ms of silence — our "question is
// finished, go answer it" signal in later phases.
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

export async function fetchDeepgramToken() {
  const res = await fetch("/api/copilot/token", { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Token request failed (${res.status}).`);
  }
  if (!json.token) throw new Error("Token route returned no token.");
  return json.token;
}

export class DeepgramStream {
  constructor({ speaker = "them", onTranscript, onStatus, onError } = {}) {
    this.speaker = speaker;
    this.onTranscript = onTranscript || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this._closing = false;
  }

  async connect() {
    const token = await fetchDeepgramToken();
    const qs = new URLSearchParams(DEFAULT_PARAMS).toString();
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
