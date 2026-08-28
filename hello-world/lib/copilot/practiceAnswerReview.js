// Pure decision logic for the practice review panel's record: the computed
// metrics for the last completed answer, paired with the interview type
// that critique was actually JUDGED under (AC-A11b/AC-A12). Extracted out
// of usePracticeAnswer.js so the pairing rule is node-testable outside a
// hook — the same reason answerWindow.js and answerProvenance.js exist.
//
// The two fields are created and cleared TOGETHER, never independently.
// That pairing is what lets PracticeClient.js's judgedInterviewTypeLabel
// hold by CONSTRUCTION rather than by destruction: AC-A11's foreign-origin
// interview-type change no longer clears the panel (it must never abandon
// an in-progress recording or revoke a finished take's replay), so the
// label can only stay honest if it is IMPOSSIBLE to update one field
// without the other. usePracticeAnswer.js calls recordAnswerReview at the
// exact moment a critique's metrics are computed (doneAnswer) and resets to
// CLEARED_ANSWER_REVIEW in resetAnswerState — never a bare
// setAnswerMetrics/setJudgedInterviewType pair, which is exactly the shape
// that would let the two drift apart by a future edit to only one call site.
export const CLEARED_ANSWER_REVIEW = Object.freeze({ metrics: null, judgedInterviewType: null });

export function recordAnswerReview({ metrics, interviewType }) {
  return { metrics, judgedInterviewType: interviewType || "general" };
}
