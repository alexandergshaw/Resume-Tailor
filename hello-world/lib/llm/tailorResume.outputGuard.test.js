import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { generateTailoredResumeDraft, generateTailoredCoverLetterDraft } from "./tailorResume";
const LINES = ["Alex Example", "", "Built reliable systems."];
const BASE = {jobPosting:"Platform engineer",resumeText:LINES.join("\n"),resumeFileName:"resume.docx",templateLines:LINES,additionalContext:"",contextDocuments:[]};
const json = (lines=LINES) => JSON.stringify({jobTitle:"Platform Engineer",companyName:"Example",resultLines:lines});
const response = (text, finishReason="STOP") => ({text,candidates:[{finishReason}]});
let generateContent;
beforeEach(()=>{vi.clearAllMocks();getServerEnv.mockReturnValue({geminiModel:"test-model"});generateContent=vi.fn();getGeminiClient.mockReturnValue({models:{generateContent}});});
async function run(text, reason="STOP", kind="resume") {generateContent.mockResolvedValue(response(text,reason));return (kind==="resume"?generateTailoredResumeDraft:generateTailoredCoverLetterDraft)(BASE);}
describe("document output guard",()=>{
 it("rejects malformed structured resume instead of fitting literal JSON into template slots",async()=>{
  await expect(run('```json\n{"jobTitle":"Platform Engineer","resultLines":["Alex Example",\n"unfinished')).rejects.toMatchObject({name:"TailorOutputError",code:"TAILOR_OUTPUT_INVALID"});
 });
 for(const [label,text] of [
  ["invalid JSON",'{"resultLines":["a",]}'],["unclosed fence",'```json\n'+json()],
  ["prefixed prose","Here is your resume: "+json()],["extra object",json()+" {}"],
  ["absent lines",'{"jobTitle":"Engineer"}'],["object lines",'{"resultLines":{}}'],
  ["short lines",json(["Alex"])],["long lines",json([...LINES,"extra"])],
  ["nonstring line",json(["Alex",null,"Work"])],["blank document",json([""," ",""])],
  ["nonstring metadata",JSON.stringify({resultLines:LINES,companyName:{secret:"x"}})],
  ["plain resume prose","Alex Example\nEngineer\nExperience"],
 ])it(`rejects ${label} without returning a draft`,async()=>{await expect(run(text)).rejects.toMatchObject({name:"TailorOutputError",code:"TAILOR_OUTPUT_INVALID"});});
 for(const reason of ["MAX_TOKENS","SAFETY","RECITATION",undefined,"PRIVATE_UNKNOWN_REASON"])it(`requires first-candidate STOP before text getter (${reason??"missing"})`,async()=>{
  const getter=vi.fn(()=>{throw new Error("PRIVATE_GETTER_BODY");});const reply={candidates:[{finishReason:reason},{finishReason:"STOP"}]};Object.defineProperty(reply,"text",{get:getter});generateContent.mockResolvedValue(reply);
  const error=await generateTailoredResumeDraft(BASE).catch(e=>e);expect(error).toMatchObject({name:"TailorOutputError",code:"TAILOR_OUTPUT_INCOMPLETE"});expect(getter).not.toHaveBeenCalled();expect(JSON.stringify(error)+error.message).not.toMatch(/PRIVATE_/);expect(error.cause).toBeUndefined();
 });
 it("refuses a missing first candidate even with nonempty text",async()=>{generateContent.mockResolvedValue({text:json(),candidates:[]});await expect(generateTailoredResumeDraft(BASE)).rejects.toMatchObject({code:"TAILOR_OUTPUT_INCOMPLETE"});});
 it("accepts only the first candidate and retains blank template slots",async()=>{
  generateContent.mockResolvedValue({text:json(),candidates:[{finishReason:"STOP"},{finishReason:"MAX_TOKENS"}]});expect(await generateTailoredResumeDraft(BASE)).toMatchObject({resultLines:LINES,jobTitle:"Platform Engineer",companyName:"Example"});
 });
 it("accepts a complete JSON fence and complete JSON without changing lines",async()=>{expect((await run(json())).resultLines).toEqual(LINES);expect((await run('```json\n'+json()+'\n```')).resultLines).toEqual(LINES);});
 it("does not expose malformed body in typed error message, cause or logs",async()=>{
  const log=vi.spyOn(console,"log").mockImplementation(()=>{}),errorLog=vi.spyOn(console,"error").mockImplementation(()=>{});let error;try{await run('{"resultLines":["PRIVATE_RESUME_BODY"');}catch(e){error=e;}
  expect(error).toMatchObject({name:"TailorOutputError",code:"TAILOR_OUTPUT_INVALID"});expect(error.cause).toBeUndefined();expect(error.message+JSON.stringify(error)+JSON.stringify(log.mock.calls)+JSON.stringify(errorLog.mock.calls)).not.toContain("PRIVATE_RESUME_BODY");log.mockRestore();errorLog.mockRestore();
 });
 it("preserves STOP-complete plain cover prose while refusing structured-looking cover failures",async()=>{
  expect((await run("Dear team,\nI build reliable systems.\nSincerely, Alex","STOP","cover")).resultLines).toHaveLength(3);
  await expect(run('```json\n{"resultLines":["Dear team"',"STOP","cover")).rejects.toMatchObject({code:"TAILOR_OUTPUT_INVALID"});
  await expect(run(json(),"MAX_TOKENS","cover")).rejects.toMatchObject({code:"TAILOR_OUTPUT_INCOMPLETE"});
 });
});