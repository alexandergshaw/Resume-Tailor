import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createState } from './engine';
import { assessManualHandoff } from './manual-handoff';
import type { Assignment, Item, LoopState } from './types';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
function fixture(): LoopState {
  const state = createState({ owner: 'operator', workspace: process.cwd(), allowedActions: ['read'], candidateExclusions: [], environmentKeys: [], externalFiles: [], gates: {}, concurrency: 1, deadline: Date.now() + 60000, maxAssignments: 10, commandTimeout: 1000 });
  state.items.feature = { id: 'feature', objective: 'Deliver feature', owner: 'operator', affectedPaths: [], dependencies: [], criteria: ['works'], requiredArtifacts: {}, requiredGates: [], triage: {}, status: 'ready-to-build', needs: [], escalation: null } satisfies Item;
  return state;
}
function assignment(state: LoopState, status: Assignment['status'] = 'running') {
  state.assignments.author = { id: 'author', item: 'feature', activity: 'implementation', role: 'implementer', worker: { instance: 'a', context: 'a', provider: 'manual', model: 'attested', settings: {}, tools: [] }, inputs: {}, writePaths: [], affectedPaths: [], resources: [], allowedActions: [], deadline: state.policy.deadline, deliverables: [], baseline: { digest: 'a'.repeat(64), files: {}, policyHash: 'b'.repeat(64), environmentHash: 'c'.repeat(64), toolHash: 'd'.repeat(64) }, policyHash: 'b'.repeat(64), publicationToken: 'token', status, reconciled: status === 'finished', reason: null };
}

describe('manual host delivery assertion', () => {
  it('rejects an empty selection and unknown requested items', () => {
    expect(() => assessManualHandoff(fixture(), [])).toThrow('explicitly');
    expect(() => assessManualHandoff(fixture(), ['missing'])).toThrow('explicitly');
  });
  it('blocks the observed stall shape even after an author file exists', async () => {
    const state = fixture(); assignment(state); state.revision = 72;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'manual-handoff-')); temporary.push(directory);
    await writeFile(path.join(directory, 'implementation-report.json'), '{"reported":"done"}');
    expect(assessManualHandoff(state, ['feature'])).toMatchObject({ complete: false, revision: 72, items: [{ retainedAssignments: [{ id: 'author', status: 'running' }] }] });
  });
  it('finishing the author does not substitute for independent checking and delivery', () => {
    const state = fixture(); assignment(state, 'finished');
    expect(assessManualHandoff(state, ['feature']).complete).toBe(false);
    state.items.feature.status = 'verified';
    expect(assessManualHandoff(state, ['feature']).complete).toBe(false);
    state.items.feature.status = 'shipped';
    expect(assessManualHandoff(state, ['feature']).complete).toBe(true);
  });
  it('blocks retained assignments, uncertainty and owner-needed work even with a shipped marker', () => {
    const state = fixture(); state.items.feature.status = 'shipped'; assignment(state, 'quarantined');
    expect(assessManualHandoff(state, ['feature']).complete).toBe(false);
    state.assignments.author.reconciled = true;
    state.operations.op = { id: 'op', assignment: 'author', resource: 'tree', status: 'unknown', publicationToken: 'token', pid: null, reconciled: false };
    expect(assessManualHandoff(state, ['feature']).items[0].action).toContain('reconcile');
    delete state.operations.op;
    state.activities.implementation = { id: 'implementation', item: 'feature', kind: 'implementation', requirements: [], dependencies: [], status: 'owner-needed', rounds: 2, authors: [], reviews: [] };
    expect(assessManualHandoff(state, ['feature']).items[0].action).toContain('no third');
    delete state.activities.implementation; state.items.feature.needs = ['live instrument unavailable'];
    expect(assessManualHandoff(state, ['feature']).complete).toBe(false);
  });
  it('checks every named item rather than treating one delivery as whole-request completion', () => {
    const state = fixture(); state.items.done = { ...state.items.feature, id: 'done', status: 'shipped' };
    expect(assessManualHandoff(state, ['done', 'feature']).complete).toBe(false);
    expect(assessManualHandoff(state, ['done']).complete).toBe(true);
  });
  it('reports expired pending delivery without recommending blind admission, renewal or gate reruns', () => {
    const state = fixture(); state.policy.deadline = 100; state.items.feature.status = 'verified';
    assignment(state, 'finished');
    for (const id of ['verification','whole-change-review']) {
      state.activities[id] = {id,item:'feature',kind:id,requirements:['works'],dependencies:[],status:'accepted',rounds:0,authors:[],reviews:[]};
      state.artifacts[id] = {id,activity:id,assignment:'author',version:1,hash:'a'.repeat(64),acceptedHash:'a'.repeat(64),path:`${id}.json`,author:state.assignments.author.worker,inputs:[],candidate:state.assignments.author.baseline};
    }
    const before = structuredClone(state);
    const report = assessManualHandoff(state, ['feature'], 101);
    expect(report).toMatchObject({ complete:false, deadlineExpired:true, items:[{ status:'verified', pending:true, handoffState:'pending-expired', retainedAssignments:[], outstandingOperations:[] }] });
    expect(report.items[0].action).toContain('Preserve accepted evidence and history');
    expect(report.items[0].action).toContain('terminating owner disposition or explicit authorization');
    expect(report.items[0].action).toContain('changes the policy hash and stales prior gate evidence');
    expect(report.items[0].action).toContain('do not renew the policy or rerun gates without explicit authorization');
    expect(report.items[0].action).not.toContain('Continue independent role admission');
    expect(state).toEqual(before);
  });
  it('keeps live pending guidance through the exact deadline boundary', () => {
    const state = fixture(); state.policy.deadline = 100;
    for (const now of [99,100]) {
      const report = assessManualHandoff(state, ['feature'], now);
      expect(report).toMatchObject({complete:false,deadlineExpired:false,items:[{handoffState:'pending'}]});
      expect(report.items[0].action).toContain('Continue independent role admission');
    }
  });
  it('keeps completed local delivery complete after the deadline expires', () => {
    const state = fixture(); state.policy.deadline = 100; state.items.feature.status = 'shipped';
    expect(assessManualHandoff(state, ['feature'], 101)).toMatchObject({complete:true,deadlineExpired:true,items:[{pending:false,handoffState:'complete',action:'Local delivery recorded'}]});
  });
  it('prioritizes unresolved operation cleanup over expiry and retains worker ownership', () => {
    const state = fixture(); state.policy.deadline = 100; assignment(state);
    state.operations.op = {id:'op',assignment:'author',resource:'tree',status:'unknown',publicationToken:'token',pid:null,reconciled:false};
    const report = assessManualHandoff(state, ['feature'], 101);
    expect(report.items[0]).toMatchObject({handoffState:'pending-expired',retainedAssignments:[{id:'author',status:'running'}],outstandingOperations:[{id:'op',status:'unknown'}]});
    expect(report.items[0].action).toBe('Observe termination and reconcile uncertainty before any retry; do not remove locks');
    delete state.operations.op;
    const retained = assessManualHandoff(state, ['feature'], 101).items[0];
    expect(retained.action).toContain('resolve any retained host-worker ownership');
    expect(retained.action).not.toContain('then admit');
  });
  it('public executable fails closed and leaves state bytes unchanged', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'manual-handoff-cli-')); temporary.push(directory);
    const filename = path.join(directory, 'state.json'); const state = fixture();
    await writeFile(filename, JSON.stringify(state)); const before = await readFile(filename);
    const run = (...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-default-type=module', '--experimental-loader', './tools/resolve-ts-hook.ts', './tools/agnostic-loop/manual-handoff.ts', ...args], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
    const pending = run(directory, 'feature');
    expect(pending.status, pending.stderr).toBe(2); expect(JSON.parse(pending.stdout).complete).toBe(false);
    expect(await readFile(filename)).toEqual(before);
    expect(run(directory, 'missing').status).toBe(1);
    state.items.feature.status = 'shipped'; await writeFile(filename, JSON.stringify(state));
    expect(run(directory, 'feature').status).toBe(0);
    await writeFile(filename, '{}'); expect(run(directory, 'feature').status).toBe(1);
  }, 30000);
});
