import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("@/lib/llm/geminiClient",()=>({getGeminiClient:vi.fn()}));
vi.mock("@/lib/config/env",()=>({getServerEnv:vi.fn()}));
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { POST } from "./route";
let sequence=0;
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("Gemini_LLM_API_Key","dummy-never-real");vi.stubEnv("RESUME_ENGINE","");vi.stubEnv("PREP_DISABLED","");const user=`wire-user-${++sequence}`,chain={select:vi.fn(()=>chain),eq:vi.fn(()=>chain),maybeSingle:vi.fn(async()=>({data:{id:"wire-A",user_id:user,positions:{id:"p",company:"Cedar Transit Tools",title:"Reliability Manager",location:"Cheyenne",description:"Own incident response"}},error:null}))};createClient.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:user}},error:null})},from:()=>chain});getServerEnv.mockReturnValue({geminiModel:"gemini-wire-fixture"});getGeminiClient.mockImplementation(()=>new GoogleGenAI({apiKey:"dummy-never-real"}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const request=()=>new Request("http://localhost/api/interview-preparation/research",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({applicationId:"wire-A",engine:"gemini"})});
describe("N180 installed Interactions actual wire contract — network always stubbed",()=>{
 it("sends google_search and store:false at top level on exactly one SDK HTTP request",async()=>{const bodies=[];vi.stubGlobal("fetch",vi.fn(async(input,init)=>{const text=init?.body??(input instanceof Request?await input.text():null);bodies.push(JSON.parse(text));return new Response(JSON.stringify({id:"wire-response",status:"completed",steps:[{type:"model_output",content:[{type:"text",text:"{}"}]}]}),{status:200,headers:{"content-type":"application/json"}});}));await POST(request());expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({model:"gemini-wire-fixture",tools:[{type:"google_search"}],store:false});expect(String(bodies[0].input)).toContain("Cedar Transit Tools");expect(bodies[0]).not.toHaveProperty("contents");for(const key of ["response_format","response_mime_type","generation_config","generationConfig","config"])expect(bodies[0]).not.toHaveProperty(key);});
 it("does not retry HTTP503 through the real installed SDK",async()=>{const transport=vi.fn(async()=>new Response(JSON.stringify({error:{message:"Fixture temporarily unavailable",status:"UNAVAILABLE"}}),{status:503,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",transport);const result=await POST(request());expect(result.status).toBe(502);expect(transport).toHaveBeenCalledTimes(1);});
});
