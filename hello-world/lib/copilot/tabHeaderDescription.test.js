// copilotTabDescription: the copilot tab's one-line description per mode, moved
// out of CopilotClient.js. The exact strings are pinned here so the extraction
// is provably byte-for-byte (the rendered text is also covered through the real
// client by CopilotClient.roles.test.js and CopilotClient.mobileStack.test.js).

import { describe, it, expect } from "vitest";
import { copilotTabDescription } from "./tabHeaderDescription.js";

const base = { mode: "live", live: false, isMobile: false, isEmbedded: false, sttProviderName: null };
const desc = (over) => copilotTabDescription({ ...base, ...over });

const LIVE = "Live transcription, question detection, and suggested answers during interviews.";
const ROLE_LEAD =
  "Answer a workplace situation out loud in a professional role’s register, then record yourself answering it and reveal a model answer for its cadence and vocabulary";

describe("copilotTabDescription: the three modes", () => {
  it("live mode (and any unrecognised mode) gets the live line", () => {
    expect(desc({})).toBe(LIVE);
    expect(desc({ mode: "something-else" })).toBe(LIVE);
  });

  it("practice mode names the STT provider only once it is known", () => {
    expect(desc({ mode: "practice" })).toBe(
      "Practice speaking out loud with your camera and mic — see the notice below for what's sent to Gemini.",
    );
    expect(desc({ mode: "practice", sttProviderName: "Deepgram" })).toBe(
      "Practice speaking out loud with your camera and mic — see the notice below for what's sent to Deepgram or Gemini.",
    );
  });

  it("speak-as on the embedded engine scopes the guarantee: server-side, no AI provider, audio still goes to STT", () => {
    const text = desc({ mode: "roles", isEmbedded: true, sttProviderName: "Deepgram" });
    expect(text.startsWith(ROLE_LEAD)).toBe(true);
    expect(text).toContain("generated on this server with no AI provider, so nothing is sent to Google");
    expect(text).toContain("Recording still sends your audio to a speech-to-text provider");
    // The embedded line does not interpolate the provider name.
    expect(text).not.toContain("Deepgram");
  });

  it("speak-as on the Gemini engine names the provider when known and says what reaches Google", () => {
    const named = desc({ mode: "roles", sttProviderName: "Deepgram" });
    expect(named.startsWith(ROLE_LEAD)).toBe(true);
    expect(named).toContain("Recording sends audio to Deepgram for transcription");
    expect(named).toContain("sends it for feedback to Google Gemini");
    expect(named).toContain("Revealing a model answer also sends the role and the situation text to Google.");
    expect(desc({ mode: "roles" })).toContain("Recording sends audio for transcription");
  });

  it("the embedded and Gemini speak-as lines differ", () => {
    expect(desc({ mode: "roles", isEmbedded: true })).not.toBe(desc({ mode: "roles" }));
  });
});

describe("copilotTabDescription: a phone mid-session shows no description", () => {
  it("is undefined for every mode when live AND mobile", () => {
    for (const mode of ["live", "practice", "roles"]) {
      expect(desc({ mode, live: true, isMobile: true })).toBeUndefined();
    }
  });

  it("[controls] live alone, or mobile alone, still shows it", () => {
    expect(desc({ live: true, isMobile: false })).toBe(LIVE);
    expect(desc({ live: false, isMobile: true })).toBe(LIVE);
  });
});
