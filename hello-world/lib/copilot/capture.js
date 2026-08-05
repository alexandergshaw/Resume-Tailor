// Audio/video capture for the interview copilot.
//
// Four sources:
//   - captureTabAudio(): the OTHER party's voice, via getDisplayMedia tab share.
//     Chrome/Edge only, and the shared surface must have "Share tab audio" on.
//   - captureSystemAudio(): the OTHER party's voice, via getDisplayMedia whole-
//     screen share with system audio. Use this when the interview is happening
//     in a native app (Zoom/Teams desktop client) or on a phone on speaker,
//     where there's no browser tab to share. Chrome cannot capture system
//     audio on macOS at all — sharing a browser tab is the only option there.
//   - captureMicAudio(): your own voice, via getUserMedia.
//   - captureCameraAndMic(): your camera + your own voice, via getUserMedia,
//     for practice mode's self-view.
//
// Each MediaStream is fed through PcmPipeline, which uses an AudioWorklet to
// emit 16 kHz mono PCM16 chunks. The AudioContext is pinned to 16 kHz so the
// browser handles resampling for us.

const WORKLET_URL = "/copilot/pcm-worklet.js";

// Shared by both getDisplayMedia paths below so tab capture and system capture
// can't quietly drift apart (e.g. one gaining a processing option the other
// lacks). Both want the raw signal — Deepgram does its own noise handling.
const DISPLAY_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

// Shared by captureMicAudio and captureCameraAndMic, the two getUserMedia
// paths that want a clean, processed voice signal (as opposed to the raw
// signal DISPLAY_AUDIO_CONSTRAINTS asks for above).
const MIC_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// Both display-capture paths fail the same way when the shared surface has no
// audio (wrong picker choice, or the audio checkbox left off): stop every
// granted track immediately — an unstopped video track keeps the browser's
// "sharing this tab/screen" indicator lit — then throw a source-specific
// message telling the user how to fix it.
//
// buildErrorMessage is a callback, not a plain string, because
// captureSystemAudio's message depends on which surface the user actually
// shared, and that can only be read off the still-live video track (see
// readDisplaySurface below). Calling it here, before the stop() loop, is what
// guarantees the read happens while the track is still live. captureTabAudio
// doesn't need any of that, so its callback just returns its static string —
// which keeps that path's message byte-identical to what it was before this
// function took a callback instead of a string.
function requireAudioTrack(stream, buildErrorMessage) {
  if (stream.getAudioTracks().length === 0) {
    const message = buildErrorMessage(stream);
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(message);
  }
  return stream;
}

export async function captureTabAudio() {
  // Chrome only grants tab audio when a video track is also requested, so we ask
  // for video and simply never render it.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: DISPLAY_AUDIO_CONSTRAINTS,
  });

  return requireAudioTrack(
    stream,
    () =>
      'No tab audio was captured. In the share dialog, pick a browser tab (not a window or your whole screen) and turn on "Share tab audio".',
  );
}

// getSettings().displaySurface reports which surface the user actually chose
// in the picker: "monitor" (whole screen), "window", or "browser" (a tab).
// This must be read here, before requireAudioTrack stops the track — once a
// track is stopped, browsers are free to clear or invalidate its settings.
//
// displaySurface in the getDisplayMedia() constraints below is only ADVISORY
// ("The specified options can't be used to limit the choices available to the
// user" — MDN): it pre-selects the Entire Screen pane, but the user remains
// free to pick a window or a tab instead. That's the actual bug this guards
// against — the old code assumed the "monitor" hint constrained the choice,
// so every no-audio failure got the "Entire Screen" message even when the
// user had picked a window or a tab, where that advice doesn't apply.
//
// getSettings can be missing on the track entirely, or can throw; the stream
// might not carry a video track at all, or might not even implement
// getVideoTracks (this project's own test doubles for other capture paths
// don't need one, since they never fail this way). None of that should turn
// a clear "no system audio" error into a TypeError, so every one of those
// cases falls through to undefined here, which buildSystemAudioMessage below
// treats the same as an explicit "monitor" reading.
function readDisplaySurface(stream) {
  try {
    const videoTrack = stream.getVideoTracks?.()?.[0];
    if (!videoTrack || typeof videoTrack.getSettings !== "function") {
      return undefined;
    }
    return videoTrack.getSettings().displaySurface;
  } catch {
    return undefined;
  }
}

// Per-surface wording for the "no system audio" failure. "monitor" keeps
// today's message verbatim (turn on "Share system audio"), and so does any
// surface value this app doesn't recognize, or couldn't read at all — see
// readDisplaySurface above. "window" and "browser" get their own wording
// because the fix is different, and telling a window/tab user to find a
// "Share system audio" checkbox sends them looking for a control that Chrome
// never shows them for those surfaces.
const DEFAULT_SYSTEM_AUDIO_MESSAGE =
  'No system audio was captured. In the share dialog, pick "Entire Screen" and turn on "Share system audio". Note: Chrome cannot capture system audio on macOS at all — on a Mac, sharing a browser tab is the only option.';

const SYSTEM_AUDIO_MESSAGES_BY_SURFACE = {
  window:
    'No system audio was captured. You shared a window, and on Windows a window share carries no system audio at all — there is no checkbox to turn on for it. Pick "Entire Screen" instead.',
  browser:
    'No system audio was captured. You shared a browser tab. Use this app\'s "Browser tab" interviewer-audio option instead, or re-pick "Entire Screen" in the share dialog if you meant to share your screen.',
};

function buildSystemAudioMessage(stream) {
  const surface = readDisplaySurface(stream);
  return SYSTEM_AUDIO_MESSAGES_BY_SURFACE[surface] ?? DEFAULT_SYSTEM_AUDIO_MESSAGE;
}

export async function captureSystemAudio() {
  // displaySurface: "monitor" steers the picker toward "Entire Screen" (the
  // only surface system audio can ride along with), and systemAudio: "include"
  // plus monitorTypeSurfaces: "include" is what makes Chrome offer the "Share
  // system audio" toggle in the first place.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor" },
    audio: DISPLAY_AUDIO_CONSTRAINTS,
    systemAudio: "include",
    monitorTypeSurfaces: "include",
  });

  return requireAudioTrack(stream, () => buildSystemAudioMessage(stream));
}

export async function captureMicAudio() {
  return navigator.mediaDevices.getUserMedia({
    audio: MIC_AUDIO_CONSTRAINTS,
  });
}

// Practice mode's capture: your camera plus your own voice. Video is a
// standard 720p-ideal front-facing request; audio reuses the same processed
// constraints as captureMicAudio so the two paths can't drift apart. Unlike
// the display-capture paths above, a rejection here (permission denied, no
// camera present, etc.) propagates unchanged — this function doesn't decide
// what to do about it, that's PracticeSession's job.
export async function captureCameraAndMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: MIC_AUDIO_CONSTRAINTS,
  });

  return requireAudioTrack(
    stream,
    () =>
      "No microphone audio was captured. Practice needs your microphone to transcribe your answer.",
  );
}

export class PcmPipeline {
  constructor() {
    this.ctx = null;
    this.nodes = [];
    this._stopped = false;
  }

  // Wires stream -> worklet -> muted gain -> destination, calling onChunk with
  // each ArrayBuffer of PCM16. Routing the (silent) worklet output through a
  // zero-gain node to the destination keeps the graph "live" so process() keeps
  // firing, without echoing the captured audio back out the speakers.
  async start(stream, onChunk) {
    this._stopped = false;

    const ctx = new AudioContext({ sampleRate: 16000 });
    // Assigned before the addModule await so a stop() that lands while the
    // worklet module is still loading always finds a real AudioContext to
    // close. Assigning only after addModule() resolves (the old behavior)
    // left that window's stop() closing nothing, and the AudioContext this
    // call went on to build was a live, unreferenced leak nobody could ever
    // close — it held the audio graph over the captured stream open for the
    // life of the page.
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(WORKLET_URL);

    // The stop() above (if one landed) already closed `ctx`. Building nodes
    // on an already-closed context would throw and surface to the user as a
    // spurious error after they pressed Stop, so bail out instead of wiring
    // the graph.
    if (this._stopped) {
      return null;
    }

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
    const mute = ctx.createGain();
    mute.gain.value = 0;

    worklet.port.onmessage = (evt) => onChunk(evt.data);
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(ctx.destination);

    this.nodes = [source, worklet, mute];
    return ctx;
  }

  async stop() {
    this._stopped = true;
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.nodes = [];
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        // ignore
      }
      this.ctx = null;
    }
  }
}
