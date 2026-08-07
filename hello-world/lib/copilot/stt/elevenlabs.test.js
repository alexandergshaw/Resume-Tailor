import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsStream } from "./elevenlabs";

// elevenlabs.js's send() branches on `this.ws.readyState !== WebSocket.OPEN`
// against the *global* WebSocket identifier (it never imports one), so this
// double's OPEN/CONNECTING/CLOSED constants have to be the ones send() sees.
// Stubbed here and restored afterward so this file doesn't leak into others.
const originalWebSocket = globalThis.WebSocket;

class FakeWebSocket {
  constructor() {
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
  }
  send(data) {
    this.sent.push(data);
  }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

beforeEach(() => {
  globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

// send() is exercised directly against a stubbed `ws` rather than through
// connect() — connect() (token fetch + real handshake) is not part of this
// unit's contract and the field is a plain instance property, so this is the
// same object send() itself reads from.
function makeStream() {
  return new ElevenLabsStream({ speaker: "them" });
}

function pcm16Buffer(bytes) {
  return new Uint8Array(bytes).buffer;
}

// Mirrors what a real browser's atob() + charCodeAt round trip does, i.e.
// the inverse of arrayBufferToBase64 in elevenlabs.js, without reaching into
// that module's internals.
function decodeBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Array.from(bytes);
}

describe("ElevenLabsStream#send", () => {
  it("sends one input_audio_chunk JSON message with commit:false and sample_rate:16000 on an open socket", () => {
    const stream = makeStream();
    const ws = new FakeWebSocket();
    stream.ws = ws;

    stream.send(pcm16Buffer([1, 2, 3, 4]));

    expect(ws.sent).toHaveLength(1);
    expect(typeof ws.sent[0]).toBe("string");
    const payload = JSON.parse(ws.sent[0]);
    expect(payload.message_type).toBe("input_audio_chunk");
    expect(payload.commit).toBe(false);
    expect(payload.sample_rate).toBe(16000);
    expect(typeof payload.audio_base_64).toBe("string");
  });

  it("round-trips the exact original bytes through base64, including 0x00 and 0xFF", () => {
    const stream = makeStream();
    const ws = new FakeWebSocket();
    stream.ws = ws;

    const originalBytes = [0x00, 0xff, 0x10, 0x7f, 0x80, 0xff, 0x00, 0x01];
    stream.send(pcm16Buffer(originalBytes));

    const payload = JSON.parse(ws.sent[0]);
    expect(decodeBase64ToBytes(payload.audio_base_64)).toEqual(originalBytes);
  });

  it("round-trips a chunk spanning the internal 0x8000-byte encode-loop boundary", () => {
    // arrayBufferToBase64 walks the buffer in 0x8000-byte slices; a buffer
    // that crosses that boundary is the only way to exercise more than one
    // loop iteration and catch an off-by-one in how the slices are stitched
    // back together.
    const stream = makeStream();
    const ws = new FakeWebSocket();
    stream.ws = ws;

    const length = 0x8000 + 10;
    const originalBytes = new Array(length);
    for (let i = 0; i < length; i++) originalBytes[i] = i % 256;

    stream.send(pcm16Buffer(originalBytes));

    const payload = JSON.parse(ws.sent[0]);
    expect(decodeBase64ToBytes(payload.audio_base_64)).toEqual(originalBytes);
  });

  it("does not send anything when the socket is not open yet (CONNECTING)", () => {
    const stream = makeStream();
    const ws = new FakeWebSocket();
    ws.readyState = FakeWebSocket.CONNECTING;
    stream.ws = ws;

    stream.send(pcm16Buffer([9, 9, 9]));

    expect(ws.sent).toHaveLength(0);
  });

  it("does not send anything once the socket has closed", () => {
    const stream = makeStream();
    const ws = new FakeWebSocket();
    ws.readyState = FakeWebSocket.CLOSED;
    stream.ws = ws;

    stream.send(pcm16Buffer([1]));

    expect(ws.sent).toHaveLength(0);
  });

  it("does not throw when there is no socket at all (never connected)", () => {
    const stream = makeStream();
    expect(stream.ws).toBeNull();

    expect(() => stream.send(pcm16Buffer([1, 2]))).not.toThrow();
  });
});

// connect() and close() coverage below. This shares the file with the
// send() coverage above but needs a fuller WebSocket double (addEventListener
// / emit, not just send()), so it is kept in its own describe with its own
// beforeEach/afterEach — those run nested inside the file-level ones above
// (outer beforeEach first, inner afterEach first), so this block's
// globalThis.WebSocket override applies only to the tests below and the
// file-level afterEach above still restores the true original afterward.
const originalFetch = globalThis.fetch;

// Fuller WebSocket double than the send()-only one above: records the
// constructor URL and addEventListener callbacks per event type, and lets a
// test fire them synchronously via emit(). This is exactly the surface
// ElevenLabsStream.connect() and its "message"/"close" handlers touch — no
// real framing/handshake needed.
class FakeRealtimeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = FakeRealtimeSocket.CONNECTING;
    this._listeners = {};
  }
  addEventListener(type, handler) {
    (this._listeners[type] ||= []).push(handler);
  }
  send() {}
  close() {
    this.readyState = FakeRealtimeSocket.CLOSED;
  }
  emit(type, event = {}) {
    for (const handler of this._listeners[type] || []) handler(event);
  }
}
FakeRealtimeSocket.CONNECTING = 0;
FakeRealtimeSocket.OPEN = 1;
FakeRealtimeSocket.CLOSING = 2;
FakeRealtimeSocket.CLOSED = 3;

// Splits a WebSocket URL into its base (scheme+host+path) and its query
// parameters, so a test can assert on each independently.
function splitUrl(url) {
  const [base, query] = url.split("?");
  return { base, params: new URLSearchParams(query) };
}

describe("ElevenLabsStream connect()/close()", () => {
  let sockets;
  let fetchMock;

  beforeEach(() => {
    sockets = [];
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: "fetched-token" }),
      }),
    );
    globalThis.fetch = fetchMock;
    globalThis.WebSocket = class extends FakeRealtimeSocket {
      constructor(...args) {
        super(...args);
        sockets.push(this);
      }
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // globalThis.WebSocket is restored by the file-level afterEach above,
    // which runs after this one.
  });

  // connect() awaits fetch(...) + res.json() (when it fetches at all) before
  // constructing the WebSocket. Both are already-resolved promises here, but
  // their .then callbacks still land on the microtask queue — a macrotask
  // tick via setImmediate reliably drains that queue before a test looks for
  // the socket connect() just created.
  function flushMicrotasks() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  // Drives an ElevenLabsStream all the way through connect() against the
  // fake WebSocket and hands back the socket so a test can start emitting
  // events against it.
  async function connectStream(options) {
    const stream = new ElevenLabsStream(options);
    const connectPromise = stream.connect();
    await flushMicrotasks();
    const ws = sockets[sockets.length - 1];
    ws.readyState = FakeRealtimeSocket.OPEN;
    ws.emit("open");
    await connectPromise;
    return { stream, ws };
  }

  describe("connect() query parameters", () => {
    it("opens the WebSocket with exactly the parameters ElevenLabs' realtime protocol requires", async () => {
      const { ws } = await connectStream({ token: "abc-token" });

      const { base, params } = splitUrl(ws.url);
      expect(base).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
      // Assert each parameter explicitly and pin the whole set — a wrong
      // value here only fails against the live service, never a local test
      // run, so each field is checked by name rather than relying on a
      // partial match.
      expect(params.get("model_id")).toBe("scribe_v2_realtime");
      expect(params.get("audio_format")).toBe("pcm_16000");
      expect(params.get("include_timestamps")).toBe("true");
      expect(params.get("commit_strategy")).toBe("vad");
      expect(params.get("token")).toBe("abc-token");
      expect(Object.fromEntries(params)).toEqual({
        model_id: "scribe_v2_realtime",
        audio_format: "pcm_16000",
        commit_strategy: "vad",
        include_timestamps: "true",
        token: "abc-token",
      });
    });
  });

  describe("connect() status sequence", () => {
    it("emits 'connecting' then 'open', and the returned promise resolves only once the socket opens", async () => {
      const onStatus = vi.fn();
      const stream = new ElevenLabsStream({ token: "t", onStatus });

      const connectPromise = stream.connect();
      await flushMicrotasks();
      const ws = sockets[sockets.length - 1];

      let resolved = false;
      connectPromise.then(() => {
        resolved = true;
      });
      await flushMicrotasks();

      // Before "open" fires, only "connecting" has been reported and the
      // promise must still be pending.
      expect(onStatus.mock.calls).toEqual([["connecting"]]);
      expect(resolved).toBe(false);

      ws.readyState = FakeRealtimeSocket.OPEN;
      ws.emit("open");
      await connectPromise;

      expect(resolved).toBe(true);
      expect(onStatus.mock.calls).toEqual([["connecting"], ["open"]]);
    });

    it("rejects connect() when the socket errors before ever opening", async () => {
      const onStatus = vi.fn();
      const stream = new ElevenLabsStream({ token: "t", onStatus });

      const connectPromise = stream.connect();
      await flushMicrotasks();
      const ws = sockets[sockets.length - 1];

      ws.emit("error");

      await expect(connectPromise).rejects.toThrow("Could not connect to ElevenLabs.");
      // Only "connecting" was ever reported — a failed connection never
      // reaches "open".
      expect(onStatus.mock.calls).toEqual([["connecting"]]);
    });
  });

  describe("constructor token option", () => {
    it("uses a constructor-supplied token in connect() without fetching its own", async () => {
      const { ws } = await connectStream({ token: "ctor-token" });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(splitUrl(ws.url).params.get("token")).toBe("ctor-token");
    });

    it("fetches a token exactly like the Deepgram provider does when none was supplied to the constructor", async () => {
      const { ws } = await connectStream({});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(splitUrl(ws.url).params.get("token")).toBe("fetched-token");
    });
  });

  describe("close()", () => {
    it("is idempotent: a second call does not emit a second 'closed' status", async () => {
      const onStatus = vi.fn();
      const { stream } = await connectStream({ token: "t", onStatus });
      onStatus.mockClear();

      stream.close();
      stream.close();

      expect(onStatus.mock.calls).toEqual([["closed"]]);
    });

    it("emits 'closed', and after close() no further onStatus, onError or onTranscript calls occur", async () => {
      const onTranscript = vi.fn();
      const onStatus = vi.fn();
      const onError = vi.fn();
      const { stream, ws } = await connectStream({ token: "t", onTranscript, onStatus, onError });

      // Control: before close(), a committed transcript is delivered
      // normally, proving the listeners were wired up in the first place.
      ws.emit("message", {
        data: JSON.stringify({ message_type: "committed_transcript", text: "hello" }),
      });
      expect(onTranscript).toHaveBeenCalledTimes(1);

      onTranscript.mockClear();
      onStatus.mockClear();
      onError.mockClear();

      stream.close();
      expect(onStatus).toHaveBeenCalledWith("closed");

      onStatus.mockClear();

      // Events landing on the underlying socket after close() must produce
      // no further callback of any kind.
      ws.emit("message", {
        data: JSON.stringify({ message_type: "committed_transcript", text: "world" }),
      });
      ws.emit("close");
      ws.emit("error");

      expect(onTranscript).not.toHaveBeenCalled();
      expect(onStatus).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("error message_type routing", () => {
    // Every message_type elevenlabs.js documents as carrying an error
    // rather than a transcript (see ERROR_MESSAGE_TYPES in the source file)
    // — listed explicitly, rather than imported, so this test would notice
    // if the module's set ever drifted from what it claims to handle.
    const ERROR_MESSAGE_TYPES = [
      "error",
      "auth_error",
      "quota_exceeded",
      "commit_throttled",
      "unaccepted_terms",
      "rate_limited",
      "queue_overflow",
      "resource_exhausted",
      "session_time_limit_exceeded",
      "input_error",
      "chunk_size_exceeded",
      "insufficient_audio_activity",
      "transcriber_error",
    ];

    it.each(ERROR_MESSAGE_TYPES)(
      "routes message_type %s to onError with the server's detail, not as an unrecognized type",
      async (type) => {
        const onError = vi.fn();
        const { ws } = await connectStream({ token: "t", onError });

        ws.emit("message", {
          data: JSON.stringify({ message_type: type, error: "boom" }),
        });

        expect(onError).toHaveBeenCalledTimes(1);
        const err = onError.mock.calls[0][0];
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe(`ElevenLabs reported ${type}: boom`);
        expect(err.message).not.toMatch(/unrecognized/i);
      },
    );

    it("falls back to a default detail string when an error message_type carries no `error` field", async () => {
      const onError = vi.fn();
      const { ws } = await connectStream({ token: "t", onError });

      ws.emit("message", { data: JSON.stringify({ message_type: "auth_error" }) });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toBe(
        "ElevenLabs reported auth_error: no further detail given.",
      );
    });

    it("keeps the session open (no onStatus('closed')) when an error message_type arrives", async () => {
      const onError = vi.fn();
      const onStatus = vi.fn();
      const { ws } = await connectStream({ token: "t", onError, onStatus });
      onStatus.mockClear();

      ws.emit("message", {
        data: JSON.stringify({ message_type: "rate_limited", error: "slow down" }),
      });

      expect(onStatus).not.toHaveBeenCalled();
    });
  });

  describe("unrecognized message_type handling", () => {
    it("reports an unrecognized message_type through onError exactly once per session, even after several unknown messages", async () => {
      const onError = vi.fn();
      const { ws } = await connectStream({ token: "t", onError });

      ws.emit("message", { data: JSON.stringify({ message_type: "future_feature_a" }) });
      ws.emit("message", { data: JSON.stringify({ message_type: "future_feature_b" }) });
      ws.emit("message", { data: JSON.stringify({ message_type: "future_feature_a" }) });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toContain('"future_feature_a"');
    });

    it("keeps reporting known error message_types normally after an unrecognized type has already used up its one report", async () => {
      const onError = vi.fn();
      const { ws } = await connectStream({ token: "t", onError });

      ws.emit("message", { data: JSON.stringify({ message_type: "mystery_type" }) });
      ws.emit("message", {
        data: JSON.stringify({ message_type: "quota_exceeded", error: "over limit" }),
      });

      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls[0][0].message).toContain('"mystery_type"');
      expect(onError.mock.calls[1][0].message).toBe(
        "ElevenLabs reported quota_exceeded: over limit",
      );
    });
  });

  describe("abnormal socket close", () => {
    it("surfaces through onError in addition to onStatus('closed') when the socket closes on its own", async () => {
      const onError = vi.fn();
      const onStatus = vi.fn();
      const { ws } = await connectStream({ token: "t", onError, onStatus });
      onStatus.mockClear();
      onError.mockClear();

      ws.emit("close");

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/closed unexpectedly/i);
      expect(onStatus).toHaveBeenCalledWith("closed");
    });

    it("does not surface onError when the close was initiated by the module's own close()", async () => {
      const onError = vi.fn();
      const onStatus = vi.fn();
      const { stream, ws } = await connectStream({ token: "t", onError, onStatus });
      onStatus.mockClear();
      onError.mockClear();

      stream.close();
      // Simulate the browser eventually firing its own "close" event after
      // ws.close() was called — the guard this exercises lives in the
      // listener registered in connect(), which stream.close() itself never
      // calls directly.
      ws.emit("close");

      expect(onError).not.toHaveBeenCalled();
      expect(onStatus).toHaveBeenCalledWith("closed");
    });
  });
});

// _handleMessage()/_emitTranscript() coverage below: the message_type ->
// isFinal/speechFinal mapping, the words-array span derivation, and which
// message types or transcript texts do (or don't) reach onTranscript at
// all. Exercised by calling _handleMessage directly with an already-parsed
// message object -- exactly the shape the "message" listener inside
// connect() hands it after JSON.parse (see elevenlabs.js) -- since none of
// this logic depends on the socket itself.
function makeMappingStream(overrides = {}) {
  return new ElevenLabsStream({ speaker: "them", ...overrides });
}

// Builds an ElevenLabs transcript message with sane defaults, overridable
// per test. `words` is omitted entirely unless explicitly passed, mirroring
// the real protocol where only the *_with_timestamps message types carry it.
function transcriptMessage(messageType, { text = "hello there", words } = {}) {
  const msg = { message_type: messageType, text };
  if (words !== undefined) msg.words = words;
  return msg;
}

describe("ElevenLabsStream#_handleMessage message-type to isFinal/speechFinal mapping", () => {
  it("maps partial_transcript to isFinal:false, speechFinal:false", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(transcriptMessage("partial_transcript", { text: "how are" }));

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith({
      speaker: "them",
      transcript: "how are",
      isFinal: false,
      speechFinal: false,
      start: undefined,
      duration: undefined,
    });
  });

  it("maps final_transcript to isFinal:true, speechFinal:false", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(transcriptMessage("final_transcript", { text: "how are you" }));

    const call = onTranscript.mock.calls[0][0];
    expect(call.isFinal).toBe(true);
    expect(call.speechFinal).toBe(false);
  });

  it("maps final_transcript_with_timestamps to isFinal:true, speechFinal:false", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("final_transcript_with_timestamps", { text: "how are you doing" }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.isFinal).toBe(true);
    expect(call.speechFinal).toBe(false);
  });

  it("maps committed_transcript to isFinal:true, speechFinal:true -- the exact signal live-mode question detection keys off of", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("committed_transcript", { text: "how are you doing today" }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.isFinal).toBe(true);
    expect(call.speechFinal).toBe(true);
  });

  it("maps committed_transcript_with_timestamps to isFinal:true, speechFinal:true -- the exact signal live-mode question detection keys off of", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", { text: "how are you doing today" }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.isFinal).toBe(true);
    expect(call.speechFinal).toBe(true);
  });

  it("keeps final_transcript's speechFinal false where committed_transcript's is true for the same text, so the two are not interchangeable", () => {
    const finalOnTranscript = vi.fn();
    const committedOnTranscript = vi.fn();

    makeMappingStream({ onTranscript: finalOnTranscript })._handleMessage(
      transcriptMessage("final_transcript", { text: "same text" }),
    );
    makeMappingStream({ onTranscript: committedOnTranscript })._handleMessage(
      transcriptMessage("committed_transcript", { text: "same text" }),
    );

    expect(finalOnTranscript.mock.calls[0][0].speechFinal).toBe(false);
    expect(committedOnTranscript.mock.calls[0][0].speechFinal).toBe(true);
  });
});

// R-127: the test above proves final_transcript and committed_transcript
// differ in speechFinal "for the same text" but sends each to its OWN fresh
// stream, so it never exercises what happens when the SAME stream sees both
// for the SAME utterance — which is exactly what production did, and which
// doubled every reported word count, filler count, and words-per-minute
// (docs/REGRESSION.md R-127). These cases send both messages to one stream,
// in the order the real protocol produces them.
describe("ElevenLabsStream#_handleMessage textAlreadyDelivered dedup (R-127)", () => {
  it("flags a committed_transcript_with_timestamps that exactly re-delivers the immediately preceding final_transcript_with_timestamps's span, while still delivering speechFinal:true", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    const words = [
      { type: "word", start: 1.0, end: 1.3, text: "hello" },
      { type: "word", start: 1.4, end: 1.8, text: "there" },
    ];

    stream._handleMessage(
      transcriptMessage("final_transcript_with_timestamps", { text: "hello there", words }),
    );
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", { text: "hello there", words }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(2);
    const [finalCall, committedCall] = onTranscript.mock.calls.map((c) => c[0]);

    // The FIRST delivery of this span (final_transcript_with_timestamps) is
    // a normal, un-flagged frame — a text-accumulating consumer must append
    // it exactly like today.
    expect(finalCall.isFinal).toBe(true);
    expect(finalCall.speechFinal).toBe(false);
    expect(finalCall.textAlreadyDelivered).toBeUndefined();
    expect("textAlreadyDelivered" in finalCall).toBe(false);

    // The SECOND delivery of the SAME span is flagged so a text-accumulating
    // consumer skips it — but it is still delivered at all (consumers need
    // its speechFinal:true, which is this provider's only end-of-turn
    // signal), and its transcript/start/duration are unchanged.
    expect(committedCall.isFinal).toBe(true);
    expect(committedCall.speechFinal).toBe(true);
    expect(committedCall.textAlreadyDelivered).toBe(true);
    expect(committedCall.transcript).toBe("hello there");
    expect(committedCall.start).toBe(finalCall.start);
    expect(committedCall.duration).toBe(finalCall.duration);
  });

  it("delivers two genuinely different utterances that happen to share the same text but start at different times, neither one swallowed", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    const wordsAt = (offset) => [{ type: "word", start: offset, end: offset + 0.3, text: "okay" }];

    // First utterance: final then its matching committed (a normal R-127 pair).
    stream._handleMessage(
      transcriptMessage("final_transcript_with_timestamps", { text: "okay", words: wordsAt(1.0) }),
    );
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", { text: "okay", words: wordsAt(1.0) }),
    );
    // Second utterance, seconds later: the speaker says the exact same word
    // again. Same text as the first utterance, but a DIFFERENT start — this
    // must be recognised as new speech, not swallowed as a re-delivery of
    // the first utterance.
    stream._handleMessage(
      transcriptMessage("final_transcript_with_timestamps", { text: "okay", words: wordsAt(9.0) }),
    );
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", { text: "okay", words: wordsAt(9.0) }),
    );

    expect(onTranscript).toHaveBeenCalledTimes(4);
    const calls = onTranscript.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.transcript)).toEqual(["okay", "okay", "okay", "okay"]);
    // Only each committed frame is a re-delivery of ITS OWN preceding final
    // — never of the other utterance's frames.
    expect(calls[0].textAlreadyDelivered).toBeUndefined(); // 1st utterance's final
    expect(calls[1].textAlreadyDelivered).toBe(true); // 1st utterance's committed
    expect(calls[2].textAlreadyDelivered).toBeUndefined(); // 2nd utterance's final — new span
    expect(calls[3].textAlreadyDelivered).toBe(true); // 2nd utterance's committed
  });

  it("does not flag a committed_transcript whose text matches the last final but whose start/duration cannot be proven equal (no words array, so both are undefined)", () => {
    // Neither final_transcript nor committed_transcript (without the
    // _with_timestamps suffix) ever carry a words array, so deriveSpan
    // yields start/duration undefined for both — undefined === undefined
    // proves nothing about whether this is really the same span, so this
    // must NOT be treated as a re-delivery (see the judgement call
    // documented in elevenlabs.js's _emitTranscript).
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(transcriptMessage("final_transcript", { text: "same text" }));
    stream._handleMessage(transcriptMessage("committed_transcript", { text: "same text" }));

    const [finalCall, committedCall] = onTranscript.mock.calls.map((c) => c[0]);
    expect(finalCall.start).toBeUndefined();
    expect(committedCall.start).toBeUndefined();
    expect(committedCall.textAlreadyDelivered).toBeUndefined();
  });
});

describe("ElevenLabsStream#_handleMessage start/duration derivation from words", () => {
  it("derives start from the first word's start and duration from the last word's end minus that start, in seconds", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("final_transcript_with_timestamps", {
        text: "hello there friend",
        words: [
          { type: "word", start: 1.2, end: 1.5, text: "hello" },
          { type: "word", start: 1.6, end: 1.9, text: "there" },
          { type: "word", start: 2.0, end: 2.6, text: "friend" },
        ],
      }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.speaker).toBe("them");
    expect(call.transcript).toBe("hello there friend");
    expect(call.start).toBe(1.2);
    expect(call.duration).toBe(2.6 - 1.2);
  });

  it("excludes leading and trailing spacing entries from the span, using only the real word entries", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "hello there",
        words: [
          { type: "spacing", start: 0, end: 0.5 },
          { type: "word", start: 0.5, end: 0.9, text: "hello" },
          { type: "word", start: 1.0, end: 1.4, text: "there" },
          { type: "spacing", start: 1.4, end: 3.0 },
        ],
      }),
    );

    const call = onTranscript.mock.calls[0][0];
    // If the leading/trailing spacing entries were not excluded, start would
    // read 0 (the spacing entry's start) and duration would read 3.0 instead
    // of the word-only span asserted below.
    expect(call.start).toBe(0.5);
    expect(call.duration).toBe(1.4 - 0.5);
  });

  it("excludes audio_event entries from the span too, not just spacing", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "hello",
        words: [
          { type: "audio_event", start: 0, end: 0.2, text: "[cough]" },
          { type: "word", start: 0.8, end: 1.1, text: "hello" },
          { type: "audio_event", start: 1.1, end: 1.5, text: "[laughter]" },
        ],
      }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.start).toBe(0.8);
    expect(call.duration).toBe(1.1 - 0.8);
  });

  it("yields start and duration undefined -- never a fabricated 0 -- when the message has no words array at all", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(transcriptMessage("partial_transcript", { text: "no timing here" }));

    const call = onTranscript.mock.calls[0][0];
    expect(call.start).toBeUndefined();
    expect(call.duration).toBeUndefined();
    expect(call.start).not.toBe(0);
    expect(call.duration).not.toBe(0);
  });

  it("yields start and duration undefined -- never a fabricated 0 -- when words contains no word-type entries at all", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "hmm",
        words: [
          { type: "spacing", start: 0, end: 0.3 },
          { type: "audio_event", start: 0.3, end: 0.6, text: "[hmm]" },
        ],
      }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.start).toBeUndefined();
    expect(call.duration).toBeUndefined();
  });

  it("yields start and duration undefined -- never a fabricated 0 -- when the words' timing fields are not numeric", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("final_transcript_with_timestamps", {
        text: "hello",
        words: [{ type: "word", start: "1.2", end: 1.5, text: "hello" }],
      }),
    );

    const call = onTranscript.mock.calls[0][0];
    expect(call.start).toBeUndefined();
    expect(call.duration).toBeUndefined();
  });
});

describe("ElevenLabsStream#_handleMessage empty-transcript handling", () => {
  it("skips a message whose text is an empty string", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(transcriptMessage("partial_transcript", { text: "" }));

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("skips a message whose text is whitespace only", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage(transcriptMessage("committed_transcript", { text: "   \t  " }));

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("skips a message with no text field at all", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage({ message_type: "final_transcript" });

    expect(onTranscript).not.toHaveBeenCalled();
  });
});

describe("ElevenLabsStream#_handleMessage message types that never reach onTranscript", () => {
  it("does not forward session_started, even when it happens to carry a text field", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage({ message_type: "session_started", text: "should not matter" });

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("does not forward committed_transcript_entities, even when it happens to carry a text field", () => {
    const onTranscript = vi.fn();
    const stream = makeMappingStream({ onTranscript });

    stream._handleMessage({
      message_type: "committed_transcript_entities",
      text: "should not matter",
      entities: [{ type: "date", value: "tomorrow" }],
    });

    expect(onTranscript).not.toHaveBeenCalled();
  });
});
