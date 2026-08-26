// AC-V5.2 / AC-V4.5 / AC-V4.6. The per-session cache that stops
// /api/copilot/answer re-running the same Supabase fan-out on every question
// of an interview, plus the deadline primitive a later feature (verified
// company facts, AC-V4) rides on top of.
//
// Measured from the session the user recorded on 2026-08-25: the route runs
// `supabase.auth.getUser()` and then a Promise.all of `fetchApplicationDocs`,
// `fetchPostingDescription`, `fetchPostingEmployer` and `listPages` /
// `listAttachmentsByPage` BEFORE the model call starts — on every question,
// for data that cannot change during a session. That is latency the
// candidate feels while sitting in front of an interviewer.
//
// This module is pure: no clock, no Supabase, no network. `now` arrives as an
// argument to every call that needs one, exactly as lib/copilot/questionPin.js's
// resolvePin already requires of its callers, so the whole thing is testable
// with no timers. See lib/copilot/answerSessionCache.test.js for the contract
// this file exists to satisfy.
//
// C5 (Group V architecture doc): `supabase.auth.getUser()` is NEVER cached
// here, and must not be. Its result is what PRODUCES the cache key (the user
// id) — there is no key available before it resolves, and keying on the
// caller's access token instead would turn an authentication check into a
// cache lookup, which is a correctness regression, not a latency win
// (AC-V5.5). The auth round trip stays on every request; only the FIVE data
// queries it gates are cached — fetchApplicationDocs, fetchPostingDescription,
// fetchPostingEmployer, listPages and listAttachmentsByPage, exactly as the
// paragraph at the top of this file lists them. (It said "four" here for one
// revision after fetchPostingEmployer joined the fan-out for AC-V4/C8; the
// two paragraphs disagreeing with each other about the same Promise.all is
// worse than either wording on its own.)
//
// What this cache must NEVER hold, stated here because it is the single most
// likely way to get this wrong (and there is a passing test in
// app/api/copilot/answer/route.latency.test.js that exists specifically to
// catch it): the knowledge-base block, the selected story, or the grounding
// flags. Those are ranked/scored against THIS question's text — caching them
// alongside the raw résumé/posting/pages rows would silently answer question
// two with question one's page selection, with every other test still green.
// Only cache raw fetch results.

// A cache entry is fresh from `entry.createdAt` for `ttlMs`, then it is dead
// weight: "stale" and "miss" are deliberately the same event (see `get`
// below) rather than "serve stale, refresh in the background" — the latter
// is exactly the pattern that would let an edited résumé outlive its TTL.
//
// `maxEntries` BOUNDS THE ENTRY COUNT, NOT THE MEMORY. Stated because the
// name invites the other reading: an entry here holds a whole loaded context
// — including the full, untruncated `pages` array — so the real bound is
// `maxEntries × the largest context one user can have`, not a byte figure
// anyone chose. Accepted as-is rather than fixed: the count only reaches its
// limit with 200 concurrent interview sessions on one instance, which is not
// a scenario this product has. If it ever is, the fix is a size-aware bound,
// not a smaller number.
export function createTtlCache({ ttlMs, maxEntries = Infinity } = {}) {
  const store = new Map();

  function isFresh(entry, now) {
    return !!entry && now - entry.createdAt < ttlMs;
  }

  // Oldest-first, by Map insertion order — re-inserting a key (on a stale
  // reload) moves it to the end, which is what "oldest" should mean here.
  function evictOldest() {
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
  }

  // Stores the LOADER'S PROMISE, not its resolved value — the whole
  // mechanism behind "two concurrent first questions share one build rather
  // than racing two". The first call for a key starts `loader` and stores
  // the pending promise; a second call for the same key while it is still
  // pending finds that promise already in the map and returns it, with
  // `loader` never invoked a second time.
  function get(key, loader, { now = Date.now() } = {}) {
    const existing = store.get(key);
    if (isFresh(existing, now)) return existing.promise;
    // Stale (or missing): delete first, then fall straight through to the
    // miss path below. The stale value is never returned, not even once —
    // see this module's header on why "stale" and "miss" are one event.
    if (existing) store.delete(key);

    const entry = { createdAt: now, settled: false, value: undefined, promise: null };
    // `loader` is invoked SYNCHRONOUSLY, right here — not deferred to a
    // microtask — because a second `get` for the same key can arrive before
    // this tick ends (that is exactly what "collapses two concurrent
    // requests into one load" means), and it must find this entry already
    // in the map. A loader that throws synchronously still produces a
    // rejected promise rather than throwing out of `get` itself.
    let promise;
    try {
      promise = Promise.resolve(loader(key));
    } catch (err) {
      promise = Promise.reject(err);
    }
    entry.promise = promise;
    store.set(key, entry);
    evictOldest();

    promise.then(
      (value) => {
        entry.settled = true;
        entry.value = value;
      },
      () => {
        // Never cache a rejection: a bad round trip must not turn into ten
        // minutes of answers built from nothing, with no error the user can
        // see. Only remove THIS entry, and only if a stale reload hasn't
        // already replaced it with a newer one.
        if (store.get(key) === entry) store.delete(key);
      },
    );

    return promise;
  }

  // Reports the resolved value of a fresh, already-settled entry, or `null`
  // for anything else (missing, stale, or still pending) — without ever
  // starting a load and without waiting a tick of real time. This is the
  // TTL cache's own freshness check; it is a different primitive from the
  // standalone `settleWithin` below, which races a single promise against a
  // deadline and is not itself cache-aware.
  function peek(key, { now = Date.now() } = {}) {
    const existing = store.get(key);
    if (!isFresh(existing, now)) return null;
    return existing.settled ? existing.value : null;
  }

  // Test-only escape hatch: nothing in production code needs to empty a
  // live cache mid-process. Exists because several route test files reuse
  // the same synthetic (userId, applicationId) pair across independent
  // `it()` blocks with DIFFERENT mocked Supabase content — a real product
  // behaviour this cache is correct to serve within one interview session,
  // but exactly the cross-test leakage a shared-module-scope cache would
  // otherwise cause between unrelated test cases. See the `beforeEach` in
  // route.test.js / route.knowledgeBase.test.js / streaming.test.js /
  // idealProjectWiring.test.js / route.latency.test.js.
  function clear() {
    store.clear();
  }

  return { get, peek, clear, size: () => store.size };
}

// V5.2's cache: the five-query Supabase fan-out (fetchPostingEmployer joined
// it for AC-V4/C8), keyed `${userId}::${applicationId}`, computed only after
// auth.getUser() resolves. 10 minutes is the whole answer to "a stale résumé
// must not outlive a session" — there is no signal from the client that a
// résumé was edited mid-interview, so the TTL IS the bound. 200 entries so a
// long-lived server instance cannot grow without limit; entries are evicted
// oldest-first past that, same as any other key.
//
// PER INSTANCE, and instances are ephemeral — so "a second question of the
// same session skips the fan-out" is the expected case, not a guarantee. A
// session that lands on a different instance simply re-runs the loader and
// re-pays the round trips. That is correctness-neutral by construction (the
// loader is the same function either way, and nothing downstream can tell a
// hit from a miss), which is why it is recorded here rather than solved with
// a shared store — but it is worth stating plainly, because "never re-runs"
// is the kind of claim someone later builds a latency budget on.
export const answerContextCache = createTtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });

// AC-V4.5/AC-V4.9: the verified-company-facts cache, keyed by the SAME
// `${userId}::${applicationId}` string as answerContextCache above but held
// in a DIFFERENT Map, so the two can never collide on that shared key. Lives
// here rather than privately inside app/api/copilot/answer/route.js — where
// it started — for the reason this file's own `clear()` comment already
// gives: a module-scope cache that route tests cannot empty is a cache that
// leaks one `it()` block's mocked search result into the next, and the route
// test file had to work around it by minting a unique applicationId per case.
// A stated-and-untrue coupling ("`clear()` is the escape hatch, and here are
// the test files that call it") is worse than no comment, so the instance is
// now where the comment already said it was.
//
// 30 minutes, longer than answerContextCache's 10: a company's facts change
// far less often than which résumé is attached to an application, and a
// fresh search is a real Gemini call plus a page fetch per candidate fact —
// worth reusing longer. Same 200-entry bound, for the same reason.
export const companyFactsCache = createTtlCache({ ttlMs: 30 * 60 * 1000, maxEntries: 200 });

// AC-V4.6 (wave 2, verified company facts): "start it, don't block on it,
// except for a company-directed question." Resolves to the promise's value,
// or `fallback` if `ms` elapses first — and never rejects either way, because
// a failed lookup must degrade to "no facts" (the prompt already has an
// honest instruction for that), never a 500 on an otherwise answerable
// question.
//
// The promise itself keeps running after the deadline wins; nothing here
// cancels it, and its cache entry (if it has one) stays, so the NEXT
// question gets the facts even when this one didn't wait for them.
//
// `timerImpl`/`clearImpl` are the whole answer to "without a timer nobody
// can test this": a test can force the deadline to win by calling its `fn`
// immediately, or force the promise to win with a timer that never fires —
// no fake timers, no advanceTimersByTime, no real elapsed time in the suite.
export function settleWithin(promise, ms, { fallback = null, timerImpl = setTimeout, clearImpl = clearTimeout } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const timerId = timerImpl(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearImpl(timerId);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearImpl(timerId);
        resolve(fallback);
      },
    );
  });
}
