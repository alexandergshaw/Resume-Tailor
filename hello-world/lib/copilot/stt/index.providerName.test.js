import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("./token", () => ({ fetchSttToken: vi.fn() }));

import { createSttStream } from "./index.js";
import { fetchSttToken } from "./token";

// AC-W1.1. Which speech-to-text provider a session actually ran on.
//
// `createSttStream` already decides this — it fetches a token, reads the
// server's `provider` field, and looks up a class — and then throws the answer
// away. Every consumer downstream is left unable to say which provider it is
// talking to, and the interview session log renders "- Provider: unknown" on
// every single download as a result. A user debugging a session where every
// voice was labelled the same, or where speaker-dependent features were inert,
// has no way to tell from their own log whether they were on ElevenLabs
// (no realtime diarization at all) or Deepgram (which has it).
//
// The value recorded here is the provider ACTUALLY SELECTED, not the one the
// server said it prefers. Those differ in a case that matters: when the token
// fetch fails, selection falls through to the Deepgram default. A log naming
// the configured provider would be wrong in exactly the situation someone
// downloads a log to investigate. This is set on the same line as
// `diarizationActive`, which already exists for the same reason and already
// distinguishes "requested" from "actually happened".

class FakeWebSocket {}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => {
  delete globalThis.WebSocket;
});

describe("createSttStream records the provider it selected (AC-W1.1)", () => {
  it("reports the provider the server named", async () => {
    fetchSttToken.mockResolvedValue({ token: "t", provider: "elevenlabs" });
    const stream = await createSttStream({ speaker: "them" });
    expect(stream.providerName).toBe("elevenlabs");
  });

  it("reports deepgram when the server names deepgram", async () => {
    fetchSttToken.mockResolvedValue({ token: "t", provider: "deepgram" });
    const stream = await createSttStream({ speaker: "them" });
    expect(stream.providerName).toBe("deepgram");
  });

  it("reports the provider an explicit override selected", async () => {
    // An explicitly-passed provider skips the server's opinion entirely (and
    // skips the token fetch's influence on selection), so the recorded name
    // has to follow the override, not the response.
    fetchSttToken.mockResolvedValue({ token: "t", provider: "deepgram" });
    const stream = await createSttStream({ speaker: "them", provider: "elevenlabs" });
    expect(stream.providerName).toBe("elevenlabs");
  });

  it("reports the DEFAULT that a failed token fetch actually fell back to", async () => {
    // The case the whole field exists for. A failed fetch leaves `selected`
    // undefined and the lookup falls through to DeepgramStream — so the
    // session really is on Deepgram, whatever STT_PROVIDER says. A log that
    // named the configured provider here would be wrong precisely when
    // someone is reading it to find out what went wrong.
    fetchSttToken.mockRejectedValue(new Error("token fetch failed"));
    const stream = await createSttStream({ speaker: "them" });
    expect(stream.providerName).toBe("deepgram");
  });

  it("reports the default when the server names a provider that does not exist", async () => {
    // Same rule, different cause: the lookup falls through to the Deepgram
    // default, so that is what the session is on and that is what is recorded.
    fetchSttToken.mockResolvedValue({ token: "t", provider: "not-a-provider" });
    const stream = await createSttStream({ speaker: "them" });
    expect(stream.providerName).toBe("deepgram");
  });

  it("still reports diarizationActive exactly as it did before", () => {
    // The negative control for a change made on the same two lines. This is
    // load-bearing: `diarizationActive` gates the "can't tell speakers apart"
    // warning and the whole cue-availability policy, and breaking it while
    // adding a diagnostic field would be a bad trade.
    fetchSttToken.mockResolvedValue({ token: "t", provider: "deepgram" });
    return createSttStream({ speaker: "them", diarize: true }).then((stream) => {
      expect(stream.diarizationActive).toBe(true);
      expect(stream.providerName).toBe("deepgram");
    });
  });

  it("reports the provider even when diarization was never requested", async () => {
    // The two facts are independent. A meeting session asks for no
    // attribution at all and still deserves a log that names its provider.
    fetchSttToken.mockResolvedValue({ token: "t", provider: "elevenlabs" });
    const stream = await createSttStream({ speaker: "them", diarize: false });
    expect(stream.diarizationActive).toBe(false);
    expect(stream.providerName).toBe("elevenlabs");
  });
});
