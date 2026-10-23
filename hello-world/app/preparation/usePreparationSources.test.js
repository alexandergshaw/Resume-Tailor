// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, useEffect, act } from "react";
import { createRoot } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { flushSync } from "react-dom";
Object.defineProperty(globalThis,"crypto",{configurable:true,value:webcrypto});
import { usePreparationSources } from "./usePreparationSources";
const external=vi.hoisted(()=>({docs:vi.fn()}));
vi.mock("@/lib/copilot/applicationDocsClient",()=>({loadApplicationDocs:external.docs}));
vi.mock("@/app/settings/engine",()=>({readEngine:()=>"embedded"}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,host,api,request;
const response=(data,ok=true)=>({ok,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function Harness({posting,revision=0,manualInputs,strength,supplements}) { const value=usePreparationSources(posting,revision,manualInputs,strength,supplements); useEffect(()=>{api=value;}); return createElement("div",null,JSON.stringify({pack:value.pack,docs:value.docs,research:value.researchResult,context:value.candidateContext})); }
async function mount(posting={id:"A",company:"Cedar Transit Tools",title:"Platform engineer",url:"https://example.org/job"},revision=0) { await act(async()=>{root.render(createElement(Harness,{posting,revision}));}); }
beforeEach(()=>{host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);external.docs.mockReset().mockResolvedValue({resume:"SUBMITTED RESUME",coverLetter:"SUBMITTED COVER"});request=vi.fn().mockResolvedValue(response({status:"absent",completeSections:[]}));vi.stubGlobal("fetch",request);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("N176 actual source composition",()=>{
  it("loads owned material without implicit paid generation or research; explicit action is positive canary",async()=>{
    await mount(); expect(external.docs).toHaveBeenCalledWith("A"); expect(api.docs.resume).toBe("SUBMITTED RESUME");
    expect(request.mock.calls.every(([url,options])=>(String(url).startsWith("/api/interview-prep?")||String(url).startsWith("/api/interview-preparation?"))&&!options?.method)).toBe(true);
    expect(api.pack.status).toBe("absent");
    request.mockImplementation(async(url,options)=>String(url)==="/api/company-research"?response({articles:[{title:"Pilot",summary:"pilot in two cities",url:"https://example.org/pilot",date:"2026-09-01"}]}):response({status:"absent"}));
    await act(async()=>api.research());
    const researchCall=request.mock.calls.find(([url])=>url==="/api/company-research"); expect(researchCall).toBeTruthy();
    const body=JSON.parse(researchCall[1].body); expect(body.company).toBe("Cedar Transit Tools"); expect(body.engine).toBe("embedded"); expect(body).not.toHaveProperty("url");
    expect(api.researchResult.articles[0].summary).toContain("pilot in two cities");
  });
  it.each(["ready","partial","absent","running","failed","unavailable"])("preserves authoritative %s prep status and complete sections",async(status)=>{
    request.mockResolvedValue(response({status,pack:{sentinel:"existing pack"},completeSections:["company"]})); await mount();
    expect(api.pack.status).toBe(status); expect(api.pack.completeSections).toEqual(["company"]); expect(api.pack.pack.sentinel).toBe("existing pack");
  });
  it("distinguishes failed documents and prep from missing and provides successful retry",async()=>{
    external.docs.mockRejectedValueOnce(new Error("submitted document unavailable")); request.mockResolvedValueOnce(response({error:"prep read unavailable"},false)); await mount();
    expect(api.docs.status).toBe("error"); expect(api.docs.error).toContain("submitted document unavailable"); expect(api.pack.status).toBe("error"); expect(api.pack.error).toContain("prep read unavailable");
    await act(async()=>{api.docs.retry();await api.loadPack();}); expect(api.docs.status).toBe("done"); expect(api.docs.resume).toBe("SUBMITTED RESUME"); expect(api.pack.status).toBe("absent");
  });
  it("all fresh generation entry points obey context and review gates",async()=>{
    await mount();const before=request.mock.calls.length;const first=await api.generatePrep(),second=await api.generatePrep();expect(first.status).toBe("unavailable");expect(first.error).toMatch(/context|strength|legacy/i);expect(second.status).toBe("unavailable");expect(request.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(0);expect(request.mock.calls.length).toBe(before);
  });  it("fences a late A load after switching to B, while the positive B result stays visible",async()=>{
    const pending=deferred();request.mockImplementation(url=>String(url).includes("applicationId=A")?pending.promise:Promise.resolve(response({status:"ready",pack:{sentinel:"B CURRENT"},completeSections:["company"]})));
    await mount();await mount({id:"B",company:"Birch Tools"});expect(api.pack.pack.sentinel).toBe("B CURRENT");
    await act(async()=>pending.resolve(response({status:"ready",pack:{sentinel:"A PRIVATE"},completeSections:["role"]})));
    expect(host.textContent).not.toContain("A PRIVATE");expect(api.pack.pack.sentinel).toBe("B CURRENT");
  });
  it("marks captured research stale when inputs change and ignores previous posting material",async()=>{
    await mount();const pending=deferred();request.mockImplementation(url=>url==="/api/company-research"?pending.promise:Promise.resolve(response({status:"absent"})));
    await act(async()=>api.research()); await mount({id:"A",company:"Cedar Transit Tools"},1);
    await act(async()=>pending.resolve(response({articles:[{title:"Old input pilot",summary:"OLD CAPTURED MATERIAL",url:"https://example.org/old"}]})));
    expect(api.researchResult.stale).toBe(true); expect(api.researchResult.revision).toBe(0);
    await mount({id:"B",company:"Birch Tools"},1); expect(api.researchResult).toBeNull();expect(host.textContent).not.toContain("OLD CAPTURED MATERIAL");
  });
  it("surfaces explicit research failure and can recover without an automatic retry",async()=>{
    await mount();request.mockImplementation(url=>url==="/api/company-research"?Promise.reject(new Error("research offline")):Promise.resolve(response({status:"absent"})));
    await act(async()=>api.research());expect(api.brief.status).toBe("error");expect(api.brief.error).toContain("research offline");
    const count=request.mock.calls.filter(([url])=>url==="/api/company-research").length;await mount();expect(request.mock.calls.filter(([url])=>url==="/api/company-research")).toHaveLength(count);
    request.mockImplementation(url=>Promise.resolve(url==="/api/company-research"?response({articles:[{title:"Recovered",summary:"CURRENT RECOVERED FACT",url:"https://example.org/recovered"}]}):response({status:"absent"})));
    await act(async()=>api.research());expect(api.brief.status).toBe("done");expect(api.researchResult.articles[0].summary).toBe("CURRENT RECOVERED FACT");
  });
});

describe("N176 source request ownership after interruption",()=>{
  it("keeps current historical pack visible while unbound legacy generation remains unavailable",async()=>{
    request.mockImplementation(url=>Promise.resolve(response({status:"ready",pack:{sentinel:String(url).includes("applicationId=B")?"B CURRENT":"A OLD"},completeSections:["company"]})));await mount();expect((await api.generatePrep()).status).toBe("unavailable");await mount({id:"B",company:"Birch Tools"});expect(api.pack.pack.sentinel).toBe("B CURRENT");expect((await api.generatePrep()).status).toBe("unavailable");expect(api.pack.pack.sentinel).toBe("B CURRENT");expect(request.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(0);
  });  it("deduplicates research calls issued before a rerender",async()=>{
    await mount();const pending=deferred();request.mockImplementation(url=>url==="/api/company-research"?pending.promise:Promise.resolve(response({status:"absent"})));
    await act(async()=>{api.research();api.research();});expect(request.mock.calls.filter(([url])=>url==="/api/company-research")).toHaveLength(1);
    await act(async()=>pending.resolve(response({articles:[]})));expect(api.brief.status).toBe("done");
  });
});

describe("N176 real paired-source context adoption",()=>{
 const input={accountId:"A",jobTitle:"Engineer",company:"Cedar",description:"Plan SQL migration rollback.",resume:"I wrote the rollback checklist.",coverLetter:"I supported the migration lead."};
 const strength={aggressiveness:3,tailorMode:""};
 async function contextMount(props){await act(async()=>root.render(createElement(Harness,{posting:null,manualInputs:input,strength,...props})));}
 it("one coherent selected pair never adopts cross-account or mixed-version material",async()=>{
  await contextMount();expect(api.candidateContext).toBeNull();await act(async()=>api.useManualDocuments());await vi.waitFor(()=>expect(api.candidateContext?.resume.text).toBe(input.resume));const original=api.candidateContext.id;expect(api.candidateContext.cover.text).toBe(input.coverLetter);expect(api.candidateContext.sourceMode).toBe("manual");
  const changed={...input,accountId:"B",coverLetter:"I want to improve accessible transport."};await act(async()=>{flushSync(()=>root.render(createElement(Harness,{posting:null,manualInputs:changed,strength})));expect(host.textContent).not.toContain(input.coverLetter);});await vi.waitFor(()=>expect(api.candidateContext?.accountId).toBe("B"));expect(api.candidateContext.id).not.toBe(original);expect(api.candidateContext.cover.text).toContain("accessible transport");expect(request.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(0);
 });
 it("every personal artifact becomes stale on source strength or supplement change",async()=>{
  await contextMount();await act(async()=>api.useManualDocuments());await vi.waitFor(()=>expect(api.candidateContext).toBeTruthy());const original=api.candidateContext.id;
  await contextMount({strength:{aggressiveness:5,tailorMode:""}});await vi.waitFor(()=>expect(api.candidateContext?.requestedStrength.aggressiveness).toBe(5));expect(api.candidateContext.id).not.toBe(original);expect(api.candidateContext.historicalStrength).toEqual({resume:null,cover:null});
  const strong=api.candidateContext.id;await contextMount({strength:{aggressiveness:5,tailorMode:"ideal"}});await vi.waitFor(()=>expect(api.candidateContext?.requestedStrength.tailorMode).toBe("ideal"));expect(api.candidateContext.requestedStrength.aggressiveness).toBe(5);expect(api.candidateContext.id).not.toBe(strong);
 });
 it("does not silently replace a missing owned pair with manual text",async()=>{
  request.mockResolvedValue({ok:false,json:async()=>({status:"error",error:"owned pair lookup unavailable"})});await contextMount({posting:{id:"OWNED",company:"Cedar"}});await vi.waitFor(()=>expect(api.contextError).toContain("owned pair lookup unavailable"));await act(async()=>api.useManualDocuments());expect(api.candidateContext).toBeNull();expect(api.contextError).toContain("owned pair lookup unavailable");
 });
});
