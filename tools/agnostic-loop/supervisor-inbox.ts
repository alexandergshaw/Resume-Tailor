import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyEvent, currentArtifact, equal, requireThat } from './engine';
import { canonical, digest } from './json';
import { safeFile, contained } from './paths';
import { loadJournal, saveJournal } from './dispatch-store';
import { artifactPath } from './workflow';
import { validateWorkerOutcome } from './routing-validation';
import type { LoopStore } from './store';
import type { Context, LoopState, VerificationReport, FinalReport } from './types';
import type { RoutingConfig, LaunchRecord } from './dispatch-types';

export async function commitEvent(store:LoopStore,state:LoopState,id:string,type:string,payload:Record<string,unknown>,context?:Context):Promise<LoopState> {
  const old = state.events.find(e => e.id === id);
  if (old) { requireThat(old.type === type && equal(old.payload,payload),'Acknowledged import step changed'); return state; }
  const next = applyEvent(state,{id,expectedRevision:state.revision,actor:state.policy.owner,type,payload},context ?? await store.context(state));
  await store.save(next); return next;
}
function drift(job:LaunchRecord, context:Context):void {
  const changed = [...new Set([...Object.keys(job.candidate.files),...Object.keys(context.candidate.files)])].filter(p => job.candidate.files[p] !== context.candidate.files[p]);
  requireThat(changed.every(p => job.task.writePaths.includes(p)),`Unowned candidate drift: ${changed.filter(p => !job.task.writePaths.includes(p)).join(', ')}`);
  requireThat(job.candidate.environmentHash === context.candidate.environmentHash && job.candidate.toolHash === context.candidate.toolHash && job.candidate.policyHash === context.candidate.policyHash,'Candidate environment/tool/policy changed');
}
async function writeArtifact(store:LoopStore,state:LoopState,job:LaunchRecord,id:string,content:string,config:RoutingConfig):Promise<LoopState> {
  const version = Number(id.slice(id.lastIndexOf(':v')+2)); requireThat(Number.isSafeInteger(version) && version > 0,'artifact version invalid');
  const relative = artifactPath(config,job.item,job.task.kind,version), filename = path.resolve(state.policy.workspace,relative);
  requireThat(contained(state.policy.workspace,filename) && job.task.writePaths.includes(relative),'artifact output outside exact assignment ownership');
  await mkdir(path.dirname(filename),{recursive:true});
  // Existing parents are checked before writing so an alias cannot escape the workspace.
  await safeFile(state.policy.workspace,path.relative(state.policy.workspace,path.dirname(filename)).split(path.sep).join('/'));
  const existing = state.artifacts[id];
  if (existing) { requireThat(existing.hash === digest(content),'Repeated imported artifact changed'); currentArtifact(state,id,await store.context(state),false); return state; }
  try { await writeFile(filename,content,{flag:'wx'}); }
  catch(error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await readFile(await safeFile(state.policy.workspace,relative),'utf8')) !== content) throw error; }
  const bytes = await readFile(await safeFile(state.policy.workspace,relative)); requireThat(bytes.toString('utf8') === content,'artifact bytes changed during write'); await store.blob(bytes);
  const assignment = state.assignments[job.assignment];
  const artifact = {id,activity:job.task.activity,version,hash:digest(bytes),path:relative,author:assignment.worker,inputs:Object.keys(assignment.inputs)};
  const context = await store.context(state); context.artifacts[id] = artifact;
  return commitEvent(store,state,`${job.id}:artifact:${id}`,'artifact.submit',{assignment:assignment.id,artifact,publicationToken:job.publicationToken},context);
}
export async function importJob(store:LoopStore,config:RoutingConfig,id:string):Promise<void> {
  await store.locked(async()=>{
    let state = await store.load(); const journal = await loadJournal(store,config), job = journal.jobs[id]; requireThat(job,'unknown inbox job');
    requireThat((job.status === 'terminated' || job.status === 'imported') && job.resultHash,'Inbox requires observed termination and bound result');
    const bytes = await readFile(job.inboxPath); requireThat(digest(bytes) === job.resultHash,'Immutable inbox integrity mismatch');
    const outcome = validateWorkerOutcome(JSON.parse(bytes.toString('utf8')));
    requireThat(outcome.job === job.id && outcome.assignment === job.assignment && outcome.publicationToken === job.publicationToken && outcome.packetHash === job.packetHash && equal(outcome.worker,job.worker) && equal(outcome.inputHashes,job.inputHashes) && outcome.candidateDigest === job.candidate.digest,'Inbox launch/identity/input/candidate binding mismatch');
    if (job.status === 'imported') return;
    const assignment = state.assignments[job.assignment];
    requireThat(assignment && (assignment.status === 'running' || assignment.status === 'finished') && assignment.publicationToken === job.publicationToken,'Inbox publication authority fenced');
    const context = await store.context(state); drift(job,context);
    for (const [input,hash] of Object.entries(job.inputHashes)) requireThat(currentArtifact(state,input,context).hash === hash,'Inbox accepted input changed');
    requireThat(outcome.status === 'completed','Worker failed or needs owner; no completion invented');
    const task = job.task;
    if (task.purpose === 'review') {
      requireThat(outcome.review && outcome.artifacts.length === 0 && outcome.proposal === null && outcome.criterionEvidence === null,'Checker outcome contract invalid');
      const reviewed = state.artifacts[outcome.review!.artifact]; requireThat(reviewed?.activity === task.activity,'Checker review target wrong activity');
      state = await commitEvent(store,state,`${job.id}:review`,'review.record',{assignment:assignment.id,...outcome.review});
    } else if (task.purpose === 'transcription') {
      const decision = Object.values(state.decisions).find(d => d.activity === task.activity && !d.verified); requireThat(decision,'Transcription decision missing');
      requireThat(outcome.review?.verdict === 'clean' && outcome.review.hash === decision!.patch.expectedHash,'Transcription fidelity not attested');
      const c = await store.context(state); c.approvedPatches = {[decision!.id]:decision!.patch};
      // IO recomputes the exact patch before exposing the trusted attestation.
      const {applyApprovedPatch} = await import('./observed');
      const original = await store.verifiedBlob(path.join(store.directory,'blobs',decision!.originalHash),decision!.originalHash);
      const result = await store.verifiedBlob(path.join(store.directory,'blobs',decision!.patch.expectedHash),decision!.patch.expectedHash);
      requireThat(applyApprovedPatch(original,decision!.patch).equals(result),'Transcription bytes outside owner patch');
      state = await commitEvent(store,state,`${job.id}:transcription`,'transcription.verify',{assignment:assignment.id,decision:decision!.id,hash:decision!.patch.expectedHash,pass:true,semanticFidelity:true},c);
    } else if (task.kind === 'verification' || task.kind === 'final-report') {
      requireThat(outcome.artifacts.length === 0 && outcome.proposal === null,'Worker cannot author engine-owned report metadata');
      const artifactId = task.artifactIds[0]; requireThat(artifactId,'report deliverable missing');
      const c = await store.context(state);
      if (task.kind === 'verification') {
        requireThat(outcome.criterionEvidence,'Verifier criterion mapping missing');
        const report:VerificationReport = {candidate:c.candidate,worker:job.worker,criteria:outcome.criterionEvidence!,limitations:outcome.limitations};
        state = await writeArtifact(store,state,job,artifactId,canonical(report),config);
        const observed = await store.context(state); observed.verificationReports = {[artifactId]:JSON.parse((await store.verifiedBlob(path.join(store.directory,'blobs',state.artifacts[artifactId].hash),state.artifacts[artifactId].hash)).toString('utf8'))};
        state = await commitEvent(store,state,`${job.id}:report`,'verification.record',{assignment:assignment.id,artifact:artifactId,report},observed);
      } else {
        const accepted = (kind:string) => Object.values(state.artifacts).find(a => state.activities[a.activity].item === job.item && state.activities[a.activity].kind === kind && a.acceptedHash === a.hash);
        const verification = accepted('verification'), whole = accepted('whole-change-review'); requireThat(verification && whole,'Final report accepted inputs missing');
        const regressionEvidence = Object.values(state.evidence).filter(e => e.assignment === assignment.id && e.exitCode === 0 && equal(e.candidate,c.candidate)).map(e => e.id);
        const report:FinalReport = {candidate:c.candidate,verificationArtifact:verification!.id,regressionEvidence,wholeChangeReviewArtifact:whole!.id,residuals:outcome.residuals,delivery:'local'};
        state = await writeArtifact(store,state,job,artifactId,canonical(report),config);
        const observed = await store.context(state); observed.finalReports = {[artifactId]:JSON.parse((await store.verifiedBlob(path.join(store.directory,'blobs',state.artifacts[artifactId].hash),state.artifacts[artifactId].hash)).toString('utf8'))};
        state = await commitEvent(store,state,`${job.id}:report`,'final.record',{assignment:assignment.id,artifact:artifactId,report},observed);
      }
    } else {
      requireThat(outcome.artifacts.length === task.artifactIds.length && task.artifactIds.every(id => outcome.artifacts.some(a => a.id === id)),'Required artifact deliverables missing or extra');
      requireThat(outcome.review === null && outcome.criterionEvidence === null,'Author cannot submit review/evidence claims');
      if (['scope','criteria','plan'].includes(task.kind)) requireThat(outcome.proposal && canonical(outcome.proposal) === canonical(JSON.parse(outcome.artifacts[0].content)),'Proposal must equal actual authored JSON artifact');
      else requireThat(outcome.proposal === null,'Unexpected structured proposal');
      for (const artifact of outcome.artifacts) { const expected = artifactPath(config,job.item,task.kind,Number(artifact.id.slice(artifact.id.lastIndexOf(':v')+2))); requireThat(artifact.path === expected,'Worker artifact path outside declared slot'); state = await writeArtifact(store,state,job,artifact.id,artifact.content,config); }
    }
    state = await commitEvent(store,state,`${job.id}:finish`,'assignment.finish',{assignment:assignment.id});
    job.importedEvents = state.events.filter(e => e.id.startsWith(`${job.id}:`)).map(e => e.id); job.status = 'imported';
    await saveJournal(store,journal);
  });
}
