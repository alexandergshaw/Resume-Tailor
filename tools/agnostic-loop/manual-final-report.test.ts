import { describe, expect, it } from 'vitest';
import { applyEvent, createState } from './engine';
import { canonical, digest } from './json';
import { buildManualFinalReport } from './manual-final-report';
import { validateState } from './validation';
import type { Context, LoopState, Residual, Worker } from './types';

const worker = (id: string): Worker => ({instance:id,context:id,provider:'manual',model:'requested',settings:{},tools:[]});
const residual: Residual = {requirement:'Live proof',owner:'owner',instrument:'live browser',step:'Before activation',closure:'Observed behavior recorded'};
function fixture(allocatedFinalReport = false) {
  let state = createState({owner:'owner',workspace:'C:/work',allowedActions:['write','run','review','import'],candidateExclusions:['artifacts'],environmentKeys:[],externalFiles:[],gates:{regression:{executable:'C:/node.exe',args:['gate.js'],resources:['workspace']}},concurrency:3,deadline:1000,maxAssignments:20,commandTimeout:100});
  const lineage = {files:{'source.ts':digest('source')},policyHash:digest(canonical(state.policy)),environmentHash:digest('env'),toolHash:digest('tool')};
  const candidate = {digest:digest(canonical(lineage)),...lineage};
  const c: Context = {now:10,candidate,artifacts:{},evidence:{},verificationReports:{}};
  let sequence = 0;
  const event = (type: string, payload: Record<string, unknown>) => { state = applyEvent(state,{id:`event-${++sequence}`,expectedRevision:state.revision,actor:'owner',type,payload},c); };
  event('item.create',{id:'item',objective:'Deliver local change',owner:'owner',affectedPaths:['artifacts/verification.json','artifacts/whole.json',...(allocatedFinalReport ? [] : ['artifacts/final.json'])],dependencies:[],criteria:['works'],requiredArtifacts:{},requiredGates:['regression'],triage:{}});
  const start = (id: string, activity: string, role: string, path: string | null, inputs: Record<string,string> = {}) => event('assignment.start',{id,item:'item',activity,role,worker:worker(id),inputs,writePaths:path ? [path] : [],affectedPaths:path ? [path] : [],resources:role === 'verifier' ? ['workspace'] : [],allowedActions:role === 'checker' ? ['review'] : role === 'verifier' ? ['write','run','import'] : ['write','import'],deadline:900,deliverables:[]});
  const submit = (assignment: string, id: string, path: string, bytes: string) => {
    const a = state.assignments[assignment];
    const artifact = {id,activity:a.activity,version:1,hash:digest(bytes),path,author:a.worker,inputs:Object.keys(a.inputs)};
    c.artifacts[id] = artifact;
    event('artifact.submit',{assignment,artifact,publicationToken:a.publicationToken});
  };
  const accept = (id: string) => {
    const artifact = state.artifacts[id]; const checker = `${id}-checker`;
    start(checker,artifact.activity,'checker',null);
    event('review.record',{assignment:checker,artifact:id,hash:artifact.hash,verdict:'clean',findings:[]});
    event('assignment.finish',{assignment:checker});
  };
  event('activity.create',{id:'verification',item:'item',kind:'verification',requirements:['works'],dependencies:[]});
  start('verify-author','verification','verifier','artifacts/verification.json');
  const evidence = {id:'gate-pass',assignment:'verify-author',worker:worker('verify-author'),gate:'regression',candidate,executable:'C:/node.exe',args:['gate.js'],cwd:'C:/work',started:1,finished:5,exitCode:0,outputHash:digest('pass'),outputPath:'recorded-output',limitations:[],kind:'gate' as const};
  c.evidence[evidence.id] = evidence; event('evidence.record',{evidence});
  const verification = {candidate,worker:worker('verify-author'),criteria:{works:['gate-pass']},limitations:['Unit fixture; no live IO attestation']};
  submit('verify-author','verification-report','artifacts/verification.json',canonical(verification));
  c.verificationReports!['verification-report'] = verification;
  event('verification.record',{assignment:'verify-author',artifact:'verification-report',report:verification});
  event('assignment.finish',{assignment:'verify-author'}); accept('verification-report');
  event('activity.create',{id:'whole',item:'item',kind:'whole-change-review',requirements:['works'],dependencies:[]});
  start('whole-author','whole','specialist','artifacts/whole.json');
  submit('whole-author','whole-report','artifacts/whole.json','Reviewed whole candidate');
  event('assignment.finish',{assignment:'whole-author'}); accept('whole-report');
  // Seed the already verified item stage; all input publication, evidence,
  // acceptance and finalizer admission above/below use the real engine.
  state.items.item.status = 'verified';
  event('activity.create',{id:'final',item:'item',kind:'final-report',requirements:['works'],dependencies:['verification','whole']});
  if (allocatedFinalReport) c.artifactAllocation = {directory:'artifacts',paths:['artifacts/final.json'],configHash:digest('trusted-allocation')};
  start('finalizer','final','finalizer','artifacts/final.json',{'verification-report':state.artifacts['verification-report'].hash,'whole-report':state.artifacts['whole-report'].hash});
  return {state:validateState(JSON.parse(JSON.stringify(state))),candidate,context:c};
}

describe('manual final report snapshot assembly', () => {
  it('honors actual engine admission of an excluded report allocation outside item paths', () => {
    const {state,candidate,context} = fixture(true);
    expect(state.items.item.affectedPaths).not.toContain('artifacts/final.json');
    expect(state.assignments.finalizer.writePaths).toEqual(['artifacts/final.json']);
    const report = buildManualFinalReport(state,'finalizer',[],10);
    const artifact = {id:'assembled-final',activity:'final',version:1,hash:digest(canonical(report)),path:'artifacts/final.json',author:state.assignments.finalizer.worker,inputs:Object.keys(state.assignments.finalizer.inputs)};
    const observed = {...context,artifacts:{...context.artifacts,[artifact.id]:artifact},finalReports:{[artifact.id]:report}};
    const published = applyEvent(state,{id:'publish-final',expectedRevision:state.revision,actor:'owner',type:'artifact.submit',payload:{assignment:'finalizer',artifact,publicationToken:state.assignments.finalizer.publicationToken}},observed);
    const recorded = applyEvent(published,{id:'record-final',expectedRevision:published.revision,actor:'owner',type:'final.record',payload:{assignment:'finalizer',artifact:artifact.id,report}},observed);
    expect(recorded.finalReports[artifact.id]).toEqual({...report,candidate});
    expect(recorded.artifacts[artifact.id].acceptedHash).toBeNull();
  });
  it('assembles exactly six recorded fields, uses explicit residuals and never aliases or mutates input', () => {
    const {state,candidate} = fixture(), before = structuredClone(state), obligations = [residual];
    const report = buildManualFinalReport(state,'finalizer',obligations,10);
    expect(report).toEqual({candidate,verificationArtifact:'verification-report',regressionEvidence:['gate-pass'],wholeChangeReviewArtifact:'whole-report',residuals:[residual],delivery:'local'});
    expect(Object.keys(report)).toHaveLength(6); expect(state).toEqual(before);
    report.candidate.files['source.ts'] = 'changed'; report.residuals[0].owner = 'changed';
    expect(state).toEqual(before); expect(obligations[0].owner).toBe('owner');
  });
  it('rejects expired, fenced, missing or altered finalizer admissions', () => {
    const {state} = fixture();
    expect(() => buildManualFinalReport(state,'finalizer',[],1001)).toThrow('deadline');
    expect(() => buildManualFinalReport(state,'finalizer',[],901)).toThrow('deadline');
    expect(() => buildManualFinalReport(state,'missing',[],10)).toThrow('finalizer');
    for (const mutate of [(s:LoopState) => {s.assignments.finalizer.status = 'cancelled';},(s:LoopState) => {s.assignments.finalizer.worker.context = 'replacement';},(s:LoopState) => {s.assignments.finalizer.publicationToken = 'replacement';}]) {
      const changed = structuredClone(state); mutate(changed);
      expect(() => buildManualFinalReport(changed,'finalizer',[],10)).toThrow();
    }
    expect(() => buildManualFinalReport(state,'finalizer',[],NaN)).toThrow('time');
  });
  it('rejects stale policy, candidate lineage and changed or unaccepted inputs', () => {
    const mutations: ((s:LoopState) => void)[] = [
      s => {s.policy.deadline++;},
      s => {s.artifacts['whole-report'].candidate.digest = digest('other');},
      s => {s.verificationReports['verification-report'].candidate.toolHash = digest('other');},
      s => {s.artifacts['verification-report'].acceptedHash = null;},
      s => {s.artifacts['whole-report'].hash = digest('changed'); s.artifacts['whole-report'].acceptedHash = s.artifacts['whole-report'].hash;},
      s => {delete s.verificationReports['verification-report'];},
      s => {s.activities.whole.status = 'open';},
      s => {s.assignments['whole-author'].status = 'running';},
    ];
    for (const mutate of mutations) {const {state} = fixture(); mutate(state); expect(() => buildManualFinalReport(state,'finalizer',[],10)).toThrow();}
  });
  it('rejects missing, failed, mutation, stale, changed-command and cross-item gate evidence', () => {
    const mutations: ((s:LoopState) => void)[] = [
      s => {delete s.evidence['gate-pass'];}, s => {s.evidence['gate-pass'].exitCode = 1;},
      s => {s.evidence['gate-pass'].kind = 'mutation';}, s => {s.evidence['gate-pass'].candidate.environmentHash = digest('other');},
      s => {s.evidence['gate-pass'].args = ['ungranted.js'];}, s => {s.evidence['gate-pass'].finished = 11;},
      s => {s.assignments['verify-author'].resources = [];}, s => {s.assignments['verify-author'].allowedActions = ['write'];},
      s => {s.items.other = {...s.items.item,id:'other'}; s.activities.verification.item = 'other'; s.assignments['verify-author'].item = 'other'; s.assignments['verification-report-checker'].item = 'other';},
    ];
    for (const mutate of mutations) {const {state} = fixture(); mutate(state); expect(() => buildManualFinalReport(state,'finalizer',[],10)).toThrow();}
    const {state} = fixture(); state.evidence['later-failure'] = {...state.evidence['gate-pass'],id:'later-failure',finished:8,exitCode:1};
    expect(() => buildManualFinalReport(state,'finalizer',[],10)).toThrow('passing');
  });
  it('rejects outstanding operations and never invents or drops explicit residual obligations', () => {
    const {state} = fixture();
    state.operations.pending = {id:'pending',assignment:'finalizer',resource:'workspace',status:'unknown',publicationToken:state.assignments.finalizer.publicationToken,pid:null,reconciled:false};
    expect(() => buildManualFinalReport(state,'finalizer',[],10)).toThrow('pending operation');
    delete state.operations.pending;
    state.decisions.ruling = {id:'ruling',activity:'whole',originalArtifact:'whole-report',originalHash:state.artifacts['whole-report'].hash,scope:[],disposition:'owned-residual',patch:{originalHash:state.artifacts['whole-report'].hash,replacements:[],expectedHash:state.artifacts['whole-report'].hash},resultingArtifact:'whole-report',residuals:[residual],rationale:'Owner retains live proof',verified:true};
    expect(() => buildManualFinalReport(state,'finalizer',[],10)).toThrow('residuals missing');
    expect(buildManualFinalReport(state,'finalizer',[residual],10).residuals).toEqual([residual]);
    expect(() => buildManualFinalReport(state,'finalizer',[{...residual,owner:''}],10)).toThrow('nonempty');
  });
});
