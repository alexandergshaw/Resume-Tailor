// The adoption contract for `lib/rateLimit`, checked across every route that
// spends money per request.
//
// WHY THIS FILE EXISTS RATHER THAN N COPIES OF THE SAME ASSERTIONS. Each bounded
// route's own suite proves its bound BEHAVIOURALLY (fire limit+1 requests, the
// last one is 429). That half is irreplaceable and stays where it is. But the
// static half -- "the limiter is a MODULE-SCOPE singleton" -- is the same
// sentence for every route, and it is the assertion that catches the one defect
// `lib/rateLimit/index.js`'s header calls catastrophic:
//
//   A limiter constructed INSIDE the handler gets a brand-new store on every
//   request, so every caller is forever on its first request. It permits
//   everything, counts nothing, and passes a smoke test while doing it.
//
// Keeping it in one table also makes the TRIAGE itself testable. The sweep at
// the bottom fails when a route imports the Gemini client and appears in
// neither BOUNDED nor DEFERRED -- so a new model-calling endpoint cannot ship
// unbounded by omission. It has to be a deliberate line in this file.
//
// HONEST ABOUT WHAT THE BOUNDS BUY. `createMemoryStore` is per-instance. On
// serverless this bounds a caller to `limit x instanceCount`, not `limit`. That
// is worth having -- it is the difference between a runaway client costing
// thousands of model calls and costing a few -- but it is NOT a fleet-wide
// guarantee and nothing here should be read as claiming one. Swapping in a
// Redis-backed store satisfying the same two-method interface changes no route.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP_API = path.join(process.cwd(), "app", "api");

/**
 * Every route bounded so far, with the limit and window each one declares.
 *
 * The numbers are duplicated here ON PURPOSE: the route states its bound in
 * code and its REASON in a comment, and this table is the second witness. A
 * limit quietly loosened in a route without a reviewer touching this file is a
 * red test, which is exactly the review moment a spend ceiling deserves.
 */
const BOUNDED = [
  // --- hard-authenticated: keyed on the id `auth.getUser()` resolved --------
  {
    route: "app/api/copilot/answer/expand/route.js",
    limit: 40,
    windowMs: 600_000,
    why: "one expansion per bullet the candidate opens; an answer carries at most a handful of bullets, so 40 in ten minutes covers opening every bullet of several answers while a scripted loop stops at 40",
  },
  {
    route: "app/api/copilot/glossary/route.js",
    limit: 4,
    windowMs: 3_600_000,
    why: "a generation is ~11 grounded calls, the most expensive single request in the product. Four an hour per user is deliberately tight; the per-posting cooldown and the per-fingerprint and lifetime call caps in the database are the bounds that actually protect a SHARED row, and this one only stops one user driving them",
  },
  {
    route: "app/api/copilot/critique/route.js",
    limit: 30,
    windowMs: 600_000,
    why: "one Gemini critique per answered practice question, human-paced",
  },
  {
    route: "app/api/copilot/detect/route.js",
    limit: 90,
    windowMs: 300_000,
    why: "fires once per interviewer utterance in a LIVE interview -- the highest legitimate rate in the product",
  },
  {
    route: "app/api/copilot/question/route.js",
    limit: 30,
    windowMs: 600_000,
    why: "one drafted question per practice turn, with a human answering between turns",
  },
  {
    route: "app/api/copilot/role-response/route.js",
    limit: 30,
    windowMs: 600_000,
    why: "one drill answer per turn, same cadence as the question route",
  },
  {
    route: "app/api/copilot/role-situation/route.js",
    limit: 30,
    windowMs: 600_000,
    why: "one drill scene per turn, same cadence as the question route",
  },
  {
    route: "app/api/copilot/token/route.js",
    limit: 10,
    windowMs: 600_000,
    why: "each POST mints a REAL metered STT credential; a session needs one plus a few reconnects",
  },
  {
    route: "app/api/application-digest/route.js",
    limit: 12,
    windowMs: 600_000,
    why: "a grounded Interactions call per digest -- the most expensive single request in the tracking table",
  },
  {
    route: "app/api/meeting/insights/route.js",
    limit: 60,
    windowMs: 600_000,
    why: "re-asked as a live meeting's transcript grows -- roughly one call every ten seconds is legitimate",
  },
  {
    route: "app/api/experience/research/route.js",
    limit: 10,
    windowMs: 600_000,
    why: "a search-grounded Gemini call plus the page write behind it",
  },
  {
    route: "app/api/meeting/references/route.js",
    limit: 12,
    windowMs: 600_000,
    why: "a grounded call plus an outbound fetch per candidate link on every cache miss",
  },
  {
    route: "app/api/techwatch/lifecycle/route.js",
    limit: 10,
    windowMs: 600_000,
    why: "up to four grounded calls per request -- the highest per-request cost in Tech Watch",
  },
  // --- the three unauthenticated routes still standing, gated and then -----
  // bounded. A fourth, app/api/fetch-posting/route.js, shipped in this same
  // no-auth cohort and was gated the same way; it is gone from this table (and
  // from GATED below) because once gated it was found to have ZERO callers
  // anywhere in the app and was deleted outright rather than kept and tuned --
  // see GATED's own comment for the fuller reason.
  //
  // These moved up from DEFERRED. Each was listed there for the SAME reason --
  // "no auth gate at all, so identify() has nothing to key on" -- and the fix
  // was therefore authentication first and the bound second, in that order. All
  // three now resolve an id through `getAuth()` (lib/experience/apiAuth.js) and
  // 401 without one, so `identify()` always succeeds and the bound is exact.
  //
  // Every client caller of all three sits on a PAGE route, and
  // lib/supabase/middleware.js redirects any page route to /login without a
  // session, so none of them could ever legitimately have run signed-out.
  {
    route: "app/api/posting-from-image/route.js",
    limit: 30,
    windowMs: 600_000,
    why: "a batch of screenshots is processed by a SERIAL client loop (app/hooks/useScreenshots.js:133), each item costing vision + a grounded search + up to five outbound fetches and then a full tailoring call -- 30 leaves headroom over the largest batch that loop can physically push through ten minutes, while capping a scripted loop at 60 model calls instead of none",
  },
  {
    route: "app/api/company-research/route.js",
    limit: 30,
    windowMs: 600_000,
    why: "fires once per tailored job carrying a cover letter (app/hooks/useDocumentPreview.js:914), so it tracks the SAME screenshot batch as posting-from-image rather than the lower single-shot research routes, plus the user's own pasted article URLs",
  },
  {
    route: "app/api/extract-employment/route.js",
    limit: 10,
    windowMs: 600_000,
    why: "one call per resume the user picks in the employment-import dialog (app/page.js:1064) -- human-paced, and a denial degrades to the on-device parser rather than failing",
  },
  // --- already bounded before this change ----------------------------------
  {
    route: "app/api/copilot/ask/route.js",
    limit: 20,
    windowMs: 600_000,
    why: "the original adoption (1515a16) -- listed so the sweep below counts it",
  },
];

/**
 * Model-calling routes that are NOT bounded yet, each with the reason it ranks
 * below the list above. This is a queue, not an exemption: every entry still
 * spends money per request.
 *
 * THE LINE THIS PASS DREW, and it is the whole triage in one sentence: a
 * limiter can only bound what it can ATTRIBUTE. Every route in BOUNDED resolves
 * an authenticated user id and 401s without one, so `identify()` always
 * succeeds and the bound is exact. The routes below treat auth as OPTIONAL (or
 * resolve it too late), so `identify()` falls through to the proxy-attested
 * address -- and when there is no trustworthy one (any environment without an
 * `x-forwarded-for` chain, `next dev` included) the module's stated posture is
 * to REFUSE the caller rather than pool them. Naively adopting the limiter
 * there would 429 every signed-out caller instead of bounding them. Each needs
 * an identity decision first; that is a change about authentication, not about
 * rate limiting, and it is why they wait.
 *
 * THE "NO AUTH GATE AT ALL" COHORT IS GONE. Four routes used to sit here for a
 * strictly worse reason than optional auth -- they had no authentication of any
 * kind, so an anonymous caller spent model money directly. Three were gated
 * first and bounded second (that order is the whole point) and now appear in
 * BOUNDED; `GATED` below is the standing witness that the gate is still there
 * and still ahead of the spend. The fourth, app/api/fetch-posting/route.js,
 * never spent model money at all -- it spent bandwidth and this server's
 * outbound reputation aimed at a host the CALLER chose -- and once gated it
 * was found to have ZERO callers anywhere in the app, so it was deleted
 * rather than tuned. It appears in neither BOUNDED nor DEFERRED now.
 */
const DEFERRED = [
  {
    route: "app/api/cron/position-glossary/route.js",
    why: "a cron worker, not a user-facing route. The shared CRON_SECRET (or Vercel's own x-vercel-cron header) IS the control here, and there is no caller identity to key a limiter on -- a per-caller bound keyed on the scheduler would only break a legitimate retry. Its spend is bounded where it can actually be enforced: the per-fingerprint and lifetime model_calls caps are database CHECKs, and the queue lease stops two invocations racing the same row.",
  },
  {
    route: "app/api/copilot/answer/route.js",
    why: "OUT OF SCOPE for this change by instruction -- its diff must stay empty. It hard-authenticates, so it is the cheapest of these to bound and should be first in the next pass.",
  },
  {
    route: "app/api/chat/route.js",
    why: "auth here is best-effort and used only for logging; the model call happens for a signed-out caller too. Needs an identity decision before a bound can be correct.",
  },
  {
    route: "app/api/experience/knowledge/route.js",
    why: "POST calls Gemini; GET is a plain read of the caller's own rows. Its auth is resolved inside openScopeRequest AFTER the scope fan-out, so a correct bound wants that helper reordered first.",
  },
  {
    route: "app/api/tailor/route.js",
    why: "the heaviest generation in the product, but auth is optional by design (a signed-out caller gets the bundled library) so identify() would refuse rather than bound them without a proxy chain.",
  },
  {
    route: "app/api/tailor/proposals/route.js",
    why: "same optional-auth shape as the tailor route; only the external/embedded engines implement proposals, so the paid path is narrower.",
  },
  {
    route: "app/api/library/preview/route.js",
    why: "reaches an engine but the embedded one is deterministic and keyless; ranks last of the engine routes.",
  },
];

/**
 * The three routes that shipped with NO authentication of any kind, with the
 * handler each one gates. Kept as its own table rather than folded into
 * BOUNDED: every other bounded route was already authenticated before it was
 * bounded, so for these three the gate is the finding and the bound is the
 * follow-on. A future edit that removed the gate would leave every assertion in
 * BOUNDED green -- the limiter would still be there, keyed on a `userId` that
 * had quietly become `null`, which `identify()` then answers with
 * `unidentified` and `check()` turns into a 429 for EVERY caller.
 *
 * A fourth route, app/api/fetch-posting/route.js, shipped in this same
 * no-auth cohort and was gated the same way in the same change. It is not
 * listed here: once gated, it was found to have ZERO callers anywhere in the
 * app (the in-product scraping path is lib/scrape/fetchUrlContent.js, which
 * also carries the real SSRF defences -- checkRequestUrl, isBlockedHost,
 * parseIPv4/parseIPv6 -- that this route's inline BLOCKED_HOSTNAMES/
 * BLOCKED_IP_PREFIXES string-prefix check duplicated and did not match), so
 * the route and its test were deleted outright rather than kept in this
 * table.
 */
const GATED = [
  { route: "app/api/posting-from-image/route.js", handler: "POST" },
  { route: "app/api/company-research/route.js", handler: "POST" },
  { route: "app/api/extract-employment/route.js", handler: "POST" },
];

const BOUNDED_ROUTES = new Set(BOUNDED.map((entry) => entry.route));
const DEFERRED_ROUTES = new Set(DEFERRED.map((entry) => entry.route));

function sourceOf(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/**
 * Source with its comments removed, so a rule ABOUT an identifier is not
 * mistaken for a use of it. Every one of these routes carries a comment saying
 * "never `getSession()`" and explaining why -- exactly the prose a naive
 * `not.toMatch(/getSession\(/)` reads as the defect it is warning against.
 *
 * Deliberately conservative: block comments, and only whole-line `//` comments.
 * A trailing `//` is left alone because `"https://…"` inside a string literal
 * is not a comment, and truncating there could hide real code further along the
 * line.
 */
function codeOf(relativePath) {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Offset of the first exported HTTP handler, or -1. */
function firstHandlerAt(source) {
  const match = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.exec(source);
  return match ? match.index : -1;
}

/** Every `app/api/**\/route.js`, relative to the app root, POSIX-separated. */
function allRouteFiles(dir = APP_API, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) allRouteFiles(full, found);
    else if (entry === "route.js") {
      found.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
    }
  }
  return found;
}

// Every .js under lib/ and app/, walked once and remembered. Only a route that
// NAMES its bound (rather than writing a literal) pays for this, and only once.
let JS_FILES = null;
function walkJs(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkJs(full, found);
    else if (full.endsWith(".js")) found.push(full);
  }
  return found;
}
function allJsFiles() {
  if (!JS_FILES) {
    JS_FILES = [
      ...walkJs(path.join(process.cwd(), "lib")),
      ...walkJs(path.join(process.cwd(), "app")),
    ];
  }
  return JS_FILES;
}

describe("every bounded route builds its limiter at MODULE scope", () => {
  it.each(BOUNDED)("$route", ({ route }) => {
    const source = sourceOf(route);

    // The declaration itself: a top-level `const <name> = createRateLimiter(`.
    // Anchored to the start of a line, so an indented one -- i.e. one inside a
    // function body -- does not match.
    const declaration = /^const \w+ = createRateLimiter\(/m;
    expect(source).toMatch(declaration);

    const limiterAt = source.search(declaration);
    const handlerAt = firstHandlerAt(source);
    expect(handlerAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeLessThan(handlerAt);

    // …and nothing constructs a second one once the handlers open. THIS is the
    // assertion that catches the per-request limiter: that shape permits every
    // request while looking correct, so no behavioural test of a single call
    // can see it and only a construction-site check can.
    expect(source.slice(handlerAt)).not.toMatch(/createRateLimiter\(/);
  });
});

describe("every bounded route imports the shared limiter rather than inventing a bound", () => {
  it.each(BOUNDED)("$route", ({ route }) => {
    const source = sourceOf(route);
    expect(source).toMatch(/from "@\/lib\/rateLimit(\/index)?"/);
    expect(source).toMatch(/\bcreateRateLimiter\b/);
    expect(source).toMatch(/\bidentify\b/);
    expect(source).toMatch(/\brateLimitHeaders\b/);
  });
});

describe("a denial is a 429 built from the limiter's own headers, never a throw", () => {
  it.each(BOUNDED)("$route", ({ route }) => {
    const source = sourceOf(route);
    // `rateLimitHeaders(decision)` and `status: 429` have to appear together:
    // a 429 with no headers leaves the caller nothing to back off on, and a
    // header bag on some other status is not a denial.
    expect(source).toMatch(/status:\s*429/);
    expect(source).toMatch(/headers:\s*rateLimitHeaders\(/);
    // The decision is returned, not raised. `check()` resolves a discriminated
    // result precisely so no route has to wrap it in try/catch and 500 by
    // forgetting to.
    expect(source).not.toMatch(/throw\s+new\s+\w*RateLimit/);
  });
});

describe("each route's declared bound matches the reasoned number recorded here", () => {
  // A route may write its bound as a literal OR name a constant. Both are read
  // here, because forcing a literal would be the wrong pressure: the glossary
  // route's bounds are also enforced as database CHECKs, and a named constant is
  // what keeps those two copies from drifting. An identifier is resolved to the
  // `export const NAME = <number>` that declares it, so this still compares a
  // NUMBER -- a route that renames its constant to one holding a different value
  // fails exactly as a changed literal would.
  function resolveBound(token) {
    // Numeric separators are stripped HERE, not from the argument text before
    // the token is read -- doing it earlier turns GENERATION_RATE_LIMIT into
    // GENERATIONRATELIMIT and no declaration matches it.
    if (/^[\d_]+$/.test(token)) return Number(token.replace(/_/g, ""));
    const decl = new RegExp(`export const ${token}\\s*=\\s*([\\d_]+)`);
    for (const file of allJsFiles()) {
      const hit = decl.exec(readFileSync(file, "utf8"));
      if (hit) return Number(hit[1].replace(/_/g, ""));
    }
    return null;
  }

  it.each(BOUNDED)("$route keeps limit $limit over $windowMs ms", ({ route, limit, windowMs }) => {
    const source = sourceOf(route);
    const call = /createRateLimiter\(\{([^}]*)\}\)/.exec(source);
    expect(call).not.toBeNull();
    const args = call[1];
    const limitToken = /limit:\s*([A-Za-z0-9_]+)/.exec(args);
    const windowToken = /windowMs:\s*([A-Za-z0-9_]+)/.exec(args);
    expect(limitToken, `${route} passes no limit to createRateLimiter`).not.toBeNull();
    expect(windowToken, `${route} passes no windowMs to createRateLimiter`).not.toBeNull();
    expect(resolveBound(limitToken[1]), `${route}'s limit`).toBe(limit);
    expect(resolveBound(windowToken[1]), `${route}'s windowMs`).toBe(windowMs);
  });
});

describe("the four formerly-unauthenticated routes resolve an identity first", () => {
  it.each(GATED)("$route gates on getUser() and refuses without an id", ({ route, handler }) => {
    const code = codeOf(route);

    // The shared helper, not a private re-implementation. `getAuth()` is the
    // one place `auth.getUser()` is called for these routes.
    expect(code).toMatch(/from "@\/lib\/experience\/apiAuth"/);
    expect(code).toMatch(/\bgetAuth\(\)/);
    expect(code).toMatch(/\bunauthorized\(\)/);

    // NEVER getSession(). app/api/health/route.js records the measurement:
    // getSession() makes ZERO network requests, so gating on it is not a weak
    // check, it is a total bypass. Checked against COMMENT-STRIPPED source --
    // each of these routes explains that rule in a comment, and the rule's own
    // wording must not read as a violation of it.
    expect(code).not.toMatch(/getSession\(/);

    // The gate is INSIDE the handler and is the first thing in it.
    const handlerAt = code.indexOf(`export async function ${handler}`);
    expect(handlerAt).toBeGreaterThan(-1);
    const body = code.slice(handlerAt);
    const authAt = body.search(/\bgetAuth\(\)/);
    const refuseAt = body.search(/\bunauthorized\(\)/);
    expect(authAt).toBeGreaterThan(-1);
    expect(refuseAt).toBeGreaterThan(authAt);
  });

  it.each(GATED)("$route resolves the id BEFORE it checks the bound", ({ route, handler }) => {
    // Order is the whole adoption contract: `identify()` prefers the user id
    // and falls back to a proxy-attested address, so checking the bound before
    // the auth resolves would key every request on the address (or, with no
    // trustworthy chain, refuse it) instead of on the caller.
    const code = codeOf(route);
    const body = code.slice(code.indexOf(`export async function ${handler}`));
    const authAt = body.search(/\bgetAuth\(\)/);
    const checkAt = body.search(/\.check\(identify\(/);
    expect(checkAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(checkAt);
  });
});

describe("the triage itself is pinned", () => {
  it("leaves no model-calling route unaccounted for", () => {
    // A route that reaches the Gemini client, the shared extractor, or the
    // tailoring engine registry spends money per request by definition. Every
    // one of them must be a deliberate entry in BOUNDED or DEFERRED above --
    // silence is not an option, because silence is exactly how 75 of 76 routes
    // ended up unbounded in the first place.
    const MODEL_IMPORT = /from "@\/lib\/llm\/(geminiClient|extractEmployment|engines)"/;
    const modelRoutes = allRouteFiles().filter((route) => MODEL_IMPORT.test(sourceOf(route)));
    expect(modelRoutes.length).toBeGreaterThan(0);

    const unaccounted = modelRoutes.filter(
      (route) => !BOUNDED_ROUTES.has(route) && !DEFERRED_ROUTES.has(route),
    );
    expect(unaccounted).toEqual([]);
  });

  it("never lists the same route as both bounded and deferred", () => {
    const both = [...BOUNDED_ROUTES].filter((route) => DEFERRED_ROUTES.has(route));
    expect(both).toEqual([]);
  });

  it("gives every deferred route a stated reason", () => {
    for (const entry of DEFERRED) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it("keeps app/api/copilot/answer/route.js untouched by this change", () => {
    // Scope constraint, written down where a later pass will trip over it: the
    // answer route's diff had to stay empty, so it is deferred rather than
    // bounded. If someone bounds it, they must move this line deliberately.
    expect(DEFERRED_ROUTES.has("app/api/copilot/answer/route.js")).toBe(true);
    expect(sourceOf("app/api/copilot/answer/route.js")).not.toMatch(/createRateLimiter/);
  });
});
