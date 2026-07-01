// Audio capture for the interview copilot.
//
// Two sources:
//   - captureTabAudio(): the OTHER party's voice, via getDisplayMedia tab share.
//     Chrome/Edge only, and the shared surface must have "Share tab audio" on.
//   - captureMicAudio(): your own voice, via getUserMedia.
//
// Each MediaStream is fed through PcmPipeline, which uses an AudioWorklet to
// emit 16 kHz mono PCM16 chunks. The AudioContext is pinned to 16 kHz so the
// browser handles resampling for us.

const WORKLET_URL = "/copilot/pcm-worklet.js";

export async function captureTabAudio() {
  // Chrome only grants tab audio when a video track is also requested, so we ask
  // for video and simply never render it.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      'No tab audio was captured. In the share dialog, pick a browser tab (not a window or your whole screen) and turn on "Share tab audio".',
    );
  }

  return stream;
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
