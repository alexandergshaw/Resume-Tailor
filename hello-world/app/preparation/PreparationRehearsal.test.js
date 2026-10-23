// @vitest-environment jsdom
import { describe,it,expect,beforeEach,afterEach,vi } from "vitest";
import { createElement,useState,useEffect,act } from "react";
import { createRoot } from "react-dom/client";
import PreparationRehearsal from "./PreparationRehearsal";
import { createWorkspace } from "@/lib/interviewPreparation/workspaceStore";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,host,saved;
function Harness({stage="mock",initial}){const [workspace,setWorkspace]=useState(()=>initial||createWorkspace());useEffect(()=>{saved=workspace;});return createElement(PreparationRehearsal,{stage,inputs:workspace.inputs,artifacts:workspace.artifacts,attempts:workspace.attempts,update:setWorkspace});}
async function render(stage="mock",initial){await act(async()=>root.render(createElement(Harness,{stage,initial})));}
async function click(text){const node=[...host.querySelectorAll("button")].find(node=>node.textContent.trim()===text);expect(node,`button ${text}`).toBeTruthy();await act(async()=>node.click());}
async function change(label,value){const node=[...host.querySelectorAll("input,textarea,select")].find(node=>node.getAttribute("aria-label")===label);expect(node,`field ${label}`).toBeTruthy();const proto=node.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:node.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(proto,"value").set.call(node,value);node.dispatchEvent(new Event("input",{bubbles:true}));node.dispatchEvent(new Event("change",{bubbles:true}));});}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();});
describe("N176 mounted timer, review and repair",()=>{
  it("times actual answers, saves once on rapid advance/finish, and reviews only on explicit request",async()=>{
    const getUserMedia=vi.fn();Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia}});
    await render();expect(host.textContent).toContain("No saved answers");await click("Start timed mock");await act(async()=>vi.advanceTimersByTime(65000));expect(host.textContent).toContain("65 seconds");
    await change("Answer transcript","In my previous role I owned the SQL rollback plan and rehearsed it with engineering.");
    const next=[...host.querySelectorAll("button")].find(node=>node.textContent==="Save answer and next question");await act(async()=>{next.click();next.click();});expect(saved.attempts).toHaveLength(1);expect(saved.attempts[0].seconds).toBe(65);expect(saved.attempts[0].review).toBeNull();
    await change("Answer transcript","I coordinated the incident handoff.");await act(async()=>vi.advanceTimersByTime(3000));const finish=[...host.querySelectorAll("button")].find(node=>node.textContent==="Finish mock");await act(async()=>{finish.click();finish.click();});expect(saved.attempts).toHaveLength(2);expect(saved.attempts[1].seconds).toBe(3);expect(saved.attempts[1].review).toBeNull();
    for(const key of ["directness","specificity","ownership","relevance","brevity"])await change(`Your ${key} rating`,"2");await click("Review answer locally");
    expect(saved.attempts[1].review.heuristic.score).toEqual(expect.any(Number));expect(saved.attempts[1].review.checks).toEqual({directness:2,specificity:2,ownership:2,relevance:2,brevity:2});expect(host.textContent).toMatch(/heuristic typed-text review/i);expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("retains original reviewed answer beside an independently reviewable revision",async()=>{
    const initial=createWorkspace();initial.attempts=[{id:"original",question:"What did you personally own?",answer:"We improved things.",seconds:100,review:{heuristic:{score:10,improvements:["Add a real example"],verdict:"Needs evidence"},checks:{directness:1,specificity:1,ownership:1,relevance:1,brevity:1},label:"Heuristic review"}}];
    await render("repair",initial);expect(host.textContent).toMatch(/ownership/);expect(host.textContent).toMatch(/What did you personally do/);await click("Improve this answer");await change("Revision answer","I owned the rollback checklist and rehearsed it before the migration.");await click("Save revised answer separately");
    expect(saved.attempts).toHaveLength(2);expect(saved.attempts[0].answer).toBe("We improved things.");expect(saved.attempts[0].review.heuristic.score).toBe(10);expect(saved.attempts[1].parentId).toBe("original");expect(saved.attempts[1].review).toBeNull();
    await click("Review answer locally");expect(saved.attempts[1].review.heuristic.score).toEqual(expect.any(Number));expect(saved.attempts[0].review.heuristic.score).toBe(10);
  });
  it("does not invent repairs with no reviews and clears its running clock on unmount",async()=>{
    await render("repair");expect(host.textContent).toContain("Review at least one answer");await render("mock");await click("Start timed mock");expect(vi.getTimerCount()).toBeGreaterThan(0);await act(async()=>root.render(null));expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses to advance an empty answer and never saves a fabricated transcript",async()=>{
    await render();await click("Start timed mock");await click("Save answer and next question");expect(saved.attempts).toHaveLength(0);expect(host.textContent).toMatch(/Type your answer before advancing/);await click("Finish mock");expect(saved.attempts).toHaveLength(0);expect(host.textContent).toContain("Mock finished");
  });
});

it("at the history boundary retains the selected original beside its revision or refuses without losing the revision draft",async()=>{
  const initial=createWorkspace();initial.attempts=Array.from({length:60},(_,index)=>({id:`original-${index}`,question:`Question ${index}`,answer:index===0?"OLDEST SELECTED ORIGINAL":"Existing answer",seconds:65,review:null}));
  await render("mock",initial);await change("Saved answer","original-0");const revision="NEW REVISION OF OLDEST ORIGINAL";await change("Revision answer",revision);await click("Save revised answer separately");
  const original=saved.attempts.find(attempt=>attempt.id==="original-0"),revised=saved.attempts.find(attempt=>attempt.parentId==="original-0"&&attempt.answer===revision);
  expect(original, "A history cap must not silently discard the original currently being revised").toBeTruthy();expect(original.answer).toBe("OLDEST SELECTED ORIGINAL");
  if(revised){expect(revised.id).not.toBe(original.id);expect(revised.review).toBeNull();}
  else {expect(saved.attempts).toHaveLength(60);expect(host.querySelector('[aria-label="Revision answer"]').value).toBe(revision);expect(host.textContent).toMatch(/limit|history|full|retain|maximum/i);}
});
