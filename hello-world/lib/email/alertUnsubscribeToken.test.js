// N60 S5 (4b/TDD) -- AC-E3: a one-click unsubscribe that works WITHOUT a session.
// That implies a signed, opaque token (not a session, not a raw user id). This
// file pins the token's SECURITY PROPERTIES:
//   * a valid token verifies and yields ONLY the account it scopes to;
//   * it is not guessable and is not a raw user id;
//   * a tampered / foreign / cross-secret token refuses (unforgeable);
//   * it cannot be used for anything but "turn alerts off" (scope is a SHAPE);
//   * with the secret unset it refuses to mint and refuses to verify -- it must
//     NOT fall back to an empty HMAC key (createHmac("sha256","") SUCCEEDS and
//     would be a silent, total defeat, exactly the lib/oauth/state.js lesson).
//
// RED on HEAD: lib/email/alertUnsubscribeToken.js does not exist -> collection
// failure.
//
// NON-VACUITY: every rejection is paired with the acceptance of the untampered
// original under the same conditions, so a build that rejects everything cannot
// pass.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
} from "./alertUnsubscribeToken.js";

const UID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("alertUnsubscribeToken: a valid token verifies to exactly one account", () => {
  it("round-trips to the same userId", () => {
    const token = signUnsubscribeToken(UID);
    expect(typeof token).toBe("string");
    const v = verifyUnsubscribeToken(token);
    expect(v.ok).toBe(true);
    expect(v.userId).toBe(UID);
  });

  it("the verified result carries ONLY the scope it needs -- no session, email, or privileges", () => {
    // "Scope to exactly one action" as a SHAPE: the verify result must not carry
    // anything that could read or change other data. If it grew an `email`,
    // `role`, `sessionId` or similar, this fails.
    const v = verifyUnsubscribeToken(signUnsubscribeToken(UID));
    expect(new Set(Object.keys(v))).toEqual(new Set(["ok", "userId"]));
    expect(v.email).toBeUndefined();
    expect(v.role).toBeUndefined();
    expect(v.sessionId).toBeUndefined();
  });

  it("is opaque: the token is NOT the raw user id, and passing the raw id does not verify", () => {
    const token = signUnsubscribeToken(UID);
    expect(token).not.toBe(UID);
    // Not guessable from the id alone: an attacker who knows a user id cannot
    // unsubscribe them by submitting it as the token.
    expect(verifyUnsubscribeToken(UID).ok).toBe(false);
  });
});

describe("alertUnsubscribeToken: forgery and tampering are refused (unforgeable)", () => {
  it("a tampered signature refuses, while the untampered original verifies", () => {
    const token = signUnsubscribeToken(UID);
    expect(verifyUnsubscribeToken(token).ok).toBe(true); // companion control

    // Flip the last character of the signature segment.
    const last = token.slice(-1);
    const flipped = token.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(flipped).not.toBe(token);
    const v = verifyUnsubscribeToken(flipped);
    expect(v.ok).toBe(false);
  });

  it("a tampered PAYLOAD (different user id, re-encoded) refuses", () => {
    // Rebuild the payload segment for a DIFFERENT user but keep the original
    // signature: a build that does not recompute the MAC over the payload would
    // accept this.
    const token = signUnsubscribeToken(UID);
    const [payloadB64, sig] = token.split(".");
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const obj = JSON.parse(json);
    obj.userId = "99999999-0000-0000-0000-000000000000";
    const forgedPayload = Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
    const forged = `${forgedPayload}.${sig}`;

    const v = verifyUnsubscribeToken(forged);
    expect(v.ok).toBe(false);
    expect(v.userId).not.toBe("99999999-0000-0000-0000-000000000000");
  });

  it("garbage / empty / missing tokens refuse and never throw", () => {
    expect(verifyUnsubscribeToken("not-a-token").ok).toBe(false);
    expect(verifyUnsubscribeToken("").ok).toBe(false);
    expect(verifyUnsubscribeToken(null).ok).toBe(false);
    expect(verifyUnsubscribeToken(undefined).ok).toBe(false);
    expect(verifyUnsubscribeToken("a.b.c.d").ok).toBe(false);
  });

  it("a token minted under a DIFFERENT secret does not verify (cross-key unforgeability)", () => {
    vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "secret-A");
    const tokenA = signUnsubscribeToken(UID);
    expect(verifyUnsubscribeToken(tokenA).ok).toBe(true); // control under A

    vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "secret-B");
    expect(verifyUnsubscribeToken(tokenA).ok).toBe(false);
  });
});

describe("alertUnsubscribeToken: no secret means no token and no verification", () => {
  it("with the secret unset, signing returns null (refuses to mint)", () => {
    vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "");
    expect(signUnsubscribeToken(UID)).toBeNull();
  });

  it("with the secret unset, a token that WAS valid no longer verifies -- no empty-key fallback", () => {
    // Mint under a real secret, then remove it: verification must refuse rather
    // than silently validate under an empty HMAC key (the oauth-state defeat).
    vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "real-secret");
    const token = signUnsubscribeToken(UID);
    expect(verifyUnsubscribeToken(token).ok).toBe(true); // control with secret

    vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "");
    const v = verifyUnsubscribeToken(token);
    expect(v.ok).toBe(false);
    // Refused SPECIFICALLY because the secret is unset -- not incidentally because
    // a signature mismatched. This pins that no verification path runs under an
    // empty HMAC key (a build that fell back to "" would reach the signature
    // check and report bad-signature, or verify a token forged under "").
    expect(v.reason).toBe("no-secret");
  });
});

describe("unsubscribeUrl builds an absolute link carrying the token", () => {
  it("produces an absolute URL to the unsubscribe route with the token as a query param", () => {
    const url = unsubscribeUrl("TOK123", "https://app.example.com");
    expect(url).toBe("https://app.example.com/api/alerts/unsubscribe?token=TOK123");
  });

  it("derives from the argument (a different token yields a different URL, not a hardcoded one)", () => {
    const url = unsubscribeUrl("OTHER", "https://app.example.com");
    expect(url).toContain("token=OTHER");
    expect(url).not.toContain("token=TOK123");
  });

  it("tolerates a trailing slash on the base and returns null without a token or base", () => {
    expect(unsubscribeUrl("TOK", "https://app.example.com/")).toBe(
      "https://app.example.com/api/alerts/unsubscribe?token=TOK",
    );
    expect(unsubscribeUrl(null, "https://app.example.com")).toBeNull();
    expect(unsubscribeUrl("TOK", "")).toBeNull();
  });
});
