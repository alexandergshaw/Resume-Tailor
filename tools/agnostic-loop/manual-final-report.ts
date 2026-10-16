import { equal, requireThat } from './engine';
import { canonical, digest } from './json';
import { array, object, string, validateState } from './validation';
import type { FinalReport, LoopState, Residual, StoredArtifact } from './types';

/**
 * Assemble recorded data against the admitted finalizer's candidate snapshot.
 * This performs no IO and cannot observe subsequent source/environment drift.
 * Normal observed import, engine validation and independent final review remain
 * mandatory. The returned report grants no acceptance or delivery transition.
 */
export function buildManualFinalReport(state: LoopState, assignmentId: string, residuals: Residual[], now = Date.now()): FinalReport {
  const s = validateState(state), a = s.assignments[assignmentId];
  requireThat(Number.isSafeInteger(now) && now >= 0, 'invalid assembly time');
  requireThat(a?.role === 'finalizer' && a.status === 'running' && !a.reconciled && s.runStatus !== 'cancelled', 'running admitted finalizer required');
  const item = s.items[a.item], activity = s.activities[a.activity], candidate = a.baseline;
  requireThat(activity.kind === 'final-report' && activity.status === 'open' && activity.dependencies.every(id => s.activities[id].status === 'accepted'), 'final-report activity not ready');
  requireThat(['verified','regression-passed'].includes(item.status) && !item.needs.length, 'item not ready for final assembly');
  requireThat(now <= a.deadline && now <= s.policy.deadline, 'finalizer or run deadline expired');
  requireThat(a.policyHash === candidate.policyHash && candidate.policyHash === digest(canonical(s.policy)), 'finalizer policy stale');
  const { digest: candidateDigest, ...lineage } = candidate;
  requireThat(candidateDigest === digest(canonical(lineage)), 'candidate snapshot digest invalid');
  const admission = s.events.find(e => e.type === 'assignment.start' && e.payload.id === a.id);
  requireThat(admission && admission.id === a.publicationToken && ['item','activity','role','worker','inputs','writePaths','affectedPaths','resources','allowedActions','deadline','deliverables'].every(key => equal(admission.payload[key], a[key as keyof typeof a])), 'finalizer admission changed or missing');
  requireThat(a.allowedActions.includes('write') && a.allowedActions.every(action => s.policy.allowedActions.includes(action)) && a.writePaths.length > 0 && a.writePaths.every(file => a.affectedPaths.includes(file)), 'finalizer write ownership missing');
  const itemAssignments = Object.values(s.assignments).filter(other => other.item === item.id);
  requireThat(itemAssignments.every(other => other.id === a.id || other.status === 'finished' || (other.status !== 'running' && other.reconciled)), 'item retains pending assignment');
  requireThat(Object.values(s.operations).filter(op => itemAssignments.some(other => other.id === op.assignment)).every(op => op.status === 'terminated' && op.reconciled), 'item retains pending operation');

  const accepted = (id: string): StoredArtifact => {
    const artifact = s.artifacts[id];
    requireThat(artifact && s.activities[artifact.activity].item === item.id && artifact.acceptedHash === artifact.hash && s.activities[artifact.activity].status === 'accepted', `accepted same-item input missing: ${id}`);
    requireThat(artifact.version === Math.max(...Object.values(s.artifacts).filter(other => other.activity === artifact.activity).map(other => other.version)), `input superseded: ${id}`);
    requireThat(s.assignments[artifact.assignment].status === 'finished' && equal(artifact.author,s.assignments[artifact.assignment].worker), `input author not finalized: ${id}`);
    return artifact;
  };
  for (const [id, hash] of Object.entries(a.inputs)) requireThat(accepted(id).hash === hash, `finalizer input changed: ${id}`);
  const select = (kind: string, kinds = [kind]): StoredArtifact => {
    const options = Object.keys(a.inputs).map(id => s.artifacts[id]).filter(artifact => kinds.includes(s.activities[artifact.activity].kind));
    requireThat(options.length === 1, `exactly one declared ${kind} input required`);
    const artifact = accepted(options[0].id);
    requireThat(equal(artifact.candidate,candidate), `${kind} candidate stale`);
    return artifact;
  };
  const verification = select('verification', ['verification','verification-report']), whole = select('whole-change-review');
  const report = s.verificationReports[verification.id];
  requireThat(report && equal(report.candidate,candidate) && equal(report.worker,verification.author), 'recorded verification report stale or missing');
  const evidence = (id: string) => {
    const e = s.evidence[id], author = e && s.assignments[e.assignment], gate = e && s.policy.gates[e.gate];
    requireThat(e && author?.item === item.id && author.status === 'finished' && equal(e.worker,author.worker) && e.kind === 'gate' && e.exitCode === 0 && equal(e.candidate,candidate), `passing same-item gate evidence missing or stale: ${id}`);
    requireThat(gate && author.allowedActions.includes('run') && gate.resources.every(resource => author.resources.includes(resource)) && e.executable === gate.executable && equal(e.args,gate.args) && e.cwd === s.policy.workspace && e.started <= e.finished && e.finished <= now && e.finished <= author.deadline && e.finished - e.started <= s.policy.commandTimeout, `gate binding or timing invalid: ${id}`);
    return e;
  };
  requireThat(Object.keys(report.criteria).length === item.criteria.length && item.criteria.every(id => report.criteria[id]?.length > 0), 'verification criterion coverage missing');
  const verifiedGates = Object.values(report.criteria).flat().map(id => evidence(id).gate);
  requireThat(item.requiredGates.every(gate => verifiedGates.includes(gate)), 'verification required gate coverage missing');
  const regressionEvidence = [...new Set(item.requiredGates)].sort().map(gate => {
    const options = Object.values(s.evidence).filter(e => e.gate === gate && s.assignments[e.assignment].item === item.id && equal(e.candidate,candidate)).sort((x,y) => y.finished - x.finished || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    requireThat(options.length > 0, `required gate evidence missing: ${gate}`);
    return evidence(options[0].id).id;
  });
  array(object({requirement:string,owner:string,instrument:string,step:string,closure:string}))(residuals,'residuals');
  const required = Object.values(s.decisions).filter(decision => s.activities[decision.activity].item === item.id).flatMap(decision => decision.residuals);
  requireThat(required.every(residual => residuals.some(value => equal(value,residual))), 'explicit required residuals missing');
  const assembled: FinalReport = {candidate,verificationArtifact:verification.id,regressionEvidence,wholeChangeReviewArtifact:whole.id,residuals,delivery:'local'};
  return structuredClone(assembled);
}
