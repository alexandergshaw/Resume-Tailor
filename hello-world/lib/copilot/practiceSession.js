// Orchestrates a practice-mode capture session: your camera (optional) plus
// your own voice, transcribed the same way the live session transcribes your
// mic ("you" speaker). There is only ever one source here — no interviewer
// audio — so unlike CopilotSession there's no per-source status map to
// aggregate; the single Deepgram socket's status is reported directly,
// translated into the vocabulary the UI already renders.

import { captureCameraAndMic, captureMicAudio, PcmPipeline } from "./capture";
import { createSttStream } from "./stt";

// DeepgramStream's own status values ("connecting" | "open" | "closed") ->
// the vocabulary CopilotSession.aggregateStatus already collapses "them"/
// "you" sources into for the UI ("connecting" | "live" | "idle"). "closed"
// is handled specially in the onStatus handler below (see stop()/BUG-2), not
// through this map. "error" is reported directly by the onError handler
// below, not by DeepgramStream itself, so it isn't a key here either.
const DG_STATUS_TO_UI_STATUS = {
  connecting: "connecting",
  open: "live",
};

export class PracticeSession {
  constructor({ withVideo = true, onTranscript, onStatus, onError, onStream } = {}) {
    this.withVideo = withVideo;
    this.onTranscript = onTranscript || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.onStream = onStream || (() => {});
    this.stream = null;
    this.hasVideo = false;
    this._pipeline = null;
    this._dg = null;
    this._stopped = false;
  }

  async start() {
    this._stopped = false;

    // getUserMedia is atomic: a combined video+audio request rejects as a
    // whole even when only the microphone was the problem. Don't blame the
    // camera yet — hold the original error, try mic-only, and only report
    // "Camera unavailable" once that fallback actually succeeds. If it also
    // fails, the ORIGINAL (combined-request) error is the accurate one to
    // surface, not the fallback's.
    let stream;
    let cameraFailure = null;
    if (this.withVideo) {
      try {
        stream = await captureCameraAndMic();
      } catch (err) {
        if (this._stopped) return;
        cameraFailure = err;
        try {
          stream = await captureMicAudio();
        } catch {
          throw cameraFailure;
        }
      }
    } else {
      stream = await captureMicAudio();
    }

    // A stop() that arrived while a capture prompt was up must not leave a
    // granted stream running or go on to open a socket.
    if (this._stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.stream = stream;
    this.hasVideo = stream.getVideoTracks().length > 0;
    // Publish the stream the moment capture succeeds, well before the
    // Deepgram socket is even requested, so the self-view can render real
    // hardware state instead of a placeholder that lies about it.
    this.onStream(this.stream, this.hasVideo);

    if (cameraFailure) {
      this.onError(
        new Error(
          `Camera unavailable (${cameraFailure?.message || "denied"}). Continuing with microphone only.`,
        ),
      );
    }

    // Attach teardown/track-change listeners immediately after capture,
    // before opening the socket — a track that ends during the connect
    // window must still be caught, not just once we're "live".
    const audioTrack = stream.getAudioTracks()[0];
    audioTrack?.addEventListener("ended", () => this.stop());
    const videoTrack = stream.getVideoTracks()[0];
    videoTrack?.addEventListener("ended", () => {
      // Losing the camera (unplugged, seized by another app) is not fatal —
      // audio-only is a valid state — but the preview must stop claiming a
      // video track exists.
      if (this._stopped) return;
      this.hasVideo = false;
      this.onStream(this.stream, false);
    });

    const dg = await createSttStream({
      speaker: "you",
      onStatus: (s) => {
        // Once stopped, every further status from this socket is stale —
        // forwarding it could repaint an idle UI as "live", or re-run
        // teardown. Swallow it.
        if (this._stopped) return;
        if (s === "closed") {
          // An unsolicited close (network drop, idle timeout, sleep/resume —
          // anything that isn't our own stop()) must tear the whole session
          // down for real, not just report a cosmetic "idle" while the
          // camera and mic keep running.
          this.stop();
          return;
        }
        this.onStatus(DG_STATUS_TO_UI_STATUS[s] || s);
      },
      onError: (err) => {
        if (this._stopped) return;
        this.onError(err);
        this.onStatus("error");
      },
      onTranscript: (t) => {
        if (this._stopped) return;
        this.onTranscript(t);
      },
    });
    // Assigned to the instance BEFORE awaiting connect() so a stop() that
    // lands while the socket is still connecting finds a real object to
    // close, instead of nothing.
    this._dg = dg;
    try {
      await dg.connect();
    } catch (err) {
      // A stop() mid-handshake can itself cause the WebSocket to fail to
      // connect — that's not a real connection failure, it's our own
      // teardown; the concurrent stop() has already handled everything.
      if (this._stopped) return;
      throw err;
    }
    if (this._stopped) {
      await this.stop();
      return;
    }

    const pipeline = new PcmPipeline();
    // Same reasoning as _dg above: assign before awaiting start().
    this._pipeline = pipeline;
    await pipeline.start(stream, (chunk) => dg.send(chunk));
    if (this._stopped) {
      await this.stop();
      return;
    }
  }

  // Muting/disabling a track is not the same as stopping it: the Deepgram
  // socket and the underlying capture stay open, the track just yields
  // silence (audio) or a frozen/blank frame (video) while disabled. Both are
  // no-ops when the session never got that kind of track.
  setMicMuted(muted) {
    const track = this.stream?.getAudioTracks()[0];
    if (track) track.enabled = !muted;
  }

  setCameraOff(off) {
    const track = this.stream?.getVideoTracks()[0];
    if (track) track.enabled = !off;
  }

  async stop() {
    this._stopped = true;
    if (this._dg) {
      try {
        this._dg.close();
      } catch {
        // ignore
      }
    }
    if (this._pipeline) {
      try {
        await this._pipeline.stop();
      } catch {
        // ignore
      }
    }
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    }
    this._dg = null;
    this._pipeline = null;
    this.stream = null;
    this.hasVideo = false;
    this.onStatus("idle");
  }
}
