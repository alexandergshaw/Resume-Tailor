import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { untrackChipApplication, presentUntrackOutcome } from "@/lib/applications/untrackChip";

/**
 * The chip dock's untrack action — "Remove", "Ignore", and the chip drop that
 * follows "Mark as applied" all go through this ONE function, so none of them
 * can drift into a different answer about what happens to the row or what the
 * user is told.
 *
 * Extracted out of `app/page.js` rather than added to it: that file is at its
 * 3250-line ceiling, and the state this feature needs (the notice, plus the
 * announcement counter the live region keys on) has no business being another
 * two `useState`s in a component that already has ninety.
 *
 * WHAT CHANGED AND WHY. The old in-page handler ended
 *
 *     if (refused) return;
 *     setTrackedJobs((prev) => prev.filter((j) => j.id !== jobId));
 *
 * where `refused` was `!deleted` from `deleteUntrackedApplication` — a guard
 * that (correctly) refuses everything except a dateless `tracking` row. So on
 * a tailored or applied job the chip stayed and the user was told nothing.
 * See `lib/applications/untrackChip.js` for the full argument; the short
 * version is that the row's fate and the chip's fate are different questions,
 * the row's answer is unchanged, and the chip is the user's own workspace.
 */
export function useUntrackChip({ currentUser, trackedJobs, setTrackedJobs }) {
  const [untrackNotice, setUntrackNotice] = useState(null);
  // Mirrors `dupeAnnounceSeq`: two identical announcements in a row must
  // still be announced twice, which a live region only does when the node
  // inside it actually changes.
  const [untrackAnnounceSeq, setUntrackAnnounceSeq] = useState(0);

  async function handleUntrackJob(jobId) {
    // Captured BEFORE the chip is dropped — the notice names the job, and by
    // the time it is built the chip it came from is gone.
    const job = (trackedJobs || []).find((j) => j.id === jobId) || null;
    // A signed-out session has no `applications` row to decide anything
    // about, so there is no query and nothing to report: the chip just goes,
    // exactly as it did before this feature existed.
    const outcome = currentUser
      ? await untrackChipApplication(createClient(), { userId: currentUser.id, jobId })
      : null;
    // ORDER IS LOAD-BEARING. The chip is dropped only once the row's fate is
    // known, so the removal and the explanation of what survived it land in
    // the SAME render — never a chip that vanishes now and a notice that
    // appears a network round-trip later. `untrackChipApplication` is
    // total (it catches its own failures and reports `unknown`), so awaiting
    // it can never strand the chip the way `if (refused) return` did.
    setTrackedJobs((prev) => prev.filter((j) => j.id !== jobId));
    const notice = presentUntrackOutcome(outcome, job);
    setUntrackNotice(notice);
    if (notice) setUntrackAnnounceSeq((n) => n + 1);
  }

  function dismissUntrackNotice() {
    setUntrackNotice(null);
  }

  return { handleUntrackJob, untrackNotice, untrackAnnounceSeq, dismissUntrackNotice };
}
