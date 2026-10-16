import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from './cli';
import { applyEvent, createState } from './engine';
import { canonical, digest } from './json';
import { LoopStore } from './store';
import type { Assignment, Context, FinalReport, Residual, Worker } from './types';

const roots: string[] = [];
afterEach(async () => {vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
const worker = (id: string): Worker => ({instance:id,context:id,provider:'manual',model:'requested-fixture',settings:{},tools:[]});
const residual: Residual = {requirement:'Live proof',owner:'owner',instrument:'browser',step:'Before activation',closure:'Observed proof recorded'};
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(),'manual-final-cli-')); roots.push(root);
  const store = new LoopStore(path.join(root,'store')), workspace = path.join(root,'deliberately-absent-workspace');
  const now = Date.now(), deadline = now + 60_000;
  let state = createState({owner:'owner',workspace,allowedActions:['write','run','import'],candidateExclusions:['artifacts'],environmentKeys:[],externalFiles:[],gates:{regression:{executable:path.join(root,'absent-gate.exe'),args:['gate.js'],resources:['workspace']}},concurrency:3,deadline,maxAssignments:10,commandTimeout:1000});
  const lineage = {files:{'source.ts':digest('recorded snapshot')},policyHash:digest(canonical(state.policy)),environmentHash:digest('recorded env'),toolHash:digest('recorded tool')};
  const candidate = {digest:digest(canonical(lineage)),...lineage};
  state.items.item = {id:'item',objective:'Deliver locally',owner:'owner',affectedPaths:['artifacts/final.json'],dependencies:[],criteria:['works'],requiredArtifacts:{},requiredGates:['regression'],triage:{},status:'verified',needs:[],escalation:null};
  for (const [id,kind] of [['verification','verification'],['whole','whole-change-review'],['final','final-report']]) {
    state.activities[id] = {id,item:'item',kind,requirements:['works'],dependencies:[],status:id === 'final' ? 'open' : 'accepted',rounds:0,authors:[],reviews:[]};
  }
  const author = (id: string, activity: string, role: string): Assignment => ({id,item:'item',activity,role,worker:worker(id),inputs:{},writePaths:[],affectedPaths:[],resources:['workspace'],allowedActions:['write','run'],deadline,deliverables:[],baseline:candidate,policyHash:candidate.policyHash,publicationToken:`recorded-${id}`,status:'finished',reconciled:true,reason:null});
  state.assignments.verifier = author('verifier','verification','verifier');
  state.assignments.reviewer = author('reviewer','whole','specialist');
  const output = await store.blob(Buffer.from('recorded gate pass'));
  state.evidence.pass = {id:'pass',assignment:'verifier',worker:worker('verifier'),gate:'regression',candidate,executable:state.policy.gates.regression.executable,args:['gate.js'],cwd:workspace,started:now-100,finished:now-50,exitCode:0,outputHash:output.hash,outputPath:output.path,limitations:[],kind:'gate'};
  const verification = {candidate,worker:worker('verifier'),criteria:{works:['pass']},limitations:['Recorded fixture; no live freshness claim']};
  const verificationBlob = await store.blob(Buffer.from(canonical(verification)));
  const wholeBlob = await store.blob(Buffer.from('Recorded whole-change review'));
  state.artifacts.verification = {id:'verification',activity:'verification',assignment:'verifier',version:1,hash:verificationBlob.hash,path:'artifacts/verification.json',author:worker('verifier'),inputs:[],acceptedHash:verificationBlob.hash,candidate};
  state.artifacts.whole = {id:'whole',activity:'whole',assignment:'reviewer',version:1,hash:wholeBlob.hash,path:'artifacts/whole.json',author:worker('reviewer'),inputs:[],acceptedHash:wholeBlob.hash,candidate};
  state.verificationReports.verification = verification;
  const context: Context = {now,candidate,artifacts:state.artifacts,evidence:state.evidence};
  state = applyEvent(state,{id:'admit-finalizer',expectedRevision:0,actor:'owner',type:'assignment.start',payload:{id:'finalizer',item:'item',activity:'final',role:'finalizer',worker:worker('finalizer'),inputs:{verification:verificationBlob.hash,whole:wholeBlob.hash},writePaths:['artifacts/final.json'],affectedPaths:['artifacts/final.json'],resources:[],allowedActions:['write','import'],deadline,deliverables:['final-report']}},context);
  await store.save(state);
  const residuals = path.join(root,'residuals.json'); await writeFile(residuals,JSON.stringify([residual]));
  const expected: FinalReport = {candidate,verificationArtifact:'verification',regressionEvidence:['pass'],wholeChangeReviewArtifact:'whole',residuals:[residual],delivery:'local'};
  return {root,store,state,residuals,expected};
}
async function snapshot(directory: string): Promise<Record<string,string>> {
  const files: Record<string,string> = {};
  async function visit(current: string) {
    for (const entry of await readdir(current,{withFileTypes:true})) {
      const filename = path.join(current,entry.name);
      if (entry.isDirectory()) await visit(filename); else files[path.relative(directory,filename)] = digest(await readFile(filename));
    }
  }
  await visit(directory); return files;
}
const run = (args: string[]) => spawnSync(process.execPath,['--experimental-strip-types','--experimental-default-type=module','--experimental-loader','./tools/resolve-ts-hook.ts','./tools/agnostic-loop/cli.ts',...args],{cwd:process.cwd(),encoding:'utf8',timeout:15_000});

describe('public manual final assembly CLI', () => {
  it('dispatches recorded assembly without live context or writes and validates real immutable blobs', async () => {
    const f = await fixture(), before = await snapshot(f.root);
    const context = vi.spyOn(LoopStore.prototype,'context').mockRejectedValue(new Error('Live context must not be requested'));
    expect(await dispatch(['assemble-final','finalizer',f.residuals,'--state',f.store.directory])).toEqual(f.expected);
    expect(context).not.toHaveBeenCalled(); expect(await snapshot(f.root)).toEqual(before);
    const artifact = f.state.artifacts.verification;
    await writeFile(path.join(f.store.directory,'blobs',artifact.hash),'corrupt');
    await expect(dispatch(['assemble-final','finalizer',f.residuals,'--state',f.store.directory])).rejects.toThrow('integrity');
  });
  it('prints the exact six-field report nested under result in actual executable stdout', async () => {
    const f = await fixture(), before = await snapshot(f.root);
    const result = run(['assemble-final','finalizer',f.residuals,'--state',f.store.directory]);
    expect(result.status,result.stderr).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope).toEqual({ok:true,result:f.expected}); expect(Object.keys(envelope.result)).toHaveLength(6);
    expect(await snapshot(f.root)).toEqual(before);
  });
  it('rejects missing, invalid, expired assignments and malformed residuals without file or state mutation', async () => {
    const f = await fixture();
    for (const args of [
      ['assemble-final','missing',f.residuals,'--state',f.store.directory],
      ['assemble-final','verifier',f.residuals,'--state',f.store.directory],
      ['assemble-final','finalizer','--state',f.store.directory],
    ]) {
      const before = await snapshot(f.root), result = run(args);
      expect(result.status).toBe(1); expect(JSON.parse(result.stdout).ok).toBe(false); expect(await snapshot(f.root)).toEqual(before);
    }
    for (const contents of ['{','{}','[{}]']) {
      await writeFile(f.residuals,contents); const before = await snapshot(f.root);
      const result = run(['assemble-final','finalizer',f.residuals,'--state',f.store.directory]);
      expect(result.status).toBe(1); expect(JSON.parse(result.stdout).ok).toBe(false); expect(await snapshot(f.root)).toEqual(before);
    }
    await writeFile(f.residuals,'[]'); f.state.assignments.finalizer.deadline = Date.now()-1; await f.store.save(f.state);
    const before = await snapshot(f.root), expired = run(['assemble-final','finalizer',f.residuals,'--state',f.store.directory]);
    expect(expired.status).toBe(1); expect(JSON.parse(expired.stdout).ok).toBe(false); expect(await snapshot(f.root)).toEqual(before);
  },30_000);
  it('retains live context and trusted actor checks on existing mutation routes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(),'manual-cli-mutation-')); roots.push(root);
    const workspace = path.join(root,'workspace'); await mkdir(workspace);
    const store = new LoopStore(path.join(root,'store'));
    await store.init({owner:'owner',workspace,allowedActions:[],candidateExclusions:[],environmentKeys:[],externalFiles:[],gates:{},concurrency:1,deadline:Date.now()+60_000,maxAssignments:1,commandTimeout:1000});
    const eventFile = path.join(root,'pause.json'); await writeFile(eventFile,JSON.stringify({id:'pause',expectedRevision:0,type:'run.pause',payload:{reason:'inspection'}}));
    const context = vi.spyOn(LoopStore.prototype,'context'), before = await snapshot(root);
    await expect(dispatch(['apply',eventFile,'--state',store.directory])).rejects.toThrow('explicit trusted operator');
    expect(context).toHaveBeenCalledTimes(1);
    await expect(dispatch(['apply',eventFile,'--state',store.directory,'--actor','worker'])).rejects.toThrow('owner authority');
    expect(context).toHaveBeenCalledTimes(2); expect(await snapshot(root)).toEqual(before);
    await dispatch(['apply',eventFile,'--state',store.directory,'--actor','owner']);
    expect((await store.load()).runStatus).toBe('paused');
  });
});
