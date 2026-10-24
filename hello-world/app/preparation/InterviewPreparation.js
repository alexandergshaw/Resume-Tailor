"use client";

import { useEffect, useState } from "react";
import PostingPicker from "@/app/copilot/PostingPicker";
import PreparationWorkspace from "./PreparationWorkspace";
import styles from "./preparation.module.css";

function AccountPreparation({ userId, onOpenExisting, aggressiveness, tailorMode, onChangeStrength }) {
  const [posting, setPosting] = useState(null);
  const [selection, setSelection] = useState(null);
  const [error, setError] = useState("");
  const selectionKey = `interview-preparation-selection:v1:${encodeURIComponent(userId || "guest")}`;
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const value = window.localStorage.getItem(selectionKey);
        setSelection(typeof value === "string" && value.length < 2000 ? value : "");
      } catch (failure) { setSelection(""); setError(`Selection could not be restored: ${failure?.message || "browser storage unavailable"}. Manual preparation is available.`); }
    });
    return () => { cancelled = true; };
  }, [selectionKey]);
  const choose = (value) => {
    setPosting(value);
    try { window.localStorage.setItem(selectionKey, value?.id || ""); setError(""); }
    catch (failure) { setError(`Selection is not saved: ${failure?.message || "browser storage unavailable"}. Your current workspace remains available.`); }
  };
  return <div className={styles.root}>
    <header className={styles.pageHeader}><div><h2>Interview Preparation</h2><p>Know the role. Shape your answers. Walk in prepared.</p></div><span className={styles.pageTag}>Your interview workbench</span></header>
    <div className={styles.picker}><PostingPicker key={selection === null ? "loading" : "ready"} value={posting} onChange={choose} label="Prepare for an application" blankHint="Leave blank to prepare from manually supplied materials." initialId={selection} disabled={selection === null || !userId} /><p>Newest tracked application per role/company, or use manual materials.</p></div>
    {!userId && <p>Signed out: a separate guest workspace is used. Account notes are not copied here.</p>}
    {error && <p role="status">{error}</p>}
    {selection === null ? <p role="status">Restoring your preparation selection…</p> : <PreparationWorkspace key={`${userId || "guest"}:${posting?.id || "manual"}`} userId={userId} posting={posting} aggressiveness={aggressiveness} tailorMode={tailorMode} onChangeStrength={onChangeStrength} onOpenExisting={posting && onOpenExisting ? (kind) => onOpenExisting(posting.id, kind) : undefined} />}
  </div>;
}

export default function InterviewPreparation({ userId = null, onOpenExisting, aggressiveness = 3, tailorMode = "", onChangeStrength }) {
  return <AccountPreparation key={userId || "guest"} userId={userId} onOpenExisting={onOpenExisting} aggressiveness={aggressiveness} tailorMode={tailorMode} onChangeStrength={onChangeStrength} />;
}
