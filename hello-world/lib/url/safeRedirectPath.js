/**
 * The ONE function that decides whether a `?redirect=`-style query value may
 * be handed to a same-origin, post-login navigation
 * (`window.location.assign`, `NextResponse.redirect`, ...). Both
 * app/login/page.js and app/auth/callback/route.js read this same query
 * parameter and must both go through here.
 *
 * WHY IT EXISTS
 *
 * `/login?redirect=<value>` lets an attacker choose where a user lands the
 * moment after they type their password and start trusting the page again --
 * classic post-auth phishing. The value must be constrained to "a path on
 * this app," nothing else.
 *
 * WHY THE OBVIOUS FIX (`requested.startsWith("/") ? requested : "/"`, the
 * check this repo already shipped in app/auth/callback/route.js) IS WRONG
 *
 * Verified by probing `new URL(candidate, "https://app.example")` in Node 22
 * before writing this file:
 *
 *   "//evil.example"    starts with "/", but a browser resolves it
 *                        protocol-relative -> origin "https://evil.example".
 *   "/\\evil.example"    starts with "/", but a backslash is a path/host
 *                        separator for a special-scheme URL exactly like a
 *                        forward slash -> origin "https://evil.example".
 *
 * So even "does it start with a single '/'" is not enough on its own -- you
 * also have to rule out a second "/" or "\" right after it. But THAT is
 * still not enough, because inspecting characters directly only sees the
 * RAW string, and the URL parser strips TAB / CR / LF from ANYWHERE in the
 * string before it looks at the rest:
 *
 *   "/\t/evil.example"  the first two characters are "/" and a tab -- no
 *                        pattern-match of a fixed number of characters sees
 *                        anything wrong. But once the tab is stripped the
 *                        string is "//evil.example", which resolves to
 *                        origin "https://evil.example".
 *
 * That last shape is why this function does not pattern-match at all beyond
 * the cheapest possible upfront filter. It RESOLVES the candidate against a
 * fixed, arbitrary origin using the same `new URL` parser a browser uses,
 * and then requires the resolved origin to still be that fixed origin. If
 * some substring's removal, some backslash normalisation, or some scheme
 * resolution changed the origin, this catches it structurally -- it does
 * not need to have been told in advance which trick did it. See
 * safeRedirectPath.test.js's header for the probe this reasoning is built
 * on, and for the mutant (a smarter-but-still-wrong two-character check)
 * that this design specifically kills.
 *
 * THE RULES, each load-bearing:
 *
 *   1. must be a non-empty string
 *   2. must begin with a single "/" (not "//") -- rules out a bare relative
 *      segment ("tracking"), an empty path, and the cheapest form of
 *      protocol-relative before any parsing is even attempted
 *   3. resolve with `new URL(raw, FIXED_ORIGIN)`; if it throws, refuse
 *   4. require `url.origin === FIXED_ORIGIN` -- the actual gate. Anything
 *      that changed the scheme, host, or port during parsing (an absolute
 *      URL, a protocol-relative host, a backslash host-swap, or a stripped
 *      control character manufacturing one of those) fails here regardless
 *      of what the raw string looked like before parsing.
 *   5. return the RESOLVED `pathname + search + hash`, never the raw input
 *      -- what was validated is what gets navigated to. (This also means
 *      the output is a normalised path, e.g. any accidental encoding is
 *      preserved as the parser encoded it -- the same posture
 *      safeExternalHref takes in the opposite direction, by returning the
 *      raw string verbatim: there the concern is rendering a DIFFERENT
 *      string than the one checked, and here the concern is different --
 *      the caller wants a normalised, definitely-relative path, not
 *      whatever bytes arrived on the wire.)
 *
 * WHERE THIS LIVES
 *
 * lib/url/safeExternalHref.js is this app's control for values that become
 * an `href` to ANOTHER origin. This is its mirror: a control for values that
 * become a same-origin redirect target. Same concern (a string of unknown
 * provenance about to drive a browser navigation), same directory.
 *
 * @param {unknown} raw
 * @param {string} [fallback="/"] returned when `raw` is not a safe path.
 * @returns {string} a same-origin `pathname + search + hash`, or `fallback`.
 */
export function safeRedirectPath(raw, fallback = "/") {
  // 1.
  if (typeof raw !== "string" || raw === "") return fallback;
  // 2. Cheap upfront filter -- not load-bearing for security (rule 4 catches
  // everything this would too) but keeps a bare relative segment like
  // "tracking" or an accidental "//..." from ever reaching the parser.
  if (raw[0] !== "/" || raw[1] === "/") return fallback;

  const FIXED_ORIGIN = "http://safe-redirect.invalid";
  let url;
  try {
    url = new URL(raw, FIXED_ORIGIN);
  } catch {
    return fallback;
  }

  // 3./4. The actual gate: whatever the raw string looked like, did it
  // resolve to a DIFFERENT origin than the fixed one we resolved it against?
  if (url.origin !== FIXED_ORIGIN) return fallback;

  // 5. The resolved value, never the raw input.
  return `${url.pathname}${url.search}${url.hash}`;
}

export default safeRedirectPath;
