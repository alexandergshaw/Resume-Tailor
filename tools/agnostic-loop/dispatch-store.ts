import { mkdir, readFile, open, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from './json';
import { validateJournal, validateRoutingConfig, targetFingerprint } from './routing';
import { applyEvent, requireThat } from './engine';
import { validateState } from './validation';
import type { DispatchJournal, RoutingConfig, LaunchRecord } from './dispatch-types';
import type { LoopState, Envelope } from './types';
import type { LoopStore } from './store';

export function configHash(config:RoutingConfig):string { return digest(canonical(config)); }
export async function atomicJson(filename:string,value:unknown):Promise<void> {
  await mkdir(path.dirname(filename),{recursive:true}); const temporary = `${filename}.${randomUUID()}.tmp`;
  await atomicFile(temporary,filename,JSON.stringify(value,null,2));
}
export async function loadJournal(store:LoopStore,config:RoutingConfig):Promise<DispatchJournal> {
  try { await lstat(path.join(store.directory,'qualification-rebind.pending.json')); throw new Error('Qualification rebind pending; explicit owner recovery required'); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
  const stored = validateRoutingConfig(JSON.parse(await readFile(path.join(store.directory,'dispatch-config.json'),'utf8')));
  if (configHash(stored) !== configHash(config)) throw new Error('Dispatch configuration changed; an explicit new grant is required');
  const journal = validateJournal(JSON.parse(await readFile(path.join(store.directory,'dispatch-journal.json'),'utf8')));
  if (journal.configHash !== configHash(config)) throw new Error('Journal/configuration binding mismatch');
  return journal;
}
export async function saveJournal(store:LoopStore,journal:DispatchJournal):Promise<void> {
  const validated = validateJournal(journal); validated.revision++;
  await atomicJson(path.join(store.directory,'dispatch-journal.json'),validated);
  journal.revision = validated.revision;
}
export function emptyJournal(config:RoutingConfig):DispatchJournal { return {schemaVersion:1,revision:0,configHash:configHash(config),jobs:Object.create(null),probes:Object.create(null),reservationsMicroUsd:0,spentMicroUsd:0,unavailableUsageJobs:[],checkpoints:Object.create(null)}; }

const proposalFailure='Proposal must equal actual authored JSON artifact';
const snapshotHash=(value:unknown)=>digest(canonical(value));
const reentryResolution=(job:LaunchRecord)=>canonical({kind:'rejected-proposal-reentry-v1',job:job.id,assignment:job.assignment,resultHash:job.resultHash,priorRejection:job.rejection});
export function hasProposalReentry(state:LoopState,job:LaunchRecord):boolean {
  const assignment=state.assignments[job.assignment];
  return job.status==='rejected'&&job.rejection===proposalFailure&&!!assignment?.reconciled&&assignment.status!=='running'&&
    Object.values(state.operations).filter(o=>o.assignment===assignment.id).every(o=>o.status==='terminated'&&o.reconciled)&&
    state.events.some(e=>e.id===`${job.id}:proposal-reentry`&&e.type==='assignment.reconcile'&&e.actor===state.policy.owner&&e.payload.assignment===job.assignment&&e.payload.resolution===reentryResolution(job));
}
export function requireProposalMaintenance(state:LoopState,journal:DispatchJournal,jobId:string,requireReconciled=true):LaunchRecord {
  const job=journal.jobs[jobId],assignment=job&&state.assignments[job.assignment],activity=assignment&&state.activities[assignment.activity];
  requireThat(job&&job.status==='rejected'&&job.rejection===proposalFailure&&job.resultHash&&job.outputHash&&['scope','criteria','plan'].includes(job.task.kind)&&job.task.purpose==='author','Only an exact rejected structured proposal may reenter');
  requireThat(assignment&&assignment.status==='cancelled'&&(!requireReconciled||assignment.reconciled)&&activity?.status==='open'&&activity.rounds===0,'Preacceptance cancelled/reconciled assignment required');
  requireThat(job.id===jobId&&assignment.id===job.assignment&&job.item===job.task.item&&job.item===assignment.item&&job.item===activity.item&&job.task.activity===assignment.activity&&activity.id===assignment.activity&&job.task.kind===activity.kind,'Rejected job entity binding changed');
  requireThat(job.candidate.policyHash===snapshotHash(state.policy)&&assignment.policyHash===job.candidate.policyHash&&assignment.baseline.policyHash===assignment.policyHash,'Original admission policy changed');
  requireThat(!Object.values(state.artifacts).some(a=>requireReconciled?state.activities[a.activity].item===job.item:a.assignment===assignment.id||a.activity===activity.id)&&activity.reviews.length===0&&job.importedEvents.length===0,'Partial publication cannot reenter');
  requireThat(state.operations[job.operation]?.assignment===assignment.id&&Object.values(state.operations).length>0&&Object.values(state.operations).every(o=>o.status==='terminated'&&o.reconciled)&&Object.values(state.assignments).every(a=>a.status!=='running'&&(a.status==='finished'||a.reconciled||(!requireReconciled&&a.id===assignment.id)))&&Object.values(journal.jobs).every(j=>['imported','rejected'].includes(j.status)),'All operations and ownership must be observed quiescent');
  return job;
}
export function requireControlCapacity(state:LoopState,journal:DispatchJournal,config:RoutingConfig):void {
  requireThat(Object.keys(journal.jobs).length<config.budget.maxJobs&&Object.keys(state.assignments).length<state.policy.maxAssignments,'Control admission capacity exhausted');
}
export function proposalReentryEvent(state:LoopState,job:LaunchRecord):Envelope {
  return {id:`${job.id}:proposal-reentry`,expectedRevision:state.revision,actor:state.policy.owner,type:'assignment.reconcile',payload:{assignment:job.assignment,resolution:reentryResolution(job)}};
}
type RebindIntent={schemaVersion:1;job:string;policyHash:string;oldConfig:RoutingConfig;newConfig:RoutingConfig;oldJournal:DispatchJournal;newJournal:DispatchJournal;oldState:LoopState;newState:LoopState;event:Envelope;hashes:Record<string,string>};
const pendingName='qualification-rebind.pending.json';
async function readJson(filename:string):Promise<any>{requireThat(!(await lstat(filename)).isSymbolicLink(),'Control record must not be a symlink');return JSON.parse(await readFile(filename,'utf8'));}
async function exclusiveJson(filename:string,value:unknown):Promise<void>{
  const file=await open(filename,'wx');try{await file.writeFile(canonical(value));await file.sync();}finally{await file.close();}
}
function rebindEvent(state:LoopState,job:LaunchRecord,oldConfig:RoutingConfig,newConfig:RoutingConfig):Envelope {
  return {id:`${job.id}:qualification-rebind:${configHash(newConfig)}`,expectedRevision:state.revision,actor:state.policy.owner,type:'assignment.reconcile',payload:{assignment:job.assignment,resolution:canonical({kind:'qualification-only-rebind-v1',job:job.id,priorRejection:job.rejection,resultHash:job.resultHash,oldConfig:configHash(oldConfig),newConfig:configHash(newConfig)})}};
}
function qualificationOnly(oldConfig:RoutingConfig,newConfig:RoutingConfig):void {
  requireThat(canonical({...oldConfig,qualifications:[]})===canonical({...newConfig,qualifications:[]}),'Rebind cannot change provider, target, grant, budget, deadline or routing policy');
  requireThat(oldConfig.qualifications.length===newConfig.qualifications.length&&newConfig.qualifications.length>0,'Qualification inventory changed');
  for(const next of newConfig.qualifications){
    const previous=oldConfig.qualifications.find(q=>q.target===next.target);requireThat(previous,'Qualification target changed');
    const stable=(q:typeof next)=>({...q,id:'',evidencePath:'',evidenceHash:''});
    requireThat(canonical(stable(previous!))===canonical(stable(next)),'Qualification identity, profiles, score or expiry changed');
  }
}
async function verifyQualifications(config:RoutingConfig):Promise<void>{
  for(const q of config.qualifications){
    const target=config.targets.find(t=>t.id===q.target),provider=target&&config.providers.find(p=>p.id===target.provider);requireThat(provider&&target,'Qualification target missing');
    requireThat(targetFingerprint(provider!,target!)===q.targetHash&&digest(await readFile(q.evidencePath))===q.evidenceHash,'Qualification evidence/target drift');
    const files:Record<string,string>={[provider!.executable]:digest(await readFile(provider!.executable))};
    for(const prefix of provider!.prefixArgs)if(path.isAbsolute(prefix))files[prefix]=digest(await readFile(prefix));
    requireThat(snapshotHash(files)===q.executableHash,'Qualification executable changed');
  }
}
/** Caller holds store.locked. Never relax ordinary loadJournal's pending/config guards. */
export async function rebindQualifications(store:LoopStore,nextInput:RoutingConfig,jobId:string):Promise<void>{
  requireThat(/^job-[a-f0-9-]+$/.test(jobId),'Exact rejected job required');
  const next=validateRoutingConfig(nextInput),intentFile=path.join(store.directory,`qualification-rebind-${jobId}.intent.json`),pendingFile=path.join(store.directory,pendingName),receiptFile=path.join(store.directory,`qualification-rebind-${jobId}.complete.json`);
  let intent:RebindIntent|undefined;
  try{intent=await readJson(intentFile);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!intent){
    const state=await store.load(),old=validateRoutingConfig(await readJson(path.join(store.directory,'dispatch-config.json'))),journal=await loadJournal(store,old);
    requireThat(next.grant.owner===state.policy.owner&&old.grant.owner===state.policy.owner,'Fixed owner required');
    const job=requireProposalMaintenance(state,journal,jobId);
    if(configHash(old)===configHash(next))return; // A no-op never grants reentry or refreshes counters.
    qualificationOnly(old,next);
    requireControlCapacity(state,journal,next);
    requireThat(Date.now()<state.policy.deadline&&Date.now()<next.budget.deadline&&next.qualifications.every(q=>Date.now()<q.expires),'Rebind admission budget exhausted');
    await verifyQualifications(next);
    const event=rebindEvent(state,job,old,next),newState=applyEvent(state,event,await store.context(state)),newJournal=validateJournal({...journal,revision:journal.revision+1,configHash:configHash(next)});
    const bodies={oldConfig:old,newConfig:next,oldJournal:journal,newJournal,oldState:state,newState};
    intent={schemaVersion:1,job:jobId,policyHash:snapshotHash(state.policy),...bodies,event,hashes:Object.fromEntries(Object.entries(bodies).map(([k,v])=>[k,snapshotHash(v)]))};
    await exclusiveJson(intentFile,intent);
  }
  requireThat(intent.schemaVersion===1&&intent.job===jobId&&configHash(intent.newConfig)===configHash(next),'Conflicting rebind intent');
  const oldConfig=validateRoutingConfig(intent.oldConfig),newConfig=validateRoutingConfig(intent.newConfig),oldJournal=validateJournal(intent.oldJournal),newJournal=validateJournal(intent.newJournal),oldState=validateState(intent.oldState),newState=validateState(intent.newState);
  qualificationOnly(oldConfig,newConfig);const job=requireProposalMaintenance(oldState,oldJournal,jobId);
  requireThat(intent.policyHash===snapshotHash(oldState.policy)&&canonical(oldState.policy)===canonical(newState.policy)&&oldConfig.grant.owner===oldState.policy.owner&&newConfig.grant.owner===oldState.policy.owner,'Rebind policy/owner changed');
  for(const [key,value] of Object.entries({oldConfig,newConfig,oldJournal,newJournal,oldState,newState}))requireThat(intent.hashes[key]===snapshotHash(value),'Rebind snapshot integrity mismatch');
  requireThat(oldJournal.configHash===configHash(oldConfig)&&canonical(newJournal)===canonical({...oldJournal,revision:oldJournal.revision+1,configHash:configHash(newConfig)}),'Rebind journal changed beyond qualification binding');
  const event=rebindEvent(oldState,job,oldConfig,newConfig);requireThat(canonical(event)===canonical(intent.event),'Rebind owner event changed');
  requireThat(canonical(newState)===canonical(applyEvent(oldState,event,await store.context(oldState))),'Rebind state/event snapshot changed');
  await verifyQualifications(newConfig);
  const marker={schemaVersion:1,job:jobId,intentHash:snapshotHash(intent)},receipt={...marker,stateHash:snapshotHash(newState),configHash:configHash(newConfig),journalHash:snapshotHash(newJournal),event:event.id};
  let currentMarker:any,completed:any;
  try{currentMarker=await readJson(pendingFile);requireThat(canonical(currentMarker)===canonical(marker),'Foreign rebind pending marker');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  try{completed=await readJson(receiptFile);requireThat(canonical(completed)===canonical(receipt),'Rebind completion receipt changed');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const position=async()=>{
    const s=await store.load(),c=validateRoutingConfig(await readJson(path.join(store.directory,'dispatch-config.json'))),j=validateJournal(await readJson(path.join(store.directory,'dispatch-journal.json')));
    const tuple=[snapshotHash(s),snapshotHash(c),snapshotHash(j)].join(':');
    const tuples=[[oldState,oldConfig,oldJournal],[newState,oldConfig,oldJournal],[newState,newConfig,oldJournal],[newState,newConfig,newJournal]].map(parts=>parts.map(snapshotHash).join(':'));
    const index=tuples.indexOf(tuple);requireThat(index>=0,'Foreign state/config/journal replay snapshot');return index;
  };
  let index=await position();
  requireThat(!completed||index===3,'Completion receipt precedes complete snapshots');
  if(!currentMarker){
    if(completed)return;
    requireThat(index===0,'Missing pending guard for partial rebind');await exclusiveJson(pendingFile,marker);
  }
  if(index===0){await store.save(newState);index=await position();}
  if(index===1){await atomicJson(path.join(store.directory,'dispatch-config.json'),newConfig);index=await position();}
  if(index===2){await atomicJson(path.join(store.directory,'dispatch-journal.json'),newJournal);index=await position();}
  requireThat(index===3,'Incomplete rebind');
  if(!completed)await exclusiveJson(receiptFile,receipt);
  requireThat(canonical(await readJson(receiptFile))===canonical(receipt)&&await position()===3&&canonical(await readJson(pendingFile))===canonical(marker),'Rebind completion changed before marker release');
  await unlink(pendingFile);
}
