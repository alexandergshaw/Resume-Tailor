import { describe, it, expect } from "vitest";
import { wantsEmbedded } from "./featureEngine.js";

describe("wantsEmbedded", () => {
  const withKey = { Gemini_LLM_API_Key: "k" };
  const noKey = {};

  it("honors an explicit embedded request regardless of key/default", () => {
    expect(wantsEmbedded("embedded", withKey)).toBe(true);
    expect(wantsEmbedded("EMBEDDED", withKey)).toBe(true);
    expect(wantsEmbedded("embedded", { ...withKey, RESUME_ENGINE: "gemini" })).toBe(true);
  });

  it("honors an explicit gemini/external request as not-embedded", () => {
    expect(wantsEmbedded("gemini", withKey)).toBe(false);
    expect(wantsEmbedded("external", withKey)).toBe(false);
    // external has no deterministic aux path — behaves like gemini even with no key
    expect(wantsEmbedded("external", noKey)).toBe(false);
    expect(wantsEmbedded("gemini", noKey)).toBe(false);
  });

  it("falls back to the server default when no engine is requested", () => {
    expect(wantsEmbedded("", { ...withKey, RESUME_ENGINE: "embedded" })).toBe(true);
    expect(wantsEmbedded(null, { ...withKey, RESUME_ENGINE: "gemini" })).toBe(false);
    expect(wantsEmbedded(undefined, { ...noKey, RESUME_ENGINE: "external" })).toBe(false);
  });

  it("uses embedded when Gemini is not configured and nothing is specified", () => {
    expect(wantsEmbedded("", noKey)).toBe(true);
    expect(wantsEmbedded(undefined, noKey)).toBe(true);
  });

  it("prefers Gemini when a key is present and nothing is specified", () => {
    expect(wantsEmbedded("", withKey)).toBe(false);
  });
});
