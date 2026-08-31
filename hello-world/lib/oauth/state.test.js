import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

// The replay layer reaches Redis through the DEFAULT export of
// lib/cache/redisClient (a named import would be `undefined`, which under the
// mandated try/catch degrades silently to replayChecked:false forever). Mock
// the default so every test drives the store's three states explicitly:
// available, absent, and throwing.
vi.mock("@/lib/cache/redisClient", () => ({ default: vi.fn(() => null) }));

import getRedisClient from "@/lib/cache/redisClient";
import { createOAuthState, verifyOAuthState } from "./state.js";

const SECRET = "unit-test-oauth-state-signing-secret";
const GMAIL = "gmail";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

const bindingFor = (over = {}) => ({ provider: GMAIL, userId: USER, sessionId: null, ...over });

// An in-memory stand-in for the Upstash client, honouring the one operation the
// replay layer performs: SET <key> 1 NX EX <ttl>. `nx` is what makes the check
// atomic and therefore genuinely single-use; the fake models exactly that.
function makeFakeRedis() {
  const store = new Map();
  return {
    store,
    set: vi.fn(async (key, value, opts) => {
      if (opts && opts.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  };
}

// state = PAYLOAD_B64 "." MAC_B64, split on the LAST "." (§3.2).
function splitState(state) {
  const i = state.lastIndexOf(".");
  return { payload: state.slice(0, i), mac: state.slice(i + 1) };
}

const ENV_KEYS = ["OAUTH_STATE_SECRET", "GOOGLE_CLIENT_SECRET", "Gemini_LLM_API_Key"];
let savedEnv = {};
let redis;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OAUTH_STATE_SECRET = SECRET;
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-must-not-be-the-signing-key";

  redis = makeFakeRedis();
  // mockReset (not mockClear): individual tests install throwing or
  // null-returning implementations, and this config sets neither `clearMocks`
  // nor `restoreMocks`, so a stale implementation would leak between tests.
  getRedisClient.mockReset();
  getRedisClient.mockReturnValue(redis);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.useRealTimers();
});

describe("createOAuthState / verifyOAuthState", () => {
  it("T1: a freshly minted state verifies against the same binding", async () => {
    const state = createOAuthState({ provider: GMAIL, userId: USER, sessionId: "sess-1" });

    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);

    const result = await verifyOAuthState(state, bindingFor({ sessionId: "sess-1" }));
    expect(result).toEqual({ ok: true, replayChecked: true });
  });

  it("T2: a single mutated byte in the payload segment is rejected as bad-signature", async () => {
    const state = createOAuthState(bindingFor());
    const { payload, mac } = splitState(state);

    const at = 4;
    const swapped = payload[at] === "A" ? "B" : "A";
    const tampered = `${payload.slice(0, at)}${swapped}${payload.slice(at + 1)}.${mac}`;
    expect(tampered).not.toBe(state);

    expect(await verifyOAuthState(tampered, bindingFor())).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("T3: an absent or truncated MAC segment is rejected as malformed", async () => {
    const state = createOAuthState(bindingFor());
    const { payload, mac } = splitState(state);

    // No MAC segment at all — this is the shape of the pre-fix state, and the
    // shape an attacker hand-rolls when there is nothing to forge.
    expect(await verifyOAuthState(payload, bindingFor())).toEqual({
      ok: false,
      reason: "malformed",
    });
    // Trailing separator, empty second segment.
    expect(await verifyOAuthState(`${payload}.`, bindingFor())).toEqual({
      ok: false,
      reason: "malformed",
    });
    // A MAC segment that decodes to fewer than 32 bytes: caught by the explicit
    // length check, BEFORE timingSafeEqual (which throws on length mismatch).
    expect(await verifyOAuthState(`${payload}.${mac.slice(0, 10)}`, bindingFor())).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("T4: a state older than the 10 minute TTL is rejected as expired", async () => {
    const now = Date.now();

    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(now - 11 * 60 * 1000);
    const stale = createOAuthState(bindingFor());

    vi.setSystemTime(now - 9 * 60 * 1000);
    const fresh = createOAuthState(bindingFor());

    vi.setSystemTime(now);
    expect(await verifyOAuthState(stale, bindingFor())).toEqual({ ok: false, reason: "expired" });
    // Positive control: the TTL must reject stale states without rejecting
    // every state, which a `return {ok:false,reason:"expired"}` would satisfy.
    expect(await verifyOAuthState(fresh, bindingFor())).toEqual({ ok: true, replayChecked: true });
  });

  it("T5: a state minted for a different binding is rejected despite a valid MAC", async () => {
    const unbound = createOAuthState(bindingFor());
    expect(await verifyOAuthState(unbound, bindingFor({ userId: OTHER_USER }))).toEqual({
      ok: false,
      reason: "wrong-user",
    });

    const bound = createOAuthState(bindingFor({ sessionId: "sess-1" }));
    expect(await verifyOAuthState(bound, bindingFor({ sessionId: "sess-2" }))).toEqual({
      ok: false,
      reason: "wrong-session",
    });
  });

  it("T6: a state minted for another provider is rejected at the gmail binding", async () => {
    // `provider` is opaque data here: this asserts only that the field is
    // checked, and pins no behaviour of any second consumer of this module.
    const state = createOAuthState({ provider: "drive", userId: USER, sessionId: null });

    expect(await verifyOAuthState(state, bindingFor())).toEqual({
      ok: false,
      reason: "wrong-provider",
    });
  });

  it("T7: a state that already verified once is rejected as replayed", async () => {
    const state = createOAuthState(bindingFor());

    expect(await verifyOAuthState(state, bindingFor())).toEqual({ ok: true, replayChecked: true });
    expect(await verifyOAuthState(state, bindingFor())).toEqual({ ok: false, reason: "replayed" });
  });

  describe("T7b: base64url malleability", () => {
    // Node's base64url decoder ignores padding AND whitespace, so `mac`,
    // `mac + "="`, `mac + "=="`, `mac + "\n"` and `mac + " "` are four DISTINCT
    // strings that decode to byte-identical MACs. A replay store keyed off the
    // raw state string is therefore defeated by one appended character; keying
    // it off the hex of the VERIFIED MAC bytes is not.
    for (const suffix of ["=", "==", "\n", " "]) {
      it(`still verifies, then replays, when the MAC segment gains ${JSON.stringify(suffix)}`, async () => {
        const state = createOAuthState(bindingFor());
        const { payload, mac } = splitState(state);
        const mutated = `${payload}.${mac}${suffix}`;

        expect(mutated).not.toBe(state);
        expect(Buffer.from(mac + suffix, "base64url")).toEqual(Buffer.from(mac, "base64url"));

        // The re-encoded form is still a valid signature, so it must verify...
        expect(await verifyOAuthState(mutated, bindingFor())).toEqual({
          ok: true,
          replayChecked: true,
        });
        // ...and must have burned the SAME replay key as the canonical form.
        expect(await verifyOAuthState(state, bindingFor())).toEqual({
          ok: false,
          reason: "replayed",
        });
      });
    }

    it("rejects the same mutation applied to the PAYLOAD segment", async () => {
      // The MAC is computed over the payload SEGMENT STRING as received, so a
      // re-encoding of the payload changes the MAC input. Had the MAC covered
      // the DECODED payload bytes instead, this direction would stay open.
      const state = createOAuthState(bindingFor());
      const { payload, mac } = splitState(state);

      for (const suffix of ["=", "==", "\n", " "]) {
        expect(await verifyOAuthState(`${payload}${suffix}.${mac}`, bindingFor())).toEqual({
          ok: false,
          reason: "bad-signature",
        });
      }
    });
  });

  it("T8: with no Redis client, a valid state still verifies and a forged one still does not", async () => {
    getRedisClient.mockReset();
    getRedisClient.mockReturnValue(null);

    const state = createOAuthState(bindingFor());
    expect(await verifyOAuthState(state, bindingFor())).toEqual({ ok: true, replayChecked: false });

    // An unavailable store may only ever ADD a rejection, never authorise one.
    const { payload, mac } = splitState(createOAuthState(bindingFor()));
    expect(
      await verifyOAuthState(`${payload}.${randomBytes(32).toString("base64url")}`, bindingFor()),
    ).toEqual({ ok: false, reason: "bad-signature" });
    expect(await verifyOAuthState(`${payload}=.${mac}`, bindingFor())).toEqual({
      ok: false,
      reason: "bad-signature",
    });
    expect(await verifyOAuthState(state, bindingFor({ userId: OTHER_USER }))).toEqual({
      ok: false,
      reason: "wrong-user",
    });
  });

  it("T9: a throwing Redis client degrades to replayChecked:false and never authorises a bad state", async () => {
    redis.set.mockReset();
    redis.set.mockImplementation(async () => {
      throw new Error("redis unreachable");
    });

    const state = createOAuthState(bindingFor());
    expect(await verifyOAuthState(state, bindingFor())).toEqual({ ok: true, replayChecked: false });

    const { payload, mac } = splitState(createOAuthState(bindingFor()));
    expect(
      await verifyOAuthState(`${payload}.${randomBytes(32).toString("base64url")}`, bindingFor()),
    ).toEqual({ ok: false, reason: "bad-signature" });
    expect(await verifyOAuthState(`${payload}=.${mac}`, bindingFor())).toEqual({
      ok: false,
      reason: "bad-signature",
    });

    // Same again when the client FACTORY throws rather than the command.
    getRedisClient.mockReset();
    getRedisClient.mockImplementation(() => {
      throw new Error("redis client construction failed");
    });

    const other = createOAuthState(bindingFor());
    expect(await verifyOAuthState(other, bindingFor())).toEqual({ ok: true, replayChecked: false });
    expect(await verifyOAuthState(other, bindingFor({ userId: OTHER_USER }))).toEqual({
      ok: false,
      reason: "wrong-user",
    });
  });

  it("T10: every malformed input yields {ok:false} and nothing throws", async () => {
    const { payload } = splitState(createOAuthState(bindingFor()));

    const cases = [
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["a lone separator", "."],
      ["two separators", ".."],
      ["empty MAC segment", "a."],
      ["empty payload segment", ".b"],
      ["a 10 MB string", "a".repeat(10 * 1024 * 1024)],
      ["base64url of non-JSON", `${Buffer.from("not json at all").toString("base64url")}.${randomBytes(32).toString("base64url")}`],
      ["JSON of the wrong shape", `${Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url")}.${randomBytes(32).toString("base64url")}`],
      ["a MAC segment decoding to 0 bytes", `${payload}.!!!!`],
      ["a MAC segment decoding to 33 bytes", `${payload}.${randomBytes(33).toString("base64url")}`],
      ["a non-string", 12345],
      ["an object", { toString: () => "nope" }],
    ];

    for (const [label, input] of cases) {
      const result = await verifyOAuthState(input, bindingFor());
      expect(result.ok, `${label} must not verify`).toBe(false);
      expect(typeof result.reason, `${label} must carry a reason`).toBe("string");
    }
  });

  it("T11: the MAC key is derived, so signing with the raw secret is rejected", async () => {
    const state = createOAuthState(bindingFor());
    const { payload, mac } = splitState(state);

    const rawKeyMac = createHmac("sha256", SECRET).update(payload).digest().toString("base64url");
    expect(rawKeyMac).not.toBe(mac);

    expect(await verifyOAuthState(`${payload}.${rawKeyMac}`, bindingFor())).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  describe("T25: session binding", () => {
    it("rejects a session-bound state when the verify-side session id is absent", async () => {
      // Fails CLOSED. getClaims() falls through to a network call on HS256
      // projects, so a transient blip yields null — and skipping the check when
      // either side is null would be an attacker-triggerable downgrade of the
      // binding to userId-only.
      const bound = createOAuthState(bindingFor({ sessionId: "sess-1" }));

      expect(await verifyOAuthState(bound, bindingFor({ sessionId: null }))).toEqual({
        ok: false,
        reason: "wrong-session",
      });
      expect(await verifyOAuthState(bound, { provider: GMAIL, userId: USER })).toEqual({
        ok: false,
        reason: "wrong-session",
      });
    });

    it("verifies an unbound state regardless of the verify-side session id", async () => {
      const unbound = createOAuthState(bindingFor({ sessionId: null }));
      expect(await verifyOAuthState(unbound, bindingFor({ sessionId: "sess-9" }))).toEqual({
        ok: true,
        replayChecked: true,
      });

      const omitted = createOAuthState({ provider: GMAIL, userId: USER });
      expect(await verifyOAuthState(omitted, bindingFor({ sessionId: null }))).toEqual({
        ok: true,
        replayChecked: true,
      });
    });

    it("rejects a state whose boundSession flag was flipped in transit", async () => {
      // boundSession lives INSIDE the signed payload precisely so that this
      // downgrade is a signature failure rather than a successful weakening.
      // Depends on the §3.2 payload encoding (base64url of a JSON object).
      const bound = createOAuthState(bindingFor({ sessionId: "sess-1" }));
      const { payload, mac } = splitState(bound);

      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      expect(claims.boundSession).toBe(true);

      const downgraded = { ...claims, boundSession: false, sessionId: null };
      const forgedPayload = Buffer.from(JSON.stringify(downgraded), "utf8").toString("base64url");
      expect(forgedPayload).not.toBe(payload);

      expect(await verifyOAuthState(`${forgedPayload}.${mac}`, bindingFor({ sessionId: null }))).toEqual({
        ok: false,
        reason: "bad-signature",
      });
    });
  });

  describe("T27: the signing secret", () => {
    it("refuses to mint or verify when the secret is missing", async () => {
      const state = createOAuthState(bindingFor());

      delete process.env.OAUTH_STATE_SECRET;
      delete process.env.GOOGLE_CLIENT_SECRET;

      expect(await verifyOAuthState(state, bindingFor())).toEqual({ ok: false, reason: "no-secret" });
      expect(() => createOAuthState(bindingFor())).toThrow();
    });

    it("refuses an empty or whitespace-only secret rather than signing under it", async () => {
      // createHmac("sha256", "") SUCCEEDS, so `secret || ""` would quietly
      // produce a working MAC under a publicly-known key — a total defeat of
      // the control that looks exactly like a working system.
      const state = createOAuthState(bindingFor());

      for (const empty of ["", "   ", "\n\t"]) {
        process.env.OAUTH_STATE_SECRET = empty;
        delete process.env.GOOGLE_CLIENT_SECRET;

        expect(await verifyOAuthState(state, bindingFor())).toEqual({
          ok: false,
          reason: "no-secret",
        });
        expect(() => createOAuthState(bindingFor())).toThrow();
      }
    });

    it("falls back to GOOGLE_CLIENT_SECRET, so no new required env var is introduced", async () => {
      delete process.env.OAUTH_STATE_SECRET;
      process.env.GOOGLE_CLIENT_SECRET = "the-google-client-secret";

      const state = createOAuthState(bindingFor());
      expect(await verifyOAuthState(state, bindingFor())).toEqual({ ok: true, replayChecked: true });
    });

    it("prefers OAUTH_STATE_SECRET, so a rotation invalidates states minted under the old key", async () => {
      process.env.OAUTH_STATE_SECRET = "key-generation-one";
      const state = createOAuthState(bindingFor());

      process.env.OAUTH_STATE_SECRET = "key-generation-two";
      expect(await verifyOAuthState(state, bindingFor())).toEqual({
        ok: false,
        reason: "bad-signature",
      });
    });

    it("works with Gemini_LLM_API_Key unset, so the secret is not read through getServerEnv()", async () => {
      // lib/config/env.js throws whenever Gemini_LLM_API_Key is unset. Reading
      // the signing secret through it would make an otherwise-healthy Gmail
      // deploy blow up inside verifyOAuthState — a 500, not a redirect.
      delete process.env.Gemini_LLM_API_Key;

      const state = createOAuthState(bindingFor());
      expect(await verifyOAuthState(state, bindingFor())).toEqual({ ok: true, replayChecked: true });
    });
  });
});
