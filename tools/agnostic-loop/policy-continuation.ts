import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { canonical, digest } from './json';
import type { Context, Envelope, LoopState } from './types';

export type PolicyContinuation = {
  priorPolicyHash: string;
  deadline: number;
  maxExtensionMs: number;
  authorization: string;
  reason: string;
  gateArgumentCorrections: { gate: string; index: number; previous: string; replacement: string }[];
};

// Called under the store lock. Any marker, including an invalid or symlinked
// marker, fences manual continuation; absence alone admits this manual action.
export async function assertManualStore(directory: string): Promise<void> {
  for (const name of ['dispatch-config.json', 'dispatch-journal.json']) {
    try { await lstat(path.join(directory, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('Manual policy continuation cannot amend a native dispatch grant');
  }
}

export function continuePolicy(s: LoopState, event: Envelope, c: Context): void {
  const p = event.payload as unknown as PolicyContinuation;
  const require = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
  require(event.actor === s.policy.owner, 'owner authority required');
  require(c.manualPolicyContinuation === true && !c.configuration && !c.artifactAllocation, 'locked manual-store observation required');
  require(s.runStatus !== 'cancelled', 'cancelled run cannot continue');
  const prior = digest(canonical(s.policy));
  require(p.priorPolicyHash === prior && c.candidate.policyHash === prior, 'prior policy binding stale');
  require(!s.events.some(e => e.type === 'policy.continue' && e.payload.authorization === p.authorization), 'continuation authorization already consumed');
  require(Object.values(s.assignments).every(a => a.status === 'finished' || (a.status !== 'running' && a.reconciled)), 'assignments not globally quiescent/reconciled');
  require(Object.values(s.operations).every(o => o.status === 'terminated' && o.reconciled), 'operations not globally quiescent/reconciled');
  require(p.maxExtensionMs > 0 && p.deadline > s.policy.deadline && p.deadline > c.now && p.deadline - c.now <= p.maxExtensionMs, 'continuation deadline outside authorized window');
  const seen = new Set<string>();
  for (const correction of p.gateArgumentCorrections) {
    const gate = Object.hasOwn(s.policy.gates, correction.gate) ? s.policy.gates[correction.gate] : undefined;
    const key = `${correction.gate}:${correction.index}`;
    require(gate && correction.index < gate.args.length && gate.args[correction.index] === correction.previous, 'gate argument binding stale or missing');
    require(!seen.has(key) && correction.previous !== correction.replacement, 'duplicate or unchanged gate correction');
    seen.add(key);
  }
  // Only these existing argument slots and the deadline change. All evidence,
  // failures, consumed assignments, reviews, statuses and budgets remain intact.
  for (const correction of p.gateArgumentCorrections) s.policy.gates[correction.gate].args[correction.index] = correction.replacement;
  s.policy.deadline = p.deadline;
}
