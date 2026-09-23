// lib/interviewPrep/prepGenerationMerge.js -- the pure merge/minting glue N45
// step S7c and S8 both need on top of prepClaims.js/prepMerge.js. Lives in
// its OWN module, not app/api/interview-prep/route.js, for the standing
// 1000-line ceiling (plan §3.6): route.js's own source-text sweeps
// (route.test.js, route.restore.sweep.test.js) pin `parsePrepResponse` and
// every `finishAttempt(`/`writeFailureResponse(` call as LITERAL text inside
// route.js itself, so none of that orchestration can move out -- but the
// pure pack-construction it calls can, and moving it is what keeps route.js
// under the cap without touching any of those pinned literals.
//
// Pure, no I/O: every export here takes plain objects and returns plain
// objects, never touches `supabase` or `Response`.

import { mintSectionClaims, claimOwner, mintUnownedReferencedClaims } from "./prepClaims.js";
import { buildPackDocument, baseProvenanceFromPack } from "./prepMerge.js";
import { PREP_SECTION_NAMES } from "./prepContract.js";
import { PREP_SECTION_REVISION_MAX_BYTES } from "./prepConstants.js";
import { sectionRevisionBytes } from "./prepRevisionStore.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Mints section-owned claim ids for EVERY section present in a
 * freshly-produced WHOLE pack -- the model's own reply or
 * `buildEmbeddedPack`'s deterministic document -- so both writers of a whole
 * pack share exactly one minting implementation, the same one a
 * section-scoped caller reaches directly via `mintSectionClaims`. Skips a
 * section absent from `pack.sections` entirely, matching
 * `buildPackDocument`'s own `wholePack:true` contract (a section not in
 * `replace` is dropped, not invented). Module-private -- `buildWholeCandidate`
 * below is the one shipping consumer, so this has no reason to be its own
 * export (lib/sourceScan/exportReachability.sweep.test.js's own ORPHAN_EXPORTS
 * bucket is exactly the trap an export with no real importer falls into).
 *
 * @param {*} pack
 * @param {"gemini"|"embedded"} engine
 * @returns {Record<string, {content: *, claims: Array<object>, engine: string}>}
 */
function mintWholeReplace(pack, engine) {
  const sections = pack && typeof pack === "object" && pack.sections && typeof pack.sections === "object" ? pack.sections : {};
  const rawClaims = pack && typeof pack === "object" ? pack.claims : [];
  const replace = {};
  for (const name of PREP_SECTION_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(sections, name)) continue;
    const minted = mintSectionClaims(name, sections[name], rawClaims);
    replace[name] = { content: minted.content, claims: minted.claims, engine };
  }
  return replace;
}

/**
 * The whole-pack candidate: mints every section present in `pack`, then
 * folds the result with `wholePack:true` (destructive -- a section the
 * source did not carry is dropped, never invented).
 *
 * @param {*} pack the model's own reply, or buildEmbeddedPack's document
 * @param {"gemini"|"embedded"} engine
 */
export function buildWholeCandidate(pack, engine) {
  return buildPackDocument({ base: {}, baseProvenance: {}, replace: mintWholeReplace(pack, engine), wholePack: true });
}

/**
 * The section-scoped candidate: merges ONE already-minted section's content
 * into `currentPack`, carrying the other three sections (and their own
 * claims) over verbatim. Provenance is derived from `currentPack` itself
 * (`baseProvenanceFromPack`) so a base carrying its OWN `templateOrigin`
 * still loses it the moment a non-embedded section is merged in (H1).
 *
 * @param {{currentPack: *, section: string, content: *, claims: Array<object>, engine: string}} args
 */
export function buildSectionCandidate({ currentPack, section, content, claims, engine }) {
  return buildPackDocument({
    base: currentPack,
    baseProvenance: baseProvenanceFromPack(currentPack),
    replace: { [section]: { content, claims, engine } },
    wholePack: false,
  });
}

/**
 * The per-section revision-row shape S7c/S8 both append after a successful
 * merge. `content`/`claims` read straight off the ALREADY-normalized
 * candidate (never the pre-normalization reply), so a later restore reads
 * back exactly what the live pack showed. `claims` starts from a partition
 * by OWNERSHIP (`claimOwner`), never by which section the model happened to
 * answer for, so a revision row never carries another section's claims --
 * PLUS, for every name, `mintUnownedReferencedClaims` (prepClaims.js): a
 * name being SEEDED (F-B1, fix round, verify.r3.md BLOCKER) carries a
 * section's PRIOR content verbatim, which for any pre-N45 row still cites
 * legacy free-form claim ids that own-partitioning alone can never match
 * (their owner is `null`). Re-minting those into `c/<name>/<hex>` here, at
 * the SAME write that first seeds the row, is what keeps a seeded row's
 * claims in step with what its own content cites -- left undone, the next
 * restore built from that row alone deletes every cited line naming a
 * person (K1-SHAPE) and drops every other line's citation. For a name that
 * was NOT seeded -- the section this attempt actually regenerated, or any
 * whole-pack write -- its content already cites only ids this call's own
 * ownership filter already resolves, so `mintUnownedReferencedClaims` finds
 * nothing to re-mint and is a no-op; that is what makes it safe to call
 * unconditionally for every name rather than needing to know which ones
 * were seeded.
 *
 * `engine` is either ONE value applied to every name (every existing caller)
 * or a `(name) => engine` resolver -- fix round F-B1's seeding call site
 * needs a DIFFERENT engine per name (the section this attempt actually
 * produced vs. a section seeded from the base document, whose own
 * provenance is not this attempt's).
 *
 * @param {*} normalizedPack
 * @param {"gemini"|"embedded"|((name: string) => "gemini"|"embedded")} engine
 * @param {string[]} names the sections this attempt actually produced
 * @param {Record<string, number>} newestBySection
 */
export function buildRevisionSections(normalizedPack, engine, names, newestBySection) {
  const sections = normalizedPack.sections || {};
  const claims = Array.isArray(normalizedPack.claims) ? normalizedPack.claims : [];
  const engineFor = typeof engine === "function" ? engine : () => engine;
  const out = {};
  for (const name of names) {
    const minted = mintUnownedReferencedClaims(name, sections[name], claims);
    out[name] = {
      content: minted.content,
      claims: claims.filter((c) => claimOwner(c?.id) === name).concat(minted.claims),
      engine: engineFor(name),
      revision: (newestBySection[name] || 0) + 1,
    };
  }
  return out;
}

/**
 * F-B1 (fix round, verify.r2.md BLOCKER 1): the names to append revision
 * rows for on a SECTION-SCOPED write -- the regenerated section itself, plus
 * any OTHER section already present in the merged document that
 * `live_revisions` does not yet name. Seeding those here, at the SAME write
 * that first touches a legacy row's pointer, is what keeps the pointer's own
 * coverage in step with the document it points at. Left partial (the
 * pre-fix behaviour), the very next failed attempt's `restorePayload`
 * (prepMerge.js) rebuilds ONLY the sections the pointer names and silently
 * drops the rest -- the exact data-loss path this fixes.
 *
 * Pure and total. A section not present in `pack.sections` at all (a
 * pre-N45 pack thinner than four sections) is never invented here.
 *
 * Module-private since fix round F-m3: `sectionWriteNamesWithinBudget`
 * below is the one shipping consumer now that route.js calls that instead,
 * so this has no reason to be its own export (the same
 * ORPHAN_EXPORTS trap `mintWholeReplace`'s own header above already names).
 *
 * @param {string} section the section this attempt just regenerated
 * @param {*} pack the merged candidate this attempt is about to write
 * @param {Record<string, number>} liveRevisions the pointer AS READ before this write
 * @returns {string[]}
 */
function sectionWriteNames(section, pack, liveRevisions) {
  const sections = isPlainObject(pack) && isPlainObject(pack.sections) ? pack.sections : {};
  const pointer = isPlainObject(liveRevisions) ? liveRevisions : {};
  const seeded = PREP_SECTION_NAMES.filter(
    (name) => name !== section && !Object.hasOwn(pointer, name) && Object.hasOwn(sections, name),
  );
  return [section, ...seeded];
}

/**
 * F-m3 (fix round, verify.r4.md MINOR, widened): the sub-list of
 * `sectionWriteNames`' OTHER names -- never `section` itself, whose own size
 * cannot be known until the model replies -- that fit
 * PREP_SECTION_REVISION_MAX_BYTES once minted exactly as
 * buildRevisionSections would mint them. Measured PRE-model, from `pack`
 * alone (the base document, never a reply), with the SAME sectionRevisionBytes
 * appendSectionRevisions (prepStore.js) itself enforces, so nothing here can
 * drift from what the real insert would refuse.
 *
 * An oversized OTHER section is left OUT of the returned list rather than
 * refusing the whole attempt: `section` still regenerates normally, and the
 * excluded name is simply not seeded this round -- restorePayload's own
 * fallback (prepMerge.js, fix round F-M6/F-M3) rebuilds it from the live
 * pack directly the next time it is needed, so nothing here is a permanent
 * loss.
 *
 * Pure and total. Never calls a model, never performs I/O.
 *
 * @param {string} section the section THIS attempt is regenerating
 * @param {*} pack the pre-attempt document (never the model's reply)
 * @param {Record<string, number>} liveRevisions the pointer AS READ
 * @param {Record<string, number>} newestBySection
 * @returns {string[]} `section` first, then every OTHER seed candidate that fits.
 */
export function sectionWriteNamesWithinBudget(section, pack, liveRevisions, newestBySection) {
  const others = sectionWriteNames(section, pack, liveRevisions).filter((name) => name !== section);
  if (others.length === 0) return [section];
  const seeded = buildRevisionSections(pack, "unknown", others, newestBySection);
  const fitting = others.filter((name) => sectionRevisionBytes(seeded[name]) <= PREP_SECTION_REVISION_MAX_BYTES);
  return [section, ...fitting];
}

/**
 * F-B1's companion: the per-name engine resolver `buildRevisionSections`
 * needs to seed a section this attempt did NOT produce with ITS OWN
 * provenance, never this attempt's. `baseProvenanceFromPack` (prepMerge.js)
 * is the only signal available for a pre-N45 row with no revision rows of
 * its own -- "embedded" when the base document carries its own
 * `templateOrigin`, "gemini" otherwise. That "otherwise" is a DELIBERATE
 * fail-closed default, not a proven fact: `buildEmbeddedPack` only started
 * stamping `templateOrigin` in `0e83c97`, a day after it was introduced in
 * `8e780b0`, so a base written by the embedded engine in that window carries
 * no `templateOrigin` and is seeded here as "gemini" too. That mislabels the
 * row, but only in the direction that REMOVES the K1-SHAPE citation
 * exemption from content that (falsely) has none -- it can never GRANT the
 * exemption to content that lacks it, so it is not an O-15 escape.
 *
 * @param {*} currentPack the pre-attempt document
 * @param {string} section the section THIS attempt regenerated
 * @param {"gemini"|"embedded"} engine THIS attempt's own engine
 * @returns {(name: string) => "gemini"|"embedded"}
 */
export function seedEngineResolver(currentPack, section, engine) {
  const provenance = baseProvenanceFromPack(currentPack);
  return (name) => (name === section ? engine : provenance[name] === "embedded" ? "embedded" : "gemini");
}

/**
 * F-B2 (fix round, verify.r2.md BLOCKER 2): the embedded engine's own
 * candidate, honouring `section` exactly like the gemini path -- merges
 * ONLY the named section's deterministic template body into `currentPack`,
 * leaving the other three byte-identical, rather than always replacing the
 * whole document regardless of what was asked for. `embeddedRaw` is
 * `buildEmbeddedPack`'s own output, never minted itself -- minting still
 * runs through the SAME `mintSectionClaims`/`mintWholeReplace` machinery the
 * gemini path uses, so both engines share exactly one path.
 *
 * @param {{currentPack: *, section: string|null, embeddedRaw: *}} args
 * @returns {*}
 */
export function buildEmbeddedCandidate({ currentPack, section, embeddedRaw }) {
  if (!section) return buildWholeCandidate(embeddedRaw, "embedded");
  const rawSections = isPlainObject(embeddedRaw) ? embeddedRaw.sections : null;
  const rawContent = isPlainObject(rawSections) ? rawSections[section] : undefined;
  const rawClaims = isPlainObject(embeddedRaw) ? embeddedRaw.claims : [];
  const minted = mintSectionClaims(section, rawContent, rawClaims);
  return buildSectionCandidate({ currentPack, section, content: minted.content, claims: minted.claims, engine: "embedded" });
}
