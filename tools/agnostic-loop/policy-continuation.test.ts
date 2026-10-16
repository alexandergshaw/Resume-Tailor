import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEvent, createState, currentEvidence } from './engine';
import { canonical, digest } from './json';
import { LoopStore } from './store';
import { validateEvent } from './validation';
import type { Activity, Context, Envelope, LoopState } from './types';

const hash = 'a'.repeat(64);
const worker = { instance:'worker',context:'context',provider:'manual',model:'requested',settings:{},tools:[] };
function initial(): LoopState {
  return createState({owner:'owner',workspace:'C:/work',allowedActions:['run'],candidateExclusions:[],environmentKeys:[],externalFiles:[],gates:{regression:{executable:process.execPath,args:['old.js','--run'],resources:['workspace']}},concurrency:1,deadline:100,maxAssignments:1,commandTimeout:100});
}
function context(s: LoopState): Context {
  return {now:200,manualPolicyContinuation:true,candidate:{digest:hash,files:{},policyHash:digest(canonical(s.policy)),environmentHash:hash,toolHash:hash},artifacts:{},evidence:{}};
}
function event(s: LoopState): Envelope {
  return {id:'continue-1',expectedRevision:s.revision,actor:'owner',type:'policy.continue',payload:{priorPolicyHash:digest(canonical(s.policy)),deadline:300,maxExtensionMs:100,authorization:'owner-message-1',reason:'Correct malformed gate path and allow verification',gateArgumentCorrections:[{gate:'regression',index:0,previous:'old.js',replacement:'correct.js'}]}};
}
function retained(): LoopState {
  const s = initial(), c = context(s);
  s.items.item = {id:'item',objective:'Build',owner:'owner',affectedPaths:[],dependencies:[],criteria:['c'],requiredArtifacts:{},requiredGates:['regression'],triage:{},status:'implemented',needs:['missing verification'],escalation:'recorded'};
  s.activities.activity = {id:'activity',item:'item',kind:'implementation',requirements:['c'],dependencies:[],status:'owner-needed',rounds:2,authors:[worker],reviews:[1,2].map<Activity['reviews'][number]>(n => ({artifact:`artifact-${n}`,hash,verdict:'defective',findings:[{severity:'P1',mechanism:'failure',classification:n === 1 ? 'new' : 'repeat',need:'ruling'}]}))};
  s.assignments.consumed = {id:'consumed',item:'item',activity:'activity',role:'implementer',worker,inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:['run'],deadline:90,deliverables:[],baseline:c.candidate,policyHash:c.candidate.policyHash,publicationToken:'consumed-token',status:'finished',reconciled:false,reason:null};
  s.operations.operation = {id:'operation',assignment:'consumed',resource:'workspace',status:'terminated',publicationToken:'consumed-token',pid:1,reconciled:true};
  s.evidence.failed = {id:'failed',assignment:'consumed',worker,gate:'regression',candidate:c.candidate,executable:process.execPath,args:['old.js'],cwd:'C:/work',started:10,finished:20,exitCode:1,outputHash:hash,outputPath:'output',limitations:[],kind:'gate'};
  s.evidence.passed = {...s.evidence.failed,id:'passed',exitCode:0};
  return s;
}

describe('manual owner policy continuation', () => {
  it('preserves all rounds, failures, consumed budgets and history while staling candidate evidence', () => {
    const s = retained(), e = event(s), next = applyEvent(s,e,context(s));
    const expected = structuredClone(s); expected.policy.deadline = 300; expected.policy.gates.regression.args[0] = 'correct.js'; expected.revision++; expected.events.push(e);
    expect(next).toEqual(expected);
    expect(s.policy.deadline).toBe(100);
    expect(next.activities.activity.rounds).toBe(2);
    expect(next.policy.maxAssignments - Object.keys(next.assignments).length).toBe(0);
    expect(next.evidence.failed.exitCode).toBe(1);
    expect(() => currentEvidence(next,'passed',context(next))).toThrow('stale');
    expect(applyEvent(next,e,context(next))).toBe(next);
    expect(() => applyEvent(next,{...event(next),id:'replay'},context(next))).toThrow('already consumed');
  });
  it('requires owner, locked manual observation and exact current policy binding', () => {
    const s = initial(), e = event(s), c = context(s);
    expect(() => applyEvent(s,{...e,actor:'worker'},c)).toThrow('owner');
    expect(() => applyEvent(s,e,{...c,manualPolicyContinuation:false})).toThrow('manual-store');
    expect(() => applyEvent(s,{...e,payload:{...e.payload,priorPolicyHash:hash}},c)).toThrow('binding');
    expect(() => applyEvent(s,e,{...c,candidate:{...c.candidate,policyHash:hash}})).toThrow('binding');
    expect(() => applyEvent(s,{...e,expectedRevision:1},c)).toThrow('revision');
    expect(() => applyEvent({...s,runStatus:'cancelled'},e,c)).toThrow('cancelled');
  });
  it('requires every assignment and operation globally quiescent and reconciled', () => {
    for (const status of ['running','cancelled','quarantined'] as const) {
      const s = retained(); s.assignments.consumed.status = status;
      expect(() => applyEvent(s,event(s),context(s))).toThrow('assignments');
    }
    for (const status of ['pending','running','unknown','terminated'] as const) {
      const s = retained(); s.operations.operation.status = status; s.operations.operation.reconciled = false;
      expect(() => applyEvent(s,event(s),context(s))).toThrow('operations');
    }
    const s = retained(); s.assignments.consumed.status = 'cancelled'; s.assignments.consumed.reconciled = true;
    expect(() => applyEvent(s,event(s),context(s))).not.toThrow();
  });
  it('rejects window overruns and widening policy beyond exact existing argument slots', () => {
    const s = initial(), e = event(s), c = context(s);
    for (const delta of [{deadline:301},{deadline:200},{deadline:100},{maxExtensionMs:0},{maxAssignments:10},{gates:{}},{commandTimeout:1000},{workspace:'other'}]) {
      expect(() => applyEvent(s,{...e,payload:{...e.payload,...delta}},c)).toThrow();
    }
    const correction = {gate:'regression',index:0,previous:'old.js',replacement:'correct.js'};
    for (const corrections of [[{...correction,gate:'new'}],[{...correction,index:2}],[{...correction,previous:'other'}],[correction,correction],[{...correction,replacement:'old.js'}]]) {
      expect(() => applyEvent(s,{...e,payload:{...e.payload,gateArgumentCorrections:corrections}},c)).toThrow();
    }
    expect(() => validateEvent({...e,payload:{...e.payload,gateArgumentCorrections:[{...correction,executable:'other'}]}})).toThrow('unsupported');
  });
  it('derives manual mode under the public store lock and cannot be overridden by caller observations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(),'loop-continuation-'));
    try {
      const workspace = path.join(root,'workspace'); await mkdir(workspace);
      const store = new LoopStore(path.join(root,'state'));
      const s = await store.init({...initial().policy,workspace,deadline:1});
      const e = event(s); e.payload.deadline = Date.now() + 30_000; e.payload.maxExtensionMs = 45 * 60_000;
      for (const marker of ['dispatch-config.json','dispatch-journal.json']) {
        const location = path.join(store.directory,marker); await writeFile(location,'{}');
        await expect(store.transact(e,{manualPolicyContinuation:true})).rejects.toThrow('native dispatch');
        expect((await store.load()).revision).toBe(0); await rm(location);
      }
      const next = await store.transact(e,{manualPolicyContinuation:false});
      expect(next.policy.gates.regression.args[0]).toBe('correct.js');
      expect((await store.load()).events[0]).toEqual(e);
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
