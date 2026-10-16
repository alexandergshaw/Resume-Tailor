import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonical, digest } from './json';
import type { CapturedProcess, ProviderConfig, ProviderProbe } from './dispatch-types';
export const adapterVersion='agnostic-headless-v1';

export function providerEnvironment(provider:ProviderConfig):NodeJS.ProcessEnv{
  const environment:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV??'production'};
  for(const key of provider.environmentKeys){
    if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe provider environment key');
    if(Object.hasOwn(process.env,key)&&process.env[key]!==undefined)environment[key]=process.env[key];
  }
  return environment;
}
async function command(provider:ProviderConfig,args:string[]):Promise<CapturedProcess>{
  const started=Date.now();const env=providerEnvironment(provider);let stdout='',stderr='';let overflow=false;
  return new Promise(resolve=>{
    const child=spawn(provider.executable,[...provider.prefixArgs,...args],{env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let settled=false;const finish=(code:number|null,terminated:boolean)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cutoff);
      for(const secret of Object.values(env).filter((v):v is string=>typeof v==='string'&&v.length>0)){stdout=stdout.split(secret).join('[redacted]');stderr=stderr.split(secret).join('[redacted]');}
      resolve({exitCode:overflow?null:code,stdout,stderr,terminated,started,finished:Date.now()});
    };
    const collect=(value:Buffer,stream:'out'|'error')=>{if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)+value.length>Math.min(provider.maxOutputBytes,262144)){overflow=true;child.kill();return;}if(stream==='out')stdout+=value.toString('utf8');else stderr+=value.toString('utf8');};
    child.stdout.on('data',value=>collect(value,'out'));child.stderr.on('data',value=>collect(value,'error'));
    child.once('error',()=>finish(null,true));child.once('close',code=>finish(code,true));
    const delay=Math.min(provider.timeoutMs,5000);const timer=setTimeout(()=>child.kill(),delay);
    const cutoff=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.unref();finish(null,false);},delay+1000);
  });
}
export async function probeProvider(provider:ProviderConfig):Promise<ProviderProbe>{
  const unsupported={freshSession:false,structuredOutput:false,readFiles:false,writeFiles:false,observedModel:false,nativeCostCap:false};
  const result:ProviderProbe={schemaVersion:1,provider:provider.id,adapterVersion,executableHash:digest('unavailable'),cliVersion:null,availability:'unavailable',authentication:'unknown',capabilities:unsupported,checked:Date.now(),reasons:[]};
  if(!provider.enabled){result.reasons.push('Provider disabled; not probed');return result;}
  try{
    if(!path.isAbsolute(provider.executable)||/\.(cmd|bat)$/i.test(provider.executable))throw new Error('Provider requires an absolute directly executable host, not a shell launcher');
    const tooling:Record<string,string>={[provider.executable]:digest(await readFile(provider.executable))};
    for(const argument of provider.prefixArgs)if(path.isAbsolute(argument))tooling[argument]=digest(await readFile(argument));
    result.executableHash=digest(canonical(tooling));
    const version=await command(provider,['--version']);
    const help=await command(provider,provider.kind==='codex'?['exec','--help']:['--help']);
    if(version.exitCode!==0||help.exitCode!==0||!version.terminated||!help.terminated||!version.stdout.trim())throw new Error('Version/help probe failed or exceeded limits');
    result.cliVersion=version.stdout.trim().slice(0,512);
    const required=provider.kind==='codex'?['--ephemeral','--output-schema','--output-last-message','--ignore-user-config','--model']:provider.kind==='claude'?['--print','--output-format','--json-schema','--model']:provider.kind==='gemini'?['--prompt','--output-format','--model']:['agnostic-loop-worker-v1'];
    if(!required.every(flag=>help.stdout.includes(flag)))throw new Error('Installed CLI help lacks required fresh structured headless protocol flags');
    result.availability='available';result.capabilities={freshSession:true,structuredOutput:true,readFiles:true,writeFiles:true,observedModel:provider.kind!=='codex',nativeCostCap:provider.kind==='claude'&&help.stdout.includes('--max-budget-usd')};
    result.reasons.push('Installed/version protocol probe only; authentication, model access and live conformance remain unverified');
  }catch(error){result.reasons.push(error instanceof Error?error.message:'Provider probe unavailable');}
  return result;
}
