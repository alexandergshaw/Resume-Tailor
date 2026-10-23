"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalJSON } from "@/lib/interviewPreparation/candidateContext";
import { createReviewTarget, validateReviewResult, canAcceptReview, reviewStatus } from "@/lib/interviewPreparation/reviewContract";

export function usePreparationReview({ context, bundle, engine, onAttempt }) {
  const key = canonicalJSON({ contextId: context?.id || null, bundle });
  const [targetState, setTargetState] = useState({ key: "", target: null, error: "" });
  const [state, setState] = useState({ status: "unreviewed", error: "", envelope: null, trustedInvocationId: null });
  const [attempts, setAttempts] = useState([]); const [acknowledgedFindingIds, setAcknowledged] = useState([]);
  const operation = useRef({ generation: 0, busy: false, controller: null, count: 0, active: null });
  const publish = useCallback((attempt) => { setAttempts((previous) => previous.some((item) => item.id === attempt.id) ? previous.map((item) => item.id === attempt.id ? attempt : item) : [...previous, attempt]); onAttempt?.(attempt); }, [onAttempt]);
  const finalize = useCallback((status, envelope = null, error = "") => {
    const active = operation.current.active; if (!active || active.finished) return;
    active.finished = true;
    publish({ ...active.record, status, envelope, error, endedAt: new Date().toISOString() });
  }, [publish]);
  useEffect(() => {
    let cancelled = false; operation.current.generation += 1;
    Promise.resolve().then(async () => {
      if (!cancelled) setState((previous) => previous.status === "reviewing" ? { ...previous, status: "stale", trustedInvocationId: null, error: "Review target changed; draft and admitted attempt retained." } : previous);
      if (!context || !bundle.length) { if (!cancelled) setTargetState({ key, target: null, error: "Build and bind current draft/source identities first." }); return; }
      try { const target = await createReviewTarget(context, bundle); if (!cancelled) setTargetState({ key, target, error: "" }); }
      catch (error) { if (!cancelled) setTargetState({ key, target: null, error: error?.message || "Could not bind review target." }); }
    });
    return () => { cancelled = true; finalize("stale", null, "Target changed or workspace closed; response cannot be accepted. Provider work may already have been incurred."); operation.current.generation += 1; operation.current.controller?.abort(); operation.current.busy = false; };
  }, [key, context, bundle, finalize]);
  const target = targetState.key === key ? targetState.target : null;
  const reviewNow = useCallback(async () => {
    if (operation.current.busy || !target || !context) return;
    if (attempts.length >= 12 || operation.current.count >= 3) { setState((previous) => ({ ...previous, status: "failed", error: attempts.length >= 12 ? "Review history is full. Export before resetting this workspace; all twelve admitted attempts are retained." : "Three admitted attempts used. Start a new explicit sequence to retry; history and server limits remain." })); return; }
    operation.current.busy = true; operation.current.count += 1;
    const generation = operation.current.generation; const controller = new AbortController(); operation.current.controller = controller;
    const record = { id: `review-attempt-${Date.now()}-${generation}-${operation.current.count}`, status: "reviewing", at: new Date().toISOString(), endedAt: null, error: "", envelope: null };
    operation.current.active = { finished: false, record }; publish(record);
    setState((previous) => ({ ...previous, status: "reviewing", error: "", trustedInvocationId: null })); setAcknowledged([]);
    try {
      const response = await fetch("/api/interview-preparation", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: "review", engine, sourceMode: context.sourceMode, applicationId: context.applicationId, expectedContextId: context.id, requestedStrength: context.requestedStrength,
          job: context.job, supplements: context.supplements, bundle, ...(context.sourceMode === "manual" ? { manualDocuments: { resume: context.resume.text, cover: context.cover.text } } : {}) }) });
      const data = await response.json(); if (operation.current.generation !== generation) return;
      if (!response.ok || !data.envelope) throw Object.assign(new Error(data.error || "No current independent receipt returned."), { reviewStatus: data.status === "unavailable" ? "unavailable" : data.status === "stale" ? "stale" : "failed", historicalEnvelope: data.historicalEnvelope || null });
      const envelope = data.envelope; const validated = validateReviewResult(envelope.review, { context, bundle });
      if (!validated.ok || envelope.contextId !== target.contextId || envelope.bundleId !== target.bundleId) throw new Error(validated.error || "Review identities do not match exact current bytes.");
      const host = envelope.host;
      const admission = canAcceptReview({ envelope: { ...envelope, review: validated.value }, contextId: target.contextId, bundleId: target.bundleId, trustedInvocationId: host?.invocationId, acknowledgedFindingIds: [] });
      if (["historical-unattested", "unreviewed", "stale"].includes(admission.status)) throw new Error(admission.reason);
      const currentEnvelope = { ...envelope, review: validated.value };
      setState({ status: validated.value.status === "clean" ? "reviewed" : validated.value.status, error: "", envelope: currentEnvelope, trustedInvocationId: host.invocationId });
      finalize("reviewed", currentEnvelope, "");
    } catch (error) {
      if (operation.current.generation !== generation) return;
      const status = error?.name === "AbortError" ? "cancelled" : error.reviewStatus || "failed";
      const historical = error.historicalEnvelope && validateReviewResult(error.historicalEnvelope.review, { context, bundle }).ok ? error.historicalEnvelope : null;
      finalize(status, historical, error?.message || "Review failed; draft retained.");
      setState((previous) => ({ ...previous, status, error: error?.message || "Review failed; draft retained.", trustedInvocationId: null }));
    } finally { if (operation.current.generation === generation) { operation.current.busy = false; operation.current.controller = null; } }
  }, [target, context, bundle, engine, attempts.length, publish, finalize]);
  const cancel = useCallback(() => { finalize("cancelled", null, "User cancelled. Draft retained; provider work may already have been incurred."); operation.current.controller?.abort(); operation.current.generation += 1; operation.current.busy = false; setState((previous) => ({ ...previous, status: "cancelled", trustedInvocationId: null, error: "Review cancelled; the admitted attempt remains in history." })); }, [finalize]);
  const acknowledgeFinding = useCallback((id, checked) => setAcknowledged((previous) => checked ? [...new Set([...previous, id])] : previous.filter((entry) => entry !== id)), []);
  const receiptArgs = { envelope: state.envelope, contextId: target?.contextId || "", bundleId: target?.bundleId || "", trustedInvocationId: state.trustedInvocationId };
  const acceptance = canAcceptReview({ ...receiptArgs, acknowledgedFindingIds });
  const semanticStatus = reviewStatus(receiptArgs);
  const status = ["reviewing", "failed", "unavailable", "cancelled", "stale"].includes(state.status) ? state.status : state.envelope ? semanticStatus : state.status;
  return { status, error: state.error || targetState.error, envelope: state.envelope, attempts, trustedInvocationId: state.trustedInvocationId, reviewNow, cancel, acknowledgeFinding, acknowledgedFindingIds, acceptance,
    resetSequence: () => { if (!operation.current.busy) { operation.current.count = 0; setState((previous) => ({ ...previous, status: "unreviewed", trustedInvocationId: null, error: "New explicit sequence; all old admitted attempts remain and server rate limits still apply." })); } } };
}
