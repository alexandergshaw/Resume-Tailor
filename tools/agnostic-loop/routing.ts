import { readFile } from 'node:fs/promises';
import { canonical, digest } from './json';
import { validateRoutingConfig, validateJournal } from './routing-validation';
import type { ModelTarget, ProviderConfig, ProviderProbe, Qualification, RoleProfile, RouteFunction } from './dispatch-types';
export { validateRoutingConfig, validateJournal } from './routing-validation';

export function targetFingerprint(provider:ProviderConfig,target:ModelTarget):string{
  return digest(canonical({provider,target}));
}
export async function createPolicyQualification(provider:ProviderConfig,target:ModelTarget,probe:ProviderProbe,approval:{id:string;profiles:RoleProfile[];score:number;expires:number;suiteVersion:string;evidencePath:string}):Promise<Qualification>{
  if(probe.provider!==provider.id||target.provider!==provider.id||probe.availability!=='available')throw new Error('Qualification requires matching available provider probe');
  if(!approval.id||!approval.suiteVersion||!Number.isSafeInteger(approval.score)||approval.score<0||!Number.isSafeInteger(approval.expires)||approval.expires<=Date.now()||!approval.profiles.length||approval.profiles.some(p=>!['execution','analysis','critical'].includes(p)))throw new Error('Operator qualification approval is invalid or expired');
  return {schemaVersion:1,id:approval.id,target:target.id,targetHash:targetFingerprint(provider,target),adapterVersion:probe.adapterVersion,executableHash:probe.executableHash,suiteVersion:approval.suiteVersion,profiles:approval.profiles,score:approval.score,expires:approval.expires,evidencePath:approval.evidencePath,evidenceHash:digest(await readFile(approval.evidencePath)),authority:'operator'};
}
export const routeModel:RouteFunction=(raw,probes,journalInput,request)=>{
  const config=validateRoutingConfig(raw), journal=validateJournal(journalInput);
  if(!Number.isSafeInteger(request.now)||!Number.isSafeInteger(request.estimatedInputTokens)||request.estimatedInputTokens<0||!Number.isSafeInteger(request.reservedOutputTokens)||request.reservedOutputTokens<0)throw new Error('Route request counters must be nonnegative integers');
  if(config.roleProfiles[request.role]!==request.profile)throw new Error('Route profile does not match the configured role');
  const rejected:Record<string,string[]>={}; const choices:ReturnType<RouteFunction>['choice'][]=[];
  for(const target of config.targets){
    const reasons:string[]=[];const provider=config.providers.find(p=>p.id===target.provider)!;
    const probe=probes.find(p=>p.provider===provider.id);
    const qualification=config.qualifications.filter(q=>q.target===target.id&&q.targetHash===targetFingerprint(provider,target)&&q.adapterVersion===probe?.adapterVersion&&q.executableHash===probe?.executableHash&&q.expires>request.now&&q.profiles.includes(request.profile)).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))[0];
    if(!target.enabled||!provider.enabled)reasons.push('Target or provider disabled');
    if(!probe||probe.availability!=='available')reasons.push('Provider unavailable or unprobed');
    if(probe?.authentication==='unavailable')reasons.push('Provider authentication unavailable');
    if(!probe?.capabilities.freshSession||!probe.capabilities.structuredOutput||!probe.capabilities.readFiles||(request.requireWrites&&!probe.capabilities.writeFiles))reasons.push('Required fresh-session/output/file capability unavailable');
    if(config.profiles[request.profile].requireObservedModel&&!probe?.capabilities.observedModel)reasons.push('Profile requires unavailable observed-model capability');
    if(target.maxContextTokens<request.estimatedInputTokens+request.reservedOutputTokens)reasons.push('Context capacity insufficient');
    if(!qualification||qualification.score<config.profiles[request.profile].minimumScore)reasons.push('Current role qualification unavailable or below threshold');
    if(request.now>=config.budget.deadline)reasons.push('Dispatch deadline exhausted');
    if(Object.keys(journal.jobs).length>=config.budget.maxJobs)reasons.push('Dispatch job budget exhausted');
    if(journal.unavailableUsageJobs.length&&!config.budget.allowUnavailableUsage)reasons.push('Unavailable prior usage requires operator accounting');
    let reserve:number|null=null;
    if(target.inputMicroUsdPerMillion!==null&&target.outputMicroUsdPerMillion!==null)reserve=Math.ceil((request.estimatedInputTokens*target.inputMicroUsdPerMillion+request.reservedOutputTokens*target.outputMicroUsdPerMillion)/1_000_000);
    if(config.budget.mode==='provider-enforced'&&!probe?.capabilities.nativeCostCap)reasons.push('Provider cannot enforce a hard monetary cap');
    if(config.budget.maxMicroUsd!==null){
      if(reserve===null)reasons.push('Cannot reserve unknown monetary cost under finite grant');
      else if(journal.spentMicroUsd+journal.reservationsMicroUsd+reserve>config.budget.maxMicroUsd)reasons.push('Monetary admission budget exhausted');
    }
    if(reasons.length){rejected[target.id]=reasons;continue;}
    choices.push({target,provider,qualification:qualification!,profile:request.profile,reservedMicroUsd:reserve,reasons:[`Qualified ${request.profile} via ${qualification!.authority}: ${qualification!.id}`,probe?.authentication==='observed'?'Authentication observed':'Authentication/model access unverified until invocation',reserve===null?'Monetary cost unavailable':`Estimated reservation ${reserve} microUSD`]});
  }
  const cost=(value:NonNullable<ReturnType<RouteFunction>['choice']>)=>value.reservedMicroUsd??Number.POSITIVE_INFINITY;
  const eligible=choices.filter((value):value is NonNullable<typeof value>=>value!==null);
  eligible.sort((a,b)=>request.profile==='execution'?(cost(a)-cost(b)||b.qualification.score-a.qualification.score||a.target.id.localeCompare(b.target.id)):(b.qualification.score-a.qualification.score||cost(a)-cost(b)||a.target.id.localeCompare(b.target.id)));
  return {choice:eligible[0]??null,rejected};
};
