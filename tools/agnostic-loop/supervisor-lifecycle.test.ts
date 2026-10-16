import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonical, digest } from './json';
import { targetFingerprint } from './routing';
import { readFile, writeFile } from 'node:fs/promises';
import { supervisorFixture, cleanupSupervisorFixtures } from './supervisor-fixtures';
import { drive, dispatchStatus, controlDispatch, recoverDispatch, importInbox } from './supervisor';
import { loadJournal, saveJournal } from './dispatch-store';

afterEach(cleanupSupervisorFixtures);
describe('durable supervisor lifecycle',()=>{
 it('imports fresh inbox across unrelated revisions and rejects conflicting replay after acknowledgement',async()=>{
  const f=await supervisorFixture();const run=await drive(f.store,f.config,f.selection,{maxSteps:3});const job=run.status.jobs[0];expect(job.status).toBe('terminated');
  await controlDispatch(f.store,f.config,'pause','unrelated revision');await controlDispatch(f.store,f.config,'resume','unrelated revision resolved');
  await importInbox(f.store,f.config,job.id);const before=(await f.store.load()).revision;await importInbox(f.store,f.config,job.id);expect((await f.store.load()).revision).toBe(before);
  const bytes=await readFile(job.inboxPath,'utf8');await writeFile(job.inboxPath,bytes.replace('offline fixture','changed fixture'));
  await expect(importInbox(f.store,f.config,job.id)).rejects.toThrow('integrity');expect((await f.store.load()).revision).toBe(before);
 },40_000);
 it('rejects stale tokens and actual unowned writes without granting completion',async()=>{
  const f=await supervisorFixture({flags:['--unowned']});const run=await drive(f.store,f.config,f.selection,{maxSteps:4});
  expect(run.status.jobs[0].status).toBe('rejected');expect(run.status.checkpoints[f.selection.id]).toContain('Unowned candidate drift');expect((await f.store.load()).items[f.selection.id].status).toBe('queued');
  const clean=await supervisorFixture();const dispatched=await drive(clean.store,clean.config,clean.selection,{maxSteps:3});await controlDispatch(clean.store,clean.config,'cancel','cancel before import');
  await expect(importInbox(clean.store,clean.config,dispatched.status.jobs[0].id)).rejects.toThrow('fenced');
 },50_000);
 it('rejects observed settings mismatch before inbox acceptance',async()=>{
  const f=await supervisorFixture({flags:['--bad-settings']});const result=await drive(f.store,f.config,f.selection);
  expect(result.status.jobs[0].status).toBe('rejected');expect(result.status.checkpoints[f.selection.id]).toContain('Observed settings mismatch');
  expect(result.status.jobs[0].outputHash).not.toBeNull();expect(result.status.jobs[0].observed.settings).toEqual({unexpected:'setting'});expect(result.status.jobs[0].finished).not.toBeNull();
 },30_000);
 it('pauses after real admission without cancelling the tracked job; cancellation fences it',async()=>{
  const f=await supervisorFixture({flags:['--delay']});const pending=drive(f.store,f.config,f.selection,{maxSteps:3});
  let running=false;for(let i=0;i<100;i++){const status=await dispatchStatus(f.store,f.config);if(status.jobs.some(j=>j.status==='running')){running=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}
  expect(running).toBe(true);await controlDispatch(f.store,f.config,'pause','pause admitted job');const paused=await pending;
  expect(paused.status.jobs[0].status).toBe('terminated');expect(paused.status.runStatus).toBe('paused');
  const c=await supervisorFixture({flags:['--delay']});const active=drive(c.store,c.config,c.selection,{maxSteps:3});
  for(let i=0;i<100;i++){if((await dispatchStatus(c.store,c.config)).jobs.some(j=>j.status==='running'))break;await new Promise(resolve=>setTimeout(resolve,25));}
  await controlDispatch(c.store,c.config,'cancel','cancel admitted job');const cancelled=await active;expect(cancelled.status.jobs[0].status).toBe('unknown');
  const state=await c.store.load();expect(state.assignments[cancelled.status.jobs[0].assignment].reconciled).toBe(false);
 },60_000);
 it('recovers persisted pending launch as unknown without a replacement launch or reservation refund',async()=>{
  const f=await supervisorFixture();const run=await drive(f.store,f.config,f.selection,{maxSteps:3});const job=run.status.jobs[0];
  // A durable pending marker models the exact snapshot left before handle registration.
  await f.store.locked(async()=>{const journal=await loadJournal(f.store,f.config);journal.jobs[job.id].status='pending';journal.jobs[job.id].pid=null;journal.reservationsMicroUsd=123;await saveJournal(f.store,journal);});
  await recoverDispatch(f.store,f.config,{acknowledgement:'mark-uncertain'});const restarted=await drive(f.store,f.config,f.selection);
  expect(restarted.status.jobs).toHaveLength(1);expect(restarted.status.jobs[0].status).toBe('unknown');expect((await loadJournal(f.store,f.config)).reservationsMicroUsd).toBe(123);
  expect(restarted.status.actions[0].kind).toBe('blocked');
 },40_000);
});

async function waitForProvider(check:()=>Promise<boolean>,message:string,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(message);}
const providerAlive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
describe('provider authority watcher termination controls',()=>{
 for(const failure of ['cancel','integrity','deadline'] as const)it('terminates before natural completion on '+failure,async()=>{
  const f=await supervisorFixture({flags:['--delay'],marker:true,beforeConfigure:config=>{
   const provider=config.providers[0],script=provider.prefixArgs[0],completed=path.join(path.dirname(script),'completed');
   const source=readFileSync(script,'utf8').replace('setTimeout(perform,5000)','setTimeout(perform,10000)').replace('const perform=()=>{','const perform=()=>{fs.writeFileSync('+JSON.stringify(completed)+',"yes");');writeFileSync(script,source);
   // Rebind the offline fixture qualification to the exact modified script bytes before configuration.
   config.qualifications[0].executableHash=digest(canonical({[provider.executable]:digest(readFileSync(provider.executable)),[script]:digest(readFileSync(script))}));
   if(failure==='deadline'){provider.timeoutMs=4000;config.qualifications[0].targetHash=targetFingerprint(provider,config.targets[0]);}
  }});
  let polls=0,pid=0,corruptedBlob:string|undefined;const factory=f.store.createAssignmentMonitor.bind(f.store);
  const spy=vi.spyOn(f.store,'createAssignmentMonitor').mockImplementation(id=>{const poll=factory(id);return async()=>{const result=await poll();if(result)polls++;return result;};});
  const pending=drive(f.store,f.config,f.selection,{maxSteps:3}).then(value=>({value,error:null}),error=>({value:null,error}));
  try{
   await waitForProvider(async()=>{try{pid=Number(await readFile(path.join(f.root,'worker-pid.txt'),'utf8'));return polls>0;}catch{return false;}},'provider readiness and successful poll watchdog',15000);
   if(failure==='cancel')await controlDispatch(f.store,f.config,'cancel','frozen cancellation');
   if(failure==='integrity'){
    const state=await f.store.load(),a=Object.values(state.assignments)[0],blob=await f.store.blob(Buffer.from('provider integrity bytes'));
    state.artifacts.watch={id:'watch',activity:a.activity,version:1,hash:blob.hash,path:'artifacts/watch.txt',author:a.worker,inputs:[],assignment:a.id,acceptedHash:null,candidate:a.baseline};await f.store.save(state);
    const before=polls;await waitForProvider(async()=>polls>before,'provider blob-reference warm poll watchdog');corruptedBlob=blob.path;await writeFile(blob.path,'corrupt provider blob');
   }
   await waitForProvider(async()=>!providerAlive(pid),'provider termination-before-natural-completion watchdog');
   await expect(readFile(path.join(f.root,'completed'))).rejects.toThrow();const result=await pending;
   if(corruptedBlob){expect(result.error).toBeInstanceOf(Error);await writeFile(corruptedBlob,'provider integrity bytes');const journal=await loadJournal(f.store,f.config);expect(journal.jobs[Object.keys(journal.jobs)[0]].resultHash).toBeNull();expect(Object.values((await f.store.load()).operations)[0].reconciled).toBe(false);}
   else{expect(result.error).toBeNull();expect(result.value!.status.jobs[0].status).toBe('unknown');expect(result.value!.status.jobs[0].resultHash).toBeNull();expect(Object.values((await f.store.load()).operations)[0].reconciled).toBe(false);}
  }finally{if(!pid){try{pid=Object.values((await f.store.load()).operations).find(o=>o.pid)?.pid??0;}catch{}}if(pid&&providerAlive(pid))process.kill(pid);if(corruptedBlob)await writeFile(corruptedBlob,'provider integrity bytes');await pending;spy.mockRestore();}
 },30000);
});
