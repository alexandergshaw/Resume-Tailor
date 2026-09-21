// lib/interviewPrep/prepMerge.js -- the pure half of the N45/N46 mechanism
// (plan §S3, §2.4, §6.1). Pure, no I/O.
//
// Three exports, three different jobs:
//
//   buildPackDocument      the single place the claims-fold is implemented
//                          (H1's templateOrigin rule, plan risk R9) -- one
//                          implementation for whole-pack generation, a
//                          single-section merge, and a restore.
//   baseProvenanceFromPack the fail-closed default for a row with no
//                          revision rows -- every row in production today.
//   restorePayload         THE F2 RESOLUTION (plan §2.2): what a terminal
//                          FAILED/UNAVAILABLE write puts back so N47's
//                          content loss cannot happen.

import { EMBEDDED_TEMPLATE_ORIGIN } from "./prepParse.js";
import { PREP_SECTION_NAMES } from "./prepContract.js";
import { claimOwner } from "./prepClaims.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

/** `isEmbeddedTemplateOrigin`'s own discipline (prepParse.js:372), reproduced
 *  here rather than imported (that function is module-private in
 *  prepParse.js): `Object.hasOwn`, never a plain `===` that reads through
 *  the prototype chain. */
function isEmbeddedOrigin(pack) {
  return isPlainObject(pack) && Object.hasOwn(pack, "templateOrigin") && pack.templateOrigin === EMBEDDED_TEMPLATE_ORIGIN;
}

/**
 * Provenance for a base document that has no revision rows (every pre-N45
 * row). Returns "embedded" for all four sections when the stored pack
 * carries its OWN `templateOrigin`, and "unknown" for all four otherwise --
 * NEVER read from `interview_prep_packs.engine`, which after a failed
 * attempt describes the ATTEMPT, not the content (plan §2.6.2).
 *
 * @param {*} pack
 * @returns {Record<string, "embedded"|"unknown">}
 */
export function baseProvenanceFromPack(pack) {
  const value = isEmbeddedOrigin(pack) ? "embedded" : "unknown";
  const out = {};
  for (const name of PREP_SECTION_NAMES) out[name] = value;
  return out;
}

/**
 * Builds a WHOLE pack document from a base plus the sections being replaced.
 * The single place design §3.4's claims fold is implemented -- three write
 * paths, one implementation. Pure and total; never mutates its inputs; never
 * reads storedNames, a request body, or anything descending from a model
 * reply other than the content/claims handed to it in `replace`.
 *
 * `wholePack:false` (section regeneration, restore, and restorePayload's own
 * fold) -- sections absent from `replace` carry over from `base` verbatim;
 * base claims NOT owned by a replaced section are kept verbatim.
 * `wholePack:true` (whole-pack generation) -- sections absent from `replace`
 * are DROPPED and every base claim is discarded, preserving today's
 * destructive semantics exactly.
 *
 * `templateOrigin` is emitted ONLY when the output has at least one section
 * and EVERY contributing section's engine is "embedded" (H1). A base with no
 * recorded provenance contributes "unknown", which is not "embedded" --
 * fails closed. NEVER read from `interview_prep_packs.engine`.
 *
 * @param {{ base: *, baseProvenance: Record<string, "gemini"|"external"|"embedded"|"unknown">,
 *           replace: Record<string, {content: *, claims: Array<{id: string}>, engine: string}>,
 *           wholePack?: boolean }} args
 * @returns {{version: 1, sections: object, claims: Array<object>, templateOrigin?: "embedded-template"}}
 */
export function buildPackDocument({ base, baseProvenance, replace, wholePack = false }) {
  const baseObj = isPlainObject(base) ? base : {};
  const baseSections = isPlainObject(baseObj.sections) ? baseObj.sections : {};
  const replaceMap = isPlainObject(replace) ? replace : {};
  const replacedNames = Object.keys(replaceMap).filter((name) => PREP_SECTION_NAMES.includes(name));
  const provenance = isPlainObject(baseProvenance) ? baseProvenance : {};

  const sections = {};
  if (wholePack) {
    for (const name of replacedNames) sections[name] = clone(replaceMap[name].content);
  } else {
    for (const name of PREP_SECTION_NAMES) {
      if (Object.hasOwn(replaceMap, name)) sections[name] = clone(replaceMap[name].content);
      else if (Object.hasOwn(baseSections, name)) sections[name] = clone(baseSections[name]);
    }
  }

  let claims;
  if (wholePack) {
    claims = [];
  } else {
    const baseClaims = Array.isArray(baseObj.claims) ? baseObj.claims : [];
    claims = baseClaims
      .filter((entry) => {
        const owner = claimOwner(entry && entry.id);
        return owner === null || !replacedNames.includes(owner);
      })
      .map(clone);
  }
  for (const name of replacedNames) {
    const entryClaims = Array.isArray(replaceMap[name].claims) ? replaceMap[name].claims : [];
    claims.push(...entryClaims.map(clone));
  }

  const contributingEngines = [];
  for (const name of PREP_SECTION_NAMES) {
    if (!Object.hasOwn(sections, name)) continue;
    contributingEngines.push(Object.hasOwn(replaceMap, name) ? replaceMap[name].engine : provenance[name] ?? "unknown");
  }

  const result = { version: 1, sections, claims };
  if (contributingEngines.length > 0 && contributingEngines.every((engine) => engine === "embedded")) {
    result.templateOrigin = EMBEDDED_TEMPLATE_ORIGIN;
  }
  return result;
}

/**
 * The terminal-write fields that put back the document a FAILED or
 * UNAVAILABLE attempt would otherwise leave blanked by
 * claim_prep_pack_slot's unconditional `pack = '{}'::jsonb`
 * (supabase/migrations/20260922000000_interview_prep_remove_spend_caps.sql:92).
 *
 * Pure and total: no I/O, never throws, never mutates `base`.
 *
 * Returns `{}` -- design §8.3's "neither" case, which leaves BOTH columns
 * out of writePrepPackResult's SET list -- in exactly two situations and no
 * others:
 *
 *   1. `base.status === "running"`. The packs row was mid-attempt when the
 *      base was read, so `base.pack` is ALREADY the blanked `'{}'` and is
 *      evidence of nothing. Restoring it would write an empty document that
 *      looks, to every instrument, like a successful restore. This branch is
 *      the difference between a fix and a fix-shaped no-op.
 *   2. There is no prior document at all: `base.liveRevisions` has no keys
 *      AND `base.pack` carries no `sections` object with at least one key.
 *      A first-ever generation that fails still leaves `'{}'`, which is
 *      correct and is today's behaviour, byte for byte.
 *
 * Otherwise returns BOTH fields:
 *   `pack`          -- when `liveRevisions` is non-empty, the fold of
 *                      buildPackDocument over the live revision bodies
 *                      (`wholePack: true`, every live section in `replace`),
 *                      so the H1 templateOrigin rule applies to a restore
 *                      exactly as it applies to a generation. When
 *                      `liveRevisions` is empty, `base.pack` VERBATIM (the
 *                      pre-N45 row's own stored document).
 *   `liveRevisions` -- the pointer EXACTLY as read. Never a fresh `{}`:
 *                      writing `{}` over a populated pointer would silently
 *                      orphan the whole history on the first failed attempt.
 *
 * @param {{
 *   status: string|null,
 *   pack: *,
 *   liveRevisions: Record<string, number>,
 *   sections: Record<string, {content: *, claims: Array<object>, engine: string, revision: number}>
 * }} base   the value readLiveSectionRevisions returned BEFORE the claim
 * @returns {{}|{pack: object, liveRevisions: Record<string, number>}}
 */
export function restorePayload(base) {
  const safeBase = isPlainObject(base) ? base : {};
  if (safeBase.status === "running") return {};

  const liveRevisions = isPlainObject(safeBase.liveRevisions) ? safeBase.liveRevisions : {};
  const hasLivePointer = Object.keys(liveRevisions).length > 0;
  const pack = safeBase.pack ?? null;
  const packHasSections = isPlainObject(pack) && isPlainObject(pack.sections) && Object.keys(pack.sections).length > 0;

  if (!hasLivePointer && !packHasSections) return {};
  if (!hasLivePointer) return { pack: clone(pack), liveRevisions: {} };

  const sections = isPlainObject(safeBase.sections) ? safeBase.sections : {};
  const baseProvenance = {};
  const replace = {};
  for (const name of PREP_SECTION_NAMES) {
    const entry = sections[name];
    if (!isPlainObject(entry)) continue;
    replace[name] = {
      content: entry.content,
      claims: Array.isArray(entry.claims) ? entry.claims : [],
      engine: entry.engine ?? "unknown",
    };
    baseProvenance[name] = entry.engine ?? "unknown";
  }

  const rebuilt = buildPackDocument({ base: {}, baseProvenance, replace, wholePack: true });
  return { pack: rebuilt, liveRevisions: clone(liveRevisions) };
}
