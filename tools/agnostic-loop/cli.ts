import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { LoopStore } from './store';
import { validateEvent } from './validation';
import { nextAssignments } from './scheduler';
import { importArtifact, observeEvent } from './observed';
import { exportPacket, importResult } from './adapter';
import { reconcileOperation, recoverOperations, runGate } from './runner';
import { buildManualFinalReport } from './manual-final-report';
import type { Residual } from './types';

export async function dispatch(args: string[]): Promise<unknown> {
  if (['dispatch', 'drive', 'doctor', 'explain', 'mcp'].includes(args[0])) return (await import('./dispatch-cli')).dispatchAutomatic(args);
  const positional: string[] = []; const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (!['--state', '--actor', '--workspace', '--policy', '--token', '--acknowledgement', '--output'].includes(args[i]) || flags[args[i]] !== undefined || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Unknown, duplicate or missing CLI option');
      flags[args[i]] = args[++i];
    } else positional.push(args[i]);
  }
  const [command, ...parameters] = positional;
  const arity: Record<string, number> = { init: 0, status: 0, next: 0, apply: 1, import: 3, packet: 2, result: 1, run: 2, demo: 1, 'assemble-final': 2, 'recover-lock': 0, 'recover-operations': 0, 'reconcile-operation': 1 };
  if (!(command in arity) || parameters.length !== arity[command]) throw new Error('Usage: init|status|next|apply EVENT|import ASSIGNMENT ID FILE|packet ASSIGNMENT FILE|result FILE|run ASSIGNMENT GATE|assemble-final ASSIGNMENT RESIDUALS_JSON|demo DIRECTORY|recover-lock|recover-operations; options --state DIRECTORY --actor OPERATOR');
  if (flags['--output'] !== undefined && (command !== 'status' || flags['--output'] !== 'summary')) throw new Error('Output requires status --output summary');
  if (command === 'demo') return (await import('./demo')).runDemo(parameters[0]);
  const store = new LoopStore(flags['--state'] ?? '.agnostic-loop');
  if (command === 'init') {
    if (!flags['--policy'] || !flags['--workspace']) throw new Error('Init requires --policy JSON-file and --workspace DIRECTORY');
    const policy = JSON.parse(await readFile(flags['--policy'], 'utf8'));
    if (policy.workspace !== flags['--workspace']) throw new Error('Workspace flag must equal trusted policy workspace');
    return store.init(policy);
  }
  if (command === 'recover-lock') {
    if (!flags['--token'] || !flags['--acknowledgement'] || !flags['--actor']) throw new Error('Recovery requires --actor, --token and --acknowledgement');
    await store.recoverLock(flags['--token'], flags['--acknowledgement']); return { recovered: true };
  }
  const state = await store.load();
  // Snapshot assembly performs no live candidate capture, publication or acceptance.
  if (command === 'assemble-final') return buildManualFinalReport(state, parameters[0], JSON.parse(await readFile(parameters[1], 'utf8')) as Residual[]);
  const context = await store.context(state);
  if (command === 'status') {
    const status = { ...state, candidate: context.candidate, staleArtifacts: Object.keys(state.artifacts).filter(id => !context.artifacts[id]), scheduling: nextAssignments(state, context), limitations: ['Provider identity is operator-attested', 'No hostile-worker sandbox', 'Whole-candidate evidence only'] };
    if (flags['--output'] === 'summary') return {
      revision: state.revision, runStatus: state.runStatus,
      items: Object.values(state.items).map(({ id, status, needs, escalation }) => ({ id, status, needs, escalation })),
      assignments: Object.values(state.assignments).map(({ id, item, role, status, reconciled, reason }) => ({ id, item, role, status, reconciled, reason })),
      operations: Object.values(state.operations).map(({ id, assignment, status, reconciled }) => ({ id, assignment, status, reconciled })),
      candidate: context.candidate.digest, staleArtifacts: status.staleArtifacts, scheduling: status.scheduling, limitations: status.limitations,
    };
    return status;
  }
  if (command === 'next') return nextAssignments(state, context);
  if (command === 'packet') return exportPacket(store, parameters[0], parameters[1]);
  const actor = flags['--actor']; if (!actor) throw new Error('Mutation requires explicit trusted operator --actor');
  if (command === 'recover-operations') return { unknown: await recoverOperations(store, actor) };
  if (command === 'reconcile-operation') { await reconcileOperation(store, parameters[0], actor, flags['--acknowledgement'] ?? ''); return { reconciled: parameters[0] }; }
  if (command === 'import') return importArtifact(store, parameters[0], parameters[1], parameters[2], actor);
  if (command === 'result') return importResult(store, parameters[0], actor);
  if (command === 'run') return runGate(store, parameters[0], parameters[1], actor);
  const raw = JSON.parse(await readFile(parameters[0], 'utf8'));
  const event = validateEvent({ ...raw, actor });
  if (event.type.startsWith('operation.') || ['artifact.submit', 'evidence.record'].includes(event.type)) throw new Error('This lifecycle event requires import or run; bare apply cannot fabricate observed records');
  return store.transact(event, await observeEvent(store, event));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const stdioMcp = args[0] === 'mcp' || (args[0] === 'dispatch' && args[1] === 'mcp');
  dispatch(args).then(value => { if (!stdioMcp) process.stdout.write(`${JSON.stringify({ ok: true, result: value })}\n`); }).catch(error => {
    let message = error instanceof Error ? error.message : 'Command failed';
    for (const value of Object.values(process.env).filter((v): v is string => Boolean(v) && v!.length > 3).sort((a,b) => b.length-a.length)) message = message.split(value).join('[redacted]');
    (stdioMcp ? process.stderr : process.stdout).write(`${JSON.stringify({ ok: false, error: message, action: 'Inspect status and correct the named prerequisite; no successful transition was recorded' })}\n`); process.exitCode = 1;
  });
}
