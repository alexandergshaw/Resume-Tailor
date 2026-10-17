import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { submitPracticeQuestion } from "@/lib/copilot/manualQuestion";
const read=(file)=>fs.readFileSync(new URL(file,import.meta.url),"utf8");
describe("both camera source caller contracts",()=>{
  it("opts both actual clients in with the existing composed sinks and stable lifecycle context",()=>{
    const live=read("./CopilotClient.js"),practice=read("./practice/PracticeClient.js"),manual=read("./ManualQuestion.js");
    expect(live).toMatch(/onSubmit=\{addManualQuestion\}\s+cameraEnabled\s+cameraContextKey=\{cameraContextKey\}/);
    expect(practice).toMatch(/onSubmit=\{onManualQuestion\}\s+cameraEnabled\s+cameraContextKey=\{cameraContextKey\}/);
    for(const source of [live,practice])expect(source).toContain("[cameraSessionEpoch, posting?.id, interviewType, engine, profile]");
    expect(manual).toContain("cameraEnabled = false");expect(manual).toContain("<CameraQuestionSource onSubmit={onSubmit} contextKey={cameraContextKey}");
    expect(read("./useQuestionPipeline.js")).toContain("addManualQuestion");expect(read("./practice/usePracticeHandlers.js")).toContain("submitPracticeQuestion");
  });
  it("reviewed practice text retains real composed drill/feed order and strict acceptance",()=>{
    const calls=[];const callbacks=Object.fromEntries(["advanceAsked","abandonAnswer","resetAnswer","setDrillQuestion","addToFeed"].map(name=>[name,(...args)=>calls.push([name,...args])]));
    expect(submitPracticeQuestion("  Describe a design tradeoff?  ",callbacks)).toBe(true);
    expect(calls.map(x=>x[0])).toEqual(["advanceAsked","abandonAnswer","resetAnswer","setDrillQuestion","addToFeed"]);expect(calls[3][1]).toBe("Describe a design tradeoff?");expect(calls[4][1]).toBe(calls[3][1]);
  });
});
