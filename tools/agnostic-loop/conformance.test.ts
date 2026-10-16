import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cliArguments, createDemoFixture, DemoDriver, demoWorker, invokeCli, runDemo } from './demo';
import type { Policy } from './types';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture(configure?: (policy: Policy) => void) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agnostic-conformance-'));
  directories.push(root);
  const created = await createDemoFixture(root, configure);
  const d = new DemoDriver(created.root, created.workspace, created.stateDirectory);
  await d.event('item.create', { id: 'transform', objective: 'Local fixture', owner: 'operator', affectedPaths: ['input.txt', 'output.txt', 'artifacts/criteria.txt', 'artifacts/criteria-v2.txt', 'artifacts/disposed.txt', 'artifacts/report.txt'], dependencies: [], criteria: ['uppercase'], requiredArtifacts: {}, requiredGates: ['behavior'], triage: { reliability: 'Local protocol fixture' } });
  return d;
}
async function assertRejected(d: DemoDriver, type: string, payload: Record<string, unknown>, reason: RegExp) {
  const before = await d.state();
  const result = await d.event(type, payload, false);
  expect(result.code).not.toBe(0);
  expect(result.stdout + result.stderr).toMatch(reason);
  expect((await d.state()).revision).toBe(before.revision);
}

describe('public CLI conformance', () => {
  it('traverses accepted artifacts, actual subprocess gates, verification and local delivery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agnostic-demo-test-'));
    directories.push(root);
    const result = await runDemo(root) as { status: string; stateDirectory: string; evidence: string[]; rejected: string[]; ownerDisposition: { rounds: number; acceptedHash: string } };
    expect(result.status).toBe('shipped');
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
    expect(result.rejected).toContain('self-review');
    expect(result.rejected).toContain('third-substantive-review');
    expect(result.ownerDisposition.rounds).toBe(2);
    expect(result.ownerDisposition.acceptedHash).toMatch(/^[a-f0-9]{64}$/);
    const state = JSON.parse(await readFile(path.join(result.stateDirectory, 'state.json'), 'utf8'));
    expect(state.items.transform.status).toBe('shipped');
    expect(Object.values(state.evidence).every((record: unknown) => (record as { exitCode: number }).exitCode === 0)).toBe(true);
    expect(state.verificationReports['verification-report'].criteria.uppercase.length).toBeGreaterThan(0);
  }, 300_000);

  it('rejects same instance and same context reviews without advancing durable state', async () => {
    const d = await fixture();
    await d.activity('criteria');
    const author = demoWorker('author');
    await d.start('author', 'criteria', 'criteria', author, ['criteria']);
    const artifact = await d.import('author', 'criteria', 'Measurable criterion');
    await d.finish('author');
    for (const [id, worker] of [['same-instance', { ...author, context: 'fresh-context' }], ['same-context', { ...author, instance: 'fresh-instance' }]] as const) {
      await assertRejected(d, 'assignment.start', { id, item: 'transform', activity: 'criteria', role: 'checker', worker, inputs: {}, writePaths: [], affectedPaths: [], resources: [], allowedActions: ['read'], deadline: Date.now() + 60_000, deliverables: [] }, /independen|author|context|self/i);
    }
    await d.review('criteria');
    expect((await d.state()).artifacts.criteria.acceptedHash).toBe(artifact.hash);
  }, 60_000);

  it('reloads pending assignments and event IDs, rejects stale CAS and conflicting replay', async () => {
    const d = await fixture();
    await d.activity('criteria');
    await d.start('pending', 'criteria', 'criteria');
    const original = await d.state();
    const event = { id: 'durable-pause', expectedRevision: original.revision, actor: 'operator', type: 'run.pause', payload: { reason: 'Test pause' } };
    const file = path.join(d.root, 'replay.json');
    await writeFile(file, JSON.stringify(event));
    expect(d.command(['apply', file]).code).toBe(0);
    expect(d.command(['apply', file]).code).toBe(0);
    expect((await d.state()).revision).toBe(original.revision + 1);
    expect((await d.state()).assignments.pending.worker.instance).toBe('pending');
    await writeFile(file, JSON.stringify({ ...event, payload: { reason: 'Conflicting content' } }));
    expect(d.command(['apply', file], false).code).not.toBe(0);
    await writeFile(file, JSON.stringify({ ...event, id: 'new-id' }));
    expect(d.command(['apply', file], false).code).not.toBe(0);
  }, 60_000);

  it('fails closed on truncated persisted state and unsupported event fields', async () => {
    const d = await fixture();
    await assertRejected(d, 'run.pause', { reason: 'Test', forgedAuthority: true }, /unsupported/i);
    const stateFile = path.join(d.stateDirectory, 'state.json');
    await writeFile(stateFile, '{"schemaVersion":1,');
    const result = d.command(['status'], false);
    expect(result.code).not.toBe(0);
    expect(await readFile(stateFile, 'utf8')).toBe('{"schemaVersion":1,');
  });

  it('rejects path escapes, overlapping resources and new work during pause', async () => {
    const d = await fixture();
    await d.activity('criteria');
    const payload = { id: 'escape', item: 'transform', activity: 'criteria', role: 'criteria', worker: demoWorker('escape'), inputs: {}, writePaths: ['../escape.txt'], affectedPaths: ['../escape.txt'], resources: [], allowedActions: ['write'], deadline: Date.now() + 60_000, deliverables: [] };
    await assertRejected(d, 'assignment.start', payload, /path|traversal|scope|escape/i);
    await d.event('assignment.start', { ...payload, id: 'first', worker: demoWorker('first'), writePaths: [], affectedPaths: [], resources: ['shared-db'] });
    await assertRejected(d, 'assignment.start', { ...payload, id: 'second', worker: demoWorker('second'), writePaths: [], affectedPaths: [], resources: ['shared-db'] }, /resource|conflict|lock/i);
    await d.event('run.pause', { reason: 'Explicit owner pause' });
    await assertRejected(d, 'assignment.start', { ...payload, writePaths: [], affectedPaths: [], resources: [] }, /paused|running/i);
  }, 60_000);

  it('fences cancelled publishers and retains locks until reconciliation', async () => {
    const d = await fixture(policy => {
      policy.gates.late = { executable: process.execPath, args: ['-e', "const cp=require('node:child_process');cp.spawn(process.execPath,['-e',\"setTimeout(()=>require('node:fs').writeFileSync('output.txt','late'),1800)\"],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>{},8000)"], resources: ['workspace'] };
    });
    await d.activity('criteria');
    await d.start('cancelled', 'criteria', 'criteria', demoWorker('cancelled'), [], {}, ['output.txt'], ['workspace']);
    const child = spawn(process.execPath, cliArguments(['run', 'cancelled', 'late', '--state', d.stateDirectory, '--actor', 'operator']), { stdio: 'ignore' });
    const closed = new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (Object.values((await d.state()).operations).some(operation => operation.status === 'running')) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    expect(Object.values((await d.state()).operations).some(operation => operation.status === 'running')).toBe(true);
    // Wait for the controlled child to launch its separately tracked-by-fixture descendant.
    await new Promise(resolve => setTimeout(resolve, 200));
    await d.event('assignment.cancel', { assignment: 'cancelled', reason: 'Controlled late writer' });
    await closed;
    expect(['cancelled', 'quarantined']).toContain((await d.state()).assignments.cancelled.status);
    const source = path.join(d.workspace, 'artifacts', 'late-result.txt');
    await writeFile(source, 'late claimed result');
    expect(d.command(['import', 'cancelled', 'late-artifact', source], false).code).not.toBe(0);
    await assertRejected(d, 'assignment.quiesce', { assignment: 'cancelled', quarantine: false }, /operation|running|terminat|quiescen/i);
    await assertRejected(d, 'assignment.start', { id: 'successor', item: 'transform', activity: 'criteria', role: 'criteria', worker: demoWorker('successor'), inputs: {}, writePaths: ['output.txt'], affectedPaths: ['output.txt'], resources: [], allowedActions: ['write'], deadline: Date.now() + 60_000, deliverables: [] }, /lock|conflict|overlap|quarantin/i);
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect(await readFile(path.join(d.workspace, 'output.txt'), 'utf8')).toBe('late');
    expect(Object.values((await d.state()).operations).some(operation => operation.status === 'unknown')).toBe(true);
  }, 60_000);

  it('rejects worker-invented gate evidence and non-owner authority', async () => {
    const d = await fixture();
    await assertRejected(d, 'evidence.record', { evidence: { id: 'fake' } }, /evidence|assignment|worker|candidate/i);
    const file = path.join(d.root, 'unauthorized.json');
    await writeFile(file, JSON.stringify({ id: 'owner-spoof', expectedRevision: (await d.state()).revision, actor: 'worker', type: 'run.pause', payload: { reason: 'Spoof' } }));
    const result = invokeCli(['apply', file, '--state', d.stateDirectory, '--actor', 'worker']);
    expect(result.code).not.toBe(0);
  });

  it('arbitrates conflicting revisions from two actual CLI processes', async () => {
    const d = await fixture();
    const revision = (await d.state()).revision;
    const files = [path.join(d.root, 'race-a.json'), path.join(d.root, 'race-b.json')];
    for (const [index, file] of files.entries()) await writeFile(file, JSON.stringify({ id: `race-${index}`, expectedRevision: revision, actor: 'operator', type: 'run.pause', payload: { reason: `Racer ${index}` } }));
    const run = (file: string) => new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, cliArguments(['apply', file, '--state', d.stateDirectory, '--actor', 'operator']), { stdio: 'ignore' });
      child.once('exit', resolve); child.once('error', reject);
    });
    const results = await Promise.all(files.map(run));
    expect(results.filter(code => code === 0)).toHaveLength(1);
    const state = await d.state();
    expect(state.revision).toBe(revision + 1);
    expect(state.events.filter(event => event.id.startsWith('race-'))).toHaveLength(1);
  }, 60_000);

  it('binds accepted inputs to actual source bytes and validates result identity', async () => {
    const d = await fixture();
    await d.activity('criteria');
    await d.start('author', 'criteria', 'criteria', demoWorker('author'), ['criteria']);
    const state = await d.state();
    const file = path.join(d.root, 'spoofed-result.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, id: 'spoof', expectedRevision: state.revision, assignment: 'author', worker: demoWorker('another-author'), publicationToken: state.assignments.author.publicationToken, event: { type: 'assignment.finish', payload: { assignment: 'author' } }, usage: 'unavailable' }));
    expect(d.command(['result', file], false).code).not.toBe(0);
    await d.import('author', 'criteria', 'Original bytes');
    await d.finish('author');
    await d.review('criteria');
    const revision = (await d.state()).revision;
    await writeFile(path.join(d.workspace, 'artifacts/criteria.txt'), 'Changed source bytes');
    const artifact = (await d.state()).artifacts.criteria;
    await assertRejected(d, 'assignment.start', { id: 'stale-consumer', item: 'transform', activity: 'criteria', role: 'specialist', worker: demoWorker('stale-consumer'), inputs: { criteria: artifact.hash }, writePaths: [], affectedPaths: [], resources: [], allowedActions: ['read'], deadline: Date.now() + 60_000, deliverables: [] }, /stale|bytes|artifact/i);
    expect((await d.state()).revision).toBe(revision);
  }, 60_000);

  it('rejects missing criterion coverage and invalidates evidence on actual config and environment changes', async () => {
    const d = await fixture();
    await writeFile(path.join(d.workspace, 'output.txt'), 'HELLO\n');
    await d.activity('verification');
    await d.start('verify', 'verification', 'verifier', demoWorker('verify'), ['report'], {}, [], ['workspace']);
    d.command(['run', 'verify', 'behavior']);
    const evidence = Object.keys((await d.state()).evidence);
    const report = { candidate: await d.candidate(), worker: demoWorker('verify'), criteria: {}, limitations: [] };
    await d.import('verify', 'report', JSON.stringify(report));
    await assertRejected(d, 'verification.record', { assignment: 'verify', artifact: 'report', report }, /criterion|mapping/i);
    const beforeCandidate = await d.candidate();
    await writeFile(path.join(d.workspace, 'config.json'), 'unlisted config change');
    expect((await d.candidate()).digest).not.toBe(beforeCandidate.digest);
    const envStatus = invokeCli(['status', '--state', d.stateDirectory], { ...process.env, AGNOSTIC_DEMO_SECRET: 'unique-secret-sentinel-581' });
    expect(envStatus.code).toBe(0);
    const observed = JSON.parse(envStatus.stdout).result.candidate;
    expect(observed.environmentHash).not.toBe(beforeCandidate.environmentHash);
    expect(envStatus.stdout).not.toContain('unique-secret-sentinel-581');
    expect(evidence.length).toBeGreaterThan(0);
  }, 60_000);

  it('enforces the granted assignment count budget', async () => {
    const d = await fixture(policy => { policy.maxAssignments = 1; });
    await d.activity('criteria');
    await d.start('first', 'criteria', 'criteria');
    await d.finish('first');
    await assertRejected(d, 'assignment.start', { id: 'over-budget', item: 'transform', activity: 'criteria', role: 'criteria', worker: demoWorker('over-budget'), inputs: {}, writePaths: [], affectedPaths: [], resources: [], allowedActions: ['read'], deadline: Date.now() + 60_000, deliverables: [] }, /budget|exhaust/i);
    const next = JSON.parse(d.command(['next']).stdout).result;
    expect(next.eligible).toEqual([]);
    expect(next.blocked.transform.join(' ')).toMatch(/budget/i);
  }, 60_000);
});
