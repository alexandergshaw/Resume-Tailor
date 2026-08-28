// Pure decision logic for PracticeClient's interview-type-change
// announcement (contract 7). Extracted out of usePracticeAnswer.js so it is
// reachable from the repo's node-only vitest setup — no React, no DOM,
// nothing that lives inside a hook can be exercised by a test at all (the
// same reason answerWindow.js and answerProvenance.js exist). Every
// function here is a straight function of its arguments.
//
// It exists because hadRecording/hadReview are derived from state only
// usePracticeAnswer.js knows — was an answer being recorded or still
// settling, was a finished review on screen — so PracticeClient's own
// subscriber is left with nothing but the call.
//
// Uses the SAME interviewTypeChangeAnnouncement the live surface calls
// (CopilotClient.js), so the two announcements cannot drift apart.
//
// THE STORAGE CLAUSE IS NOT DECIDED HERE, and the shape of this function's
// return is what makes that safe. It used to take `alreadyAnnounced` and
// return `nextAnnounced` — a once-per-tab latch of its own, alongside
// CopilotClient's. The step-9 review collapsed the two to one owner
// (`claimStorageAnnouncement`) by hardcoding `alreadyAnnounced: false` here,
// which left this side always asking for the storage sentence and the owner
// able to answer only with that sentence or `""`. The manual-regression pass
// found the consequence: on a storage-blocked tab every practice change
// after the first was announced as nothing at all.
//
// So this function no longer offers ONE sentence and hope. It returns BOTH
// rows the owner might want and lets the owner choose:
//
//   storage   the row WITH the once-per-tab clause, for a free latch
//   ordinary  the same row WITHOUT it, for a spent one
//
// When storage is healthy the two are identical and the owner never touches
// the latch. `nextAnnounced` is gone rather than made live: with the latch
// owned in exactly one place, a second variable tracking the same fact from
// over here is the two-latch defect this whole seam has already produced
// twice. Nothing about the once-per-tab decision lives on this side.
import { interviewTypeChangeAnnouncement } from "./choiceChangeInvalidation";

// { storage, ordinary } — hand the whole object to `claimStorageAnnouncement`
// (CopilotClient.js:417 does, via the onInterviewTypeAnnouncement prop);
// never pick between them here.
export function practiceInterviewTypeAnnouncement({
  origin,
  label,
  answering,
  settling,
  answerMetrics,
  blocked,
}) {
  const row = (storageBlocked) =>
    interviewTypeChangeAnnouncement({
      surface: "practice",
      origin,
      label,
      hadRecording: answering || settling,
      hadReview: !!answerMetrics,
      storageBlocked,
    });
  const ordinary = row(false);
  return { storage: blocked ? row(true) : ordinary, ordinary };
}
