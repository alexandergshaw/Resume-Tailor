import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getServerEnv,
  getDeepgramApiKey,
  getSttProvider,
  getElevenLabsApiKey,
  getLlmSearchIntervalMinutes,
} from "./env.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.Gemini_LLM_API_Key;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.STT_PROVIDER;
  delete process.env.ELEVENLABS_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getDeepgramApiKey", () => {
  it("returns the DEEPGRAM_API_KEY value when set", () => {
    process.env.DEEPGRAM_API_KEY = "dg-secret-token";
    expect(getDeepgramApiKey()).toBe("dg-secret-token");
  });

  it("returns null when DEEPGRAM_API_KEY is unset", () => {
    expect(getDeepgramApiKey()).toBeNull();
  });

  it("does not throw when Gemini_LLM_API_Key is absent", () => {
    delete process.env.Gemini_LLM_API_Key;
    process.env.DEEPGRAM_API_KEY = "dg-secret-token";
    expect(() => getDeepgramApiKey()).not.toThrow();
    expect(getDeepgramApiKey()).toBe("dg-secret-token");
  });
});

describe("getSttProvider", () => {
  it("returns 'elevenlabs' when STT_PROVIDER is set to it", () => {
    process.env.STT_PROVIDER = "elevenlabs";
    expect(getSttProvider()).toBe("elevenlabs");
  });

  it("returns 'deepgram' when STT_PROVIDER is unset", () => {
    delete process.env.STT_PROVIDER;
    expect(getSttProvider()).toBe("deepgram");
  });

  it("returns 'deepgram' when STT_PROVIDER is an empty string", () => {
    process.env.STT_PROVIDER = "";
    expect(getSttProvider()).toBe("deepgram");
  });

  it("returns 'deepgram' when STT_PROVIDER is an unrecognized value", () => {
    process.env.STT_PROVIDER = "whisper";
    expect(getSttProvider()).toBe("deepgram");
  });
});

describe("getElevenLabsApiKey", () => {
  it("returns the ELEVENLABS_API_KEY value when set", () => {
    process.env.ELEVENLABS_API_KEY = "el-secret-token";
    expect(getElevenLabsApiKey()).toBe("el-secret-token");
  });

  it("returns null when ELEVENLABS_API_KEY is unset", () => {
    expect(getElevenLabsApiKey()).toBeNull();
  });

  it("does not throw when Gemini_LLM_API_Key is absent", () => {
    delete process.env.Gemini_LLM_API_Key;
    process.env.ELEVENLABS_API_KEY = "el-secret-token";
    expect(() => getElevenLabsApiKey()).not.toThrow();
    expect(getElevenLabsApiKey()).toBe("el-secret-token");
  });
});

describe("getLlmSearchIntervalMinutes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 60 when LLM_SEARCH_INTERVAL_MINUTES is unset", () => {
    vi.stubEnv("LLM_SEARCH_INTERVAL_MINUTES", undefined);
    expect(getLlmSearchIntervalMinutes()).toBe(60);
  });

  it("honours a valid override", () => {
    vi.stubEnv("LLM_SEARCH_INTERVAL_MINUTES", "15");
    expect(getLlmSearchIntervalMinutes()).toBe(15);
  });

  it("falls back to 60 for a non-numeric value", () => {
    vi.stubEnv("LLM_SEARCH_INTERVAL_MINUTES", "soon");
    expect(getLlmSearchIntervalMinutes()).toBe(60);
  });

  it("falls back to 60 for a zero value", () => {
    vi.stubEnv("LLM_SEARCH_INTERVAL_MINUTES", "0");
    expect(getLlmSearchIntervalMinutes()).toBe(60);
  });

  it("falls back to 60 for a negative value", () => {
    vi.stubEnv("LLM_SEARCH_INTERVAL_MINUTES", "-10");
    expect(getLlmSearchIntervalMinutes()).toBe(60);
  });
});

describe("getServerEnv", () => {
  it("still throws when Gemini_LLM_API_Key is missing", () => {
    expect(() => getServerEnv()).toThrow(
      /Missing required environment variables: Gemini_LLM_API_Key/,
    );
  });

  it("still returns its existing fields when Gemini_LLM_API_Key is present", () => {
    process.env.Gemini_LLM_API_Key = "gemini-secret";
    process.env.DEEPGRAM_API_KEY = "dg-secret-token";
    const env = getServerEnv();
    expect(env.geminiApiKey).toBe("gemini-secret");
    expect(env.geminiModel).toBe("gemini-2.5-flash");
    expect(env.deepgramApiKey).toBe("dg-secret-token");
    expect(env.resumeEngine).toBe("gemini");
  });

  it("defaults deepgramApiKey to null when DEEPGRAM_API_KEY is unset", () => {
    process.env.Gemini_LLM_API_Key = "gemini-secret";
    const env = getServerEnv();
    expect(env.deepgramApiKey).toBeNull();
  });

  it("is unaffected by STT_PROVIDER and ELEVENLABS_API_KEY being set", () => {
    process.env.Gemini_LLM_API_Key = "gemini-secret";
    process.env.DEEPGRAM_API_KEY = "dg-secret-token";
    process.env.STT_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-secret-token";
    const env = getServerEnv();
    expect(env.geminiApiKey).toBe("gemini-secret");
    expect(env.deepgramApiKey).toBe("dg-secret-token");
    expect(env).not.toHaveProperty("sttProvider");
    expect(env).not.toHaveProperty("elevenLabsApiKey");
  });
});
