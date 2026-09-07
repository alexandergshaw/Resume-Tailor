import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// This endpoint has two audiences with opposite needs, so it answers in two
// tiers. `middleware.js` deliberately never gates `/api/*`, so tier 1 is what
// the whole internet can read.
//
// TIER 1 — anyone, no credentials:  `{ ok: true }`, 200, and nothing else.
//   A liveness answer: no environment VALUE, no key prefix, no URL, and no
//   database work at all — `probeAdminDb` is strictly behind the gate, so an
//   anonymous flood cannot be turned into load on `applied_jobs`. The 200 is
//   kept on purpose: a platform uptime check must be able to probe this path
//   without credentials.
//
//   What tier 1 actually COSTS, stated exactly, because the first version of
//   this comment claimed it "reads no environment variable and makes no call
//   to Supabase" and both halves of that were false:
//
//   (a) It reads env. `hasOperatorSecret` reads CRON_SECRET, and building the
//       SSR client reads NEXT_PUBLIC_SUPABASE_URL and
//       NEXT_PUBLIC_SUPABASE_ANON_KEY. Reading is not disclosing; "no value
//       reaches the body" is the property that matters and the one the tests
//       pin. Constructing the client is pure — no I/O — so this is two env
//       reads and an allocation.
//
//   (b) The session gate calls `auth.getUser()`, and that CAN leave the
//       process. Measured against the installed @supabase/ssr 0.10.3 and
//       @supabase/auth-js 2.106.2 with a recording fetch stub:
//         - no cookie, an unrelated cookie, or an `sb-<ref>-auth-token`
//           cookie whose payload is not a session object  ->  ZERO HTTP
//           requests; auth-js short-circuits with AuthSessionMissingError.
//         - an attacker-supplied `sb-<ref>-auth-token` that DOES decode to
//           `{access_token, refresh_token, expires_at}` (auth-js checks only
//           that those three keys exist)  ->  exactly ONE request to the
//           Supabase AUTH server: `GET /auth/v1/user` while the stated
//           expiry is in the future, `POST /auth/v1/token?grant_type=
//           refresh_token` once it is in the past.
//       Never a request to Postgres, in any of those cases.
//
//   RESIDUAL, knowingly accepted: (b) lets an anonymous caller spend one
//   request to cause a GoTrue request. Pass-through, not amplification, and
//   it never reaches the database. It is not closable by a cheap pre-check —
//   the cookie is attacker-supplied, so any gate that reads it is a gate the
//   attacker satisfies — and the only real fixes are dropping the session
//   gate (losing the browser path) or rate limiting. Neither is worth it for
//   a pass-through, so it stays named rather than papered over by a comment
//   that says "no call".
//
//   It is also not this file's alone, and the honest count is TWO, not one:
//   the `middleware.js` matcher covers `/api/*`, and `updateSession` builds
//   its own SSR client and calls `auth.getUser()` at
//   lib/supabase/middleware.js:34 — BEFORE the `isApiRoute` early return on
//   :41 that is what "never gates /api/*" above actually means. So every
//   request here has already paid that cost once before this file runs, on
//   the same cookie, and the route's own call is the second. Collapsing the
//   two would be a change to middleware for every route in the app, not
//   something this endpoint can do for itself.
//
// TIER 2 — a signed-in user, or the `CRON_SECRET` bearer:  the deployment
//   diagnostics, as ONE BOOLEAN PER ITEM. Never a value, never a prefix,
//   never the project URL. The diagnostics are the reason this route exists —
//   a missing env var is otherwise invisible until a user hits a failure —
//   so they are moved, not deleted.
//
// It previously returned, unauthenticated: the Supabase project URL verbatim,
// the alert From address verbatim, and the first 20 characters of both the
// anon key and the SERVICE ROLE key. A key prefix is not harmless for being
// short — for a Supabase JWT the leading characters are the encoded JOSE
// header and the start of the claim set, which identify the algorithm and the
// key class (anon vs service_role), confirm a real key is present, and narrow
// any offline guessing. Together with the project URL that is a complete
// pointer at which backend to attack.
//
// Two gates, because they fail in different directions. A session is the
// ordinary path (an operator opens the URL in the browser they are already
// signed into). The `CRON_SECRET` bearer is the break-glass path for the exact
// case this endpoint is for: when the Supabase configuration is the thing that
// is broken, nobody can sign in to read the diagnostics that say so.
//
// KNOWINGLY ACCEPTED: the boolean inventory is still a disclosure — it names
// which integrations exist — so it is behind the gate rather than public, and
// any signed-in user of this app can read it. That is the residual, and it is
// bounded to "which env vars are set" plus a reachability message. Widening
// the gate (or returning any value, prefix or URL) is the thing not to do.

// The env vars whose VALUES must never reach a response body, in any tier.
const SECRET_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "CRON_SECRET",
];

/**
 * Scrub any configured secret value out of an error string before it is
 * returned. The messages come from supabase-js and undici, which do not echo
 * credentials today — but "does not today" is not a guarantee, and an error
 * string is the one place left where text from outside this file reaches the
 * response body.
 *
 * @param {unknown} message
 * @returns {string|null}
 */
function redactSecrets(message) {
  if (typeof message !== "string" || message === "") return null;
  let scrubbed = message;
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    // Very short values would match everywhere and turn the message to noise.
    // Of the six keys only CRON_SECRET (operator-chosen) and EMAIL_FROM can
    // realistically fall under 8 characters, and neither is ever handed to
    // supabase-js or undici, so neither can appear in the messages this
    // scrubs. The project URL is >= 9 by construction ("https://" + a host)
    // and the three keys are JWTs or `re_`-prefixed tokens.
    if (typeof value === "string" && value.length >= 8) {
      scrubbed = scrubbed.split(value).join(`[redacted:${key}]`);
    }
  }
  return scrubbed;
}

/**
 * Break-glass gate: an exact `Authorization: Bearer ${CRON_SECRET}` match.
 *
 * Fails CLOSED when `CRON_SECRET` is unset or empty, so an empty secret can
 * never make a bare `Bearer ` header authorize. Deliberately does NOT fall
 * back to the cron route's `x-vercel-cron: 1` header — that header is
 * attacker-supplied on a direct request and would be no gate at all.
 *
 * Free by design: one header read and one env read, no I/O. `GET` therefore
 * evaluates this FIRST, so a break-glass caller never pays for a session
 * lookup — which matters, because the session lookup is the one part of the
 * request that can touch the network (see the TIER 1 note above).
 *
 * The comparison is a plain `===`, on purpose, not `crypto.timingSafeEqual`.
 * `===` on two strings is length-first then bytewise and does short-circuit,
 * so it does leak a timing signal — of single-digit NANOSECONDS across a
 * long random secret. The transport is a serverless HTTP handler: per-request
 * jitter from the network path, TLS, Node's HTTP stack and lambda scheduling
 * is tens of microseconds at the absolute best and routinely milliseconds,
 * three to six orders of magnitude above the signal, and it is not noise an
 * attacker averages away cheaply because it is not independent of the probe.
 * Nothing downstream re-exposes the compare either: the authorized branch
 * makes two outbound requests, so its latency and body size differ from tier
 * 1 by far more than the compare ever could — that loud oracle only fires
 * once you already hold the secret. And a constant-time compare would have to
 * be done properly: an early `return false` on a length mismatch puts the
 * length leak straight back, so the correct shape is `timingSafeEqual` over
 * two fixed-width SHA-256 digests. That is real machinery bought for a signal
 * that does not survive the wire. Ruled a non-issue deliberately, not by
 * omission. What actually carries the weight here is that CRON_SECRET is long
 * and random — the README says so where it is set, and `/api/cron/tailor` and
 * `/api/cron/feed-ingest` compare it the same way.
 *
 * @param {Request|undefined} request
 * @returns {boolean}
 */
function hasOperatorSecret(request) {
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== "string" || secret.length === 0) return false;
  const header = request?.headers?.get?.("authorization") || "";
  return header === `Bearer ${secret}`;
}

/** Build the SSR client once; a construction failure is itself a diagnostic. */
async function loadSsrClient() {
  try {
    return { client: await createClient(), error: null };
  } catch (e) {
    return { client: null, error: e?.message || String(e) };
  }
}

/** Session gate. Fails closed on every error — no user, no detail. */
async function readUser(client) {
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    return data?.user ?? null;
  } catch {
    return null;
  }
}

// An obviously-fake token. It is not a credential and is not checked against
// anything — it exists only to give the auth server something to reject, and
// a rejection is how we learn the server answered at all.
const AUTH_PROBE_TOKEN = "health-probe.not-a-real-token";

/**
 * Auth reachability — does the Supabase auth server ANSWER?
 *
 * Neither the gate's bare `getUser()` nor `getSession()` can tell us that,
 * because both answer out of the cookie. Measured on @supabase/auth-js
 * 2.106.2 with a recording fetch stub:
 *   - `getUser()` with no session short-circuits to AuthSessionMissingError
 *     after ZERO requests, so it would report a healthy deployment as broken.
 *     (That much the previous version of this function had right.)
 *   - `getSession()` also makes ZERO requests — with no session, and with an
 *     unexpired one — and returns `error: null`. So it reported `reachable:
 *     true` without ever contacting the auth server. It only leaves the
 *     process at all when the stored session is already expired and a refresh
 *     is attempted. A permanent false "healthy" is the worst possible answer
 *     for a field an operator reads during an outage, which is the one time
 *     this route gets opened at all — and the CRON_SECRET path, which exists
 *     precisely for "Supabase is the broken thing", carries no session cookie
 *     and so always took that zero-request branch.
 *
 * `getUser(jwt)` takes the session out of it: auth-js skips the cookie
 * entirely and sends the token to `GET /auth/v1/user`, so there is always
 * exactly one round trip. Measured on the installed 2.106.2, with the
 * transport stubbed three ways:
 *   - HTTP 401 (what a healthy server returns for this deliberately invalid
 *     token)  ->  AuthApiError, `status` 401  ->  REACHABLE. Treating "any
 *     error" as unreachable would make the field permanently false.
 *   - transport failure  ->  AuthRetryableFetchError, `status` 0  ->  not
 *     reachable.
 *   - HTTP 500  ->  AuthApiError, `status` 500. Reported as NOT reachable:
 *     the socket opened, but for the operator reading this during an outage
 *     "auth is 5xx-ing" and "auth is not answering" mean the same thing, and
 *     calling it healthy would put back the false-positive this replaced.
 *
 * "Reachable" therefore means "auth served a usable answer", not "the anon
 * key is valid" — `adminDbReachable` is the probe that exercises a real key.
 */
async function probeAuth(client, clientError) {
  if (!client) return { reachable: false, error: redactSecrets(clientError) };
  try {
    const { error } = await client.auth.getUser(AUTH_PROBE_TOKEN);
    // status 0 => nothing answered; status >= 500 => auth is not serving.
    if (error && (!error.status || error.status >= 500)) {
      return { reachable: false, error: redactSecrets(error.message) };
    }
    return { reachable: true, error: null };
  } catch (e) {
    return { reachable: false, error: redactSecrets(e?.message || String(e)) };
  }
}

/**
 * Admin/service-role reachability. Only ever runs for an authorized caller.
 *
 * Builds its own client rather than using `@/lib/supabase/admin`, on purpose:
 * that helper memoises one client for the life of the process, so after the
 * first success it could no longer observe a construction failure — which is
 * exactly the diagnostic this route exists to report. Do not "simplify" this
 * into the shared helper.
 */
async function probeAdminDb() {
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await admin.from("applied_jobs").select("id").limit(1);
    if (error) return { reachable: false, error: redactSecrets(error.message) };
    return { reachable: true, error: null };
  } catch (e) {
    return { reachable: false, error: redactSecrets(e?.message || String(e)) };
  }
}

// This response varies by credential — the Authorization header on the
// operator path, the session cookie on the ordinary one — and tier 2 carries
// the configuration inventory. Nothing in between should keep a copy that a
// different caller could then be served. Reading cookies already marks the
// route dynamic, so today nothing does; saying it costs one header and stops
// that from being a thing a future change can quietly undo.
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** True when the env var is set to a non-empty string. Never its value. */
function isConfigured(name) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0;
}

export async function GET(request) {
  // Constructing the client is pure — no I/O — and both branches below need
  // it (the gate to read the session, tier 2 to probe auth), so there is
  // nothing to defer here. The session LOOKUP is the part that can hit the
  // network, and `||` short-circuits it away for a break-glass caller: the
  // free header check is evaluated first and `readUser` never runs.
  const { client, error: clientError } = await loadSsrClient();
  const authorized = hasOperatorSecret(request) || !!(await readUser(client));

  // TIER 1. Return before any env VALUE, any key prefix, or the database.
  if (!authorized) return Response.json({ ok: true }, NO_STORE);

  // TIER 2.
  const auth = await probeAuth(client, clientError);
  const adminDb = await probeAdminDb();

  return Response.json(
    {
      ok: true,
      authorized: true,
      supabaseUrl: isConfigured("NEXT_PUBLIC_SUPABASE_URL"),
      supabaseAnonKey: isConfigured("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      supabaseServiceKey: isConfigured("SUPABASE_SERVICE_ROLE_KEY"),
      // Email alerts ("email me when new jobs appear") are sent via Resend
      // from the tailor cron. When these are missing, sends are silently
      // skipped, so surface them here to make "no emails" easy to diagnose.
      // `emailFrom` is now a boolean: the address itself was being handed to
      // anonymous callers.
      resendApiKey: isConfigured("RESEND_API_KEY"),
      emailFrom: isConfigured("EMAIL_FROM"),
      cronSecret: isConfigured("CRON_SECRET"),
      authReachable: auth.reachable,
      authError: auth.error,
      adminDbReachable: adminDb.reachable,
      adminDbError: adminDb.error,
    },
    NO_STORE,
  );
}
