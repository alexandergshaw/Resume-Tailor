import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat, utimes, unlink, symlink, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LoopStore } from './store';
import { validateState } from './validation';
import type { Policy } from './types';
import { digest } from './json';
import { captureCandidate } from './candidate';
vi.mock('./candidate', async importOriginal => {
  const actual = await importOriginal<typeof import('./candidate')>();
  return {...actual,captureCandidate:vi.fn(actual.captureCandidate)};
});
vi.mock('./validation', async importOriginal => {
  const actual = await importOriginal<typeof import('./validation')>();
  return { ...actual, validateState: vi.fn(actual.validateState) };
});
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(captureCandidate).mockClear(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(),'agnostic-store-')); roots.push(root);
  const workspace = path.join(root,'workspace'); await mkdir(workspace);
  const store = new LoopStore(path.join(root,'state'));
  const policy: Policy = { owner:'owner',workspace,allowedActions:['write'],candidateExclusions:[],environmentKeys:[],externalFiles:[],gates:{},concurrency:3,deadline:Date.now()+60_000,maxAssignments:10,commandTimeout:5000 };
  await store.init(policy); return { root, store, policy };
}
describe('durable atomic store', () => {
  it('captures the whole candidate once per transaction and still captures for public context', async () => {
    const {store,policy} = await fixture();
    await writeFile(path.join(policy.workspace,'source.txt'),'actual source');
    const state = await store.load(); vi.mocked(captureCandidate).mockClear();
    const observed = await store.context(state);
    expect(captureCandidate).toHaveBeenCalledTimes(1);
    expect(observed.candidate.files['source.txt']).toBe(digest('actual source'));
    vi.mocked(captureCandidate).mockClear();
    await store.transact({id:'pause',expectedRevision:0,actor:'owner',type:'run.pause',payload:{reason:'inspection'}});
    expect(captureCandidate).toHaveBeenCalledTimes(1);
  });
  it('ignores caller candidate and clock while capturing after imported blob verification', async () => {
    const {store,policy} = await fixture();
    await writeFile(path.join(policy.workspace,'source.txt'),'before');
    await store.transact({id:'item',expectedRevision:0,actor:'owner',type:'item.create',payload:{id:'item',objective:'Build',owner:'owner',affectedPaths:['output.txt'],dependencies:[],criteria:['works'],requiredArtifacts:{},requiredGates:[],triage:{}}});
    await store.transact({id:'activity',expectedRevision:1,actor:'owner',type:'activity.create',payload:{id:'activity',item:'item',kind:'criteria',requirements:['works'],dependencies:[]}});
    const prior = await store.context(await store.load());
    await writeFile(path.join(policy.workspace,'import.txt'),'import');
    const blob = await store.blob(Buffer.from('import'));
    const verify = store.verifiedBlob.bind(store);
    vi.spyOn(store,'verifiedBlob').mockImplementation(async (filename,hash) => {
      const bytes = await verify(filename,hash);
      await writeFile(path.join(policy.workspace,'source.txt'),'after-verification');
      return bytes;
    });
    const worker = {instance:'author',context:'context',provider:'manual',model:'fixture',settings:{},tools:[]};
    const artifact = {id:'observed',activity:'activity',version:1,hash:blob.hash,path:'import.txt',author:worker,inputs:[]};
    vi.mocked(captureCandidate).mockClear();
    const next = await store.transact({id:'start',expectedRevision:2,actor:'owner',type:'assignment.start',payload:{id:'author',item:'item',activity:'activity',role:'criteria',worker,inputs:{},writePaths:['output.txt'],affectedPaths:['output.txt'],resources:[],allowedActions:['write'],deadline:policy.deadline,deliverables:[]}}, {now:Number.MAX_SAFE_INTEGER,candidate:{...prior.candidate,policyHash:digest('forged policy'),digest:digest('forged candidate')},artifacts:{observed:artifact}});
    expect(captureCandidate).toHaveBeenCalledTimes(1);
    expect(next.assignments.author.baseline.files['source.txt']).toBe(digest('after-verification'));
    expect(next.assignments.author.policyHash).toBe(prior.candidate.policyHash);
    expect(next.assignments.author.baseline.digest).not.toBe(digest('forged candidate'));
  });
  it('persists CAS winner and rejects loser with no extra event', async () => {
    const { store } = await fixture();
    const event = { id:'pause',expectedRevision:0,actor:'owner',type:'run.pause',payload:{reason:'inspection'} };
    await store.transact(event);
    const reloaded = new LoopStore(store.directory); expect((await reloaded.load()).revision).toBe(1);
    await reloaded.transact(event); expect((await reloaded.load()).revision).toBe(1);
    await expect(reloaded.transact({ ...event,id:'loser' })).rejects.toThrow('revision conflict');
    expect((await reloaded.load()).events).toHaveLength(1);
  });
  it('requires explicit matching lock recovery and rejects malformed snapshots', async () => {
    const { store } = await fixture();
    await writeFile(path.join(store.directory,'lock.json'),JSON.stringify({token:'orphan'}));
    await expect(store.locked(async () => 1)).rejects.toThrow('Store locked');
    await expect(store.recoverLock('other','operations-stopped-and-side-effects-reconciled')).rejects.toThrow('ownership');
    expect(JSON.parse(await readFile(path.join(store.directory,'lock.json'),'utf8')).token).toBe('orphan');
    await store.recoverLock('orphan','operations-stopped-and-side-effects-reconciled');
    await writeFile(path.join(store.directory,'state.json'),'{');
    await expect(store.load()).rejects.toThrow('Invalid');
  });
  it('rejects imported metadata whose real source changed before locked commit', async () => {
    const { store, policy } = await fixture();
    await writeFile(path.join(policy.workspace,'artifact.txt'),'original'); await store.blob(Buffer.from('original'));
    const artifact = { id:'artifact',activity:'activity',version:1,hash:digest('original'),path:'artifact.txt',author:{instance:'author',context:'fresh',provider:'manual',model:'fixture',settings:{},tools:[]},inputs:[] };
    await writeFile(path.join(policy.workspace,'artifact.txt'),'changed-before-commit');
    await expect(store.transact({id:'pause',expectedRevision:0,actor:'owner',type:'run.pause',payload:{reason:'inspection'}},{artifacts:{artifact}})).rejects.toThrow('changed before commit');
    expect((await store.load()).revision).toBe(0);
  });
});

async function monitorFixture(kind: 'artifact' | 'evidence' | 'report' = 'artifact') {
  const f = await fixture(), state = await f.store.load();
  const candidate = await captureCandidate(f.policy);
  const worker = { instance:'worker',context:'fresh',provider:'manual',model:'fixture',settings:{},tools:[] };
  state.policy.gates.test = { executable:process.execPath,args:[],resources:[] };
  state.items.item = { id:'item',objective:'monitor',owner:'owner',affectedPaths:[],dependencies:[],criteria:['works'],requiredArtifacts:{},requiredGates:[],triage:{},status:'queued',needs:[],escalation:null };
  state.activities.activity = { id:'activity',item:'item',kind:'verification',requirements:['works'],dependencies:[],status:'open',rounds:0,authors:[],reviews:[] };
  state.assignments.assignment = { id:'assignment',item:'item',activity:'activity',role:'verifier',worker,inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:[],deadline:f.policy.deadline,deliverables:[],baseline:candidate,policyHash:candidate.policyHash,publicationToken:'token',status:'running',reconciled:false,reason:null };
  const report = { candidate,worker,criteria:{works:[]},limitations:[] };
  const bytes = Buffer.from(kind === 'report' ? JSON.stringify(report) : 'immutable monitor fixture');
  const blob = await f.store.blob(bytes);
  if (kind === 'evidence') state.evidence.evidence = { id:'evidence',assignment:'assignment',worker,gate:'test',candidate,executable:process.execPath,args:[],cwd:f.policy.workspace,started:1,finished:2,exitCode:0,outputHash:blob.hash,outputPath:blob.path,limitations:[],kind:'gate' };
  else state.artifacts.artifact = { id:'artifact',activity:'activity',version:1,hash:blob.hash,path:'artifact.txt',author:worker,inputs:[],assignment:'assignment',acceptedHash:null,candidate };
  if (kind === 'report') state.verificationReports.artifact = report;
  await f.store.save(state);
  const snapshot = await readFile(path.join(f.store.directory,'state.json'));
  return { ...f, state, bytes, blob, snapshot, filename:path.join(f.store.directory,'state.json') };
}
function counters(store: LoopStore) {
  vi.mocked(validateState).mockClear();
  const references = vi.spyOn(store,'verifiedBlob');
  return (v:number,r:number) => { expect(validateState).toHaveBeenCalledTimes(v); expect(references).toHaveBeenCalledTimes(r); };
}
describe('private assignment monitor', () => {
  for (const kind of ['artifact','evidence'] as const) it(kind+' rechecks hit integrity and resets failed cache', async () => {
    const f = await monitorFixture(kind), count = counters(f.store), poll = f.store.createAssignmentMonitor('assignment');
    for (let r=1;r<=3;r++) { expect(await poll()).toBe(true); count(1,r); }
    await writeFile(f.blob.path,'corrupted'); await expect(poll()).rejects.toThrow('integrity'); count(1,4);
    await writeFile(f.blob.path,f.bytes); expect(await poll()).toBe(true); count(2,5);
    expect(await poll()).toBe(true); count(2,6);
  });
  for (const failure of ['malformed','schema','missing','deleted','escaped','symlink'] as const) it(failure+' rejects after hit and restoration revalidates', async (context) => {
    const f=await monitorFixture(), count=counters(f.store),poll=f.store.createAssignmentMonitor('assignment');
    expect(await poll()).toBe(true); count(1,1);
    const outside=path.join(f.root,'outside'); await writeFile(outside,f.bytes);
    if(failure==='malformed')await writeFile(f.filename,'{');
    if(failure==='schema')await writeFile(f.filename,'{}');
    if(failure==='missing')await unlink(f.filename);
    if(failure==='deleted')await unlink(f.blob.path);
    if(failure==='escaped'||failure==='symlink'){
      await rename(f.blob.path,f.blob.path+'.backup');
      try { await symlink(failure==='escaped'?outside:f.blob.path+'.backup',f.blob.path,'file'); }
      catch(error){if((error as NodeJS.ErrnoException).code==='EPERM'){await rename(f.blob.path+'.backup',f.blob.path);console.warn('Symlink instrument unavailable: EPERM');context.skip();return;}throw error;}
    }
    await expect(poll()).rejects.toThrow();
    count(failure==='schema'?2:1,['deleted','escaped','symlink'].includes(failure)?2:1);
    if(failure==='escaped'||failure==='symlink'){await unlink(f.blob.path);await rename(f.blob.path+'.backup',f.blob.path);}
    if(failure==='deleted')await writeFile(f.blob.path,f.bytes);
    await writeFile(f.filename,f.snapshot);expect(await poll()).toBe(true);
    count(failure==='schema'?3:2,['deleted','escaped','symlink'].includes(failure)?3:2);
  });
  it('revalidates equal-length bytes despite restored mtime and returns false for absence',async()=>{
    const f=await monitorFixture(), cancelled=structuredClone(f.state);cancelled.assignments.assignment.status='cancelled';
    const original=JSON.stringify(f.state),changed=JSON.stringify(cancelled),length=Math.max(original.length,changed.length);
    await writeFile(f.filename,original.padEnd(length));const times=await stat(f.filename),count=counters(f.store),poll=f.store.createAssignmentMonitor('assignment');
    expect(await poll()).toBe(true);count(1,1);
    await writeFile(f.filename,changed.padEnd(length));await utimes(f.filename,times.atime,times.mtime);
    expect((await stat(f.filename)).size).toBe(length);expect(await poll()).toBe(false);count(2,2);
    cancelled.artifacts={};cancelled.assignments={};await f.store.save(cancelled);expect(await poll()).toBe(false);count(3,2);
  });
  it('isolates monitors and uncached public results across store instances and directories',async()=>{
    const f=await monitorFixture(),other=await monitorFixture(),count=counters(f.store),poll=f.store.createAssignmentMonitor('assignment');
    expect(await poll()).toBe(true);count(1,1);
    const loaded=await f.store.load();loaded.assignments.assignment.status='cancelled';await f.store.load();count(3,3);
    expect(await poll()).toBe(true);count(3,4);
    expect(await f.store.createAssignmentMonitor('assignment')()).toBe(true);count(4,5);
    expect(await new LoopStore(f.store.directory).createAssignmentMonitor('assignment')()).toBe(true);
    expect(await other.store.createAssignmentMonitor('assignment')()).toBe(true);expect(validateState).toHaveBeenCalledTimes(6);
  });
  it('checks canonical report binding on changed snapshots',async()=>{
    const f=await monitorFixture('report'),count=counters(f.store),poll=f.store.createAssignmentMonitor('assignment');
    expect(await poll()).toBe(true);count(1,2);
    f.state.verificationReports.artifact.limitations.push('changed');await f.store.save(f.state);
    await expect(poll()).rejects.toThrow('Report bytes');count(2,4);
  });
});

it('rejects evidence outside immutable store containment',async()=>{
 const f=await monitorFixture('evidence'),poll=f.store.createAssignmentMonitor('assignment');expect(await poll()).toBe(true);
 const outside=path.join(f.root,'outside-evidence');await writeFile(outside,f.bytes);f.state.evidence.evidence.outputPath=outside;await f.store.save(f.state);
 await expect(poll()).rejects.toThrow('escapes immutable store');
 await writeFile(f.filename,f.snapshot);expect(await poll()).toBe(true);
});
