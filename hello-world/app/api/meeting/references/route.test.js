import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Route contract for verifiable reference links on a meeting discussion
// point. lib/meeting/referenceContract.js (normalizeReferences) is
// deliberately NOT mocked — "an uncorroborated link never reaches the
// client" is a real integration between this route and that contract, and
// mocking it away would leave the guarantee untested.
//
// lib/techwatch/cache is deliberately NOT replaced with a pass-through
// mock (as app/api/techwatch/lifecycle/route.test.js does) — the whole
// point of the caching test below is that a SECOND identical request must
// not pay for a second model call, and a pass-through mock would make that
// assertion vacuous. It is wrapped (vi.fn around the real implementation)
// so its call args (the key, the TTL) stay inspectable.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent: vi.fn() }));
vi.mock("@/lib/techwatch/cache", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, cached: vi.fn(actual.cached) };
});

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { cached, __resetMemoryCache } from "@/lib/techwatch/cache";
import { POST, cacheKeyFor, REFERENCES_CACHE_TTL_SECONDS } from "./route.js";

function request(body) {
  return { json: async () => body };
}

const redirectFor = (slug) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${slug}`;

function signedIn(userId = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

// A grounded model reply: the links the model wrote, plus the uris the
// response claims it searched. The two are SEPARATE arguments on purpose —
// what groundingChunks[].web.uri actually holds is not consistent (a
// publisher url in some of this repo's grounded features, a
// vertexaisearch.cloud.google.com redirect in others), and the route must
// return links under both readings. Passing the same array for both, as an
// earlier version of this file did throughout, assumes one of the two worlds
// and is why "return no links at all" shipped unnoticed.
function geminiReplying(links, groundedUris) {
  const generateContent = vi.fn().mockResolvedValue({
    text: JSON.stringify(links),
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: groundedUris.map((uri) => ({ web: { uri, title: "src" } })),
        },
      },
    ],
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetMemoryCache();
  // wantsEmbedded reads process.env DIRECTLY, not through the mocked
  // getServerEnv. With no explicit engine and no key present it falls back
  // to "embedded" and every request below would 503 before reaching
  // anything worth testing — the same trap
  // app/api/techwatch/lifecycle/route.test.js documents.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  // Default: the PUBLISHER world, where a grounding uri is already a real
  // page and resolving it yields itself. Tests that exercise the redirect
  // world override this with an explicit redirect -> publisher table.
  fetchUrlContent.mockImplementation(async (url) => ({ finalUrl: url }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/meeting/references — gates", () => {
  it("401s when signed out, before touching the model", async () => {
    signedOut();
    const generate = geminiReplying([{ title: "x", url: "https://a.example" }], ["https://a.example"]);
    const res = await POST(request({ insightText: "Discuss the rollout plan.", engine: "gemini" }));
    expect(res.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("400s on an invalid JSON body, with no model call", async () => {
    signedIn();
    const generate = geminiReplying([{ title: "x", url: "https://a.example" }], ["https://a.example"]);
    const badRequest = { json: async () => { throw new SyntaxError("Unexpected token"); } };
    const res = await POST(badRequest);
    expect(res.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("400s when insightText is missing or blank, with no model call", async () => {
    signedIn();
    const generate = geminiReplying([{ title: "x", url: "https://a.example" }], ["https://a.example"]);
    for (const body of [{}, { insightText: "" }, { insightText: "   " }]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuses the embedded engine with a clear message and makes no model call", async () => {
    // The reasoning this pins: unlike every other auxiliary AI feature, the
    // embedded engine gets a flat refusal here, not a deterministic
    // fallback — there is no offline way to prove a link is live right now.
    //
    // The gate ORDER is asserted through getGeminiClient/getServerEnv, not
    // through the model call. "The model was not called" stays green if the
    // engine check simply MOVES below getGeminiClient() — the refusal still
    // happens, just after the client was built — so that assertion alone
    // could not catch the move it claimed to. These can.
    signedIn();
    const generate = geminiReplying([{ title: "x", url: "https://a.example" }], ["https://a.example"]);
    getGeminiClient.mockClear();
    const res = await POST(request({ insightText: "Discuss the rollout plan.", engine: "embedded" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(String(body.error)).toMatch(/engine/i);
    expect(generate).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(cached).not.toHaveBeenCalled();
  });

  it("reports a missing Gemini key as a 503 rather than pretending to search", async () => {
    signedIn();
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    const res = await POST(request({ insightText: "Discuss the rollout plan.", engine: "gemini" }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("is dynamic and runs on node, like the other grounded-search routes", async () => {
    const mod = await import("./route.js");
    expect(mod.runtime).toBe("nodejs");
    expect(mod.dynamic).toBe("force-dynamic");
  });
});

describe("POST /api/meeting/references — verification", () => {
  it("RETURNS the corroborated link, with its real publisher URL", async () => {
    // The assertion whose absence let "return no links at all" ship. Every
    // other reference assertion in this file was either `toEqual([])` or a
    // comparison between two responses — both satisfied by [] === [] — so a
    // route that verified nothing and returned nothing looked identical to a
    // route that worked. Grounding here is REDIRECT-shaped: the only way
    // this passes is by resolving the redirect BEFORE corroborating the
    // model's publisher url against it.
    signedIn();
    fetchUrlContent.mockImplementation(async (url) =>
      url === redirectFor("AbC123") ? { finalUrl: "https://react.dev/learn/state" } : { error: "404" },
    );
    geminiReplying(
      [{ title: "State: A Component's Memory", url: "https://react.dev/learn/state" }],
      [redirectFor("AbC123")],
    );

    const res = await POST(request({ insightText: "Explain react component state.", engine: "gemini" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.references).toEqual([
      { title: "State: A Component's Memory", url: "https://react.dev/learn/state", host: "react.dev" },
    ]);
    expect(body.dropped).toBe(0);
    expect(body.grounded).toBe(true);
    expect(fetchUrlContent).toHaveBeenCalledWith(redirectFor("AbC123"));
  });

  it("also returns the link when the grounding uris are already publisher URLs", async () => {
    // The other reading of the same metadata field. Resolve-first is correct
    // in BOTH worlds — a publisher uri resolves to itself — and this pins
    // that the fix for the redirect world did not break this one.
    signedIn();
    geminiReplying(
      [{ title: "HPA", url: "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/" }],
      ["https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/"],
    );

    const res = await POST(request({ insightText: "Explain kubernetes autoscaling.", engine: "gemini" }));
    const body = await res.json();

    expect(body.references).toHaveLength(1);
    expect(body.references[0].url).toBe(
      "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/",
    );
    expect(body.references[0].host).toBe("kubernetes.io");
  });

  it("never returns a link the model cited but never actually grounded on", async () => {
    // The premise of the whole feature, pinned end to end: normalizeReferences
    // is not mocked, so this proves nothing between the model's raw reply and
    // the HTTP response can re-admit an uncorroborated link. Mutation caught:
    // passing the suggested links straight through instead of running them
    // through normalizeReferences.
    signedIn();
    geminiReplying(
      [{ title: "Fabricated page", url: "https://invented.example/never-searched" }],
      ["https://real.example/actually-searched"],
    );
    const res = await POST(
      request({ insightText: "Point that the model answers with an invented link.", engine: "gemini" }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.references).toEqual([]);
    expect(body.dropped).toBeGreaterThan(0);
  });

  it("returns a 200 with an error when the model call itself throws, never a 5xx", async () => {
    // Progressive enhancement over a panel that already rendered — a 500
    // here would read as the whole meeting feature breaking. Mutation
    // caught: letting the throw propagate, or returning a non-200 status.
    signedIn();
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("upstream 503")) },
    });
    const res = await POST(request({ insightText: "Point that triggers a model failure.", engine: "gemini" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.references).toEqual([]);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

// Redirect resolution itself now lives in lib/meeting/referenceContract.js
// (resolveGroundedSources), because it has to run BEFORE corroboration
// rather than after it — see that file's tests, which carry the three
// assertions that used to live here (resolve via the injected fetcher, keep
// an unreachable uri, keep it on a throw) plus the ordering ones.

describe("POST /api/meeting/references — caching", () => {
  it("caches globally (not per user), keyed by a digest of the sorted generic terms, for a week", async () => {
    // The key is no longer the raw insight sentence (that version cost a
    // Redis round trip on every request and almost never hit), and it is no
    // longer the terms themselves either (a "generic-looking" term can still
    // be an employer name or a project codename — see the two tests below).
    // It is a hash. Mutation caught: reverting to a raw-text or bare-terms
    // key, forgetting to sort terms before hashing, or a TTL far
    // shorter/longer than a week.
    signedIn();
    geminiReplying([{ title: "HPA docs", url: "https://a.example/hpa" }], ["https://a.example/hpa"]);
    await POST(
      request({ insightText: "  Kubernetes HPA needs a metrics source.  ", topic: "Scaling", engine: "gemini" }),
    );
    expect(cached).toHaveBeenCalledTimes(1);
    const [key, ttl] = cached.mock.calls[0];
    expect(key).toBe(cacheKeyFor("Kubernetes HPA needs a metrics source.", "Scaling"));
    expect(key).toContain("meeting:references");
    expect(key).not.toMatch(/user/i);
    // None of the input words survive readably in the key — it is opaque.
    expect(key).not.toContain("kubernetes");
    expect(key).not.toContain("metrics");
    expect(key).not.toContain("scaling");
    expect(ttl).toBe(REFERENCES_CACHE_TTL_SECONDS);
    expect(ttl).toBe(60 * 60 * 24 * 7);
  });

  it("NEVER caches a failed lookup — one upstream blip must not poison a global key for a week", async () => {
    // The cache key is global (no user id) and the TTL is seven days, so a
    // cached failure is served to EVERY user for a week, and the client's
    // Retry button re-serves it. cached() stores any truthy producer result,
    // and an `{ references: [], error }` object is truthy — so the producer
    // must not return one. Mutation caught: returning the error shape from
    // the producer instead of throwing past cached().
    signedIn();
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream 503"))
      .mockResolvedValue({
        text: JSON.stringify([{ title: "HPA docs", url: "https://a.example/hpa" }]),
        candidates: [
          { groundingMetadata: { groundingChunks: [{ web: { uri: "https://a.example/hpa", title: "src" } }] } },
        ],
      });
    getGeminiClient.mockReturnValue({ models: { generateContent: generate } });
    const body = { insightText: "Kubernetes HPA needs a metrics source.", topic: "Scaling", engine: "gemini" };

    const first = await (await POST(request(body))).json();
    expect(typeof first.error).toBe("string");

    const second = await (await POST(request(body))).json();
    expect(generate).toHaveBeenCalledTimes(2); // the failure was NOT remembered
    expect(second.error).toBeUndefined();
    expect(second.cached).toBeUndefined();
    expect(second.references).toHaveLength(1);
  });

  it("serves the second identical request from cache, with no second model call", async () => {
    // The real lib/techwatch/cache implementation is in play here (see the
    // top-of-file note on why it isn't a pass-through mock), so this proves
    // the actual caching behavior, not just that `cached()` was called.
    // Mutation caught: a cache key that varies between two calls with
    // identical input (e.g. including a timestamp), or dropping the
    // `cached()` wrapper entirely and calling the model directly.
    signedIn();
    const generate = geminiReplying(
      [{ title: "HPA docs", url: "https://a.example/hpa" }],
      ["https://a.example/hpa"],
    );
    const body = { insightText: "Kubernetes HPA needs a metrics source.", topic: "Scaling", engine: "gemini" };

    const firstJson = await (await POST(request(body))).json();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(firstJson.cached).toBeUndefined();
    // Non-empty on purpose: the comparison below is satisfied by [] === [],
    // so without this the whole test survives a route that returns nothing.
    expect(firstJson.references).toHaveLength(1);

    const secondJson = await (await POST(request(body))).json();
    expect(generate).toHaveBeenCalledTimes(1); // unchanged — no second model call
    expect(secondJson.cached).toBe(true);
    expect(secondJson.references).toEqual(firstJson.references);
  });

  it("collides two differently-worded points about the same technology onto one cache entry", async () => {
    // The bug this whole follow-up exists to fix: two real users' meetings
    // never produce the same SENTENCE, so a raw-text key almost never hit.
    // Keying on sorted generic terms means two phrasings that share the same
    // technical vocabulary — even reordered, even with different connecting
    // words — land on the same entry, and the second one costs no model
    // call. The fixture's own "guards the fixture" assertion (via the real,
    // unmocked cacheKeyFor) proves this isn't a coincidence of these two
    // particular strings. Mutation caught: keying on the raw text (or
    // anything that preserves sentence-specific structure/order) instead of
    // the sorted term set.
    const topic = "Scaling";
    const insightA = "The kubernetes autoscaling policy configuration was updated again for review.";
    const insightB = "For review, the kubernetes autoscaling policy configuration was updated again.";

    // Guards the fixture: two DIFFERENT sentences (different word order)
    // that the real key-derivation resolves to the identical, non-null key.
    // If this ever stopped holding, the model-call assertions below would
    // pass vacuously (each request would just be its own cache miss).
    expect(insightA).not.toBe(insightB);
    expect(cacheKeyFor(insightA, topic)).not.toBeNull();
    expect(cacheKeyFor(insightA, topic)).toBe(cacheKeyFor(insightB, topic));

    signedIn();
    const generate = geminiReplying(
      [{ title: "HPA docs", url: "https://a.example/hpa" }],
      ["https://a.example/hpa"],
    );

    await (await POST(request({ insightText: insightA, topic, engine: "gemini" }))).json();
    expect(generate).toHaveBeenCalledTimes(1);

    const secondJson = await (await POST(request({ insightText: insightB, topic, engine: "gemini" }))).json();
    expect(generate).toHaveBeenCalledTimes(1); // still 1 — the second phrasing hit the same cache entry
    expect(secondJson.cached).toBe(true);
  });

  it("never puts any individual distinctive word from the insight text into the cache key", async () => {
    // The privacy half of the fix, strengthened past what was true before
    // this change. Sorting-and-joining the raw TERMS (the previous version
    // of this key) already broke phrase adjacency, but every individual
    // term still survived readably — "4+ characters and not a stopword"
    // makes a word LONG, not generic, so a fake employer name and a fake
    // project codename cleared that bar exactly as easily as "kubernetes"
    // does and would have sat in shared, non-user-scoped Redis as plain
    // text. Hashing the term list removes that: NONE of the input words —
    // not the phrase, not any single one of them — appear in the key at
    // all. Mutation caught: reverting to a bare (unhashed) term-list key, or
    // hashing something other than the full term set (e.g. hashing each
    // term separately, or omitting a term from what gets hashed).
    signedIn();
    geminiReplying([{ title: "HPA docs", url: "https://a.example/hpa" }], ["https://a.example/hpa"]);
    const employer = "wintermute";
    const codename = "starcrossed";
    const insightText = `Mention that ${employer} ${codename} depends on the kubernetes autoscaling policy configuration.`;

    await POST(request({ insightText, topic: "Scaling", engine: "gemini" }));

    const [key] = cached.mock.calls[0];
    // Guards the fixture: both stand-ins must actually clear the same
    // "generic-looking" bar a real technical term does (4+ chars, not a
    // stopword) — otherwise this test would pass merely because the words
    // were filtered out before hashing, not because hashing hid them.
    expect(employer.length).toBeGreaterThanOrEqual(4);
    expect(codename.length).toBeGreaterThanOrEqual(4);

    expect(key).not.toContain(employer);
    expect(key).not.toContain(codename);
    expect(key).not.toContain("kubernetes");
    expect(key).not.toContain("autoscaling");
    expect(key).not.toContain("policy");
    expect(key).not.toContain("configuration");
    expect(key).not.toContain(`${employer} ${codename}`);
    expect(key).not.toContain(insightText.toLowerCase());
  });

  it("does not collide two genuinely different term sets", async () => {
    // The negative control the hash needs: without this, a degenerate
    // digest function (or a constant string standing in for one) would
    // satisfy every collision assertion above while being useless as a
    // cache. Mutation caught: hashing a constant, hashing only the term
    // COUNT instead of their content, or any digest that ignores its input.
    const topic = "Scaling";
    const insightA = "The kubernetes autoscaling policy configuration was updated again for review.";
    const insightB = "Our postgres replication lag alert threshold was lowered again for review.";

    const keyA = cacheKeyFor(insightA, topic);
    const keyB = cacheKeyFor(insightB, topic);
    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);

    signedIn();
    const generate = geminiReplying(
      [{ title: "HPA docs", url: "https://a.example/hpa" }],
      ["https://a.example/hpa"],
    );

    await (await POST(request({ insightText: insightA, topic, engine: "gemini" }))).json();
    const secondJson = await (await POST(request({ insightText: insightB, topic, engine: "gemini" }))).json();

    expect(generate).toHaveBeenCalledTimes(2); // two distinct buckets → two model calls
    expect(secondJson.cached).toBeUndefined();
  });

  // A cache HIT here is not a saved API call, it is a set of links presented
  // to the user as verified sources for a point they are about to make out
  // loud. So every one of these is a correctness test, not a performance one.
  it("does not merge two versions of the same technology onto one key", async () => {
    // All four verified collisions of the old /[a-z0-9]{4,}/ tokenizer: it
    // dropped every token under four characters, which is precisely the
    // token that distinguishes one documentation page from another. Someone
    // asking for sources on a Java 21 migration was served the Java 17 docs,
    // out of a shared week-long cache, presented as verified.
    const pairs = [
      ["We are migrating the service to Java 17.", "We are migrating the service to Java 21."],
      ["Pin the cluster to Kubernetes 1.29.", "Pin the cluster to Kubernetes 1.31."],
      ["The rewrite targets React 18.", "The rewrite targets React 19."],
      ["Our edge terminates HTTP/2.", "Our edge terminates HTTP/3."],
    ];
    for (const [a, b] of pairs) {
      expect(cacheKeyFor(a, "Platform")).not.toBeNull();
      expect(cacheKeyFor(a, "Platform")).not.toBe(cacheKeyFor(b, "Platform"));
    }
  });

  it("does not merge a claim with its NEGATION", async () => {
    // The worst of the four: "not" is three characters, so the old tokenizer
    // dropped it and served links backing the opposite claim as verified
    // sources for this one.
    expect(cacheKeyFor("The driver does support connection pooling.", "Database")).not.toBe(
      cacheKeyFor("The driver does not support connection pooling.", "Database"),
    );
    expect(cacheKeyFor("There is migration tooling for this.", "Database")).not.toBe(
      cacheKeyFor("There is no migration tooling for this.", "Database"),
    );
  });

  it("keeps a dotted version number whole rather than splitting it", async () => {
    // 1.29 must not tokenize to "1" and "29" — "Kubernetes 1.29" and
    // "Kubernetes 29.1" would then be the same term set.
    expect(cacheKeyFor("Kubernetes 1.29 changed the defaults.", "")).not.toBe(
      cacheKeyFor("Kubernetes 29.1 changed the defaults.", ""),
    );
  });

  it("caps by document order, so two long points differing late still differ", async () => {
    // Sorting the terms and THEN slicing to the cap kept whichever twelve
    // sorted first, throwing away exactly the difference between two points
    // that agree on everything before it. Selecting in document order (and
    // sorting only the selection) keeps that difference, and mixing the
    // distinct-term COUNT into the digest catches the length case too.
    const tail = "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november";
    // The distinguishing term is said FIRST but sorts LAST, so alphabetical
    // slicing threw away the only thing telling the two points apart.
    expect(cacheKeyFor(`zulu ${tail}`, "")).not.toBe(cacheKeyFor(`zebra ${tail}`, ""));
    // …and the term COUNT mixed into the digest catches the case where one
    // point is simply a longer version of the other past the cap.
    expect(cacheKeyFor(tail, "")).not.toBe(cacheKeyFor(`${tail} oscar`, ""));
  });

  it("uses a digest wide enough for a shared, global, week-long namespace", async () => {
    // A 32-bit digest (≤8 hex chars, which is what insightId produces) has a
    // birthday bound around 77k distinct term sets in a namespace this
    // long-lived — and a collision here means one topic's links served as
    // verified sources for an unrelated topic, the feature's defining
    // failure. Mutation caught: reverting to insightId, or truncating the
    // digest back down.
    const key = cacheKeyFor("Kubernetes HPA needs a metrics source.", "Scaling");
    const digest = key.replace("meeting:references:", "");
    expect(digest).toMatch(/^[0-9a-f]+$/);
    expect(digest.length).toBeGreaterThanOrEqual(32);
  });

  it("skips the cache entirely (never keys on an empty string) when the point has no generic terms", async () => {
    // cacheKeyFor returns null for a point with nothing but stopwords/short
    // words — POST must skip cached() rather than fall back to keying on
    // "", which would serve one user's links to every such request.
    // Mutation caught: falling back to `meeting:references:` (empty term
    // list) as the key instead of skipping caching.
    signedIn();
    const generate = geminiReplying([{ title: "x", url: "https://a.example/x" }], ["https://a.example/x"]);
    expect(cacheKeyFor("it was", "")).toBeNull();

    await POST(request({ insightText: "it was", topic: "", engine: "gemini" }));
    await POST(request({ insightText: "it was", topic: "", engine: "gemini" }));

    expect(cached).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(2); // no caching → every request looks it up itself
  });
});
