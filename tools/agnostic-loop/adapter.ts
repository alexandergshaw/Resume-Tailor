import { readFile, writeFile } from 'node:fs/promises';
import { LoopStore } from './store';
import { canonical, keys, object } from './json';
import { validateEvent } from './validation';
import { observeEvent } from './observed';

export async function exportPacket(store: LoopStore, assignmentId: string, output: string): Promise<unknown> {
  const state = await store.load(); const assignment = state.assignments[assignmentId];
  if (!assignment || assignment.status !== 'running') throw new Error('Packet requires running assignment');
  const context = await store.context(state);
  for (const [id, hash] of Object.entries(assignment.inputs)) if (state.artifacts[id]?.acceptedHash !== hash || context.artifacts[id]?.hash !== hash) throw new Error('Packet input is no longer accepted/current');
  const candidate = context.candidate;
  if (candidate.policyHash !== assignment.policyHash) throw new Error('Packet policy is stale');
  const packet = { schemaVersion: 1, revision: state.revision, assignment, item: state.items[assignment.item], activity: state.activities[assignment.activity], inputs: Object.keys(assignment.inputs).map(id => state.artifacts[id]), decisions: Object.values(state.decisions).filter(d => d.activity === assignment.activity), candidate, budget: { deadline: state.policy.deadline, maxAssignments: state.policy.maxAssignments, remainingAssignments: state.policy.maxAssignments - Object.keys(state.assignments).length }, identityStatus: 'operator-attested; file adapter cannot independently authenticate provider identity', usage: 'unavailable' };
  await writeFile(output, JSON.stringify(packet, null, 2)); return packet;
}
const workerEvents = ['review.record', 'transcription.verify', 'assignment.finish', 'verification.record', 'final.record'];
export async function importResult(store: LoopStore, filename: string, actor: string): Promise<unknown> {
  const result = object(JSON.parse(await readFile(filename, 'utf8')), 'result');
  keys(result, ['schemaVersion', 'id', 'expectedRevision', 'assignment', 'worker', 'publicationToken', 'event', 'usage'], 'result');
  if (result.schemaVersion !== 1 || !['unavailable', 'operator-attested'].includes(String(result.usage))) throw new Error('Unsupported result version or usage status');
  const state = await store.load(); const assignment = state.assignments[String(result.assignment)];
  if (!assignment || canonical(assignment.worker) !== canonical(result.worker)) throw new Error('Result identity or publication authority mismatch');
  const record = object(result.event, 'result event'); keys(record, ['type', 'payload'], 'result event');
  if (!workerEvents.includes(String(record.type))) throw new Error('Worker result cannot grant authority or invent trusted observations');
  const payload = object(record.payload, 'result payload');
  if (payload.assignment !== assignment.id) throw new Error('Result assignment substitution');
  const event = validateEvent({ id: result.id, expectedRevision: result.expectedRevision, actor, type: record.type, payload });
  const acknowledged = state.events.find(previous => previous.id === event.id);
  if (acknowledged) {
    const originalGrant = state.events.find(previous => previous.type === 'assignment.start' && previous.payload.id === assignment.id);
    if (!originalGrant || result.publicationToken !== originalGrant.id) throw new Error('Result replay publication authority mismatch');
    if (canonical(acknowledged) !== canonical(event)) throw new Error('Conflicting reused event ID');
    return store.transact(event);
  }
  if (assignment.status !== 'running' || assignment.publicationToken !== result.publicationToken) throw new Error('Result identity or publication authority mismatch');
  return store.transact(event, await observeEvent(store, event));
}
