"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { canonicalJSON } from "@/lib/interviewPreparation/candidateContext";
import { researchSelectionKey, validateInterviewResearchResult } from "@/lib/interviewPreparation/interviewResearch";

export function useInterviewResearch({ posting, engine, userEditIdentity, research, onResearchChange }) {
  const selection = canonicalJSON({ applicationId: posting?.id || "", company: posting?.company || "", title: posting?.title || "", description: posting?.description || "" });
  const [identity, setIdentity] = useState({ selection: "", key: null });
  const [request, setRequest] = useState({ status: "idle", error: "" });
  const [comparison, setComparison] = useState(null);
  const live = useRef(null); const operation = useRef({ serial: 0, busy: false, controller: null, settle: null });
  const selectionKey = identity.selection === selection ? identity.key : null;
  useLayoutEffect(() => { live.current = { posting, engine, userEditIdentity, research, onResearchChange, selectionKey, selection }; }, [posting, engine, userEditIdentity, research, onResearchChange, selectionKey, selection]);
  useEffect(() => {
    let cancelled = false;
    researchSelectionKey(JSON.parse(selection)).then((key) => { if (!cancelled) setIdentity({ selection, key }); }).catch(() => { if (!cancelled) setIdentity({ selection, key: null }); });
    return () => { cancelled = true; };
  }, [selection]);
  useEffect(() => {
    const current = operation.current;
    let active = true;
    Promise.resolve().then(() => { if (active && !current.busy) setRequest({ status: "idle", error: "" }); });
    return () => { active = false; current.serial += 1; current.busy = false; current.controller?.abort(); current.settle?.(new Error("Research context changed.")); current.settle = null; };
  }, [selection, engine]);
  const run = useCallback(async () => {
    const current = live.current; const op = operation.current;
    if (!current?.posting?.id || !current.selectionKey || current.engine !== "gemini" || op.busy) return false;
    const token = ++op.serial; const baseline = current.userEditIdentity; const key = current.selectionKey; const selected = current.selection; const selectedEngine = current.engine;
    const controller = new AbortController(); op.busy = true; op.controller = controller;
    setRequest({ status: "researching", error: "" });
    let rejectDeadline;
    const deadline = new Promise((resolve, reject) => { rejectDeadline = reject; });
    op.settle = rejectDeadline;
    const timeout = setTimeout(() => {
      if (op.serial !== token) return;
      op.serial += 1; op.busy = false; op.controller = null; op.settle = null; controller.abort();
      setRequest({ status: "error", error: "Research timed out after 60 seconds. The server may still finish and incur cost. Your previous plan and edits are retained; retry explicitly." });
      rejectDeadline(new Error("Research timed out."));
    }, 60000);
    try {
      const { response, data } = await Promise.race([(async () => { const response = await fetch("/api/interview-preparation/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId: current.posting.id, engine: current.engine }), signal: controller.signal }); return { response, data: await response.json() }; })(), deadline]);
      if (!response.ok) throw new Error(data.error || `Research request failed (${response.status}).`);
      const result = validateInterviewResearchResult(data.result);
      const latest = live.current;
      if (op.serial !== token || !latest || latest.selection !== selected || latest.engine !== selectedEngine || latest.selectionKey !== key) return false;
      if (result.applicationId !== current.posting.id || result.selectionKey !== key) throw new Error("Application details changed. Reload the application and retry; your current plan is retained.");
      setComparison({ resultContextKey: result.contextKey, editedDuringRequest: latest.userEditIdentity !== baseline, comparisonIdentity: latest.userEditIdentity });
      latest.onResearchChange((previous) => ({ ...previous, pending: result }));
      setRequest({ status: result.status, error: "" }); return true;
    } catch (error) {
      if (op.serial !== token) return false;
      setRequest({ status: controller.signal.aborted ? "cancelled" : "error", error: controller.signal.aborted ? "Research wait stopped. The server may still finish and incur cost. Your previous plan and edits are retained." : error?.message || "Research failed. Your previous plan and edits are retained." }); return false;
    } finally { clearTimeout(timeout); if (op.serial === token) { op.busy = false; op.controller = null; op.settle = null; } }
  }, []);
  const cancel = useCallback(() => {
    const op = operation.current; op.serial += 1; op.busy = false; op.controller?.abort(); op.controller = null;
    op.settle?.(new Error("Research cancelled locally.")); op.settle = null;
    setRequest({ status: "cancelled", error: "Research wait stopped. The server may still finish and incur cost. Your previous plan and edits are retained." });
  }, []);
  const adoptPending = useCallback(({ replaceConfirmed = false } = {}) => {
    const current = live.current; if (!current?.research?.pending || current.research.pending.selectionKey !== current.selectionKey) return false;
    if (Object.keys(current.research.overrides).length && !replaceConfirmed) return false;
    current.onResearchChange((previous) => ({ ...previous, previous: previous.adopted, adopted: previous.pending, pending: null, overrides: {}, selection: null })); setComparison(null); return true;
  }, []);
  const keepCurrent = useCallback(() => { live.current?.onResearchChange((previous) => ({ ...previous, pending: null })); setComparison(null); }, []);
  const pending = research?.pending;
  useEffect(() => {
    if (!pending || comparison?.resultContextKey === pending.contextKey) return;
    Promise.resolve().then(() => setComparison((previous) => previous?.resultContextKey === pending.contextKey ? previous : { resultContextKey: pending.contextKey, editedDuringRequest: false, comparisonIdentity: userEditIdentity }));
  }, [pending, comparison?.resultContextKey, userEditIdentity]);
  const currentComparison = comparison?.resultContextKey === pending?.contextKey ? comparison : null;
  const pendingStale = !!pending && !!currentComparison && (currentComparison.editedDuringRequest || currentComparison.comparisonIdentity !== userEditIdentity);
  return { status: request.status, error: request.error, selectionKey, identityReady: !!selectionKey, stale: !!selectionKey && !!research?.adopted && research.adopted.selectionKey !== selectionKey, pendingStale,
    canResearch: !!posting?.id && !!selectionKey && engine === "gemini" && request.status !== "researching", run, cancel, adoptPending, keepCurrent };
}
