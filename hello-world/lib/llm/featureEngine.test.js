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

  // O-14/O-18: the rule is asymmetric -- a request may only NARROW
  // capability, never widen it. Running embedded is a de-escalation (no
  // spend, no egress) and is always honored. Running gemini/external is an
  // escalation and is blocked when the server default forbids it. Before the
  // fix, an explicit request short-circuited the default in BOTH directions,
  // letting one request-body field force a deployment the owner configured
  // offline into paid Gemini calls (with the candidate's resume in the
  // request) even though it was pinned to embedded.
  it("blocks an escalation: a configured embedded default overrides an explicit gemini/external request", () => {
    expect(wantsEmbedded("gemini", { ...withKey, RESUME_ENGINE: "embedded" })).toBe(true);
    expect(wantsEmbedded("external", { ...withKey, RESUME_ENGINE: "embedded" })).toBe(true);
  });

  it("permits a de-escalation: an explicit embedded request wins even over a non-embedded default", () => {
    expect(wantsEmbedded("embedded", { ...withKey, RESUME_ENGINE: "gemini" })).toBe(true);
    expect(wantsEmbedded("embedded", { ...withKey, RESUME_ENGINE: "external" })).toBe(true);
  });

  it("still honors an explicit request when the server has no configured default", () => {
    expect(wantsEmbedded("embedded", withKey)).toBe(true);
    expect(wantsEmbedded("gemini", withKey)).toBe(false);
  });

  it("keeps deferring to the server default for an unrecognized request (control)", () => {
    expect(wantsEmbedded("bogus", { RESUME_ENGINE: "embedded" })).toBe(true);
    expect(wantsEmbedded("bogus", { RESUME_ENGINE: "gemini" })).toBe(false);
  });
});
