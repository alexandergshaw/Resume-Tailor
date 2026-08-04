// Audio capture for the interview copilot.
//
// Three sources:
//   - captureTabAudio(): the OTHER party's voice, via getDisplayMedia tab share.
//     Chrome/Edge only, and the shared surface must have "Share tab audio" on.
//   - captureSystemAudio(): the OTHER party's voice, via getDisplayMedia whole-
//     screen share with system audio. Use this when the interview is happening
//     in a native app (Zoom/Teams desktop client) or on a phone on speaker,
//     where there's no browser tab to share. Chrome cannot capture system
//     audio on macOS at all — sharing a browser tab is the only option there.
//   - captureMicAudio(): your own voice, via getUserMedia.
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

// Both display-capture paths fail the same way when the shared surface has no
// audio (wrong picker choice, or the audio checkbox left off): stop every
// granted track immediately — an unstopped video track keeps the browser's
// "sharing this tab/screen" indicator lit — then throw a source-specific
// message telling the user how to fix it.
function requireAudioTrack(stream, errorMessage) {
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(errorMessage);
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
    'No tab audio was captured. In the share dialog, pick a browser tab (not a window or your whole screen) and turn on "Share tab audio".',
  );
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

  return requireAudioTrack(
    stream,
    'No system audio was captured. In the share dialog, pick "Entire Screen" and turn on "Share system audio". Note: Chrome cannot capture system audio on macOS at all — on a Mac, sharing a browser tab is the only option.',
  );
}

export async function captureMicAudio() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

export class PcmPipeline {
  constructor() {
    this.ctx = null;
    this.nodes = [];
  }

  // Wires stream -> worklet -> muted gain -> destination, calling onChunk with
  // each ArrayBuffer of PCM16. Routing the (silent) worklet output through a
  // zero-gain node to the destination keeps the graph "live" so process() keeps
  // firing, without echoing the captured audio back out the speakers.
  async start(stream, onChunk) {
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule(WORKLET_URL);

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
    const mute = ctx.createGain();
    mute.gain.value = 0;

    worklet.port.onmessage = (evt) => onChunk(evt.data);
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(ctx.destination);

    this.ctx = ctx;
    this.nodes = [source, worklet, mute];
    return ctx;
  }

  async stop() {
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
