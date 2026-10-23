"use client";

import { useEffect, useRef, useState } from "react";
import { buildMockQuestions, reviewAnswer, rankRepairs } from "@/lib/interviewPreparation/workbench";
import styles from "./preparation.module.css";

export default function PreparationRehearsal({ stage, inputs, artifacts, attempts, update, context = null, groundedArtifact, onBuildGrounded, onGroundedDraft }) {
  const [questions, setQuestions] = useState([]);
  const [position, setPosition] = useState(0);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [answer, setAnswer] = useState("");
  const [seed, setSeed] = useState("1");
  const [selectedId, setSelectedId] = useState("");
  const [checks, setChecks] = useState({});
  const [revision, setRevision] = useState("");
  const [notice, setNotice] = useState("");
  const clock = useRef({ started: 0, running: false, position: 0, answer: "", serial: 0 });
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - clock.current.started) / 1000))), 250);
    return () => clearInterval(timer);
  }, [running]);
  const start = () => {
    if (clock.current.running) return;
    const bank = buildMockQuestions(inputs, artifacts, seed);
    clock.current = { started: Date.now(), running: true, position: 0, answer: "", serial: clock.current.serial };
    setQuestions(bank); setPosition(0); setAnswer(""); setSeconds(0); setRunning(true); setNotice("Speak aloud, then type or paste your answer. No recording or device access is started.");
  };
  const capture = (finish) => {
    if (!clock.current.running) return;
    const text = clock.current.answer.trim();
    if (text) {
      const currentQuestion = questions[clock.current.position];
      const attempt = { id: `attempt-${Date.now()}-${++clock.current.serial}`, question: currentQuestion.text, category: currentQuestion.category,
        answer: text, seconds: Math.max(0, Math.floor((Date.now() - clock.current.started) / 1000)), createdAt: new Date().toISOString(), review: null };
      update((workspace) => ({ ...workspace, attempts: [...workspace.attempts, attempt].slice(-60) }));
      setSelectedId(attempt.id); setChecks({}); setRevision("");
    } else if (!finish) { setNotice("Type your answer before advancing, or finish the mock without saving an empty answer."); return; }
    if (finish || clock.current.position >= questions.length - 1) {
      clock.current.running = false; setRunning(false); setNotice("Mock finished. Review your saved answers and improve the weakest ones.");
    } else {
      clock.current.position += 1; clock.current.started = Date.now(); clock.current.answer = "";
      setPosition(clock.current.position); setAnswer(""); setSeconds(0);
    }
  };
  const selected = attempts.find((attempt) => attempt.id === selectedId) || attempts.at(-1);
  const review = () => {
    if (!selected) return;
    const measured = reviewAnswer({ question: selected.question, answer: selected.answer, seconds: selected.seconds, checks: { ...selected.review?.checks, ...checks },
      posting: { title: inputs.jobTitle, company: inputs.company, description: inputs.description }, resume: inputs.resume, coverLetter: inputs.coverLetter });
    update((workspace) => ({ ...workspace, attempts: workspace.attempts.map((attempt) => attempt.id === selected.id ? { ...attempt, review: measured } : attempt) }));
    setNotice("Heuristic typed-text review saved. Add your own five ratings; audio and delivery were not measured.");
  };
  const saveRevision = () => {
    if (!selected || !revision.trim()) return;
    if (attempts.length >= 60) {
      setNotice("History limit reached (60 answers). Your revision draft and all original answers are retained. Export this workspace before starting a new workspace; this revision has not been saved.");
      return;
    }
    const attempt = { ...selected, id: `attempt-${Date.now()}-${++clock.current.serial}`, parentId: selected.id, answer: revision.trim(), seconds: 0, review: null, createdAt: new Date().toISOString() };
    update((workspace) => ({ ...workspace, attempts: [...workspace.attempts, attempt].slice(-60) }));
    setSelectedId(attempt.id); setRevision(""); setChecks({}); setNotice("Revision saved separately. Review it to compare with the retained original.");
  };
  const repairs = rankRepairs(attempts);
  return <div>
    <section className={styles.card}><h4>Grounded {stage === "mock" ? "sample answer" : "repair suggestion"}</h4><p>Uses both current document sources and real tailoring strength. Original typed answers remain untouched; suggested personal claims require review.</p><button disabled={!onBuildGrounded} onClick={() => onBuildGrounded?.(stage === "mock" && questions[position] ? { question: questions[position].text, answer } : selected ? { question: selected.question, answer: selected.answer } : null)}>{stage === "mock" ? "Build grounded sample answer" : "Suggest grounded repair"}</button>{groundedArtifact?.suggestion && <pre>{groundedArtifact.suggestion.text}</pre>}<label className={styles.field}><span>Editable grounded suggestion</span><textarea aria-label="Editable grounded suggestion" rows={5} maxLength={12000} value={groundedArtifact?.draft || ""} onChange={(event) => onGroundedDraft?.(event.target.value)} /></label><p>{context ? `Context ${context.id}; review the current preparation bundle before reviewed acceptance.` : "No linked pair yet; bind sources above. Existing practice remains available."}</p></section>
    {stage === "mock" && <section className={styles.card}>
      <p>Rehearse aloud under the expected {inputs.duration || "unknown"}-minute format. This workbench times each answer; it does not listen or record.</p>
      <label className={styles.field}><span>Question shuffle seed</span><input aria-label="Question shuffle seed" type="number" value={seed} onChange={(event) => setSeed(event.target.value)} disabled={running} /></label>
      <button className={styles.primary} onClick={start} disabled={running}>Start timed mock</button>
      {running && <><p role="status">Question {position + 1} of {questions.length} · {seconds} seconds</p><h4>{questions[position]?.category}: {questions[position]?.text}</h4>
        <label className={styles.field}><span>Answer transcript</span><textarea aria-label="Answer transcript" rows={7} value={answer} maxLength={20000} onChange={(event) => { clock.current.answer = event.target.value; setAnswer(event.target.value); }} /></label>
        <div className={styles.actions}><button onClick={() => capture(false)}>Save answer and next question</button><button onClick={() => capture(true)}>Finish mock</button></div></>}
    </section>}
    {stage === "repair" && <section><h4>Priority repairs</h4>{repairs.length ? repairs.map((entry) => <article className={styles.card} key={entry.id}><strong>{entry.question}</strong><p>{entry.guidance.join(" ")}</p><p>Follow-ups: {entry.followups.join(" ")}</p><button onClick={() => { setSelectedId(entry.id); setRevision(entry.answer); setChecks({}); }}>Improve this answer</button></article>) : <p>Review at least one answer to identify repairs. No weakness is invented when no review is available.</p>}</section>}
    <section className={styles.card}><h4>Saved answers and review</h4>
      {!attempts.length ? <p>No saved answers yet. Start a timed mock and add an answer.</p> : <>
        <label className={styles.field}><span>Saved answer</span><select aria-label="Saved answer" value={selected?.id || ""} onChange={(event) => { setSelectedId(event.target.value); setChecks({}); setRevision(""); }}>{attempts.map((attempt, index) => <option key={attempt.id} value={attempt.id}>{index + 1}. {attempt.question.slice(0, 80)}{attempt.parentId ? " (revision)" : ""}</option>)}</select></label>
        <h4>{selected?.question}</h4><pre>{selected?.answer}</pre><p>{selected?.seconds || 0} seconds (timer); this is not a measurement of spoken delivery.</p>
        <div className={styles.grid}>{["directness", "specificity", "ownership", "relevance", "brevity"].map((key) => <label className={styles.field} key={key}><span>Your {key} rating</span><select aria-label={`Your ${key} rating`} value={checks[key] ?? selected?.review?.checks?.[key] ?? ""} onChange={(event) => setChecks((previous) => ({ ...previous, [key]: event.target.value }))}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}{value === 1 ? " — needs work" : value === 5 ? " — strong" : ""}</option>)}</select></label>)}</div>
        <button onClick={review}>Review answer locally</button>
        {selected?.review && <div className={styles.suggestion}><h4>{selected.review.label}</h4><p>{selected.review.heuristic.verdict}</p><p>Score: {selected.review.heuristic.score}/100 (heuristic)</p><ul>{(selected.review.heuristic.improvements || []).map((improvement, index) => <li key={index}>{typeof improvement === "string" ? improvement : improvement?.text || JSON.stringify(improvement)}</li>)}</ul></div>}
        <label className={styles.field}><span>Revision answer</span><textarea aria-label="Revision answer" rows={6} maxLength={20000} value={revision} onChange={(event) => setRevision(event.target.value)} /></label><button disabled={!revision.trim()} onClick={saveRevision}>Save revised answer separately</button>
      </>}
    </section>{notice && <p role="status">{notice}</p>}
  </div>;
}
