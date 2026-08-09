import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepgramStream } from "./deepgram";

// Written from AC-M1.2 BEFORE diarization existed. Deliberately a separate
// file from deepgram.test.js: that file pins the pre-diarization wire
// behaviour (R-076) and must not be edited to make this feature pass.
//
// What Deepgram actually returns, per its live-streaming docs: enabling
// diarization is `diarize_model=v1` (the older `diarize=true` boolean is
// documented as deprecated), and the speaker id arrives as an integer
// `speaker` field on each entry of `channel.alternatives[0].words[]`. Streaming
// omits the `speaker_confidence` field that pre-recorded responses carry, so
// nothing here may depend on it.

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

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
    Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "test-token" }) }),
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

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

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

function emitMessage(ws, frame) {
  ws.emit("message", { data: JSON.stringify(frame) });
}

// A Results frame carrying a diarized words array. Word entries are passed
// through verbatim so a test can omit timings or punctuated_word to exercise
// the degraded shapes.
function diarizedFrame({ transcript = "", words = [], isFinal = true, speechFinal = false }) {
  return {
    type: "Results",
    is_final: isFinal,
    speech_final: speechFinal,
    channel: { alternatives: [{ transcript, words }] },
  };
}

function word(text, speaker, start, end, { punctuated } = {}) {
  const entry = { word: text, speaker };
  if (start !== undefined) entry.start = start;
  if (end !== undefined) entry.end = end;
  if (punctuated !== undefined) entry.punctuated_word = punctuated;
  return entry;
}

// The exact query string this app has sent since before diarization existed.
// R-076 pins these parameters; the diarize-off case must reproduce this
// literal byte for byte.
const BASELINE_QUERY =
  "model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=300";

describe("DeepgramStream diarization parameters", () => {
  it("sends exactly the pre-diarization query string when diarization is not requested", async () => {
    const { ws } = await connectStream({ speaker: "them" });

    expect(ws.url).toBe(`wss://api.deepgram.com/v1/listen?${BASELINE_QUERY}`);
  });

  it("sends exactly the pre-diarization query string when diarize is explicitly false", async () => {
    const { ws } = await connectStream({ speaker: "them", diarize: false });

    expect(ws.url).toBe(`wss://api.deepgram.com/v1/listen?${BASELINE_QUERY}`);
  });

  it("adds diarize_model=v1 — and nothing else — when diarization is requested", async () => {
    const { ws } = await connectStream({ speaker: "you", diarize: true });

    expect(ws.url).toBe(`wss://api.deepgram.com/v1/listen?${BASELINE_QUERY}&diarize_model=v1`);
  });

  it("does not send the deprecated diarize boolean", async () => {
    const { ws } = await connectStream({ speaker: "you", diarize: true });

    expect(ws.url).not.toMatch(/[?&]diarize=/);
  });

  it("declares diarization support so callers never have to name the provider", () => {
    expect(DeepgramStream.supportsDiarization).toBe(true);
  });
});

describe("DeepgramStream diarized transcript splitting", () => {
  it("emits one transcript per contiguous run of same-speaker words", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        transcript: "tell me about yourself sure absolutely",
        words: [
          word("tell", 0, 1.0, 1.2),
          word("me", 0, 1.2, 1.35),
          word("about", 0, 1.35, 1.6),
          word("yourself", 0, 1.6, 2.0),
          word("sure", 1, 2.4, 2.7),
          word("absolutely", 1, 2.7, 3.2),
        ],
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(2);
    expect(onTranscript.mock.calls[0][0]).toMatchObject({
      transcript: "tell me about yourself",
      speakerTag: 0,
    });
    expect(onTranscript.mock.calls[1][0]).toMatchObject({
      transcript: "sure absolutely",
      speakerTag: 1,
    });
  });

  it("derives each run's own audio span from its own first and last word", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        words: [word("tell", 0, 1.0, 1.2), word("me", 0, 1.2, 1.5), word("sure", 1, 2.4, 2.9)],
      }),
    );

    expect(onTranscript.mock.calls[0][0].start).toBeCloseTo(1.0, 6);
    expect(onTranscript.mock.calls[0][0].duration).toBeCloseTo(0.5, 6);
    expect(onTranscript.mock.calls[1][0].start).toBeCloseTo(2.4, 6);
    expect(onTranscript.mock.calls[1][0].duration).toBeCloseTo(0.5, 6);
  });

  it("leaves start and duration undefined — never zero — when word timings are missing", async () => {
    // R-078 already paid for this lesson on the ElevenLabs path: answerWindow.js
    // reads undefined as "no timing available", so a fabricated 0 corrupts every
    // derived delivery number without ever throwing.
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({ words: [word("hello", 0), word("there", 0)] }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0].start).toBeUndefined();
    expect(onTranscript.mock.calls[0][0].duration).toBeUndefined();
  });

  it("prefers punctuated_word over the bare word when Deepgram supplies it", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        words: [
          word("how", 0, 1.0, 1.1, { punctuated: "How" }),
          word("are", 0, 1.1, 1.2, { punctuated: "are" }),
          word("you", 0, 1.2, 1.4, { punctuated: "you?" }),
        ],
      }),
    );

    expect(onTranscript.mock.calls[0][0].transcript).toBe("How are you?");
  });

  it("carries the frame's speech_final on the LAST run only", async () => {
    // speech_final describes the end of the frame's audio. Attaching it to an
    // earlier run fires end-of-turn for a speaker who has not finished.
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        speechFinal: true,
        words: [word("okay", 0, 1.0, 1.2), word("right", 1, 1.4, 1.7)],
      }),
    );

    expect(onTranscript.mock.calls[0][0].speechFinal).toBe(false);
    expect(onTranscript.mock.calls[1][0].speechFinal).toBe(true);
  });

  it("keeps is_final on every run of the frame", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        isFinal: true,
        words: [word("okay", 0, 1.0, 1.2), word("right", 1, 1.4, 1.7)],
      }),
    );

    expect(onTranscript.mock.calls[0][0].isFinal).toBe(true);
    expect(onTranscript.mock.calls[1][0].isFinal).toBe(true);
  });

  it("re-groups a speaker who takes the floor back later in the same frame", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        words: [
          word("and", 0, 1.0, 1.1),
          word("then", 0, 1.1, 1.3),
          word("right", 1, 1.5, 1.7),
          word("exactly", 0, 1.9, 2.3),
        ],
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(3);
    expect(onTranscript.mock.calls.map((c) => c[0].speakerTag)).toEqual([0, 1, 0]);
    expect(onTranscript.mock.calls[2][0].transcript).toBe("exactly");
  });
});

describe("DeepgramStream diarization degraded frames", () => {
  it("falls back to the whole-frame transcript when the words array is unusable", async () => {
    // A provider hiccup must degrade to today's transcript, never to silence.
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      {
        type: "Results",
        is_final: true,
        speech_final: true,
        start: 4.0,
        duration: 1.5,
        channel: { alternatives: [{ transcript: "so what brings you here" }] },
      },
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0]).toMatchObject({
      transcript: "so what brings you here",
      isFinal: true,
      speechFinal: true,
      start: 4.0,
      duration: 1.5,
    });
    expect(onTranscript.mock.calls[0][0].speakerTag).toBeUndefined();
  });

  it("skips a run whose text is empty rather than emitting a blank transcript", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        speechFinal: true,
        words: [word("  ", 1, 1.0, 1.1), word("hello", 0, 1.2, 1.5)],
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0].transcript).toBe("hello");
  });

  it("moves speech_final onto the last run actually emitted when a trailing run is skipped", async () => {
    // Otherwise the end-of-turn signal is dropped with the blank run and the
    // assembled question is never evaluated at all.
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        speechFinal: true,
        words: [word("hello", 0, 1.0, 1.3), word("   ", 1, 1.5, 1.6)],
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0].speechFinal).toBe(true);
  });

  it("does not diarize at all when diarization was not requested, even if words carry speakers", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "them", onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        transcript: "tell me about yourself sure",
        words: [word("tell", 0, 1.0, 1.2), word("sure", 1, 2.4, 2.7)],
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0].transcript).toBe("tell me about yourself sure");
    expect(onTranscript.mock.calls[0][0].speakerTag).toBeUndefined();
  });

  it("omits speakerTag as an ABSENT key on a non-diarized frame, not as undefined", async () => {
    // `toHaveBeenCalledWith` uses toEqual semantics and IGNORES undefined-valued
    // keys, so an implementation that always attaches `speakerTag: undefined`
    // would pass every other assertion in this suite AND every assertion in
    // deepgram.test.js while quietly changing the emitted object's shape. This
    // is the `in` check deepgram.test.js already uses for textAlreadyDelivered.
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "them", onTranscript });

    emitMessage(ws, diarizedFrame({ transcript: "hello there", words: [] }));

    expect("speakerTag" in onTranscript.mock.calls[0][0]).toBe(false);
  });

  it("falls back to the whole-frame transcript when the words array is empty", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({ transcript: "so what brings you here", words: [], speechFinal: true }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0].transcript).toBe("so what brings you here");
    expect("speakerTag" in onTranscript.mock.calls[0][0]).toBe(false);
  });

  it("falls back when no word entry carries a numeric speaker", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        transcript: "so what brings you here",
        words: [
          { word: "so", start: 1.0, end: 1.2 },
          { word: "what", start: 1.2, end: 1.4 },
        ],
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0].transcript).toBe("so what brings you here");
    expect("speakerTag" in onTranscript.mock.calls[0][0]).toBe(false);
  });

  it("emits nothing at all when every run is blank", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        speechFinal: true,
        words: [word("  ", 0, 1.0, 1.1), word("   ", 1, 1.2, 1.3)],
      }),
    );

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("keeps the surviving run's own speaker tag when a blank run is skipped", async () => {
    const onTranscript = vi.fn();
    const { ws } = await connectStream({ speaker: "mic", diarize: true, onTranscript });

    emitMessage(
      ws,
      diarizedFrame({
        speechFinal: true,
        words: [word("  ", 1, 1.0, 1.1), word("hello", 0, 1.2, 1.5)],
      }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0].speakerTag).toBe(0);
    expect(onTranscript.mock.calls[0][0].speechFinal).toBe(true);
  });
});
