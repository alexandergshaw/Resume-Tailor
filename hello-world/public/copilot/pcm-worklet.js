// AudioWorklet that converts float32 audio frames to 16-bit little-endian PCM.
//
// The capture pipeline creates its AudioContext at a 16 kHz sample rate, so the
// browser already resamples the source down to what Deepgram wants. This
// processor only has to: clamp to [-1, 1], convert to int16, and batch frames
// into ~128 ms chunks (2048 samples) to keep WebSocket message volume sane
// (~8 messages/sec instead of ~125). Audio is mono — we read channel 0 only.
class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Int16Array(2048); // ~128 ms at 16 kHz
    this._len = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    // No input connected this quantum (e.g. source muted) — keep the node alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      let s = channel[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this._buf[this._len] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this._len += 1;
      if (this._len === this._buf.length) {
        // Copy out and transfer the buffer so the audio thread keeps its own.
        const out = this._buf.slice(0);
        this.port.postMessage(out.buffer, [out.buffer]);
        this._len = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
