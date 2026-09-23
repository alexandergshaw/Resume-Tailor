// N49: the panel's own read of a stage's research snapshot. Client-safe --
// this module imports no lexicon and no server module -- and every export is
// pure, total and never throws. `packStagesSnapshot` is the ONE discriminator
// the whole chunk keys on: null for a pack with no research snapshot, which
// is what makes the panel fall back to its pre-N49 behaviour in full on that
// pack (the owner's scope ruling: a pack generated before this ships keeps
// today's behaviour exactly). Fail toward legacy, never toward labelled.
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { citationHost, servesGroundingRedirect } from "@/lib/tracking/citationHref";

/** The publisher count at which a label reads "reported" rather than
 *  "possible" -- a single literal so the boundary is a one-token change.
 *  Not exported: nothing outside this module reads it yet (the sibling
 *  modules design.r3.md section 11.4/11.5 would have import it --
 *  publisherKey.js, stageProvenance.js -- are a later step of this chunk).
 *  Add `export` back the day a real importer needs it. */
const VERIFIED_MIN_PUBLISHERS = 2;

const ORIGINS = new Set(["research", "absent", "embedded"]);
const FORMATS = new Set(["structured", "none-reported", "unstructured", "unverifiable", "multi-block"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Structural, all-or-nothing read of a stored `research` snapshot. Any
 *  failure returns null -- which is exactly what makes a pack fall back to
 *  legacy behaviour, never a half-trusted labelled one. Not exported: only
 *  `packStagesSnapshot` below calls it today; `prepParse.js`/
 *  `stageProvenance.js` gaining their own call is a later step of this
 *  chunk (design.r3.md section 11.5). Add `export` back then. */
function readResearchSnapshot(value) {
  if (!isPlainObject(value)) return null;
  if (value.v !== 1) return null;
  if (!ORIGINS.has(value.origin)) return null;
  if (!(value.researchedAt === undefined || value.researchedAt === null || typeof value.researchedAt === "string")) {
    return null;
  }
  const out = {
    v: 1,
    origin: value.origin,
    researchedAt: typeof value.researchedAt === "string" ? value.researchedAt : null,
  };
  if (value.origin !== "embedded") {
    if (!(value.employer === undefined || value.employer === null || typeof value.employer === "string")) return null;
    out.employer = typeof value.employer === "string" ? value.employer.normalize("NFC").replace(/\s+/g, " ").trim() : null;
    if (out.employer === "") out.employer = null;
  }
  if (value.origin !== "research") return out;
  if (!FORMATS.has(value.format)) return null;
  if (!(typeof value.searched === "boolean" || value.searched === null)) return null;
  if (!(Number.isInteger(value.textBlocks) || value.textBlocks === null)) return null;
  if (!Array.isArray(value.sources) || value.sources.length > 32) return null;
  if (!value.sources.every((s) => isPlainObject(s) && typeof s.url === "string")) return null;
  if (!Array.isArray(value.lines) || value.lines.length > 64) return null;
  out.format = value.format;
  out.searched = value.searched;
  out.textBlocks = value.textBlocks;
  out.sources = value.sources.map((s) => ({ url: s.url, title: typeof s.title === "string" ? s.title : undefined }));
  out.lines = value.lines;
  if (isPlainObject(value.counts)) out.counts = value.counts;
  return out;
}

/** The one discriminator the whole chunk keys on: null for a snapshot-less
 *  pack, so no N49 label, token or state line renders anywhere on it. */
export function packStagesSnapshot(pack) {
  if (!isPlainObject(pack)) return null;
  const sections = pack.sections;
  if (!isPlainObject(sections)) return null;
  const stages = sections.stages;
  if (!isPlainObject(stages)) return null;
  return readResearchSnapshot(stages.research);
}

function stageArray(pack) {
  const list = pack?.sections?.stages?.stages;
  return Array.isArray(list) ? list : [];
}

function liveVerified(stage) {
  const all = [
    stage?.provenance,
    ...(Array.isArray(stage?.questionProvenance) ? stage.questionProvenance : []),
    ...(Array.isArray(stage?.roleProvenance) ? stage.roleProvenance : []),
  ];
  return all.filter((p) => isPlainObject(p) && Number.isInteger(p.publishers) && p.publishers >= VERIFIED_MIN_PUBLISHERS)
    .length;
}

/** The research-state line's state and text, or null for a snapshot-less
 *  pack (D-P5 withdrawn: this is what keeps a legacy pack silent). Every
 *  text states only what the app searched and found, never "there are no
 *  reports" or "the company does not publish" -- an absence of coverage is
 *  not evidence the interview loop does not exist. */
export function researchStateOf(pack) {
  const snapshot = packStagesSnapshot(pack);
  if (!snapshot) return null;
  const researchedAt = snapshot.researchedAt || null;
  const when = researchedAt ? new Date(researchedAt) : null;
  const on =
    when && !Number.isNaN(when.getTime())
      ? ` on ${when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`
      : "";
  if (snapshot.origin === "embedded") {
    return { state: "embedded", researchedAt, text: "This pack was built without a web search, so nothing here is sourced." };
  }
  if (snapshot.origin === "absent") {
    return { state: "absent", researchedAt, text: `No usable company research was on file${on}, so nothing here is sourced.` };
  }
  if (snapshot.format === "unverifiable" || snapshot.format === "unstructured") {
    return {
      state: "needs-refresh",
      researchedAt,
      text: `We searched${on}, but the research could not be read back, so nothing here is sourced.`,
    };
  }
  if (snapshot.searched === false) {
    return { state: "not-searched", researchedAt, text: "No web search has run for this company yet." };
  }
  if (snapshot.lines.length === 0) {
    return { state: "none-found", researchedAt, text: `We searched${on} and found no published reports of this interview process.` };
  }
  const counts = isPlainObject(snapshot.counts) ? snapshot.counts : {};
  if (counts.inSection === 0 || snapshot.format === "multi-block") {
    return { state: "unplaced", researchedAt, text: `We searched${on}, but no report could be tied to a line, so nothing here is sourced.` };
  }
  const live = stageArray(pack).reduce((n, stage) => n + liveVerified(stage), 0);
  if (live === 0) {
    return { state: "uncorroborated", researchedAt, text: `We searched${on}. No item below was reported by two or more sources.` };
  }
  return {
    state: "corroborated",
    researchedAt,
    text: `We searched for published reports of this interview process${on}. Each item below says how many sources reported it.`,
  };
}

/** The only source of a visible confidence label. A missing, invalid or
 *  zero-publisher provenance can never read as anything but "unsourced" --
 *  never blank, never verified.
 *
 *  AC-N49.6: a stored "reported" claim is never trusted verbatim -- a
 *  `publishers` count of 2 or more is re-derived from the SNAPSHOT's own
 *  `src` rows (distinct, reachable, non-redirect publishers; AC-N49.5.3,
 *  AC-N49.7) before it is allowed to print, and the printed number is
 *  whichever of the two is SMALLER, so a stale or forged count can only ever
 *  undersell, never oversell. A stored count below the reported threshold
 *  (0 or 1) is left exactly as it was: that boundary is not where the
 *  chunk's own forged-provenance findings sit, and re-deriving it here would
 *  cost the census in test/helpers/prepResearchFixture.js a property it does
 *  not otherwise need to give up. `snapshot` is optional -- omitting it
 *  degrades to the stored-count reading for a "reported" claim, never to a
 *  throw, so an existing caller that has not been updated keeps working. */
export function stageItemLabel(provenance, snapshot) {
  const stored = isPlainObject(provenance) && Number.isInteger(provenance.publishers) ? provenance.publishers : 0;
  let n = stored;
  if (stored >= VERIFIED_MIN_PUBLISHERS && snapshot) {
    n = Math.min(stored, verifiedPublisherCount(provenance, snapshot));
  }
  if (n >= VERIFIED_MIN_PUBLISHERS) return { kind: "reported", text: `Reported by ${n} sources` };
  if (n === 1) return { kind: "single", text: "Possible - 1 source" };
  return { kind: "unsourced", text: "Possible - not sourced" };
}

// Country/regional TLD suffixes AC-N49.7's own table folds into the SAME
// market as a plain ".com" -- exactly the glassdoor.com/.co.uk/.ca/.com.au
// row and nothing wider: an unlisted TLD (".org", ".net", ...) stays its own
// market, which is what keeps this repo's own example.com/.org/.net fixture
// hosts from collapsing into one publisher. The rule fails toward MERGING
// per that AC's own failure-direction clause -- an unrecognised compound
// suffix falls through to the bare last label rather than refusing.
const COMMERCIAL_TLD_MARKET = new Set(["com", "co.uk", "ca", "com.au", "co.nz", "co.in", "com.br"]);
const COMPOUND_SUFFIX_HEADS = new Set(["co", "com"]);

/** The registrable TLD of an already-lower-cased, dot-split host: the last
 *  label alone, or the last two when the second-to-last is "co"/"com" (the
 *  "co.uk"/"com.au" shape). */
function registrableTld(labels) {
  if (labels.length >= 3 && COMPOUND_SUFFIX_HEADS.has(labels[labels.length - 2])) {
    return labels.slice(-2).join(".");
  }
  return labels[labels.length - 1] || "";
}

/** SEC-F2-adjacent: the identity two sources are compared by to decide
 *  independence (AC-N49.7). Takes an already-`citationHost`-derived host
 *  (never a raw URL, so www is already stripped) and returns the label
 *  immediately before its registrable TLD, with any regional/country
 *  variant of ".com" normalised to "com" -- so `glassdoor.co.uk` and
 *  `glassdoor.com` collapse to the SAME key while `example.com` and
 *  `example.org` do not. A bare, single-label host (no dot) is its own key
 *  unchanged: there is nothing to strip. Not exported: only
 *  `stageItemSources`/`verifiedPublisherCount` below call it today (the
 *  sibling `publisherKey.js` design.r3.md section 11.4 names is a later step
 *  of this chunk). Add `export` back the day a real importer needs it.
 *
 *  @param {string} host
 *  @returns {string}
 */
function publisherKey(host) {
  const labels = host.split(".");
  if (labels.length < 2) return host;
  const tld = registrableTld(labels);
  const tldLabels = tld.split(".").length;
  const sld = labels[labels.length - tldLabels - 1] || labels[0];
  return `${sld}.${COMMERCIAL_TLD_MARKET.has(tld) ? "com" : tld}`;
}

/** One entry per publisher component in `src` order, deduped by
 *  `publisherKey` -- never by row, never by the bare `citationHost` string
 *  alone, so a regional mirror (AC-N49.7) collapses to one link the same
 *  way it collapses to one count in `stageItemLabel`. A vendor grounding
 *  redirect (`servesGroundingRedirect`) is dropped here, unconditionally --
 *  it is never a publisher, so it is never shown as one, linked or inert. A
 *  source whose href the safety gate refuses otherwise is KEPT, so the
 *  caller can still render it inert at render time. */
export function stageItemSources(provenance, snapshot) {
  if (!isPlainObject(provenance) || !Array.isArray(provenance.src) || !snapshot || !Array.isArray(snapshot.sources)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const index of provenance.src) {
    const source = Number.isInteger(index) ? snapshot.sources[index] : null;
    if (!source || typeof source.url !== "string") continue;
    const href = safeExternalHref(source.url);
    let key = `raw:${source.url}`;
    if (href !== null) {
      const host = citationHost(href);
      if (host !== null) {
        if (servesGroundingRedirect(host, href)) continue;
        key = publisherKey(host);
      }
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ index, url: source.url });
  }
  return out;
}

/** The count of DISTINCT publishers actually behind a provenance's `src`
 *  rows, counting only sources that pass `safeExternalHref` and are not a
 *  vendor grounding redirect (AC-N49.5.3, AC-N49.6, AC-N49.7). This is the
 *  ONLY count `stageItemLabel` trusts for the VERIFIED/"reported" threshold
 *  -- a stored `publishers` integer is never authoritative on its own. */
function verifiedPublisherCount(provenance, snapshot) {
  const keys = new Set();
  for (const entry of stageItemSources(provenance, snapshot)) {
    const href = safeExternalHref(entry.url);
    if (href === null) continue;
    const host = citationHost(href);
    if (host === null) continue;
    keys.add(publisherKey(host));
  }
  return keys.size;
}

/** Where a stage's N43 marker draws, arity 2 so the pack-level flag (never a
 *  per-stage guess) decides: `"name"` only when the pack carries no
 *  snapshot at all -- HEAD's own placement, unchanged; otherwise `"answer"`
 *  when the stage has a suggested answer, else `"none"` (the marker is not
 *  drawn; the caller renders the claim's text as plain text instead, so
 *  nothing is deleted).
 *
 *  KNOWN ISSUE (verify.r1.md M6), NOT changed this round: the choice between
 *  "answer" and "none" keys on `recommendedAnswer`'s own presence, a field
 *  that has nothing to do with whether the claim is sourced -- two
 *  identically-unsourced claims can be placed differently for a reason a
 *  candidate cannot see. The two obvious uniform fixes both break a landed,
 *  frozen row of PrepPackPanel.n49Frame.test.js's own F-E block: forcing
 *  every snapshot stage to "none" empties "Sources for Interview stages" of
 *  c1 and fails F-E's own positive control (`stagesList` must be truthy,
 *  `markers.length` must be > 0); forcing every one to "answer" numbers c2
 *  into that same list and fails F-E's two negative rows (c2 must never sit
 *  inside an anchor or under a heading that calls it a source). F-E's own
 *  fixture varies `recommendedAnswer` between stage 1 (c1, non-empty) and
 *  stage 2 (c2, empty) specifically to pin BOTH outcomes side by side, so
 *  this is not a gap in that test's power -- it is the same mechanism this
 *  function implements, pinned on both sides. Reported rather than forced
 *  through: see this round's report. */
export function stageSupportPlacement(stage, hasSnapshot) {
  if (!hasSnapshot) return "name";
  const answer = stage?.recommendedAnswer;
  return typeof answer === "string" && answer.trim() !== "" ? "answer" : "none";
}

/** First-appearance numbering of research sources over the rendered items,
 *  starting after the N43 entries a section already used. One number per
 *  distinct source URL, so two items citing the same publisher share it. */
export function researchSourceNumbers(stages, snapshot, offset) {
  const numbers = new Map();
  let next = offset + 1;
  const visit = (provenance) => {
    for (const entry of stageItemSources(provenance, snapshot)) {
      if (safeExternalHref(entry.url) === null) continue;
      if (!numbers.has(entry.url)) {
        numbers.set(entry.url, next);
        next += 1;
      }
    }
  };
  for (const stage of stages) {
    visit(stage?.provenance);
    const roles = Array.isArray(stage?.roleProvenance) ? stage.roleProvenance : [];
    for (const p of roles) visit(p);
    const questions = Array.isArray(stage?.questionProvenance) ? stage.questionProvenance : [];
    for (const p of questions) visit(p);
  }
  return numbers;
}
