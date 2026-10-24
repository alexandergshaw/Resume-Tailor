"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildMockQuestions, reviewAnswer, rankRepairs } from "@/lib/interviewPreparation/workbench";
import styles from "./preparation.module.css";

export default function PreparationRehearsal({ stage, inputs, artifacts, attempts, update, context = null, groundedArtifact, onBuildGrounded, onGroundedDraft, practiceRequest = null, rehearsalDraft = null, onDraftChange, onGuardChange, onRequestConsumed }) {
  const [questions, setQuestions] = useState(() => rehearsalDraft?.question ? [{ text: rehearsalDraft.question, category: "Restored practice", sourceContextKey: rehearsalDraft.sourceContextKey, stageId: rehearsalDraft.stageId, questionId: rehearsalDraft.questionId, originalQuestion: rehearsalDraft.originalQuestion || "" }] : []);
  const [position, setPosition] = useState(0);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(rehearsalDraft?.elapsedSeconds || 0);
  const [answer, setAnswer] = useState(rehearsalDraft?.text || "");
  const [seed, setSeed] = useState("1");
  const [selectedId, setSelectedId] = useState(rehearsalDraft?.targetAttemptId || "");
  const [unknownRevisionTarget, setUnknownRevisionTarget] = useState(!!rehearsalDraft?.revision && !rehearsalDraft?.targetAttemptId);
  const [checks, setChecks] = useState({});
  const [revision, setRevision] = useState(rehearsalDraft?.revision || "");
  const [notice, setNotice] = useState(rehearsalDraft ? "Restored practice draft — timer stopped" : "");
  const [discardRequested, setDiscardRequested] = useState(false);
  const clock = useRef({ started: 0, running: false, position: 0, answer: rehearsalDraft?.text || "", revision: rehearsalDraft?.revision || "", targetAttemptId: rehearsalDraft?.targetAttemptId || null, serial: 0, question: questions[0] || null, elapsed: rehearsalDraft?.elapsedSeconds || 0 });
  const callbacks = useRef(null); const consumed = useRef(null);
  useLayoutEffect(() => { callbacks.current = { onDraftChange, onGuardChange, onRequestConsumed }; }, [onDraftChange, onGuardChange, onRequestConsumed]);
  const publishDraft = useCallback((clear = false) => {
    const current = clock.current;
    const blocked = !clear && (current.running || !!current.answer.trim() || !!current.revision.trim());
    callbacks.current?.onGuardChange?.({ blocked, reason: blocked ? "Finish or save your current practice before changing activities or questions." : "" });
    const question = current.question;
    callbacks.current?.onDraftChange?.(clear ? null : { question: question?.text || "", originalQuestion: question?.originalQuestion || "", targetAttemptId: current.targetAttemptId || null, text: current.answer, revision: current.revision || "", sourceContextKey: question?.sourceContextKey || "", stageId: question?.stageId || "", questionId: question?.questionId || "", elapsedSeconds: current.running ? Math.max(0, Math.floor((Date.now() - current.started) / 1000)) : current.elapsed || 0 });
  }, []);
  useLayoutEffect(() => {
    const current = clock.current; const onGuard = callbacks.current?.onGuardChange;
    onGuard?.({ blocked: !!current.answer.trim() || !!current.revision.trim(), reason: "Finish or save your current practice before changing activities or questions." });
    const draftSink = callbacks.current?.onDraftChange;
    return () => {
      const last = clock.current;
      if (last.running || last.answer.trim() || last.revision.trim()) draftSink?.({ question: last.question?.text || "", originalQuestion: last.question?.originalQuestion || "", targetAttemptId: last.targetAttemptId || null, text: last.answer, revision: last.revision || "", sourceContextKey: last.question?.sourceContextKey || "", stageId: last.question?.stageId || "", questionId: last.question?.questionId || "", elapsedSeconds: last.running ? Math.max(0, Math.floor((Date.now() - last.started) / 1000)) : last.elapsed || 0 });
      onGuard?.({ blocked: false, reason: "" });
    };
  }, []);
  useEffect(() => {
    if (!practiceRequest || practiceRequest.id === consumed.current) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      consumed.current = practiceRequest.id;
      const current = clock.current;
      if (current.running || current.answer.trim() || current.revision.trim()) { setNotice("Finish or save your current practice before replacing its questions."); callbacks.current?.onRequestConsumed?.(practiceRequest.id, false); return; }
      const bank = practiceRequest.queue.map((item) => ({ ...item, category: item.stageName }));
      if (!bank.length) return;
      clock.current = { ...current, started: Date.now(), running: true, position: 0, answer: "", revision: "", targetAttemptId: null, question: bank[0], elapsed: 0 };
      setQuestions(bank); setPosition(0); setAnswer(""); setRevision(""); setSeconds(0); setRunning(true); setNotice("Practice the exact selected research-informed question. No recording is started.");
      publishDraft(); callbacks.current?.onRequestConsumed?.(practiceRequest.id, true);
    });
    return () => { cancelled = true; };
  }, [practiceRequest, publishDraft]);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - clock.current.started) / 1000))), 250);
    return () => clearInterval(timer);
  }, [running]);
  const start = () => {
    if (clock.current.running || clock.current.answer.trim() || clock.current.revision.trim()) { setNotice("Save or discard the current practice draft before starting general practice."); return; }
    const bank = buildMockQuestions(inputs, artifacts, seed);
    clock.current = { started: Date.now(), running: true, position: 0, answer: "", revision: "", targetAttemptId: null, serial: clock.current.serial, question: bank[0], elapsed: 0 };
    setQuestions(bank); setPosition(0); setAnswer(""); setSeconds(0); setRunning(true); setNotice("Speak aloud, then type or paste your answer. No recording or device access is started.");
    publishDraft();
  };
  const capture = (finish) => {
    if (!clock.current.running && !clock.current.answer.trim()) return;
    const text = clock.current.answer.trim();
    if (text) {
      const currentQuestion = questions[clock.current.position];
      const attempt = { id: `attempt-${Date.now()}-${++clock.current.serial}`, question: currentQuestion.text, category: currentQuestion.category,
        answer: text, seconds: clock.current.running ? Math.max(0, Math.floor((Date.now() - clock.current.started) / 1000)) : clock.current.elapsed || 0, createdAt: new Date().toISOString(), review: null,
        ...(currentQuestion?.sourceContextKey ? { sourceContextKey: currentQuestion.sourceContextKey, stageId: currentQuestion.stageId, questionId: currentQuestion.questionId, originalQuestion: currentQuestion.originalQuestion } : {}) };
      update((workspace) => ({ ...workspace, attempts: [...workspace.attempts, attempt].slice(-60) }));
      setSelectedId(attempt.id); setChecks({}); setRevision("");
    } else if (!finish) { setNotice("Type your answer before advancing, or finish the mock without saving an empty answer."); return; }
    if (finish || clock.current.position >= questions.length - 1) {
      clock.current.running = false; clock.current.answer = ""; clock.current.revision = ""; setAnswer(""); setRunning(false); publishDraft(true); setNotice("Mock finished. Review your saved answers and improve the weakest ones.");
    } else {
      clock.current.position += 1; clock.current.started = Date.now(); clock.current.answer = "";
      clock.current.question = questions[clock.current.position]; publishDraft();
      setPosition(clock.current.position); setAnswer(""); setSeconds(0);
    }
  };
  const selected = selectedId ? attempts.find((attempt) => attempt.id === selectedId) : unknownRevisionTarget ? null : attempts.at(-1);
  const review = () => {
    if (!selected) return;
    const measured = reviewAnswer({ question: selected.question, answer: selected.answer, seconds: selected.seconds, checks: { ...selected.review?.checks, ...checks },
      posting: { title: inputs.jobTitle, company: inputs.company, description: inputs.description }, resume: inputs.resume, coverLetter: inputs.coverLetter });
    update((workspace) => ({ ...workspace, attempts: workspace.attempts.map((attempt) => attempt.id === selected.id ? { ...attempt, review: measured } : attempt) }));
    setNotice("Heuristic typed-text review saved. Add your own five ratings; audio and delivery were not measured.");
  };
  const saveRevision = () => {
    if (!selected || !revision.trim()) { setNotice("The original saved-answer target is unavailable. Your revision is retained; export it or explicitly discard it before choosing another answer."); return; }
    if (attempts.length >= 60) {
      setNotice("History limit reached (60 answers). Your revision draft and all original answers are retained. Export this workspace before starting a new workspace; this revision has not been saved.");
      return;
    }
    const attempt = { ...selected, id: `attempt-${Date.now()}-${++clock.current.serial}`, parentId: selected.id, answer: revision.trim(), seconds: 0, review: null, createdAt: new Date().toISOString() };
    update((workspace) => ({ ...workspace, attempts: [...workspace.attempts, attempt].slice(-60) }));
    setSelectedId(attempt.id); setRevision(""); setChecks({}); setNotice("Revision saved separately. Review it to compare with the retained original.");
    clock.current.revision = ""; clock.current.targetAttemptId = null; setUnknownRevisionTarget(false); publishDraft(!clock.current.running && !clock.current.answer.trim());
  };
  const repairs = rankRepairs(attempts);
  return <div>
    <section className={styles.card}><h4>Grounded {stage === "mock" ? "sample answer" : "repair suggestion"}</h4><p>Uses both current document sources and real tailoring strength. Original typed answers remain untouched; suggested personal claims require review.</p><button disabled={!onBuildGrounded} onClick={() => onBuildGrounded?.(stage === "mock" && questions[position] ? { question: questions[position].text, answer } : selected ? { question: selected.question, answer: selected.answer } : null)}>{stage === "mock" ? "Build grounded sample answer" : "Suggest grounded repair"}</button>{groundedArtifact?.suggestion && <pre>{groundedArtifact.suggestion.text}</pre>}<label className={styles.field}><span>Editable grounded suggestion</span><textarea aria-label="Editable grounded suggestion" rows={5} maxLength={12000} value={groundedArtifact?.draft || ""} onChange={(event) => onGroundedDraft?.(event.target.value)} /></label><p>{context ? `Context ${context.id}; review the current preparation bundle before reviewed acceptance.` : "No linked pair yet; bind sources above. Existing practice remains available."}</p></section>
    {stage === "mock" && <section className={styles.card}>
      <p>Rehearse aloud under the expected {inputs.duration || "unknown"}-minute format. This workbench times each answer; it does not listen or record.</p>
      <label className={styles.field}><span>Question shuffle seed</span><input aria-label="Question shuffle seed" type="number" value={seed} onChange={(event) => setSeed(event.target.value)} disabled={running} /></label>
      <button className={styles.primary} onClick={start} disabled={running}>Start general timed mock</button>
      {running && <><p role="status">Question {position + 1} of {questions.length} · {seconds} seconds</p><h4>{questions[position]?.category}: {questions[position]?.text}</h4>
        <label className={styles.field}><span>Answer transcript</span><textarea aria-label="Answer transcript" rows={7} value={answer} maxLength={20000} onChange={(event) => { clock.current.answer = event.target.value; setAnswer(event.target.value); publishDraft(); }} /></label>
        <div className={styles.actions}><button onClick={() => capture(false)}>Save answer and next question</button><button onClick={() => capture(true)}>Finish mock</button></div></>}
    </section>}
    {!running && answer.trim() && <section className={styles.card}><h4>Restored practice draft — timer stopped</h4><p>{questions[position]?.text}</p><label className={styles.field}><span>Answer transcript</span><textarea aria-label="Answer transcript" rows={7} maxLength={20000} value={answer} onChange={(event) => { clock.current.answer = event.target.value; setAnswer(event.target.value); publishDraft(); }} /></label><p>{seconds} seconds retained; time away was not counted.</p><button onClick={() => capture(true)}>Save restored answer</button></section>}
    {(answer.trim() || revision.trim()) && <div><button onClick={() => setDiscardRequested(true)}>Discard practice draft</button>{discardRequested && <div role="alertdialog" aria-label="Discard unsaved practice draft"><p>Discard only the unsaved transcript and revision? Saved answers remain.</p><button onClick={() => { clock.current.answer = ""; clock.current.revision = ""; clock.current.targetAttemptId = null; setUnknownRevisionTarget(false); clock.current.running = false; setAnswer(""); setRevision(""); setRunning(false); setDiscardRequested(false); publishDraft(true); }}>Confirm discard practice draft</button><button onClick={() => setDiscardRequested(false)}>Keep practice draft</button></div>}</div>}
    {stage === "repair" && <section><h4>Priority repairs</h4>{repairs.length ? repairs.map((entry) => <article className={styles.card} key={entry.id}><strong>{entry.question}</strong><p>{entry.guidance.join(" ")}</p><p>Follow-ups: {entry.followups.join(" ")}</p><button onClick={() => { if (clock.current.running || clock.current.answer.trim() || clock.current.revision.trim()) { setNotice("Save or discard the current practice draft before revising another answer."); return; } setSelectedId(entry.id); setRevision(entry.answer); clock.current.revision = entry.answer; clock.current.targetAttemptId = entry.id; setUnknownRevisionTarget(false); if (!clock.current.running && !clock.current.answer.trim()) clock.current.question = { text: entry.question, originalQuestion: entry.originalQuestion || "", sourceContextKey: entry.sourceContextKey || "", stageId: entry.stageId || "", questionId: entry.questionId || "" }; publishDraft(); setChecks({}); }}>Improve this answer</button></article>) : <p>Review at least one answer to identify repairs. No weakness is invented when no review is available.</p>}</section>}
    {revision.trim() && !selected && <p role="alert">The original saved-answer target is unavailable. Your revision is retained and will not be attached to another answer. Export it before discarding.</p>}
    <section className={styles.card}><h4>Saved answers and review</h4>
      {!attempts.length ? <p>No saved answers yet. Start a timed mock and add an answer.</p> : <>
        <label className={styles.field}><span>Saved answer</span><select aria-label="Saved answer" value={selected?.id || ""} onChange={(event) => { if (clock.current.revision.trim()) { setNotice("Save or explicitly discard your current revision before choosing another answer."); return; } setSelectedId(event.target.value); setUnknownRevisionTarget(false); clock.current.targetAttemptId = event.target.value; setChecks({}); setRevision(""); }}>{attempts.map((attempt, index) => <option key={attempt.id} value={attempt.id}>{index + 1}. {attempt.question.slice(0, 80)}{attempt.parentId ? " (revision)" : ""}</option>)}</select></label>
        <h4>{selected?.question}</h4><pre>{selected?.answer}</pre><p>{selected?.seconds || 0} seconds (timer); this is not a measurement of spoken delivery.</p>
        {selected?.sourceContextKey && <p>Research-informed practice · {selected.stageId} · {selected.questionId}. Original prediction: {selected.originalQuestion}. Source context: {selected.sourceContextKey}. Inspect background research in Interview plan; this is not a confirmed employer question.</p>}
        <div className={styles.grid}>{["directness", "specificity", "ownership", "relevance", "brevity"].map((key) => <label className={styles.field} key={key}><span>Your {key} rating</span><select aria-label={`Your ${key} rating`} value={checks[key] ?? selected?.review?.checks?.[key] ?? ""} onChange={(event) => setChecks((previous) => ({ ...previous, [key]: event.target.value }))}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}{value === 1 ? " — needs work" : value === 5 ? " — strong" : ""}</option>)}</select></label>)}</div>
        <button onClick={review}>Review answer locally</button>
        {selected?.review && <div className={styles.suggestion}><h4>{selected.review.label}</h4><p>{selected.review.heuristic.verdict}</p><p>Score: {selected.review.heuristic.score}/100 (heuristic)</p><ul>{(selected.review.heuristic.improvements || []).map((improvement, index) => <li key={index}>{typeof improvement === "string" ? improvement : improvement?.text || JSON.stringify(improvement)}</li>)}</ul></div>}
        <label className={styles.field}><span>Revision answer</span><textarea aria-label="Revision answer" rows={6} maxLength={20000} disabled={running || !!answer.trim()} value={revision} onChange={(event) => { clock.current.revision = event.target.value; clock.current.targetAttemptId = selected?.id || clock.current.targetAttemptId || null; if (selected) { setUnknownRevisionTarget(false); if (!clock.current.running && !clock.current.answer.trim()) clock.current.question = { text: selected.question, originalQuestion: selected.originalQuestion || "", sourceContextKey: selected.sourceContextKey || "", stageId: selected.stageId || "", questionId: selected.questionId || "" }; } setRevision(event.target.value); publishDraft(); }} /></label><button disabled={!revision.trim()} onClick={saveRevision}>Save revised answer separately</button>
      </>}
    </section>{notice && <p role="status">{notice}</p>}
  </div>;
}
