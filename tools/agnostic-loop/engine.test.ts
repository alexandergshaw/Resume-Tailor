import { describe, expect, it } from 'vitest';
import { applyEvent, createState, currentEvidence } from './engine';
import { nextAssignments } from './scheduler';
import { validateEvent, validateState } from './validation';
import type { Artifact, Candidate, Context, Envelope, LoopState, Worker } from './types';

const h = 'a'.repeat(64), h2 = 'b'.repeat(64);
const worker = (id: string): Worker => ({ instance:id,context:id,provider:'manual',model:'any',settings:{},tools:[] });
const candidate: Candidate = { digest:h, files:{},policyHash:h,environmentHash:h,toolHash:h };
const context = (): Context => ({ now:10,candidate,artifacts:{},evidence:{} });
const initial = (): LoopState => createState({ owner:'owner',workspace:'C:/work',allowedActions:['write','run','review'],candidateExclusions:[],environmentKeys:[],externalFiles:[],gates:{ check:{ executable:'node',args:['check.js'],resources:['command'] } },concurrency:3,deadline:1000,maxAssignments:100,commandTimeout:60 });
let eventCount = 0;
const event = (s: LoopState,type: string,payload: Record<string,unknown>,actor='operator'): Envelope => ({ id:`event-${++eventCount}`,expectedRevision:s.revision,actor,type,payload });
const apply = (s: LoopState,type: string,payload: Record<string,unknown>,c=context(),actor='operator') => applyEvent(s,event(s,type,payload,actor),c);
const item = (id='item',path='report.json') => ({ id,objective:'Build locally',owner:'owner',affectedPaths:[path],dependencies:[],criteria:['criterion'],requiredArtifacts:{},requiredGates:[],triage:{ security:'local files only' } });
function scoped(): LoopState { let s = apply(initial(),'item.create',item()); s = apply(s,'activity.create',{ id:'criteria',item:'item',kind:'criteria',requirements:['criterion'],dependencies:[] }); return s; }
const assignment = (id:string,role='criteria',who=worker(id)) => ({ id,item:'item',activity:'criteria',role,worker:who,inputs:{},writePaths:role === 'criteria' ? ['report.json'] : [],affectedPaths:['report.json'],resources:[],allowedActions:role === 'criteria' ? ['write'] : ['review'],deadline:500,deliverables:[] });
function submit(s:LoopState,id='report',hash=h,version=1,author='author'): { state:LoopState; c:Context; artifact:Artifact } {
  const a = s.assignments[author], artifact: Artifact = { id,activity:'criteria',version,hash,path:'report.json',author:a.worker,inputs:[] };
  const c = context(); c.artifacts[id] = artifact;
  return { state:apply(s,'artifact.submit',{assignment:author,artifact,publicationToken:a.publicationToken},c),c,artifact };
}
describe('agnostic engine contracts', () => {
  it('rejects unsupported nested values and unknown event variants without mutation', () => {
    expect(() => validateEvent({ ...event(initial(),'item.create',item()), payload:{ ...item(),extra:true } })).toThrow('unsupported');
    expect(() => validateEvent(event(initial(),'invented',{}))).toThrow('unsupported');
    expect(() => validateEvent(event(initial(),'constructor',{}))).toThrow('unsupported');
    expect(() => validateEvent({...event(initial(),'item.create',item()),constructor:'foreign'})).toThrow('unsupported');
    expect(() => createState({ ...initial().policy,concurrency:NaN })).toThrow('integer');
    const s = scoped(); expect(() => apply(s,'assignment.start',{ ...assignment('bad'),worker:{ ...worker('bad'),settings:{ key:42 } } })).toThrow('string'); expect(s.assignments).toEqual({});
  });
  it('makes identical retries idempotent before revision CAS, rejects conflicting IDs', () => {
    const s = initial(), e = event(s,'item.create',item()), next = applyEvent(s,e,context());
    expect(applyEvent(next,e,context())).toBe(next); expect(s.revision).toBe(0);
    expect(() => applyEvent(next,{...e,payload:item('changed')},context())).toThrow('reused');
    expect(() => applyEvent(next,event(s,'item.create',item('other')),context())).toThrow('revision');
  });
  it('forbids author instance or context reuse; same provider distinct workers work', () => {
    let s = apply(scoped(),'assignment.start',assignment('author')); const imported = submit(s); s = apply(imported.state,'assignment.finish',{ assignment:'author' },imported.c);
    expect(() => apply(s,'assignment.start',assignment('check','checker',worker('author')),imported.c)).toThrow('independent');
    expect(() => apply(s,'assignment.start',assignment('check','checker',{ ...worker('fresh'),context:'author' }),imported.c)).toThrow('independent');
    s = apply(s,'assignment.start',assignment('check','checker'),imported.c);
    s = apply(s,'review.record',{ assignment:'check',artifact:'report',hash:h,verdict:'clean',findings:[] },imported.c);
    expect(s.artifacts.report.acceptedHash).toBe(h);
  });
  it('requires observed artifact bytes, token and owned writes', () => {
    const s = apply(scoped(),'assignment.start',assignment('author')); const { artifact,c } = submit(s);
    expect(() => apply(s,'artifact.submit',{assignment:'author',artifact,publicationToken:'wrong'},c)).toThrow('token');
    expect(() => apply(s,'artifact.submit',{assignment:'author',artifact,publicationToken:s.assignments.author.publicationToken})).toThrow('observed');
    const changed = context(); changed.candidate = {...candidate,files:{'outside.ts':h2},digest:h2};
    expect(() => apply(s,'assignment.finish',{assignment:'author'},changed)).toThrow('unowned');
  });
  it('keeps two-round budget through reload and semantic rename', () => {
    let s = scoped(); const c = context();
    for (let round=1; round<=2; round++) {
      const author = `author-${round}`; s = apply(s,'assignment.start',assignment(author));
      const result = submit(s,`report-${round}`,round === 1 ? h : h2,round,author); c.artifacts = {...c.artifacts,...result.c.artifacts}; s = result.state;
      s = apply(s,'assignment.finish',{ assignment:author },c);
      s = apply(s,'assignment.start',assignment(`checker-${round}`,'checker'),c);
      s = apply(s,'review.record',{assignment:`checker-${round}`,artifact:`report-${round}`,hash:round === 1 ? h : h2,verdict:'defective',findings:[{ severity:'P1',mechanism:'missing condition',classification:round === 1 ? 'new' : 'repeat',need:'design' }]},c);
      s = apply(s,'assignment.finish',{assignment:`checker-${round}`},c);
    }
    s = validateState(JSON.parse(JSON.stringify(s))); expect(s.activities.criteria.rounds).toBe(2); expect(s.activities.criteria.status).toBe('owner-needed');
    expect(() => apply(s,'activity.create',{id:'renamed',item:'item',kind:'criteria',requirements:['criterion'],dependencies:[]})).toThrow('semantic activity');
    expect(() => apply(s,'assignment.start',assignment('third','checker'),c)).toThrow('owner disposition');
  });
  it('cancellation fences late publication and holds locks until operator reconciliation', () => {
    let s = apply(scoped(),'assignment.start',assignment('author')); const imported = submit(s);
    s = apply(s,'assignment.cancel',{assignment:'author',reason:'stop'},imported.c,'owner');
    expect(() => apply(s,'artifact.submit',{assignment:'author',artifact:imported.artifact,publicationToken:'old'},imported.c)).toThrow('fenced');
    expect(() => apply(s,'assignment.start',assignment('successor'))).toThrow('locked');
    expect(() => apply(s,'assignment.reconcile',{assignment:'author',resolution:'restored'},context(),'author')).toThrow('owner');
    s = apply(s,'assignment.reconcile',{assignment:'author',resolution:'restored'},context(),'owner');
    expect(() => apply(s,'assignment.start',assignment('successor'))).not.toThrow();
  });
  it('blocks paused and exhausted scheduling but selects independent items', () => {
    let s = apply(scoped(),'item.create',item('other','other.json'));
    s = apply(s,'item.block',{item:'item',needs:['owner decision']});
    expect(nextAssignments(s,context()).eligible).toEqual(['other']);
    s = apply(s,'run.pause',{reason:'pause'},context(),'owner'); expect(nextAssignments(s,context()).eligible).toEqual([]);
    s = apply(s,'run.resume',{reason:'resume'},context(),'owner');
    expect(nextAssignments(s,{...context(),now:1001}).blocked.other).toContain('run deadline exhausted');
  });
  it('refuses skipped transitions and generic verification substitution', () => {
    const s = scoped(); expect(() => apply(s,'item.advance',{item:'item',status:'verified',artifacts:[],evidence:[]})).toThrow('illegal');
    expect(() => apply(s,'item.advance',{item:'item',status:'scoped',artifacts:[],evidence:[]})).toThrow('required accepted');
    const next = structuredClone(s); next.items.item.status = 'implemented';
    expect(() => apply(next,'item.advance',{item:'item',status:'verified',artifacts:[],evidence:[]})).toThrow('criterion-bound');
  });
  it('consumes deterministic owner disposition with independent transcription and no third review', () => {
    let s = scoped(); s = apply(s,'assignment.start',assignment('author'));
    const imported = submit(s); const c = imported.c; s = apply(imported.state,'assignment.finish',{assignment:'author'},c);
    // The two checked versions are the durable activity history under test.
    s.activities.criteria.rounds = 2;
    s.activities.criteria.status = 'owner-needed';
    const finding = {severity:'P1' as const,mechanism:'scope',classification:'repeat' as const,need:'ruling' as const};
    s.activities.criteria.reviews = [ {artifact:'report',hash:h,verdict:'defective',findings:[finding]}, {artifact:'report',hash:h,verdict:'defective',findings:[finding]} ];
    const patched: Artifact = {...imported.artifact,id:'patched',version:2,hash:h2}; c.artifacts.patched = patched;
    const patch = {originalHash:h,replacements:[{start:0,end:0,text:'accepted scope'}],expectedHash:h2}; c.approvedPatches = {decision:patch};
    const decision = {id:'decision',activity:'criteria',originalArtifact:'report',originalHash:h,scope:['criterion'],disposition:'owned-residual',patch,resultingArtifact:'patched',residuals:[{requirement:'criterion',owner:'owner',instrument:'manual',step:'next',closure:'observed'}],rationale:'bounded scope'};
    expect(() => apply(s,'decision.record',decision,c,'worker')).toThrow('owner');
    expect(() => apply(s,'decision.record',decision,{...c,approvedPatches:{}},'owner')).toThrow('deterministically');
    s = apply(s,'decision.record',decision,c,'owner'); s = apply(s,'assignment.start',assignment('transcriber','transcriber'),c);
    expect(() => apply(s,'transcription.verify',{assignment:'transcriber',decision:'decision',hash:h,pass:true,semanticFidelity:true},c)).toThrow('mechanical');
    s = apply(s,'transcription.verify',{assignment:'transcriber',decision:'decision',hash:h2,pass:true,semanticFidelity:true},c);
    expect(s.artifacts.patched.acceptedHash).toBe(h2); expect(s.activities.criteria.rounds).toBe(2);
  });
  it('retains unknown-operation quarantine until observed termination and reconciliation', () => {
    let s = apply(scoped(),'assignment.start',{...assignment('author'),resources:['command'],allowedActions:['write','run']}); const c = context();
    const op = {id:'op',assignment:'author',resource:'command',status:'pending' as const,publicationToken:s.assignments.author.publicationToken,pid:null,reconciled:false};
    expect(() => apply(s,'operation.start',{operation:op},c)).toThrow('trusted runner');
    c.operations = {op}; s = apply(s,'operation.start',{operation:op},c);
    const unknown = {...op,status:'unknown' as const}; c.operations.op = unknown; s = apply(s,'operation.unknown',{operation:unknown},c);
    expect(() => apply(s,'assignment.reconcile',{assignment:'author',resolution:'restore'},c,'owner')).toThrow('quiescent');
    expect(s.assignments.author.status).toBe('quarantined');
    const stopped = {...op,status:'terminated' as const,reconciled:true}; c.operations.op = stopped; s = apply(s,'operation.finish',{operation:stopped},c);
    s = apply(s,'assignment.reconcile',{assignment:'author',resolution:'restored'},c,'owner'); expect(s.assignments.author.reconciled).toBe(true);
  });
  it('rejects old accepted artifact after supersession and preserves rounds on invalidation', () => {
    let s = apply(scoped(),'assignment.start',assignment('author')); const imported = submit(s), c = imported.c;
    s = apply(imported.state,'assignment.finish',{assignment:'author'},c); s = apply(s,'assignment.start',assignment('checker','checker'),c);
    s = apply(s,'review.record',{assignment:'checker',artifact:'report',hash:h,verdict:'clean',findings:[]},c);
    s = apply(s,'assignment.finish',{assignment:'checker'},c); s = apply(s,'artifact.invalidate',{artifact:'report',reason:'input changed'},c,'owner');
    expect(s.activities.criteria.rounds).toBe(1); expect(s.artifacts.report.acceptedHash).toBeNull();
    expect(() => apply(s,'assignment.start',{...assignment('consumer'),inputs:{report:h}},c)).toThrow('not accepted');
  });
  it('requires captured policy gates and rejects whole-candidate evidence reuse', () => {
    let s = apply(scoped(),'assignment.start',{...assignment('author'),resources:['command'],allowedActions:['write','run']}); const c = context();
    const evidence = {id:'gate',assignment:'author',worker:worker('author'),gate:'check',candidate,executable:'node',args:['check.js'],cwd:'C:/work',started:1,finished:2,exitCode:0,outputHash:h,outputPath:'logs/gate',limitations:[],kind:'gate' as const};
    expect(() => apply(s,'evidence.record',{evidence},c)).toThrow('captured'); c.evidence.gate = evidence;
    s = apply(s,'evidence.record',{evidence},c); expect(currentEvidence(s,'gate',c).exitCode).toBe(0);
    expect(() => currentEvidence(s,'gate',{...c,candidate:{...candidate,environmentHash:h2}})).toThrow('stale');
    expect(() => currentEvidence(s,'gate',{...c,candidate:{...candidate,files:{'undeclared.config':h2},digest:h2}})).toThrow('stale');
    const invented = {...evidence,id:'bad',executable:'shell'}; c.evidence.bad = invented;
    expect(() => apply(s,'evidence.record',{evidence:invented},c)).toThrow('outside granted');
  });
  it('forbids implementer as verifier and path aliases escaping ownership', () => {
    let s = apply(scoped(),'assignment.start',assignment('implementer','implementer')); s = apply(s,'assignment.finish',{assignment:'implementer'});
    expect(() => apply(s,'assignment.start',assignment('verifier','verifier',worker('implementer')))).toThrow('independent');
    for (const path of ['../outside','C:/outside','dir\\file','file.','CON.txt']) expect(() => apply(initial(),'item.create',item('bad',path))).toThrow('unsafe');
    expect(() => apply(initial(),'item.create',{...item(),affectedPaths:['A.ts','a.ts']})).toThrow('case-colliding');
  });
  it('rejects mislabeled implementation authors and ungranted review', () => {
    let s = scoped(); s = apply(s,'activity.create',{id:'build',item:'item',kind:'implementation',requirements:['criterion'],dependencies:[]});
    s = apply(s,'assignment.start',{...assignment('author','architect'),activity:'build',writePaths:['report.json'],allowedActions:['write']});
    const artifact: Artifact = {id:'implementation',activity:'build',version:1,hash:h,path:'report.json',author:worker('author'),inputs:[]}; const c = context(); c.artifacts.implementation = artifact;
    expect(() => apply(s,'artifact.submit',{assignment:'author',artifact,publicationToken:s.assignments.author.publicationToken},c)).toThrow('role/activity');
    let reviewed = apply(scoped(),'assignment.start',assignment('author')); const submitted = submit(reviewed); reviewed = apply(submitted.state,'assignment.finish',{assignment:'author'},submitted.c);
    reviewed = apply(reviewed,'assignment.start',{...assignment('checker','checker'),allowedActions:[]},submitted.c);
    expect(() => apply(reviewed,'review.record',{assignment:'checker',artifact:'report',hash:h,verdict:'clean',findings:[]},submitted.c)).toThrow('review permission');
  });
  it('records failed trusted execution after cancellation without restoring publication', () => {
    let s = apply(scoped(),'assignment.start',{...assignment('author'),resources:['command'],allowedActions:['write','run']}); const c = context();
    s = apply(s,'assignment.cancel',{assignment:'author',reason:'stop'},c,'owner');
    const evidence = {id:'failed',assignment:'author',worker:worker('author'),gate:'check',candidate,executable:'node',args:['check.js'],cwd:'C:/work',started:1,finished:100,exitCode:null,outputHash:h,outputPath:'logs/failure',limitations:['cancelled'],kind:'gate' as const};
    c.now = 100; c.candidate = {...candidate,digest:h2}; c.evidence.failed = evidence;
    s = apply(s,'evidence.record',{evidence},c); expect(s.evidence.failed.exitCode).toBeNull(); expect(s.assignments.author.status).toBe('cancelled');
    expect(() => currentEvidence(s,'failed',c)).toThrow('stale or failed');
    const passing = {...evidence,id:'forged-pass',exitCode:0}; c.evidence['forged-pass'] = passing;
    expect(() => apply(s,'evidence.record',{evidence:passing},c)).toThrow('fenced');
  });
  it('allows owner disposition of an exhausted clean review after explicit invalidation', () => {
    let s = apply(scoped(),'assignment.start',assignment('author')); const imported = submit(s), c = imported.c;
    s = apply(imported.state,'assignment.finish',{assignment:'author'},c);
    s.activities.criteria.rounds = 2; s.activities.criteria.status = 'accepted'; s.artifacts.report.acceptedHash = h;
    s.activities.criteria.reviews = [{artifact:'report',hash:h,verdict:'defective',findings:[{severity:'P2',mechanism:'scope',classification:'new',need:'ruling'}]},{artifact:'report',hash:h,verdict:'clean',findings:[]}];
    s = apply(s,'artifact.invalidate',{artifact:'report',reason:'upstream changed'},c,'owner');
    const patch = {originalHash:h,replacements:[],expectedHash:h}; c.approvedPatches = {decision:patch}; c.artifacts.patch = {...imported.artifact,id:'patch',version:2};
    s = apply(s,'decision.record',{id:'decision',activity:'criteria',originalArtifact:'report',originalHash:h,scope:['criterion'],disposition:'bounded-acceptance',patch,resultingArtifact:'patch',residuals:[],rationale:'affirm exact current scope after input change'},c,'owner');
    expect(s.decisions.decision.originalHash).toBe(h); expect(s.activities.criteria.rounds).toBe(2);
  });
  it('rejects concurrent or restart operation launches until prior operation is terminated and reconciled', () => {
    let s = apply(scoped(),'assignment.start',{...assignment('author'),resources:['command'],allowedActions:['write','run']}); const c = context();
    const first = {id:'first',assignment:'author',resource:'command',status:'pending' as const,publicationToken:s.assignments.author.publicationToken,pid:null,reconciled:false};
    c.operations = {first}; s = apply(s,'operation.start',{operation:first},c);
    const second = {...first,id:'second'}; c.operations.second = second;
    expect(() => apply(s,'operation.start',{operation:second},c)).toThrow('outstanding operation');
    const running = {...first,status:'running' as const,pid:100}; c.operations.first = running; s = apply(s,'operation.running',{operation:running},c);
    expect(() => apply(s,'operation.start',{operation:second},c)).toThrow('outstanding operation');
    const stopped = {...running,status:'terminated' as const,reconciled:false}; c.operations.first = stopped; s = apply(s,'operation.finish',{operation:stopped},c);
    expect(() => apply(s,'operation.start',{operation:second},c)).toThrow('outstanding operation');
    const reconciled = {...stopped,reconciled:true}; c.operations.first = reconciled; s = apply(s,'operation.finish',{operation:reconciled},c);
    s = apply(s,'operation.start',{operation:second},c); expect(s.operations.second.status).toBe('pending');
  });
  it('rejects reserved record IDs without changing the state or map prototype', () => {
    const s = initial(), before = structuredClone(s), prototype = Object.getPrototypeOf(s.items);
    for (const id of ['__proto__','constructor','prototype']) {
      expect(() => apply(s,'item.create',item(id))).toThrow('unsafe record ID');
      expect(s).toEqual(before); expect(Object.getPrototypeOf(s.items)).toBe(prototype);
    }
  });
  it('rejects missing reserved item references without resolving or mutating inherited properties', () => {
    const s = initial(), before = structuredClone(s), descriptors = Object.getOwnPropertyDescriptors(Object.prototype);
    for (const id of ['__proto__','constructor','prototype']) {
      expect(() => apply(s,'item.block',{item:id,needs:['owner decision']})).toThrow('missing item');
      expect(() => apply(s,'item.unblock',{item:id,resolution:'resolved'},context(),'owner')).toThrow('missing item');
      expect(s).toEqual(before); expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(descriptors);
    }
    const normalized = validateState(s);
    for (const key of ['items','activities','assignments','artifacts','evidence','decisions','operations','verificationReports','finalReports'] as const) expect(Object.getPrototypeOf(normalized[key])).toBeNull();
    expect(Object.getPrototypeOf(normalized.policy.gates)).toBeNull();
  });
});
