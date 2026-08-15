import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepgramStream } from "./deepgram";

// AC-S1: a live interview must never fail quietly.
//
// The bug this file exists for: a user started a live session, watched it go
// "Live", and got no transcript and no error. Every failure that happens
// AFTER the socket opens is currently invisible — the only "error" listener
// is registered with { once: true } inside the connect promise and its whole
// body is `reject(...)`, so once `open` has settled that promise a later
// error calls reject on a settled promise and does nothing at all. A close
// only reports `onStatus("closed")`, which for a single-source in-person
// session aggregates to "idle" — the pill quietly reverts and the user is
// told nothing.
//
// The property under test is therefore: ANY unhealthy end to this stream
// reaches `onError`. The negative controls (a deliberate stop, a normal
// close) are what stop a fix from satisfying this by simply shouting always.

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

// connect() awaits the token fetch before constructing the WebSocket, so a
// macrotask tick is needed before the socket exists — same helper, and the
// same reason, as lib/copilot/stt/deepgram.test.js's own.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Builds a stream, opens its socket, and hands back the spies plus the socket
// so a test can fire whatever happens next.
async function connected(options = {}) {
  const onTranscript = vi.fn();
  const onStatus = vi.fn();
  const onError = vi.fn();
  const stream = new DeepgramStream({ onTranscript, onStatus, onError, ...options });
  const promise = stream.connect();
  await flushMicrotasks();
  const ws = sockets[sockets.length - 1];
  ws.readyState = FakeWebSocket.OPEN;
  ws.emit("open");
  await promise;
  onStatus.mockClear();
  return { stream, ws, onTranscript, onStatus, onError };
}

function resultsFrame(transcript, extra = {}) {
  return {
    data: JSON.stringify({
      type: "Results",
      is_final: true,
      speech_final: true,
      channel: { alternatives: [{ transcript }] },
      ...extra,
    }),
  };
}

describe("a failure after the socket opened (AC-S1.1)", () => {
  it("reports an error event that arrives once the stream is already live", async () => {
    const { ws, onError } = await connected();
    ws.emit("error", { message: "socket blew up" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toMatch(/\S/);
  });

  it("reports an unexpected close, not just a status change (AC-S1.2)", async () => {
    const { ws, onStatus, onError } = await connected();
    ws.emit("close", { code: 1006, reason: "abnormal closure", wasClean: false });
    expect(onStatus).toHaveBeenCalledWith("closed");
    expect(onError).toHaveBeenCalledTimes(1);
    // The message has to be usable by someone reading a log later, so it
    // must carry the close code the provider actually sent.
    expect(String(onError.mock.calls[0][0].message)).toContain("1006");
  });

  it("stays quiet when the user stopped the session themselves (AC-S1.4)", async () => {
    const { stream, ws, onError } = await connected();
    stream.close();
    ws.emit("close", { code: 1006, reason: "torn down", wasClean: false });
    // Even an unclean close is expected once the user pressed Stop — the
    // deliberate teardown is what `_closing` already records.
    expect(onError).not.toHaveBeenCalled();
  });

  it("stays quiet on a clean close it did not initiate (AC-S1.4)", async () => {
    const { ws, onError } = await connected();
    ws.emit("close", { code: 1000, reason: "", wasClean: true });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("a provider payload that is not a transcript (AC-S1.3)", () => {
  it("surfaces an error message the provider sent down the socket", async () => {
    const { ws, onError } = await connected();
    ws.emit("message", {
      data: JSON.stringify({
        type: "Error",
        description: "invalid query parameter: diarize_model",
      }),
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0].message)).toContain("diarize_model");
  });

  it("still ignores the ordinary non-transcript frames (AC-S1.3)", async () => {
    // Positive control for the above: Metadata / UtteranceEnd / SpeechStarted
    // are routine and must not be reported as failures, or every session
    // would open with an error banner.
    const { ws, onError, onTranscript } = await connected();
    for (const type of ["Metadata", "UtteranceEnd", "SpeechStarted"]) {
      ws.emit("message", { data: JSON.stringify({ type }) });
    }
    expect(onError).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("does not treat unparseable data as a provider error (AC-S1.3)", async () => {
    const { ws, onError } = await connected();
    ws.emit("message", { data: "<not json>" });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("one bad frame does not deafen the rest of the session (AC-S1.5)", () => {
  it("keeps delivering later frames after a consumer throws", async () => {
    const onTranscript = vi.fn().mockImplementationOnce(() => {
      throw new Error("consumer exploded");
    });
    const onStatus = vi.fn();
    const onError = vi.fn();
    const stream = new DeepgramStream({ onTranscript, onStatus, onError });
    const promise = stream.connect();
    await flushMicrotasks();
    const ws = sockets[sockets.length - 1];
    ws.readyState = FakeWebSocket.OPEN;
    ws.emit("open");
    await promise;

    expect(() => ws.emit("message", resultsFrame("first question"))).not.toThrow();
    ws.emit("message", resultsFrame("second question"));

    expect(onTranscript).toHaveBeenCalledTimes(2);
    expect(onTranscript.mock.calls[1][0].transcript).toBe("second question");
    // The swallowed consumer failure must still be reported somewhere, or
    // this becomes a new silent path of exactly the kind this file exists
    // to close.
    expect(onError).toHaveBeenCalled();
  });

  it("delivers an ordinary frame unchanged (positive control)", async () => {
    const { ws, onTranscript, onError } = await connected();
    ws.emit("message", resultsFrame("Tell me about yourself"));
    expect(onError).not.toHaveBeenCalled();
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript.mock.calls[0][0]).toMatchObject({
      speaker: "them",
      transcript: "Tell me about yourself",
      isFinal: true,
      speechFinal: true,
    });
  });
});
