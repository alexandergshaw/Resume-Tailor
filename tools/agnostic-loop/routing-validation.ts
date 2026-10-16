import path from 'node:path';
import { array, integer, map, object, string } from './validation';
import { safePath } from './engine';
import type { BacklogSelection, CriteriaProposal, DispatchJournal, PlanProposal, RoutingConfig, ScopeProposal, TaskSpec, WorkerOutcome } from './dispatch-types';

type Schema = (value: unknown, label: string) => void;
const text: Schema = (v,p) => { if (typeof v !== 'string') throw new Error(`${p}: string required`); };
const bool: Schema = (v,p) => { if (typeof v !== 'boolean') throw new Error(`${p}: boolean required`); };
const literal = (...values: unknown[]): Schema => (v,p) => { if (!values.includes(v)) throw new Error(`${p}: unsupported variant`); };
const nullable = (schema: Schema): Schema => (v,p) => { if (v !== null) schema(v,p); };
const hash: Schema = (v,p) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw new Error(`${p}: SHA-256 required`); };
const id: Schema = (v,p) => { string(v,p); if (['__proto__','constructor','prototype'].includes(v as string)) throw new Error(`${p}: unsafe ID`); };
const relative: Schema = (v,p) => { string(v,p); safePath(v as string); };
const strings=array(string), ids=array(id), paths=array(relative), texts=array(text);
const settings=map(text);
const profile=literal('execution','analysis','critical');
const worker=object({instance:id,context:id,provider:id,model:string,settings,tools:strings});
const capabilities=object({freshSession:bool,structuredOutput:bool,readFiles:bool,writeFiles:bool,observedModel:bool,nativeCostCap:bool});
export const providerSchema=object({id,kind:literal('codex','claude','gemini','command'),enabled:bool,executable:string,prefixArgs:texts,environmentKeys:strings,settings,timeoutMs:integer,maxOutputBytes:integer});
export const targetSchema=object({id,provider:id,model:string,settings,enabled:bool,maxContextTokens:integer,inputMicroUsdPerMillion:nullable(integer),outputMicroUsdPerMillion:nullable(integer)});
export const qualificationSchema=object({schemaVersion:literal(1),id,target:id,targetHash:hash,adapterVersion:string,executableHash:hash,suiteVersion:string,profiles:array(profile),score:integer,expires:integer,evidencePath:string,evidenceHash:hash,authority:literal('operator','evaluation')});
const profileRule=object({minimumScore:integer,requireObservedModel:bool});
const roleProfiles=object(Object.fromEntries(['criteria','architect','specialist','planner','implementer','checker','verifier','test-designer','transcriber','finalizer'].map(role=>[role,profile])));
const grant=object({owner:id,pathPrefixes:paths,gateNames:ids,artifactDirectory:relative,allowConfigure:bool,allowLocalDelivery:bool});
const routing=object({schemaVersion:literal(1),providers:array(providerSchema),targets:array(targetSchema),qualifications:array(qualificationSchema),profiles:object({execution:profileRule,analysis:profileRule,critical:profileRule}),roleProfiles,budget:object({maxJobs:integer,deadline:integer,maxMicroUsd:nullable(integer),mode:literal('estimated','provider-enforced','unbounded'),allowUnavailableUsage:bool}),grant});
const scope=object({schemaVersion:literal(1),item:id,affectedPaths:paths,writePaths:paths,gateNames:ids,triage:map(string),limitations:strings});
const criteria=object({schemaVersion:literal(1),item:id,criteria:map(string),leverage:string,diagnostics:string,limitations:strings});
const wave=object({id,objective:string,requirements:ids,affectedPaths:paths,writePaths:paths,dependencies:ids,gateNames:ids});
const plan=object({schemaVersion:literal(1),item:id,waves:array(wave),specialistKinds:ids,limitations:strings});
const task=object({id,item:id,activity:id,kind:string,role:literal('criteria','architect','specialist','planner','implementer','checker','verifier','test-designer','transcriber','finalizer'),purpose:literal('author','review','repair','transcription'),requirementIds:ids,acceptedInputs:map(hash),affectedPaths:paths,writePaths:paths,resources:ids,artifactIds:ids,gateNames:ids,wave:nullable(id),instructions:string});
const finding=object({severity:literal('P0','P1','P2','P3'),mechanism:string,classification:literal('new','repeat'),need:literal('ruling','design','measurement')});
const residual=object({requirement:string,owner:string,instrument:string,step:string,closure:string});
const proposal:Schema=(v,p)=>{if(v===null)return;const r=v as Record<string,unknown>;if(r&&Object.hasOwn(r,'waves'))plan(v,p);else if(r&&Object.hasOwn(r,'criteria'))criteria(v,p);else scope(v,p);};
const outcome=object({schemaVersion:literal(1),job:id,assignment:id,publicationToken:string,packetHash:hash,inputHashes:map(hash),candidateDigest:hash,worker,status:literal('completed','failed','needs-owner'),artifacts:array(object({id,path:relative,content:text})),review:nullable(object({artifact:id,hash,verdict:literal('clean','defective'),findings:array(finding)})),proposal,criterionEvidence:nullable(map(ids)),residuals:array(residual),limitations:strings,failure:nullable(string)});
const candidate=object({digest:hash,files:map(hash),policyHash:hash,environmentHash:hash,toolHash:hash});
const observation=object({provider:nullable(string),model:nullable(string),settings:nullable(settings),session:nullable(string),source:literal('provider-output','unavailable')});
const usage=object({source:literal('observed','unavailable'),inputTokens:nullable(integer),outputTokens:nullable(integer),costMicroUsd:nullable(integer)});
const route=object({target:targetSchema,provider:providerSchema,qualification:qualificationSchema,profile,reservedMicroUsd:nullable(integer),reasons:strings});
const launch=object({id,actionKey:string,item:id,assignment:id,operation:id,worker,route,task,packetPath:string,packetHash:hash,inboxPath:string,candidate,inputHashes:map(hash),publicationToken:string,status:literal('prepared','pending','running','terminated','unknown','imported','rejected'),pid:nullable(integer),observed:observation,usage,reservedMicroUsd:nullable(integer),outputHash:nullable(hash),resultHash:nullable(hash),rejection:nullable(string),created:integer,finished:nullable(integer),importedEvents:ids});
const probe=object({schemaVersion:literal(1),provider:id,adapterVersion:string,executableHash:hash,cliVersion:nullable(string),availability:literal('available','unavailable'),authentication:literal('observed','unknown','unavailable'),capabilities,checked:integer,reasons:strings});
const journal=object({schemaVersion:literal(1),revision:integer,configHash:hash,jobs:map(launch),probes:map(probe),reservationsMicroUsd:integer,spentMicroUsd:integer,unavailableUsageJobs:ids,checkpoints:map(string)});
const selection=object({id,objective:string,owns:paths,verify:nullable(string),requirements:ids,sourcePath:string,sourceHash:hash,sourceKind:literal('backlog','workflow')});
function validated<T>(schema:Schema,value:unknown,label:string):T{schema(value,label);return structuredClone(value) as T;}
function unique(values:string[],label:string):void{if(new Set(values).size!==values.length)throw new Error(`${label}: duplicate ID`);}
export function validateRoutingConfig(value:unknown):RoutingConfig{
  const config=validated<RoutingConfig>(routing,value,'routing');
  unique(config.providers.map(p=>p.id),'providers');unique(config.targets.map(t=>t.id),'targets');unique(config.qualifications.map(q=>q.id),'qualifications');
  if(!config.budget.maxJobs)throw new Error('Routing maxJobs must be positive');
  for(const provider of config.providers){if(!path.isAbsolute(provider.executable)||!provider.timeoutMs||!provider.maxOutputBytes)throw new Error('Provider executable must be absolute and limits positive');}
  for(const target of config.targets){if(!config.providers.some(p=>p.id===target.provider)||!target.maxContextTokens)throw new Error('Target requires registered provider and positive context capacity');}
  for(const role of ['criteria','architect','planner','checker','test-designer'] as const)if(config.roleProfiles[role]!=='critical')throw new Error(`Critical role cannot be weakened: ${role}`);
  if(config.budget.mode==='unbounded'&&config.budget.maxMicroUsd!==null)throw new Error('Unbounded budget cannot claim a monetary ceiling');
  return config;
}
export function validateJournal(value:unknown):DispatchJournal{const result=validated<DispatchJournal>(journal,value,'journal');for(const [key,job]of Object.entries(result.jobs))if(key!==job.id)throw new Error('Journal job ID mismatch');return result;}
export function validateScopeProposal(value:unknown):ScopeProposal{const result=validated<ScopeProposal>(scope,value,'scope');if(!result.writePaths.every(p=>result.affectedPaths.includes(p)))throw new Error('Scope writes outside affected paths');return result;}
export function validateCriteriaProposal(value:unknown):CriteriaProposal{const result=validated<CriteriaProposal>(criteria,value,'criteria');if(!Object.keys(result.criteria).length)throw new Error('Criteria must be nonempty');return result;}
export function validatePlanProposal(value:unknown):PlanProposal{
  const result=validated<PlanProposal>(plan,value,'plan');unique(result.waves.map(w=>w.id),'waves');
  const seen=new Set<string>(),active=new Set<string>();
  const visit=(key:string)=>{if(seen.has(key))return;if(active.has(key))throw new Error('Plan wave dependency cycle');const wave=result.waves.find(w=>w.id===key);if(!wave)throw new Error('Missing plan wave dependency');if(!wave.writePaths.every(p=>wave.affectedPaths.includes(p)))throw new Error('Plan writes outside affected paths');active.add(key);wave.dependencies.forEach(visit);active.delete(key);seen.add(key);};
  result.waves.forEach(w=>visit(w.id));return result;
}
export function validateTaskSpec(value:unknown):TaskSpec{return validated(task,value,'task');}
export function validateBacklogSelection(value:unknown):BacklogSelection{return validated(selection,value,'selection');}
export function validateWorkerOutcome(value:unknown):WorkerOutcome{
  const result=validated<WorkerOutcome>(outcome,value,'worker outcome');unique(result.artifacts.map(a=>a.id),'artifacts');
  if(result.status==='completed'&&result.failure!==null)throw new Error('Completed outcome cannot claim failure');
  if(result.review&&(result.review.verdict==='clean')!==(result.review.findings.length===0))throw new Error('Review verdict/findings mismatch');
  return result;
}
