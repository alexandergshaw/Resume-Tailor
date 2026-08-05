import { beforeEach, describe, expect, it, vi } from "vitest";

// createSttStream's whole job is wiring: fetch a token, pick a provider
// class, and construct it with that token attached. Both of its
// dependencies are mocked so these tests exercise only that wiring, not
// fetchSttToken's own fetch() handling (token.test.js) or DeepgramStream's
// own WebSocket handling (deepgram.test.js).
vi.mock("./token", () => ({
  fetchSttToken: vi.fn(),
}));

// The registry inside index.js (`PROVIDERS = { deepgram: DeepgramStream }`)
// currently has exactly one entry, and that same entry is also the
// no-match fallback. That means these tests can confirm a constructed
// instance is always a (fake) DeepgramStream and always carries the
// options createSttStream was asked to thread through, but — with only one
// registered class — they cannot yet tell "explicit provider argument
// selected deepgram" apart from "everything fell back to deepgram anyway".
// That distinction only becomes observable once a second provider is
// registered.
vi.mock("./deepgram", () => {
  class FakeDeepgramStream {
    constructor(options) {
      this.options = options;
    }
    async connect() {
      this.connected = true;
    }
  }
  return { DeepgramStream: FakeDeepgramStream };
});

// Second registered provider (F2) — same fake shape as FakeDeepgramStream
// above, so the tests below can tell "resolved to ElevenLabs" apart from
// "resolved to Deepgram" by class identity alone.
vi.mock("./elevenlabs", () => {
  class FakeElevenLabsStream {
    constructor(options) {
      this.options = options;
    }
    async connect() {
      this.connected = true;
    }
  }
  return { ElevenLabsStream: FakeElevenLabsStream };
});

import { createSttStream } from "./index";
import { fetchSttToken } from "./token";
import { DeepgramStream as FakeDeepgramStream } from "./deepgram";
import { ElevenLabsStream as FakeElevenLabsStream } from "./elevenlabs";

beforeEach(() => {
  fetchSttToken.mockReset();
});

describe("createSttStream", () => {
  it("fetches exactly one token and threads it into the constructed provider instance", async () => {
    fetchSttToken.mockResolvedValue({ token: "tok-abc", provider: "deepgram", expiresIn: 60 });
    const onTranscript = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();

    const stream = await createSttStream({ speaker: "them", onTranscript, onStatus, onError });

    expect(fetchSttToken).toHaveBeenCalledTimes(1);
    expect(stream).toBeInstanceOf(FakeDeepgramStream);
    // The token minted by that one fetch must reach the provider, not be
    // dropped after having been read for its `provider` field.
    expect(stream.options.token).toBe("tok-abc");
    expect(stream.options.speaker).toBe("them");
    expect(stream.options.onTranscript).toBe(onTranscript);
    expect(stream.options.onStatus).toBe(onStatus);
    expect(stream.options.onError).toBe(onError);
  });

  it("resolves to an instance that has not been connected", async () => {
    fetchSttToken.mockResolvedValue({ token: "tok-1", provider: "deepgram" });

    const stream = await createSttStream({ speaker: "them" });

    // createSttStream only constructs the provider; connect() is the
    // caller's job. FakeDeepgramStream.connect() sets `connected`, so its
    // absence here proves it was never invoked during selection.
    expect(stream.connected).toBeUndefined();
  });

  it("falls back to Deepgram when the token response omits a provider field", async () => {
    fetchSttToken.mockResolvedValue({ token: "tok-2" });

    const stream = await createSttStream({});

    expect(stream).toBeInstanceOf(FakeDeepgramStream);
    expect(stream.options.token).toBe("tok-2");
  });

  it("falls back to Deepgram when the token response names an unrecognized provider", async () => {
    fetchSttToken.mockResolvedValue({ token: "tok-3", provider: "acme-transcribe" });

    const stream = await createSttStream({});

    expect(fetchSttToken).toHaveBeenCalledTimes(1);
    expect(stream).toBeInstanceOf(FakeDeepgramStream);
    expect(stream.options.token).toBe("tok-3");
  });

  it("selects ElevenLabs when the token response names it", async () => {
    fetchSttToken.mockResolvedValue({ token: "tok-el", provider: "elevenlabs" });

    const stream = await createSttStream({});

    expect(fetchSttToken).toHaveBeenCalledTimes(1);
    expect(stream).toBeInstanceOf(FakeElevenLabsStream);
    expect(stream.options.token).toBe("tok-el");
  });

  it("still resolves to a usable Deepgram instance with no injected token when the fetch throws", async () => {
    fetchSttToken.mockRejectedValue(new Error("network down"));

    const stream = await createSttStream({ speaker: "them" });

    expect(fetchSttToken).toHaveBeenCalledTimes(1);
    expect(stream).toBeInstanceOf(FakeDeepgramStream);
    // No token was ever minted, so none is threaded through — the
    // constructed instance's own connect() is left to attempt (and
    // surface) the real fetch failure, not this function.
    expect(stream.options.token).toBeUndefined();
  });

  it("passes an explicit provider argument through without skipping the token fetch", async () => {
    fetchSttToken.mockResolvedValue({ token: "tok-4", provider: "some-other-provider" });

    const stream = await createSttStream({ speaker: "them", provider: "deepgram" });

    // The explicit argument does not short-circuit the fetch — it only
    // changes which provider name is looked up once the fetch settles.
    expect(fetchSttToken).toHaveBeenCalledTimes(1);
    expect(stream).toBeInstanceOf(FakeDeepgramStream);
    // The fetched token still reaches the instance even though the caller,
    // not the response body, decided the provider — nothing about the
    // mint goes to waste just because the choice was forced.
    expect(stream.options.token).toBe("tok-4");
  });
});
