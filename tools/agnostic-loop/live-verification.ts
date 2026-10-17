import { canonical } from './json';
import { relativePath } from './paths';
import type { Context, Item, LiveVerificationReport, LoopState, Worker } from './types';

export const LIVE_OBSERVATION_MAX_DURATION_MS = 3_600_000;
export const LIVE_OBSERVATION_MAX_AGE_MS = 86_400_000;
export const LIVE_APP_URL = 'https://resume-tailor-tan-psi.vercel.app/';
const same = (a: unknown,b: unknown) => canonical(a) === canonical(b);
const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(`Live verification: ${message}`); };
const distinct = (worker: Worker, other: Worker) => worker.instance !== other.instance && worker.context !== other.context;

/** Validates a host attestation, not browser truth. Immutable bytes and independent review remain mandatory. */
export function validateLiveReport(state: LoopState,item: Item,report: LiveVerificationReport,context: Context, artifactId: string): void {
  const artifact = state.artifacts[artifactId], assignment = artifact && state.assignments[artifact.assignment];
  assert(artifact && assignment?.item === item.id && assignment.role === 'verifier' && state.activities[artifact.activity]?.kind === 'live-verification','same-item admitted live verifier artifact required');
  assert(same(report.worker,assignment.worker) && same(report.candidate,context.candidate) && same(artifact.candidate,context.candidate),'author or candidate/environment/policy/tool binding stale');
  assert(report.url === LIVE_APP_URL,'canonical trusted live application URL required');
  assert(report.started <= report.finished && report.finished <= context.now && report.finished <= assignment.deadline && report.started >= 0 && report.finished - report.started <= LIVE_OBSERVATION_MAX_DURATION_MS && context.now - report.finished <= LIVE_OBSERVATION_MAX_AGE_MS,'observation time invalid');
  assert(report.deployedRevision && report.deployedRevision.trim().toLowerCase() !== 'unknown','known deployed revision required');
  assert(report.scopeRationale.trim().length > 0,'explicit scope rationale required; smoke is only for engine/documentation changes');
  if (report.mode === 'affected-flow') assert(Object.values(report.criteria).some(value => value.steps.length > 0),'affected-flow requires a live criterion');
  assert(report.steps.length > 0 && new Set(report.steps.map(step => step.id)).size === report.steps.length && report.steps.every(step => step.status === 'passed' && step.evidence.length > 0),'all browser steps must pass with evidence');
  assert(report.cleanup.status !== 'pending' && (report.cleanup.status !== 'complete' || report.cleanup.evidence.length > 0),'test-data cleanup pending or without evidence');
  assert(report.candidateBinding.evidence.length > 0,'candidate containment evidence required');
  assert(Object.keys(report.criteria).length === item.criteria.length && item.criteria.every(id => Object.hasOwn(report.criteria,id)),'exact live criterion coverage required');
  for (const id of item.criteria) {
    const coverage = report.criteria[id];
    assert((coverage.steps.length > 0) !== (coverage.nonLiveReason !== null),'each criterion needs live steps or explicit non-live rationale');
    assert(coverage.steps.every(step => report.steps.some(value => value.id === step && value.status === 'passed')),'criterion references missing or failing step');
  }
  const references = [...report.candidateBinding.evidence,...report.steps.flatMap(step => step.evidence),...report.cleanup.evidence];
  for (const id of references) {
    const source = state.artifacts[id], observed = context.artifacts[id];
    assert(id !== artifactId && artifact.inputs.includes(id) && source && observed && source.hash === observed.hash && source.acceptedHash === source.hash && same(source.candidate,context.candidate) && state.activities[source.activity]?.status === 'accepted' && state.assignments[source.assignment]?.status === 'finished','accepted current immutable evidence input required');
    assert(state.activities[source.activity]?.item === item.id,'evidence belongs to another item');
    assert(source.version === Math.max(...Object.values(state.artifacts).filter(value => value.activity === source.activity).map(value => value.version)),'evidence superseded');
  }
  if (report.mode === 'smoke') {
    const normalized = (file: string) => relativePath(file).toLowerCase();
    // Only exact declared live records in the reserved, startup-excluded runtime
    // area are scope-neutral. Arbitrary excluded product paths never qualify.
    const runtimeRecord = (file: string) => {
      const value = normalized(file);
      return value.startsWith('.agnostic-loop/') && state.policy.candidateExclusions.some(root => {
        const excluded = normalized(root);
        return (excluded === '.agnostic-loop' || excluded.startsWith('.agnostic-loop/')) && (value === excluded || value.startsWith(`${excluded}/`));
      });
    };
    const recordPaths = new Set([artifact.path,...references.filter(id => state.activities[state.artifacts[id].activity].kind === 'live-observation').map(id => state.artifacts[id].path)].filter(runtimeRecord).map(normalized));
    assert(item.affectedPaths.every(file => {
      const value = normalized(file);
      return value === 'agents.md' || value === 'package.json' || value === 'package-lock.json' || value.startsWith('tools/') || value.startsWith('docs/') || recordPaths.has(value);
    }),'smoke requires engine/documentation-only affected paths and exact startup-excluded live records');
  }
  const implementers = Object.values(state.assignments).filter(value => value.item === item.id && value.role === 'implementer').map(value => value.worker);
  assert(implementers.every(worker => distinct(report.worker,worker)),'live verifier must be independent of implementation');
}

/** Shared fail-closed completion guard, including already-shipped historical snapshots. */
export function requireLiveVerification(state: LoopState,item: Item,context: Context): string {
  const failures: string[] = [];
  for (const [id,report] of Object.entries(state.liveVerificationReports ?? {})) {
    const artifact = state.artifacts[id];
    if (!artifact || state.activities[artifact.activity]?.item !== item.id) continue;
    try {
      validateLiveReport(state,item,report,context,id);
      const observed = context.artifacts[id], activity = state.activities[artifact.activity];
      assert(observed && same(observed.author,artifact.author) && observed.hash === artifact.hash && artifact.acceptedHash === artifact.hash && activity.status === 'accepted','independently accepted current report required');
      assert(artifact.version === Math.max(...Object.values(state.artifacts).filter(value => value.activity === artifact.activity).map(value => value.version)),'report superseded');
      assert(state.assignments[artifact.assignment].status === 'finished','report author not finished');
      const review = state.events.findLast(event => event.type === 'review.record' && event.payload.artifact === id && event.payload.hash === artifact.hash && event.payload.verdict === 'clean');
      const checker = review && state.assignments[String(review.payload.assignment)];
      assert(checker?.role === 'checker' && checker.status === 'finished' && checker.activity === artifact.activity && distinct(checker.worker,artifact.author),'finished independent checker required');
      assert(Object.values(state.assignments).filter(value => value.item === item.id && value.role === 'implementer').every(value => distinct(checker.worker,value.worker)),'live checker must be independent of implementation');
      return id;
    } catch (error) { failures.push(error instanceof Error ? error.message : 'invalid report'); }
  }
  throw new Error(failures[0] ?? 'Live verification pending: current independently accepted live-app report required');
}
