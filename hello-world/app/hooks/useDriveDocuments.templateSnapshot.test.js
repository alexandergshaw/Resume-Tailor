// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createHash, randomUUID } from "node:crypto";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { computeCurrentHash, useDriveDocuments } from "./useDriveDocuments";
import { buildPreviewBlob } from "../../lib/document/previewBlob";
import { templateRunPatch } from "../../lib/document/generatedTemplateStore";
vi.mock("../../lib/supabase/client",()=>({createClient:()=>globalThis.__driveTemplateClient}));
const IDS=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
let originals,forbidden;
beforeEach(()=>{vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async (_, bytes) => Uint8Array.from(createHash("sha256").update(Buffer.from(new Uint8Array(bytes))).digest()).buffer } }); originals=new Map();forbidden=false;globalThis.__driveTemplateClient={auth:{getUser:async()=>({data:{user:{id:"owner"}}})},from:()=>{const filters={};const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},maybeSingle:async()=>({data:!forbidden&&filters.user_id==="owner"?{id:filters.id}:null})};return q;},storage:{from:()=>({download:async path=>({data:originals.get(path)})})}};});
async function file(font){const z=new JSZip();z.file("[Content_Types].xml","<Types/>");z.file("word/document.xml",`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="${font}"/></w:rPr><w:t>ORIGINAL</w:t></w:r></w:p></w:body></w:document>`);return new File([await z.generateAsync({type:"uint8array"})],"original.docx");}
async function xml(blob){return(await JSZip.loadAsync(await blob.arrayBuffer())).file("word/document.xml").async("string");}
const entry=id=>({result:"SAME NEW CONTENT",resultLines:["SAME NEW CONTENT"],resumeTemplateVersionId:id});
it("same content, two immutable originals: hash AND actual SAVE builder output differ",async()=>{const a=await file("Arial"),b=await file("Courier New");originals.set(`owner/templates/generated/resume/${IDS[0]}.docx`,a);originals.set(`owner/templates/generated/resume/${IDS[1]}.docx`,b);const first=entry(IDS[0]),second=entry(IDS[1]);expect(await computeCurrentHash(first,"resume")).not.toBe(await computeCurrentHash(second,"resume"));const ax=await xml(await buildPreviewBlob(first,"resume")),bx=await xml(await buildPreviewBlob(second,"resume"));expect(ax).toContain("Arial");expect(bx).toContain("Courier New");expect(ax).toContain("SAME NEW CONTENT");expect(bx).toContain("SAME NEW CONTENT");});
it("unpersisted and partial-failure exact bindings hash File bytes, never random run tokens",async()=>{const a=await file("Arial"),b=await file("Courier New");const first={...entry(""),...templateRunPatch({engine:"gemini",resumeFile:a,applyCover:false})},same={...entry(""),...templateRunPatch({engine:"gemini",resumeFile:a,applyCover:false})},other={...entry(""),...templateRunPatch({engine:"gemini",resumeFile:b,applyCover:false})};expect(await computeCurrentHash(first,"resume")).toBe(await computeCurrentHash(same,"resume"));expect(await computeCurrentHash(first,"resume")).not.toBe(await computeCurrentHash(other,"resume"));expect(await xml(await buildPreviewBlob(other,"resume"))).toContain("Courier New");});
it("explicit original fences global upload; active override determines output and hash",async()=>{const a=await file("Arial"),b=await file("Courier New"),override=await file("Override");const first=entry(IDS[0]);expect(await computeCurrentHash(first,"resume",{resumeFile:a})).toBe(await computeCurrentHash(first,"resume",{resumeFile:b}));const second=entry(IDS[1]);expect(await computeCurrentHash(first,"resume",{resumeFile:a,formattingTemplate:override})).toBe(await computeCurrentHash(second,"resume",{resumeFile:b,formattingTemplate:override}));expect(await xml(await buildPreviewBlob(first,"resume",{formattingTemplate:override}))).toContain("Override");});
it("computable hash never permits missing or unauthorized snapshot output",async()=>{const first=entry(IDS[0]);expect(await computeCurrentHash(first,"resume")).toHaveLength(64);expect(await buildPreviewBlob(first,"resume",{resumeFile:await file("WRONG")})).toBeNull();forbidden=true;expect(await buildPreviewBlob(first,"resume")).toBeNull();});

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,element,hook;
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;element?.remove();vi.unstubAllGlobals();});
function Probe(props){hook=useDriveDocuments(props);return null;}
const props=(entry,user="owner")=>({currentUser:{id:user},tailoringMap:{job:entry},jobId:"job",jobTitle:"Engineer",company:"Company",activeScope:"resume",resumeFile:null,coverLetterFile:null});
async function render(entry,user){if(!root){element=document.createElement("div");document.body.append(element);root=createRoot(element);}await act(async()=>{root.render(createElement(Probe,props(entry,user)));});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});}
function json(data){return new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});}
async function docxResponse(original){return new Response(await original.arrayBuffer(),{headers:{"content-type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}});}
it("mounted cached A cannot mask promoted B on actual Drive SAVE, even when old A load finishes late",async()=>{
  const a=await file("Arial"),b=await file("Courier New");let current=a,reads=0,releaseOld;const old=new Promise(resolve=>{releaseOld=resolve;});const saves=[];
  vi.stubGlobal("fetch",vi.fn(async(url,init)=>{
    if(url.startsWith("/api/templates/default")){if(url.includes("kind=cover"))return new Response(null,{status:404});reads++;if(reads===1)return old;return docxResponse(current);}
    if(url.startsWith("/api/drive/status"))return json({connected:true,configured:true});
    if(url.startsWith("/api/drive/documents"))return json({documents:{}});
    if(url.startsWith("/api/drive/save")){saves.push(init.body);return json({fileId:"saved",name:"Saved",version:"v1"});}
    throw Error("unexpected "+url);
  }));
  await render({result:"OLD TEXT",resultLines:["OLD TEXT"]});current=b;const next={result:"NEW TEXT",resultLines:["NEW TEXT"]};await render(next);
  await act(async()=>{await hook.saveToDrive({activeScope:"resume",activeFileName:""});});expect(saves).toHaveLength(1);
  expect(await xml(saves[0].get("file"))).toContain("Courier New");expect(await xml(saves[0].get("file"))).toContain("NEW TEXT");
  const expected=await computeCurrentHash(next,"resume",{formattingTemplate:b});expect(JSON.parse(saves[0].get("meta")).contentHash).toBe(expected);
  await act(async()=>{releaseOld(await docxResponse(a));await new Promise(resolve=>setTimeout(resolve,20));});
  expect(hook.isStale).toBe(false);
  // Second activation must still use fresh B and its matching hash after delayed A resolves.
  await act(async()=>{await hook.saveToDrive({activeScope:"resume",activeFileName:""});});expect(JSON.parse(saves.at(-1).get("meta")).contentHash).toBe(expected);expect(await xml(saves.at(-1).get("file"))).toContain("Courier New");
});
it("unavailable fresh active template never saves cached formatting",async()=>{
 const a=await file("Arial");let fail=false,saves=0;
 vi.stubGlobal("fetch",vi.fn(async(url)=>{if(url.startsWith("/api/templates/default"))return url.includes("kind=cover")?new Response(null,{status:404}):fail?new Response(null,{status:401}):docxResponse(a);if(url.startsWith("/api/drive/status"))return json({connected:true,configured:true});if(url.startsWith("/api/drive/documents"))return json({documents:{}});if(url.startsWith("/api/drive/save")){saves++;return json({});}throw Error(url);}));
 await render({result:"NEW TEXT",resultLines:["NEW TEXT"]});fail=true;await act(async()=>{await hook.saveToDrive({activeScope:"resume",activeFileName:""});});expect(saves).toBe(0);
});

it("switching user during a fresh template read cancels the old Drive write and UI publication",async()=>{
 const a=await file("Arial");let reads=0,release,saves=0;const pending=new Promise(resolve=>{release=resolve;});
 vi.stubGlobal("fetch",vi.fn(async(url)=>{if(url.startsWith("/api/templates/default")){if(url.includes("kind=cover"))return new Response(null,{status:404});reads++;if(reads===2)return pending;return docxResponse(a);}if(url.startsWith("/api/drive/status"))return json({connected:true,configured:true});if(url.startsWith("/api/drive/documents"))return json({documents:{}});if(url.startsWith("/api/drive/save")){saves++;return json({});}throw Error(url);}));
 const next={result:"NEW TEXT",resultLines:["NEW TEXT"]};await render(next);let saving;await act(async()=>{saving=hook.saveToDrive({activeScope:"resume",activeFileName:""});await Promise.resolve();});await render(next,"another-user");await act(async()=>{release(await docxResponse(a));await saving;});expect(saves).toBe(0);expect(hook.rows).toEqual([]);expect(hook.connected).toBe(true);
});
it("a true absent default preserves native finished bytes and permits Drive SAVE",async()=>{
 const original=await file("NativeFont"),b64=btoa(String.fromCharCode(...new Uint8Array(await original.arrayBuffer())));let saved;
 vi.stubGlobal("fetch",vi.fn(async(url,init)=>{if(url.startsWith("/api/templates/default"))return new Response(null,{status:404});if(url.startsWith("/api/drive/status"))return json({connected:true,configured:true});if(url.startsWith("/api/drive/documents"))return json({documents:{}});if(url.startsWith("/api/drive/save")){saved=init.body;return json({fileId:"saved",name:"Saved",version:"v1"});}throw Error(url);}));
 await render({result:"CURRENT",resultLines:["CURRENT"],docxB64:b64});await act(async()=>{await hook.saveToDrive({activeScope:"resume",activeFileName:""});});expect(await saved.get("file").arrayBuffer()).toEqual(await original.arrayBuffer());
});
it("persisted partial snapshot hashes exact binding bytes and refuses mismatched identities",async()=>{
 const a=await file("Arial"),b=await file("Courier New");
 const bound=(f)=>{const run=templateRunPatch({engine:"gemini",resumeFile:f,applyCover:false});return {...entry(IDS[0]),...run,resumeTemplateVersionId:IDS[0],resumeTemplateSource:{...run.resumeTemplateSource,versionId:IDS[0]}};};
 const first=bound(a),second=bound(b);expect(await computeCurrentHash(first,"resume")).not.toBe(await computeCurrentHash(second,"resume"));expect(await xml(await buildPreviewBlob(first,"resume"))).toContain("Arial");expect(await xml(await buildPreviewBlob(second,"resume"))).toContain("Courier New");
 for(const patch of [{kind:"cover"},{versionId:IDS[1]}])expect(await buildPreviewBlob({...first,resumeTemplateSource:{...first.resumeTemplateSource,...patch}},"resume")).toBeNull();
});
it("user switch during blob/hash work is fenced immediately before Drive POST",async()=>{
 const a=await file("Arial");let saves=0,release,started;const held=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{started=resolve;});let block=false;
 const digest=crypto.subtle.digest;crypto.subtle.digest=async(algorithm,bytes)=>{if(block&&new Uint8Array(bytes).length>100){block=false;started();await held;}return digest(algorithm,bytes);};
 vi.stubGlobal("fetch",vi.fn(async(url)=>{if(url.startsWith("/api/templates/default"))return url.includes("kind=cover")?new Response(null,{status:404}):docxResponse(a);if(url.startsWith("/api/drive/status"))return json({connected:true,configured:true});if(url.startsWith("/api/drive/documents"))return json({documents:{}});if(url.startsWith("/api/drive/save")){saves++;return json({});}throw Error(url);}));
 const current={result:"CURRENT",resultLines:["CURRENT"]};await render(current);block=true;let saving;await act(async()=>{saving=hook.saveToDrive({activeScope:"resume",activeFileName:""});await entered;});await render(current,"another-user");await act(async()=>{release();await saving;});expect(saves).toBe(0);expect(hook.rows).toEqual([]);
});

it("active override ignores legacy global upload while null override keeps legacy sensitivity",async()=>{const a=await file("Arial"),c=await file("Courier New"),b=await file("OverrideFont"),legacy={result:"SAME",resultLines:["SAME"]};expect(await computeCurrentHash(legacy,"resume",{resumeFile:a,formattingTemplate:b})).toBe(await computeCurrentHash(legacy,"resume",{resumeFile:c,formattingTemplate:b}));expect(await xml(await buildPreviewBlob(legacy,"resume",{resumeFile:a,formattingTemplate:b}))).toContain("OverrideFont");expect(await computeCurrentHash(legacy,"resume",{resumeFile:a})).not.toBe(await computeCurrentHash(legacy,"resume",{resumeFile:c}));});
