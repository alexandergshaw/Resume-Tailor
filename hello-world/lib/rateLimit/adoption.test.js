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
 * succeeds and the bound is exact. The routes below either have no auth gate at
 * all or treat auth as optional, so `identify()` falls through to the
 * proxy-attested address -- and when there is no trustworthy one (any
 * environment without an `x-forwarded-for` chain, `next dev` included) the
 * module's stated posture is to REFUSE the caller rather than pool them. Naively
 * adopting the limiter there would 429 every signed-out caller instead of
 * bounding them. Each needs an identity decision first; that is a change about
 * authentication, not about rate limiting, and it is why they wait.
 */
const DEFERRED = [
  {
    route: "app/api/copilot/answer/route.js",
    why: "OUT OF SCOPE for this change by instruction -- its diff must stay empty. It hard-authenticates, so it is the cheapest of these to bound and should be first in the next pass.",
  },
  {
    route: "app/api/chat/route.js",
    why: "auth here is best-effort and used only for logging; the model call happens for a signed-out caller too. Needs an identity decision before a bound can be correct.",
  },
  {
    route: "app/api/company-research/route.js",
    why: "NO auth gate at all -- an anonymous caller can spend a grounded Gemini call. The gap is the missing identity, and a bound is the second half of that fix, not the first.",
  },
  {
    route: "app/api/posting-from-image/route.js",
    why: "NO auth gate at all, and the most expensive single call in the product (vision + OCR + web search). Same identity problem; a 12MB upload is the only thing throttling a loop today.",
  },
  {
    route: "app/api/experience/knowledge/route.js",
    why: "POST calls Gemini; GET is a plain read of the caller's own rows. Its auth is resolved inside openScopeRequest AFTER the scope fan-out, so a correct bound wants that helper reordered first.",
  },
  {
    route: "app/api/extract-employment/route.js",
    why: "NO auth gate at all and it calls Gemini on the posted resume text. The single worst finding of the triage, and unfixable by a limiter alone: with no user id and no proxy chain there is nothing to key on.",
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

const BOUNDED_ROUTES = new Set(BOUNDED.map((entry) => entry.route));
const DEFERRED_ROUTES = new Set(DEFERRED.map((entry) => entry.route));

function sourceOf(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
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
  it.each(BOUNDED)("$route keeps limit $limit over $windowMs ms", ({ route, limit, windowMs }) => {
    const source = sourceOf(route);
    const call = /createRateLimiter\(\{([^}]*)\}\)/.exec(source);
    expect(call).not.toBeNull();
    const args = call[1].replace(/_/g, "");
    expect(args).toMatch(new RegExp(`limit:\\s*${limit}\\b`));
    expect(args).toMatch(new RegExp(`windowMs:\\s*${windowMs}\\b`));
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
