import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// verifyDriveOAuthState composes straight through to lib/oauth/state.js's
// verifyOAuthState, which reaches Redis through @/lib/cache/redisClient's
// DEFAULT export. Mock it the same way lib/oauth/state.test.js does so these
// tests control the replay store rather than depending on a real one.
vi.mock("@/lib/cache/redisClient", () => ({ default: vi.fn(() => null) }));

import getRedisClient from "@/lib/cache/redisClient";
import { createOAuthState } from "@/lib/oauth/state";
import {
  stateCookieName,
  STATE_COOKIE_MAX_AGE_SECONDS,
  newStateNonce,
  matchesNonce,
  createDriveOAuthState,
  verifyDriveOAuthState,
} from "./oauthState.js";

const SELF_PATH = fileURLToPath(new URL("./oauthState.js", import.meta.url));

const SECRET = "drive-oauth-state-join-test-secret";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";

const ENV_KEYS = ["OAUTH_STATE_SECRET", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OAUTH_STATE_SECRET = SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;
  getRedisClient.mockReset();
  getRedisClient.mockReturnValue(null);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("stateCookieName / STATE_COOKIE_MAX_AGE_SECONDS", () => {
  it("is exactly drive_oauth_state, matching ARCH.md §7.1's Set-Cookie line", () => {
    expect(stateCookieName).toBe("drive_oauth_state");
  });

  it("is exactly 600 seconds, matching the documented Max-Age", () => {
    expect(STATE_COOKIE_MAX_AGE_SECONDS).toBe(600);
  });
});

describe("newStateNonce", () => {
  it("returns a 64-character lowercase hex string (32 bytes)", () => {
    expect(newStateNonce()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different value on every call (positive control: not hardcoded)", () => {
    const a = newStateNonce();
    const b = newStateNonce();
    const c = newStateNonce();
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("matchesNonce", () => {
  it("returns true when the cookie value matches the payload's nonce field (object form)", () => {
    expect(matchesNonce("abc123", { provider: "drive", nonce: "abc123" })).toBe(true);
  });

  it("returns true when the cookie value matches a bare nonce string", () => {
    expect(matchesNonce("abc123", "abc123")).toBe(true);
  });

  it("returns false when the values differ (positive control for the two above)", () => {
    expect(matchesNonce("abc123", { nonce: "def456" })).toBe(false);
    expect(matchesNonce("abc123", "def456")).toBe(false);
  });

  it("returns false when the cookie is missing — the AC-C19 replay scenario (cookie already cleared)", () => {
    expect(matchesNonce(undefined, { nonce: "abc123" })).toBe(false);
  });

  it("returns false when the cookie is an empty string", () => {
    expect(matchesNonce("", { nonce: "abc123" })).toBe(false);
  });

  it("returns false when BOTH the cookie and the candidate are empty strings (equal length is not a match)", () => {
    // Distinct from the case above: this specifically exercises the
    // explicit empty-string guard rather than the length-mismatch branch,
    // since two empty strings have EQUAL (zero) length.
    expect(matchesNonce("", "")).toBe(false);
    expect(matchesNonce("", { nonce: "" })).toBe(false);
  });

  it("returns false when the payload has no nonce field", () => {
    expect(matchesNonce("abc123", { provider: "drive" })).toBe(false);
  });

  it("returns false when the payload is null", () => {
    expect(matchesNonce("abc123", null)).toBe(false);
  });

  it("returns false when the payload is undefined", () => {
    expect(matchesNonce("abc123", undefined)).toBe(false);
  });

  it("returns false for a prefix match of differing length, without throwing", () => {
    // Regression guard: a naive substring/startsWith comparison would treat
    // "abc123" as matching "abc1234".
    expect(() => matchesNonce("abc123", "abc1234")).not.toThrow();
    expect(matchesNonce("abc123", "abc1234")).toBe(false);
  });

  it("returns false, without throwing, for non-string garbage input", () => {
    expect(matchesNonce(42, { nonce: "abc123" })).toBe(false);
    expect(matchesNonce("abc123", 42)).toBe(false);
    expect(matchesNonce("abc123", ["abc123"])).toBe(false);
    expect(matchesNonce(null, null)).toBe(false);
  });

  it("round-trips with a real newStateNonce() value", () => {
    const nonce = newStateNonce();
    expect(matchesNonce(nonce, { nonce })).toBe(true);
    expect(matchesNonce(nonce, { nonce: newStateNonce() })).toBe(false);
  });
});

describe("composition boundary (ARCH.md §6 — 'compose, do not replace')", () => {
  it("never reads or references replayChecked — Drive does not inherit the permissive replay posture", () => {
    const src = readFileSync(SELF_PATH, "utf8");
    // Allowed to DISCUSS replayChecked in a comment explaining why it's
    // avoided (this file's header does); it must never appear as code that
    // reads a `.replayChecked` property.
    expect(src).not.toMatch(/\.replayChecked/);
  });

  it("actually imports and calls the shared signing primitive from lib/oauth/state, rather than re-implementing it", () => {
    const src = readFileSync(SELF_PATH, "utf8");
    const codeLines = src
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));
    const importOrRequireLines = codeLines.filter(
      (line) => /\bimport\b/.test(line) || /\brequire\s*\(/.test(line),
    );
    // Positive control for the join below: if this import were ever removed,
    // createDriveOAuthState/verifyDriveOAuthState could not exist as written,
    // and the end-to-end tests further down would fail for real, not by luck.
    expect(importOrRequireLines.some((line) => /["']@\/lib\/oauth\/state["']/.test(line))).toBe(true);
  });
});

describe("createDriveOAuthState / verifyDriveOAuthState — the actual join", () => {
  // These feed createOAuthState's REAL output into verifyOAuthState and
  // matchesNonce end to end — the thing BLOCKER-1 found impossible to do at
  // all, and the thing the deleted decoupling-pinning test hid. No hand-built
  // `{nonce: "..."}` fixtures anywhere in this describe block.

  it("mints a state whose nonce is the same value returned for the cookie", () => {
    const { state, nonce } = createDriveOAuthState({ userId: USER });
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips: mint, then verify against the cookie value handed back at mint time", async () => {
    const { state, nonce } = createDriveOAuthState({ userId: USER, sessionId: "sess-1" });

    const result = await verifyDriveOAuthState(state, {
      userId: USER,
      sessionId: "sess-1",
      cookieValue: nonce,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects when the cookie does not match the nonce inside the verified state (stolen/forged cookie)", async () => {
    const { state } = createDriveOAuthState({ userId: USER });

    const result = await verifyDriveOAuthState(state, {
      userId: USER,
      cookieValue: newStateNonce(), // a different, unrelated nonce
    });

    expect(result).toEqual({ ok: false, reason: "nonce-mismatch" });
  });

  it("rejects when the cookie is absent (already cleared by a prior use — AC-C19)", async () => {
    const { state } = createDriveOAuthState({ userId: USER });

    const result = await verifyDriveOAuthState(state, { userId: USER, cookieValue: undefined });
    expect(result).toEqual({ ok: false, reason: "nonce-mismatch" });
  });

  it("a Gmail-minted state cannot verify at a Drive callback, even with the right nonce and cookie", async () => {
    // Uses the REAL Gmail producer (lib/oauth/state.js's createOAuthState
    // called with provider:"gmail", the exact call app/api/gmail/connect
    // makes) to prove the provider binding actually separates the two flows.
    const nonce = newStateNonce();
    const gmailState = createOAuthState({ provider: "gmail", userId: USER, nonce });

    const result = await verifyDriveOAuthState(gmailState, { userId: USER, cookieValue: nonce });
    expect(result).toEqual({ ok: false, reason: "wrong-provider" });
  });

  it("rejects a state minted for a different user, before the nonce is even considered", async () => {
    const { state, nonce } = createDriveOAuthState({ userId: USER });

    const result = await verifyDriveOAuthState(state, { userId: OTHER_USER, cookieValue: nonce });
    expect(result).toEqual({ ok: false, reason: "wrong-user" });
  });

  it("propagates a tampered signature as bad-signature, never as a nonce concern", async () => {
    const { state, nonce } = createDriveOAuthState({ userId: USER });
    const lastDot = state.lastIndexOf(".");
    const payload = state.slice(0, lastDot);
    const mac = state.slice(lastDot + 1);
    const at = 4;
    const swapped = payload[at] === "A" ? "B" : "A";
    const tampered = `${payload.slice(0, at)}${swapped}${payload.slice(at + 1)}.${mac}`;

    const result = await verifyDriveOAuthState(tampered, { userId: USER, cookieValue: nonce });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("never leaks a payload/nonce on the {ok:false} path", async () => {
    const { state } = createDriveOAuthState({ userId: USER });
    const result = await verifyDriveOAuthState(state, { userId: OTHER_USER, cookieValue: "irrelevant" });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("nonce");
    expect(result).not.toHaveProperty("payload");
  });
});
