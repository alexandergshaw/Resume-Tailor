import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, mkdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from './json';
import { equal, currentArtifact, requireThat } from './engine';
import { buildInvocation, normalizeResult, outcomeSchema, probeProvider } from './providers';
import { routeModel } from './routing';
import { loadJournal, saveJournal, atomicJson, configHash } from './dispatch-store';
import { acceptedBodies, actionKey, failedGateForRepair } from './workflow';
import { nextActions } from './next-actions';
import { commitEvent } from './supervisor-inbox';
import { runGate } from './runner';
import { safeFile } from './paths';
import type { LoopStore } from './store';
import type { CapturedProcess, LaunchRecord, BacklogSelection, RoutingConfig, TaskSpec, NormalizedResult } from './dispatch-types';
import type { Artifact, Candidate, LoopState, Operation } from './types';
import type { DispatchJournal } from './dispatch-types';

class RetryableExecution extends Error {}
class PausedAdmission extends RetryableExecution {}
class FailedGateExecution extends RetryableExecution {}
const artifactMetadata=(artifact:Artifact):Artifact=>({id:artifact.id,activity:artifact.activity,version:artifact.version,hash:artifact.hash,path:artifact.path,author:artifact.author,inputs:artifact.inputs});
const candidateBinding=(candidate:Candidate,paths:string[]):Candidate=>({...candidate,files:Object.fromEntries(paths.filter(p=>candidate.files[p]!==undefined).map(p=>[p,candidate.files[p]]))});

export function redact(text:string,config:RoutingConfig):string {
  let result = text;
  for (const key of new Set(config.providers.flatMap(p => p.environmentKeys))) { if(['PATH','HOME','USERPROFILE','TEMP','TMP','SYSTEMROOT','COMSPEC','NODE_ENV','LANG','LOCALAPPDATA','APPDATA'].includes(key.toUpperCase()))continue; const value = process.env[key]; if (value) { const escaped=JSON.stringify(value).slice(1,-1),doubleEscaped=JSON.stringify(escaped).slice(1,-1); for(const representation of [...new Set([value,escaped,doubleEscaped])].sort((a,b)=>b.length-a.length))result=result.split(representation).join('[redacted]'); } }
  return result;
}
async function priorFailureDiagnostics(store:LoopStore,state:LoopState,journal:DispatchJournal,task:TaskSpec,config:RoutingConfig) {
  const evidence=failedGateForRepair(state,journal,task);
  if(!evidence)return [];
  const output=redact((await store.verifiedBlob(evidence.outputPath,evidence.outputHash)).toString('utf8'),config);
  const bytes=Buffer.from(output,'utf8');let end=Math.min(bytes.length,32768);
  while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
  return [{evidenceId:evidence.id,gate:evidence.gate,assignment:evidence.assignment,exitCode:evidence.exitCode,candidateDigest:evidence.candidate.digest,outputHash:evidence.outputHash,excerpt:bytes.subarray(0,end).toString('utf8'),truncated:bytes.length>end,limitation:bytes.length>end?'Prior failed-gate output truncated to 32768 UTF-8 bytes':'Verified prior failed-gate output'}];
}
function monitor(child:ChildProcess,limit:number,timeout:number,store:LoopStore,assignment:string,config:RoutingConfig):Promise<CapturedProcess> {
  const hasAuthority = store.createAssignmentMonitor(assignment);
  const started = Date.now(); let stdout = '', stderr = '', bytes = 0, uncertain = false, done = false;
  return new Promise(resolve=>{
    const stop = ()=>{ uncertain = true; child.kill(); };
    const finish = (exitCode:number|null,terminated:boolean)=>{
      if (done) return; done = true; clearTimeout(timer); clearTimeout(cutoff); clearInterval(watcher);
      resolve({exitCode,stdout:redact(stdout,config),stderr:redact(stderr,config),terminated:terminated && !uncertain,started,finished:Date.now()});
    };
    const collect = (chunk:Buffer,isError:boolean)=>{bytes += chunk.length; if (bytes > limit) {stop();return;} if (isError) stderr += chunk.toString('utf8'); else stdout += chunk.toString('utf8');};
    child.stdout?.on('data',chunk=>collect(chunk,false)); child.stderr?.on('data',chunk=>collect(chunk,true));
    child.once('error',()=>finish(null,false)); child.once('close',code=>finish(code,true));
    const timer = setTimeout(stop,timeout);
    const cutoff = setTimeout(()=>{stop();child.stdout?.destroy();child.stderr?.destroy();child.unref();finish(null,false);},timeout+1000);
    let reading = false;
    const watcher = setInterval(async()=>{ if(reading||done)return;reading=true;try{if(!await hasAuthority())stop();}catch{stop();}finally{reading=false;}},100);
  });
}
export async function launchTask(store:LoopStore,config:RoutingConfig,selection:BacklogSelection,task:TaskSpec):Promise<string> {
  const id = `job-${randomUUID()}`, assignmentId = `${id}:assignment`, operationId = `${id}:operation`;
  const publicationToken = `${id}:assignment.start`, packetPath = path.join(store.directory,'dispatch-packets',`${id}.json`), inboxPath = path.join(store.directory,'dispatch-inbox',`${id}.json`);
  let job!:LaunchRecord;
  await store.locked(async()=>{
    let state = await store.load(); const journal = await loadJournal(store,config), context = await store.context(state);
    const actions = nextActions(state,journal,{candidate:context.candidate,now:context.now,selection,config,acceptedBodies:await acceptedBodies(store,state)});
    requireThat(actions.some(a => a.kind === 'dispatch' && equal(a.task,task)),'Dispatch action changed before locked admission');
    const authors = state.activities[task.activity].authors;
    for(const provider of config.providers.filter(p=>p.enabled))journal.probes[provider.id]=await probeProvider(provider);
    const inputContents=await Promise.all(Object.keys(task.acceptedInputs).map(async input=>({artifact:artifactMetadata(state.artifacts[input]),content:(await store.verifiedBlob(path.join(store.directory,'blobs',state.artifacts[input].hash),state.artifacts[input].hash)).toString('utf8')})));
    const priorFailures=await priorFailureDiagnostics(store,state,journal,task,config);
    const estimatedInputTokens=Buffer.byteLength(canonical({task,item:state.items[task.item],activity:state.activities[task.activity],inputs:inputContents,priorFailures,candidate:candidateBinding(context.candidate,task.affectedPaths),grant:config.grant}), 'utf8')*2+4096;
    const routed = routeModel(config,Object.values(journal.probes),journal,{role:task.role,profile:config.roleProfiles[task.role],estimatedInputTokens,reservedOutputTokens:4000,requireWrites:task.writePaths.some(p => !p.startsWith(`${config.grant.artifactDirectory}/`)),authors,now:Date.now()});
    if (!routed.choice) { journal.checkpoints[selection.id] = `No qualified target: ${canonical(routed.rejected)}`; await saveJournal(store,journal); throw new Error(journal.checkpoints[selection.id]); }
    const route = routed.choice;
    requireThat(journal.probes[route.provider.id].executableHash === route.qualification.executableHash && digest(await readFile(route.qualification.evidencePath)) === route.qualification.evidenceHash,'Provider executable/qualification evidence changed');
    const worker = {instance:`${id}:worker`,context:`${id}:context`,provider:route.provider.id,model:route.target.model,settings:{...route.provider.settings,...route.target.settings},tools:task.writePaths.length ? ['read-files','write-owned-files'] : ['read-files']};
    job = {id,actionKey:actionKey(task,config),item:task.item,assignment:assignmentId,operation:operationId,worker,route,task,packetPath,packetHash:'0'.repeat(64),inboxPath,candidate:context.candidate,inputHashes:task.acceptedInputs,publicationToken,status:'prepared',pid:null,observed:{provider:null,model:null,settings:null,session:null,source:'unavailable'},usage:{source:'unavailable',inputTokens:null,outputTokens:null,costMicroUsd:null},reservedMicroUsd:route.reservedMicroUsd,outputHash:null,resultHash:null,rejection:null,created:context.now,finished:null,importedEvents:[]};
    journal.jobs[id] = job; journal.reservationsMicroUsd += route.reservedMicroUsd ?? 0; await saveJournal(store,journal);
    context.artifactAllocation = {directory:config.grant.artifactDirectory,paths:task.writePaths.filter(p=>p.startsWith(`${config.grant.artifactDirectory}/`)),configHash:configHash(config)};
    const allowedActions = state.policy.allowedActions.filter(action=>['read','write','review','run','import'].includes(action));
    state = await commitEvent(store,state,publicationToken,'assignment.start',{id:assignmentId,item:task.item,activity:task.activity,role:task.role,worker,inputs:task.acceptedInputs,writePaths:task.writePaths,affectedPaths:task.affectedPaths,resources:task.resources,allowedActions,deadline:Math.min(state.policy.deadline,config.budget.deadline,context.now+route.provider.timeoutMs+30_000),deliverables:task.artifactIds},context);
    await saveJournal(store,journal);
  });
  try {
    if(!task.kind.startsWith('implementation-wave:'))for (const gate of task.gateNames) { const evidence = await runGate(store,assignmentId,gate,config.grant.owner); if(evidence.exitCode===null)throw new Error(`Gate ${gate} has unknown exit; owner reconciliation required`); if(evidence.exitCode!==0)throw new FailedGateExecution(`Gate ${gate} failed; preserve activity rounds during repair`); }
    let completion!:Promise<CapturedProcess>;
    await store.locked(async()=>{
      let state=await store.load();const journal=await loadJournal(store,config);job=journal.jobs[id];const context=await store.context(state);
      if(state.runStatus==='paused')throw new PausedAdmission('Pre-spawn pause won admission; no provider process launched');
      requireThat(state.runStatus === 'running' && context.now < config.budget.deadline && context.now < state.policy.deadline && job.route.qualification.expires > context.now,'Launch cancelled or budget/qualification expired');
      requireThat(state.assignments[assignmentId]?.status === 'running' && state.assignments[assignmentId].publicationToken === publicationToken,'Launch assignment fenced');
      requireThat(!Object.values(journal.jobs).some(j=>j.id!==id&&['prepared','pending','running','unknown'].includes(j.status)),'Other launch retains workspace');
      for(const [input,hash] of Object.entries(task.acceptedInputs))requireThat(currentArtifact(state,input,context).hash === hash,'Launch input stale');
      const refreshed=await probeProvider(job.route.provider);requireThat(refreshed.availability==='available'&&refreshed.executableHash===job.route.qualification.executableHash&&refreshed.adapterVersion===job.route.qualification.adapterVersion,'Launch executable/prefix/version changed');
      job.candidate=context.candidate;
      const target=Object.values(state.artifacts).filter(a=>a.activity===task.activity).sort((a,b)=>b.version-a.version)[0];
      const reviewTarget=target?{artifact:artifactMetadata(target),content:(await store.verifiedBlob(path.join(store.directory,'blobs',target.hash),target.hash)).toString('utf8')}:null;
      const boundedCandidate=candidateBinding(context.candidate,state.items[task.item].affectedPaths);
      const boundedAssignment={...state.assignments[assignmentId],baseline:candidateBinding(state.assignments[assignmentId].baseline,task.affectedPaths)};
      const priorFailures=await priorFailureDiagnostics(store,state,journal,task,config);
      const packet={schemaVersion:1,job:id,assignment:boundedAssignment,task,item:state.items[task.item],activity:state.activities[task.activity],reviewTarget,grant:config.grant,inputs:Object.keys(task.acceptedInputs).map(input=>({artifact:artifactMetadata(state.artifacts[input]),content:''})),candidate:boundedCandidate,evidence:Object.values(state.evidence).filter(e=>e.assignment===assignmentId).map(e=>({...e,candidate:candidateBinding(e.candidate,state.items[task.item].affectedPaths)})),priorFailures,decisions:Object.values(state.decisions).filter(d=>d.activity===task.activity),budget:config.budget,limitations:['Cooperative worker; no OS sandbox; recursive delegation unsupported','Candidate file manifest is limited to relevant paths; full manifest remains controller-owned','Context admission uses serialized UTF-8 byte upper bounds plus fixed protocol/output allowances, not provider token telemetry']};
      for(const input of packet.inputs)input.content=(await store.verifiedBlob(path.join(store.directory,'blobs',input.artifact.hash),input.artifact.hash)).toString('utf8');
      job.packetHash=digest(canonical(packet));await atomicJson(packetPath,packet);
      const nativePath=path.join(store.directory,'dispatch-native',`${id}.json`);await mkdir(path.dirname(nativePath),{recursive:true});
      if(job.route.provider.kind==='codex')await atomicJson(`${nativePath}.schema.json`,outcomeSchema);
      const invocation=buildInvocation({provider:job.route.provider,target:job.route.target,worker:job.worker,packet,packetHash:job.packetHash,job:id,assignment:assignmentId,publicationToken,resultPath:nativePath,workspace:state.policy.workspace,nativeCostCapMicroUsd:config.budget.mode==='provider-enforced'?job.reservedMicroUsd:null});
      requireThat(Buffer.byteLength(invocation.stdin,'utf8')+4000<=job.route.target.maxContextTokens,'Actual complete packet exceeds conservative byte-based context admission');
      const operation:Operation={id:operationId,assignment:assignmentId,resource:task.resources[0],status:'pending',publicationToken,pid:null,reconciled:false};context.operations={[operationId]:operation};
      job.status='pending';await saveJournal(store,journal);state=await commitEvent(store,state,`${id}:operation.start`,'operation.start',{operation},context);
      const child=spawn(invocation.executable,invocation.args,{cwd:invocation.cwd,env:invocation.environment,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
      completion=monitor(child,invocation.maxOutputBytes,Math.min(invocation.timeoutMs,config.budget.deadline-context.now,state.policy.deadline-context.now),store,assignmentId,config);
      child.stdin?.on('error',()=>{});child.stdin?.end(invocation.stdin);
      if(!child.pid)throw new Error('Spawn outcome uncertain before handle registration');
      const running={...operation,status:'running' as const,pid:child.pid};const observed=await store.context(state);observed.operations={[operationId]:running};
      state=await commitEvent(store,state,`${id}:operation.running`,'operation.running',{operation:running},observed);job.pid=child.pid;job.status='running';await saveJournal(store,journal);
    });
    const captured=await completion;
    await store.locked(async()=>{
      let state=await store.load();const journal=await loadJournal(store,config);job=journal.jobs[id];const nativePath=path.join(store.directory,'dispatch-native',`${id}.json`);
      let resultBytes:string|null=null;
      try{const metadata=await lstat(nativePath);requireThat(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.size<=job.route.provider.maxOutputBytes,'Native result file unsafe or exceeds bounded output');resultBytes=await readFile(await safeFile(store.directory,path.relative(store.directory,nativePath).split(path.sep).join('/')),'utf8');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      finally{try{await unlink(nativePath);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
      const credentialMaterial=resultBytes!==null&&redact(resultBytes,config)!==resultBytes;
      const normalized:NormalizedResult=normalizeResult(job.route.provider,captured,resultBytes===null?null:redact(resultBytes,config));
      job.observed=normalized.observed;job.usage=normalized.usage;job.finished=captured.finished;
      const log=await store.blob(Buffer.from(canonical(captured)));job.outputHash=log.hash;
      const operation=state.operations[operationId];requireThat(operation,'Persisted process operation missing');const terminated={...operation,status:captured.terminated?'terminated' as const:'unknown' as const,reconciled:captured.terminated};
      const context=await store.context(state);context.operations={[operationId]:terminated};state=await commitEvent(store,state,`${id}:operation.exit`,captured.terminated?'operation.finish':'operation.unknown',{operation:terminated},context);
      job.status=captured.terminated&&task.kind.startsWith('implementation-wave:')&&task.gateNames.length?'running':captured.terminated?'terminated':'unknown';
      if(normalized.usage.costMicroUsd!==null){journal.reservationsMicroUsd-=job.reservedMicroUsd??0;journal.spentMicroUsd+=normalized.usage.costMicroUsd;}else if(!journal.unavailableUsageJobs.includes(id))journal.unavailableUsageJobs.push(id);
      await saveJournal(store,journal);
      if(!captured.terminated){job.rejection='Uncertain process/descendant termination; owner reconciliation required';journal.checkpoints[job.item]=job.rejection;}
      else {
        requireThat(!credentialMaterial,'Worker result contains credential material; publication rejected');
        if(captured.exitCode!==0)throw new RetryableExecution(`Provider execution failed: ${normalized.errors.join('; ')}`);
        requireThat(normalized.outcome&&normalized.errors.length===0,`Provider result failed: ${normalized.errors.join('; ')}`);
        requireThat(normalized.observed.model===null||normalized.observed.model===job.route.target.model,'Observed model mismatch');
        requireThat(normalized.observed.provider===null||normalized.observed.provider===job.route.provider.id,'Observed provider mismatch');
        requireThat(!config.profiles[job.route.profile].requireObservedModel||normalized.observed.model!==null,'Required observed identity unavailable');
        requireThat(normalized.observed.settings===null||equal(normalized.observed.settings,job.worker.settings),'Observed settings mismatch');
        requireThat(normalized.observed.session===null||!Object.values(journal.jobs).some(previous=>previous.id!==job.id&&previous.observed.session===normalized.observed.session&&previous.route.provider.id===job.route.provider.id),'Provider reused an observed session rather than fresh context');
        await atomicJson(job.inboxPath,normalized.outcome);job.resultHash=digest(await readFile(job.inboxPath));
      }
      await saveJournal(store,journal);
    });
    if(task.kind.startsWith('implementation-wave:'))for(const gate of task.gateNames){const evidence=await runGate(store,assignmentId,gate,config.grant.owner);if(evidence.exitCode===null)throw new Error(`Gate ${gate} has unknown exit; owner reconciliation required`);if(evidence.exitCode!==0)throw new FailedGateExecution(`Gate ${gate} failed after implementation; repair same activity without resetting reviews`);}
    if(task.kind.startsWith('implementation-wave:')&&task.gateNames.length)await store.locked(async()=>{const journal=await loadJournal(store,config);if(journal.jobs[id].status==='running')journal.jobs[id].status='terminated';await saveJournal(store,journal);});
    return id;
  } catch(error) {
    await store.locked(async()=>{
      let state=await store.load();const journal=await loadJournal(store,config), failed=journal.jobs[id];if(!failed)return;
      failed.rejection=redact(error instanceof Error?error.message:'Launch failed',config);journal.checkpoints[task.item]=failed.rejection;
      const operation=state.operations[operationId];
      if(operation&&operation.status!=='terminated'){const unknown={...operation,status:'unknown' as const,reconciled:false};const context=await store.context(state);context.operations={[operationId]:unknown};state=await commitEvent(store,state,`${id}:operation.uncertain`,'operation.unknown',{operation:unknown},context);failed.status='unknown';}
      else {failed.status='rejected';if(state.assignments[assignmentId]?.status==='running')state=await commitEvent(store,state,`${id}:cancel`,'assignment.cancel',{assignment:assignmentId,reason:failed.rejection});
        if(error instanceof RetryableExecution&&state.assignments[assignmentId]&&Object.values(state.operations).filter(o=>o.assignment===assignmentId).every(o=>o.status==='terminated'&&o.reconciled)){
          const context=await store.context(state);const changed=[...new Set([...Object.keys(failed.candidate.files),...Object.keys(context.candidate.files)])].filter(p=>failed.candidate.files[p]!==context.candidate.files[p]);
          if(changed.every(p=>task.writePaths.includes(p))&&context.candidate.environmentHash===failed.candidate.environmentHash&&context.candidate.toolHash===failed.candidate.toolHash){
            state=await commitEvent(store,state,`${id}:retry-reconcile`,'assignment.reconcile',{assignment:assignmentId,resolution:'Observed command termination; owned-path diff checked; retry keeps activity/review budget'});
            let canRepair=true;
            if(error instanceof FailedGateExecution&&(task.kind==='verification'||task.kind==='final-report')){
              const waves=Object.values(state.artifacts).filter(a=>state.activities[a.activity].item===task.item&&state.activities[a.activity].kind.startsWith('implementation-wave:')&&a.acceptedHash===a.hash);
              canRepair=waves.length>0;
              for(const wave of waves)state=await commitEvent(store,state,`${id}:gate-invalidate:${wave.id}`,'artifact.invalidate',{artifact:wave.id,reason:'Current execution gate failed; conservatively repair checked implementation inputs without resetting substantive budgets'});
            }
            if(canRepair)failed.rejection=`retryable-execution:${failed.rejection}`;else failed.rejection=`Execution failure has no accepted owned implementation wave; owner must supply bounded repair scope: ${failed.rejection}`;
            journal.checkpoints[task.item]=failed.rejection;
          }
        }
      }
      await saveJournal(store,journal);
    });
    throw error;
  }
}
