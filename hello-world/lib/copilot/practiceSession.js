// Orchestrates a practice-mode capture session: your camera (optional) plus
// your own voice, transcribed the same way the live session transcribes your
// mic ("you" speaker). There is only ever one source here — no interviewer
// audio — so unlike CopilotSession there's no per-source status map to
// aggregate; the single Deepgram socket's status is reported directly,
// translated into the vocabulary the UI already renders.

import { captureCameraAndMic, captureMicAudio, PcmPipeline } from "./capture";
import { createSttStream } from "./stt";
import { createUtteranceAssembly } from "./utteranceAssembly";

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

// AC-J1.4: the practice-mode counterpart of session.js's micFailureMessage,
// and deliberately NOT the same sentence. In live mode the microphone is
// optional — that message ends "Continuing with interviewer audio only",
// because the interviewer's tab/system audio keeps the session alive. Here
// the microphone IS the session: there is nothing to continue with, so this
// tells the user what to do instead of what is still working.
//
// Checked by `.name` (the standard DOMException field getUserMedia
// rejections use), never by matching message text, which is not spec'd —
// same reasoning as session.js's own check. Gated on a device id actually
// having been requested: with no selection there is no `deviceId: { exact }`
// constraint in play, so an OverconstrainedError from some other constraint
// must not be reported as a vanished microphone. In every case this does
// not recognize, the ORIGINAL error object is returned untouched, so a
// permission denial (and everything else practice mode already surfaced)
// reads exactly as it did before a microphone could be chosen at all.
//
// Note what this deliberately does NOT do: retry capture with the device
// constraint dropped. Falling back to some other microphone would start a
// session recording on hardware the user did not choose while the picker
// still names the one they did — the exact silent-substitution failure
// `deviceId: { exact }` exists to prevent (see capture.js).
function micSelectionAwareError(err, micDeviceId) {
  if (micDeviceId && err?.name === "OverconstrainedError") {
    return new Error(
      "Selected microphone is no longer available (it may have been unplugged or disconnected). Choose a different microphone and start again.",
    );
  }
  return err;
}

export class PracticeSession {
  constructor({
    withVideo = true,
    micDeviceId,
    onTranscript,
    onUtterance,
    onStatus,
    onError,
    onStream,
  } = {}) {
    this.withVideo = withVideo;
    // AC-J1.3: left as whatever the caller passed — including `undefined`
    // when omitted — rather than defaulted to `null` here, for the same
    // reason CopilotSession leaves its own alone: capture.js treats every
    // falsy value identically, so omitting this reproduces pre-feature
    // behaviour byte-for-byte without this class having an opinion about
    // which falsy value means "no selection".
    this.micDeviceId = micDeviceId;
    this.onTranscript = onTranscript || (() => {});
    // AC-M2: fired once per assembled per-speaker turn, mirroring
    // CopilotSession's onUtterance for its "inperson" source (session.js).
    // Unlike that source, diarize is requested unconditionally here (see the
    // dg options below), so this fires for every practice session, not just
    // ones built with a particular source. Detecting a question asked by
    // someone else in the room has to happen LIVE, as they ask it — the
    // end-of-answer partition in answerSpeakers.js only resolves once the
    // candidate presses Done, by which point the moment to draft an answer
    // has passed.
    this.onUtterance = onUtterance || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.onStream = onStream || (() => {});
    this.stream = null;
    this.hasVideo = false;
    this._pipeline = null;
    this._dg = null;
    this._stopped = false;
    // Owns the same per-tag assembly session.js uses for its "inperson"
    // source (utteranceAssembly.js) — see R-147 in that module's header for
    // why a speaker's buffer must drain on a speaker change as well as its
    // own speechFinal. Created unconditionally, not lazily on start(), so
    // stop() can always drain it safely even if start() never ran.
    this._utteranceAssembly = createUtteranceAssembly();
  }

  // AC-M2/R-147: fires onUtterance for one completed turn. The only call
  // site for onUtterance, fed exclusively by _handleUtteranceFrame below and
  // by stop()'s drainAll — same discipline as CopilotSession's
  // _emitUtterance for _handleInPersonFrame/drainAll.
  _emitUtterance(tag, text) {
    this.onUtterance({ speakerTag: tag, text });
  }

  // AC-M2: only a frame carrying a numeric speakerTag participates in
  // assembly at all — an untagged frame (no diarization, or a provider that
  // can't diarize; see stt/index.js's diarizationActive) fires no utterance,
  // full stop. There is no "them" fallback to route it to the way
  // session.js's _resolveSpeakerLabel has one: practice mode has exactly one
  // stream, and reporting the candidate's own untagged speech as a room
  // utterance would put a question nobody asked on their screen, the same
  // false-positive this feature exists to avoid in the solo case (see
  // roomQuestions.js's header).
  //
  // Only a LOCKED run (`isFinal`) feeds the buffer — Deepgram's interim runs
  // for a still-settling span repeat and revise the same words as they firm
  // up, and pushing every interim would duplicate text into the assembled
  // utterance (the R-127 class of bug: see answerSpeakers.js's header).
  _handleUtteranceFrame(frame) {
    const tag = frame.speakerTag;
    if (typeof tag !== "number") return;
    if (!frame.isFinal) return;

    const completed = this._utteranceAssembly.push(tag, frame.transcript);
    if (completed) this._emitUtterance(completed.tag, completed.text);

    // R-147: "whichever comes first" — a tag also drains on its OWN
    // speechFinal, independent of whichever tag push() above just completed
    // (if any). Without this, a speaker who simply stops talking without
    // being interrupted by a different tag would never drain at all.
    if (frame.speechFinal) {
      const drained = this._utteranceAssembly.drain(tag);
      if (drained) this._emitUtterance(drained.tag, drained.text);
    }
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
    //
    // AC-J1.4: whichever error ends up being thrown goes through
    // micSelectionAwareError first, so a chosen microphone that has since
    // been unplugged is named as such instead of surfacing the browser's
    // bare "constraint could not be satisfied" text under a camera-shaped
    // failure path. The mic-only fallback carries the SAME device id, so it
    // fails identically in that case — which is correct: substituting a
    // different microphone is never an acceptable recovery here.
    if (this.withVideo) {
      try {
        stream = await captureCameraAndMic(this.micDeviceId);
      } catch (err) {
        if (this._stopped) return;
        cameraFailure = err;
        try {
          stream = await captureMicAudio(this.micDeviceId);
        } catch {
          throw micSelectionAwareError(cameraFailure, this.micDeviceId);
        }
      }
    } else {
      try {
        stream = await captureMicAudio(this.micDeviceId);
      } catch (err) {
        throw micSelectionAwareError(err, this.micDeviceId);
      }
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
      // AC-M2: requested unconditionally, unlike CopilotSession's "inperson"
      // source (session.js), where diarize is tied to which capture source
      // was picked. There is no such choice here — the mic is already the
      // only source practice mode ever has — so the request costs nothing
      // for the overwhelmingly common solo session: one voice diarizes to a
      // single tag, and answerSpeakers.js's partitionAnswerFinals treats
      // that exactly like no tag at all (every final is the candidate's
      // either way). No warning is raised when the provider can't diarize
      // (contrast session.js's onError when !dg.diarizationActive) — unlike
      // an in-person live session, a solo practice user loses nothing
      // observable either way, so there is nothing here worth surfacing.
      diarize: true,
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
        // AC-M2: every frame still reaches onTranscript unchanged, above,
        // exactly as before this feature existed — this only ADDS the
        // parallel per-speaker assembly path, it never replaces or gates
        // the existing one.
        this._handleUtteranceFrame(t);
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
    // R-147: drainAll so a turn mid-flight when the session ends isn't
    // silently stranded in the buffer for the rest of the process's life —
    // same discipline as CopilotSession.stop(). Safe to call repeatedly
    // (idempotent: an already-empty assembly drains to nothing) and safe
    // before start() ever ran, since _utteranceAssembly is built in the
    // constructor rather than lazily in start().
    for (const { tag, text } of this._utteranceAssembly.drainAll()) {
      this._emitUtterance(tag, text);
    }
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
