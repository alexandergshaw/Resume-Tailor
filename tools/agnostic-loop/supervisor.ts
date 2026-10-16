import path from 'node:path';
import { requireThat } from './engine';
import { canonical } from './json';
import { validateRoutingConfig, validateJournal } from './routing';
import { validateBacklogSelection } from './routing-validation';
import { probeProvider } from './providers';
import { loadJournal, saveJournal, emptyJournal, atomicJson, configHash } from './dispatch-store';
import { acceptedBodies, verifySelection } from './workflow';
import { nextActions } from './next-actions';
import { commitEvent, importJob } from './supervisor-inbox';
import { launchTask, redact } from './supervisor-process';
import type { Context, Operation } from './types';
import type { BacklogSelection, DispatchStatus, ConfigureDispatchFunction, DriveFunction, DispatchStatusFunction, ControlDispatchFunction, RecoverDispatchFunction, ImportInboxFunction, RoutingConfig } from './dispatch-types';
import type { LoopStore } from './store';

export const configureDispatch:ConfigureDispatchFunction = async(store,raw)=>{
  const config=validateRoutingConfig(raw), probes=await Promise.all(config.providers.map(probeProvider));
  return store.locked(async()=>{
    const state=await store.load();requireThat(config.grant.owner===state.policy.owner,'Dispatch owner delegation does not match loop owner');
    requireThat(config.grant.gateNames.every(g=>Object.hasOwn(state.policy.gates,g)),'Dispatch grant names unregistered gates');
    requireThat(state.policy.candidateExclusions.includes(config.grant.artifactDirectory),'Generated artifact directory must be explicitly excluded from candidate');
    try{return await loadJournal(store,config);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const journal=emptyJournal(config);for(const probe of probes)journal.probes[probe.provider]=probe;
    await atomicJson(path.join(store.directory,'dispatch-config.json'),config);await saveJournal(store,journal);return validateJournal(journal);
  });
};
async function statusFor(store:LoopStore,config:RoutingConfig,selection?:BacklogSelection):Promise<DispatchStatus>{
  const state=await store.load(),journal=await loadJournal(store,config),context=await store.context(state);
  const actions=selection?nextActions(state,journal,{candidate:context.candidate,now:context.now,selection,config,acceptedBodies:await acceptedBodies(store,state)}):[];
  return {runStatus:state.runStatus,revision:state.revision,journalRevision:journal.revision,candidate:context.candidate,actions,jobs:Object.values(journal.jobs),checkpoints:journal.checkpoints,limitations:['Cooperative same-user workers; no OS sandbox','Canonical writer and read-only work are fully serialized','Recursive provider delegation is unsupported; tool restrictions are cooperative unless adapter enforces them','Installed/version probe is not a live model qualification','Estimated reservations are not hard billing limits; unavailable usage remains reserved']};
}
export const dispatchStatus:DispatchStatusFunction = async(store,raw,selection)=>statusFor(store,validateRoutingConfig(raw),selection&&validateBacklogSelection(selection));
export const controlDispatch:ControlDispatchFunction = async(store,raw,action,reason)=>{
  const config=validateRoutingConfig(raw);requireThat(['pause','resume','cancel'].includes(action)&&typeof reason==='string'&&reason.trim(),'Invalid run control');
  await store.locked(async()=>{const state=await store.load();await loadJournal(store,config);await commitEvent(store,state,`dispatch-control:${state.revision}:${action}`,`run.${action}`,{reason});});
  return statusFor(store,config);
};
export const recoverDispatch:RecoverDispatchFunction = async(store,raw,options)=>{
  const config=validateRoutingConfig(raw);
  requireThat(options&&options.acknowledgement==='mark-uncertain'||options?.acknowledgement==='operations-stopped-and-side-effects-reconciled','Explicit recovery acknowledgement required');
  await store.locked(async()=>{
    let state=await store.load();const journal=await loadJournal(store,config);
    requireThat(config.grant.owner===state.policy.owner,'Owner recovery authority required');
    for(const job of Object.values(journal.jobs)){
      if(options.job&&options.job!==job.id)continue;
      if(!['prepared','pending','running','unknown'].includes(job.status))continue;
      const operation=state.operations[job.operation];
      if(options.acknowledgement==='mark-uncertain'){
        if(operation){const observed:Operation={...operation,status:'unknown',reconciled:false};const c=await store.context(state);c.operations={[operation.id]:observed};state=await commitEvent(store,state,`${job.id}:recover-unknown`,'operation.unknown',{operation:observed},c);}
        else if(state.assignments[job.assignment]?.status==='running')state=await commitEvent(store,state,`${job.id}:recover-cancel`,'assignment.cancel',{assignment:job.assignment,reason:'Partial admission outcome unknown'});
        job.status='unknown';job.rejection='Owner must establish stopped operations and reconcile side effects; PID or journal absence is insufficient';
      }else{
        if(operation){const observed:Operation={...operation,status:'terminated',reconciled:true};const c=await store.context(state);c.operations={[operation.id]:observed};state=await commitEvent(store,state,`${job.id}:recover-terminated`,'operation.finish',{operation:observed},c);}
        if(state.assignments[job.assignment]?.status==='running')state=await commitEvent(store,state,`${job.id}:recover-cancel`,'assignment.cancel',{assignment:job.assignment,reason:'Owner reconciled uncertain launch'});
        if(state.assignments[job.assignment]&&!state.assignments[job.assignment].reconciled)state=await commitEvent(store,state,`${job.id}:recover-reconcile`,'assignment.reconcile',{assignment:job.assignment,resolution:'Owner attests stopped operations and reconciled side effects'});
        job.status='rejected';job.rejection='Launch outcome reconciled; consumption reservation retained; explicit item re-entry required';
      }
      journal.checkpoints[job.item]=job.rejection!;
    }
    await saveJournal(store,journal);
  });return statusFor(store,config);
};
export const importInbox:ImportInboxFunction = async(store,raw,job)=>{
  const config=validateRoutingConfig(raw);requireThat(typeof job==='string'&&job.trim(),'Inbox job required');
  try{await importJob(store,config,job);}catch(error){
    await store.locked(async()=>{let state=await store.load();const journal=await loadJournal(store,config),record=journal.jobs[job];if(record){record.status='rejected';record.rejection=redact(error instanceof Error?error.message:'Inbox rejected',config);journal.checkpoints[record.item]=record.rejection;if(state.assignments[record.assignment]?.status==='running')state=await commitEvent(store,state,`${job}:import-rejected`,'assignment.cancel',{assignment:record.assignment,reason:record.rejection});await saveJournal(store,journal);}});
    throw error;
  }return statusFor(store,config);
};
export const drive:DriveFunction = async(store,raw,input,options={})=>{
  const config=validateRoutingConfig(raw),selection=validateBacklogSelection(input);await verifySelection(selection);await loadJournal(store,config);
  const limit=options.maxSteps??1000;requireThat(Number.isSafeInteger(limit)&&limit>=0&&limit<=10000,'maxSteps must be an integer between zero and 10000');
  let steps=0,unchanged=false;
  while(steps<limit){
    const status=await statusFor(store,config,selection),action=status.actions[0];
    if(!action||['blocked','owner-needed','complete'].includes(action.kind))break;
    let progressed=true;
    try{
      if(action.kind==='dispatch')await launchTask(store,config,selection,action.task);
      else if(action.kind==='import-inbox')await importInbox(store,config,action.job);
      else if(action.kind==='gate')throw new Error('Standalone gate action requires the durable verifier assignment');
      else await store.locked(async()=>{
        let state=await store.load();const revision=state.revision,journal=await loadJournal(store,config),context=await store.context(state),bodies=await acceptedBodies(store,state);
        const current=nextActions(state,journal,{candidate:context.candidate,now:context.now,selection,config,acceptedBodies:bodies});requireThat(current.some(a=>canonical(a)===canonical(action)),'Workflow action changed before commit');
        if(action.kind==='bootstrap'){
          const requirements=selection.requirements.length?selection.requirements:[`${selection.id}:requested-outcome`];
          state=await commitEvent(store,state,`dispatch:${action.key}`,'item.create',{id:selection.id,objective:selection.objective,owner:config.grant.owner,affectedPaths:selection.owns,dependencies:[],criteria:requirements,requiredArtifacts:{},requiredGates:[],triage:{}});
        }else if(action.kind==='create-activity')state=await commitEvent(store,state,`dispatch:${action.key}`,'activity.create',{id:action.task.activity,item:action.task.item,kind:action.task.kind,requirements:action.task.requirementIds,dependencies:[]});
        else if(action.kind==='configure'){
          const scope=bodies[action.scopeArtifact],criteria=bodies[action.criteriaArtifact];requireThat(scope?.kind==='scope'&&criteria?.kind==='criteria','Checked structured scope/criteria required');
          const observed:Context={...context,configuration:{configHash:configHash(config),grant:config.grant,scope:{artifact:scope.id,hash:scope.hash,proposal:scope.kind==='scope'?scope.value:undefined!},criteria:{artifact:criteria.id,hash:criteria.hash,proposal:criteria.kind==='criteria'?criteria.value:undefined!}}};
          state=await commitEvent(store,state,`dispatch:${action.key}`,'item.configure',{item:action.item,scopeArtifact:action.scopeArtifact,criteriaArtifact:action.criteriaArtifact},observed);
        }else if(action.kind==='advance')state=await commitEvent(store,state,`dispatch:${action.key}`,'item.advance',{item:action.item,status:action.status,artifacts:action.artifacts,evidence:action.evidence});
        progressed=state.revision!==revision;
        delete journal.checkpoints[selection.id];await saveJournal(store,journal);
      });
      steps++;
      if(!progressed){unchanged=true;break;}
    }catch(error){let retryable=false;await store.locked(async()=>{const journal=await loadJournal(store,config);retryable=journal.revision>status.journalRevision&&(journal.checkpoints[selection.id]?.startsWith('retryable-execution:')??false);if(!retryable)journal.checkpoints[selection.id]=redact(error instanceof Error?error.message:'Drive checkpoint',config);await saveJournal(store,journal);});if(retryable){steps++;continue;}break;}
  }
  if(limit>0)await store.locked(async()=>{
    const state=await store.load(),journal=await loadJournal(store,config),context=await store.context(state);
    const action=nextActions(state,journal,{candidate:context.candidate,now:context.now,selection,config,acceptedBodies:await acceptedBodies(store,state)})[0];
    if(action?.kind==='complete')return;
    const stage=state.items[selection.id]?.status??'uncreated';
    const reason=action&&(action.kind==='blocked'||action.kind==='owner-needed')?`${action.kind}: ${action.reasons.join('; ')}`:unchanged?'unchanged progress':steps>=limit?`step limit ${limit} exhausted`:null;
    if(!reason)return;
    const existing=journal.checkpoints[selection.id];
    if(!existing||existing.startsWith('Dispatch stopped:')){journal.checkpoints[selection.id]=redact(`Dispatch stopped: stage=${stage}; action=${action?.kind??'none'}; ${reason}`,config);await saveJournal(store,journal);}
  });
  return {steps,status:await statusFor(store,config,selection)};
};
