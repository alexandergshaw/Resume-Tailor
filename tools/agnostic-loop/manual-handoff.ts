import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoopStore } from './store';
import { requireLiveVerification } from './live-verification';
import type { Context, LoopState } from './types';

/** Delivery assertion for a host-owned manual run; never schedules or mutates. */
export function assessManualHandoff(state: LoopState, requested: string[], now = Date.now(), context?: Context) {
  if (!requested.length || requested.some(id => !Object.hasOwn(state.items, id))) {
    throw new Error('Name every requested item explicitly; empty or unknown selections cannot prove delivery');
  }
  const deadlineExpired = now > state.policy.deadline;
  const items = [...new Set(requested)].map(id => {
    const item = state.items[id];
    const assignments = Object.values(state.assignments).filter(a => a.item === id);
    const retained = assignments.filter(a => a.status !== 'finished' && !a.reconciled);
    const operations = Object.values(state.operations).filter(o => assignments.some(a => a.id === o.assignment) && (o.status !== 'terminated' || !o.reconciled));
    const ownerNeeded = Object.values(state.activities).filter(a => a.item === id && a.status === 'owner-needed').map(a => a.id);
    let liveVerification: { artifact: string | null; pending: boolean; reason: string | null };
    try { if (!context) throw new Error('Live verification freshness unproven: capture the current store context'); liveVerification = { artifact:requireLiveVerification(state,item,context),pending:false,reason:null }; } catch (error) { liveVerification = { artifact:null,pending:true,reason:error instanceof Error ? error.message : 'Live verification unproven' }; }
    const pending = liveVerification.pending || item.status !== 'shipped' || retained.length > 0 || operations.length > 0 || item.needs.length > 0 || ownerNeeded.length > 0;
    return {
      id, status: item.status, pending, liveVerification,
      handoffState: !pending ? 'complete' : deadlineExpired ? 'pending-expired' : 'pending',
      retainedAssignments: retained.map(a => ({ id: a.id, role: a.role, status: a.status })),
      outstandingOperations: operations.map(o => ({ id: o.id, status: o.status })),
      ownerNeeded, needs: item.needs,
      action: !pending ? 'Local delivery recorded' : operations.length
        ? 'Observe termination and reconcile uncertainty before any retry; do not remove locks'
        : deadlineExpired ? 'Run deadline expired. Preserve accepted evidence and history; resolve any retained host-worker ownership, then obtain a terminating owner disposition or explicit authorization for further work. Existing review-round limits still apply. Policy continuation changes the policy hash and stales prior gate evidence; do not renew the policy or rerun gates without explicit authorization.'
        : ownerNeeded.length ? 'Obtain a terminating owner disposition; no third substantive round'
        : retained.length ? 'Wait for actual host worker completion, inspect owned files, import output and result, then admit the independent next role'
        : liveVerification.pending ? liveVerification.reason!
        : 'Continue independent role admission and required gates through local delivery; surface unavailable instruments explicitly',
    };
  });
  return { revision: state.revision, deadlineExpired, complete: items.every(item => !item.pending), items,
    limitation: 'A snapshot assertion cannot wake a chat, observe host workers, or supply a completion callback. A launch or worker report is not delivery.' };
}

export async function checkManualHandoff(args: string[]) {
  const [directory, ...items] = args;
  if (!directory || !items.length || args.some(value => value.startsWith('--'))) {
    throw new Error('Usage: manual-handoff.ts STORE ITEM [ITEM ...]');
  }
  const store = new LoopStore(directory), state = await store.load();
  let context: Context | undefined;
  try { context = await store.context(state); } catch { /* Freshness unavailable is pending, never a pass. */ }
  return assessManualHandoff(state, items, Date.now(), context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkManualHandoff(process.argv.slice(2)).then(report => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.complete ? 0 : 2;
  }).catch(() => {
    process.stderr.write('Manual handoff unproven: inspect the store and explicit item selection. No transition or recovery was performed.\n');
    process.exitCode = 1;
  });
}
