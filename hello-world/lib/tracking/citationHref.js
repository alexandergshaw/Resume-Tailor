// The digest's citation URL contract: the one function that decides whether a
// citation string may become an href, the host derived from it, and the hosts
// that must not be shown because they are not the publisher's.
//
// THE LINK CONTROL IS A RE-EXPORT, DELIBERATELY.
//
// The seven URL-safety rules live in lib/url/safeExternalHref.js and are
// falsified there. This module does NOT restate them. When the plan for this
// feature was written the control did not exist yet and this file was to own
// it; the plan's own P-5 row said to promote it out of lib/tracking/ "when
// there is a second caller, not before". Fourteen appeared, so it was
// promoted early, and what is left here is the citation-specific half plus
// the name the render path imports.
//
// A second copy of a URL allow-list is precisely what that promotion exists
// to prevent - two copies drift, and the one that drifts is the one nobody
// re-reads. citationHref.test.js asserts FUNCTION IDENTITY against
// safeExternalHref for that reason: a faithful re-implementation would pass
// every behavioural assertion and fail that one.
//
// Rules, in order, each load-bearing, all owned by safeExternalHref.js:
//   1. must be a string          2. raw === raw.trim()
//   3. new URL(raw) must parse   4. protocol is exactly http:/https:
//   5. no username, no password  6. non-empty hostname
//   7. return `raw` VERBATIM, never a normalised copy
//
// A REFUSED URL RENDERS NO ANCHOR AT ALL - not href="", not "#", not an
// href-less <a> stub, and never an onClick navigation. The caller degrades to
// inert text or omits the entry, and counts it.

import { safeExternalHref } from "../url/safeExternalHref.js";

export { safeExternalHref as citationHref } from "../url/safeExternalHref.js";

/**
 * SEC-F2. The host of an href citationHref admits, lower-cased and
 * www-stripped; null for anything it refuses.
 *
 * The derivation is deliberately byte-identical to lib/llm/grounding.js's
 * groundedHostnames, so a host computed here and a host computed there are
 * the same string.
 *
 * SEC-F2 as a RULE, so it cannot be traded away later: an anchor's visible
 * text, `title` and `aria-label` may contain a host, domain or publisher name
 * only if derived from that anchor's OWN href, in the same expression that
 * produces the href. No host lookup, ever. applicationDigest.js's
 * groundedTitleForHost is the measured counter-example - swapping the
 * grounded array changes which real headline is welded to an invented path.
 *
 * The gate in front of `new URL` is load-bearing rather than decorative:
 * `new URL("data://acme.com/x").hostname` is "acme.com", so an ungated
 * derivation labels a data: URL with a real publisher's domain.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function citationHost(raw) {
  const href = safeExternalHref(raw);
  if (href === null) return null;
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    return host === "" ? null : host;
  } catch {
    // Unreachable: safeExternalHref already parsed it. Kept so a future
    // change to that function cannot turn this into a throw on a render path.
    return null;
  }
}

// Clause (a). The host every grounded URI collapses to on the
// models.generateContent surface, plus the general form, because a vendor
// that renamed this host once can rename it again.
const VENDOR_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
const VENDOR_REDIRECT_PARENT = "cloud.google.com";
const VENDOR_REDIRECT_PATH = "grounding-api-redirect";

function servesGroundingRedirect(host, href) {
  if (host === VENDOR_REDIRECT_HOST) return true;
  if (host !== VENDOR_REDIRECT_PARENT && !host.endsWith(`.${VENDOR_REDIRECT_PARENT}`)) return false;
  try {
    return new URL(href).pathname.includes(VENDOR_REDIRECT_PATH);
  } catch {
    return false;
  }
}

/**
 * 1c NP-1. The set of hosts that must NOT be displayed, because they are not
 * the publisher's. Computed once per digest over EVERY entry, so clause (b)
 * has the whole-digest context it needs.
 *
 *   (a) the vendor redirect host - `vertexaisearch.cloud.google.com`, or any
 *       `*.cloud.google.com` host whose path carries `grounding-api-redirect`;
 *   (b) a host byte-identical across EVERY entry, when there is more than one
 *       entry, AND absent from every entry's own title.
 *
 * Both clauses exist because neither is sufficient: (a) alone misses a
 * renamed redirector, and (b) alone misfires on a genuine single-publisher
 * digest. (b)'s two guards are what keep it honest - the `> 1` guard excludes
 * a single-source digest, and the title guard excludes a digest whose own
 * entries name the publisher.
 *
 * WHAT THIS RULE CHANGES AND WHAT IT DOES NOT. It changes what is SAID about
 * an entry, never where the link GOES: `href` is untouched, because AC-F9.4
 * requires the annotation's url verbatim and the redirect still reaches the
 * publisher. A caller suppresses the host and shows the title.
 *
 * ACCEPTED RESIDUAL, stated rather than hidden. The title guard is a literal
 * containment test on the host string, per the rule as written. Three
 * articles from one publisher whose titles say "Reuters" but never
 * "reuters.com" therefore still have their host suppressed. That direction is
 * chosen deliberately: firing wrongly costs a suppressed host on an entry
 * that keeps its title and its link, while NOT firing when it should costs a
 * candidate naming a Google API redirect to a recruiter as their source -
 * which is the measured harm this whole feature exists to prevent.
 *
 * @param {Array<{href: unknown, title: unknown}>} entries
 * @returns {Set<string>}
 */
export function nonPublisherHosts(entries) {
  const out = new Set();
  if (!Array.isArray(entries)) return out;

  const hosts = [];
  const titles = [];

  for (const entry of entries) {
    const href = entry && typeof entry === "object" ? entry.href : null;
    const title = entry && typeof entry === "object" && typeof entry.title === "string" ? entry.title : "";
    titles.push(title.toLowerCase());

    const host = citationHost(href);
    // An entry whose href is refused renders no anchor, so it displays no
    // host and cannot contradict "identical across every entry". Counting it
    // as a second, different host would silently disable clause (b) on any
    // digest carrying one unusable citation.
    if (host === null) continue;
    hosts.push(host);
    if (servesGroundingRedirect(host, href)) out.add(host);
  }

  if (hosts.length > 1) {
    const shared = hosts[0];
    if (hosts.every((h) => h === shared) && !titles.some((t) => t.includes(shared))) {
      out.add(shared);
    }
  }

  return out;
}
