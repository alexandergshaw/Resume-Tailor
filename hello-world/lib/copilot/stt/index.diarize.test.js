import { beforeEach, describe, expect, it, vi } from "vitest";

// Written from AC-M1.1 BEFORE diarization existed.
//
// Deliberately mocks ONLY ./token, so the REAL DeepgramStream and
// ElevenLabsStream classes are used. index.test.js mocks both provider classes
// because it is testing wiring; this file is testing a CAPABILITY, and a
// capability asserted against a test double asserts nothing about the real
// provider. Constructing a provider does not open a socket - only connect()
// does - so using the real classes here is safe in a node environment.
//
// The fact under test, and why it cannot be inferred: Deepgram's live API can
// diarize, and ElevenLabs Scribe v2 Realtime cannot at all (it is a batch-only
// feature of Scribe v2). So "diarization was requested" and "diarization is
// happening" are genuinely different facts, and a caller must be able to tell
// them apart WITHOUT knowing which provider the server selected.

vi.mock("./token", () => ({ fetchSttToken: vi.fn() }));

import { createSttStream } from "./index";
import { fetchSttToken } from "./token";
import { DeepgramStream } from "./deepgram";
import { ElevenLabsStream } from "./elevenlabs";

function serverSelects(provider) {
  fetchSttToken.mockResolvedValue({ token: "test-token", provider });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provider diarization capability", () => {
  it("Deepgram declares that it can diarize", () => {
    expect(DeepgramStream.supportsDiarization).toBe(true);
  });

  it("ElevenLabs declares that it cannot", () => {
    expect(ElevenLabsStream.supportsDiarization).toBe(false);
  });
});

describe("createSttStream diarization threading", () => {
  it("reports diarization active when it was requested from a provider that supports it", async () => {
    serverSelects("deepgram");
    const stream = await createSttStream({ speaker: "you", diarize: true });

    expect(stream.diarizationActive).toBe(true);
  });

  it("reports diarization INACTIVE when the selected provider cannot do it", async () => {
    // The caller asked; the provider cannot. Both facts are true at once, and
    // conflating them is how the UI ends up claiming speakers are separated
    // when every word is landing under one label.
    serverSelects("elevenlabs");
    const stream = await createSttStream({ speaker: "you", diarize: true });

    expect(stream.diarizationActive).toBe(false);
  });

  it("does not throw when diarization is requested from a provider that cannot do it", async () => {
    serverSelects("elevenlabs");

    await expect(createSttStream({ speaker: "you", diarize: true })).resolves.toBeDefined();
  });

  it("reports diarization inactive when it was not requested", async () => {
    serverSelects("deepgram");
    const stream = await createSttStream({ speaker: "you", diarize: false });

    expect(stream.diarizationActive).toBe(false);
  });

  it("reports diarization inactive when the option is omitted entirely", async () => {
    serverSelects("deepgram");
    const stream = await createSttStream({ speaker: "you" });

    expect(stream.diarizationActive).toBe(false);
  });

  it("still falls back to Deepgram when the token fetch fails, with diarization inactive", async () => {
    // The existing fallback must not change shape just because a new option
    // exists: no token means the provider's own connect() will surface the real
    // error, and nothing here may claim diarization is running.
    fetchSttToken.mockRejectedValue(new Error("token route down"));
    const stream = await createSttStream({ speaker: "you", diarize: true });

    expect(stream).toBeInstanceOf(DeepgramStream);
    expect(stream.diarizationActive).toBe(false);
  });
});
