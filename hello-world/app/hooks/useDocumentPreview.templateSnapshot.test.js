// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import { useDocumentPreview } from "./useDocumentPreview";
import { createDocumentDownloaders } from "../../lib/document/docx";
import { triggerBlobDownload } from "../../lib/document/download";
vi.mock("../../lib/document/download",()=>({triggerBlobDownload:vi.fn()}));
import { templateRunPatch, templateOutcomePatch } from "../../lib/document/generatedTemplateStore";
import { persistGeneratedDocuments } from "../../lib/supabase/persistGeneration";
vi.mock("../../lib/supabase/client",()=>({createClient:()=>globalThis.__revisionTemplateClient}));
vi.mock("../../lib/document/documentVersionLoad",()=>({resolvePositionId:async()=>"position",fetchVersionScopes:async(_,scopes)=>scopes.map(scope=>globalThis.__n97VersionRows?.[scope] || [])}));
vi.mock("../../lib/supabase/persistGeneration",()=>({persistGeneratedDocuments:vi.fn(async()=>({resumeId:"new-version"}))}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;let api,root,el;
const ID="11111111-1111-4111-8111-111111111111";
function Probe({entry}){const[map,setMap]=useState({job:entry});api=useDocumentPreview({tailoringMap:map,setTailoringMap:setMap,updateTailoringJob:(id,patch)=>setMap(m=>({...m,[id]:typeof patch==="function"?patch(m[id]):{...m[id],...patch}})),resumeFile:null,coverLetterFile:null,additionalContext:"",aggressiveness:3,contextFiles:[],downloadDocxFiles:createDocumentDownloaders({resumeFile:null,coverLetterFile:null,tailoringMap:map,applicationData:[]}).downloadDocxFiles,startBackgroundResearch:()=>{},setPreviewReloadKey:()=>{},currentUser:{id:"owner"}});return null;}
afterEach(async()=>{if(root)await act(async()=>root.unmount());el?.remove();vi.unstubAllGlobals();vi.clearAllMocks();delete globalThis.__n97VersionRows;});
async function fixture(){const zip=new JSZip();zip.file("[Content_Types].xml","<Types/>");zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ORIGINAL</w:t></w:r></w:p></w:body></w:document>');return new File([await zip.generateAsync({type:"uint8array"})],"original.docx");}
async function mount(entry,file){globalThis.__revisionTemplateClient={auth:{getUser:async()=>({data:{user:{id:"owner"}}})},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:ID}})};return q;},storage:{from:()=>({download:async()=>({data:file})})}};vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({engine:"gemini",result:"NEW TEXT",resultLines:["NEW TEXT"],coverLetterResultLines:[]})})));el=document.createElement("div");document.body.append(el);root=createRoot(el);await act(async()=>root.render(createElement(Probe,{entry})));await act(async()=>api.openResumePreview({id:"job",title:"Engineer",description:"Posting"}));}
it("reloaded original permits revise with no current upload and sends/persists the same original",async()=>{const original=await fixture();await mount({result:"OLD",resultLines:["OLD"],resumeTemplateVersionId:ID},original);let ok;await act(async()=>{ok=await api.resubmitDocumentPreview("resume","improve");});expect(ok).toBe(true);const sent=fetch.mock.calls.find(([url])=>url==="/api/tailor")[1].body.get("resume");expect(await sent.arrayBuffer()).toEqual(await original.arrayBuffer());expect(await persistGeneratedDocuments.mock.calls[0][1].resume.sourceTemplateFile.arrayBuffer()).toEqual(await original.arrayBuffer());});
it("failed snapshot still permits same-run revise but reload without the binding refuses",async()=>{const original=await fixture(),run=templateRunPatch({engine:"gemini",resumeFile:original,applyCover:false});const entry={result:"OLD",resultLines:["OLD"],...run,...templateOutcomePatch(run,run,{resumeId:ID,templatePersistence:{resume:{ok:false}}})};await mount(entry,null);let ok;await act(async()=>{ok=await api.resubmitDocumentPreview("resume","improve");});expect(ok).toBe(true);});
it("missing historical original refuses before provider request",async()=>{await mount({result:"OLD",resultLines:["OLD"],resumeTemplateVersionId:ID},null);await act(async()=>{expect(await api.resubmitDocumentPreview("resume","improve")).toBe(false);});expect(fetch).not.toHaveBeenCalled();expect(persistGeneratedDocuments).not.toHaveBeenCalled();});

it("actual version selection passes its own original to the public download byte path",async()=>{
 const older=ID,latest="22222222-2222-4222-8222-222222222222";globalThis.__n97VersionRows={resume:[{id:latest,content:"LATEST",content_lines:["LATEST"]},{id:older,content:"CHOSEN OLD",content_lines:["CHOSEN OLD"]}]};await mount({result:"LATEST",resultLines:["LATEST"],resumeTemplateVersionId:latest},await fixture());
 await act(async()=>{await api.selectDocumentVersion("resume",older);});await act(async()=>{await api.downloadDocumentPreview("resume",{text:"CHOSEN OLD",lines:["CHOSEN OLD"]});});
 expect(triggerBlobDownload).toHaveBeenCalledTimes(1);const blob=triggerBlobDownload.mock.calls[0][0];const xml=await(await JSZip.loadAsync(await blob.arrayBuffer())).file("word/document.xml").async("string");expect(xml).toContain("CHOSEN OLD");expect(xml).not.toContain("LATEST");expect(xml).not.toContain("ORIGINAL");
});
it("same-scope revise cannot admit a second run while first persistence is pending",async()=>{
 await mount({result:"OLD",resultLines:["OLD"],resumeTemplateVersionId:ID},await fixture());let release,entered;const pending=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{entered=resolve;});persistGeneratedDocuments.mockImplementationOnce(async()=>{entered();await pending;return {};});let first;await act(async()=>{first=api.resubmitDocumentPreview("resume","first");await ready;});let second;await act(async()=>{second=await api.resubmitDocumentPreview("resume","second");});expect(second).toBe(false);expect(fetch.mock.calls.filter(([url])=>url==="/api/tailor")).toHaveLength(1);await act(async()=>{release();await first;});
});


it("Gemini then native regeneration and stored selection captures and revises the faithful native version",async()=>{
 const latest="22222222-2222-4222-8222-222222222222",path="owner/generated/native.docx";await mount({engine:"gemini",result:"CURRENT TEXT",resultLines:["CURRENT TEXT"],resumeTemplateVersionId:ID},await fixture());let nativeBytes;
 const client=globalThis.__revisionTemplateClient;client.from=()=>{const filters={};const q={select:()=>q,update:()=>q,eq:(k,v)=>{filters[k]=v;return q;},maybeSingle:async()=>({data:filters.id===latest?{id:latest,docx_path:path}:{id:ID}})};return q;};client.storage.from=()=>({download:async key=>({data:key===path?new Blob([nativeBytes]):null})});
 persistGeneratedDocuments.mockImplementationOnce(async(_,payload)=>{nativeBytes=Uint8Array.from(atob(payload.resume.docxB64),c=>c.charCodeAt(0));globalThis.__n97VersionRows={resume:[{id:latest,content:"CURRENT TEXT",content_lines:["CURRENT TEXT"],docx_path:path}]};return {resumeId:latest};});
 const template=await fixture();let regenerated;await act(async()=>{regenerated=await api.regenerateActiveIntoTemplate("resume",template);});expect(regenerated.ok).toBe(true);await act(async()=>{await api.selectDocumentVersion("resume",latest);});
 fetch.mockImplementation(async url=>url==="/api/templates/default"?{ok:true,json:async()=>({})}:{ok:true,json:async()=>({engine:"gemini",result:"REVISED",resultLines:["REVISED"]})});
 await act(async()=>{await api.setDefaultTemplateFromPreview("resume",{});});const promotion=fetch.mock.calls.find(([url])=>url==="/api/templates/default");expect(promotion).toBeTruthy();expect(new Uint8Array(await promotion[1].body.get("file").arrayBuffer())).toEqual(nativeBytes);
 let revised;await act(async()=>{revised=await api.resubmitDocumentPreview("resume","revise native");});expect(revised).toBe(true);const sent=fetch.mock.calls.find(([url])=>url==="/api/tailor")[1].body.get("resume");expect(new Uint8Array(await sent.arrayBuffer())).toEqual(nativeBytes);
});
