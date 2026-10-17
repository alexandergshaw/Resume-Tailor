// N95 (perceived-smoothness pass, owner ruling: optimistic-with-rollback for
// MOVE) -- the pure, isomorphic half of the optimistic move: what to snapshot
// before the optimistic write, what patch the optimistic write itself
// applies, and how the docx path reconciles once the real commit resolves.
// Pulled out of app/hooks/useCompanyResearch.js's moveInsertedFact into its
// own module ONLY to keep that hook under its line ceiling (the same kind of
// extraction N89 Part 1 and N92 Wave 1 already made for
// coverFactStrategy/planMoveFact); every caller-visible field and rule below
// is exactly what the hook's own restructure needs, just kept out of it.
//
// No DOM, no I/O, no React -- sibling to lib/acceptedFacts/factMove.js.

// The no-op-move outcome: maps planMoveFact's own closed `reason` set onto a
// recordDecision outcome plus the reason text shown to the candidate. Pure;
// kept here so moveInsertedFact's own no-op branch stays a single call.
export function resolveNoopMove(moved) {
  const outcome = moved.reason === "boundary" ? "skipped" : "refused";
  const reason =
    moved.reason === "boundary"
      ? "That fact can't move any further in that direction."
      : "That fact is no longer where it was recorded -- try reopening the letter.";
  return { outcome, reason };
}

// The exact cover-scoped fields a move touches, or that the preview's
// verbatim-serve reads (docx.js:653-654) -- captured BEFORE the optimistic
// write below runs, so a rollback can restore them byte-identically. Never a
// wholesale entry snapshot: a move only ever touches these five fields, and
// restoring only these (merged over whatever else changed concurrently)
// avoids clobbering an unrelated edit to the same tailoringMap entry.
export function captureCoverSnapshot(entry) {
  return {
    coverLetterResultLines: entry?.coverLetterResultLines,
    insertedFacts: entry?.insertedFacts,
    coverLetterDocxB64: entry?.coverLetterDocxB64,
    coverLetterDocxPath: entry?.coverLetterDocxPath,
    coverLetterPreviewHtml: entry?.coverLetterPreviewHtml,
  };
}

// The optimistic write itself, applied synchronously on click, before the
// commit's first await -- the on-screen position shifts to `moved`'s result
// immediately. The preview body is served bytes-first and VERBATIM
// (docx.js:653-654 -- unedited + engineDocxB64/docxPath both serve straight
// through), so BOTH byte sources are nulled here, never just one: leaving
// either in place would re-parse the STALE bytes on the reload this same
// click triggers and show the OLD position instead of the new one.
export function moveOptimisticPatch(moved) {
  return {
    coverLetterResultLines: moved.lines,
    insertedFacts: moved.records,
    coverLetterPreviewHtml: undefined,
    coverLetterDocxB64: undefined,
    coverLetterDocxPath: undefined,
  };
}

// Successful commit outputs are authoritative. Recovered originals can now
// produce new documents even for edited/no-byte inputs; native best-effort
// upload may instead return usable session bytes with no durable path.
// Explicit empty bytes/null path clear stale optimistic or pre-move sources.
// Private helper: the only production consumer remains moveSuccessPatch.
function resolveMoveDocxPath(commitDocxPath) {
  return typeof commitDocxPath === "string" && commitDocxPath ? commitDocxPath : null;
}

export function moveSuccessPatch({ moved, commit }) {
  return {
    coverLetterResultLines: moved.lines,
    coverLetterPreviewHtml: undefined,
    coverLetterDocxB64: typeof commit.coverDocxB64 === "string" ? commit.coverDocxB64 : "",
    coverLetterDocxPath: resolveMoveDocxPath(commit.coverDocxPath),
    insertedFacts: moved.records,
  };
}

// The accepted-facts store's own reconciliation after a successful commit --
// the commit's fresh facts/removed/revision when the PUT returned them, else
// whatever this job's prior store snapshot already held. Same fallback chain
// removeInsertedFact/acceptFacts use inline; pulled out here only because
// moveInsertedFact's own version needed the extra `commit.ok`/`commit.data`
// indirection commitFactMove.js's return shape adds.
export function moveAcceptedFactsPatch(commit, prior) {
  return {
    facts: commit.data.facts || prior?.facts || [],
    removed: commit.data.removed || prior?.removed || [],
    revision: commit.data.revision ?? prior?.revision ?? null,
  };
}
