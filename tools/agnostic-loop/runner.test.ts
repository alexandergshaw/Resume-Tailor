import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LoopStore } from './store';
import { runGate } from './runner';
import type { Policy } from './types';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}); delete process.env.AGNOSTIC_RUN_SECRET; });
async function fixture(script: string, commandTimeout=20000) {
  const root = await mkdtemp(path.join(os.tmpdir(),'agnostic-runner-')); roots.push(root); const workspace = path.join(root,'workspace'); await mkdir(workspace);
  const store = new LoopStore(path.join(root,'state'));
  const policy: Policy = { owner:'owner',workspace,allowedActions:['run'],candidateExclusions:[],environmentKeys:['AGNOSTIC_RUN_SECRET'],externalFiles:[],gates:{test:{executable:process.execPath,args:['-e',script.replace('FIXTURE_ROOT',JSON.stringify(root))],resources:['workspace']}},concurrency:3,deadline:Date.now()+60_000,maxAssignments:10,commandTimeout };
  await store.init(policy);
  async function event(type:string,payload:Record<string,unknown>) { const state=await store.load(); return store.transact({id:`event-${state.revision}`,expectedRevision:state.revision,actor:'owner',type,payload}); }
  await event('item.create',{id:'item',objective:'Verify fixture',owner:'owner',affectedPaths:['fixture.txt'],dependencies:[],criteria:['works'],requiredArtifacts:{},requiredGates:['test'],triage:{}});
  await event('activity.create',{id:'activity',item:'item',kind:'verification',requirements:['works'],dependencies:[]});
  await event('assignment.start',{id:'assignment',item:'item',activity:'activity',role:'verifier',worker:{instance:'verifier',context:'fresh',provider:'manual',model:'fixture',settings:{},tools:['node']},inputs:{},writePaths:[],affectedPaths:['fixture.txt'],resources:['workspace'],allowedActions:['run'],deadline:Date.now()+30_000,deliverables:[]});
  return {store,event,root};
}
describe('real allowlisted process runner',()=>{
  it('records real exit and sanitized immutable output',async()=>{
    process.env.AGNOSTIC_RUN_SECRET='secret-sentinel-never-store';
    const {store}=await fixture('console.log(process.env.AGNOSTIC_RUN_SECRET)');
    const evidence=await runGate(store,'assignment','test','owner');
    expect(evidence.exitCode).toBe(0);
    expect(await readFile(evidence.outputPath,'utf8')).toContain('[redacted]');
    expect(await readFile(evidence.outputPath,'utf8')).not.toContain('secret-sentinel-never-store');
    expect(Object.values((await store.load()).operations)[0].status).toBe('terminated');
  },20000);
  it('rejects unknown gates and quarantines cancelled live operations',async()=>{
    const {store,event}=await fixture('setTimeout(()=>console.log("late"),10000)');
    await expect(runGate(store,'assignment','arbitrary','owner')).rejects.toThrow('Unknown');
    const running=runGate(store,'assignment','test','owner');
    const outcome=running.then(()=>null,error=>error);
    for(let i=0;i<80;i++){ const state=await store.load(); if(Object.values(state.operations).some(op=>op.status==='running')) break; await new Promise(resolve=>setTimeout(resolve,25)); }
    await expect(runGate(store,'assignment','test','owner')).rejects.toThrow('outstanding operation');
    await event('assignment.cancel',{assignment:'assignment',reason:'cancel fixture'});
    expect(await outcome).toBeInstanceOf(Error);
    const state=await store.load(); expect(state.assignments.assignment.reconciled).toBe(false);
    expect(Object.values(state.operations)[0].status).toBe('unknown');
    expect(Object.values(state.evidence)[0].exitCode).toBeNull();
    await expect(event('assignment.reconcile',{assignment:'assignment',resolution:'premature'})).rejects.toThrow('operations');
  },20000);
  it('retains unusable audit when an exit-zero gate changes the candidate',async()=>{
    const {store}=await fixture('require("node:fs").writeFileSync("fixture.txt","changed")');
    const evidence=await runGate(store,'assignment','test','owner');
    expect(evidence.exitCode).toBeNull(); expect(evidence.limitations).toContain('Candidate changed during command');
    expect((await store.load()).evidence[evidence.id]).toEqual(evidence);
  },20000);
  it('rejects launch over a persisted pending operation after reload',async()=>{
    const {store}=await fixture('process.exit(0)');
    const state=await store.load();
    const operation={id:'pending-before-restart',assignment:'assignment',resource:'workspace',status:'pending' as const,publicationToken:state.assignments.assignment.publicationToken,pid:null,reconciled:false};
    await store.transact({id:'pending-event',expectedRevision:state.revision,actor:'owner',type:'operation.start',payload:{operation}},{operations:{[operation.id]:operation}});
    await expect(runGate(new LoopStore(store.directory),'assignment','test','owner')).rejects.toThrow('outstanding operation');
    expect(Object.keys((await store.load()).operations)).toEqual(['pending-before-restart']);
  },20000);
});

async function waitForRunner(check:()=>Promise<boolean>, message:string, timeout=5000) {
  const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(message);
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
describe('runner authority watcher termination controls',()=>{
  for(const failure of ['cancel','integrity','deadline'] as const)it('terminates before natural completion on '+failure,async()=>{
    const f=await fixture('const fs=require("node:fs"),p=require("node:path"),root=FIXTURE_ROOT;fs.writeFileSync(p.join(root,"ready"),String(process.pid));setTimeout(()=>{fs.writeFileSync(p.join(root,"completed"),"yes");process.exit(0)},10000)',failure==='deadline'?4000:20000);
    const blob=await f.store.blob(Buffer.from('watcher integrity bytes')),setup=await f.store.load(),a=setup.assignments.assignment;
    setup.artifacts.watch={id:'watch',activity:a.activity,version:1,hash:blob.hash,path:'fixture.txt',author:a.worker,inputs:[],assignment:a.id,acceptedHash:null,candidate:a.baseline};await f.store.save(setup);
    const filename=path.join(f.store.directory,'state.json'), pristine=await readFile(filename);
    let polls=0,pid=0;const factory=f.store.createAssignmentMonitor.bind(f.store);
    const spy=vi.spyOn(f.store,'createAssignmentMonitor').mockImplementation(id=>{const poll=factory(id);return async()=>{const result=await poll();if(result)polls++;return result;};});
    const pending=runGate(f.store,'assignment','test','owner').then(value=>({value,error:null}),error=>({value:null,error}));
    try{
      await waitForRunner(async()=>{try{pid=Number(await readFile(path.join(f.root,'ready'),'utf8'));return polls>0;}catch{return false;}},'runner readiness and successful poll watchdog');
      if(failure==='cancel')await f.event('assignment.cancel',{assignment:'assignment',reason:'frozen cancellation'});
      if(failure==='integrity')await writeFile(blob.path,'corrupt watcher blob');
      await waitForRunner(async()=>!alive(pid),'runner termination-before-natural-completion watchdog');
      await expect(readFile(path.join(f.root,'completed'))).rejects.toThrow();
      const result=await pending;
      if(failure==='integrity'){expect(result.error).toBeInstanceOf(Error);await writeFile(blob.path,'watcher integrity bytes');expect(Object.values((await f.store.load()).operations)[0].reconciled).toBe(false);}
      else if(failure==='cancel'){expect(result.error).toBeInstanceOf(Error);const state=await f.store.load();expect(Object.values(state.evidence).every(e=>e.exitCode===null)).toBe(true);expect(Object.values(state.operations)[0].status).toBe('unknown');expect(state.assignments.assignment.reconciled).toBe(false);}
      else {expect(result.error).toBeInstanceOf(Error);const state=await f.store.load();expect(Object.values(state.evidence)[0].exitCode).toBeNull();expect(Object.values(state.operations)[0].status).toBe('unknown');expect(state.assignments.assignment.status).toBe('quarantined');}
    }finally{if(!pid){try{pid=Object.values((await f.store.load()).operations).find(o=>o.pid)?.pid??0;}catch{}}if(pid&&alive(pid))process.kill(pid);await writeFile(blob.path,'watcher integrity bytes');await writeFile(filename,pristine);await pending;spy.mockRestore();}
  },20000);
});
