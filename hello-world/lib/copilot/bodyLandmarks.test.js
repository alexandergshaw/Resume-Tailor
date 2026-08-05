import { describe, it, expect } from "vitest";
import { isMediaPipeTelemetryUrl } from "./bodyLandmarks";

// BUG-4 / see public/mediapipe/models/README.md's "MediaPipe telemetry"
// section: the installed @mediapipe/tasks-vision bundle POSTs a usage-stats
// beacon to this exact host on a timer and on close(), with no working
// opt-out -- the `enableLogging` method its own type definitions advertise
// does not exist in the shipped 1.0.1 runtime. bodyLandmarks.js patches
// `fetch` so any request to this host is answered locally instead of ever
// leaving the browser, which is the only thing that makes this feature's
// "fully on-device, even on the embedded engine" claim actually true.
// isMediaPipeTelemetryUrl is the pure matcher that decides which requests
// get intercepted -- these tests exist to keep that match exact: too loose
// and an unrelated Google endpoint the app legitimately needs gets silently
// swallowed; too strict, or spoofable by a look-alike host, and the
// telemetry this guard exists to block leaks straight through.
const TELEMETRY_URL = "https://odml.pa.googleapis.com/v1/log";

describe("isMediaPipeTelemetryUrl", () => {
  it("matches the exact MediaPipe telemetry host", () => {
    expect(isMediaPipeTelemetryUrl(TELEMETRY_URL)).toBe(true);
  });

  it("matches regardless of scheme, trailing path, or query string on the same host", () => {
    expect(isMediaPipeTelemetryUrl("https://odml.pa.googleapis.com/")).toBe(true);
    expect(isMediaPipeTelemetryUrl("http://odml.pa.googleapis.com/v1/log?batch=1")).toBe(true);
  });

  it("does not match a look-alike host with the real host as a subdomain-suffix prefix of an attacker domain", () => {
    // If the guard matched with .includes()/.startsWith() instead of an
    // exact hostname ===, this URL's real hostname --
    // "odml.pa.googleapis.com.attacker.com" -- would slip through: it
    // *contains* the telemetry host as a leading substring, but it parses
    // as a completely different, attacker-owned domain, not a subdomain of
    // googleapis.com at all.
    expect(isMediaPipeTelemetryUrl("https://odml.pa.googleapis.com.attacker.com/v1/log")).toBe(
      false,
    );
  });

  it("does not match a look-alike host that merely contains the telemetry host as a substring", () => {
    expect(isMediaPipeTelemetryUrl("https://not-odml.pa.googleapis.com/v1/log")).toBe(false);
    expect(isMediaPipeTelemetryUrl("https://evil.example/odml.pa.googleapis.com")).toBe(false);
  });

  it("does not match an unrelated googleapis host the app legitimately talks to", () => {
    // storage.googleapis.com is the CDN bodyLandmarks.js deliberately never
    // fetches models/wasm from at runtime (AC-D2-1) -- it must stay
    // reachable rather than get swept up by an over-broad "*.googleapis.com"
    // match.
    expect(isMediaPipeTelemetryUrl("https://storage.googleapis.com/mediapipe-models/x")).toBe(
      false,
    );
    expect(isMediaPipeTelemetryUrl("https://www.googleapis.com/v1/log")).toBe(false);
  });

  it("returns false, without throwing, for null or undefined input", () => {
    expect(isMediaPipeTelemetryUrl(null)).toBe(false);
    expect(isMediaPipeTelemetryUrl(undefined)).toBe(false);
  });

  it("returns false, without throwing, for an empty string", () => {
    expect(isMediaPipeTelemetryUrl("")).toBe(false);
  });

  it("returns false, without throwing, for a relative URL", () => {
    expect(isMediaPipeTelemetryUrl("/v1/log")).toBe(false);
  });

  it("returns false, without throwing, for a malformed URL", () => {
    expect(isMediaPipeTelemetryUrl("http://[")).toBe(false);
  });

  it("matches a URL object pointed at the telemetry host", () => {
    expect(isMediaPipeTelemetryUrl(new URL(TELEMETRY_URL))).toBe(true);
  });

  it("does not throw on a Request object, and does not match one since a Request has no custom toString", () => {
    // installTelemetryGuard (the actual fetch patch) extracts `.url` from a
    // Request before ever calling this function, so this isn't exercising
    // that end-to-end path -- it documents this exported pure function's own
    // contract on an input shape it was never designed for: Request doesn't
    // override toString, so String(request) is the literal "[object
    // Request]", not its href. That must fail closed (no match) rather than
    // throw and crash the surrounding fetch monkeypatch.
    const request = new Request(TELEMETRY_URL);
    expect(isMediaPipeTelemetryUrl(request)).toBe(false);
  });
});
