/**
 * The ONE function in this app that decides whether a string may become an
 * href. Every `href=` in app/ whose value is not a hard-coded literal goes
 * through it; app/components/hrefSafety.sweep.test.js enforces that as an
 * executable invariant rather than a convention.
 *
 * WHY IT EXISTS
 *
 * `public.positions` is a deliberately shared catalogue - it has no
 * `user_id` column, `positions_select_all` has qual `true`, and
 * `positions_update_authenticated` has qual `auth.role() = 'authenticated'`.
 * Any signed-in account can read every row (including each posting's
 * `external_id`) and UPDATE any row, and `upsertPosition` overwrites the
 * whole row on conflict. So the `url` this user's tracking table renders as
 * a clickable "Posting" button, labelled as their job posting, is a value
 * another account controls. The same holds for every model-, feed-,
 * search- and Drive-derived URL on the other render paths.
 *
 * WHY REACT IS NOT THE CONTROL
 *
 * Measured on the installed React 19.2.4 / react-dom 19.2.4 by rendering a
 * real `<a href={raw}>` and reading the attribute back: React rewrites
 * `javascript:` in 5 of 6 obfuscations (plain, mixed case, leading spaces,
 * embedded tab, embedded newline) and blocks NOTHING else. `data:`,
 * `data:;base64`, `vbscript:`, `intent:`, `blob:`, `file:`,
 * `//protocol-relative`, `https://acme.com@evil.example/x`,
 * `https://user:pw@evil.example/x` and `https://` all reach the DOM
 * untouched. (`javascript:` with an embedded NUL also passes React, though
 * the URL parser will not read it as a scheme either.)
 *
 * THE RULES, in order, and each is load-bearing:
 *
 *   1. must be a string                      - `sources` is jsonb; an object
 *                                              reaches an href as
 *                                              "[object Object]" today
 *   2. `raw === raw.trim()`, else refuse     - see below
 *   3. `new URL(raw)` must not throw         - also refuses "//evil.example/x"
 *   4. protocol is exactly http:/https:      - an ALLOW-LIST. A deny-list has
 *                                              to have thought of
 *                                              `chrome-extension:` first
 *   5. no username and no password           - `https://acme.com@evil.example/x`
 *                                              renders as acme.com and
 *                                              navigates to evil.example
 *   6. non-empty hostname                    - defence in depth: the WHATWG
 *                                              parser already rejects
 *                                              "https://", but not every
 *                                              scheme's parser demands a host
 *   7. return `raw` VERBATIM                 - never a normalised copy
 *
 * Rule 2 is the non-obvious one. Validating "  https://acme.com/x  " by
 * trimming and then rendering the raw string yields
 * `href="  https://acme.com/x  "` - a DIFFERENT string from the one that was
 * checked. Refusing rather than normalising keeps exactly one string in play,
 * so what was validated is what is rendered. (`raw.trim().startsWith(...)`
 * is the mutant this rule kills; safeExternalHref.test.js proves it dies.)
 *
 * A REFUSED URL MUST RENDER NO ANCHOR AT ALL. Not `href=""` (which resolves
 * to the current page), not `href="#"` (a dead control a keyboard user still
 * tabs to), not an href-less `<a>` stub. Callers degrade to plain text or
 * omit the control.
 *
 * NAMING - and the relationship to the planned `citationHref`.
 *
 * scratchpad/3-plan-footnotes.md wave W1 specifies
 * `lib/tracking/citationHref.js` exporting a `citationHref` with these exact
 * seven rules, plus two citation-specific helpers (`citationHost`,
 * `nonPublisherHosts`). That plan's own P-5 row says promoting the control
 * out of `lib/tracking/` is "a move when there is a second caller, not
 * before". There are now fourteen. So the general control lives here, under
 * a name that describes what it does rather than the one feature that first
 * needed it, and W1 keeps its published surface with a one-line re-export:
 *
 *     export { safeExternalHref as citationHref } from "../url/safeExternalHref";
 *
 * alongside its own citation-specific `citationHost` / `nonPublisherHosts`.
 * There is one copy of the logic and one place to audit.
 *
 * @param {unknown} raw
 * @returns {string|null} `raw` unchanged if it may be an href, else null.
 */
export function safeExternalHref(raw) {
  // 1.
  if (typeof raw !== "string") return null;
  // 2. Validate the EXACT string that will be rendered.
  if (raw !== raw.trim()) return null;

  // 3.
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // 4. Allow-list, never a deny-list.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // 5. The label/target attack.
  if (url.username !== "" || url.password !== "") return null;
  // 6.
  if (url.hostname === "") return null;

  // 7. Verbatim. Never url.href - that is a normalised, different string.
  return raw;
}

export default safeExternalHref;
