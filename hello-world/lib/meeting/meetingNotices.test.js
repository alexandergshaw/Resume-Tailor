import { describe, it, expect } from "vitest";
import {
  meetingSttProviderName,
  recordingConsentNotice,
  engineCaveatNotice,
  speakerAttributionNotice,
} from "./meetingNotices.js";

// Every expected string below is a literal oracle, not a re-derivation of
// the implementation — the point of this file is that a wording edit which
// quietly weakens a consent or privacy claim shows up as a failing
// assertion, the same discipline lib/copilot/groundingNotice.test.js
// applies to the interview copilot's own privacy notices.

describe("meetingSttProviderName", () => {
  it("names Deepgram", () => {
    expect(meetingSttProviderName("deepgram")).toBe("Deepgram");
  });

  it("names ElevenLabs", () => {
    expect(meetingSttProviderName("elevenlabs")).toBe("ElevenLabs");
  });

  it("is null for an unrecognised or missing provider — never guesses one", () => {
    expect(meetingSttProviderName("assemblyai")).toBeNull();
    expect(meetingSttProviderName(undefined)).toBeNull();
  });
});

describe("recordingConsentNotice", () => {
  it("carries all-party-consent wording for an in-person, shared-microphone meeting", () => {
    expect(recordingConsentNotice("inperson", "Deepgram")).toBe(
      "Recording notice: this in-person conversation is recorded and streamed to Deepgram for transcription. Everyone in the room is being recorded, not just you, so get their consent before you start; some regions require all-party consent.",
    );
  });

  it("names the provider for a call the same way, but with the call's own wording", () => {
    expect(recordingConsentNotice("tab", "ElevenLabs")).toBe(
      "Recording notice: audio is streamed to ElevenLabs for transcription. Make sure everyone on the call consents before you start; some regions require all-party consent.",
    );
  });

  it("treats system audio as a call, not as in-person", () => {
    expect(recordingConsentNotice("system", "Deepgram")).toBe(
      "Recording notice: audio is streamed to Deepgram for transcription. Make sure everyone on the call consents before you start; some regions require all-party consent.",
    );
  });

  it("omits the provider clause instead of naming an unknown one", () => {
    expect(recordingConsentNotice("inperson", null)).toBe(
      "Recording notice: this in-person conversation is recorded and streamed for transcription. Everyone in the room is being recorded, not just you, so get their consent before you start; some regions require all-party consent.",
    );
    expect(recordingConsentNotice("tab", "")).toBe(
      "Recording notice: audio is streamed for transcription. Make sure everyone on the call consents before you start; some regions require all-party consent.",
    );
  });
});

describe("engineCaveatNotice — audio leaves the machine on EVERY engine", () => {
  it("says the embedded engine only localizes insights, not transcription", () => {
    expect(engineCaveatNotice("embedded", "Deepgram")).toBe(
      "Audio still leaves this machine to Deepgram for transcription on every engine, including this one — choosing the embedded engine only keeps insight generation local (it reads the transcript on this server with no AI provider); it does not make the transcription itself local.",
    );
  });

  it("falls back to a generic provider clause when the provider is not yet known, even on embedded", () => {
    expect(engineCaveatNotice("embedded", null)).toBe(
      "Audio still leaves this machine to a speech-to-text provider for transcription on every engine, including this one — choosing the embedded engine only keeps insight generation local (it reads the transcript on this server with no AI provider); it does not make the transcription itself local.",
    );
  });

  it("says audio and the transcript both leave the machine on a non-embedded engine", () => {
    expect(engineCaveatNotice("gemini", "ElevenLabs")).toBe(
      "Audio leaves this machine to ElevenLabs for transcription, and the transcript is sent to Google Gemini to generate insights.",
    );
  });

  // Positive control for the load-bearing claim: the embedded notice must
  // still assert audio leaves the machine, not merely omit denying it. A
  // stub that returned "" for the embedded engine would incorrectly pass a
  // naive "does not claim local transcription" check without this.
  it("never claims transcription itself is local, on either engine", () => {
    expect(engineCaveatNotice("embedded", "Deepgram")).toMatch(/leaves this machine/);
    expect(engineCaveatNotice("gemini", "Deepgram")).toMatch(/leaves this machine/);
  });
});

describe("speakerAttributionNotice", () => {
  it("explains the missing attribution for a shared in-person microphone", () => {
    expect(speakerAttributionNotice("inperson")).toBe(
      "One microphone is recording everyone in the room, so turns below are not attributed to a specific speaker.",
    );
  });

  // Positive/negative pair: a call has structurally separate streams, so
  // there is nothing to caveat. Paired with the "inperson" case above so
  // this assertion cannot pass merely because the function always returns
  // "".
  it("returns nothing for a call, where the two streams are structurally separate", () => {
    expect(speakerAttributionNotice("tab")).toBe("");
    expect(speakerAttributionNotice("system")).toBe("");
  });
});
