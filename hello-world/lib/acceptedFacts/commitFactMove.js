// N92 Wave 1 (Control A): the I/O half of a fact move -- re-splice the
// engine's docx (when available and the letter isn't already hand-edited)
// and PUT the resulting `coverVersion`. Pulled out of
// app/hooks/useCompanyResearch.js's `moveInsertedFact` into its own module
// ONLY to keep that hook under its line ceiling (the same kind of move N89
// Part 1 already made for `coverFactStrategy`/`filterEligibleArticles` in
// lib/acceptedFacts/factInsertion.js); behaviour mirrors
// `removeInsertedFact` (useCompanyResearch.js:665-676) EXACTLY -- a splice
// REFUSAL (or no bytes at all) drops `coverDocxPath` to `null` so the
// download rebuilds from the moved `lines` rather than shipping stale bytes
// that still carry the fact's old position (AC-A9).
//
// This module does real I/O (fetch, docx splice, upload) -- unlike its pure
// sibling lib/acceptedFacts/factMove.js -- so it is never imported by
// anything that must stay isomorphic. The hook still owns every React state
// update and the `recordDecision` call: the decision ledger binds that call
// to useCompanyResearch.js's own module (design N92.design-structure.r1.md
// section 5), so it cannot move here.
import { applyCoverDocxEdits } from "./factDocx";
import { uploadCoverDocx } from "../document/coverDocxStore";

// @param {object} args
// @param {string[]} args.lines  the entry's ORIGINAL coverLetterResultLines (pre-move) -- what `edits`' `before` fields are checked against
// @param {{lines:string[], records:object[], edits:object[]}} args.moved  a `changed:true` planMoveFact result
// @param {boolean} args.hasCoverBytes
// @param {boolean} args.coverAlreadyEdited
// @param {string} args.resolvedCoverDocxB64
// @param {string} args.entryCoverDocxB64
// @param {object} args.supabase
// @param {string} [args.currentUserId]
// @param {object[]} args.facts  the accepted-facts store's current list (unchanged by a move)
// @param {number|null} args.baseRevision
// @param {string[]} args.declinedUrls
// @returns {Promise<{ok:true, coverDocxB64:string, coverDocxPath:string|null, data:object} | {ok:false, reason:string}>}
export async function commitFactMove({
  jobId,
  lines,
  moved,
  hasCoverBytes,
  coverAlreadyEdited,
  resolvedCoverDocxB64,
  entryCoverDocxB64,
  supabase,
  currentUserId,
  facts,
  baseRevision,
  declinedUrls,
}) {
  let coverDocxB64 = entryCoverDocxB64;
  let coverDocxPath = null;
  if (hasCoverBytes && !coverAlreadyEdited) {
    const spliced = await applyCoverDocxEdits(resolvedCoverDocxB64, lines, moved.edits);
    coverDocxB64 = spliced.applied ? spliced.docxB64 : "";
    if (spliced.applied) {
      coverDocxPath = await uploadCoverDocx(supabase, currentUserId, coverDocxB64);
    }
  }

  try {
    const res = await fetch("/api/accepted-facts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobRef: jobId,
        facts,
        baseRevision,
        declinedUrls,
        coverVersion: { lines: moved.lines, insertedFacts: moved.records, docxPath: coverDocxPath },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = typeof data?.error === "string" && data.error ? data.error : "Couldn't move that fact. Try again.";
      return { ok: false, reason };
    }
    // N95: coverDocxPath is returned too (not just coverDocxB64) -- an
    // optimistic caller nulls its OWN copy of the path before this resolves
    // (lib/acceptedFacts/moveOptimism.js), and this is the only place that
    // fresh, actually-persisted path exists to reconcile it from.
    return { ok: true, coverDocxB64, coverDocxPath, data };
  } catch (err) {
    return { ok: false, reason: err?.message || "Couldn't move that fact. Try again." };
  }
}
