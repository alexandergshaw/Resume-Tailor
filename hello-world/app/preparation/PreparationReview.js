"use client";

import styles from "./preparation.module.css";

export default function PreparationReview({ context, bundle, engine, reviewState, onAccept, onRevise }) {
  const review = reviewState.envelope?.review;
  return <section className={styles.card} aria-label="Independent adversarial review">
    <h4>Adversarial review of your current preparation</h4>
    <p>Review challenges the actual bundle against both document versions, confirmed supplements, role and shared strength. No issues found is not guaranteed truth. Local answer ratings are separate heuristic practice aids.</p>
    <p>Engine: {engine}. One explicit semantic call per review; it may incur provider cost. Embedded cannot provide independent semantic approval. Three explicit attempts per sequence; server per-instance limits still apply.</p>
    <p role="status">Review status: {reviewState.status}. {reviewState.error}</p>
    <div className={styles.actions}><button disabled={!context || !bundle.length || reviewState.status === "reviewing"} onClick={reviewState.reviewNow}>Review current preparation</button><button disabled={reviewState.status !== "reviewing"} onClick={reviewState.cancel}>Cancel review</button><button onClick={reviewState.resetSequence}>Start new review sequence</button></div>
    {reviewState.envelope && <p>Reviewer: {reviewState.envelope.host?.provider} · requested model {reviewState.envelope.host?.requestedModel || "unknown"} · observed model {reviewState.envelope.host?.observedModel || "unknown"}. Separate invocation: {String(reviewState.envelope.host?.separateInvocation === true)}. Saved records do not authenticate future sessions.</p>}
    {review?.findings?.map((finding) => <article className={styles.suggestion} key={finding.id}><h4>{finding.severity}: {finding.category}</h4><p>{finding.reason}</p><p>Revision: {finding.recommendation}</p>{finding.drafts.map((citation, index) => <blockquote key={index}>{citation.draftId}: {citation.quote}</blockquote>)}{finding.sources.map((citation, index) => <blockquote key={index}>Source {citation.evidenceId}: {citation.quote}</blockquote>)}{finding.missingEvidence && <p>Missing evidence: {finding.missingEvidence}</p>}{finding.severity !== "blocker" && <label><input type="checkbox" checked={reviewState.acknowledgedFindingIds.includes(finding.id)} onChange={(event) => reviewState.acknowledgeFinding(finding.id, event.target.checked)} /> Keep this advice as an acknowledged limitation, without claiming a clean verdict</label>}</article>)}
    {review?.probes?.length > 0 && <div><h4>Probing interviewer follow-ups</h4><ul>{review.probes.map((probe, index) => <li key={index}>{probe.draftId}: {probe.question}</li>)}</ul></div>}
    <p>{reviewState.acceptance.reason}</p><div className={styles.actions}><button onClick={onRevise}>Revise draft and review again</button><button disabled={!reviewState.acceptance.allowed} onClick={onAccept}>Accept reviewed suggestion</button></div>
    {reviewState.attempts.length > 0 && <details><summary>Review attempt history ({reviewState.attempts.length})</summary>{reviewState.attempts.map((attempt, index) => <div key={index}><p>{attempt.at} — {attempt.status}: {attempt.error}</p>{attempt.envelope && <pre>{JSON.stringify(attempt.envelope.review, null, 2)}</pre>}</div>)}</details>}
  </section>;
}
