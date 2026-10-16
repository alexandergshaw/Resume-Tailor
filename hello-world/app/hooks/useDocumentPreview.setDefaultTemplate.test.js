// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import { useDocumentPreview } from "./useDocumentPreview";
import { resolveDocumentBlob } from "../../lib/document/docx";
vi.mock("../../lib/supabase/client",()=>({createClient:()=>({})}));
vi.mock("../../lib/document/docx", async(importOriginal)=>({ ...await importOriginal(), resolveDocumentBlob: vi.fn() }));
vi.mock("../../lib/document/defaultTemplateClient",()=>({resolveDefaultTemplateFile:vi.fn(async()=>null),promoteDefaultTemplateBlob:vi.fn(async(blob)=>blob?{error:"",notice:"Set"}:{error:"Missing original",notice:""})}));
import { promoteDefaultTemplateBlob } from "../../lib/document/defaultTemplateClient";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;let api,root,el;
function Probe(){const [map,setMap]=useState({job:{engine:"external",docxB64:"c2VydmVy",result:"CURRENT",resultLines:["CURRENT"]}});api=useDocumentPreview({tailoringMap:map,setTailoringMap:setMap,updateTailoringJob:()=>{},resumeFile:null,coverLetterFile:null,additionalContext:"",aggressiveness:3,contextFiles:[],downloadDocxFiles:async()=>null,startBackgroundResearch:()=>{},setPreviewReloadKey:()=>{},currentUser:null});return null;}
beforeEach(async()=>{vi.clearAllMocks();el=document.createElement("div");document.body.append(el);root=createRoot(el);await act(async()=>{root.render(createElement(Probe));});await act(async()=>{api.openResumePreview({id:"job",title:"Title"});});});afterEach(async()=>{await act(async()=>root.unmount());el.remove();});
it("real handler passes current scope/entry and captured original to promotion",async()=>{const original=new Blob(["original"]);resolveDocumentBlob.mockResolvedValue(original);await act(async()=>{await api.setDefaultTemplateFromPreview("resume","NEW DRAFT");});expect(resolveDocumentBlob).toHaveBeenCalledWith(expect.objectContaining({engineDocxB64:"c2VydmVy",text:"NEW DRAFT"}));expect(promoteDefaultTemplateBlob).toHaveBeenCalledWith(original,"resume");expect(api.resumePreview.notice.resume).toBe("Set");expect(api.resumePreview.busy.resume).toBe(false);});
it("capture rejection becomes visible error; email never captures",async()=>{resolveDocumentBlob.mockRejectedValue(Error("corrupt"));await act(async()=>{await api.setDefaultTemplateFromPreview("resume","x");await api.setDefaultTemplateFromPreview("email","x");});expect(promoteDefaultTemplateBlob).not.toHaveBeenCalled();expect(resolveDocumentBlob).toHaveBeenCalledTimes(1);expect(api.resumePreview.error.resume).toMatch(/capture/);expect(api.resumePreview.busy.resume).toBe(false);});
it("missing original refuses with no success notice",async()=>{resolveDocumentBlob.mockResolvedValue(null);await act(async()=>{await api.setDefaultTemplateFromPreview("resume","x");});expect(api.resumePreview.error.resume).toBe("Missing original");expect(api.resumePreview.notice.resume).toBe("");});
