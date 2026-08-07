import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepgramStream } from "./deepgram";

// deepgram.js talks to two browser/network globals this node test
// environment doesn't provide real versions of: fetch (for the token route)
// and WebSocket (for the Deepgram socket itself). Both are stubbed here and
// restored afterward so this file doesn't leak into others.
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

// Minimal WebSocket double: records addEventListener callbacks per event
// type and lets a test fire them synchronously via emit(). This is exactly
// the surface DeepgramStream.connect() and its "message" handler touch —
// nothing about real framing/handshakes is needed to exercise that handler.
class FakeWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeWebSocket.CONNECTING;
    this._listeners = {};
  }
  addEventListener(type, handler) {
    (this._listeners[type] ||= []).push(handler);
  }
  send() {}
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
  emit(type, event = {}) {
    for (const handler of this._listeners[type] || []) handler(event);
  }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

let sockets;

beforeEach(() => {
  sockets = [];
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: "test-token" }),
    }),
  );
  globalThis.WebSocket = class extends FakeWebSocket {
    constructor(...args) {
      super(...args);
      sockets.push(this);
    }
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

// connect() awaits fetch(...) and res.json() before constructing the
// WebSocket. Both are already-resolved promises here, but their .then
// callbacks still land on the microtask queue — a macrotask tick via
// setImmediate reliably drains that queue before a test looks for the
// socket connect() just created.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Drives a DeepgramStream all the way through connect() against the fake
// WebSocket and hands back the socket so a test can start emitting
// "message" events against it.
async function connectStream(options) {
  const stream = new DeepgramStream(options);
  const connectPromise = stream.connect();
  await flushMicrotasks();
  const ws = sockets[sockets.length - 1];
  ws.readyState = FakeWebSocket.OPEN;
  ws.emit("open");
  await connectPromise;
  return { stream, ws };
}

// Builds a Deepgram "Results" frame with sane defaults, overridable per
// test. start/duration are omitted entirely unless explicitly passed, so
// tests can distinguish "field absent" from "field present but falsy".
function resultsFrame({
  transcript = "hello there",
  isFinal = false,
  speechFinal = false,
  start,
  duration,
} = {}) {
  const frame = {
    type: "Results",
    is_final: isFinal,
    speech_final: speechFinal,
    channel: { alternatives: [{ transcript }] },
  };
  if (start !== undefined) frame.start = start;
  if (duration !== undefined) frame.duration = duration;
  return frame;
}

function emitMessage(ws, frame) {
  ws.emit("message", { data: JSON.stringify(frame) });
}

describe("DeepgramStream transcript forwarding", () => {
  it("carries numeric start and duration on an interim Results frame", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "them", onTranscript });

    emitMessage(
      ws,
      resultsFrame({
        transcript: "how are",
        isFinal: false,
        speechFinal: false,
        start: 1.5,
        duration: 0.32,
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith({
      speaker: "them",
      transcript: "how are",
      isFinal: false,
      speechFinal: false,
      start: 1.5,
      duration: 0.32,
    });
  });

  it("carries numeric start and duration on a final Results frame", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "you", onTranscript });

    emitMessage(
      ws,
      resultsFrame({
        transcript: "how are you doing",
        isFinal: true,
        speechFinal: true,
        start: 2,
        duration: 0.87,
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith({
      speaker: "you",
      transcript: "how are you doing",
      isFinal: true,
      speechFinal: true,
      start: 2,
      duration: 0.87,
    });
  });

  it("forwards a start of exactly 0 as the number 0, not as missing", async () => {
    // typeof 0 === "number" is true, so a Results frame at the very start of
    // the audio stream (start: 0) must not be mistaken for "field absent"
    // by anything that only checks truthiness.
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ onTranscript });

    emitMessage(
      ws,
      resultsFrame({ transcript: "zero start", start: 0, duration: 0.1 }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.start).toBe(0);
    expect(call.duration).toBe(0.1);
  });

  it("yields start/duration undefined, not NaN, when a Results frame omits them", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ onTranscript });

    emitMessage(ws, resultsFrame({ transcript: "no timing here" }));

    expect(onTranscript).toHaveBeenCalledTimes(1);
    const call = onTranscript.mock.calls[0][0];
    expect(call.start).toBeUndefined();
    expect(call.duration).toBeUndefined();
    expect(Number.isNaN(call.start)).toBe(false);
    expect(Number.isNaN(call.duration)).toBe(false);
    expect("start" in call).toBe(true);
    expect("duration" in call).toBe(true);
  });

  it("yields start/duration undefined, not a string, when a Results frame carries non-numeric values", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ onTranscript });

    const frame = resultsFrame({ transcript: "string timing" });
    frame.start = "1.5";
    frame.duration = "0.3";
    emitMessage(ws, frame);

    expect(onTranscript).toHaveBeenCalledTimes(1);
    const call = onTranscript.mock.calls[0][0];
    expect(call.start).toBeUndefined();
    expect(call.duration).toBeUndefined();
    expect(typeof call.start).not.toBe("string");
    expect(typeof call.duration).not.toBe("string");
  });

  it("keeps speaker, transcript, isFinal and speechFinal exactly as before", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "me", onTranscript });

    emitMessage(
      ws,
      resultsFrame({
        transcript: "  padded transcript  ",
        isFinal: true,
        speechFinal: false,
        start: 3,
        duration: 0.2,
      }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.speaker).toBe("me");
    expect(call.transcript).toBe("padded transcript");
    expect(call.isFinal).toBe(true);
    expect(call.speechFinal).toBe(false);
  });

  it("defaults speaker to \"them\" when none is supplied, unchanged from before", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ onTranscript });

    emitMessage(ws, resultsFrame({ transcript: "default speaker" }));

    expect(onTranscript.mock.calls[0][0].speaker).toBe("them");
  });

  it("ignores non-Results frames such as Metadata, UtteranceEnd and SpeechStarted", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ onTranscript });

    ws.emit("message", {
      data: JSON.stringify({ type: "Metadata", request_id: "abc" }),
    });
    ws.emit("message", { data: JSON.stringify({ type: "UtteranceEnd" }) });
    ws.emit("message", { data: JSON.stringify({ type: "SpeechStarted" }) });

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("never carries a textAlreadyDelivered key on any frame, even for two back-to-back Results frames with identical transcript/start/duration (R-127 no-regression)", async () => {
    // ElevenLabs' committed_transcript(_with_timestamps) re-delivers the
    // SAME span a preceding final_transcript(_with_timestamps) already
    // delivered, purely to carry speechFinal:true — see
    // lib/copilot/stt/elevenlabs.js and docs/REGRESSION.md R-127. Deepgram
    // has no equivalent second message: speech_final rides on the SAME
    // Results frame as is_final (see this file's own DEFAULT_PARAMS/
    // endpointing comment), so there is no separate "commit" message to
    // re-deliver a span from in the first place — this module must never
    // gain the R-127 dedup flag as a side effect of some future change.
    // Every other test in this file already proves this implicitly (each
    // uses `toHaveBeenCalledWith` against a fixed 6-key object, which fails
    // on any extra key), but this is the explicit case for it: even the
    // adversarial input — two structurally-identical final frames sent back
    // to back — must not produce the flag.
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ onTranscript });

    const frame = resultsFrame({
      transcript: "same text twice",
      isFinal: true,
      speechFinal: true,
      start: 4,
      duration: 1,
    });
    emitMessage(ws, frame);
    emitMessage(ws, frame);

    expect(onTranscript).toHaveBeenCalledTimes(2);
    for (const call of onTranscript.mock.calls.map((c) => c[0])) {
      expect("textAlreadyDelivered" in call).toBe(false);
      expect(call.textAlreadyDelivered).toBeUndefined();
    }
  });

  it("ignores Results frames with an empty, whitespace-only, or missing transcript", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ onTranscript });

    emitMessage(ws, resultsFrame({ transcript: "" }));
    emitMessage(ws, resultsFrame({ transcript: "   " }));
    ws.emit("message", {
      data: JSON.stringify({
        type: "Results",
        is_final: true,
        channel: { alternatives: [] },
      }),
    });

    expect(onTranscript).not.toHaveBeenCalled();
  });
});
