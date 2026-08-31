import { randomBytes, timingSafeEqual } from "node:crypto";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth/state";

/**
 * Drive's own half of OAuth "state" handling — see `ARCH.md` §6 (Wave 2B's
 * "compose, do not replace" ruling) for the full reasoning this file
 * implements.
 *
 * The signed, provider-bound payload itself — signing, verification, expiry,
 * and the `provider` binding that stops a Gmail state from verifying at a
 * Drive callback — is `lib/oauth/state.js` (the Gmail chunk's shared helper,
 * `createOAuthState` / `verifyOAuthState`). This module COMPOSES with it
 * rather than re-implementing it: `createDriveOAuthState` / `verifyDriveOAuthState`
 * below call straight into the shared helper, passing `provider: "drive"` and
 * Drive's own nonce through `createOAuthState`'s optional `nonce` parameter so
 * the same random value that gets set as the `drive_oauth_state` HttpOnly
 * cookie also travels INSIDE the signed `state` parameter Google round-trips
 * back to the OAuth callback. `verifyDriveOAuthState` then compares the nonce
 * the shared helper hands back against the cookie via `matchesNonce`, so a
 * signed-but-cookie-mismatched state (or a cookie with no matching state) is
 * rejected even though the signature and provider/user/session binding all
 * check out.
 *
 * Deliberately NOT reused from `lib/oauth/state.js`: `replayChecked`. Its
 * `verifyOAuthState` returns `replayChecked: false` and its own docstring
 * says the caller should not reject on that — the replay layer degrades to
 * "not applied for this verification" whenever its Redis store is absent or
 * throws. Adopting that posture here would turn Drive's replay protection
 * from "always single-use" into "single-use only when Redis happens to be
 * configured and reachable", reintroducing exactly the silent-Redis
 * dependency this design rejects (`ARCH.md` §6, §9.1). Drive's replay
 * protection instead has NO store dependency at all: the callback clears
 * this cookie unconditionally on use (AC-C19), so a replayed callback finds
 * no cookie value left to match. `verifyDriveOAuthState` never reads the
 * shared helper's `replayChecked` field from its return value.
 */

/** Name of the HttpOnly cookie carrying Drive's connect-flow nonce. */
export const stateCookieName = "drive_oauth_state";

/**
 * `Max-Age` (seconds) for the state cookie — matches `ARCH.md` §7.1's
 * `Set-Cookie: drive_oauth_state=<nonce>; HttpOnly; SameSite=Lax; Max-Age=600`.
 */
export const STATE_COOKIE_MAX_AGE_SECONDS = 600;

/**
 * Mint a fresh, single-use, high-entropy nonce for one connect attempt.
 * 32 bytes (256 bits) of CSPRNG output, hex-encoded (64 hex characters).
 *
 * @returns {string}
 */
export function newStateNonce() {
  return randomBytes(32).toString("hex");
}

/**
 * True iff `cookieValue` (read from the `drive_oauth_state` cookie on the
 * callback request) matches the nonce carried by the verified `state`.
 * Constant-time, so a mismatch cannot be distinguished by response timing.
 *
 * Never throws: anything that is not two equal-length, non-empty strings is
 * simply a mismatch, so a caller never needs a try/catch around a nonce
 * check on top of the malformed-input handling `lib/oauth/state.js`
 * already does for the signature itself.
 *
 * @param {unknown} cookieValue - the raw cookie string, or undefined/null
 *   if the cookie was absent (e.g. already cleared by a prior use).
 * @param {unknown} statePayload - either the nonce string itself, or an
 *   object carrying it as a `nonce` field (the shape `verifyOAuthState`'s
 *   successful return value has) — accepting both keeps this function
 *   decoupled from exactly how the caller obtained the nonce.
 * @returns {boolean}
 */
export function matchesNonce(cookieValue, statePayload) {
  const candidate =
    typeof statePayload === "string"
      ? statePayload
      : statePayload && typeof statePayload === "object" && !Array.isArray(statePayload)
        ? statePayload.nonce
        : undefined;

  if (typeof cookieValue !== "string" || cookieValue.length === 0) return false;
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  const a = Buffer.from(cookieValue, "utf8");
  const b = Buffer.from(candidate, "utf8");
  // timingSafeEqual throws on a length mismatch rather than returning
  // false, so that case is handled explicitly first (also constant-time
  // with respect to nonce CONTENT, which is what matters here).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Mint Drive's OAuth state: a fresh single-use nonce, carried BOTH as the
 * value to set in the `drive_oauth_state` HttpOnly cookie AND inside the
 * shared helper's signed, provider/user/session-bound `state` payload — the
 * actual composition BLOCKER-1 found missing.
 *
 * @param {{ userId: string, sessionId?: string|null }} binding
 * @returns {{ state: string, nonce: string }} `state` is the opaque
 *   URL-safe value to send to Google; `nonce` is the same value the caller
 *   must set as the `drive_oauth_state` cookie.
 */
export function createDriveOAuthState({ userId, sessionId = null } = {}) {
  const nonce = newStateNonce();
  const state = createOAuthState({ provider: "drive", userId, sessionId, nonce });
  return { state, nonce };
}

/**
 * Verify Drive's OAuth `state` end-to-end: the shared helper's signature,
 * expiry, provider ("drive", so a Gmail state can never verify here), user
 * and session binding — THEN, only once that all holds, Drive's own
 * single-use check that the nonce carried inside the verified payload
 * matches the `drive_oauth_state` cookie from this request.
 *
 * NEVER trusts the shared helper's `replayChecked` field — see the module
 * header. A caller of this function relies solely on the cookie-nonce match
 * (and on clearing the cookie on use) for single-use protection.
 *
 * @param {string|null|undefined} state
 * @param {{ userId: string, sessionId?: string|null, cookieValue: unknown }} args
 *   `cookieValue` is the raw `drive_oauth_state` cookie read from the
 *   incoming callback request (undefined/null if absent).
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 *   `reason` is either one of `verifyOAuthState`'s rejection reasons, or
 *   this module's own `"nonce-mismatch"` when the signature/binding checks
 *   out but the cookie does not match the nonce inside the signed payload.
 */
export async function verifyDriveOAuthState(state, { userId, sessionId = null, cookieValue } = {}) {
  const result = await verifyOAuthState(state, { provider: "drive", userId, sessionId });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  if (!matchesNonce(cookieValue, result.nonce)) {
    return { ok: false, reason: "nonce-mismatch" };
  }
  return { ok: true };
}
