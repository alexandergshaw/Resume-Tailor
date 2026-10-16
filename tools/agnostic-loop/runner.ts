import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LoopStore } from './store';
import { applyEvent } from './engine';
import { captureCandidate, commandEnvironment } from './candidate';
import type { Evidence, Operation } from './types';

export async function runGate(store: LoopStore, assignmentId: string, gateId: string, actor: string): Promise<Evidence> {
  let child: ChildProcess | undefined;
  let operation!: Operation;
  let before!: Awaited<ReturnType<typeof captureCandidate>>;
  let started = 0;
  let timeout = 0;
  let env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'production' };
  let executable = ''; let args: string[] = []; let cwd = '';
  const chunks: Buffer[] = []; let bytes = 0; let uncertain = false; let reason = '';
  let completion!: Promise<number | null>;
  await store.locked(async () => {
    let state = await store.load();
    const assignment = state.assignments[assignmentId];
    const gate = state.policy.gates[gateId];
    if (!assignment || assignment.status !== 'running' || !assignment.allowedActions.includes('run')) throw new Error('Gate requires a running assignment with run permission');
    if (!gate) throw new Error('Unknown policy gate');
    if (Object.values(state.operations).some(operation => operation.assignment === assignmentId && (operation.status !== 'terminated' || !operation.reconciled))) throw new Error('Assignment already has an outstanding operation; observe termination and reconcile before launching another command');
    if (!gate.resources.every(resource => assignment.resources.includes(resource))) throw new Error('Assignment does not reserve gate resources');
    before = await captureCandidate(state.policy);
    executable = gate.executable; args = gate.args; cwd = state.policy.workspace;
    env = commandEnvironment(state.policy); timeout = state.policy.commandTimeout;
    operation = { id: randomUUID(), assignment: assignmentId, resource: gate.resources[0] ?? 'workspace', status: 'pending', publicationToken: assignment.publicationToken, pid: null, reconciled: false };
    let context = { ...await store.context(state), operations: { [operation.id]: operation } };
    state = applyEvent(state, { id: randomUUID(), expectedRevision: state.revision, actor, type: 'operation.start', payload: { operation } }, context);
    await store.save(state);
    // Launch remains inside the admission lock, so cancellation cannot race this CAS.
    started = Date.now();
    child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const spawned = child;
    const collect = (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 1_048_576) chunks.push(chunk); else { uncertain = true; reason = 'Output limit exceeded'; spawned.kill(); } };
    spawned.stdout?.on('data', collect); spawned.stderr?.on('data', collect);
    completion = new Promise<number | null>(resolve => {
      spawned.once('error', () => { uncertain = true; reason = 'Command could not launch'; resolve(null); });
      spawned.once('close', code => resolve(code));
    });
    if (!child.pid) {
      operation = { ...operation, status: 'unknown', reconciled: false };
      state = applyEvent(state, { id: randomUUID(), expectedRevision: state.revision, actor, type: 'operation.unknown', payload: { operation } }, { ...await store.context(state), operations: { [operation.id]: operation } });
      await store.save(state); return;
    }
    operation = { ...operation, status: 'running', pid: child.pid ?? null };
    context = { ...await store.context(state), operations: { [operation.id]: operation } };
    state = applyEvent(state, { id: randomUUID(), expectedRevision: state.revision, actor, type: 'operation.running', payload: { operation } }, context);
    await store.save(state);
  });
  const tracked = child!;
  const stop = (why: string) => { uncertain = true; reason = why; tracked.kill(); };
  const timer = setTimeout(() => stop('Command timeout; process descendants require reconciliation'), Math.max(1, started + timeout - Date.now()));
  const hasAuthority = store.createAssignmentMonitor(assignmentId);
  let polling = false;
  const watcher = setInterval(async () => {
    if (polling) return; polling = true;
    try { if (!await hasAuthority()) stop('Assignment cancelled; process descendants require reconciliation'); }
    catch { stop('Cannot establish current assignment authority'); }
    finally { polling = false; }
  }, 100);
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<null>(resolve => {
    terminationTimer = setTimeout(() => { uncertain = true; reason = 'Termination could not be established within deadline'; tracked.kill(); tracked.stdout?.destroy(); tracked.stderr?.destroy(); tracked.unref(); resolve(null); }, Math.max(1, started + timeout + 1000 - Date.now()));
  });
  const exitCode = await Promise.race([completion, cutoff]);
  if (terminationTimer) clearTimeout(terminationTimer);
  const finished = Date.now();
  clearTimeout(timer); clearInterval(watcher);
  let output = Buffer.concat(chunks).toString('utf8');
  for (const value of Object.values(env).filter((value): value is string => typeof value === 'string' && value.length > 0).sort((a,b) => b.length-a.length)) output = output.split(value).join('[redacted]');
  const blob = await store.blob(Buffer.from(output, 'utf8'));
  const state = await store.load();
  const after = await captureCandidate(state.policy);
  operation = { ...operation, status: uncertain ? 'unknown' : 'terminated', reconciled: !uncertain };
  await store.transact({ id: randomUUID(), expectedRevision: state.revision, actor, type: uncertain ? 'operation.unknown' : 'operation.finish', payload: { operation } }, { operations: { [operation.id]: operation } });
  const latest = await store.load();
  const limitations = ['Local process observation cannot prove hostile descendant termination'];
  if (reason) limitations.push(reason);
  if (after.digest !== before.digest) limitations.push('Candidate changed during command');
  const fenced = latest.assignments[assignmentId].status !== 'running';
  const evidence: Evidence = { id: randomUUID(), assignment: assignmentId, worker: latest.assignments[assignmentId].worker, gate: gateId, candidate: before, executable, args, cwd, started, finished, exitCode: uncertain || fenced || after.digest !== before.digest ? null : exitCode, outputHash: blob.hash, outputPath: blob.path, limitations, kind: 'gate' };
  await store.transact({ id: randomUUID(), expectedRevision: latest.revision, actor, type: 'evidence.record', payload: { evidence } }, { evidence: { ...latest.evidence, [evidence.id]: evidence } });
  if (fenced) throw new Error('Command stopped; cancelled assignment cannot publish success and locks remain held; failed command audit retained');
  return evidence;
}

export async function recoverOperations(store: LoopStore, actor: string): Promise<string[]> {
  if (actor !== (await store.load()).policy.owner) throw new Error('Owner authority required for explicit operation recovery');
  const recovered: string[] = [];
  for (const original of Object.values((await store.load()).operations)) {
    if (!['pending', 'running'].includes(original.status)) continue;
    const state = await store.load();
    const operation: Operation = { ...original, status: 'unknown', reconciled: false };
    await store.transact({ id: randomUUID(), expectedRevision: state.revision, actor, type: 'operation.unknown', payload: { operation } }, { operations: { [operation.id]: operation } });
    recovered.push(original.id);
  }
  return recovered;
}

export async function reconcileOperation(store: LoopStore, id: string, actor: string, acknowledgement: string): Promise<void> {
  const state = await store.load();
  if (actor !== state.policy.owner || acknowledgement !== 'operations-stopped-and-side-effects-reconciled') throw new Error('Owner reconciliation requires explicit stopped-operations acknowledgement');
  const original = state.operations[id];
  if (!original || original.status !== 'unknown') throw new Error('Only unknown operations require explicit reconciliation');
  const operation: Operation = { ...original, status: 'terminated', reconciled: true };
  await store.transact({ id: randomUUID(), expectedRevision: state.revision, actor, type: 'operation.finish', payload: { operation } }, { operations: { [id]: operation } });
}
