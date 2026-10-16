import { object, keys } from './json';
import { validateWorkerOutcome } from './routing-validation';
import type { IdentityObservation, NormalizeFunction, NormalizedUsage } from './dispatch-types';

const number=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
function sumReportedTokens(models:unknown,key:string):number|null{
  if(!models||typeof models!=='object'||Array.isArray(models))return null;
  const entries=Object.values(models);if(!entries.length)return null;let total=0;
  for(const entry of entries){if(!entry||typeof entry!=='object')return null;const tokens=(entry as Record<string,unknown>).tokens;if(!tokens||typeof tokens!=='object')return null;const value=number((tokens as Record<string,unknown>)[key]);if(value===null)return null;total+=value;}
  return Number.isSafeInteger(total)?total:null;
}
function outcome(value:unknown){
  const record=object(value,'provider outcome');
  if(Object.hasOwn(record,'outcomeJson')){keys(record,['outcomeJson'],'provider outcome envelope');if(typeof record.outcomeJson!=='string')throw new Error('outcomeJson must be string');return validateWorkerOutcome(JSON.parse(record.outcomeJson));}
  return validateWorkerOutcome(record);
}
function transportIdentity(value:unknown):IdentityObservation{
  const r=object(value,'transport identity');keys(r,['provider','model','settings','session','source'],'transport identity');
  for(const key of ['provider','model','session'])if(r[key]!==null&&typeof r[key]!=='string')throw new Error('Transport identity strings required');
  if(!['provider-output','unavailable'].includes(String(r.source)))throw new Error('Unknown identity observation source');
  if(r.settings!==null){const settings=object(r.settings,'observed settings');if(Object.keys(settings).some(key=>['__proto__','constructor','prototype'].includes(key))||Object.values(settings).some(v=>typeof v!=='string'))throw new Error('Invalid observed settings');}
  return r as IdentityObservation;
}
function transportUsage(value:unknown):NormalizedUsage{
  const r=object(value,'transport usage');keys(r,['source','inputTokens','outputTokens','costMicroUsd'],'transport usage');
  if(!['observed','unavailable'].includes(String(r.source))||['inputTokens','outputTokens','costMicroUsd'].some(key=>r[key]!==null&&number(r[key])===null))throw new Error('Invalid transport usage');
  if(r.source==='unavailable'&&[r.inputTokens,r.outputTokens,r.costMicroUsd].some(v=>v!==null))throw new Error('Unavailable usage cannot report zero or measured counters');
  return r as NormalizedUsage;
}
export const normalizeResult:NormalizeFunction=(provider,captured,resultBytes)=>{
  let observed:IdentityObservation={provider:null,model:null,settings:null,session:null,source:'unavailable'};
  let usage:NormalizedUsage={source:'unavailable',inputTokens:null,outputTokens:null,costMicroUsd:null};
  const limitations:string[]=['Provider identity/settings are recorded only when reported by transport'];const errors:string[]=[];
  if(!captured.terminated)errors.push('Process termination uncertain');
  if(captured.exitCode!==0)errors.push('Provider process failed or did not return an exit status');
  try{
    let body:unknown;
    if(provider.kind==='command'){
      const record=object(JSON.parse(resultBytes??captured.stdout),'command result');
      if(Object.hasOwn(record,'outcome')){keys(record,['outcome','observed','usage','limitations'],'command transport envelope');body=record.outcome;if(record.observed!==undefined)observed=transportIdentity(record.observed);if(record.usage!==undefined)usage=transportUsage(record.usage);if(record.limitations!==undefined){if(!Array.isArray(record.limitations)||record.limitations.some(v=>typeof v!=='string'))throw new Error('Invalid transport limitations');limitations.push(...record.limitations);}}
      else body=record;
    }else if(provider.kind==='codex'){
      if(resultBytes===null)throw new Error('Codex final response file missing');body=JSON.parse(resultBytes);
      const events=captured.stdout.split(/\r?\n/).filter(line=>line.trim()).map(line=>object(JSON.parse(line),'Codex event'));
      const start=events.find(e=>e.type==='thread.started');const terminal=events.findLast(e=>e.type==='turn.completed');
      const model=events.findLast(e=>typeof e.model==='string')?.model;
      if(start||model)observed={provider:null,model:typeof model==='string'?model:null,settings:null,session:typeof start?.thread_id==='string'?start.thread_id:null,source:'provider-output'};
      if(terminal?.usage){const u=object(terminal.usage,'Codex usage');usage={source:'observed',inputTokens:number(u.input_tokens),outputTokens:number(u.output_tokens),costMicroUsd:null};}
      if(events.some(e=>e.type==='turn.failed'||e.type==='error'))errors.push('Codex transport reported a failed turn');
    }else{
      const record=object(JSON.parse(captured.stdout),'native response');
      if(record.error||record.is_error)errors.push('Native transport reported failure');
      body=provider.kind==='claude'?(record.structured_output??(typeof record.result==='string'?JSON.parse(record.result):record.result)):(typeof record.response==='string'?JSON.parse(record.response):record.response);
      const stats=record.stats&&typeof record.stats==='object'?record.stats as Record<string,unknown>:{};
      const models=provider.kind==='claude'?record.modelUsage:stats.models;
      const modelKeys=models&&typeof models==='object'?Object.keys(models):[];
      observed={provider:null,model:typeof record.model==='string'?record.model:modelKeys.length===1?modelKeys[0]:null,settings:null,session:typeof record.session_id==='string'?record.session_id:null,source:'provider-output'};
      const u=record.usage&&typeof record.usage==='object'?record.usage as Record<string,unknown>:{};
      const dollar=record.total_cost_usd;
      usage={source:record.usage||typeof dollar==='number'?'observed':'unavailable',inputTokens:number(u.input_tokens),outputTokens:number(u.output_tokens),costMicroUsd:typeof dollar==='number'&&Number.isFinite(dollar)&&dollar>=0?Math.ceil(dollar*1_000_000):null};
      if(provider.kind==='gemini'){
        // Official telemetry ModelMetrics reports prompt/candidates separately from cached/thoughts/tool.
        const input=sumReportedTokens(models,'prompt'),output=sumReportedTokens(models,'candidates');
        usage={source:input!==null||output!==null?'observed':'unavailable',inputTokens:input,outputTokens:output,costMicroUsd:null};
        limitations.push('Gemini usage reports prompt and candidate counts; cached/thought/tool counts are not converted into monetary cost');
        const tools=stats.tools&&typeof stats.tools==='object'?stats.tools as Record<string,unknown>:{};
        if(typeof tools.totalFail==='number'&&tools.totalFail>0)errors.push('Gemini transport reported failed tool execution');
      }
      if(modelKeys.length>1)limitations.push('Transport reports multiple model identities; no single model observation established');
    }
    const normalized=outcome(body);
    return{outcome:errors.length?null:normalized,observed,usage,limitations,errors};
  }catch(error){errors.push(error instanceof Error?error.message:'Malformed structured provider response');return{outcome:null,observed,usage,limitations,errors};}
};
