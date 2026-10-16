import type { Context, Envelope, LoopState, Policy } from './types';

type Schema = (value: unknown, path: string) => void;
const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
export const string: Schema = (v, p) => { if (typeof v !== 'string' || !v.trim()) fail(p, 'nonempty string required'); };
const text: Schema = (v, p) => { if (typeof v !== 'string') fail(p, 'string required'); };
export const integer: Schema = (v, p) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(p, 'nonnegative integer required'); };
const bool: Schema = (v, p) => { if (typeof v !== 'boolean') fail(p, 'boolean required'); };
const hash: Schema = (v, p) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail(p, 'SHA-256 digest required'); };
const literal = (...values: unknown[]): Schema => (v, p) => { if (!values.includes(v)) fail(p, `expected ${values.join(', ')}`); };
const nullable = (s: Schema): Schema => (v, p) => { if (v !== null) s(v, p); };
const optional = (s: Schema): Schema => (v,p) => { if (v !== undefined) s(v,p); };
export const array = (s: Schema): Schema => (v, p) => { if (!Array.isArray(v)) fail(p, 'array required'); (v as unknown[]).forEach((x, i) => s(x, `${p}[${i}]`)); };
export const map = (s: Schema): Schema => (v, p) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(p, 'map required'); for (const [k, x] of Object.entries(v as Record<string, unknown>)) { string(k, p); if (['__proto__', 'constructor', 'prototype'].includes(k)) fail(p, 'unsafe key'); s(x, `${p}.${k}`); } };
export const object = (fields: Record<string, Schema>): Schema => (v, p) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(p, 'object required'); const r = v as Record<string, unknown>; for (const key of Object.keys(r)) if (!Object.hasOwn(fields,key)) fail(`${p}.${key}`, 'unsupported field'); for (const [key, schema] of Object.entries(fields)) schema(r[key], `${p}.${key}`); };
const strings = array(string);
const worker = object({ instance: string, context: string, provider: string, model: string, settings: map(text), tools: strings });
const candidate = object({ digest: hash, files: map(hash), policyHash: hash, environmentHash: hash, toolHash: hash });
const artifactFields = { id: string, activity: string, version: integer, hash, path: string, author: worker, inputs: strings };
const artifact = object(artifactFields);
const residual = object({ requirement: string, owner: string, instrument: string, step: string, closure: string });
const patch = object({ originalHash: hash, replacements: array(object({ start: integer, end: integer, text })), expectedHash: hash });
const finding = object({ severity: literal('P0', 'P1', 'P2', 'P3'), mechanism: string, classification: literal('new', 'repeat'), need: literal('ruling', 'design', 'measurement') });
const review = object({ artifact: string, hash, verdict: literal('clean', 'defective'), findings: array(finding) });
const evidence = object({ id: string, assignment: string, worker, gate: string, candidate, executable: string, args: array(text), cwd: string, started: integer, finished: integer, exitCode: nullable((v,p) => { if (typeof v !== 'number' || !Number.isSafeInteger(v)) fail(p,'integer required'); }), outputHash: hash, outputPath: string, limitations: strings, kind: literal('gate', 'mutation') });
const operation = object({ id: string, assignment: string, resource: string, status: literal('pending', 'running', 'terminated', 'unknown'), publicationToken: string, pid: nullable(integer), reconciled: bool });
const verification = object({ candidate, worker, criteria: map(strings), limitations: strings });
const finalReport = object({ candidate, verificationArtifact: string, regressionEvidence: strings, wholeChangeReviewArtifact: string, residuals: array(residual), delivery: literal('local') });
const itemFields = { id: string, objective: string, owner: string, affectedPaths: strings, dependencies: strings, criteria: strings, requiredArtifacts: map(strings), requiredGates: strings, triage: map(string) };
const statuses = ['queued', 'scoped', 'criteria-accepted', 'design-accepted', 'ready-to-build', 'implemented', 'verified', 'regression-passed', 'shipped'];
const activityFields = { id: string, item: string, kind: string, requirements: strings, dependencies: strings };
const assignmentFields = { id: string, item: string, activity: string, role: literal('criteria', 'architect', 'specialist', 'planner', 'implementer', 'checker', 'verifier', 'test-designer', 'transcriber', 'finalizer'), worker, inputs: map(hash), writePaths: strings, affectedPaths: strings, resources: strings, allowedActions: strings, deadline: integer, deliverables: strings };
const decisionFields = { id: string, activity: string, originalArtifact: string, originalHash: hash, scope: strings, disposition: literal('bounded-acceptance', 'relocation', 'owned-residual', 'withdrawal'), patch, resultingArtifact: string, residuals: array(residual), rationale: string };
export const eventPayloads: Record<string, Schema> = {
  'policy.continue': object({ priorPolicyHash: hash, deadline: integer, maxExtensionMs: integer, authorization: string, reason: string, gateArgumentCorrections: array(object({ gate: string, index: integer, previous: text, replacement: text })) }),
  'item.create': object(itemFields), 'activity.create': object(activityFields),
  'item.configure': object({ item:string,scopeArtifact:string,criteriaArtifact:string }),
  'assignment.start': object(assignmentFields),
  'artifact.submit': object({ assignment: string, artifact, publicationToken: string }),
  'artifact.invalidate': object({ artifact: string, reason: string }),
  'review.record': object({ assignment: string, ...{ artifact: string, hash, verdict: literal('clean', 'defective'), findings: array(finding) } }),
  'decision.record': object(decisionFields),
  'transcription.verify': object({ assignment: string, decision: string, hash, pass: bool, semanticFidelity: bool }),
  'assignment.finish': object({ assignment: string }),
  'assignment.cancel': object({ assignment: string, reason: string }),
  'assignment.quiesce': object({ assignment: string, quarantine: bool }),
  'assignment.reconcile': object({ assignment: string, resolution: string }),
  'operation.start': object({ operation }), 'operation.running': object({ operation }),
  'operation.finish': object({ operation }), 'operation.unknown': object({ operation }),
  'evidence.record': object({ evidence }),
  'verification.record': object({ assignment: string, artifact: string, report: verification }),
  'final.record': object({ assignment: string, artifact: string, report: finalReport }),
  'item.advance': object({ item: string, status: literal(...statuses), artifacts: strings, evidence: strings }),
  'item.block': object({ item: string, needs: strings }),
  'item.unblock': object({ item: string, resolution: string }),
  'item.escalate': object({ item: string, needs: strings, recommendation: string }),
  'run.pause': object({ reason: string }), 'run.resume': object({ reason: string }), 'run.cancel': object({ reason: string }),
};
export function validateEvent(value: unknown): Envelope {
  object({ id: string, expectedRevision: integer, actor: string, type: string, payload: (v,p) => { const type = (value as Record<string, unknown>).type; if (typeof type !== 'string') throw new Error(`${p}: unsupported event type`); if (!Object.hasOwn(eventPayloads,type)) fail(p,'unsupported event type'); eventPayloads[type](v,p); } })(value,'event');
  return structuredClone(value) as Envelope;
}
const policySchema = object({ owner: string, workspace: string, allowedActions: strings, candidateExclusions: strings, environmentKeys: strings, externalFiles: strings, gates: map(object({ executable: string, args: array(text), resources: strings })), concurrency: integer, deadline: integer, maxAssignments: integer, commandTimeout: integer });
export function validatePolicy(value: unknown): Policy { policySchema(value,'policy'); const p = value as Policy; if (!p.concurrency || !p.maxAssignments || !p.commandTimeout) fail('policy','positive budgets required'); const result = structuredClone(p); Object.setPrototypeOf(result.gates,null); return result; }
export function validateContext(value: unknown): Context {
  object({ manualPolicyContinuation:optional(bool),now:integer,candidate,artifacts:map((v,p) => { const r = v as Record<string,unknown>; if (r && typeof r === 'object' && 'assignment' in r) object({...artifactFields,assignment:string,acceptedHash:nullable(hash),candidate})(v,p); else artifact(v,p); }), evidence:map(evidence),operations:optional(map(operation)),approvedPatches:optional(map(patch)),verificationReports:optional(map(verification)),finalReports:optional(map(finalReport)),artifactAllocation:optional(object({directory:string,paths:strings,configHash:hash})),configuration:optional(object({configHash:hash,grant:object({owner:string,pathPrefixes:strings,gateNames:strings,artifactDirectory:string,allowConfigure:bool,allowLocalDelivery:bool}),scope:object({artifact:string,hash,proposal:object({schemaVersion:literal(1),item:string,affectedPaths:strings,writePaths:strings,gateNames:strings,triage:map(string),limitations:strings})}),criteria:object({artifact:string,hash,proposal:object({schemaVersion:literal(1),item:string,criteria:map(string),leverage:string,diagnostics:string,limitations:strings})})})) })(value,'context');
  return structuredClone(value) as Context;
}
export function validateState(value: unknown): LoopState {
  object({ schemaVersion: literal(1), revision: integer, policy: policySchema, runStatus: literal('running','paused','cancelled'),
    items: map(object({ ...itemFields, status: literal(...statuses), needs: strings, escalation: nullable(string) })),
    activities: map(object({ ...activityFields, status: literal('open','accepted','owner-needed','withdrawn'), rounds: integer, authors: array(worker), reviews: array(review) })),
    assignments: map(object({ ...assignmentFields, baseline: candidate, policyHash: hash, publicationToken: string, status: literal('running','finished','cancelled','quarantined'), reconciled: bool, reason: nullable(string) })),
    artifacts: map(object({ ...artifactFields, assignment: string, acceptedHash: nullable(hash), candidate })), evidence: map(evidence),
    decisions: map(object({ ...decisionFields, verified: bool })), operations: map(operation), verificationReports: map(verification), finalReports: map(finalReport), events: array((v) => { validateEvent(v); }),
  })(value,'state');
  const s = structuredClone(value) as LoopState;
  for (const name of ['items','activities','assignments','artifacts','evidence','decisions','operations'] as const) for (const [id, record] of Object.entries(s[name])) if (record.id !== id) fail(name,'map ID mismatch');
  if (s.events.length !== s.revision || new Set(s.events.map(e => e.id)).size !== s.events.length) fail('state','revision/event history mismatch');
  if (s.events.some((e,i) => e.expectedRevision !== i)) fail('state','event revision sequence mismatch');
  for (const a of Object.values(s.activities)) if (a.rounds > 2 || a.rounds !== a.reviews.length || !s.items[a.item]) fail('activity','invalid rounds or item');
  for (const item of Object.values(s.items)) if (item.dependencies.some(id => !s.items[id])) fail('item','missing dependency');
  for (const activity of Object.values(s.activities)) if (activity.dependencies.some(id => !s.activities[id]) || activity.requirements.some(id => !s.items[activity.item].criteria.includes(id))) fail('activity','invalid dependency/requirement');
  for (const a of Object.values(s.assignments)) if (!s.activities[a.activity] || !s.items[a.item] || s.activities[a.activity].item !== a.item || Object.keys(a.inputs).some(id => !s.artifacts[id])) fail('assignment','missing/mismatched parent or input');
  for (const a of Object.values(s.artifacts)) if (!s.activities[a.activity] || !s.assignments[a.assignment] || a.inputs.some(id => !s.artifacts[id]) || (a.acceptedHash !== null && a.acceptedHash !== a.hash)) fail('artifact','missing parent/input or acceptance hash mismatch');
  for (const e of Object.values(s.evidence)) if (!s.assignments[e.assignment] || !s.policy.gates[e.gate]) fail('evidence','missing assignment/gate');
  for (const op of Object.values(s.operations)) if (!s.assignments[op.assignment]) fail('operation','missing assignment');
  for (const d of Object.values(s.decisions)) if (!s.activities[d.activity] || !s.artifacts[d.originalArtifact] || (d.disposition !== 'withdrawal' && !s.artifacts[d.resultingArtifact])) fail('decision','missing parent/artifact');
  for (const id of [...Object.keys(s.verificationReports),...Object.keys(s.finalReports)]) if (!s.artifacts[id]) fail('report','missing bound artifact');
  for (const key of ['items','activities','assignments','artifacts','evidence','decisions','operations','verificationReports','finalReports'] as const) Object.setPrototypeOf(s[key],null);
  Object.setPrototypeOf(s.policy.gates,null);
  return s;
}
