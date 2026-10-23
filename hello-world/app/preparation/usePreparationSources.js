"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApplicationDocs } from "@/app/copilot/useApplicationDocs";
import { useCompanyBrief } from "@/app/copilot/useCompanyBrief";
import { createCandidateContext } from "@/lib/interviewPreparation/candidateContext";

const DEFAULT_STRENGTH = Object.freeze({ aggressiveness: 3, tailorMode: "" });
const EMPTY_SUPPLEMENTS = Object.freeze([]);
export function usePreparationSources(posting, inputRevision = 0, manualInputs = {}, strength = DEFAULT_STRENGTH, supplements = EMPTY_SUPPLEMENTS) {
  const applicationId = posting?.id || null;
  const docs = useApplicationDocs(applicationId);
  const brief = useCompanyBrief(posting || (manualInputs.company ? { id: "manual", company: manualInputs.company, title: manualInputs.jobTitle, description: manualInputs.description } : null));
  const [packState, setPackState] = useState({ forId: null, status: "idle", pack: null, completeSections: [], error: "" });
  const [researchBasis, setResearchBasis] = useState(null);
  const [snapshotState, setSnapshotState] = useState({ forId: null, snapshot: null, error: "" });
  const [manualEnabled, setManualEnabled] = useState(false);
  const [contextState, setContextState] = useState({ key: "", context: null, error: "" });
  const generation = useRef(0); const sourceGeneration = useRef(0); const alive = useRef(true); const researchBusy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; sourceGeneration.current += 1; }; }, []);
  useEffect(() => { if (brief.status !== "loading") researchBusy.current = false; }, [brief.status]);
  const loadPack = useCallback(async () => {
    const token = ++generation.current; if (!applicationId) return;
    setPackState({ forId: applicationId, status: "loading", pack: null, completeSections: [], error: "" });
    try {
      const response = await fetch(`/api/interview-prep?applicationId=${encodeURIComponent(applicationId)}`); const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Could not load existing prep.");
      if (alive.current && generation.current === token) setPackState({ forId: applicationId, status: data.status || "absent", pack: data.pack || null, completeSections: Array.isArray(data.completeSections) ? data.completeSections : [], error: "" });
    } catch (error) { if (alive.current && generation.current === token) setPackState({ forId: applicationId, status: "error", pack: null, completeSections: [], error: error?.message || "Could not load historical prep." }); }
  }, [applicationId]);
  const reloadContext = useCallback(async () => {
    const token = ++sourceGeneration.current; if (!applicationId) return;
    setSnapshotState({ forId: applicationId, snapshot: null, error: "" });
    try {
      const response = await fetch(`/api/interview-preparation?applicationId=${encodeURIComponent(applicationId)}`); const data = await response.json();
      if (!response.ok || !data.snapshot) throw new Error(data.error || "Could not load the exact application document pair.");
      if (alive.current && sourceGeneration.current === token) setSnapshotState({ forId: applicationId, snapshot: data.snapshot, error: "" });
    } catch (error) { if (alive.current && sourceGeneration.current === token) setSnapshotState({ forId: applicationId, snapshot: null, error: error?.message || "Candidate sources failed. Reload to retry." }); }
  }, [applicationId]);
  useEffect(() => { let cancelled = false; Promise.resolve().then(() => { if (!cancelled && applicationId) { loadPack(); reloadContext(); } }); return () => { cancelled = true; generation.current += 1; sourceGeneration.current += 1; }; }, [applicationId, loadPack, reloadContext]);
  const sourceKey = JSON.stringify({ applicationId, accountId: manualInputs.accountId || "guest", strength, supplements,
    resume: manualInputs.resume || "", cover: manualInputs.coverLetter || "", description: manualInputs.description || "", title: manualInputs.jobTitle || "", company: manualInputs.company || "", manualEnabled: manualEnabled || !!manualInputs.manualSourceEnabled,
    snapshot: snapshotState.forId === applicationId ? snapshotState.snapshot : null });
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      let snapshot = applicationId && snapshotState.forId === applicationId ? snapshotState.snapshot : null;
      if (!applicationId && (manualEnabled || manualInputs.manualSourceEnabled)) {
        const document = (kind, value) => ({ kind, state: value?.trim() ? "ready" : "missing", origin: "manual-user-supplied", documentId: null, contentIdentity: null, text: value || "", createdAt: null, error: null });
        snapshot = { accountId: manualInputs.accountId || "guest", applicationId: null, mode: "manual", status: "ready", resume: document("resume", manualInputs.resume), cover: document("cover", manualInputs.coverLetter), observedAt: new Date().toISOString(), consistency: "manual-captured", historicalStrength: { resume: null, cover: null } };
      }
      if (!snapshot) { if (!cancelled) setContextState({ key: sourceKey, context: null, error: applicationId ? snapshotState.error || "Loading exact selected document versions…" : "Use supplied resume and cover to create an explicitly user-supplied context." }); return; }
      try {
        const context = await createCandidateContext({ snapshot, job: { title: manualInputs.jobTitle || posting?.title || "", company: manualInputs.company || posting?.company || "", description: manualInputs.description || posting?.description || "" }, requestedStrength: strength, supplements });
        if (!cancelled) setContextState({ key: sourceKey, context, error: "" });
      } catch (error) { if (!cancelled) setContextState({ key: sourceKey, context: null, error: error?.message || "Candidate context could not be bound." }); }
    });
    return () => { cancelled = true; };
  }, [sourceKey, applicationId, manualEnabled, manualInputs.accountId, manualInputs.resume, manualInputs.coverLetter, manualInputs.jobTitle, manualInputs.company, manualInputs.description, manualInputs.manualSourceEnabled, posting?.title, posting?.company, posting?.description, snapshotState, strength, supplements]);
  const research = useCallback(() => { if (researchBusy.current) return; researchBusy.current = true; setResearchBasis({ forId: applicationId, revision: inputRevision }); brief.refresh(); }, [applicationId, inputRevision, brief]);
  const pack = packState.forId === applicationId ? packState : { forId: applicationId, status: applicationId ? "loading" : "idle", pack: null, completeSections: [], error: "" };
  const researchResult = brief.status === "done" && researchBasis?.forId === applicationId ? { articles: brief.articles, revision: researchBasis.revision, stale: researchBasis.revision !== inputRevision } : null;
  const effectiveContext = contextState.key === sourceKey ? contextState : { context: null, error: "Candidate context changed; binding current source identities…" };
  const generatePrep = useCallback(async () => ({ status: "unavailable", error: "Legacy prep generation does not carry this context and strength. Build linked preparation here instead." }), []);
  return { docs, brief, pack, generating: false, loadPack, generatePrep, research, researchResult, candidateContext: effectiveContext.context,
    contextStatus: effectiveContext.context ? effectiveContext.context.missing.length ? "partial" : "ready" : "unlinked", contextError: effectiveContext.error,
    reloadContext, useManualDocuments: () => setManualEnabled(true) };
}
