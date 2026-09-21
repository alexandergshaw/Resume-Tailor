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

import { mintSectionClaims, claimOwner } from "./prepClaims.js";
import { buildPackDocument, baseProvenanceFromPack } from "./prepMerge.js";
import { PREP_SECTION_NAMES } from "./prepContract.js";

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
 * back exactly what the live pack showed. `claims` is partitioned by
 * OWNERSHIP (`claimOwner`), never by which section the model happened to
 * answer for, so a revision row never carries another section's claims.
 *
 * @param {*} normalizedPack
 * @param {"gemini"|"embedded"} engine
 * @param {string[]} names the sections this attempt actually produced
 * @param {Record<string, number>} newestBySection
 */
export function buildRevisionSections(normalizedPack, engine, names, newestBySection) {
  const sections = normalizedPack.sections || {};
  const claims = Array.isArray(normalizedPack.claims) ? normalizedPack.claims : [];
  const out = {};
  for (const name of names) {
    out[name] = {
      content: sections[name],
      claims: claims.filter((c) => claimOwner(c?.id) === name),
      engine,
      revision: (newestBySection[name] || 0) + 1,
    };
  }
  return out;
}
