import { readFile, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LoopStore } from './store';
import { digest, canonical } from './json';
import path from 'node:path';
import { contained, safeFile } from './paths';
import type { ApprovedPatch, Artifact, Context, Envelope, FinalReport, VerificationReport } from './types';

export function applyApprovedPatch(original: Buffer, patch: ApprovedPatch): Buffer {
  if (digest(original) !== patch.originalHash) throw new Error('Approved patch original hash mismatch');
  const pieces: Buffer[] = []; let cursor = 0;
  for (const replacement of patch.replacements) {
    if (!Number.isSafeInteger(replacement.start) || !Number.isSafeInteger(replacement.end) || replacement.start < cursor || replacement.end < replacement.start || replacement.end > original.length) throw new Error('Approved patch byte ranges must be sorted, non-overlapping and in bounds');
    pieces.push(original.subarray(cursor, replacement.start), Buffer.from(replacement.text, 'utf8')); cursor = replacement.end;
  }
  pieces.push(original.subarray(cursor));
  const result = Buffer.concat(pieces);
  if (digest(result) !== patch.expectedHash) throw new Error('Approved patch expected hash does not match exact byte application');
  return result;
}
export async function importArtifact(store: LoopStore, assignmentId: string, id: string, filename: string, actor: string): Promise<Artifact> {
  if ((await lstat(filename)).isSymbolicLink()) throw new Error('Artifact source cannot be a symbolic link');
  const state = await store.load();
  const assignment = state.assignments[assignmentId];
  if (!assignment) throw new Error('Unknown assignment');
  if (!contained(state.policy.workspace, filename)) throw new Error('Artifact source must be within workspace');
  const relative = path.relative(state.policy.workspace, path.resolve(filename)).split(path.sep).join('/');
  if (!assignment.writePaths.includes(relative)) throw new Error('Artifact source is outside assignment ownership');
  await safeFile(state.policy.workspace, relative);
  const blob = await store.blob(await readFile(filename));
  const artifact: Artifact = { id, activity: assignment.activity, version: Object.values(state.artifacts).filter(a => a.activity === assignment.activity).length + 1, hash: blob.hash, path: relative, author: assignment.worker, inputs: Object.keys(assignment.inputs) };
  const observed = (await store.context(state)).artifacts;
  await store.transact({ id: randomUUID(), expectedRevision: state.revision, actor, type: 'artifact.submit', payload: { assignment: assignmentId, artifact, publicationToken: assignment.publicationToken } }, { artifacts: { ...observed, [id]: artifact } });
  return artifact;
}
export async function observeEvent(store: LoopStore, event: Envelope): Promise<Partial<Context>> {
  const state = await store.load();
  if (event.type === 'decision.record' || event.type === 'transcription.verify') {
    const decision = event.type === 'decision.record' ? event.payload : state.decisions[String(event.payload.decision)];
    if (!decision) throw new Error('Unknown owner decision');
    const original = state.artifacts[String(decision.originalArtifact)];
    const result = state.artifacts[String(decision.resultingArtifact)];
    if (!original || !result) throw new Error('Owner decision requires imported original and result artifacts');
    const patch = decision.patch as ApprovedPatch;
    const expected = applyApprovedPatch(await store.verifiedBlob(path.join(store.directory, 'blobs', original.hash), original.hash), patch);
    const actual = await store.verifiedBlob(path.join(store.directory, 'blobs', result.hash), result.hash);
    if (!actual.equals(expected)) throw new Error('Result artifact differs from exact owner-approved byte patch');
    return { approvedPatches: { [String(decision.id)]: patch } };
  }
  if (event.type === 'verification.record' || event.type === 'final.record') {
    const id = String(event.payload.artifact); const artifact = state.artifacts[id];
    if (!artifact) throw new Error('Report requires imported artifact');
    const report = JSON.parse((await store.verifiedBlob(path.join(store.directory, 'blobs', artifact.hash), artifact.hash)).toString('utf8'));
    if (canonical(report) !== canonical(event.payload.report)) throw new Error('Report payload differs from observed immutable bytes');
    return event.type === 'verification.record' ? { verificationReports: { [id]: report as VerificationReport } } : { finalReports: { [id]: report as FinalReport } };
  }
  return {};
}
