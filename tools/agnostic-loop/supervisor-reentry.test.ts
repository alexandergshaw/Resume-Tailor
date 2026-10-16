import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdir, readFile, writeFile, lstat, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { supervisorFixture, fixtureWorker } from './supervisor-fixtures';
import { LoopStore } from './store';
import { configureDispatch, drive, dispatchStatus, recoverDispatch, importInbox } from './supervisor';
import { commitEvent } from './supervisor-inbox';
import { probeProvider } from './providers';
import { createPolicyQualification } from './routing';
import { canonical, digest } from './json';
import { atomicJson, configHash, loadJournal } from './dispatch-store';

const interruption=vi.hoisted(()=>({point:'',fired:false}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,open:async(...args:Parameters<typeof actual.open>)=>{
  const handle=await actual.open(...args),name=String(args[0]);
  return new Proxy(handle,{get(target,key){
   if(key==='close')return async()=>{await target.close();const suffix=interruption.point==='intent'?'.intent.json':interruption.point==='marker'?'qualification-rebind.pending.json':interruption.point==='receipt'?'.complete.json':null;if(suffix&&name.endsWith(suffix)&&!interruption.fired){interruption.fired=true;throw new Error('SIMULATED_BOUNDARY:'+interruption.point);}};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
 },unlink:async(...args:Parameters<typeof actual.unlink>)=>{await actual.unlink(...args);if(interruption.point==='release'&&String(args[0]).endsWith('qualification-rebind.pending.json')&&!interruption.fired){interruption.fired=true;throw new Error('SIMULATED_BOUNDARY:release');}}};
});
vi.mock('./atomic-file',async importOriginal=>{
 const actual=await importOriginal<typeof import('./atomic-file')>();
 return {...actual,atomicFile:async(...args:Parameters<typeof actual.atomicFile>)=>{await actual.atomicFile(...args);const expected=interruption.point==='state'?'state.json':interruption.point==='config'?'dispatch-config.json':interruption.point==='journal'?'dispatch-journal.json':null;if(expected&&String(args[1]).endsWith(path.sep+expected)&&!interruption.fired){interruption.fired=true;throw new Error('SIMULATED_BOUNDARY:'+interruption.point);}}};
});
afterEach(()=>{interruption.point='';interruption.fired=false;vi.restoreAllMocks();});

const evidenceRoot=path.resolve('.agnostic-loop/backlog-dispatch/N166/runtime/control-repair');
// ALL fixture roots retained, including assertion failures, for actual observation.
async function rejectedFixture(options:{reconcile?:boolean;maxJobs?:number;maxAssignments?:number}={}){
 const f=await supervisorFixture({maxJobs:options.maxJobs??32});
 await mkdir(evidenceRoot,{recursive:true});await appendFile(path.join(evidenceRoot,'fixtures.jsonl'),JSON.stringify({root:f.root,created:Date.now(),retained:true})+'\n');
 const marker=path.join(f.root,'first-mismatch'),script=f.config.providers[0].prefixArgs[0];
 await writeFile(script,fixtureWorker.replace("if(process.argv.includes('--unowned'))",`if(t.kind==='scope'&&!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'one consumed malformed result');out.artifacts[0].content=JSON.stringify({...out.proposal,limitations:['mismatched artifact']});}\n if(process.argv.includes('--unowned'))`));
 const policy=(await f.store.load()).policy;policy.deadline=Date.now()+600000;policy.maxAssignments=options.maxAssignments??32;
 const store=new LoopStore(path.join(f.root,'reentry-state'));await store.init(policy);f.config.budget.deadline=policy.deadline;
 f.config.qualifications=[await createPolicyQualification(f.config.providers[0],f.config.targets[0],await probeProvider(f.config.providers[0]),{id:'fixture-reentry',profiles:['analysis','execution','critical'],score:100,expires:policy.deadline,suiteVersion:'fixture-only',evidencePath:f.config.qualifications[0].evidencePath})];
 await configureDispatch(store,f.config);const outcome=await drive(store,f.config,f.selection,{maxSteps:4}),job=outcome.status.jobs[0];
 expect(job.status).toBe('rejected');expect(job.rejection).toBe('Proposal must equal actual authored JSON artifact');
 const state=await store.load();expect(Object.values(state.operations).every(o=>o.status==='terminated'&&o.reconciled)).toBe(true);
 if(options.reconcile!==false)await store.locked(async()=>{const s=await store.load();await commitEvent(store,s,'fixture-observed-reconcile','assignment.reconcile',{assignment:job.assignment,resolution:'Actual fixture process terminated, owned paths inspected; retain failed result'});});
 return {...f,store,job};
}
describe('explicit rejected proposal reentry',()=>{
 it('preserves rejected result and consumption while a new actual worker repairs the proposal',async()=>{
  const f=await rejectedFixture(),before=await f.store.load();
  expect((await dispatchStatus(f.store,f.config,f.selection)).actions[0].kind).toBe('blocked');
  expect(f.job.task.instructions).toContain('Construct the proposal object ONCE');
  await recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id});
  const resumed=await drive(f.store,f.config,f.selection,{maxSteps:2});
  expect(resumed.status.jobs).toHaveLength(2);
  const old=resumed.status.jobs[0],next=resumed.status.jobs[1];
  expect(old).toEqual(f.job);expect(next.worker.context).not.toBe(old.worker.context);
  expect(next.status).toBe('imported');expect(next.task.activity).toBe(old.task.activity);
  const after=await f.store.load();expect(after.activities['fixture-item:scope'].rounds).toBe(before.activities['fixture-item:scope'].rounds);
  expect(after.artifacts[next.task.artifactIds[0]].acceptedHash).toBeNull();
  const checker=(await dispatchStatus(f.store,f.config,f.selection)).actions[0];expect(checker.kind).toBe('dispatch');if(checker.kind==='dispatch'){expect(checker.task.role).toBe('checker');expect(checker.task.purpose).toBe('review');}
 },180000);
 it('owner acknowledgement reconciles only the selected cancelled target and is idempotent',async()=>{
  const f=await rejectedFixture({reconcile:false});expect((await f.store.load()).assignments[f.job.assignment].reconciled).toBe(false);
  await recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id});
  const after=await f.store.load(),journal=await loadJournal(f.store,f.config);expect(after.assignments[f.job.assignment].reconciled).toBe(true);
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+700000);
  await recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id});
  expect(canonical(await f.store.load())).toBe(canonical(after));expect(canonical(await loadJournal(f.store,f.config))).toBe(canonical(journal));
 },180000);
 it('rejects missing or foreign job, other rejection, unresolved operation and foreign retainer',async()=>{
  const f=await rejectedFixture(),state=await f.store.load(),journal=await loadJournal(f.store,f.config);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry'})).rejects.toThrow('Exact rejected job');
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:'job-dead'})).rejects.toThrow('exact rejected');
  const wrong=structuredClone(journal);wrong.jobs[f.job.id].rejection='Other failure';await atomicJson(path.join(f.store.directory,'dispatch-journal.json'),wrong);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id})).rejects.toThrow('exact rejected');await atomicJson(path.join(f.store.directory,'dispatch-journal.json'),journal);
  const unknown=structuredClone(state);Object.values(unknown.operations)[0].reconciled=false;await f.store.save(unknown);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id})).rejects.toThrow('quiescent');await f.store.save(state);
  const retained=structuredClone(state);retained.assignments.foreign={...retained.assignments[f.job.assignment],id:'foreign',reconciled:false};await f.store.save(retained);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id})).rejects.toThrow('quiescent');await f.store.save(state);
  const foreignOp=structuredClone(state);foreignOp.assignments.foreign={...foreignOp.assignments[f.job.assignment],id:'foreign',reconciled:true};const originalOp=Object.values(foreignOp.operations)[0];foreignOp.operations['foreign-op']={...originalOp,id:'foreign-op',assignment:'foreign',status:'unknown',reconciled:false};await f.store.save(foreignOp);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id})).rejects.toThrow('quiescent');await f.store.save(state);
 },180000);
 it('binds every selected entity and original policy and refuses foreign running ownership without mutation',async()=>{
  const f=await rejectedFixture(),state=await f.store.load(),journal=await loadJournal(f.store,f.config),ack={acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id};
  const changes=[
   (s:typeof state,j:typeof journal)=>{j.jobs[f.job.id].id='job-dead';},
   (s:typeof state,j:typeof journal)=>{j.jobs[f.job.id].item='foreign';},
   (s:typeof state,j:typeof journal)=>{j.jobs[f.job.id].task.item='foreign';},
   (s:typeof state,j:typeof journal)=>{j.jobs[f.job.id].task.activity='foreign';},
   (s:typeof state,j:typeof journal)=>{j.jobs[f.job.id].task.kind='criteria';},
   (s:typeof state)=>{s.items.foreign={...s.items['fixture-item'],id:'foreign'};s.assignments[f.job.assignment].item='foreign';},
   (s:typeof state)=>{s.activities.foreign={...s.activities[f.job.task.activity],id:'foreign'};s.assignments[f.job.assignment].activity='foreign';},
   (s:typeof state)=>{s.items.foreign={...s.items['fixture-item'],id:'foreign'};s.activities[f.job.task.activity].item='foreign';},
   (s:typeof state)=>{s.policy.maxAssignments++;},
   (s:typeof state,j:typeof journal)=>{j.jobs[f.job.id].candidate.policyHash='0'.repeat(64);},
   (s:typeof state)=>{s.assignments[f.job.assignment].policyHash='0'.repeat(64);},
   (s:typeof state)=>{s.assignments.foreign={...s.assignments[f.job.assignment],id:'foreign',status:'running',reconciled:true};},
  ];
  const next=await nextQualification(f);
  for(const change of changes){const s=structuredClone(state),j=structuredClone(journal);change(s,j);await f.store.save(s);await atomicJson(path.join(f.store.directory,'dispatch-journal.json'),j);const before=await storeBytes(f);
   await expect(recoverDispatch(f.store,f.config,ack)).rejects.toThrow();expect(await storeBytes(f)).toEqual(before);
   await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow();expect(await storeBytes(f)).toEqual(before);
   await f.store.save(state);await atomicJson(path.join(f.store.directory,'dispatch-journal.json'),journal);
  }
 },180000);
 it('permits accepted ancestors for criteria and plan reentry but keeps rebind whole-item maintenance strict',async()=>{
  const f=await rejectedFixture(),state=await f.store.load(),journal=await loadJournal(f.store,f.config),context=await f.store.context(state),next=await nextQualification(f),ancestor=await f.store.blob(Buffer.from('{"acceptedAncestor":true}'));
  for(const kind of ['criteria','plan']){
   const s=structuredClone(state),j=structuredClone(journal);s.activities[f.job.task.activity].kind=kind;j.jobs[f.job.id].task.kind=kind;
   s.activities.ancestor={...s.activities[f.job.task.activity],id:'ancestor',kind:'scope',status:'accepted'};
   s.assignments['ancestor-assignment']={...s.assignments[f.job.assignment],id:'ancestor-assignment',activity:'ancestor',status:'finished',reconciled:true};
   s.artifacts.ancestor={id:'ancestor',activity:'ancestor',version:1,hash:ancestor.hash,path:'artifacts/ancestor.json',author:f.job.worker,inputs:[],assignment:'ancestor-assignment',acceptedHash:ancestor.hash,candidate:context.candidate};
   await f.store.save(s);await atomicJson(path.join(f.store.directory,'dispatch-journal.json'),j);const before=await storeBytes(f);
   await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('Partial publication');expect(await storeBytes(f)).toEqual(before);
   await recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id});expect((await f.store.load()).artifacts.ancestor).toEqual(s.artifacts.ancestor);expect((await loadJournal(f.store,f.config)).jobs[f.job.id]).toEqual(j.jobs[f.job.id]);
   await f.store.save(state);await atomicJson(path.join(f.store.directory,'dispatch-journal.json'),journal);
  }
 },180000);
 it('refuses exhausted job limits before any new control mutation',async()=>{
  const f=await rejectedFixture({maxJobs:1}),before=await storeBytes(f);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id})).rejects.toThrow('capacity');
  expect(await storeBytes(f)).toEqual(before);
  await expect(recoverDispatch(f.store,await nextQualification(f),{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('capacity');expect(await storeBytes(f)).toEqual(before);
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+700000);await recoverDispatch(f.store,f.config,{acknowledgement:rebindAck,job:f.job.id});expect(await storeBytes(f)).toEqual(before);
 },180000);
 it('refuses partial publication and expired reentry, and retains exhausted assignment limit',async()=>{
  const f=await rejectedFixture(),state=await f.store.load(),context=await f.store.context(state),text='{"partial":true}',hash=digest(text),id=f.job.task.artifactIds[0],relative=f.job.task.writePaths[0];
  await writeFile(path.join(f.workspace,relative),text);await f.store.blob(Buffer.from(text));
  const partial=structuredClone(state);partial.artifacts[id]={id,activity:f.job.task.activity,version:1,hash,path:relative,author:f.job.worker,inputs:[],assignment:f.job.assignment,acceptedHash:null,candidate:context.candidate};await f.store.save(partial);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id})).rejects.toThrow('Partial publication');await f.store.save(state);
  const realNow=Date.now.bind(Date);vi.spyOn(Date,'now').mockImplementation(()=>realNow()+700000);
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:f.job.id})).rejects.toThrow('budget exhausted');vi.restoreAllMocks();
  const g=await rejectedFixture({maxAssignments:1}),before=await storeBytes(g);await expect(recoverDispatch(g.store,g.config,{acknowledgement:'authorize-rejected-proposal-reentry',job:g.job.id})).rejects.toThrow('capacity');expect(await storeBytes(g)).toEqual(before);
  await expect(recoverDispatch(g.store,await nextQualification(g),{acknowledgement:rebindAck,job:g.job.id})).rejects.toThrow('capacity');expect(await storeBytes(g)).toEqual(before);
 },180000);
});

const rebindAck='rebind-qualification-after-verified-control-repair';
async function storeBytes(f:Awaited<ReturnType<typeof rejectedFixture>>){const files:Record<string,string>={};async function visit(directory:string){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else files[path.relative(f.store.directory,file)]=digest(await readFile(file));}}await visit(f.store.directory);return files;}
async function nextQualification(f:Awaited<ReturnType<typeof rejectedFixture>>){
 const next=structuredClone(f.config),file=path.join(f.root,'new-qualified-evidence.json');await writeFile(file,'{"fixtureOnly":true,"freshAcceptedControlProof":true}\n');
 next.qualifications[0]={...next.qualifications[0],id:'fixture-next-qualification',evidencePath:file,evidenceHash:digest(await readFile(file))};return next;
}
describe('qualification-only whole-snapshot rebind',()=>{
 it('no-op leaves every state/config/journal byte unchanged and grants no reentry',async()=>{
  const f=await rejectedFixture(),names=['state.json','dispatch-config.json','dispatch-journal.json'];const before=await Promise.all(names.map(n=>readFile(path.join(f.store.directory,n),'utf8')));
  await recoverDispatch(f.store,f.config,{acknowledgement:rebindAck,job:f.job.id});
  expect(await Promise.all(names.map(n=>readFile(path.join(f.store.directory,n),'utf8')))).toEqual(before);expect((await dispatchStatus(f.store,f.config,f.selection)).actions[0].kind).toBe('blocked');
 },180000);
 it('rebind preserves accounting/history and cannot broaden grant/provider/budget/expiry or accept drift',async()=>{
  const f=await rejectedFixture(),next=await nextQualification(f),before=await f.store.load(),journal=await loadJournal(f.store,f.config);
  for(const mutate of [(c:typeof next)=>{c.grant.pathPrefixes.push('broaden');},(c:typeof next)=>{c.providers[0].timeoutMs++;},(c:typeof next)=>{c.budget.deadline++;},(c:typeof next)=>{c.budget.maxJobs++;},(c:typeof next)=>{c.qualifications[0].expires++;},(c:typeof next)=>{c.qualifications[0].evidenceHash='0'.repeat(64);}]){
   const bad=structuredClone(next);mutate(bad);await expect(recoverDispatch(f.store,bad,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow();
  }
  await recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id});const after=await f.store.load(),updated=await loadJournal(f.store,next);
  expect(updated).toEqual({...journal,revision:journal.revision+1,configHash:configHash(next)});expect(after.events.slice(0,-1)).toEqual(before.events);expect(after.policy).toEqual(before.policy);expect(after.revision).toBe(before.revision+1);expect(updated.jobs[f.job.id]).toEqual(f.job);
  const saved=canonical(after),now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+700000);await recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id});expect(canonical(await f.store.load())).toBe(saved);
  expect((await dispatchStatus(f.store,next,f.selection)).actions[0].kind).toBe('blocked');
 },180000);
 for(const point of ['intent','marker','state','config','journal','receipt','release'])it(`resumes exact persisted ${point} boundary once, keeping normal APIs guarded`,async()=>{
  const f=await rejectedFixture(),next=await nextQualification(f),before=await f.store.load(),oldJournal=await loadJournal(f.store,f.config);
  interruption.point=point;await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('SIMULATED_BOUNDARY:'+point);expect(interruption.fired).toBe(true);interruption.point='';
  const pending=await lstat(path.join(f.store.directory,'qualification-rebind.pending.json')).then(()=>true,()=>false);
  expect(pending).toBe(!['intent','release'].includes(point));
  if(pending){await expect(loadJournal(f.store,next)).rejects.toThrow('rebind pending');await expect(dispatchStatus(f.store,next,f.selection)).rejects.toThrow('rebind pending');await expect(drive(f.store,next,f.selection,{maxSteps:1})).rejects.toThrow('rebind pending');await expect(importInbox(f.store,next,f.job.id)).rejects.toThrow('rebind pending');}
  if(point==='intent'){expect(canonical(await f.store.load())).toBe(canonical(before));expect(canonical(await loadJournal(f.store,f.config))).toBe(canonical(oldJournal));}
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+700000);await recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id});const after=await f.store.load(),j=await loadJournal(f.store,next);
  expect(after.revision).toBe(before.revision+1);expect(after.events.slice(0,-1)).toEqual(before.events);expect(j).toEqual({...oldJournal,revision:oldJournal.revision+1,configHash:configHash(next)});
  expect(await lstat(path.join(f.store.directory,`qualification-rebind-${f.job.id}.complete.json`)).then(s=>s.isFile())).toBe(true);expect(await lstat(path.join(f.store.directory,'qualification-rebind.pending.json')).then(()=>true,()=>false)).toBe(false);
 },180000);
 it('rejects foreign full journal/state snapshots, invalid prefixes and tampered intent/marker/receipt',async()=>{
  const f=await rejectedFixture(),next=await nextQualification(f);interruption.point='journal';await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('SIMULATED_BOUNDARY');interruption.point='';
  const intentPath=path.join(f.store.directory,`qualification-rebind-${f.job.id}.intent.json`),markerPath=path.join(f.store.directory,'qualification-rebind.pending.json'),intentRaw=await readFile(intentPath,'utf8'),markerRaw=await readFile(markerPath,'utf8'),intent=JSON.parse(intentRaw);
  const statePath=path.join(f.store.directory,'state.json'),journalPath=path.join(f.store.directory,'dispatch-journal.json');
  const restore=async()=>{await atomicJson(statePath,intent.newState);await atomicJson(journalPath,intent.newJournal);await writeFile(intentPath,intentRaw);await writeFile(markerPath,markerRaw);};
  const changed=structuredClone(intent.newJournal);changed.spentMicroUsd++;await atomicJson(journalPath,changed);await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('Foreign state/config/journal');await restore();
  const changedJob=structuredClone(intent.newJournal);changedJob.jobs[f.job.id].usage.inputTokens=999;await atomicJson(journalPath,changedJob);await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('Foreign state/config/journal');await restore();
  await atomicJson(statePath,intent.oldState);await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('Foreign state/config/journal');await restore();
  await writeFile(intentPath,intentRaw.replace('qualification-only-rebind-v1','tampered-rebind'));await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('Rebind owner event changed');await restore();
  await writeFile(markerPath,markerRaw.replace('"intentHash":"','"intentHash":"bad'));await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('Foreign rebind pending marker');await restore();
  const receipt=path.join(f.store.directory,`qualification-rebind-${f.job.id}.complete.json`);await writeFile(receipt,'{}');await expect(recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id})).rejects.toThrow('completion receipt changed');await unlink(receipt);await restore();
  await recoverDispatch(f.store,next,{acknowledgement:rebindAck,job:f.job.id});
 },180000);
});
