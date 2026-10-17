import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyEvent, createState } from './engine';
import { requireLiveVerification, LIVE_APP_URL } from './live-verification';
import { importSyntheticLiveVerification } from './live-verification-fixtures';
import { LoopStore } from './store';
import { observeEvent } from './observed';
import { assessManualHandoff } from './manual-handoff';
import type { Candidate, Context, LiveVerificationReport, LoopState, Worker } from './types';
const h = 'a'.repeat(64), worker = (id:string): Worker => ({instance:id,context:id,provider:'offline-test',model:'not-observed',settings:{},tools:[]});
const candidate: Candidate = {digest:h,files:{'tools/input.ts':h},policyHash:h,environmentHash:h,toolHash:h};
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
function fixture(live=true) {
  const state = createState({owner:'owner',workspace:'C:/fixture',allowedActions:['write','review'],candidateExclusions:['artifacts'],environmentKeys:[],externalFiles:[],gates:{},concurrency:2,deadline:10_000,maxAssignments:30,commandTimeout:1000});
  const item = state.items.item = {id:'item',objective:'Engine only',owner:'owner',affectedPaths:['tools/input.ts'],dependencies:[],criteria:['C1'],requiredArtifacts:{},requiredGates:[],triage:{},status:'regression-passed',needs:[],escalation:null};
  const add = (id:string,kind:string,role:'verifier'|'specialist'|'finalizer'|'checker') => {
    state.activities[id] = {id,item:'item',kind,requirements:['C1'],dependencies:[],status:'accepted',rounds:0,authors:[worker(id)],reviews:[]};
    state.assignments[id] = {id,item:'item',activity:id,role,worker:worker(id),inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:['write','review'],deadline:10_000,deliverables:[],baseline:candidate,policyHash:h,publicationToken:id,status:'finished',reconciled:true,reason:null};
    state.artifacts[id] = {id,activity:id,version:1,hash:h,path:`artifacts/${id}.json`,author:worker(id),inputs:[],assignment:id,acceptedHash:h,candidate};
  };
  add('verification','verification','verifier'); add('whole','whole-change-review','specialist'); add('final','final-report','finalizer');
  state.verificationReports.verification = {candidate,worker:worker('verification'),criteria:{C1:['unused']},limitations:[]};
  state.finalReports.final = {candidate,verificationArtifact:'verification',regressionEvidence:[],wholeChangeReviewArtifact:'whole',residuals:[],delivery:'local'};
  if (live) {
    add('observation','live-observation','specialist'); add('live','live-verification','verifier');
    state.artifacts.live.inputs = ['observation'];
    state.assignments.check = {...state.assignments.live,id:'check',role:'checker',worker:worker('check')};
    state.events.push({id:'review',expectedRevision:0,actor:'owner',type:'review.record',payload:{assignment:'check',artifact:'live',hash:h,verdict:'clean',findings:[]}});state.revision=1;
    state.liveVerificationReports = {live:{schemaVersion:1,candidate,worker:worker('live'),mode:'smoke',scopeRationale:'Only engine code changed; smoke does not validate engine correctness',url:LIVE_APP_URL,started:1,finished:2,deployedRevision:'commit-known',candidateBinding:{explanation:'Exact application subset unchanged at deployed revision',evidence:['observation']},steps:[{id:'smoke',expected:'Live app opens',observed:'Live app opened',status:'passed',evidence:['observation']}],criteria:{C1:{steps:[],nonLiveReason:'Engine correctness measured by engine tests'}},cleanup:{status:'not-needed',details:'Read-only observation',evidence:[]},limitations:['Synthetic protocol fixture; no actual browser observation']}};
  }
  const context: Context = {candidate,now:10,artifacts:Object.fromEntries(Object.entries(state.artifacts).map(([id,a]) => [id,{id:a.id,activity:a.activity,version:a.version,hash:a.hash,path:a.path,author:a.author,inputs:a.inputs}])),evidence:{}};
  return {state,item,context};
}
function ship(state: LoopState,context: Context) { return applyEvent(state,{id:'ship',expectedRevision:state.revision,actor:'owner',type:'item.advance',payload:{item:'item',status:'shipped',artifacts:['final'],evidence:[]}},context); }
describe('mandatory live-app completion protocol', () => {
  it('rejects an otherwise complete shipped transition missing only live acceptance', () => {
    const f=fixture(false); expect(() => ship(f.state,f.context)).toThrow('Live verification pending'); expect(f.item.status).toBe('regression-passed');
  });
  it('accepts current independent evidence and keeps historical shipped snapshots pending without it', () => {
    const f=fixture(); expect(requireLiveVerification(f.state,f.item,f.context)).toBe('live'); expect(ship(f.state,f.context).items.item.status).toBe('shipped');
    f.item.status='shipped'; expect(assessManualHandoff(f.state,['item'],10,f.context).complete).toBe(true); expect(assessManualHandoff(f.state,['item'],10).complete).toBe(false);
    delete f.state.liveVerificationReports; expect(assessManualHandoff(f.state,['item'],10,f.context).complete).toBe(false);
  });
  it.each(['digest','policyHash','environmentHash','toolHash'] as const)('rejects changed candidate %s', key => {
    const f=fixture();f.context.candidate={...candidate,[key]:'b'.repeat(64)};expect(() => requireLiveVerification(f.state,f.item,f.context)).toThrow('stale');
  });
  it.each(['http://localhost:3000/','https://example.com/','https://resume-tailor-tan-psi.vercel.app/?redirect=other','https://resume-tailor-tan-psi.vercel.app/#fake','https://user:pass@resume-tailor-tan-psi.vercel.app/'])('rejects untrusted target %s',url => {
    const f=fixture();f.state.liveVerificationReports!.live.url=url;expect(() => requireLiveVerification(f.state,f.item,f.context)).toThrow('trusted');
  });
  it.each(['unknown-revision','missing-binding','pending-step','empty-steps','missing-criterion','missing-step','pending-cleanup','missing-cleanup-evidence','self-check','shared-context','missing-observation','unaccepted-observation','stale-source','superseded-report','future-time','unbounded-time','old-observation','product-smoke'])("rejects %s",fault => {
    const f=fixture(), report=f.state.liveVerificationReports!.live;
    if(fault==='unknown-revision')report.deployedRevision=null;
    if(fault==='missing-binding')report.candidateBinding.evidence=[];
    if(fault==='pending-step')report.steps[0].status='pending';
    if(fault==='empty-steps')report.steps=[];
    if(fault==='missing-criterion')report.criteria={};
    if(fault==='missing-step')report.criteria.C1={steps:['missing'],nonLiveReason:null};
    if(fault==='pending-cleanup')report.cleanup.status='pending';
    if(fault==='missing-cleanup-evidence')report.cleanup.status='complete';
    if(fault==='self-check')f.state.assignments.check.worker=worker('live');
    if(fault==='shared-context')f.state.assignments.check.worker.context='live';
    if(fault==='missing-observation')delete f.context.artifacts.observation;
    if(fault==='unaccepted-observation')f.state.artifacts.observation.acceptedHash=null;
    if(fault==='stale-source')f.context.artifacts.live.hash='b'.repeat(64);
    if(fault==='superseded-report')f.state.artifacts.new={...f.state.artifacts.live,id:'new',version:2};
    if(fault==='future-time')report.finished=11;
    if(fault==='unbounded-time'){report.finished=3_600_002;f.context.now=3_600_003;f.state.assignments.live.deadline=4_000_000;}
    if(fault==='old-observation')f.context.now=86_400_003;
    if(fault==='product-smoke')f.item.affectedPaths=['hello-world/app/page.js'];
    expect(() => requireLiveVerification(f.state,f.item,f.context)).toThrow(/Live verification/);
  });
  it('admits only scoped live recovery on historical shipped items', () => {
    const f=fixture(false);f.item.status='shipped';
    f.state.activities.recovery={id:'recovery',item:'item',kind:'live-verification',requirements:['C1'],dependencies:[],status:'open',rounds:0,authors:[],reviews:[]};
    const admission={id:'recover',item:'item',activity:'recovery',role:'verifier',worker:worker('recover'),inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:[],deadline:100,deliverables:[]};
    const event={id:'recover',expectedRevision:f.state.revision,actor:'owner',type:'assignment.start',payload:admission};
    expect(applyEvent(f.state,event,f.context).assignments.recover.status).toBe('running');
    expect(() => applyEvent(f.state,{...event,payload:{...admission,role:'implementer'}},f.context)).toThrow('already shipped');
  });
  it('exempts only exact referenced startup-excluded runtime records from smoke scope', () => {
    const f=fixture();f.state.policy.candidateExclusions=['.agnostic-loop'];
    f.state.artifacts.live.path='.agnostic-loop/live.json';f.context.artifacts.live.path='.agnostic-loop/live.json';
    f.state.artifacts.observation.path='.agnostic-loop/observation.json';f.context.artifacts.observation.path='.agnostic-loop/observation.json';
    f.item.affectedPaths=['tools/input.ts','.AGNOSTIC-LOOP/live.json','.agnostic-loop/observation.json'];
    expect(requireLiveVerification(f.state,f.item,f.context)).toBe('live');
    f.item.affectedPaths.push('.agnostic-loop/unreferenced.json');expect(() => requireLiveVerification(f.state,f.item,f.context)).toThrow('smoke requires');
    f.item.affectedPaths.pop();f.state.policy.candidateExclusions=['artifacts'];expect(() => requireLiveVerification(f.state,f.item,f.context)).toThrow('smoke requires');
    f.state.policy.candidateExclusions=['.agnostic-loop-evil'];f.state.artifacts.live.path='.agnostic-loop-evil/live.json';f.context.artifacts.live.path='.agnostic-loop-evil/live.json';f.state.artifacts.observation.path='.agnostic-loop-evil/observation.json';f.context.artifacts.observation.path='.agnostic-loop-evil/observation.json';f.item.affectedPaths=['tools/input.ts','.agnostic-loop-evil/live.json','.agnostic-loop-evil/observation.json'];expect(() => requireLiveVerification(f.state,f.item,f.context)).toThrow('smoke requires');
  });
  it('public CLI smoke accepts declared runtime records and rejects referenced excluded product paths', async () => {
    for (const observationPath of ['.agnostic-loop/observation.json','hello-world/app/page.js']) {
      const root=await mkdtemp(path.join(os.tmpdir(),'live-smoke-cli-'));roots.push(root);const workspace=path.join(root,'workspace'),directory=path.join(root,'state');
      await mkdir(path.join(workspace,'tools'),{recursive:true});await mkdir(path.dirname(path.join(workspace,observationPath)),{recursive:true});await mkdir(path.join(workspace,'.agnostic-loop'),{recursive:true});await writeFile(path.join(workspace,'tools/source.ts'),'export const value=1;');
      const policyPath=path.join(root,'policy.json');await writeFile(policyPath,JSON.stringify({owner:'owner',workspace,allowedActions:['write','review'],candidateExclusions:['.agnostic-loop',...(observationPath.startsWith('hello-world/')?[observationPath]:[])],environmentKeys:[],externalFiles:[],gates:{},concurrency:2,deadline:Date.now()+120_000,maxAssignments:30,commandTimeout:1000}));
      const cliFlags=['--experimental-strip-types','--experimental-default-type=module','--experimental-loader',pathToFileURL(path.resolve('tools/resolve-ts-hook.ts')).href,path.resolve('tools/agnostic-loop/cli.ts')];
      const run=(args:string[],success=true) => {
        const executed=spawnSync(process.execPath,[...cliFlags,...args],{encoding:'utf8',timeout:30_000,windowsHide:true});
        expect(executed.status,executed.stdout+executed.stderr).toBe(success?0:1);const envelope=JSON.parse(executed.stdout);expect(envelope.ok).toBe(success);return envelope;
      };
      run(['init','--state',directory,'--workspace',workspace,'--policy',policyPath]);let sequence=0;
      const snapshot=async () => JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')) as LoopState;
      const event=async (type:string,payload:Record<string,unknown>,success=true) => {
        const state=await snapshot(),file=path.join(root,`event-${++sequence}.json`);await writeFile(file,JSON.stringify({id:`event-${sequence}`,expectedRevision:state.revision,actor:'owner',type,payload}));return run(['apply',file,'--state',directory,'--actor','owner'],success);
      };
      const reportPath='.agnostic-loop/live-report.json';
      await event('item.create',{id:'item',objective:'Engine smoke protocol test',owner:'owner',affectedPaths:['tools/source.ts',observationPath,reportPath],dependencies:[],criteria:['engine'],requiredArtifacts:{},requiredGates:[],triage:{}});
      const activity=async (id:string,kind:string) => event('activity.create',{id,item:'item',kind,requirements:['engine'],dependencies:[]});
      const start=async (id:string,activity:string,role:string,files:string[],inputs:Record<string,string>={}) => event('assignment.start',{id,item:'item',activity,role,worker:worker(id),inputs,writePaths:files,affectedPaths:files,resources:[],allowedActions:role==='checker'?['review']:['write'],deadline:Date.now()+60_000,deliverables:[]});
      const review=async (id:string,activity:string) => {
        const assignment=`${id}-checker`;await start(assignment,activity,'checker',[]);await event('review.record',{assignment,artifact:id,hash:(await snapshot()).artifacts[id].hash,verdict:'clean',findings:[]});await event('assignment.finish',{assignment});
      };
      await activity('observation','live-observation');await start('observation-author','observation','specialist',[observationPath]);await writeFile(path.join(workspace,observationPath),JSON.stringify({synthetic:true,limitation:'Protocol fixture only; no actual live browser'}));run(['import','observation-author','observation',path.join(workspace,observationPath),'--state',directory,'--actor','owner']);await event('assignment.finish',{assignment:'observation-author'});await review('observation','observation');
      await activity('live','live-verification');await start('live-author','live','verifier',[reportPath],{observation:(await snapshot()).artifacts.observation.hash});
      const current=run(['status','--state',directory]).result.candidate as Candidate,now=Date.now();
      const report:LiveVerificationReport={schemaVersion:1,candidate:current,worker:worker('live-author'),mode:'smoke',scopeRationale:'Engine-only source; smoke is separate from engine correctness tests',url:LIVE_APP_URL,started:now,finished:now,deployedRevision:'synthetic-known-revision',candidateBinding:{explanation:'Synthetic offline binding for public transport testing',evidence:['observation']},steps:[{id:'navigate',expected:'Open live app',observed:'Synthetic observation only',status:'passed',evidence:['observation']}],criteria:{engine:{steps:[],nonLiveReason:'Engine correctness measured by engine tests'}},cleanup:{status:'not-needed',details:'Offline fixture creates no live data',evidence:[]},limitations:['Synthetic protocol test; does not verify actual live app']};
      await writeFile(path.join(workspace,reportPath),JSON.stringify(report));run(['import','live-author','live',path.join(workspace,reportPath),'--state',directory,'--actor','owner']);
      const positive=observationPath.startsWith('.agnostic-loop/'),record=await event('live-verification.record',{assignment:'live-author',artifact:'live',report},positive);
      if(positive){await event('assignment.finish',{assignment:'live-author'});await review('live','live');expect(run(['status','--state',directory,'--output','summary']).result.items[0].liveVerification).toBe('live');}
      else {expect(record.error).toContain('smoke requires');expect((await snapshot()).liveVerificationReports).toEqual({});}
    }
  },180_000);
  it('imports actual immutable live bytes through public lifecycle and detects payload/blob tampering after reload', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'live-protocol-')); roots.push(root);const workspace=path.join(root,'workspace');await mkdir(workspace);
    const store=new LoopStore(path.join(root,'state'));await store.init({owner:'owner',workspace,allowedActions:['write','review'],candidateExclusions:['artifacts'],environmentKeys:[],externalFiles:[],gates:{},concurrency:2,deadline:Date.now()+60_000,maxAssignments:30,commandTimeout:1000});
    let state=await store.load();await store.transact({id:'item',expectedRevision:0,actor:'owner',type:'item.create',payload:{id:'item',objective:'Protocol test',owner:'owner',affectedPaths:[],dependencies:[],criteria:['C1'],requiredArtifacts:{},requiredGates:[],triage:{}}});
    const id=await importSyntheticLiveVerification(store,'item');state=await new LoopStore(store.directory).load();const context=await store.context(state);expect(requireLiveVerification(state,state.items.item,context)).toBe(id);
    const report=structuredClone(state.liveVerificationReports![id]);report.scopeRationale='forged';await expect(observeEvent(store,{id:'forged',expectedRevision:state.revision,actor:'owner',type:'live-verification.record',payload:{assignment:id,artifact:id,report}})).rejects.toThrow('immutable bytes');
    const filename=path.join(store.directory,'blobs',state.artifacts[id].hash), original=await readFile(filename);await writeFile(filename,'tampered');await expect(store.load()).rejects.toThrow('integrity');await writeFile(filename,original);expect((await store.load()).liveVerificationReports![id]).toBeDefined();
  });
});
