"use client";

import { useState } from "react";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import styles from "./preparation.module.css";

function ResearchEvidence({ result }) {
  const boundaries = [...new Set([0, result.narrative.length, ...result.spans.flatMap((span) => [span.start, span.end])])].sort((a, b) => a - b);
  return <details className={styles.researchEvidence}><summary>Research and background sources</summary>
    <p>Model-written research with provider citation annotations. These links are background, not proof that a predicted question was asked. Source publication dates are unknown.</p>
    <p>Researched {result.researchedAt} · {result.coverage.acceptedSources} background sources · Location: {result.location || "unknown"}. Context captured at research time; later employer changes are not automatically detected.</p>
    <div className={styles.researchNarrative}>{boundaries.slice(0, -1).map((start, index) => { const end = boundaries[index + 1]; const ending = result.spans.filter((span) => span.end === end); return <span key={start}>{result.narrative.slice(start, end)}{ending.map((span) => { const source = result.sources.find((entry) => entry.id === span.sourceId); if (!source) return null; const href = safeExternalHref(source.url); return href ? <a key={`${span.sourceId}-${span.start}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={`Background source: ${source.title}`}> [{result.sources.indexOf(source) + 1}]</a> : <span key={`${span.sourceId}-${span.start}`}> [{result.sources.indexOf(source) + 1}]</span>; })}</span>; })}</div>
    <h5>Background sources</h5><ol>{result.sources.map((source) => { const href = safeExternalHref(source.url); return <li key={source.id}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}</li>; })}</ol>
    {result.coverage.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}{result.coverage.descriptionTruncated && <p>The long job description was shortened for this research request.</p>}
  </details>;
}
export default function PreparationOverview({ posting, engine, research, state, onOverride, onSelectStage, onPractice, onOpenTool, practiceBlocked }) {
  const [replaceRequested, setReplaceRequested] = useState(false);
  const result = research.adopted; const pending = research.pending;
  const selected = result?.stages.find((stage) => stage.id === research.selection) || result?.stages[0];
  const usePlan = () => { if (!state.adoptPending()) setReplaceRequested(true); };
  return <div className={styles.interviewPlan}>
    <section className={styles.researchHero}><div><h4>From research to a focused practice session</h4><p>{posting ? `Research ${posting.company || "the employer"}'s likely process for ${posting.title || "this role"}, then practice one stage at a time.` : "Choose a tracked application above to research its interview process. Your existing preparation tools remain available."}</p></div>
      <button className={styles.primary} disabled={!state.canResearch} onClick={state.run}>Research this interview</button>
      <p className={styles.researchCost}>Engine: {engine || "unknown"}. Explicit web research may incur provider cost. No resume, cover letter or personal answers are sent. No research runs automatically.</p>
      {engine !== "gemini" && <p role="status">Choose Gemini in the app engine settings to research. Embedded and external modes do not perform this search.</p>}
      {state.status === "researching" && <div role="status"><p>Researching interview process and preparing stage predictions…</p><button onClick={state.cancel}>Cancel research</button></div>}
      {state.error && <p role="alert">{state.error}</p>}
      {!state.identityReady && posting && <p role="status">Checking application context…</p>}
      {practiceBlocked && <div role="status"><p>An unfinished practice draft is retained. Resume it to save or explicitly discard it before changing the plan or practice questions.</p><button onClick={() => onOpenTool("mock")}>Resume unfinished practice</button></div>}
    </section>
    {pending && <section className={styles.planCandidate} aria-label="New interview research to review"><h4>New research is ready to inspect</h4><p>{pending.status === "ready" ? `${pending.stages.length} predicted stages, five ranked questions each.` : "Insufficient evidence for a researched stage plan. Gaps remain visible below."}</p>
      <p>Captured research result — review before using. {state.pendingStale ? "You edited preparation during or after this request. Your edits are retained; adopting this result is an explicit choice." : "Your current plan and answers are retained until you choose."}</p>
      <ul>{pending.stages.map((stage) => <li key={stage.id}>{stage.name} — {stage.purpose}<details><summary>Inspect five predicted questions</summary><ol>{stage.questions.map((question) => <li key={question.id}><strong>{question.text}</strong><p>{question.reason}</p></li>)}</ol></details></li>)}</ul><ResearchEvidence result={pending} />
      <ul>{pending.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul>
      <div className={styles.actions}><button disabled={practiceBlocked} onClick={usePlan}>Use this plan</button><button onClick={state.keepCurrent}>Keep current plan</button></div>
      {replaceRequested && <div role="alertdialog" aria-label="Replace edited interview plan"><p>Your edited questions belong to the current plan. Replacing it retains the original research as a previous version; export edited questions first if you need both sets.</p><button disabled={practiceBlocked} onClick={() => { state.adoptPending({ replaceConfirmed: true }); setReplaceRequested(false); }}>Replace plan and retain previous version</button><button onClick={() => setReplaceRequested(false)}>Cancel replacement</button></div>}
    </section>}
    {!result && <section className={styles.card}><h4>Your interview plan starts here</h4><p>Research once to get likely stages, five ranked questions per stage, reasons and background sources. Predictions remain distinct from the employer&apos;s confirmed process.</p><button onClick={() => onOpenTool("brief")}>Open interview brief</button></section>}
    {result && <>
      {state.stale && <p role="alert">This research belongs to earlier application details. Keep your edits, then research the current role before relying on the plan.</p>}
      <p className={styles.predictionNote}>Research-informed predictions, not confirmed employer stages or guaranteed questions. Sources support background research; verify the process with your recruiter.</p>
      {result.status === "insufficient-evidence" ? <section className={styles.card}><h4>Not enough interview-process evidence</h4><p>No stage list was invented. Research again explicitly, or use general practice while confirming the process with your recruiter.</p><button onClick={() => onOpenTool("mock")}>Open general practice</button></section> : <>
        <label className={styles.field}><span>Upcoming interview stage</span><select aria-label="Upcoming interview stage" value={selected?.id || ""} onChange={(event) => onSelectStage(event.target.value)}>{result.stages.map((stage) => <option value={stage.id} key={stage.id}>{stage.rank}. {stage.name}</option>)}</select></label>
        <div className={styles.stageMap}>{result.stages.map((stage) => <button key={stage.id} onClick={() => onSelectStage(stage.id)} aria-pressed={selected?.id === stage.id}><strong>{stage.rank}. {stage.name}</strong><small>Predicted stage</small></button>)}</div>
        {selected && <section aria-label={`Questions for ${selected.name}`}><div className={styles.planStageHeader}><div><h4>{selected.name}</h4><p>{selected.purpose}</p></div><button disabled={practiceBlocked || state.stale || !state.identityReady} onClick={() => onPractice({ stageId: selected.id, questionId: null })}>Practice this stage</button></div>
          {practiceBlocked && <p role="status">Finish or save your current practice before replacing its questions.</p>}
          <ol className={styles.planQuestions}>{selected.questions.map((question) => { const edited = Object.hasOwn(research.overrides, question.id); const text = edited && research.overrides[question.id].trim() ? research.overrides[question.id] : question.text; return <li key={question.id} className={styles.planQuestion}><div className={styles.planQuestionHeading}><h5>{question.rank}. {text}</h5><span>{edited ? "Your edit" : "Predicted question"}</span></div><p><strong>Why prepare:</strong> {question.reason}</p><button disabled={practiceBlocked || state.stale || !state.identityReady} aria-label={`Practice question ${question.rank}: ${text}`} onClick={() => onPractice({ stageId: selected.id, questionId: question.id })}>Practice this question</button><details><summary>Edit question {question.rank}</summary><label className={styles.field}><span>Edit question {question.rank} for {selected.name}</span><textarea aria-label={`Edit question ${question.rank} for ${selected.name}`} maxLength={600} rows={3} value={research.overrides[question.id] ?? question.text} onChange={(event) => onOverride(question.id, event.target.value)} /></label><p>Original prediction: {question.text}</p><p>Edits are yours; background sources are not proof of this wording.</p></details></li>; })}</ol>
        </section>}
      </>}
      {!!result.unknowns.length && <section className={styles.card}><h4>What to confirm with your recruiter</h4><ul>{result.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></section>}
      <ResearchEvidence result={result} />
    </>}
    {research.previous && <details><summary>Previous research version</summary><p>Earlier research, not your current plan.</p><ResearchEvidence result={research.previous} /></details>}
  </div>;
}
