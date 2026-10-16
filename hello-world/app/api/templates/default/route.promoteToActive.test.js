// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("@/lib/document/defaultTemplateStore.js",()=>({saveDefaultTemplate:vi.fn(),getDefaultTemplate:vi.fn(),clearDefaultTemplate:vi.fn(),getDefaultTemplateBytes:vi.fn()}));
vi.mock("@/lib/document/templateSelectionStore.js",()=>({getActiveTemplateBytes:vi.fn(),setSelection:vi.fn()}));
import {createClient} from "@/lib/supabase/server";
import {saveDefaultTemplate} from "@/lib/document/defaultTemplateStore.js";
import {setSelection} from "@/lib/document/templateSelectionStore.js";
import {POST,GET} from "./route.js";
import JSZip from "jszip";
import {resolveDocumentBlob} from "@/lib/document/docx";
import * as defaults from "@/lib/document/defaultTemplateStore.js";
import * as selections from "@/lib/document/templateSelectionStore.js";
beforeEach(()=>{vi.clearAllMocks(); createClient.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:"owner"}}})}});saveDefaultTemplate.mockResolvedValue({row:{id:"promoted"},replaced:true});setSelection.mockResolvedValue({ok:true});});
function request(kind="resume"){const f=new FormData();f.set("kind",kind);f.set("file",new Blob(["original"]),"template.docx");return new Request("http://localhost/api/templates/default",{method:"POST",body:f});}
it("promotion activates the saved row for the authenticated scope",async()=>{expect((await POST(request())).status).toBe(200);expect(setSelection).toHaveBeenCalledWith(expect.anything(),{userId:"owner",kind:"resume",templateId:"promoted"});});
it("activation failure cannot claim success; retry recovers",async()=>{setSelection.mockResolvedValueOnce({error:"offline"});const failed=await POST(request("cover"));expect(failed.status).toBe(503);expect((await failed.json()).error).toMatch(/saved.*activat/i);expect((await POST(request("cover"))).status).toBe(200);});
it("email is rejected without persistence",async()=>{expect((await POST(request("email"))).status).toBe(400);expect(saveDefaultTemplate).not.toHaveBeenCalled();});


it.each(["resume","cover"])("public %s promotion replaces old selection and fresh GET formats next text",async(kind)=>{
 const realDefaults=await vi.importActual("@/lib/document/defaultTemplateStore.js");const realSelections=await vi.importActual("@/lib/document/templateSelectionStore.js");
 for(const name of ["saveDefaultTemplate","getDefaultTemplate","getDefaultTemplateBytes"]) defaults[name].mockImplementation(realDefaults[name]);
 selections.setSelection.mockImplementation(realSelections.setSelection);selections.getActiveTemplateBytes.mockImplementation(realSelections.getActiveTemplateBytes);
 const rows={resume_templates:[{id:"old",user_id:"owner",kind,name:"Library A",storage_path:"owner/old.docx"}],template_selections:[{user_id:"owner",kind,template_id:"old"}]};const objects=new Map();
 const client={auth:{getUser:async()=>({data:{user:{id:"owner"}}})},storage:{from:()=>({upload:async(path,bytes)=>{objects.set(path,new Blob([bytes]));return {};},download:async(path)=>({data:objects.get(path)})})},from:(table)=>{const filters={};let operation="read",payload;const matches=r=>Object.entries(filters).every(([k,v])=>r[k]===v);const finish=async()=>{let data;if(operation==="insert"){data={id:"promoted",...payload};rows[table].push(data);}else if(operation==="upsert"){data=rows[table].find(r=>r.user_id===payload.user_id&&r.kind===payload.kind);if(data)Object.assign(data,payload);else rows[table].push(payload);}else if(operation==="update"){data=rows[table].find(matches);Object.assign(data,payload);}else data=rows[table].find(matches)||null;return {data,error:null};};const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},insert:v=>{operation="insert";payload=v;return q;},update:v=>{operation="update";payload=v;return q;},upsert:v=>{operation="upsert";payload=v;return q;},single:finish,maybeSingle:finish,then:(yes,no)=>finish().then(yes,no)};return q;}};
 createClient.mockResolvedValue(client);
 async function fixture(font,align){const zip=new JSZip();zip.file("[Content_Types].xml","<Types/>");zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="'+align+'"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="'+font+'"/></w:rPr><w:t>OLD PLACEHOLDER</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');return new File([await zip.generateAsync({type:"uint8array"})],"original.docx");}
 const a=await fixture("OldSelectedFont","left"),b=await fixture("PromotedOriginalFont","center");objects.set("owner/old.docx",a);
 const before=await GET(new Request('http://localhost/api/templates/default?kind='+kind+'&bytes=1'));expect(new Uint8Array(await before.arrayBuffer())).toEqual(new Uint8Array(await a.arrayBuffer()));
 const promoted=await POST({formData:async()=>new Map([["kind",kind],["file",b]])});expect(promoted.status).toBe(200);expect(rows.template_selections[0].template_id).toBe("promoted");
 const fresh=await GET(new Request('http://localhost/api/templates/default?kind='+kind+'&bytes=1'));expect(fresh.status).toBe(200);const currentFile=new File([await fresh.arrayBuffer()],"fresh.docx");
 const output=await resolveDocumentBlob({text:"NEXT GENERATION TEXT",lines:["NEXT GENERATION TEXT"],formattingTemplate:currentFile});expect(output).toBeTruthy();const xml=await(await JSZip.loadAsync(await output.arrayBuffer())).file("word/document.xml").async("string");expect(xml).toContain("PromotedOriginalFont");expect(xml).toContain('w:val="center"');expect(xml).toContain("NEXT GENERATION TEXT");expect(xml).not.toContain("OLD PLACEHOLDER");expect(xml).not.toContain("OldSelectedFont");
});
