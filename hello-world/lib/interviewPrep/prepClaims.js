// lib/interviewPrep/prepClaims.js -- INV-CLAIM-1 as an executable invariant
// (N45/N46 plan §S2, §6.1). Pure, no I/O.
//
// Deliberately imports NEITHER ./prepParse.js NOR ./prepPack.js: this module
// carries no given-name lexicon, and does not extend the N33 file-level
// bundle rule (design-reconciled.r2.md §4.2/§5.1) to a new file. The only
// shared vocabulary it needs -- the four section names -- comes from
// ./prepContract.js, itself a pure, lexicon-free module.
//
// WHY THIS INVARIANT EXISTS AT ALL. One flat `pack.claims` array serves all
// four sections, and `isCitedClaim` (prepParse.js) resolves a `support` by
// id against that array. Regenerating ONE section means rewriting that array
// in place: keep the three untouched sections' claims, drop the replaced
// section's own, add the new ones. Every way of getting that wrong is
// SILENT -- a dangling id makes `normalizeDroppingList` null the support,
// and a citation disappears from the candidate's screen with no error
// anywhere. Encoding ownership IN the id (`c/<section>/<hex>`) is what makes
// "which claims belong to the section I am replacing" answerable without
// guessing at read time.
//
// THE GENERIC WALK, BINDING ON BOTH `mintSectionClaims` AND
// `claimOwnershipViolations` (plan §7.5, N49 non-foreclosure, risk R7): the
// reference walk visits every plain object at ANY depth inside a section's
// own content and rewrites/inspects any `{kind: "claim", claimId}` it finds.
// It never enumerates the four currently-known support positions
// (AnswerLine.support, Question.support, Stage.support). N49 splits a
// Stage's single `support` into per-question provenance; a hard-coded walk
// would leave those unminted -- a dangling id, a citation that silently
// vanishes -- and would force N49 to re-mint every stored revision.

import { PREP_SECTION_NAMES } from "./prepContract.js";

const CLAIM_ID_RE = new RegExp(`^c/(${PREP_SECTION_NAMES.join("|")})/([0-9a-f]{16})$`);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `normalizeClaims` (prepParse.js:392)'s own conversion, reimplemented here
 *  rather than imported -- this module's own header states why it never
 *  imports prepParse.js. An already-array input is returned as-is; a plain
 *  object map is converted entry by entry, carrying the map's own key
 *  forward as `id`; anything else is `[]`. */
function asClaimsList(rawClaims) {
  if (Array.isArray(rawClaims)) return rawClaims;
  if (!isPlainObject(rawClaims)) return [];
  return Object.entries(rawClaims)
    .filter(([, value]) => isPlainObject(value))
    .map(([id, value]) => ({ ...value, id }));
}

/** Random 16-lowercase-hex-character string. `crypto.getRandomValues`, with
 *  the same Math.random fallback shape prepStore.js's genLeaseToken ships
 *  for the identical both-runtimes concern. */
function randomHex16() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hex = "";
  for (let i = 0; i < 16; i += 1) hex += Math.floor(Math.random() * 16).toString(16);
  return hex;
}

/**
 * `c/<section>/<16 lowercase hex>`. An unrecognized section THROWS -- a
 * programming error, never a value to normalise (triggerClassOf's V-8
 * ruling, applied here identically).
 *
 * @param {"aboutYou"|"whyRole"|"askThem"|"stages"} section
 * @returns {string}
 */
export function mintClaimId(section) {
  if (!PREP_SECTION_NAMES.includes(section)) {
    throw new Error(`Unrecognized prep section for a minted claim id: ${JSON.stringify(section)}`);
  }
  return `c/${section}/${randomHex16()}`;
}

/** Like `mintClaimId`, but retries on a collision against `usedIds` -- the
 *  mint-time uniqueness check plan §6.1 calls for, scoped to the ids being
 *  minted within one `mintSectionClaims` call. A 64-bit keyspace makes a
 *  collision astronomically unlikely; checking costs nothing. */
function mintUniqueClaimId(section, usedIds) {
  let id = mintClaimId(section);
  while (usedIds.has(id)) id = mintClaimId(section);
  usedIds.add(id);
  return id;
}

/**
 * The owning section encoded in a claim id, or `null` for a legacy /
 * foreign-shaped id. Pure, total, never throws.
 *
 * @param {unknown} id
 * @returns {"aboutYou"|"whyRole"|"askThem"|"stages"|null}
 */
export function claimOwner(id) {
  if (typeof id !== "string") return null;
  const match = CLAIM_ID_RE.exec(id);
  return match ? match[1] : null;
}

/** Visits every `{kind: "claim", claimId}` node reachable inside `node`, at
 *  any depth, in ANY plain object or array -- the generic walk this file's
 *  header requires. `onRef` is called with the claimId value found. */
function collectClaimRefs(node, onRef) {
  if (Array.isArray(node)) {
    for (const item of node) collectClaimRefs(item, onRef);
    return;
  }
  if (!isPlainObject(node)) return;
  if (node.kind === "claim" && Object.hasOwn(node, "claimId")) {
    onRef(node.claimId);
    return;
  }
  for (const key of Object.keys(node)) collectClaimRefs(node[key], onRef);
}

/** Rebuilds `node` with every `{kind: "claim", claimId}` node rewritten
 *  through `idMap`. An unmatched ref becomes `null` by default (the same
 *  "dangling support is nulled" discipline `normalizeDroppingList`/
 *  `normalizeStage` already apply in prepParse.js) -- unless
 *  `keepUnmatched` is set, in which case an unmatched ref is returned
 *  UNCHANGED rather than nulled (`mintUnownedReferencedClaims` below is the
 *  one caller that needs this: it re-mints only the LEGACY refs a caller
 *  hands it, and must not null a ref it was never asked to touch). Never
 *  mutates `node`. */
function rewriteClaimRefs(node, idMap, { keepUnmatched = false } = {}) {
  if (Array.isArray(node)) return node.map((item) => rewriteClaimRefs(item, idMap, { keepUnmatched }));
  if (!isPlainObject(node)) return node;
  if (node.kind === "claim" && Object.hasOwn(node, "claimId")) {
    const newId = idMap.get(node.claimId);
    if (newId) return { ...node, claimId: newId };
    return keepUnmatched ? node : null;
  }
  const next = {};
  for (const key of Object.keys(node)) next[key] = rewriteClaimRefs(node[key], idMap, { keepUnmatched });
  return next;
}

/**
 * Mints section-owned ids for ONE section's model-supplied claims, rewrites
 * that section's own `support.claimId` references onto the new ids, and
 * DROPS every supplied claim no surviving reference names.
 *
 * Pure and total: never throws, never mutates its arguments. A `rawClaims`
 * that is an object map is converted the way `normalizeClaims`
 * (prepParse.js:392) converts one. A claim entry that is not a plain object
 * is skipped. Cross-section duplication falls out of calling this once per
 * section.
 *
 * @param {"aboutYou"|"whyRole"|"askThem"|"stages"} section
 * @param {*} content   the section's own body, model-supplied, un-normalized
 * @param {*} rawClaims the model's claims (array, object map, or junk)
 * @returns {{content: *, claims: Array<{id: string, text: string, sourceUrl: string}>}}
 */
export function mintSectionClaims(section, content, rawClaims) {
  const claimsList = asClaimsList(rawClaims);

  const referenced = new Set();
  collectClaimRefs(content, (id) => referenced.add(id));

  const usedIds = new Set();
  const idMap = new Map();
  const claims = [];
  for (const entry of claimsList) {
    if (!isPlainObject(entry)) continue;
    const rawId = entry.id;
    if (typeof rawId !== "string" || !referenced.has(rawId) || idMap.has(rawId)) continue;
    const newId = mintUniqueClaimId(section, usedIds);
    idMap.set(rawId, newId);
    claims.push({ ...entry, id: newId });
  }

  return { content: rewriteClaimRefs(content, idMap), claims };
}

/**
 * F-B1 residual (fix round, verify.r3.md BLOCKER): mints section-owned ids
 * for the UNOWNED (legacy, pre-N45 free-form) claims `content` references,
 * exactly like `mintSectionClaims`, but LEAVES every other claim reference
 * untouched -- never nulled -- instead of dropping it. For `mintSectionClaims`
 * the caller supplies content the section itself just produced, so an
 * unmatched ref really is dangling and nulling it is correct. This function's
 * one caller (`buildRevisionSections`, prepGenerationMerge.js) calls it for a
 * section that was NOT just regenerated -- a seeded revision row carrying a
 * section's PRIOR content verbatim -- where an unmatched ref is either
 * already correctly owned by this same section (nothing to do) or a shape
 * only `normalizePack`'s own K1-SHAPE pass gets to null, at read time, from
 * real data, never this pure write-time minting step guessing at it.
 *
 * `rawClaims` may be the FULL claims pool; only entries whose OWN id is
 * unowned (`claimOwner(id) === null`) are ever eligible, so a claim already
 * minted for another section can never be re-owned here. Calling this once
 * per section, as `buildRevisionSections` does, is what makes a legacy claim
 * referenced by TWO sections mint into two distinct, independently-owned
 * ids -- the same duplication `mintSectionClaims` already produces across
 * sections.
 *
 * Pure and total: never throws, never mutates its arguments.
 *
 * @param {"aboutYou"|"whyRole"|"askThem"|"stages"} section
 * @param {*} content
 * @param {*} rawClaims
 * @returns {{content: *, claims: Array<{id: string, text: string, sourceUrl: string}>}}
 */
export function mintUnownedReferencedClaims(section, content, rawClaims) {
  const claimsList = asClaimsList(rawClaims).filter((entry) => isPlainObject(entry) && claimOwner(entry.id) === null);

  const referenced = new Set();
  collectClaimRefs(content, (id) => referenced.add(id));

  const usedIds = new Set();
  const idMap = new Map();
  const claims = [];
  for (const entry of claimsList) {
    const rawId = entry.id;
    if (typeof rawId !== "string" || !referenced.has(rawId) || idMap.has(rawId)) continue;
    const newId = mintUniqueClaimId(section, usedIds);
    idMap.set(rawId, newId);
    claims.push({ ...entry, id: newId });
  }

  return { content: rewriteClaimRefs(content, idMap, { keepUnmatched: true }), claims };
}

/**
 * THE INV-CLAIM-1 GATE. Returns every violation found in `pack`; `[]` means
 * well-owned. Pure, total, never throws. Same GENERIC walk rule as
 * `mintSectionClaims`.
 *
 *   {kind: "duplicate-id", id}          two claims entries share an id
 *   {kind: "dangling", section, id}     a support.claimId resolves to nothing
 *   {kind: "cross-owner", section, id}  section S references a claim owned by T
 *   {kind: "malformed"}                 `pack` (or its `sections`/`claims`)
 *     is not a shape this gate can reason about at all -- returning `[]`
 *     here would be VACUOUS (plan risk R8: a gate that returns [] on
 *     anything it cannot parse looks like it is working while refusing
 *     nothing).
 *
 * An UNOWNED id (`claimOwner(id) === null`) referenced by any section is NOT
 * a violation -- clause (c)'s legacy escape hatch. Removing it makes every
 * pre-N45 pack permanently un-regenerable.
 *
 * @param {*} pack
 * @returns {Array<{kind: string, section?: string, id?: string}>}
 */
export function claimOwnershipViolations(pack) {
  if (!isPlainObject(pack)) return [{ kind: "malformed" }];

  const claimsRaw = pack.claims;
  const claimsShapeOk = claimsRaw === undefined || claimsRaw === null || Array.isArray(claimsRaw) || isPlainObject(claimsRaw);
  const sectionsRaw = pack.sections;
  const sectionsShapeOk = sectionsRaw === undefined || sectionsRaw === null || isPlainObject(sectionsRaw);
  if (!claimsShapeOk || !sectionsShapeOk) return [{ kind: "malformed" }];

  const claimsList = asClaimsList(claimsRaw);
  const violations = [];

  const knownIds = new Set();
  const seenIds = new Set();
  for (const entry of claimsList) {
    if (!isPlainObject(entry) || typeof entry.id !== "string") continue;
    if (seenIds.has(entry.id)) violations.push({ kind: "duplicate-id", id: entry.id });
    seenIds.add(entry.id);
    knownIds.add(entry.id);
  }

  const sections = isPlainObject(sectionsRaw) ? sectionsRaw : {};
  for (const section of PREP_SECTION_NAMES) {
    const refs = [];
    collectClaimRefs(sections[section], (id) => refs.push(id));
    for (const id of refs) {
      if (typeof id !== "string" || !id) continue;
      if (!knownIds.has(id)) {
        violations.push({ kind: "dangling", section, id });
        continue;
      }
      const owner = claimOwner(id);
      if (owner !== null && owner !== section) violations.push({ kind: "cross-owner", section, id });
    }
  }

  return violations;
}
