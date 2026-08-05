// Orchestrates a full copilot capture session across one or two audio sources:
//   - "them": the interviewer, from either the shared browser tab or shared
//     system audio (whichever `source` selects) — required
//   - "you":  your own voice, from the microphone (optional)
//
// Each source gets its own PcmPipeline + Deepgram stream, which gives clean
// speaker separation for free (no diarization needed). Transcript events from
// both are funneled through a single onTranscript callback tagged with the
// speaker, and a single aggregated status is reported to the UI.

import { captureTabAudio, captureSystemAudio, captureMicAudio, PcmPipeline } from "./capture";
import { createSttStream } from "./stt";

// Maps the `source` option to the capture function used for "them". Anything
// not in this map (including an omitted or garbage value) resolves to the
// tab path below, so an unrecognized choice degrades to today's behavior
// instead of throwing.
const THEM_CAPTURE_BY_SOURCE = {
  tab: captureTabAudio,
  system: captureSystemAudio,
};

export class CopilotSession {
  constructor({ withMic = true, source = "tab", onTranscript, onStatus, onError } = {}) {
    this.withMic = withMic;
    this.captureThem = THEM_CAPTURE_BY_SOURCE[source] || captureTabAudio;
    this.onTranscript = onTranscript || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this._sources = []; // { key, stream, pipeline, dg }
    this._statuses = {}; // key -> connecting | open | closed | error
    this._stopped = false;
  }

  _setStatus(key, s) {
    this._statuses[key] = s;
    this.onStatus(this.aggregateStatus());
  }

  // Collapse per-source socket states into one status for the UI.
  aggregateStatus() {
    const vals = Object.values(this._statuses);
    if (vals.length === 0) return "idle";
    if (vals.some((v) => v === "error")) return "error";
    if (vals.every((v) => v === "closed")) return "idle";
    if (vals.some((v) => v === "open")) return "live";
    return "connecting";
  }

  async _addSource({ key, speaker, stream }) {
    const dg = await createSttStream({
      speaker,
      onStatus: (s) => this._setStatus(key, s),
      onError: (err) => {
        this.onError(err);
        this._setStatus(key, "error");
      },
      onTranscript: (t) => this.onTranscript(t),
    });
    await dg.connect();

    const pipeline = new PcmPipeline();
    await pipeline.start(stream, (chunk) => dg.send(chunk));

    // Native "Stop sharing" button or an unplugged mic ends the track — tear the
    // whole session down so the UI returns to idle.
    stream.getAudioTracks()[0]?.addEventListener("ended", () => this.stop());

    this._sources.push({ key, stream, pipeline, dg });
  }

  async start() {
    this._stopped = false;
    // Interviewer audio (tab or system, per `source`) is required. Capture it
    // first so its picker shows before we prompt for the mic.
    const themStream = await this.captureThem();
    if (this._stopped) {
      themStream.getTracks().forEach((t) => t.stop());
      return;
    }
    await this._addSource({ key: "them", speaker: "them", stream: themStream });

    if (this.withMic) {
      try {
        const micStream = await captureMicAudio();
        if (this._stopped) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        await this._addSource({ key: "you", speaker: "you", stream: micStream });
      } catch (err) {
        // The mic is optional — keep the tab transcript running and surface a
        // soft warning rather than failing the whole session.
        this.onError(
          new Error(
            `Microphone unavailable (${err?.message || "denied"}). Continuing with interviewer audio only.`,
          ),
        );
      }
    }
  }

  async stop() {
    this._stopped = true;
    for (const src of this._sources) {
      try {
        src.dg.close();
      } catch {
        // ignore
      }
      try {
        await src.pipeline.stop();
      } catch {
        // ignore
      }
      try {
        src.stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    }
    this._sources = [];
    this._statuses = {};
    this.onStatus("idle");
  }
}
