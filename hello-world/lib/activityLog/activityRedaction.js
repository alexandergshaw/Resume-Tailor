// THE SCRUBBER for the session-wide activity log.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A DIFFERENT POSTURE FROM THE SIBLING LOGS, AND WHERE THE LINE IS
// ---------------------------------------------------------------------------
// lib/duplicateApply/duplicateApplyLogDocument.js records DECISIONS and never
// application history: no employer, no title, no URL, because a banner is
// transient and a downloaded file gets mailed to support. That ruling is right
// FOR THAT FILE and does not transfer here. The owner's ask for this one is
// "everything that has happened on the app in that session", the audience is
// the owner reading their own session, and a log that hashed every path and
// dropped every status could not answer the question it exists to answer.
//
// So the posture is INCLUDE BY DEFAULT, with a hard floor that no ask can move:
//
//   INCLUDED  request method, request PATH, query parameter NAMES, response
//             status, duration, error messages and types, navigation paths,
//             console warnings and errors, and whatever fields a feature
//             chooses to record about its own actions.
//
//   REDACTED  auth tokens of every kind (Supabase anon and service-role keys,
//             access and refresh tokens, JWTs), Authorization headers, session
//             cookies, API keys (Gemini, STT providers, the sk-/pk- family),
//             passwords, and any query parameter VALUE or URL fragment
//             whatsoever.
//
// The redaction floor is enforced twice, independently, because either defense
// alone has a known hole:
//
//   1. BY KEY NAME (redactSecretsDeep). Catches a credential sitting under the
//      name it deserves -- `authorization`, `apiKey`, `refresh_token`. Blind to
//      a secret inside an ordinary field: a provider error string, a stack
//      trace, a URL. lib/copilot/sessionLog.js implements only this half.
//
//   2. BY VALUE SHAPE (redactSecretText). Catches the credential wherever it
//      is, under any key, in any prose. This is the half that matters for a
//      log whose whole point is capturing errors nobody wrote by hand.
//
// A URL gets a third treatment (redactUrlForLog): every query VALUE and the
// entire fragment are dropped unconditionally rather than pattern-matched.
// Supabase's implicit auth flow returns a live access token in the URL HASH,
// which never reaches a server and is the single most likely place for a real
// credential to be sitting in `location.href`; pattern-matching a fragment is a
// bet, dropping it is not.
//
// Pure and synchronous: no Date.now(), no DOM, no network. Never throws --
// every caller is on a path (a fetch wrapper, an error handler) where throwing
// would break the thing being logged.

export const REDACTED = "[redacted]";

// A single oversized string field -- a pasted job description, a raw provider
// error blob -- must not blow up the log or the eventual download. Same number
// and same reasoning as lib/copilot/sessionLog.js's MAX_LOG_FIELD_CHARS.
// Not exported: lib/sourceScan/exportReachability.sweep.test.js counts an
// export nothing else imports as a finding, and this one is applied twice in
// this file and read nowhere outside it.
const MAX_ACTIVITY_FIELD_CHARS = 4000;

// ---------------------------------------------------------------------------
// DEFENSE 1: key names.
//
// Matched on the KEY after normalizing away case and separators, so "apiKey",
// "api_key", "api-key" and "API_KEY" all collapse to one check. The fragments
// are deliberately SPECIFIC rather than the obvious short words: a bare "key"
// redacts `keywords` and `monkey`, a bare "session" redacts `sessionStartedAt`,
// and a log that has scrubbed away its own diagnostics has failed in the other
// direction. Defense 2 is what covers the resulting gap.
// ---------------------------------------------------------------------------
const CREDENTIAL_KEY_FRAGMENTS = [
  "token",
  "apikey",
  "authorization",
  "secret",
  "password",
  "passwd",
  "credential",
  "cookie",
  "bearer",
  "privatekey",
  "publickey",
  "servicerole",
  "anonkey",
  "accesskey",
  "signingkey",
];

function isCredentialKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return CREDENTIAL_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

// ---------------------------------------------------------------------------
// DEFENSE 2: value shapes.
//
// The named patterns first (they are unambiguous and their boundaries are
// known), then one generic rule for everything else.
// ---------------------------------------------------------------------------
const NAMED_SECRET_PATTERNS = [
  // `Authorization: Bearer …`, and the same string inside any prose.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // A JSON Web Token: Supabase's anon key, its access_token, and any id_token.
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g,
  // Google / Gemini API keys.
  /\bAIza[0-9A-Za-z_-]{16,}\b/g,
  // The sk-/pk-/rk- provider-key family.
  /\b[sprk]k[-_][A-Za-z0-9_-]{12,}/g,
  // Supabase personal / service tokens.
  /\bsb[a-z]?[-_][A-Za-z0-9_-]{16,}/g,
];

// THE GENERIC RULE, and the two conditions on it are the whole design.
//
// An opaque run of at least 28 characters drawn from a credential alphabet,
// containing BOTH a letter and a digit, is a secret. `/` is excluded from the
// alphabet on purpose so a long URL path is never one run, and the digit
// requirement is what keeps ordinary long identifiers -- a module name like
// `duplicateApplyLogDocument.js`, a channel id, a 50 000-character pasted job
// description -- out of the net. The cost of both concessions is stated rather
// than hidden: a purely alphabetic secret with no digit escapes THIS rule and
// is caught only by defense 1 or a named pattern above.
const OPAQUE_RUN_RE = /[A-Za-z0-9._~+=-]{28,}/g;
const HAS_LETTER_RE = /[A-Za-z]/;
const HAS_DIGIT_RE = /[0-9]/;

/**
 * redactSecretText(value) -> string with every credential-shaped run replaced
 * by "[redacted]", and every other character untouched.
 *
 * Returns "" for a non-string rather than throwing: callers are error handlers.
 */
export function redactSecretText(value) {
  if (typeof value !== "string" || value.length === 0) return typeof value === "string" ? value : "";
  try {
    let out = value;
    for (const pattern of NAMED_SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, REDACTED);
    }
    OPAQUE_RUN_RE.lastIndex = 0;
    out = out.replace(OPAQUE_RUN_RE, (run) =>
      HAS_LETTER_RE.test(run) && HAS_DIGIT_RE.test(run) ? REDACTED : run,
    );
    return out;
  } catch {
    // A pathological input that defeats the regex engine costs its own field,
    // never the log.
    return REDACTED;
  }
}

/** Truncate rather than drop: the surrounding fields are usually the useful ones. */
function truncateField(str) {
  if (typeof str !== "string" || str.length <= MAX_ACTIVITY_FIELD_CHARS) return str;
  const droppedChars = str.length - MAX_ACTIVITY_FIELD_CHARS;
  return `${str.slice(0, MAX_ACTIVITY_FIELD_CHARS)} …[truncated ${droppedChars} chars]`;
}

const MAX_DEPTH = 12;

function redactDeep(value, seen, depth) {
  if (depth > MAX_DEPTH) return "[max depth]";
  if (value === null || value === undefined) return value;

  const kind = typeof value;
  if (kind === "string") return truncateField(redactSecretText(value));
  if (kind === "number" || kind === "boolean") return value;
  if (kind === "function") return "[function]";
  if (kind !== "object") return truncateField(redactSecretText(String(value)));

  // `seen` is entered and exited around each object so a DIAMOND reference is
  // still fully rendered; only an actual ancestor-of-itself is "[circular]".
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => {
      try {
        return redactDeep(item, seen, depth + 1);
      } catch {
        return "[unserializable]";
      }
    });
  } else {
    result = {};
    for (const key of Object.keys(value)) {
      if (isCredentialKey(key)) {
        result[key] = REDACTED;
        continue;
      }
      try {
        result[key] = redactDeep(value[key], seen, depth + 1);
      } catch {
        // A hostile getter throws on read. The field is lost, never the event.
        result[key] = "[unserializable]";
      }
    }
  }

  seen.delete(value);
  return result;
}

/**
 * redactSecretsDeep(value) -> the same shape, JSON-safe, with credentials gone
 * by key name AND by value shape. Never throws.
 */
export function redactSecretsDeep(value) {
  try {
    return redactDeep(value, new WeakSet(), 0);
  } catch {
    return REDACTED;
  }
}

// A query parameter name is diagnostic ("which parameters did this call send");
// a query parameter VALUE never is, at the price of admitting one live token.
// So values are dropped unconditionally rather than inspected.
function redactSearch(search) {
  if (!search || search === "?") return "";
  const names = [];
  for (const pair of search.replace(/^\?/, "").split("&")) {
    if (!pair) continue;
    const name = pair.split("=")[0];
    // The NAME is still attacker/caller-supplied text, so it goes through the
    // value scrubber too -- a "parameter name" long enough to be a token is one.
    names.push(`${redactSecretText(decodeURIComponent(name).slice(0, 64))}=${REDACTED}`);
  }
  return names.length ? `?${names.join("&")}` : "";
}

/**
 * redactUrlForLog(url) -> "origin + path + ?names=[redacted]", fragment gone.
 *
 * A relative URL stays relative (the shape every in-app fetch actually uses).
 * Anything that will not parse is scrubbed as free text rather than returned
 * raw -- an unparseable string is exactly where a smuggled credential would be.
 */
export function redactUrlForLog(url) {
  const raw = typeof url === "string" ? url : String(url ?? "");
  try {
    // A base is required for a relative specifier; the sentinel origin is
    // stripped again below, so it never reaches the output.
    const SENTINEL = "http://activity-log.invalid";
    const parsed = new URL(raw, SENTINEL);
    const path = redactSecretText(parsed.pathname);
    const search = redactSearch(parsed.search);
    // parsed.hash is deliberately never read.
    if (parsed.origin === SENTINEL && raw.startsWith("/")) return `${path}${search}`;
    return `${redactSecretText(parsed.origin)}${path}${search}`;
  } catch {
    return redactSecretText(raw.slice(0, 300));
  }
}
