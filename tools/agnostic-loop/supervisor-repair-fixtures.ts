import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LoopStore } from './store';
import { drive, configureDispatch, dispatchStatus, controlDispatch } from './supervisor';
import { supervisorFixture, fixtureWorker } from './supervisor-fixtures';
import { probeProvider } from './providers';
import { createPolicyQualification } from './routing';
import { commitEvent, importJob } from './supervisor-inbox';
import { loadJournal } from './dispatch-store';
import { canonical, digest } from './json';
import type { Activity, Evidence, LoopState, StoredArtifact } from './types';
import type { DispatchStatus, NextAction } from './dispatch-types';

// These helpers are also the isolated mutation harness: no test-file imports.
export function invariant(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`INVARIANT:${name}`);
}
function setup(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIXTURE_SETUP:${message}`);
}
type FailureStage = 'verification' | 'final-report';
type Options = { stage?: FailureStage; exhausted?: boolean; longOutput?: boolean; nonGateFailure?: boolean; contextLimit?: number; pauseAtGate?: boolean };
const sentinel = 'REPAIR_EXPECTED: write repaired-output';
export const secret = 'repair-secret-739c1-not-authority';
const secretKey = 'AGNOSTIC_REPAIR_SECRET';
const previousSecret = process.env[secretKey];
export function restoreRepairEnvironment() {
  if (previousSecret === undefined) delete process.env[secretKey];
  else process.env[secretKey] = previousSecret;
}

export async function repairFixture(options: Options = {}) {
  // The generic helper supplies the existing grant/probe machinery and cleanup root.
  // Final scripts and their qualification are fixed before configuring this store.
  const f = await supervisorFixture({ maxJobs: 80, deadlineMs: 600_000 });
  const captures = path.join(f.root, 'captures');
  await mkdir(captures);
  const workerPath = path.join(f.root, 'repair-worker.cjs');
  const gatePath = path.join(f.root, 'repair-gate.cjs');
  const gateState = path.join(f.root, 'gate-control.json');
  const failAt = (options.exhausted ? 2 : 1) + (options.stage === 'final-report' ? 2 : 1);
  let worker = fixtureWorker.replace("const request=JSON.parse(text), p=request.packet, t=p.task, b=request;", `
 const request=JSON.parse(text), p=request.packet, t=p.task, b=request;
 const path=require('node:path'), captures=${JSON.stringify(captures)};
 fs.writeFileSync(path.join(captures,b.job+'.json'),JSON.stringify({request,at:Date.now(),pid:process.pid}));
 const objects=value=>value&&typeof value==='object'?[value,...Object.values(value).flatMap(objects)]:[];
 const diagnostics=objects(Object.fromEntries(Object.entries(p).filter(([key])=>key!=='evidence'&&key!=='inputs'&&key!=='activity'&&key!=='reviewTarget')));
 const prior=diagnostics.find(v=>v.gate==='verify'&&Number.isInteger(v.exitCode)&&v.exitCode!==0&&typeof v.assignment==='string'&&v.assignment!==b.assignment&&/^[a-f0-9]{64}$/.test(v.outputHash||'')&&JSON.stringify(v).includes(${JSON.stringify(sentinel)})&&(v.candidate?.digest===p.candidate.digest||v.candidateDigest===p.candidate.digest));
 const wave=t.kind==='implementation-wave:build', writesWave=wave&&['author','repair'].includes(t.purpose), last=p.activity.reviews.at(-1);
 const gateRepair=writesWave&&t.purpose==='repair'&&last?.verdict==='clean'&&t.item==='fixture-item'&&${Boolean(options.stage)};
 if(gateRepair&&!prior){process.stderr.write('REPAIR_PACKET_MISSING_VERIFIED_FAILURE');process.exitCode=23;return;}
 if(writesWave&&${Boolean(options.nonGateFailure)}&&!fs.existsSync(path.join(captures,'provider-failed'))){fs.writeFileSync(path.join(captures,'provider-failed'),'observed non-gate failure');process.stderr.write('ordinary provider retry');process.exitCode=19;return;}
 const semantic=prior?'repaired-output':('valid-baseline-review-'+p.activity.rounds);
 if(writesWave)fs.writeFileSync('output.txt',prior?'repaired-output':'valid-baseline');
 fs.writeFileSync(path.join(captures,b.job+'.started'),JSON.stringify({at:Date.now(),worker:b.worker,semantic}));
 `);
  worker = worker.replace("if(t.kind==='implementation-wave:build')fs.writeFileSync('output.txt','done');", '');
  worker = worker.replace("'Accepted '+t.kind", "'Accepted '+t.kind+' semantic='+semantic+' candidate='+p.candidate.digest");
  if (options.exhausted) worker = worker.replace("process.argv.includes('--defective')", "(wave&&p.activity.rounds===0)").replaceAll("process.argv.includes('--defective')", "(wave&&p.activity.rounds===0)");
  await writeFile(workerPath, worker);
  await writeFile(gatePath, `
const fs=require('node:fs'),path=require('node:path');
const control=${JSON.stringify(gateState)},captures=${JSON.stringify(captures)};
const packets=fs.readdirSync(captures).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(captures,n),'utf8'))).sort((a,b)=>a.at-b.at);
const item=packets.at(-1)?.request.packet.task.item;
const state=fs.existsSync(control)?JSON.parse(fs.readFileSync(control,'utf8')):{count:0,failed:false};
if(item==='fixture-item')state.count++;
if(${Boolean(options.pauseAtGate)}&&state.count===2){
 fs.writeFileSync(path.join(captures,'pause-ready'),'prelaunch gate running');
 const deadline=Date.now()+8000,release=path.join(captures,'pause-release');
 while(!fs.existsSync(release)&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 if(!fs.existsSync(release)){console.error('FIXTURE_SETUP:gate pause barrier expired');process.exit(79);}
}
if(item==='fixture-item'&&${Boolean(options.stage)}&&!state.failed&&state.count===${failAt}){
 state.failed=true;fs.writeFileSync(control,JSON.stringify(state));
 process.stdout.write(${JSON.stringify(sentinel)}+'\\n'+${options.longOutput ? JSON.stringify(secret + '\n') + "+'界'.repeat(16000)" : "''"});process.exit(17);
}
fs.writeFileSync(control,JSON.stringify(state));
const expected=state.failed&&item==='fixture-item'?'repaired-output':'valid-baseline';
if(fs.readFileSync('output.txt','utf8')!==expected){console.error('Exact candidate output mismatch');process.exit(18);}
console.log('literal candidate validated: '+expected);
`);
  const policy = (await f.store.load()).policy;
  policy.deadline = Date.now() + 600_000;
  policy.maxAssignments = 160;
  policy.gates.verify.args = [gatePath];
  f.store = new LoopStore(path.join(f.root, 'repair-state'));
  await f.store.init(policy);
  const provider = f.config.providers[0], target = f.config.targets[0];
  provider.prefixArgs = [workerPath];
  if (options.longOutput) { process.env[secretKey] = secret; provider.environmentKeys = [secretKey]; }
  target.maxContextTokens = options.contextLimit ?? 300_000;
  f.config.qualifications = [await createPolicyQualification(provider, target, await probeProvider(provider), {
    id: 'repair-qualification', profiles: ['execution', 'analysis', 'critical'], score: 100,
    expires: Date.now() + 600_000, suiteVersion: 'repair-v1', evidencePath: f.config.qualifications[0].evidencePath,
  })];
  await configureDispatch(f.store, f.config);
  return { ...f, captures, gateState, options, qualifiedScripts: { worker: digest(worker), gate: digest(await readFile(gatePath)) } };
}
export type RepairFixture = Awaited<ReturnType<typeof repairFixture>>;
export async function packets(f: RepairFixture) {
  const records = [];
  for (const name of await readdir(f.captures)) if (name.endsWith('.json')) {
    const record = JSON.parse(await readFile(path.join(f.captures, name), 'utf8'));
    records.push(record as { request: { packet: Record<string, unknown>; job: string; worker: { instance: string; context: string } }; at: number; pid: number });
  }
  return records.sort((a, b) => a.at - b.at);
}
export function objects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)];
}
export function diagnosticRecords(packet: Record<string, unknown>) {
  // Separate from current-assignment success evidence; field spelling is not a protocol oracle.
  return objects(Object.fromEntries(Object.entries(packet).filter(([key]) => !['evidence', 'inputs', 'activity', 'reviewTarget'].includes(key))))
    .filter(v => v.gate === 'verify' && typeof v.outputHash === 'string' && typeof v.exitCode === 'number' && v.exitCode !== 0);
}
export async function changedReviewOracle(f: RepairFixture, action: NextAction | undefined) {
  if (action?.kind !== 'dispatch' || action.task.purpose !== 'review') return;
  const state = await f.store.load(), activity = state.activities[action.task.activity];
  if (!activity.reviews.length) return;
  const newest = Object.values(state.artifacts).filter(a => a.activity === activity.id).sort((a, b) => b.version - a.version)[0];
  invariant(activity.reviews.every(r => r.hash !== newest.hash), 'CHANGED_ARTIFACT:new review must bind changed bytes');
  const content = (await f.store.verifiedBlob(path.join(f.store.directory, 'blobs', newest.hash), newest.hash)).toString('utf8');
  const output = await readFile(path.join(f.workspace, 'output.txt'), 'utf8');
  invariant(content.includes('repaired-output') || content.includes((await f.store.context(state)).candidate.digest) || (output === 'valid-baseline' && content.includes('valid-baseline-review-1')), 'CHANGED_ARTIFACT:content must identify repair semantics or candidate');
}
export async function step(f: RepairFixture) {
  const before = await dispatchStatus(f.store, f.config, f.selection);
  await changedReviewOracle(f, before.actions[0]);
  return drive(f.store, f.config, f.selection, { maxSteps: 1 });
}
export async function until(f: RepairFixture, predicate: (state: LoopState, status: DispatchStatus) => boolean, name: string) {
  for (let i = 0; i < 180; i++) {
    const state = await f.store.load(), status = await dispatchStatus(f.store, f.config, f.selection);
    if (predicate(state, status)) return { state, status };
    setup(!['blocked', 'owner-needed', 'complete'].includes(status.actions[0]?.kind ?? ''), `${name}: ${canonical(status.checkpoints)} ${canonical(status.actions)}`);
    const oldRevision = state.revision;
    await step(f);
    const next = await f.store.load();
    invariant(next.revision > oldRevision, 'R1:bounded step must make durable state progress');
  }
  throw new Error(`FIXTURE_SETUP:${name}: bounded progress deadline exceeded`);
}
export function waveIn(state: LoopState, item = 'fixture-item'): StoredArtifact | undefined {
  return Object.values(state.artifacts).find(a => state.activities[a.activity].item === item && state.activities[a.activity].kind === 'implementation-wave:build' && a.acceptedHash === a.hash);
}
export async function acceptedWaveFixture() {
  const f = await repairFixture();
  const { state } = await until(f, s => Boolean(waveIn(s)), 'accepted actual-process wave');
  return { ...f, wave: waveIn(state)! };
}
export async function invalidateAcceptedWave(f: RepairFixture, wave: StoredArtifact) {
  await f.store.locked(async () => {
    const state = await f.store.load();
    await commitEvent(f.store, state, `repair-invalidate:${state.revision}`, 'artifact.invalidate', { artifact: wave.id, reason: 'Observed invalidation fixture' });
  });
}
export function snapshot(activity: Activity) {
  return { id: activity.id, rounds: activity.rounds, authors: canonical(activity.authors), reviews: canonical(activity.reviews) };
}
function preserved(activity: Activity, before: ReturnType<typeof snapshot>) {
  invariant(activity.id === before.id && activity.rounds === before.rounds && canonical(activity.authors) === before.authors && canonical(activity.reviews) === before.reviews, 'R5:invalidation/restart must preserve identity, authors, reviews and substantive rounds');
}
export async function failureFixture(stage: FailureStage, options: Omit<Options, 'stage'> = {}) {
  const f = await repairFixture({ ...options, stage });
  const { state: before } = await until(f, (_s, status) => {
    const a = status.actions[0]; return a?.kind === 'dispatch' && a.task.kind === stage && a.task.purpose !== 'review';
  }, `before real ${stage} gate`);
  const wave = waveIn(before); setup(wave, 'accepted wave before actual gate failure');
  const budget = snapshot(before.activities[wave.activity]);
  if (stage === 'final-report') {
    setup(Object.values(before.artifacts).some(a => before.activities[a.activity].kind === 'verification' && a.acceptedHash === a.hash), 'R3 requires accepted verification before failure');
    setup(Object.values(before.artifacts).some(a => before.activities[a.activity].kind === 'whole-change-review' && a.acceptedHash === a.hash), 'R3 requires accepted whole-change review before failure');
  }
  await step(f);
  const failedState = await f.store.load(), journal = await loadJournal(f.store, f.config);
  const evidence = Object.values(failedState.evidence).find(e => e.exitCode === 17);
  setup(evidence, 'actual nonzero gate evidence absent');
  const failedJob = Object.values(journal.jobs).find(j => j.assignment === evidence.assignment);
  setup(failedJob?.task.kind === stage && failedJob.status === 'rejected', `actual ${stage} failure assignment not reconciled`);
  setup(failedState.assignments[evidence.assignment].reconciled, 'failed assignment must be reconciled before restart');
  setup(Object.values(failedState.operations).filter(o => o.assignment === evidence.assignment).every(o => o.status === 'terminated' && o.reconciled), 'known gate failure must be terminated');
  setup((await f.store.verifiedBlob(evidence.outputPath, evidence.outputHash)).toString('utf8').includes(sentinel), 'actual failed output sentinel absent');
  invariant(failedState.items[f.selection.id].status === 'queued', 'R2:known failed gate must actually invalidate the implementation');
  preserved(failedState.activities[wave.activity], budget);
  for (const a of Object.values(before.artifacts).filter(a => ['verification', 'whole-change-review', 'final-report'].includes(before.activities[a.activity].kind))) {
    invariant(failedState.artifacts[a.id].acceptedHash === null, 'R3:downstream acceptance must be invalidated after gate failure');
  }
  f.store = new LoopStore(f.store.directory);
  preserved((await f.store.load()).activities[wave.activity], budget);
  return { ...f, before, failedState, wave, budget, evidence, failedJob };
}
export async function toRepair(f: RepairFixture) {
  return until(f, (_s, status) => {
    const a = status.actions[0]; return a?.kind === 'dispatch' && a.task.kind === 'implementation-wave:build' && a.task.purpose === 'repair';
  }, 'repair child admission');
}
export async function assertFailurePacket(f: RepairFixture, evidence: Evidence) {
  const label = f.options.stage === 'final-report' ? 'R3' : 'R2';
  const captured = (await packets(f)).filter(r => {
    const t = r.request.packet.task as { kind: string; purpose: string };
    return t.kind === 'implementation-wave:build' && t.purpose === 'repair' && r.at >= evidence.finished;
  }).at(-1);
  invariant(captured, `${label}:repair packet must reach a fresh actual child`);
  const record = diagnosticRecords(captured.request.packet).find(d => d.id === evidence.id || d.evidenceId === evidence.id || d.evidence === evidence.id);
  invariant(record, `${label}:repair packet must contain causally relevant prior failed gate diagnostics`);
  invariant(record.assignment === evidence.assignment && record.outputHash === evidence.outputHash && record.exitCode === 17 && record.gate === evidence.gate, `${label}:diagnostics must bind actual failed assignment/output identity`);
  invariant(canonical(record).includes(evidence.candidate.digest) && canonical(record).includes(sentinel), `${label}:verified diagnostic bytes and candidate must reach repair`);
  invariant(captured.at >= evidence.finished, `${label}:gate must fail before repair child launch`);
  const current = captured.request.packet.evidence as Evidence[];
  invariant(!current.some(e => e.id === evidence.id), `${label}:prior failure must remain separate from current-assignment evidence`);
  invariant(captured.request.worker.instance !== evidence.worker.instance && captured.request.worker.context !== evidence.worker.context, 'R5:repair requires fresh worker and context');
  return record;
}
export async function runReentry() {
  const f = await acceptedWaveFixture(), before = await f.store.load();
  const scope = Object.values(before.artifacts).find(a => before.activities[a.activity].kind === 'scope')!;
  const oldAdvance = before.events.find(e => e.type === 'item.advance' && e.payload.status === 'scoped');
  setup(oldAdvance, 'acknowledged prior scoped advance missing');
  await invalidateAcceptedWave(f, f.wave);
  const reset = await f.store.load();
  invariant(reset.items[f.selection.id].status === 'queued' && reset.artifacts[scope.id].acceptedHash === scope.hash, 'R1:observed reset must preserve accepted scope');
  const journal = await loadJournal(f.store, f.config), imported = Object.values(journal.jobs).find(j => j.status === 'imported');
  setup(imported, 'real imported job absent');
  await importJob(f.store, f.config, imported.id);
  invariant((await f.store.load()).revision === reset.revision, 'R1:identical result replay remains idempotent');
  await f.store.locked(async () => {
    const current = await f.store.load();
    const replay = await commitEvent(f.store, current, oldAdvance.id, oldAdvance.type, oldAdvance.payload);
    invariant(replay.revision === current.revision, 'R1:arbitrary duplicate event must remain idempotent');
  });
  f.store = new LoopStore(f.store.directory);
  const action = (await dispatchStatus(f.store, f.config, f.selection)).actions[0];
  await step(f);
  const reentered = await f.store.load();
  invariant(reentered.items[f.selection.id].status !== 'queued' && reentered.revision > reset.revision, 'R1:acknowledged advance must leave queued after invalidation');
  invariant(!reentered.events.some(e => e.id === `dispatch:${action.key}` && e.id === oldAdvance.id), 'R1:later genuine transition needs distinct action identity');
  await until(f, (s, status) => s.items[f.selection.id].status === 'shipped' || status.actions[0]?.kind === 'owner-needed', 'bounded reentry disposition');
  return f;
}
export async function runCheckpoint() {
  const f = await acceptedWaveFixture(); await invalidateAcceptedWave(f, f.wave);
  f.store = new LoopStore(f.store.directory);
  const before = await readFile(path.join(f.store.directory, 'dispatch-journal.json'));
  const stateBefore = await readFile(path.join(f.store.directory, 'state.json'));
  await drive(f.store, f.config, f.selection, { maxSteps: 0 });
  invariant(before.equals(await readFile(path.join(f.store.directory, 'dispatch-journal.json'))) && stateBefore.equals(await readFile(path.join(f.store.directory, 'state.json'))), 'R4:zero-step status must be read-only');
  await drive(f.store, f.config, f.selection, { maxSteps: 2 });
  const status = await dispatchStatus(new LoopStore(f.store.directory), f.config, f.selection);
  const explanation = status.checkpoints[f.selection.id];
  invariant(typeof explanation === 'string' && /limit|budget|exhaust|blocked|unchanged|progress|prerequisite/i.test(explanation) && /step|advance|scoped|queued|action|stage/i.test(explanation), 'R4:bounded stop must persist blocked action/stage and prerequisite or exhausted limit');
  invariant((await f.store.load()).items[f.selection.id].status !== 'shipped', 'R4:partial bounded drive must not claim delivery');
  return f;
}
export async function runGateRepair(stage: FailureStage, options: Omit<Options, 'stage'> = {}) {
  const f = await failureFixture(stage, options);
  if (options.exhausted) {
    invariant(f.budget.rounds === 2 && f.before.activities[f.wave.activity].reviews[0].verdict === 'defective', 'R5:exhaustion must come from actual defective then clean checker results');
    const previousJobs = (await loadJournal(f.store, f.config)).jobs;
    await drive(f.store, f.config, f.selection, { maxSteps: 12 });
    const status = await dispatchStatus(new LoopStore(f.store.directory), f.config, f.selection), state = await f.store.load();
    invariant(status.actions[0]?.kind === 'owner-needed', 'R5:exhausted real review budget requires terminating owner disposition');
    preserved(state.activities[f.wave.activity], f.budget);
    invariant(Object.keys((await loadJournal(f.store, f.config)).jobs).length === Object.keys(previousJobs).length, 'R5:exhaustion must not launch a third checker or renamed replacement');
    return f;
  }
  await toRepair(f);
  const beforeLaunch = await f.store.load(); preserved(beforeLaunch.activities[f.wave.activity], f.budget);
  await step(f);
  await assertFailurePacket(f, f.evidence);
  invariant(await readFile(path.join(f.workspace, 'output.txt'), 'utf8') === 'repaired-output', 'R2:literal diagnostic-dependent repair must change actual candidate');
  await until(f, s => s.items[f.selection.id].status === 'shipped', 'repaired local delivery');
  const state = await f.store.load(), wave = waveIn(state)!;
  invariant(wave.activity === f.wave.activity && state.activities[wave.activity].rounds === f.budget.rounds + 1, 'R5:repair must consume remaining review in the same activity');
  invariant(wave.hash !== f.wave.hash && state.activities[wave.activity].reviews.at(-1)?.hash === wave.hash, 'R2:changed repair must receive independent checking');
  invariant(wave.author.instance !== f.wave.author.instance && wave.author.context !== f.wave.author.context, 'R5:restart repair must use a fresh author/context');
  for (const old of Object.values(f.before.artifacts).filter(a => ['scope', 'criteria', 'design', 'plan', 'test-design'].includes(f.before.activities[a.activity].kind))) {
    invariant(state.artifacts[old.id].acceptedHash === old.hash, 'R2:unchanged accepted upstream artifacts stay unchanged');
  }
  const context = await f.store.context(state), final = Object.values(state.finalReports).at(-1);
  invariant(final?.candidate.digest === context.candidate.digest && final.regressionEvidence.length > 0, 'R3:final delivery must bind repaired candidate and mandatory regression');
  for (const id of final.regressionEvidence) invariant(state.evidence[id].exitCode === 0 && state.evidence[id].candidate.digest === context.candidate.digest && state.evidence[id].finished >= f.evidence.finished, 'R3:stale evidence cannot replace current regression');
  const verification = state.artifacts[final.verificationArtifact];
  invariant(verification.candidate.digest === context.candidate.digest && verification.acceptedHash === verification.hash, 'R3:fresh current-candidate verification required');
  const paths = f.config.providers[0].prefixArgs;
  invariant(digest(await readFile(paths[0])) === f.qualifiedScripts.worker && digest(await readFile((await f.store.load()).policy.gates.verify.args[0])) === f.qualifiedScripts.gate, 'QUALIFICATION:worker/gate bytes must remain fixed');
  return f;
}

export async function missingDiagnosticControl(mode: 'missing' | 'corrupt') {
  const f = await failureFixture('verification'); await toRepair(f);
  const journalBefore = await loadJournal(f.store, f.config), count = (await packets(f)).length;
  if (mode === 'missing') await rm(f.evidence.outputPath);
  else await writeFile(f.evidence.outputPath, 'corrupt actual immutable failed output');
  // Integrity failure precedes scheduling: it is rejection, not a writable checkpoint.
  const sidecar = await readFile(path.join(f.store.directory, 'dispatch-journal.json'));
  const stateBytes = await readFile(path.join(f.store.directory, 'state.json'));
  let rejection: unknown;
  try { await drive(f.store, f.config, f.selection, { maxSteps: 1 }); } catch (error) { rejection = error; }
  const raw = JSON.parse(await readFile(path.join(f.store.directory, 'dispatch-journal.json'), 'utf8'));
  invariant((await packets(f)).length === count && Object.keys(raw.jobs).length === Object.keys(journalBefore.jobs).length, 'DIAGNOSTICS:missing/corrupt evidence cannot authorize repair');
  invariant(rejection instanceof Error && /ENOENT|blob|integrity|missing/i.test(rejection.message), 'DIAGNOSTICS:missing/corrupt referenced bytes must reject before admission');
  invariant(sidecar.equals(await readFile(path.join(f.store.directory, 'dispatch-journal.json'))) && stateBytes.equals(await readFile(path.join(f.store.directory, 'state.json'))), 'DIAGNOSTICS:integrity rejection must not fabricate state, acceptance, or a writable journal');
}
export async function nonGateControl(mode: 'review' | 'invalidation' | 'paused' | 'provider') {
  const f = await repairFixture({ exhausted: mode === 'review', nonGateFailure: mode === 'provider', pauseAtGate: mode === 'paused' });
  if (mode === 'paused') {
    const { state } = await until(f, (_s, status) => {
      const a = status.actions[0]; return a?.kind === 'dispatch' && a.task.kind === 'verification' && a.task.purpose !== 'review';
    }, 'verifier prelaunch gate admission');
    const wave = waveIn(state)!;
    const savedBudget = snapshot(state.activities[wave.activity]);
    const count = (await packets(f)).length;
    const running = drive(f.store, f.config, f.selection, { maxSteps: 1 });
    let ready = false;
    try {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        try { ready = (await readFile(path.join(f.captures, 'pause-ready'), 'utf8')) === 'prelaunch gate running'; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      setup(ready, 'real prelaunch gate must reach bounded pause barrier');
      await controlDispatch(f.store, f.config, 'pause', 'pause wins while real verifier gate is running');
    } finally {
      await writeFile(path.join(f.captures, 'pause-release'), 'gate may finish');
      await running;
    }
    const paused = await f.store.load(), journal = await loadJournal(f.store, f.config);
    invariant((await packets(f)).length === count && paused.runStatus === 'paused', 'NON_GATE:PausedAdmission must prevent provider spawn after real successful gate');
    const failed = Object.values(journal.jobs).at(-1)!;
    invariant(failed.status === 'rejected' && /pause/i.test(failed.rejection ?? '') && paused.assignments[failed.assignment].reconciled, 'NON_GATE:PausedAdmission must reconcile its actual unlaunched assignment');
    invariant(paused.artifacts[wave.id].acceptedHash === wave.hash, 'NON_GATE:PausedAdmission must preserve checked implementation acceptance');
    preserved(paused.activities[wave.activity], savedBudget);
    await controlDispatch(f.store, f.config, 'resume', 'resume without invented gate failure');
  }
  if (mode === 'invalidation') {
    const { state } = await until(f, s => Boolean(waveIn(s)), 'direct invalidation wave');
    await invalidateAcceptedWave(f, waveIn(state)!);
  }
  await until(f, s => s.items[f.selection.id].status === 'shipped', `non-gate ${mode} delivery`);
  invariant(!Object.values((await f.store.load()).evidence).some(e => e.exitCode !== 0), 'NON_GATE:fixture must not manufacture failed gate evidence');
  for (const record of await packets(f)) invariant(diagnosticRecords(record.request.packet).length === 0, 'NON_GATE:repair purpose/retry prefix alone cannot require or invent gate diagnostics');
}
export async function boundedDiagnosticControl(admission = false) {
  const f = await failureFixture('verification', { longOutput: true, contextLimit: admission ? 65_536 : 300_000 });
  await toRepair(f);
  const count = (await packets(f)).length;
  await step(f);
  if (admission) {
    const status = await dispatchStatus(f.store, f.config, f.selection);
    invariant((await packets(f)).length === count && /context|packet|target|token/i.test(status.checkpoints[f.selection.id] ?? ''), 'DIAGNOSTICS:prior output bytes must participate in prelaunch context admission');
    return;
  }
  const diagnostic = await assertFailurePacket(f, f.evidence);
  const strings = objects(diagnostic).flatMap(v => Object.values(v).filter((x): x is string => typeof x === 'string'));
  const excerpt = strings.find(s => s.includes(sentinel));
  invariant(excerpt && Buffer.byteLength(excerpt, 'utf8') <= 32768 && !excerpt.includes(String.fromCodePoint(0xfffd)), 'DIAGNOSTICS:excerpt must be bounded valid UTF-8');
  invariant(/truncat/i.test(canonical(diagnostic)) && !canonical(diagnostic).includes(secret) && canonical(diagnostic).includes('[redacted]'), 'DIAGNOSTICS:long output must label truncation and redact configured credential');
  const journal = await loadJournal(f.store, f.config), job = Object.values(journal.jobs).at(-1)!;
  const packet = await readFile(job.packetPath, 'utf8');
  invariant(!packet.includes(secret) && digest(canonical(JSON.parse(packet))) === job.packetHash, 'DIAGNOSTICS:redacted diagnostic bytes must be packet-hash-bound');
}
export async function wrongItemControl() {
  const f = await failureFixture('verification');
  const other = { ...f.selection, id: 'unrelated-item' };
  f.selection = other;
  const { state } = await until(f, s => Boolean(waveIn(s, other.id)), 'unrelated item accepted wave');
  await invalidateAcceptedWave(f, waveIn(state, other.id)!);
  await until(f, s => s.items[other.id].status === 'shipped', 'unrelated item repair delivery');
  for (const record of await packets(f)) {
    const task = record.request.packet.task as { item: string };
    if (task.item === other.id) invariant(diagnosticRecords(record.request.packet).length === 0, 'DIAGNOSTICS:unrelated historical failure must never be attached to another item');
  }
}
