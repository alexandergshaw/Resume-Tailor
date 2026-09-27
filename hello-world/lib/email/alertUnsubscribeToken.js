// N60 S5 (AC-E3) -- a one-click unsubscribe that works with no session. That
// means a signed, opaque token: not a raw user id (guessable, and it would let
// anyone who merely knows a user's id turn off their alerts), and not a
// session (the whole point is the link works after the browser that received
// the email has no session at all).
//
// Format: `${base64url(JSON.stringify({userId}))}.${hmacHex}`. The signature
// is an HMAC-SHA256 over the payload segment, keyed by ALERT_UNSUBSCRIBE_SECRET.
//
// Deliberately NO fallback to an empty HMAC key when the secret is unset:
// `createHmac("sha256", "")` succeeds silently, which would make every token
// verify under an attacker-guessable key -- the same defeat recorded against
// lib/oauth/state.js. Both signing and verifying refuse outright when the
// secret is unset; verifying reports the reason as exactly "no-secret" so
// that refusal is never confused with an ordinary bad-signature rejection.

import { createHmac, timingSafeEqual } from "crypto";

const SECRET_ENV = "ALERT_UNSUBSCRIBE_SECRET";
const UNSUBSCRIBE_PATH = "/api/alerts/unsubscribe";

function readSecret() {
  const secret = process.env[SECRET_ENV];
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

function sign(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("hex");
}

// Compares the two signatures as their literal encoded characters, not as the
// numeric value they decode to -- hex is case-insensitive on decode (`"a"`
// and `"A"` are the same nibble), so decoding first would let a single-case
// flip of the trailing character in a valid signature slip through unnoticed.
function signaturesMatch(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Mint an unsubscribe token scoped to one account. Returns null when the
 * secret is unset (refuses to mint rather than signing under a guessable key).
 * @param {string} userId
 * @returns {string|null}
 */
export function signUnsubscribeToken(userId) {
  const secret = readSecret();
  if (!secret || typeof userId !== "string" || !userId) return null;

  const payloadB64 = Buffer.from(JSON.stringify({ userId }), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify an unsubscribe token. Never throws. The returned shape carries only
 * what the caller needs to act ("turn alerts off for this account") -- no
 * email, role, or session id -- so a verified token cannot be used for
 * anything beyond that one action.
 * @param {string|null|undefined} token
 * @returns {{ ok: true, userId: string } | { ok: false, reason: string }}
 */
export function verifyUnsubscribeToken(token) {
  const secret = readSecret();
  if (!secret) return { ok: false, reason: "no-secret" };

  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sig] = parts;

  let expected;
  try {
    expected = sign(payloadB64, secret);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!signaturesMatch(sig, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.userId !== "string" || !parsed.userId) {
      return { ok: false, reason: "malformed" };
    }
    return { ok: true, userId: parsed.userId };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/**
 * Build the absolute one-click unsubscribe URL embedded in outbound mail.
 * Returns null when either argument is missing, so a caller that cannot mint
 * a real link is never tempted to embed a broken or relative one.
 * @param {string|null} token
 * @param {string|null} baseUrl
 * @returns {string|null}
 */
export function unsubscribeUrl(token, baseUrl) {
  if (typeof token !== "string" || !token) return null;
  if (typeof baseUrl !== "string" || !baseUrl) return null;

  const trimmedBase = baseUrl.replace(/\/+$/, "");
  return `${trimmedBase}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}
