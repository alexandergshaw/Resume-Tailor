import type { NextAction, NextActionsFunction } from './dispatch-types';
import { actionKey, activityId, checkedPlan, taskFor, validatePlanScope } from './workflow';

export const nextActions: NextActionsFunction = (state,journal,context) => {
  const item = state.items[context.selection.id];
  const terminal = (kind:'blocked'|'owner-needed'|'complete',reason:string):NextAction[] => [{kind,key:actionKey({item:context.selection.id,kind,reason},context.config),item:context.selection.id,reasons:[reason]}];
  const inbox = Object.values(journal.jobs).find(j => j.status === 'terminated' && j.resultHash);
  if (inbox) return [{kind:'import-inbox',key:inbox.actionKey,job:inbox.id}];
  if (Object.values(journal.jobs).some(j => ['prepared','pending','running','unknown'].includes(j.status))) return terminal('blocked','Outstanding launch requires observation or explicit owner recovery');
  if (Object.values(journal.jobs).some(j => j.item === context.selection.id && j.status === 'rejected' && !j.rejection?.startsWith('retryable-execution:'))) return terminal('blocked',journal.checkpoints[context.selection.id] ?? 'Rejected launch requires explicit reconciliation or corrected manual continuation');
  if (state.runStatus !== 'running') return terminal('blocked',`Run ${state.runStatus}`);
  if (context.now > context.config.budget.deadline || context.now > state.policy.deadline) return terminal('blocked','Dispatch deadline exhausted');
  if (!item) return [{kind:'bootstrap',key:actionKey(context.selection,context.config),selection:context.selection}];
  if (item.status === 'shipped') return terminal('complete','Local delivery recorded');
  if (item.needs.length) return terminal('blocked',item.needs.join('; '));
  if (Object.values(state.assignments).some(a => a.status !== 'finished' && !a.reconciled)) return terminal('blocked','Existing manual or uncertain assignment retains locks; finish or reconcile it');
  const owner = Object.values(state.activities).find(a => a.item === item.id && (a.status === 'owner-needed' || a.status === 'withdrawn'));
  if (owner) {
    const decision = Object.values(state.decisions).find(d => d.activity === owner.id && !d.verified && d.disposition !== 'withdrawal');
    if (decision) { const task = taskFor(state,context,owner.kind,'transcription'); return [{kind:'dispatch',key:actionKey(task,context.config),task}]; }
    return terminal('owner-needed',`Activity ${owner.id} requires terminating owner disposition; rounds=${owner.rounds}`);
  }
  const accepted = (kind:string) => Object.values(state.artifacts).find(a => a.activity === activityId(item.id,kind) && a.acceptedHash === a.hash);
  const activity = (kind:string,wave:string|null=null):NextAction[] | null => {
    const id = activityId(item.id,kind), a = state.activities[id];
    if (a?.status === 'accepted') return null;
    const artifacts = Object.values(state.artifacts).filter(x => x.activity === id).sort((x,y) => y.version-x.version);
    const pending = artifacts[0];
    const failed = Object.values(journal.jobs).some(j=>j.task.activity===id&&j.rejection?.startsWith('retryable-execution:'));
    const purpose = pending && !a?.reviews.some(r => r.artifact === pending.id) ? 'review' : a?.rounds || failed ? 'repair' : 'author';
    const task = taskFor(state,context,kind,purpose,wave);
    if(a && Object.keys(journal.jobs).length >= context.config.budget.maxJobs)return terminal('blocked','Dispatch job budget exhausted');
    return [{kind:a ? 'dispatch' : 'create-activity',key:actionKey(task,context.config),task}];
  };
  const advance = (status:string,kinds:string[]):NextAction[] => [{kind:'advance',key:actionKey({item:item.id,status,kinds,revision:state.revision},context.config),item:item.id,status,artifacts:kinds.map(k => accepted(k)!.id),evidence:Object.values(state.evidence).filter(e => e.exitCode === 0 && e.candidate.digest === context.candidate.digest).map(e => e.id)}];
  if (item.status === 'queued') return activity('scope') ?? advance('scoped',['scope']);
  if (item.status === 'scoped') {
    const next = activity('criteria'); if (next) return next;
    if (!state.events.some(e => e.type === 'item.configure' && e.payload.item === item.id)) return [{kind:'configure',key:actionKey({item:item.id,configure:true},context.config),item:item.id,scopeArtifact:accepted('scope')!.id,criteriaArtifact:accepted('criteria')!.id}];
    return advance('criteria-accepted',['criteria']);
  }
  if (item.status === 'criteria-accepted') return activity('design') ?? advance('design-accepted',['design']);
  if (item.status === 'design-accepted') {
    const plan = activity('plan'); if (plan) return plan;
    const body = checkedPlan(context,item.id); if (!body) return terminal('blocked','Checked plan body is unavailable'); validatePlanScope(body,state,context.config);
    for (const specialist of body.specialistKinds) { const next = activity(`specialist:${specialist}`); if (next) return next; }
    return activity('test-design') ?? advance('ready-to-build',['plan','test-design']);
  }
  if (item.status === 'ready-to-build') {
    const plan = checkedPlan(context,item.id); if (!plan) return terminal('blocked','Checked plan missing'); validatePlanScope(plan,state,context.config);
    const pending = plan.waves.filter(w => !accepted(`implementation-wave:${w.id}`));
    const wave = pending.find(w => w.dependencies.every(d => accepted(`implementation-wave:${d}`)));
    if (wave) return activity(`implementation-wave:${wave.id}`,wave.id)!;
    if (pending.length) return terminal('blocked','Implementation dependencies unsettled');
    const aggregate = activity('implementation'); if (aggregate) return aggregate;
    return activity('verification') ?? advance('implemented',['implementation']);
  }
  if (item.status === 'implemented') return activity('verification') ?? advance('verified',['verification']);
  if (item.status === 'verified') return activity('whole-change-review') ?? activity('final-report') ?? advance('regression-passed',['final-report']);
  if (item.status === 'regression-passed') {
    if (!context.config.grant.allowLocalDelivery) return terminal('blocked','Owner local-delivery grant required');
    return advance('shipped',['final-report']);
  }
  return terminal('blocked','Unsupported workflow state');
};
