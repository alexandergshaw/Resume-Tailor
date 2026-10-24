"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STAGES, buildTool } from "@/lib/interviewPreparation/workbench";
import { contextStrength, canonicalJSON, sha256 } from "@/lib/interviewPreparation/candidateContext";
import { loadWorkspace, saveWorkspace } from "@/lib/interviewPreparation/workspaceStore";
import { useEngine } from "@/app/settings/engine";
import PreparationTools from "./PreparationTools";
import PreparationRehearsal from "./PreparationRehearsal";
import PreparationReference from "./PreparationReference";
import PreparationReview from "./PreparationReview";
import PreparationNavigation from "./PreparationNavigation";
import PreparationOverview from "./PreparationOverview";
import { useInterviewResearch } from "./useInterviewResearch";
import { createResearchState, createPracticeQueue } from "@/lib/interviewPreparation/interviewResearch";
import { usePreparationWorkspace } from "./usePreparationWorkspace";
import { usePreparationSources } from "./usePreparationSources";
import { usePreparationReview } from "./usePreparationReview";
import styles from "./preparation.module.css";

const EMPTY = Object.freeze([]);
const EMPTY_RESEARCH = createResearchState();
export default function PreparationWorkspace({ userId, posting = null, onOpenExisting, aggressiveness = 3, tailorMode = "", onChangeStrength }) {
  const store = usePreparationWorkspace(userId, posting?.id); const workspace = store.workspace;
  const { engine } = useEngine();
  const strength = useMemo(() => ({ aggressiveness, tailorMode }), [aggressiveness, tailorMode]);
  const supplements = workspace?.candidate?.supplements || EMPTY;
  const manualInputs = useMemo(() => ({ ...(workspace?.inputs || {}), accountId: userId || "guest", manualSourceEnabled: workspace?.candidate?.sourceMode === "manual" }), [workspace?.inputs, workspace?.candidate?.sourceMode, userId]);
  const generationInputs = canonicalJSON({ inputs: workspace?.inputs || null, sources: workspace?.sources || null });
  const [dependencyState, setDependencyState] = useState({ key: "", id: null });
  useEffect(() => { let cancelled = false; sha256(generationInputs).then((hash) => { if (!cancelled) setDependencyState({ key: generationInputs, id: `sha256:${hash}` }); }).catch(() => { if (!cancelled) setDependencyState({ key: generationInputs, id: null }); }); return () => { cancelled = true; }; }, [generationInputs]);
  const dependencyId = dependencyState.key === generationInputs ? dependencyState.id : null;
  const sources = usePreparationSources(posting, generationInputs, manualInputs, strength, supplements); const context = sources.candidateContext;
  const [stage, setStage] = useState("plan"); const [notice, setNotice] = useState(""); const [resetRequested, setResetRequested] = useState(false);
  const [practiceRequest, setPracticeRequest] = useState(null); const [practiceBlocked, setPracticeBlocked] = useState(false);
  const practiceGuard = useRef({ blocked: false, reason: "" }); const practiceSerial = useRef(0);
  const research = workspace?.research || EMPTY_RESEARCH;
  const userEditIdentity = canonicalJSON({ inputs: workspace?.inputs || null, artifacts: workspace?.artifacts || null, attempts: workspace?.attempts || [], candidate: workspace?.candidate || null, sources: workspace?.sources || null, reviewHistory: workspace?.reviewHistory || [], reviewAttempts: workspace?.reviewAttempts || [], practiceQueue: workspace?.practiceQueue || [], rehearsalDraft: workspace?.rehearsalDraft || null, researchOverrides: research.overrides, researchSelection: research.selection });
  const onResearchChange = useCallback((change) => store.update((previous) => ({ ...previous, research: change(previous.research) })), [store.update]);
  const interviewResearch = useInterviewResearch({ posting, engine, userEditIdentity, research, onResearchChange });
  const onPracticeGuard = useCallback((guard) => { practiceGuard.current = guard; setPracticeBlocked(guard.blocked); }, []);
  const onRehearsalDraft = useCallback((draft) => store.update((previous) => ({ ...previous, rehearsalDraft: draft })), [store.update]);
  const onPracticeConsumed = useCallback(() => setPracticeRequest(null), []);
  const activeId = stage === "mock" ? "sample" : stage === "repair" ? "repairSuggestion" : stage;
  const bundle = useMemo(() => !dependencyId ? [] : Object.entries(workspace?.artifacts || {}).filter(([, item]) => (item.suggestion?.text || item.draft || "").trim()).map(([id, item]) => {
    const text = item.suggestion?.text || item.draft;
    return { id, kind: item.suggestion?.draftKind || id, version: item.version || 1, text, generatedContextId: item.contextId || null, planningInputs: { dateTime: workspace.inputs.dateTime, timezone: workspace.inputs.timezone, connection: workspace.inputs.connection, biography: workspace.inputs.biography, facts: workspace.inputs.facts, emphasized: workspace.inputs.emphasized, learned: workspace.inputs.learned, promises: workspace.inputs.promises, nextStep: workspace.inputs.nextStep, nextTiming: workspace.inputs.nextTiming }, generationDependencies: dependencyId, generatedFrom: item.generationDependencies || null, claimEvidence: (item.suggestion?.claimEvidence || item.claimEvidence || []).filter((claim) => text.slice(claim.start, claim.end) === claim.quote && claim.evidenceIds.every((evidenceId) => context?.evidence.some((entry) => entry.id === evidenceId))) };
  }), [workspace?.artifacts, context, dependencyId]);
  const auditAttempt = useCallback((attempt) => {
    const merge = (previous) => {
      const combined = [...new Map([...(previous.reviewAttempts || []), attempt].map((item) => [item.id || item.envelope?.host?.invocationId || `${item.at}:${item.status}`, item])).values()];
      if (combined.length > 12) return previous;
      return { ...previous, reviewAttempts: combined, reviewHistory: combined.filter((item) => item.envelope).map((item) => item.envelope) };
    };
    if (store.update(merge) !== false) return;
    try { const loaded = loadWorkspace(window.localStorage, store.key); if (!loaded.error) saveWorkspace(window.localStorage, store.key, merge(loaded.workspace)); } catch { /* Existing saved admission remains; storage failure cannot be relabeled a completed audit. */ }
  }, [store.update, store.key]);
  const reviewState = usePreparationReview({ context, bundle, engine, onAttempt: auditAttempt }); const persistedAttempts = useRef("");
  useEffect(() => {
    const serialized = JSON.stringify(reviewState.attempts); if (!store.ready || !reviewState.attempts.length || serialized === persistedAttempts.current) return;
    persistedAttempts.current = serialized;
    Promise.resolve().then(() => store.update((previous) => {
      const combined = [...new Map([...(previous.reviewAttempts || []), ...reviewState.attempts].map((attempt) => [attempt.id || attempt.envelope?.host?.invocationId || `${attempt.at}:${attempt.status}`, attempt])).values()];
      if (combined.length > 12) return previous;
      return { ...previous, reviewAttempts: combined, reviewHistory: combined.filter((attempt) => attempt.envelope).map((attempt) => attempt.envelope) };
    }));
  }, [reviewState.attempts, store.ready, store.update]);
  if (!store.ready) return <p role="status">{"Loading this browser's preparation workspace…"}</p>;
  const { inputs, artifacts, attempts } = workspace; const artifact = artifacts[activeId]; const basis = `${context?.id || "unlinked"}|${dependencyId || "pending-input-identity"}`;
  const onInput = (name, value) => store.update((previous) => ({ ...previous, inputs: { ...previous.inputs, [name]: value } }));
  const updateArtifact = (id, action, recordHistory = true) => store.update((previous) => {
    const before = previous.artifacts[id] || { draft: "", suggestion: null, acceptedBasis: "", version: 1, contextId: null, claimEvidence: [], history: [] };
    if (recordHistory && before.history?.length >= 12) { setNotice("Draft version history is full. Export this workspace; the original and proposed edits are retained without another overwrite."); return previous; }
    const next = action(before);
    const oldText = before.suggestion?.text || before.draft;
    const history = recordHistory && oldText ? [...(before.history || []), { version: before.version || 1, text: oldText, contextId: before.contextId || null, claimEvidence: before.suggestion?.claimEvidence || before.claimEvidence || [] }] : before.history || [];
    return { ...previous, artifacts: { ...previous.artifacts, [id]: { ...next, history } } };
  });
  const build = (id = activeId, originalAnswer = null) => {
    try { const suggestion = { ...buildTool(id, inputs, originalAnswer ? { ...workspace.sources, originalAnswer } : workspace.sources, artifacts, context), basis, dependencyId }; updateArtifact(id, (previous) => ({ ...previous, suggestion, version: (previous.version || 0) + 1, contextId: context?.id || null, generationDependencies: dependencyId })); setNotice("Linked suggestion built locally where sources are available. Save/edit remains available; reviewed acceptance requires independent semantic review."); }
    catch (error) { setNotice(`Could not build: ${error?.message || "unknown error"}. Your current draft is retained.`); }
  };
  const buildAll = () => {
    try { store.update((previous) => {
      const seeded = { ...previous.inputs, jobTitle: previous.inputs.jobTitle || posting?.title || "", company: previous.inputs.company || posting?.company || "", description: previous.inputs.description || posting?.description || "", resume: previous.inputs.resume || sources.docs.resume || "", coverLetter: previous.inputs.coverLetter || sources.docs.coverLetter || "" };
      const next = { ...previous.artifacts };
      for (const entry of STAGES.filter((value) => !["mock", "repair"].includes(value.id))) {
        const before = previous.artifacts[entry.id] || { draft: "", acceptedBasis: "", history: [], claimEvidence: [] };
        if (before.history?.length >= 12) throw new Error("A draft history is full; export before creating more versions");
        const oldText = before.suggestion?.text || before.draft;
        next[entry.id] = { ...before, suggestion: { ...buildTool(entry.id, seeded, previous.sources, previous.artifacts, context), basis, dependencyId }, generationDependencies: dependencyId, version: (before.version || 0) + 1, contextId: context?.id || null,
          history: oldText ? [...(before.history || []), { version: before.version || 1, text: oldText, contextId: before.contextId || null, claimEvidence: before.suggestion?.claimEvidence || before.claimEvidence || [] }] : before.history || [] };
      }
      return { ...previous, artifacts: next };
    }); setNotice("Ten suggestions built. Sources and exact context are shown below; unlinked material stays unreviewed. Review the current bundle before reviewed acceptance."); }
    catch (error) { setNotice(`Preparation not rebuilt: ${error?.message || "unknown error"}. Previous drafts retained.`); }
  };
  const saveUnreviewed = () => updateArtifact(activeId, (previous) => previous.suggestion ? { ...previous, draft: previous.suggestion.text, claimEvidence: previous.suggestion.claimEvidence || [], contextId: previous.suggestion.contextId || null, acceptedBasis: previous.suggestion.basis, committedDraft: previous.suggestion.text, generationDependencies: dependencyId, suggestion: null, reviewAcceptance: "unreviewed" } : previous, false);
  const acceptReviewed = () => {
    if (!reviewState.acceptance.allowed || !context || !dependencyId || bundle.some((draft) => draft.generatedFrom !== dependencyId || draft.generatedContextId !== context?.id)) return;
    updateArtifact(activeId, (previous) => ({ ...previous, draft: previous.suggestion?.text || previous.draft, claimEvidence: previous.suggestion?.claimEvidence || previous.claimEvidence || [], suggestion: null,
      contextId: context.id, acceptedBasis: basis, committedDraft: previous.suggestion?.text || previous.draft, generationDependencies: dependencyId, reviewAcceptance: reviewState.acceptance.status, reviewedInvocation: reviewState.trustedInvocationId }), false);
    setNotice("Current reviewed suggestion accepted. No issues found is not guaranteed truth; later edits or source/strength changes make this receipt stale.");
  };
  const onDraft = (draft) => updateArtifact(activeId, (previous) => ({ ...previous, committedDraft: previous.committedDraft ?? previous.draft, draft, suggestion: null, claimEvidence: [], contextId: context?.id || null, acceptedBasis: basis, generationDependencies: dependencyId, version: (previous.version || 0) + 1, reviewAcceptance: "unreviewed" }), false);
  const keep = () => updateArtifact(activeId, (previous) => ({ ...previous, suggestion: null }), false);
  const download = (text, name, type = "application/json") => { let url; try { url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setNotice("Workspace data downloaded. Keep it private."); } catch (error) { setNotice(`Download failed: ${error?.message || "unavailable"}. Edits retained.`); } finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); } };
  const exportAll = () => { try { download(store.exportWorkspace(), "interview-preparation-workspace.json"); } catch (error) { setNotice(`Export failed: ${error?.message}. Edits retained.`); } };
  const common = { stage, inputs, onInput, artifact, build: () => build(activeId), accept: saveUnreviewed, keep, onDraft, basis };
  const completed = Object.values(artifacts).filter((value) => value.draft?.trim()).length;
  const hasStaleInputs = !dependencyId || bundle.some((draft) => draft.generatedFrom !== dependencyId || draft.generatedContextId !== context?.id);
  const scopedReview = { ...reviewState, status: hasStaleInputs ? "stale" : reviewState.status, acceptance: hasStaleInputs ? { allowed: false, status: "stale", reason: "Source inputs changed. Rebuild affected preparation or edit the retained draft explicitly before reviewing again." } : reviewState.acceptance, reviewNow: () => { if (hasStaleInputs) { setNotice("Draft inputs are stale. Rebuild preparation or explicitly edit the retained draft, then review."); return; } if ((workspace.reviewAttempts || []).length >= 12) setNotice("Saved review history is full. Export/reset this workspace before making another review call; all existing findings are retained."); else reviewState.reviewNow(); } };
  const persistedPracticeBlocked = !!workspace.rehearsalDraft && (!!workspace.rehearsalDraft.text.trim() || !!workspace.rehearsalDraft.revision.trim());
  const practiceReserved = practiceBlocked || persistedPracticeBlocked;
  const requestDestination = (id) => {
    if (practiceGuard.current.blocked || (persistedPracticeBlocked && id !== "mock")) { setNotice(practiceGuard.current.reason || "Resume unfinished practice, then save or explicitly discard its draft before changing activities."); return false; }
    setStage(id); requestAnimationFrame(() => document.getElementById("active-preparation-tool")?.focus()); return true;
  };
  const practice = (selection) => {
    if (practiceGuard.current.blocked || persistedPracticeBlocked) { setNotice(practiceGuard.current.reason || "Resume unfinished practice before replacing its questions."); return; }
    if (!interviewResearch.identityReady) { setNotice("Checking the selected application context. Try again when it is ready."); return; }
    if (interviewResearch.stale) { setNotice("This research belongs to earlier application details; research the current role first."); return; }
    try {
      const queue = createPracticeQueue(research.adopted, research.overrides, selection);
      store.update((previous) => ({ ...previous, practiceQueue: queue }));
      setPracticeRequest({ id: `practice-${++practiceSerial.current}`, queue }); setStage("mock");
      requestAnimationFrame(() => document.getElementById("active-preparation-tool")?.focus());
    } catch (error) { setNotice(error?.message || "Choose a researched question first."); }
  };
  const planStatus = interviewResearch.status === "researching" ? "Researching" : research.adopted ? interviewResearch.stale ? "Earlier application details" : research.adopted.status === "ready" ? "Research ready" : "Insufficient evidence" : "Not researched";
  const guardedResearch = { ...interviewResearch, adoptPending: (options) => {
    if (practiceGuard.current.blocked || persistedPracticeBlocked) { setNotice("Resume unfinished practice, then save or explicitly discard its draft before replacing the plan."); return false; }
    return interviewResearch.adoptPending(options);
  } };
  return <div className={styles.workbench}>
    <div className={styles.overview}><div><h3>{posting?.label || "Manual interview preparation"}</h3><p>{completed} written drafts · {attempts.length} saved answers. Counts describe saved work, not readiness.</p></div><div className={styles.actions}><button onClick={buildAll} title="Build local suggestions from existing materials; this does not research the web.">Build preparation</button><button onClick={exportAll}>Export workspace</button><small>Build preparation creates local drafts; research starts in Interview plan.</small></div></div>
    <div className={styles.storageBar}><p className={styles.localNote}>Browser-local account/application notes, no device syncing. Local drafting is unreviewed until a distinct semantic review succeeds. <a className={styles.skipTool} href="#active-preparation-tool">Skip to active tool</a></p>
    <div role="status" aria-live="polite" className={store.error ? styles.warning : styles.saved}>{store.corrupt ? `Saved data is corrupt: ${store.error}. Original bytes retained until confirmed reset.` : store.readFailure ? `Saved data could not be read: ${store.error}. Retry loading; current edits retained.` : store.recovered ? store.error : store.unsaved ? `Unsaved: ${store.error}. Current edits retained; retry or export.` : "Saved in this browser."}</div></div>
    {store.readFailure && <button onClick={store.retryRead}>Retry loading saved workspace</button>}{!store.corrupt && !store.readFailure && !store.recovered && store.unsaved && <button onClick={store.retrySave}>Retry saving</button>}
    {store.recovered && <section role="alertdialog" aria-label="Choose recovered workspace"><p>Saved and current edits are retained until you choose. Export current edits first if both are wanted.</p><button onClick={() => store.chooseRecovered(true)}>Replace current edits with recovered saved workspace</button><button onClick={() => store.chooseRecovered(false)}>Keep current edits and replace saved workspace</button></section>}
    {store.corrupt && store.recoveryText && <button onClick={() => download(store.recoveryText, "original-saved-data.txt", "text/plain")}>Download original saved data</button>}
    <div className={styles.contextBar}><div className={styles.contextStatus}><p role="status">Source context: {sources.contextStatus}. {sources.contextError}</p><p>Current requested strength: {context ? contextStrength(context).label : tailorMode === "ideal" ? "Ideal (separate mode)" : `Level ${aggressiveness} of 5`}. Historical document-generation strength: unknown.</p>{context?.conflicts.map((conflict) => <p role="alert" key={conflict.id}>{conflict.reason} — {conflict.evidenceIds.join(", ")}</p>)}</div>
    <details className={styles.setupDisclosure}><summary><span>Documents and shared tailoring strength</span></summary><section className={styles.card} aria-label="Shared candidate context"><h4>Documents and shared tailoring strength</h4><button disabled={!onChangeStrength} onClick={onChangeStrength}>Change tailoring strength in Materials</button>
      {!posting && <><label className={styles.field}><span>Supplied resume for manual context</span><textarea aria-label="Supplied resume for manual context" rows={4} maxLength={20000} value={inputs.resume} onChange={(event) => onInput("resume", event.target.value)} /></label><label className={styles.field}><span>Supplied cover letter for manual context</span><textarea aria-label="Supplied cover letter for manual context" rows={4} maxLength={20000} value={inputs.coverLetter} onChange={(event) => onInput("coverLetter", event.target.value)} /></label><button onClick={() => { store.update((previous) => ({ ...previous, candidate: { ...previous.candidate, sourceMode: "manual" } })); sources.useManualDocuments(); }}>Use supplied resume and cover</button><p>User-supplied documents are not database-generated versions and their claims are not independently verified.</p></>}
      {posting && <button onClick={sources.reloadContext}>Reload selected document versions</button>}
      {context && <><p>Mode: {context.sourceMode}. Observation: {context.observedAt || "unknown"}. Ideal hypothetical study text is excluded.</p>{[context.resume, context.cover].map((document) => <p key={document.kind}>{document.kind}: {document.state} · {document.origin} · version {document.documentId || "missing"} · content {document.contentIdentity || "unknown"}</p>)}{context.conflicts.map((conflict) => <p role="alert" key={conflict.id}>{conflict.reason} — {conflict.evidenceIds.join(", ")}</p>)}<details><summary>Inspect candidate evidence ({context.evidence.length})</summary>{context.evidence.map((entry) => <blockquote key={entry.id}><strong>{entry.sourceKind}: {entry.id}</strong><p>{entry.quote}</p></blockquote>)}</details></>}
      <h4>Supplemental experience — confirmation required</h4>{supplements.map((fact, index) => <div key={index}><label className={styles.field}><span>Supplemental experience {index + 1}</span><textarea aria-label={`Supplemental experience ${index + 1}`} maxLength={1000} value={fact.text} onChange={(event) => store.update((previous) => ({ ...previous, candidate: { ...previous.candidate, supplements: previous.candidate.supplements.map((item, i) => i === index ? { ...item, text: event.target.value, confirmed: false } : item) } }))} /></label><label><input type="checkbox" checked={fact.confirmed} onChange={(event) => store.update((previous) => ({ ...previous, candidate: { ...previous.candidate, supplements: previous.candidate.supplements.map((item, i) => i === index ? { ...item, confirmed: event.target.checked } : item) } }))} /> I confirm this is my real experience; it remains user supplied</label></div>)}<button disabled={supplements.length >= 12} onClick={() => store.update((previous) => ({ ...previous, candidate: { ...previous.candidate, supplements: [...previous.candidate.supplements, { text: "", confirmed: false }] } }))}>Add supplemental experience</button>
    </section></details></div>
    {notice && <p role="status">{notice}</p>}
    <div className={styles.layout}><PreparationNavigation stage={stage} stages={STAGES} artifacts={artifacts} attempts={attempts} onSelect={requestDestination} planStatus={planStatus} />
      <section className={styles.panel} aria-label="Active preparation tool"><div className={styles.toolHeading}><h3 id="active-preparation-tool" tabIndex={-1}>{stage === "plan" ? "Interview plan" : STAGES.find((entry) => entry.id === stage)?.label}</h3>{stage !== "plan" && <button onClick={() => requestDestination("plan")}>Back to interview plan</button>}</div>{stage === "plan" ? <PreparationOverview posting={posting} engine={engine} research={research} state={guardedResearch} onOverride={(questionId, text) => onResearchChange((previous) => ({ ...previous, overrides: { ...previous.overrides, [questionId]: text } }))} onSelectStage={(id) => onResearchChange((previous) => ({ ...previous, selection: id }))} onPractice={practice} onOpenTool={requestDestination} practiceBlocked={practiceReserved} /> : ["mock", "repair"].includes(stage) ? <PreparationRehearsal stage={stage} inputs={inputs} artifacts={artifacts} attempts={attempts} update={store.update} context={context} groundedArtifact={artifact} onBuildGrounded={(originalAnswer) => build(activeId, originalAnswer)} onGroundedDraft={onDraft} practiceRequest={practiceRequest} rehearsalDraft={workspace.rehearsalDraft} onDraftChange={onRehearsalDraft} onGuardChange={onPracticeGuard} onRequestConsumed={onPracticeConsumed} /> : ["reference", "followup"].includes(stage) ? <PreparationReference {...common} /> : <PreparationTools {...common} sources={sources} workspaceSources={workspace.sources} update={store.update} onOpenExisting={posting ? onOpenExisting : null} />}</section></div>
    <div className={styles.reviewStatus}><strong>Independent review · {scopedReview.status}</strong><p role="status">Review status: {scopedReview.status}. {scopedReview.error} {scopedReview.acceptance.reason}</p></div>
    <details className={styles.reviewDisclosure}><summary><span>Review and accept preparation</span><small>Explicit provider call · may incur cost · acceptance is gated</small></summary><PreparationReview context={context} bundle={bundle} engine={engine} reviewState={scopedReview} onAccept={acceptReviewed} onRevise={() => setNotice("Edit your active draft below its tool, rebuild if needed, and request a fresh review. Original answers and earlier findings remain retained.")} /></details>
    {(workspace.reviewHistory || []).length > 0 && <details><summary>Saved historical reviews — not current-session receipts</summary><pre>{JSON.stringify(workspace.reviewHistory, null, 2)}</pre></details>}
    {artifact?.history?.length > 0 && <details><summary>Before/after draft versions ({artifact.history.length})</summary>{artifact.history.map((version, index) => <pre key={index}>{version.text}</pre>)}</details>}
    <div className={styles.footer}><button onClick={() => setResetRequested(true)}>Reset this workspace</button>{resetRequested && <div role="alertdialog" aria-label="Confirm workspace reset"><p>{"Remove only this account/application's browser-local preparation? Export first to retain it."}</p><button onClick={() => { store.reset(); setResetRequested(false); setNotice("This workspace reset. Other workspaces retained."); }}>Confirm reset this workspace</button><button onClick={() => setResetRequested(false)}>Cancel reset</button></div>}</div>
  </div>;
}
