// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useManualTailor } from "./useManualTailor";
import { persistGeneratedDocuments } from "../../lib/supabase/persistGeneration";
vi.mock("../../lib/document/docx",()=>({buildTemplateLinesForUpload:async()=>["source"]}));
vi.mock("../../lib/supabase/client",()=>({createClient:()=>({})}));
vi.mock("../../lib/supabase/upsertPosition",()=>({upsertPosition:async()=>"position"}));
vi.mock("../../lib/supabase/upsertApplication",()=>({upsertApplication:async()=>"application"}));
vi.mock("../../lib/supabase/persistGeneration",()=>({persistGeneratedDocuments:vi.fn()}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,el,api;
function Probe(props){api=useManualTailor(props);return null;}
afterEach(async()=>{if(root)await act(async()=>root.unmount());el?.remove();vi.unstubAllGlobals();vi.clearAllMocks();});
it("manual Gemini preserves exact scope originals and associates the returned versions",async()=>{
 const resume=new File(["resume original"],"resume.docx"),cover=new File(["cover original"],"cover.docx");let entry={};
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({engine:"gemini",result:"CURRENT",resultLines:["CURRENT"],coverLetterResult:"COVER",coverLetterResultLines:["COVER"],jobTitle:"Engineer",company:"Company"})})));
 persistGeneratedDocuments.mockImplementation(async(_,args)=>{args.onTemplatePersisted({resumeId:"r-id",coverLetterId:"c-id",templatePersistence:{resume:{ok:true},cover:{ok:true}}});return {};});
 el=document.createElement("div");document.body.append(el);root=createRoot(el);
 await act(async()=>root.render(createElement(Probe,{resumeFile:resume,coverLetterFile:cover,contextFiles:[],additionalContext:"",aggressiveness:3,tailorEngine:"gemini",currentUser:{id:"owner"},setTrackedJobs:()=>{},updateTailoringJob:(_,patch)=>{entry=typeof patch==="function"?patch(entry):{...entry,...patch};},maybeOfferLibraryUpdate:()=>{},withClearedEditedScopes:()=>({}),finishByOpeningPreview:()=>{}})));
 await act(async()=>{expect((await api.tailorPosting(null,{overridePosting:"Posting",openPreview:false})).ok).toBe(true);});
 const args=persistGeneratedDocuments.mock.calls[0][1];expect(args.resume.sourceTemplateFile).toBe(resume);expect(args.coverLetter.sourceTemplateFile).toBe(cover);expect(entry.resumeTemplateVersionId).toBe("r-id");expect(entry.coverTemplateVersionId).toBe("c-id");expect(entry.resumeTemplateSource.file).toBe(resume);
});
it("older manual persistence failure cannot replace a newer run's original/version/notice",async()=>{
 const a=new File(["A original"],"a.docx"),b=new File(["B original"],"b.docx");let entry={},pending=[],notify;
 const props=file=>({resumeFile:file,coverLetterFile:null,contextFiles:[],additionalContext:"",aggressiveness:3,tailorEngine:"gemini",currentUser:{id:"owner"},setTrackedJobs:()=>{},updateTailoringJob:(_,patch)=>{entry=typeof patch==="function"?patch(entry):{...entry,...patch};},maybeOfferLibraryUpdate:()=>{},withClearedEditedScopes:()=>({}),finishByOpeningPreview:()=>{}});
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({engine:"gemini",result:"CURRENT",resultLines:["CURRENT"],coverLetterResultLines:[],jobTitle:"Engineer",company:"Company"})})));
 persistGeneratedDocuments.mockImplementation((_,args)=>new Promise(resolve=>{pending.push({args,resolve});notify?.();}));
 el=document.createElement("div");document.body.append(el);root=createRoot(el);await act(async()=>root.render(createElement(Probe,props(a))));let first,second;
 let admitted=new Promise(resolve=>{notify=resolve;});await act(async()=>{first=api.tailorPosting(null,{overridePosting:"First",syntheticJobId:"same",openPreview:false});await admitted;});
 await act(async()=>root.render(createElement(Probe,props(b))));admitted=new Promise(resolve=>{notify=resolve;});await act(async()=>{second=api.tailorPosting(null,{overridePosting:"Second",syntheticJobId:"same",openPreview:false});await admitted;});
 await act(async()=>{pending[1].args.onTemplatePersisted({resumeId:"newer",templatePersistence:{resume:{ok:true}}});pending[1].resolve({resumeId:"newer"});await second;});
 await act(async()=>{pending[0].args.onTemplatePersisted({resumeId:"older",templatePersistence:{resume:{ok:false}}});pending[0].resolve({resumeId:"older"});await first;});
 expect(entry.resumeTemplateVersionId).toBe("newer");expect(entry.resumeTemplateSource.file).toBe(b);expect(entry.resumeTemplatePersistenceError).toBe("");
});
