import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import getRedisClient from "@/lib/cache/redisClient";

// See scratchpad GMAIL-STATE-AC.md §3.2 for the full wire-format and
// verification-order spec this file implements.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — how long a minted state is valid.
const REPLAY_TTL_SECONDS = 15 * 60; // 900s — MUST exceed STATE_TTL_MS or a
// still-signature-valid state could become replayable once the replay key expires.
const KEY_DERIVATION_LABEL = "oauth-state-v1";
const REPLAY_KEY_PREFIX = "oauth_state:";

// Structural enforcement of the invariant documented above: if the replay key
// can expire before the state signature does, a state that is still valid
// could be replayed with no record of its first use, silently defeating
// single-use protection. This must throw at import time, not just be a comment.
if (REPLAY_TTL_SECONDS * 1000 <= STATE_TTL_MS) {
  throw new Error(
    `OAuth state invariant violated: REPLAY_TTL_SECONDS (${REPLAY_TTL_SECONDS}s = ${REPLAY_TTL_SECONDS * 1000}ms) must exceed STATE_TTL_MS (${STATE_TTL_MS}ms), or a still-signature-valid state could be replayed after the replay key expires.`,
  );
}

/**
 * Read the signing secret directly from process.env, AT CALL TIME (never
 * cached in a module-level const — tests mutate the environment between
 * calls, and a long-lived server process must pick up a rotated secret).
 *
 * Deliberately NOT read via getServerEnv(): that throws whenever
 * Gemini_LLM_API_Key is unset, which would make an otherwise-healthy Gmail
 * deploy blow up inside verifyOAuthState instead of degrading to a redirect.
 *
 * Returns null for missing, empty, or whitespace-only secrets. A missing
 * secret must never fall back to "" — createHmac("sha256", "") SUCCEEDS and
 * produces a valid MAC under an empty, publicly-known key, which would be a
 * silent, total defeat of the control.
 */
function readSigningSecret() {
  const primary = process.env.OAUTH_STATE_SECRET;
  const fallback = process.env.GOOGLE_CLIENT_SECRET;
  const raw = typeof primary === "string" && primary.length > 0 ? primary : fallback;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return raw;
}

/** Domain-separated 32-byte MAC key, derived from the raw secret. */
function deriveMacKey(secret) {
  return createHmac("sha256", secret).update(KEY_DERIVATION_LABEL).digest();
}

/** MAC over the payload SEGMENT STRING as received/produced — see §3.2. */
function computeMac(secret, payloadB64) {
  const key = deriveMacKey(secret);
  return createHmac("sha256", key).update(payloadB64).digest();
}

/**
 * Mint a signed, bound, expiring OAuth `state`.
 * Throws ONLY if the signing secret is missing, empty, or whitespace-only.
 *
 * @param {{ provider: string, userId: string, sessionId?: string|null }} binding
 * @returns {string} opaque URL-safe state
 */
export function createOAuthState({ provider, userId, sessionId = null } = {}) {
  const secret = readSigningSecret();
  if (!secret) {
    throw new Error(
      "Cannot mint OAuth state: no signing secret configured (set OAUTH_STATE_SECRET or GOOGLE_CLIENT_SECRET).",
    );
  }

  const boundSession = sessionId !== null && sessionId !== undefined;
  const payload = {
    v: 1,
    provider,
    userId,
    sessionId: boundSession ? sessionId : null,
    boundSession,
    nonce: randomBytes(16).toString("hex"),
    iat: Date.now(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = computeMac(secret, payloadB64);
  return `${payloadB64}.${mac.toString("base64url")}`;
}

/**
 * Verify a state against the CURRENT request's binding.
 * Returns a discriminated result. NEVER throws. NEVER returns a bare boolean.
 *
 * @param {string|null|undefined} state
 * @param {{ provider: string, userId: string, sessionId?: string|null }} binding
 * @returns {Promise<
 *     { ok: true,  replayChecked: boolean }
 *   | { ok: false, reason: "missing"|"malformed"|"bad-signature"|"expired"
 *                        |"wrong-provider"|"wrong-user"|"wrong-session"
 *                        |"replayed"|"no-secret" }
 * >}
 */
export async function verifyOAuthState(state, binding) {
  try {
    return await verifyOAuthStateInner(state, binding);
  } catch {
    // Belt-and-braces: verifyOAuthState must never throw regardless of what
    // an unexpected input or a broken dependency does.
    return { ok: false, reason: "malformed" };
  }
}

async function verifyOAuthStateInner(state, binding) {
  if (typeof state !== "string" || state.length === 0) {
    return { ok: false, reason: "missing" };
  }

  const lastDot = state.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === state.length - 1) {
    return { ok: false, reason: "malformed" };
  }

  const payloadB64 = state.slice(0, lastDot);
  const macB64 = state.slice(lastDot + 1);
  if (!payloadB64 || !macB64) {
    return { ok: false, reason: "malformed" };
  }

  const secret = readSigningSecret();
  if (!secret) {
    return { ok: false, reason: "no-secret" };
  }

  let macBytes;
  try {
    macBytes = Buffer.from(macB64, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (macBytes.length !== 32) {
    return { ok: false, reason: "malformed" };
  }

  // Recompute the expected MAC over the payload SEGMENT STRING as received —
  // this is what makes a re-encoded (padded/whitespace-appended) payload
  // segment fail as bad-signature rather than silently verifying.
  const expected = computeMac(secret, payloadB64);
  if (expected.length !== macBytes.length || !timingSafeEqual(macBytes, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  // Only now — after the signature is proven valid — parse untrusted JSON.
  let payload;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    payload = JSON.parse(json);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "malformed" };
  }

  if (typeof payload.iat !== "number" || Date.now() - payload.iat > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }

  if (payload.provider !== binding.provider) {
    return { ok: false, reason: "wrong-provider" };
  }
  if (payload.userId !== binding.userId) {
    return { ok: false, reason: "wrong-user" };
  }

  if (payload.boundSession) {
    const verifySessionId = binding.sessionId ?? null;
    if (verifySessionId === null || verifySessionId !== payload.sessionId) {
      return { ok: false, reason: "wrong-session" };
    }
  }

  // Replay claim: MUST run before the caller exchanges the authorization
  // code (see §3.2/AC-21) and is keyed off the hex of the VERIFIED MAC
  // bytes — canonical, so every base64url-malleable re-encoding of either
  // segment collapses onto the same replay key.
  const replayKey = `${REPLAY_KEY_PREFIX}${macBytes.toString("hex")}`;
  let replayChecked = false;
  try {
    const redis = getRedisClient();
    if (redis) {
      const setResult = await redis.set(replayKey, "1", { nx: true, ex: REPLAY_TTL_SECONDS });
      if (setResult === null) {
        return { ok: false, reason: "replayed" };
      }
      replayChecked = true;
    }
  } catch {
    // Store unavailable degrades the replay layer to a TTL-bounded window.
    // It may only ever ADD a rejection, never authorise one — this branch
    // is reached only after every other check above already passed.
    console.warn(
      "OAuth state replay check failed: replay store unavailable, single-use protection not applied for this verification",
    );
    replayChecked = false;
  }

  return { ok: true, replayChecked };
}
