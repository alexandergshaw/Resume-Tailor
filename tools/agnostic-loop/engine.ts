import type { Activity, Artifact, Assignment, Context, Decision, Envelope, Evidence, FinalReport, Item, ItemStatus, LoopState, Operation, VerificationReport, Worker } from './types';
import { validateContext, validateEvent, validatePolicy, validateState } from './validation';
import { continuePolicy } from './policy-continuation';

export function createState(policy: unknown): LoopState {
  return { schemaVersion: 1, revision: 0, policy: validatePolicy(policy), runStatus: 'running', items: {}, activities: {}, assignments: {}, artifacts: {}, evidence: {}, decisions: {}, operations: {}, verificationReports: {}, finalReports: {}, events: [] };
}
export const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k => Object.hasOwn(y,k) && equal(x[k], y[k]));
};
export const requireThat = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
export function safePath(path: string): string {
  requireThat(!path.includes('\\') && !path.startsWith('/') && !/[\x00-\x1f<>:"|?*]/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)), `unsafe workspace path: ${path}`);
  return path.toLowerCase();
}
export const overlaps = (a: string[], b: string[]): boolean => a.some(x => b.some(y => { const p = safePath(x), q = safePath(y); return p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`); }));
export function independent(worker: Worker, authors: Worker[]): void { requireThat(authors.every(a => a.instance !== worker.instance && a.context !== worker.context), 'independent worker instance AND context required'); }
export function currentArtifact(s: LoopState, id: string, c: Context, accepted = true): Artifact {
  const a = s.artifacts[id]; requireThat(a, `missing artifact ${id}`);
  const observed = c.artifacts[id];
  requireThat(observed && ['id','activity','version','hash','path','author','inputs'].every(k => equal(observed[k as keyof Artifact],a[k as keyof Artifact])), `artifact bytes or metadata stale: ${id}`);
  requireThat(a.version === Math.max(...Object.values(s.artifacts).filter(x => x.activity === a.activity).map(x => x.version)),`artifact superseded: ${id}`);
  requireThat(!accepted || a.acceptedHash === a.hash, `artifact not accepted: ${id}`); return a;
}
export function currentEvidence(s: LoopState, id: string, c: Context): Evidence {
  const e = s.evidence[id]; requireThat(e, `missing evidence ${id}`); requireThat(equal(e.candidate,c.candidate) && e.exitCode === 0, `stale or failed evidence ${id}`); return e;
}
function liveAssignment(s: LoopState, id: string, c: Context): Assignment {
  const a = s.assignments[id]; requireThat(a && a.status === 'running', `assignment fenced or missing: ${id}`);
  requireThat(c.now <= a.deadline && c.now <= s.policy.deadline && a.policyHash === c.candidate.policyHash, 'assignment budget or policy stale');
  for (const [id, hash] of Object.entries(a.inputs)) requireThat(currentArtifact(s,id,c).hash === hash, 'assignment input stale');
  return a;
}
function owner(s: LoopState, e: Envelope): void { requireThat(e.actor === s.policy.owner,'owner authority required'); }
function noOperations(s: LoopState, id: string): void { requireThat(Object.values(s.operations).filter(o => o.assignment === id).every(o => o.status === 'terminated' && o.reconciled),'operations not quiescent/reconciled'); }
function unique(s: Record<string, unknown>, id: string): void { requireThat(!['__proto__','constructor','prototype'].includes(id),`unsafe record ID ${id}`); requireThat(!Object.hasOwn(s,id), `duplicate ID ${id}`); }
function noCycles(map: Record<string,{ dependencies: string[] }>): void {
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string): void { if (visited.has(id)) return; requireThat(!visiting.has(id),'dependency cycle'); requireThat(map[id],`missing dependency ${id}`); visiting.add(id); for (const next of map[id].dependencies) visit(next); visiting.delete(id); visited.add(id); }
  Object.keys(map).forEach(visit);
}
export function assignmentBlockers(s: LoopState, item: Item, c: Context): string[] {
  const out: string[] = [];
  if (s.runStatus !== 'running') out.push(`run ${s.runStatus}`);
  if (c.now > s.policy.deadline) out.push('run deadline exhausted');
  if (Object.keys(s.assignments).length >= s.policy.maxAssignments) out.push('assignment budget exhausted');
  if (item.needs.length) out.push(...item.needs);
  if (item.status === 'shipped') out.push('already shipped');
  if (item.dependencies.some(d => s.items[d]?.status !== 'shipped')) out.push('item dependencies unsettled');
  const active = Object.values(s.assignments).filter(a => a.status !== 'finished' && !a.reconciled);
  if (active.length >= s.policy.concurrency) out.push('concurrency exhausted');
  for (const a of active) if (overlaps(item.affectedPaths,a.affectedPaths) || item.dependencies.includes(a.item) || s.items[a.item].dependencies.includes(item.id)) out.push(`locked/dependent assignment ${a.id}`);
  if (Object.values(s.activities).some(a => a.item === item.id && a.status === 'owner-needed')) out.push('owner disposition required');
  for (const artifact of Object.values(s.artifacts).filter(a => a.acceptedHash && s.activities[a.activity].item === item.id)) {
    try { currentArtifact(s,artifact.id,c); } catch { out.push(`accepted artifact stale: ${artifact.id}`); }
  }
  return out;
}
function gates(s: LoopState, item: Item, ids: string[], c: Context): void {
  const covered = ids.map(id => currentEvidence(s,id,c).gate);
  requireThat(item.requiredGates.every(g => covered.includes(g)),'required gate coverage missing');
}
function verifyReport(s: LoopState, assignment: Assignment, report: VerificationReport, c: Context): void {
  const item = s.items[assignment.item];
  requireThat(equal(report.worker,assignment.worker) && equal(report.candidate,c.candidate),'verification identity/candidate mismatch');
  independent(report.worker,[...Object.values(s.assignments).filter(a => a.item === item.id && a.role === 'implementer').map(a => a.worker),...Object.values(s.artifacts).filter(a => s.activities[a.activity].item === item.id && s.activities[a.activity].kind === 'implementation').map(a => a.author)]);
  requireThat(Object.keys(report.criteria).length === item.criteria.length && item.criteria.every(id => report.criteria[id]?.length > 0),'criterion evidence mapping incomplete/unknown');
  gates(s,item,Object.values(report.criteria).flat(),c);
  Object.values(report.criteria).flat().forEach(id => currentEvidence(s,id,c));
}
function verifyFinal(s: LoopState, item: Item, report: FinalReport, c: Context): void {
  requireThat(equal(report.candidate,c.candidate),'final candidate stale');
  currentArtifact(s,report.verificationArtifact,c); currentArtifact(s,report.wholeChangeReviewArtifact,c);
  const verification = s.verificationReports[report.verificationArtifact]; requireThat(verification && equal(verification.candidate,c.candidate),'accepted verification report missing/stale');
  const whole = s.artifacts[report.wholeChangeReviewArtifact]; requireThat(s.activities[whole.activity].item === item.id && s.activities[whole.activity].kind === 'whole-change-review' && equal(whole.candidate,c.candidate),'whole-change review contract/current candidate required');
  gates(s,item,report.regressionEvidence,c);
  const required = Object.values(s.decisions).filter(d => s.activities[d.activity].item === item.id).flatMap(d => d.residuals);
  requireThat(required.every(r => report.residuals.some(x => equal(x,r))),'final residuals missing');
}
export function applyEvent(state: LoopState, raw: unknown, context: Context): LoopState {
  const event = validateEvent(raw);
  const old = state.events.find(e => e.id === event.id);
  if (old) { requireThat(equal(old,event),'conflicting reused event ID'); return state; }
  const s = validateState(state), c = validateContext(context), p = event.payload;
  requireThat(event.expectedRevision === s.revision,'revision conflict');
  requireThat(Number.isSafeInteger(c.now) && c.now >= 0,'context time invalid');
  switch (event.type) {
    case 'policy.continue': continuePolicy(s,event,c); break;
    case 'item.create': {
      const item = p as unknown as Omit<Item,'status'|'needs'|'escalation'>; unique(s.items,item.id);
      requireThat(item.criteria.length > 0 && new Set(item.criteria).size === item.criteria.length,'unique nonempty criteria required');
      item.affectedPaths.forEach(safePath); requireThat(new Set(item.affectedPaths.map(safePath)).size === item.affectedPaths.length,'case-colliding paths');
      requireThat(item.requiredGates.every(g => s.policy.gates[g]),'unknown required gate');
      s.items[item.id] = { ...item, status: 'queued', needs: [], escalation: null }; noCycles(s.items); break;
    }
    case 'activity.create': {
      const a = p as unknown as Omit<Activity,'status'|'rounds'|'authors'|'reviews'>; unique(s.activities,a.id); requireThat(s.items[a.item],'missing item');
      requireThat(a.requirements.length > 0 && a.requirements.every(r => s.items[a.item].criteria.includes(r)),'activity requirements outside item');
      requireThat(!Object.values(s.activities).some(x => x.item === a.item && x.kind === a.kind && x.requirements.some(r => a.requirements.includes(r))),'semantic activity already exists; review budget cannot reset');
      s.activities[a.id] = { ...a,status:'open',rounds:0,authors:[],reviews:[] }; noCycles(s.activities); break;
    }
    case 'item.configure': {
      owner(s,event); const item = s.items[p.item as string], observed = c.configuration;
      requireThat(item?.status === 'scoped' && observed?.grant.allowConfigure && observed.grant.owner === s.policy.owner,'checked configuration requires scoped item and fixed owner grant');
      const scope = currentArtifact(s,p.scopeArtifact as string,c), criteria = currentArtifact(s,p.criteriaArtifact as string,c);
      requireThat(s.activities[scope.activity].item === item.id && s.activities[scope.activity].kind === 'scope' && s.activities[criteria.activity].item === item.id && s.activities[criteria.activity].kind === 'criteria','configuration artifacts wrong item/kind');
      requireThat(observed!.scope.artifact === scope.id && observed!.scope.hash === scope.hash && observed!.criteria.artifact === criteria.id && observed!.criteria.hash === criteria.hash,'configuration observed hash mismatch');
      const proposal = observed!.scope.proposal, criterionIds = Object.keys(observed!.criteria.proposal.criteria);
      requireThat(proposal.item === item.id && observed!.criteria.proposal.item === item.id && item.criteria.every(id => criterionIds.includes(id)),'configuration removes original requirements');
      const within = (p:string,root:string) => safePath(p) === safePath(root) || safePath(p).startsWith(`${safePath(root)}/`);
      for (const file of proposal.affectedPaths) {
        safePath(file); requireThat(observed!.grant.pathPrefixes.some(root => within(file,root)),'configured path outside startup grant');
        requireThat(!s.policy.candidateExclusions.some(root => within(file,root)) || within(file,observed!.grant.artifactDirectory),'configuration targets excluded credential/state/dependency path');
      }
      requireThat(proposal.writePaths.every(file => proposal.affectedPaths.includes(file)),'configured writes outside affected paths');
      requireThat(proposal.gateNames.every(g => Object.hasOwn(s.policy.gates,g) && observed!.grant.gateNames.includes(g)),'configured gate outside startup policy');
      item.affectedPaths = [...new Set([...item.affectedPaths,...proposal.affectedPaths])]; item.criteria = criterionIds; item.requiredGates = proposal.gateNames; item.triage = proposal.triage; break;
    }
    case 'assignment.start': {
      const a = p as unknown as Omit<Assignment,'baseline'|'policyHash'|'publicationToken'|'status'|'reconciled'|'reason'>;
      unique(s.assignments,a.id); const item = s.items[a.item], activity = s.activities[a.activity];
      requireThat(item && activity?.item === a.item,'assignment parent mismatch');
      const blockers = assignmentBlockers(s,item,c).filter(reason => a.role === 'transcriber' && reason === 'owner disposition required' ? false : true); requireThat(!blockers.length,blockers.join('; '));
      requireThat(activity.dependencies.every(d => s.activities[d].status === 'accepted'),'activity dependencies unsettled');
      requireThat(a.deadline > c.now && a.deadline <= s.policy.deadline,'assignment deadline outside budget');
      requireThat(a.allowedActions.every(x => s.policy.allowedActions.includes(x)),'action outside policy');
      const allocation = c.artifactAllocation;
      if (allocation) { safePath(allocation.directory); allocation.paths.forEach(safePath); requireThat(allocation.paths.every(file => safePath(file).startsWith(`${safePath(allocation.directory)}/`)) && s.policy.candidateExclusions.some(root => safePath(allocation.directory) === safePath(root) || safePath(allocation.directory).startsWith(`${safePath(root)}/`)),'artifact allocation outside excluded generated directory'); }
      requireThat(a.writePaths.every(x => a.affectedPaths.includes(x)) && a.affectedPaths.every(x => item.affectedPaths.includes(x) || allocation?.paths.includes(x)),'assignment scope outside item');
      [...a.writePaths,...a.affectedPaths].forEach(safePath);
      requireThat(!a.writePaths.length || a.allowedActions.includes('write'),'write permission missing');
      if (a.role === 'checker') { independent(a.worker,activity.authors); requireThat(activity.rounds < 2 && activity.status === 'open','substantive review budget exhausted'); }
      if (a.role === 'verifier') independent(a.worker,[...Object.values(s.assignments).filter(x => x.item === a.item && x.role === 'implementer').map(x => x.worker),...Object.values(s.artifacts).filter(x => s.activities[x.activity].item === a.item && s.activities[x.activity].kind === 'implementation').map(x => x.author)]);
      for (const [id, hash] of Object.entries(a.inputs)) requireThat(currentArtifact(s,id,c).hash === hash,'input hash mismatch');
      for (const running of Object.values(s.assignments).filter(x => x.status !== 'finished' && !x.reconciled)) requireThat(!a.resources.some(r => running.resources.includes(r)) && !Object.keys(a.inputs).some(i => Object.hasOwn(running.inputs,i)), 'resource/shared-input conflict');
      s.assignments[a.id] = { ...a, baseline:c.candidate,policyHash:c.candidate.policyHash,publicationToken:event.id,status:'running',reconciled:false,reason:null }; break;
    }
    case 'artifact.submit': {
      const a = liveAssignment(s,p.assignment as string,c), artifact = p.artifact as Artifact;
      requireThat(p.publicationToken === a.publicationToken,'publication token fenced'); unique(s.artifacts,artifact.id);
      requireThat(equal(c.artifacts[artifact.id],artifact),'artifact lacks observed IO bytes');
      requireThat(artifact.activity === a.activity && equal(artifact.author,a.worker),'artifact author/activity mismatch');
      const roles: Record<string,string> = { scope:'specialist',criteria:'criteria',design:'architect',plan:'planner','test-design':'test-designer',implementation:'implementer',verification:'verifier','verification-report':'verifier','final-report':'finalizer' };
      const requiredRole = roles[s.activities[a.activity].kind];
      requireThat(!requiredRole || a.role === requiredRole || (a.role === 'transcriber' && s.activities[a.activity].status === 'owner-needed'),'artifact role/activity contract mismatch');
      if (s.activities[a.activity].kind === 'whole-change-review') independent(a.worker,Object.values(s.artifacts).filter(x => s.activities[x.activity].item === a.item && s.activities[x.activity].kind === 'implementation').map(x => x.author));
      requireThat(a.allowedActions.includes('write'),'artifact publication permission missing');
      requireThat(!a.deliverables.length || a.deliverables.includes(artifact.id),'artifact outside declared deliverables');
      requireThat(equal([...artifact.inputs].sort(),Object.keys(a.inputs).sort()),'artifact input references mismatch');
      const prior = Object.values(s.artifacts).filter(x => x.activity === artifact.activity);
      requireThat(artifact.version === (prior.length ? Math.max(...prior.map(x => x.version)) + 1 : 1),'artifact version sequence invalid');
      requireThat(s.activities[a.activity].status === 'open' || (s.activities[a.activity].status === 'owner-needed' && a.role === 'transcriber'),'invalidate accepted artifact or resolve owner disposition before revision');
      s.artifacts[artifact.id] = { ...artifact,assignment:a.id,acceptedHash:null,candidate:c.candidate }; s.activities[a.activity].authors.push(a.worker); break;
    }
    case 'artifact.invalidate': {
      owner(s,event); const artifact = s.artifacts[p.artifact as string]; requireThat(artifact,'missing artifact');
      const dirty = new Set([artifact.activity]);
      let expanded = true;
      while (expanded) { expanded = false; for (const activity of Object.values(s.activities)) if (!dirty.has(activity.id) && (activity.dependencies.some(id => dirty.has(id)) || Object.values(s.artifacts).some(a => a.activity === activity.id && a.inputs.some(id => dirty.has(s.artifacts[id]?.activity))))) { dirty.add(activity.id); expanded = true; } }
      for (const id of dirty) { const activity = s.activities[id]; activity.status = activity.rounds >= 2 ? 'owner-needed' : 'open'; s.items[activity.item].status = 'queued'; }
      for (const a of Object.values(s.artifacts)) if (dirty.has(a.activity)) a.acceptedHash = null;
      for (const a of Object.values(s.assignments)) if (a.status === 'running' && (dirty.has(a.activity) || Object.keys(a.inputs).some(id => dirty.has(s.artifacts[id]?.activity)))) { a.status = 'cancelled'; a.publicationToken = `fenced:${event.id}`; a.reason = p.reason as string; }
      break;
    }
    case 'review.record': {
      const a = liveAssignment(s,p.assignment as string,c); requireThat(a.role === 'checker' && a.allowedActions.includes('review'),'checker role and review permission required');
      const artifact = currentArtifact(s,p.artifact as string,c,false), activity = s.activities[artifact.activity];
      requireThat(a.activity === activity.id && activity.status === 'open' && activity.rounds < 2,'review budget exhausted'); independent(a.worker,activity.authors);
      requireThat(s.assignments[s.artifacts[artifact.id].assignment].status === 'finished','author ownership/deliverables not finalized');
      requireThat(artifact.hash === p.hash && artifact.version === Math.max(...Object.values(s.artifacts).filter(x => x.activity === activity.id).map(x => x.version)),'review hash/version stale');
      requireThat(!activity.reviews.some(r => r.hash === artifact.hash),'same artifact already checked');
      const findings = p.findings as Activity['reviews'][number]['findings']; requireThat((p.verdict === 'clean') === (findings.length === 0),'verdict/findings mismatch');
      activity.reviews.push({ artifact:artifact.id,hash:artifact.hash,verdict:p.verdict as 'clean'|'defective',findings }); activity.rounds++;
      if (p.verdict === 'clean') { s.artifacts[artifact.id].acceptedHash = artifact.hash; activity.status = 'accepted'; } else if (activity.rounds === 2) activity.status = 'owner-needed'; break;
    }
    case 'decision.record': {
      owner(s,event); const d = p as unknown as Omit<Decision,'verified'>; unique(s.decisions,d.id);
      const activity = s.activities[d.activity]; requireThat(activity?.status === 'owner-needed','decision requires exhausted review');
      const last = activity.reviews.at(-1); requireThat(activity.rounds === 2 && last?.artifact === d.originalArtifact && last.hash === d.originalHash,'decision checked original mismatch');
      if (last?.verdict === 'clean') requireThat(s.artifacts[d.originalArtifact].acceptedHash === null && s.events.some(e => e.type === 'artifact.invalidate'),'clean checked artifact requires explicit invalidation disposition');
      requireThat(d.patch.originalHash === d.originalHash && equal(c.approvedPatches?.[d.id],d.patch),'owner patch not deterministically attested');
      requireThat(d.scope.length > 0 && d.scope.every(r => activity.requirements.includes(r)),'decision scope mismatch');
      requireThat(d.disposition === 'bounded-acceptance' || d.residuals.length > 0 || d.disposition === 'withdrawal','disposition residuals required');
      if (d.disposition !== 'withdrawal') { const result = c.artifacts[d.resultingArtifact]; requireThat(result && result.hash === d.patch.expectedHash && result.activity === activity.id,'result differs from authorized patch');
        requireThat(result.version === s.artifacts[d.originalArtifact].version + 1,'decision result version invalid');
        const existing = s.artifacts[result.id];
        if (existing) requireThat(existing.acceptedHash === null && equal(existing.hash,result.hash) && existing.activity === activity.id,'decision result must be exact unaccepted import');
        else s.artifacts[result.id] = { ...result,assignment:s.artifacts[d.originalArtifact].assignment,acceptedHash:null,candidate:c.candidate };
      }
      s.decisions[d.id] = { ...d,verified:false }; if (d.disposition === 'withdrawal') activity.status = 'withdrawn'; break;
    }
    case 'transcription.verify': {
      const a = liveAssignment(s,p.assignment as string,c), d = s.decisions[p.decision as string]; requireThat(d && a.activity === d.activity && a.role === 'transcriber','transcription role/decision mismatch');
      independent(a.worker,s.activities[d.activity].authors); requireThat(d.disposition !== 'withdrawal','withdrawal yields no consumable artifact');
      const result = currentArtifact(s,d.resultingArtifact,c,false); requireThat(p.hash === d.patch.expectedHash && result.hash === p.hash,'transcription mechanical mismatch');
      requireThat(equal(c.approvedPatches?.[d.id],d.patch),'patch attestation missing');
      if (p.pass === true) { requireThat(p.semanticFidelity === true,'semantic fidelity attestation required'); d.verified = true; s.artifacts[result.id].acceptedHash = result.hash; s.activities[d.activity].status = 'accepted'; } break;
    }
    case 'assignment.finish': {
      const a = liveAssignment(s,p.assignment as string,c); noOperations(s,a.id);
      requireThat(a.deliverables.every(id => s.artifacts[id]?.assignment === a.id),'required deliverables missing');
      const changed = new Set([...Object.keys(a.baseline.files),...Object.keys(c.candidate.files)].filter(path => a.baseline.files[path] !== c.candidate.files[path]));
      requireThat([...changed].every(path => a.writePaths.includes(path)),'unowned candidate edit');
      requireThat(a.baseline.environmentHash === c.candidate.environmentHash && a.baseline.toolHash === c.candidate.toolHash,'assignment environment/tool stale');
      a.status = 'finished'; a.reconciled = true; break;
    }
    case 'assignment.cancel': { owner(s,event); const a = s.assignments[p.assignment as string]; requireThat(a && a.status !== 'finished','assignment missing/finished'); a.status = 'cancelled'; a.reason = p.reason as string; a.publicationToken = `fenced:${event.id}`; break; }
    case 'assignment.quiesce': { owner(s,event); const a = s.assignments[p.assignment as string]; requireThat(a && a.status !== 'running','cancel before quiescence'); noOperations(s,a.id); a.status = p.quarantine ? 'quarantined' : 'cancelled'; break; }
    case 'assignment.reconcile': { owner(s,event); const a = s.assignments[p.assignment as string]; requireThat(a && a.status !== 'running','cancel before reconciliation'); noOperations(s,a.id); a.reconciled = true; a.reason = p.resolution as string; break; }
    case 'operation.start': case 'operation.running': case 'operation.finish': case 'operation.unknown': {
      const o = p.operation as Operation; requireThat(equal(c.operations?.[o.id],o),'trusted runner operation observation required');
      const a = s.assignments[o.assignment]; requireThat(a && a.resources.includes(o.resource),'operation resource not reserved');
      if (event.type === 'operation.start') { liveAssignment(s,a.id,c); unique(s.operations,o.id);
        requireThat(!Object.values(s.operations).some(existing => (existing.assignment === a.id || existing.resource === o.resource) && (existing.status !== 'terminated' || !existing.reconciled)),'outstanding operation retains assignment/resource lock');
        requireThat(o.status === 'pending' && o.pid === null && o.publicationToken === a.publicationToken && !o.reconciled,'persist pending operation before launch'); }
      else { const old = s.operations[o.id]; requireThat(old && old.assignment === o.assignment && old.resource === o.resource && old.publicationToken === o.publicationToken,'operation identity mismatch');
        if (event.type === 'operation.running') { liveAssignment(s,a.id,c); requireThat(old.status === 'pending' && o.status === 'running' && o.pid !== null && o.publicationToken === a.publicationToken,'invalid launch registration'); }
        else if (event.type === 'operation.finish') requireThat(o.status === 'terminated','observed termination required');
        else { requireThat(o.status === 'unknown' && !o.reconciled,'unknown operation must quarantine'); a.status = 'quarantined'; a.publicationToken = `fenced:${event.id}`; }
      } s.operations[o.id] = o; break;
    }
    case 'evidence.record': {
      const e = p.evidence as Evidence, a = e.exitCode === 0 ? liveAssignment(s,e.assignment,c) : s.assignments[e.assignment]; unique(s.evidence,e.id); requireThat(a,'missing evidence assignment');
      requireThat(equal(c.evidence[e.id],e),'trusted captured evidence required'); requireThat(equal(e.worker,a.worker),'evidence worker mismatch');
      const gate = s.policy.gates[e.gate]; requireThat(gate && gate.executable === e.executable && equal(gate.args,e.args) && gate.resources.every(r => a.resources.includes(r)) && a.allowedActions.includes('run'),'gate outside granted command/resources');
      requireThat(e.started <= e.finished && e.finished <= c.now && (e.exitCode !== 0 || e.finished-e.started <= s.policy.commandTimeout),'evidence execution bounds invalid');
      requireThat(e.exitCode !== 0 || equal(e.candidate,c.candidate),'passing evidence candidate stale'); s.evidence[e.id] = e; break;
    }
    case 'verification.record': {
      const a = liveAssignment(s,p.assignment as string,c), id = p.artifact as string, report = p.report as VerificationReport;
      requireThat(a.role === 'verifier' && s.artifacts[id]?.assignment === a.id,'verifier report ownership required'); currentArtifact(s,id,c,false);
      requireThat(equal(c.verificationReports?.[id],report),'report bytes not observed'); verifyReport(s,a,report,c); unique(s.verificationReports,id); s.verificationReports[id] = report; break;
    }
    case 'final.record': {
      const a = liveAssignment(s,p.assignment as string,c), id = p.artifact as string, report = p.report as FinalReport;
      requireThat(a.role === 'finalizer' && s.artifacts[id]?.assignment === a.id,'final report ownership required'); currentArtifact(s,id,c,false);
      requireThat(equal(c.finalReports?.[id],report),'final report bytes not observed'); verifyFinal(s,s.items[a.item],report,c); unique(s.finalReports,id); s.finalReports[id] = report; break;
    }
    case 'item.advance': {
      const item = s.items[p.item as string]; requireThat(item,'missing item');
      const steps: ItemStatus[] = ['queued','scoped','criteria-accepted','design-accepted','ready-to-build','implemented','verified','regression-passed','shipped'];
      requireThat(steps[steps.indexOf(item.status)+1] === p.status,'illegal item transition');
      const ids = p.artifacts as string[]; const artifacts = ids.map(id => currentArtifact(s,id,c));
      requireThat(artifacts.every(a => s.activities[a.activity].item === item.id),'transition artifact wrong item');
      const kinds = artifacts.map(a => s.activities[a.activity].kind);
      const minimum: Partial<Record<ItemStatus,string[]>> = { scoped:['scope'], 'criteria-accepted':['criteria'], 'design-accepted':['design'], 'ready-to-build':['plan','test-design'], implemented:['implementation'] };
      requireThat([...(minimum[p.status as ItemStatus] ?? []),...(item.requiredArtifacts[p.status as string] ?? [])].every(kind => kinds.includes(kind)),'required accepted artifacts missing');
      if (p.status === 'implemented') gates(s,item,p.evidence as string[],c);
      if (p.status === 'verified') requireThat(ids.some(id => { const report = s.verificationReports[id]; if (!report) return false; verifyReport(s,s.assignments[s.artifacts[id].assignment],report,c); return true; }),'accepted criterion-bound verification required');
      if (p.status === 'regression-passed' || p.status === 'shipped') requireThat(ids.some(id => { const report = s.finalReports[id]; if (!report) return false; verifyFinal(s,item,report,c); return true; }),'accepted final report required');
      item.status = p.status as ItemStatus; break;
    }
    case 'item.block': case 'item.escalate': {
      const item = s.items[p.item as string]; requireThat(item,'missing item'); requireThat((p.needs as string[]).length,'exact blocker needs required');
      item.needs = p.needs as string[]; if (event.type === 'item.escalate') { const signature = JSON.stringify({ needs:item.needs,recommendation:p.recommendation }); requireThat(item.escalation !== signature,'unchanged escalation already recorded'); item.escalation = signature; } break;
    }
    case 'item.unblock': { owner(s,event); const item = s.items[p.item as string]; requireThat(item,'missing item'); item.needs = []; item.escalation = null; break; }
    case 'run.pause': case 'run.resume': case 'run.cancel': owner(s,event); s.runStatus = event.type === 'run.pause' ? 'paused' : event.type === 'run.resume' ? 'running' : 'cancelled'; if (event.type === 'run.cancel') for (const a of Object.values(s.assignments)) if (a.status === 'running') { a.status = 'cancelled'; a.publicationToken = `fenced:${event.id}`; a.reason = p.reason as string; } break;
    default: throw new Error('unsupported event');
  }
  s.revision++; s.events.push(event); return validateState(s);
}
