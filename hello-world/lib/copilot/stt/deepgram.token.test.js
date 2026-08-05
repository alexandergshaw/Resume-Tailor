// Covers DeepgramStream's constructor `token` option: connect() must use an
// already-minted token as-is (no fetch of its own — see createSttStream in
// ./index.js, which mints exactly one token and threads it into the
// constructed instance for this reason) and must still open the exact same
// WebSocket URL and subprotocol it always has, regardless of which path
// supplied the token. The "constructed WITHOUT a token" path is already
// covered by lib/copilot/stt/deepgram.test.js — not duplicated or modified
// here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepgramStream } from "./deepgram";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

// Same minimal WebSocket double as lib/copilot/stt/deepgram.test.js — records
// the constructor args (url, protocols) and lets a test fire "open"
// synchronously via emit().
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

// connect() awaits any fetch(...) + res.json() before constructing the
// WebSocket (when it fetches at all). A macrotask tick via setImmediate
// reliably drains that microtask queue either way.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Drives a DeepgramStream all the way through connect() against the fake
// WebSocket and hands back the socket it opened.
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

// Both the query string and the request line up to (but excluding) the query
// string must be identical no matter which path supplied the token — this
// pulls the two apart so a test can assert on each separately.
function splitUrl(url) {
  const [base, query] = url.split("?");
  return { base, params: new URLSearchParams(query) };
}

describe("DeepgramStream constructor token option", () => {
  it("uses a constructor-supplied token in connect() without fetching its own", async () => {
    const { ws } = await connectStream({ token: "ctor-token" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ws.protocols).toEqual(["token", "ctor-token"]);
  });

  it("still fetches when no token was supplied to the constructor", async () => {
    // Not re-testing deepgram.test.js's coverage of this path in depth —
    // just confirming the two branches are not mixed up: omitting `token`
    // must still reach fetch exactly once.
    const { ws } = await connectStream({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.protocols).toEqual(["token", "fetched-token"]);
  });

  it("treats an empty-string constructor token as absent and falls back to fetching one", async () => {
    // `if (!token)` in connect() is a truthiness check, not an
    // undefined-check — an empty string must not be mistaken for "a token
    // was supplied".
    const { ws } = await connectStream({ token: "" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.protocols).toEqual(["token", "fetched-token"]);
  });

  it("opens the same URL base and query parameters whether the token came from the constructor or from its own fetch", async () => {
    const { ws: ctorWs } = await connectStream({ token: "ctor-token" });
    const { ws: fetchedWs } = await connectStream({});

    const ctorUrl = splitUrl(ctorWs.url);
    const fetchedUrl = splitUrl(fetchedWs.url);

    expect(ctorUrl.base).toBe("wss://api.deepgram.com/v1/listen");
    expect(fetchedUrl.base).toBe(ctorUrl.base);
    expect(Object.fromEntries(fetchedUrl.params)).toEqual(
      Object.fromEntries(ctorUrl.params),
    );
    // Pin down the actual parameters, not just that the two paths agree with
    // each other — a bug that changed both branches identically would still
    // pass an equality-only check.
    expect(Object.fromEntries(ctorUrl.params)).toEqual({
      model: "nova-3",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
    });
  });

  it("opens the subprotocol as ['token', <token>] for both the constructor-supplied and the fetched token", async () => {
    const { ws: ctorWs } = await connectStream({ token: "ctor-token" });
    const { ws: fetchedWs } = await connectStream({});

    expect(ctorWs.protocols).toEqual(["token", "ctor-token"]);
    expect(fetchedWs.protocols).toEqual(["token", "fetched-token"]);
  });
});
