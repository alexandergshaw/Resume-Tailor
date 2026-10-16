import { describe, expect, it } from 'vitest';
import { routeModel, targetFingerprint } from './routing';
import type { DispatchJournal, ModelTarget, ProviderConfig, ProviderProbe, RoutingConfig } from './dispatch-types';
const hash='a'.repeat(64);
function fixture(){
  const provider:ProviderConfig={id:'local',kind:'command',enabled:true,executable:process.execPath,prefixArgs:[],environmentKeys:[],settings:{},timeoutMs:5000,maxOutputBytes:65536};
  const probe:ProviderProbe={schemaVersion:1,provider:'local',adapterVersion:'fixture-v1',executableHash:hash,cliVersion:'1',availability:'available',authentication:'unknown',capabilities:{freshSession:true,structuredOutput:true,readFiles:true,writeFiles:true,observedModel:true,nativeCostCap:false},checked:1,reasons:[]};
  const targets:ModelTarget[]=[{id:'economical',provider:'local',model:'fixture-economical',settings:{},enabled:true,maxContextTokens:10000,inputMicroUsdPerMillion:1000,outputMicroUsdPerMillion:1000},{id:'stronger',provider:'local',model:'fixture-stronger',settings:{},enabled:true,maxContextTokens:10000,inputMicroUsdPerMillion:10000,outputMicroUsdPerMillion:10000}];
  const config:RoutingConfig={schemaVersion:1,providers:[provider],targets,qualifications:targets.map((target,index)=>({schemaVersion:1,id:`qualification-${index}`,target:target.id,targetHash:targetFingerprint(provider,target),adapterVersion:'fixture-v1',executableHash:hash,suiteVersion:'explicit-policy-v1',profiles:['execution','analysis','critical'],score:index?90:70,expires:10000,evidencePath:'policy.json',evidenceHash:hash,authority:'operator'})),profiles:{execution:{minimumScore:60,requireObservedModel:false},analysis:{minimumScore:60,requireObservedModel:false},critical:{minimumScore:60,requireObservedModel:false}},roleProfiles:{criteria:'critical',architect:'critical',specialist:'analysis',planner:'critical',implementer:'execution',checker:'critical',verifier:'analysis','test-designer':'critical',transcriber:'execution',finalizer:'analysis'},budget:{maxJobs:10,deadline:10000,maxMicroUsd:null,mode:'unbounded',allowUnavailableUsage:true},grant:{owner:'owner',pathPrefixes:['src'],gateNames:[],artifactDirectory:'artifacts',allowConfigure:true,allowLocalDelivery:true}};
  const journal:DispatchJournal={schemaVersion:1,revision:0,configHash:hash,jobs:{},probes:{},reservationsMicroUsd:0,spentMicroUsd:0,unavailableUsageJobs:[],checkpoints:{}};
  return{config,probe,journal};
}
describe('qualification precedes deterministic role ranking',()=>{
  it('uses judgment for critical and economy for qualified execution',()=>{
    const {config,probe,journal}=fixture();
    expect(routeModel(config,[probe],journal,{role:'checker',profile:'critical',estimatedInputTokens:1000,reservedOutputTokens:1000,requireWrites:false,authors:[],now:10}).choice?.target.id).toBe('stronger');
    expect(routeModel(config,[probe],journal,{role:'implementer',profile:'execution',estimatedInputTokens:1000,reservedOutputTokens:1000,requireWrites:true,authors:[],now:10}).choice?.target.id).toBe('economical');
  });
  it('rejects discovered but unqualified, expired and unsupported monetary caps',()=>{
    const {config,probe,journal}=fixture();config.qualifications=[];
    const request={role:'checker' as const,profile:'critical' as const,estimatedInputTokens:100,reservedOutputTokens:100,requireWrites:false,authors:[],now:10};
    const unqualified=routeModel(config,[probe],journal,request);expect(unqualified.choice).toBeNull();expect(unqualified.rejected.stronger.join(' ')).toContain('qualification');
    const next=fixture();next.config.qualifications.forEach(q=>q.expires=9);expect(routeModel(next.config,[next.probe],next.journal,request).choice).toBeNull();
    const capped=fixture();capped.config.budget={...capped.config.budget,mode:'provider-enforced',maxMicroUsd:10000};
    expect(routeModel(capped.config,[capped.probe],capped.journal,request).rejected.economical.join(' ')).toContain('cannot enforce');
  });
  it('rejects settings/binary drift and reports unknown usage honestly',()=>{
    const {config,probe,journal}=fixture();config.targets[0].settings={mode:'changed'};probe.executableHash='b'.repeat(64);
    const request={role:'implementer' as const,profile:'execution' as const,estimatedInputTokens:100,reservedOutputTokens:100,requireWrites:true,authors:[],now:10};
    expect(routeModel(config,[probe],journal,request).choice).toBeNull();
    const unknown=fixture();unknown.config.budget.allowUnavailableUsage=false;unknown.journal.unavailableUsageJobs=['unmetered-job'];
    expect(routeModel(unknown.config,[unknown.probe],unknown.journal,request).rejected.economical.join(' ')).toContain('Unavailable prior usage');
  });
});
