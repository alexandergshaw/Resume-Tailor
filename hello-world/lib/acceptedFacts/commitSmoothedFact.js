// N92 Wave 3 (Control B): the persistence half of a CONFIRMED smoothed
// transition -- the counterpart to commitFactMove.js (Control A's move),
// pulled into its own module for the same reason: keep
// app/hooks/useCompanyResearch.js under its line ceiling. `after` is already
// computed ({lines, records, edits}) by lib/coverFacts/smoothTransition.js's
// confirmSmoothTransition by the time this runs -- this module does NOT
// import that seam (AC-B8a is about the smoothing CALL, which already
// happened); it only does the same byte-splice-or-drop + PUT + state-update
// I/O moveInsertedFact already does, via the SAME commitFactMove helper.
import { commitFactMove } from "./commitFactMove";
import { editedForScope } from "../document/previewBlob";

// @param {object} args
// @param {string} args.jobId
// @param {{lines:string[], records:object[], edits:object[]}} args.after  the confirmed candidate
// @param {object} args.entry  tailoringMap[jobId] at call time
// @param {(entry:object) => Promise<string>} args.resolveCoverEngineBytes
// @param {object} args.supabase
// @param {string} [args.currentUserId]
// @param {object} args.acceptedFactsByJob  THIS job's {facts,removed,revision}
// @param {Function} args.setTailoringMap
// @param {Function} args.setAcceptedFactsByJob
// @param {Function} args.setPreviewReloadKey
// @returns {Promise<{ok:true}|{ok:false, reason:string}>}
export async function commitSmoothedFact({
  jobId,
  after,
  entry,
  resolveCoverEngineBytes,
  supabase,
  currentUserId,
  acceptedFactsByJob,
  setTailoringMap,
  setAcceptedFactsByJob,
  setPreviewReloadKey,
}) {
  if (!jobId || !after) return { ok: false, reason: "No job is open." };
  const lines = Array.isArray(entry?.coverLetterResultLines) ? entry.coverLetterResultLines : [];
  const resolvedCoverDocxB64 = await resolveCoverEngineBytes(entry);
  const hasCoverBytes = resolvedCoverDocxB64.length > 0;
  const commit = await commitFactMove({
    jobId,
    lines,
    moved: after,
    hasCoverBytes,
    coverAlreadyEdited: editedForScope(entry, "cover"),
    resolvedCoverDocxB64,
    entryCoverDocxB64: entry?.coverLetterDocxB64,
    supabase,
    currentUserId,
    facts: acceptedFactsByJob?.facts || [],
    baseRevision: acceptedFactsByJob?.revision ?? null,
    declinedUrls: acceptedFactsByJob?.removed || [],
  });
  if (!commit.ok) return { ok: false, reason: commit.reason };

  setTailoringMap((current) => {
    const cur = current[jobId] || {};
    return {
      ...current,
      [jobId]: {
        ...cur,
        coverLetterResultLines: after.lines,
        coverLetterPreviewHtml: undefined,
        coverLetterDocxB64: hasCoverBytes ? commit.coverDocxB64 : cur.coverLetterDocxB64,
        insertedFacts: after.records,
      },
    };
  });
  setAcceptedFactsByJob((m) => ({
    ...m,
    [jobId]: {
      facts: commit.data.facts || acceptedFactsByJob?.facts || [],
      removed: commit.data.removed || acceptedFactsByJob?.removed || [],
      revision: commit.data.revision ?? acceptedFactsByJob?.revision ?? null,
    },
  }));
  setPreviewReloadKey((k) => k + 1);
  return { ok: true };
}
