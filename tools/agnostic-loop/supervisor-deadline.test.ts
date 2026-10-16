import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LoopStore } from './store';
import { configureDispatch, drive, dispatchStatus } from './supervisor';
import { commitEvent, importJob } from './supervisor-inbox';
import { assignmentDeadline } from './supervisor-process';
import { buildInvocation } from './providers';
import { supervisorFixture, cleanupSupervisorFixtures } from './supervisor-fixtures';

afterEach(async () => { vi.restoreAllMocks(); await cleanupSupervisorFixtures(); });

describe('gate-aware supervisor assignment deadline', () => {
  it('reserves each serial gate and preserves no-gate timing and both caps', () => {
    expect(assignmentDeadline(1000, 180000, 100000, 0, 2000000, 3000000)).toBe(211000);
    expect(assignmentDeadline(1000, 180000, 100000, 2, 2000000, 3000000)).toBe(411000);
    expect(assignmentDeadline(1000, 180000, 100000, 2, 300000, 400000)).toBe(300000);
    expect(assignmentDeadline(1000, 180000, 100000, 2, 400000, 300000)).toBe(300000);
    expect(assignmentDeadline(1000, 180000, 100000, 2, 411000, 411000)).toBe(411000);
    expect(assignmentDeadline(1000, 180000, 0, 2, 2000000, 3000000)).toBe(211000);
    expect(assignmentDeadline(1000, 180000, 1, 2, 999, 3000000)).toBe(999);
  });
  it('saturates safely before arithmetic overflow and rejects invalid counters', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(assignmentDeadline(max - 100, max, max, max, max, max)).toBe(max);
    expect(assignmentDeadline(1, 1, max, max, max, max)).toBe(max);
    expect(assignmentDeadline(max - 100000, 1, 3, 2, max, max)).toBe(max - 69993);
    for (const invalid of [-1, 0.5, max + 1, NaN, Infinity]) {
      for (let index = 0; index < 6; index++) {
        const values = [1000, 100, 100, 1, 200000, 200000]; values[index] = invalid;
        expect(() => assignmentDeadline(...values as [number,number,number,number,number,number])).toThrow('safe integers');
      }
    }
  });
  it('keeps native provider timeout separate from the larger assignment lifetime', () => {
    const provider = { id:'codex',kind:'codex' as const,enabled:true,executable:process.execPath,prefixArgs:[],environmentKeys:[],settings:{},timeoutMs:180000,maxOutputBytes:1048576 };
    const invocation = buildInvocation({provider,target:{id:'target',provider:'codex',model:'requested',settings:{},enabled:true,maxContextTokens:64000,inputMicroUsdPerMillion:null,outputMicroUsdPerMillion:null},worker:{instance:'i',context:'c',provider:'codex',model:'requested',settings:{},tools:[]},packet:{task:{role:'verifier'}},packetHash:'a'.repeat(64),job:'job',assignment:'assignment',publicationToken:'token',resultPath:'result.json',workspace:process.cwd(),nativeCostCapMicroUsd:null});
    expect(invocation.timeoutMs).toBe(180000);
    expect(assignmentDeadline(1000, invocation.timeoutMs, 100000, 2, 2000000, 3000000)).toBe(411000);
  });
  for (const { kind, expired } of [{kind:'verification',expired:false},{kind:'implementation-wave:build',expired:false},{kind:'implementation-wave:build',expired:true}]) {
    it(expired ? 'rejects real passing gate evidence beyond the admitted overall deadline' : `imports real ${kind} gate evidence after the old assignment cutoff`, async () => {
      const f = await supervisorFixture({ maxJobs: 40 });
      const policy = (await f.store.load()).policy;
      policy.deadline = Date.now() + 600_000;
      policy.commandTimeout = 90_000;
      const enabled = path.join(f.root, 'enabled');
      const ready = path.join(f.root, 'ready');
      const release = path.join(f.root, 'release');
      const gate = path.join(f.root, 'deadline-gate.cjs');
      await writeFile(gate, `const fs=require('node:fs');
if(fs.existsSync(${JSON.stringify(enabled)})){
 fs.writeFileSync(${JSON.stringify(ready)},'ready');
 const end=Date.now()+15000;
 while(!fs.existsSync(${JSON.stringify(release)})&&Date.now()<end)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 if(!fs.existsSync(${JSON.stringify(release)}))process.exit(79);
}
if(fs.readFileSync('output.txt','utf8')!=='done')process.exit(18);
console.log('actual gate passed');`);
      policy.gates.verify.args = [gate];
      const store = new LoopStore(path.join(f.root, 'deadline-state'));
      await store.init(policy);
      f.config.budget.deadline = policy.deadline;
      // Fixture qualification is finite; the logical45s shift stays inside it.
      await configureDispatch(store, f.config);
      let action;
      for (let step = 0; step < 90; step++) {
        action = (await dispatchStatus(store, f.config, f.selection)).actions[0];
        if (action?.kind === 'dispatch' && action.task.kind === kind && action.task.purpose === 'author') break;
        expect(['blocked', 'owner-needed', 'complete']).not.toContain(action?.kind);
        await drive(store, f.config, f.selection, { maxSteps: 1 });
      }
      expect(action?.kind).toBe('dispatch');
      if (action?.kind !== 'dispatch') throw new Error('Target stage not reached');
      expect(action.task.kind).toBe(kind);
      const realNow = Date.now.bind(Date);
      let offset = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
      // Observe real timer registration so logical time cannot race runGate's
      // initial timeout calculation; timers themselves continue in real time.
      const realSetTimeout = globalThis.setTimeout;
      let gateTimerArmed = false;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
        if (delay !== undefined && delay > 80_000 && delay <= 90_000) gateTimerArmed = true;
        return realSetTimeout(handler, delay, ...args);
      }) as typeof setTimeout);
      await writeFile(enabled, 'enabled');
      const pending = drive(store, f.config, f.selection, { maxSteps: 1 });
      let observed = false;
      for (let attempts = 0; attempts < 1500; attempts++) {
        try { observed = (await readFile(ready, 'utf8')) === 'ready'; } catch { /* barrier not yet reached */ }
        if (observed && gateTimerArmed) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observed).toBe(true);
      expect(gateTimerArmed).toBe(true);
      offset = expired ? 650_000 : 45_000; // expiry is retained through publication.
      await writeFile(release, 'release');
      const result = await pending;
      const job = result.status.jobs.findLast(j => j.task.kind === kind)!;
      if (expired) {
        expect(job.status).toBe('rejected');
        expect(job.rejection).toContain('assignment budget or policy stale');
        const rejected = await store.load();
        const operations = Object.values(rejected.operations).filter(o => o.assignment === job.assignment);
        expect(operations).toHaveLength(2);
        expect(operations.every(o => o.status === 'terminated' && o.reconciled && Number.isInteger(o.pid))).toBe(true);
        expect(Object.values(rejected.evidence).filter(e => e.assignment === job.assignment)).toEqual([]);
        expect(rejected.assignments[job.assignment].status).toBe('cancelled');
        expect(rejected.assignments[job.assignment].deadline).toBeLessThan(Date.now());
        await expect(importJob(store, f.config, job.id)).rejects.toThrow('Inbox requires observed termination');
        expect((await store.load()).artifacts[job.task.artifactIds[0]]).toBeUndefined();
        await store.locked(async () => { const state = await store.load(); await commitEvent(store, state, 'observed-expiry-reconcile', 'assignment.reconcile', {assignment:job.assignment,resolution:'Both actual subprocess operations observed terminated and reconciled; expired output rejected'}); });
        expect((await store.load()).assignments[job.assignment].reconciled).toBe(true);
        return;
      }
      expect(job.status, job.rejection ?? 'actual gate-backed job').toBe('terminated');
      const beforeImport = await store.load();
      const assignment = beforeImport.assignments[job.assignment];
      const evidence = Object.values(beforeImport.evidence).filter(e => e.assignment === assignment.id);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].exitCode).toBe(0);
      expect(evidence[0].finished - evidence[0].started).toBeGreaterThan(40_000);
      expect(evidence[0].finished).toBeGreaterThan(job.created + f.config.providers[0].timeoutMs + 30_000);
      expect(assignment.deadline).toBeGreaterThan(evidence[0].finished);
      expect(assignment.deadline - job.created).toBe(130_000);
      await importJob(store, f.config, job.id);
      const finished = await store.load();
      expect(finished.assignments[job.assignment].status).toBe('finished');
      expect(finished.artifacts[job.task.artifactIds[0]].assignment).toBe(job.assignment);
      expect(Object.values(finished.operations).filter(o => o.assignment === job.assignment).every(o => o.status === 'terminated' && o.reconciled && Number.isInteger(o.pid))).toBe(true);
      expect(await readFile(path.join(f.workspace, 'output.txt'), 'utf8')).toBe('done');
    }, 180_000);
  }
});
