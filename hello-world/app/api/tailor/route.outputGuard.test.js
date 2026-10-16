import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("@/lib/supabase/experiencePages",()=>({listPages:vi.fn()}));
vi.mock("@/lib/config/env",()=>({getServerEnv:vi.fn()}));
vi.mock("@/lib/llm/geminiClient",()=>({getGeminiClient:vi.fn()}));
import {createClient} from "@/lib/supabase/server";
import {getServerEnv} from "@/lib/config/env";
import {getGeminiClient} from "@/lib/llm/geminiClient";
import {POST} from "./route.js";
const lines=["Alex Example","Platform engineer","Built reliable systems."];
const reply=(text,finishReason="STOP")=>({text,candidates:[{finishReason}]});
const good=()=>reply(JSON.stringify({jobTitle:"Platform Engineer",companyName:"Example",resultLines:lines}));
let generateContent;
function request({cover=false}={}){const fd=new FormData();fd.append("jobPosting","Role: Platform Engineer\nCompany: Example");fd.append("engine","gemini");fd.append("resume",new File([lines.join("\n")],"resume.txt",{type:"text/plain"}));fd.append("templateLines",JSON.stringify(lines));if(cover){fd.append("coverLetter",new File([lines.join("\n")],"cover.txt",{type:"text/plain"}));fd.append("coverLetterTemplateLines",JSON.stringify(lines));}return {formData:async()=>fd};}
beforeEach(()=>{vi.clearAllMocks();createClient.mockResolvedValue({auth:{getUser:async()=>({data:{user:null},error:null})}});getServerEnv.mockReturnValue({geminiModel:"test-model"});generateContent=vi.fn();getGeminiClient.mockReturnValue({models:{generateContent}});vi.spyOn(console,"error").mockImplementation(()=>{});vi.spyOn(console,"log").mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());
describe("tailor route output refusal",()=>{
 it("returns safe failure before a malformed resume can become a successful preview payload",async()=>{generateContent.mockResolvedValue(reply('```json\n{"resultLines":["PRIVATE_RESUME_BODY"'));const res=await POST(request({cover:true})),body=await res.json();expect(res.status).toBe(502);expect(body.code).toBe("TAILOR_OUTPUT_INVALID");expect(body.error).toMatch(/generate|retry|again/i);expect(body).not.toHaveProperty("result");expect(body).not.toHaveProperty("resultLines");expect(body).not.toHaveProperty("docxB64");expect(generateContent).toHaveBeenCalledTimes(1);expect(JSON.stringify(body)+JSON.stringify(console.error.mock.calls)+JSON.stringify(console.log.mock.calls)).not.toContain("PRIVATE_RESUME_BODY");});
 it("never echoes arbitrary provider finish status",async()=>{generateContent.mockResolvedValue(reply(JSON.stringify({resultLines:lines}),"PRIVATE_PROVIDER_REASON"));const res=await POST(request()),body=await res.json();expect(res.status).toBe(502);expect(body.code).toBe("TAILOR_OUTPUT_INCOMPLETE");expect(JSON.stringify(body)+JSON.stringify(console.error.mock.calls)).not.toContain("PRIVATE_PROVIDER_REASON");});
 it("retains successful valid resume payload",async()=>{generateContent.mockResolvedValue(good());const res=await POST(request()),body=await res.json();expect(res.status).toBe(200);expect(body.resultLines).toEqual(lines);expect(body.result).toBe(lines.join("\n"));});
 it("isolates refused cover output without corrupting the accepted resume",async()=>{generateContent.mockResolvedValueOnce(good()).mockResolvedValueOnce(reply('```json\n{"resultLines":["PRIVATE_COVER_BODY"')).mockResolvedValue(reply('{"subject":"Application","bodyLines":["Hello team."]}'));const res=await POST(request({cover:true})),body=await res.json();expect(res.status).toBe(200);expect(body.resultLines).toEqual(lines);expect(body.coverLetterResultLines).toEqual([]);expect(body.coverLetterError).toMatch(/generate|retry|again|invalid|complete/i);expect(JSON.stringify(body)+JSON.stringify(console.log.mock.calls)+JSON.stringify(console.error.mock.calls)).not.toContain("PRIVATE_COVER_BODY");});
});