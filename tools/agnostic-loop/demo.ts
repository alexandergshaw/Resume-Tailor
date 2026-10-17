import { importSyntheticLiveVerification } from './live-verification-fixtures';
import { LoopStore } from './store';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Candidate, LoopState, Policy, Worker } from './types';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(moduleDirectory, '../..');

/** Exercise the public executable, including JSON serialization and store reloads. */
export function invokeCli(args: string[], environment: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, cliArguments(args), { cwd: repository, encoding: 'utf8', env: environment, timeout: 30_000 });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
export function cliArguments(args: string[]): string[] {
  return [
    '--experimental-strip-types', '--experimental-default-type=module',
    '--experimental-loader', pathToFileURL(path.join(repository, 'tools/resolve-ts-hook.ts')).href,
    path.join(moduleDirectory, 'cli.ts'), ...args,
  ];
}

export function demoWorker(name: string): Worker {
  return { instance: name, context: `${name}-context`, provider: 'manual', model: 'offline-fixture', settings: {}, tools: ['file'] };
}

export function demoPolicy(workspace: string): Policy {
  return {
    owner: 'operator', workspace, allowedActions: ['read', 'write', 'review', 'run', 'import'],
    candidateExclusions: ['artifacts'], environmentKeys: ['AGNOSTIC_DEMO_SECRET'], externalFiles: [],
    gates: {
      behavior: { executable: process.execPath, args: ['-e', "const fs=require('node:fs');const assert=require('node:assert/strict');assert.equal(fs.readFileSync('output.txt','utf8'),'HELLO\\n')"], resources: ['workspace'] },
      regression: { executable: process.execPath, args: ['-e', "const fs=require('node:fs');const assert=require('node:assert/strict');assert.equal(fs.readFileSync('input.txt','utf8'),'hello\\n');assert.equal(fs.readFileSync('output.txt','utf8'),'HELLO\\n')"], resources: ['workspace'] },
    },
    concurrency: 3, deadline: Date.now() + 86_400_000, maxAssignments: 100, commandTimeout: 10_000,
  };
}

export async function createDemoFixture(directory: string, configure?: (policy: Policy) => void) {
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error('Demo requires an empty or new directory');
  const workspace = path.join(root, 'project');
  const stateDirectory = path.join(root, '.agnostic-loop');
  await mkdir(workspace);
  await mkdir(path.join(workspace, 'artifacts'));
  await writeFile(path.join(workspace, 'input.txt'), 'hello\n');
  const policyPath = path.join(root, 'policy.json');
  const policy = demoPolicy(workspace);
  configure?.(policy);
  await writeFile(policyPath, JSON.stringify(policy, null, 2));
  const result = invokeCli(['init', '--workspace', workspace, '--state', stateDirectory, '--policy', policyPath]);
  if (result.code !== 0) throw new Error(`Demo init failed: ${result.stdout} ${result.stderr}`);
  return { root, workspace, stateDirectory };
}

export async function readDemoState(stateDirectory: string): Promise<LoopState> {
  return JSON.parse(await readFile(path.join(stateDirectory, 'state.json'), 'utf8')) as LoopState;
}

// The completed workflow below intentionally calls the CLI for every mutation.
export class DemoDriver {
  counter = 0;
  readonly root: string;
  readonly workspace: string;
  readonly stateDirectory: string;
  constructor(root: string, workspace: string, stateDirectory: string) {
    this.root = root; this.workspace = workspace; this.stateDirectory = stateDirectory;
  }
  async state() { return readDemoState(this.stateDirectory); }
  command(args: string[], expectedSuccess = true) {
    const result = invokeCli([...args, '--state', this.stateDirectory, '--actor', 'operator']);
    if (expectedSuccess && result.code !== 0) throw new Error(`CLI ${args[0]} failed: ${result.stdout} ${result.stderr}`);
    return result;
  }
  async event(type: string, payload: Record<string, unknown>, expectedSuccess = true) {
    const event = { id: `demo-event-${++this.counter}`, expectedRevision: (await this.state()).revision, actor: 'operator', type, payload };
    const file = path.join(this.root, `event-${this.counter}.json`);
    await writeFile(file, JSON.stringify(event));
    return this.command(['apply', file], expectedSuccess);
  }
  async result(assignment: string, type: string, payload: Record<string, unknown>, expectedSuccess = true) {
    const state = await this.state();
    const worker = state.assignments[assignment];
    const result = { schemaVersion: 1, id: `demo-result-${++this.counter}`, expectedRevision: state.revision, assignment, worker: worker.worker, publicationToken: worker.publicationToken, event: { type, payload }, usage: 'unavailable' };
    const file = path.join(this.root, `result-${this.counter}.json`);
    await writeFile(file, JSON.stringify(result));
    return this.command(['result', file], expectedSuccess);
  }
  async activity(id: string, kind = id, item = 'transform') {
    await this.event('activity.create', { id, item, kind, requirements: ['uppercase'], dependencies: [] });
  }
  async start(id: string, activity: string, role: string, worker = demoWorker(id), deliverables: string[] = [], inputs: Record<string, string> = {}, writePaths: string[] = [], resources: string[] = []) {
    const owned = [...writePaths, ...deliverables.map(artifact => `artifacts/${artifact}.txt`)];
    await this.event('assignment.start', { id, item: (await this.state()).activities[activity].item, activity, role, worker, inputs, writePaths: owned, affectedPaths: owned, resources, allowedActions: ['read', 'write', 'review', 'run', 'import'], deadline: Date.now() + 300_000, deliverables });
  }
  async import(assignment: string, artifact: string, content: string) {
    const file = path.join(this.workspace, 'artifacts', `${artifact}.txt`);
    await writeFile(file, content);
    this.command(['import', assignment, artifact, file]);
    return (await this.state()).artifacts[artifact];
  }
  async finish(assignment: string) { await this.result(assignment, 'assignment.finish', { assignment }); }
  async review(artifact: string, verdict = 'clean', worker?: Worker) {
    const current = (await this.state()).artifacts[artifact];
    const assignment = `${artifact}-check-${++this.counter}`;
    await this.start(assignment, current.activity, 'checker', worker ?? demoWorker(assignment));
    const classification = (await this.state()).activities[current.activity].rounds === 0 ? 'new' : 'repeat';
    await this.result(assignment, 'review.record', { assignment, artifact, hash: current.hash, verdict, findings: verdict === 'clean' ? [] : [{ severity: 'P2', mechanism: 'Requirement needs exact text', classification, need: 'ruling' }] });
    await this.finish(assignment);
  }
  async accepted(activity: string, role: string, artifact: string, content: string) {
    await this.activity(activity);
    const assignment = `${artifact}-author`;
    await this.start(assignment, activity, role, demoWorker(assignment), [artifact]);
    this.command(['packet', assignment, path.join(this.root, `${assignment}-packet.json`)]);
    await this.import(assignment, artifact, content);
    await this.finish(assignment);
    await this.review(artifact);
  }
  async advance(status: string, artifacts: string[] = [], evidence: string[] = []) {
    await this.event('item.advance', { item: 'transform', status, artifacts, evidence });
  }
  async candidate(): Promise<Candidate> {
    const status = this.command(['status']);
    const data = JSON.parse(status.stdout) as { result: { candidate?: Candidate } };
    if (!data.result.candidate) throw new Error('CLI status did not expose current candidate');
    return data.result.candidate;
  }
}

export async function runDemo(directory: string): Promise<unknown> {
  const fixture = await createDemoFixture(directory);
  const d = new DemoDriver(fixture.root, fixture.workspace, fixture.stateDirectory);
  await d.event('item.create', {
    id: 'transform', objective: 'Uppercase input while preserving original input', owner: 'operator',
    affectedPaths: ['input.txt', 'output.txt', ...['scope', 'criteria', 'design', 'plan', 'tests', 'implementation', 'verification-report', 'whole-change', 'final-report'].map(id => `artifacts/${id}.txt`)], dependencies: [], criteria: ['uppercase'],
    requiredArtifacts: { 'criteria-accepted': ['criteria'], 'design-accepted': ['design'], 'ready-to-build': ['plan', 'test-design'] },
    requiredGates: ['behavior', 'regression'], triage: { security: 'Local fixed commands; no remote service', accessibility: 'Plain CLI JSON', reliability: 'Durable operation records' },
  });
  await d.accepted('scope', 'specialist', 'scope', 'One isolated local text transformation with no external side effects.');
  await d.advance('scoped', ['scope']);
  await d.accepted('criteria', 'criteria', 'criteria', 'Output is HELLO followed by a newline. Input remains hello followed by a newline.');
  await d.advance('criteria-accepted', ['criteria']);
  await d.accepted('design', 'architect', 'design', 'Use a local text transformation with independent Node assertions.');
  await d.advance('design-accepted', ['design']);
  await d.accepted('plan', 'planner', 'plan', 'Implement output.txt; run behavior and regression with independent verification.');
  await d.accepted('test-design', 'test-designer', 'tests', 'Assert exact output bytes and independently check unchanged input.');
  await d.advance('ready-to-build', ['plan', 'tests']);
  await d.activity('implementation');
  await d.start('build', 'implementation', 'implementer', demoWorker('build'), ['implementation'], {}, ['output.txt']);
  await writeFile(path.join(fixture.workspace, 'output.txt'), 'HELLO\n');
  await d.import('build', 'implementation', 'Produced exact HELLO newline in output.txt while leaving input.txt unchanged.');
  await d.finish('build');
  await d.review('implementation');
  await d.activity('build-gates');
  await d.start('build-gates', 'build-gates', 'specialist', demoWorker('build-gates'), [], {}, [], ['workspace']);
  d.command(['run', 'build-gates', 'behavior']);
  d.command(['run', 'build-gates', 'regression']);
  await d.finish('build-gates');
  await d.advance('implemented', ['implementation'], Object.keys((await d.state()).evidence));
  await d.activity('verification');
  await d.start('verify', 'verification', 'verifier', demoWorker('verify'), ['verification-report'], {}, [], ['workspace']);
  d.command(['run', 'verify', 'behavior']);
  d.command(['run', 'verify', 'regression']);
  const state = await d.state();
  const evidence = Object.values(state.evidence).map(record => record.id);
  const candidate = await d.candidate();
  const report = { candidate, worker: demoWorker('verify'), criteria: { uppercase: evidence }, limitations: ['Offline local fixture; no rendered UI or live provider'] };
  await d.import('verify', 'verification-report', JSON.stringify(report));
  await d.result('verify', 'verification.record', { assignment: 'verify', artifact: 'verification-report', report });
  await d.finish('verify');
  await d.review('verification-report');
  await d.advance('verified', ['verification-report'], evidence);
  await d.accepted('whole-change-review', 'specialist', 'whole-change', 'Exact output and preserved input reviewed against accepted criteria.');
  await d.activity('final-report');
  await d.start('finalize', 'final-report', 'finalizer', demoWorker('finalize'), ['final-report']);
  const final = { candidate, verificationArtifact: 'verification-report', regressionEvidence: evidence, wholeChangeReviewArtifact: 'whole-change', residuals: [], delivery: 'local' };
  await d.import('finalize', 'final-report', JSON.stringify(final));
  await d.result('finalize', 'final.record', { assignment: 'finalize', artifact: 'final-report', report: final });
  await d.finish('finalize');
  await d.review('final-report');
  await d.advance('regression-passed', ['final-report'], evidence);
  await importSyntheticLiveVerification(new LoopStore(fixture.stateDirectory),'transform',true);
  await d.advance('shipped', ['final-report'], evidence);
  await d.event('item.create', {
    id: 'owner-example', objective: 'Demonstrate exact owner disposition after two defective rounds', owner: 'operator',
    affectedPaths: ['artifacts/draft-one.txt', 'artifacts/draft-two.txt', 'artifacts/owner-result.txt'], dependencies: [], criteria: ['uppercase'],
    requiredArtifacts: {}, requiredGates: [], triage: { reliability: 'Review-round accounting persists across CLI processes' },
  });
  await d.activity('owner-criteria', 'criteria', 'owner-example');
  await d.start('draft-one-author', 'owner-criteria', 'criteria', demoWorker('draft-one-author'), ['draft-one']);
  const draftOne = await d.import('draft-one-author', 'draft-one', 'draft one');
  await d.finish('draft-one-author');
  const rejectedSelfReview = await d.event('assignment.start', {
    id: 'self-review', item: 'owner-example', activity: 'owner-criteria', role: 'checker', worker: demoWorker('draft-one-author'),
    inputs: {}, writePaths: [], affectedPaths: [], resources: [], allowedActions: ['review'], deadline: Date.now() + 60_000, deliverables: [],
  }, false);
  if (rejectedSelfReview.code === 0) throw new Error('Demo invariant failed: self-review was accepted');
  await d.review(draftOne.id, 'defective');
  await d.start('draft-two-author', 'owner-criteria', 'criteria', demoWorker('draft-two-author'), ['draft-two']);
  const original = 'draft two';
  const draftTwo = await d.import('draft-two-author', 'draft-two', original);
  await d.finish('draft-two-author');
  await d.review(draftTwo.id, 'defective');
  await d.start('owner-transcriber', 'owner-criteria', 'transcriber', demoWorker('owner-transcriber'), ['owner-result']);
  const resultingText = 'accepted exact owner text';
  const resulting = await d.import('owner-transcriber', 'owner-result', resultingText);
  await d.finish('owner-transcriber');
  const patch = { originalHash: draftTwo.hash, replacements: [{ start: 0, end: Buffer.byteLength(original), text: resultingText }], expectedHash: createHash('sha256').update(resultingText).digest('hex') };
  await d.event('decision.record', {
    id: 'exact-owner-decision', activity: 'owner-criteria', originalArtifact: draftTwo.id, originalHash: draftTwo.hash, scope: ['uppercase'], disposition: 'bounded-acceptance', patch, resultingArtifact: resulting.id,
    residuals: [], rationale: 'Owner fixes the exact text and ends substantive review',
  });
  await d.start('mechanical-check', 'owner-criteria', 'transcriber', demoWorker('mechanical-check'));
  await d.result('mechanical-check', 'transcription.verify', { assignment: 'mechanical-check', decision: 'exact-owner-decision', hash: resulting.hash, pass: true, semanticFidelity: true });
  await d.finish('mechanical-check');
  const thirdReview = await d.event('assignment.start', {
    id: 'third-review', item: 'owner-example', activity: 'owner-criteria', role: 'checker', worker: demoWorker('third-review'),
    inputs: {}, writePaths: [], affectedPaths: [], resources: [], allowedActions: ['review'], deadline: Date.now() + 60_000, deliverables: [],
  }, false);
  if (thirdReview.code === 0) throw new Error('Demo invariant failed: third substantive review was accepted');
  const finalState = await d.state();
  return { ...fixture, status: finalState.items.transform.status, revision: finalState.revision, evidence, candidate: candidate.digest, rejected: ['self-review', 'third-substantive-review'], ownerDisposition: { rounds: finalState.activities['owner-criteria'].rounds, acceptedHash: finalState.artifacts['owner-result'].acceptedHash } };
}
