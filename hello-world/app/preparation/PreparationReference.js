"use client";

import { useState } from "react";
import { DraftEditor } from "./PreparationTools";
import styles from "./preparation.module.css";

export default function PreparationReference({ stage, inputs, onInput, artifact, build, accept, keep, onDraft, basis }) {
  const [notice, setNotice] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(artifact?.draft || ""); setNotice("Edited draft copied. Nothing was sent."); }
    catch { setNotice("Clipboard unavailable. Select the edited draft and copy it manually."); }
  };
  const download = () => {
    let url;
    try {
      url = URL.createObjectURL(new Blob([artifact?.draft || ""], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = stage === "reference" ? "interview-reference.txt" : "interview-followup-draft.txt";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setNotice("Edited draft downloaded. Nothing was sent.");
    } catch { setNotice("Download unavailable. Copy the edited draft instead."); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  const print = () => {
    const printStyle = document.createElement("style");
    printStyle.textContent = '@media print { body[data-preparation-print="true"] * { visibility: hidden; } body[data-preparation-print="true"] [data-preparation-reference], body[data-preparation-print="true"] [data-preparation-reference] * { visibility: visible; } }';
    document.head.appendChild(printStyle);
    document.body.dataset.preparationPrint = "true";
    try { window.print(); }
    finally { delete document.body.dataset.preparationPrint; printStyle.remove(); }
  };
  const field = (name, label) => <label key={name} className={styles.field}><span>{label}</span><textarea aria-label={label} rows={3} value={inputs[name]} maxLength={20000} onChange={(event) => onInput(name, event.target.value)} /></label>;
  return <div>
    {stage === "reference" ? <><p>Build a compact reference from your accepted drafts and actual source facts. Review gaps and shorten it to fit your print settings.</p>
      <fieldset className={styles.card}><legend>Call environment</legend><p>Confirm equipment, connection, battery/charger, quiet space, notifications and appointment buffer. This does not test hardware.</p>{field("environment", "Equipment and environment checks completed")}</fieldset>
    </> : <><p>Capture the actual conversation. The thank-you is a private draft for you to review and send separately.</p><div className={styles.grid}>{field("emphasized", "What the interviewer emphasized")}{field("learned", "What you learned")}{field("concerns", "Concerns and unanswered questions")}{field("promises", "What you promised to provide")}{field("nextStep", "Next step")}{field("nextTiming", "Expected next-step timing")}{field("improveNext", "What to improve before the next interview")}</div></>}
    <button className={styles.primary} onClick={build}>Build {stage === "reference" ? "call reference" : "follow-up draft"}</button>
    <DraftEditor stage={stage} artifact={artifact} basis={basis} accept={accept} keep={keep} onDraft={onDraft} />
    <div className={styles.actions}><button disabled={!artifact?.draft} onClick={copy}>Copy edited draft</button><button disabled={!artifact?.draft} onClick={download}>Download edited draft</button>{stage === "reference" && <button disabled={!artifact?.draft} onClick={print}>Print call reference</button>}</div>
    {notice && <p role="status">{notice}</p>}
    {stage === "reference" && <section className={styles.printReference} data-preparation-reference="true" aria-label="Printable call reference"><h3>Call reference</h3><pre>{artifact?.draft || "Accept or write your reference draft first."}</pre></section>}
  </div>;
}
