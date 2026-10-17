// @vitest-environment jsdom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
vi.mock("@/lib/copilot/session",()=>({CopilotSession:vi.fn()}));
vi.mock("@/lib/copilot/detectClient",()=>({confirmQuestion:vi.fn()}));
vi.mock("@/lib/copilot/answerClient",()=>({draftAnswer:vi.fn()}));
import { CopilotSession } from "@/lib/copilot/session";
import { useLiveSession } from "./useLiveSession";
import CameraQuestionSource from "./CameraQuestionSource";
const camera=vi.hoisted(()=>({capture:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/copilot/cameraQuestion",()=>({captureCameraFrame:camera.capture,readCameraFrame:camera.read}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it("live camera epoch invalidates same-clock restarts and Stop before asynchronous teardown",async()=>{
  vi.spyOn(Date,"now").mockReturnValue(1234);let state,release;const stopped=new Promise(resolve=>{release=resolve;});
  CopilotSession.mockImplementation(function(){this.start=async()=>{};this.stop=()=>stopped;});
  let resolveRead;camera.capture.mockResolvedValue({size:5});camera.read.mockImplementation(()=>new Promise(resolve=>{resolveRead=resolve;}));
  const owned={stop:vi.fn()},unrelated={stop:vi.fn()};Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn(async()=>({getTracks:()=>[owned]}))}});
  function Probe(){const [status,setStatus]=useState("idle"),[questions,setQuestions]=useState([]);const cache=useRef(new Map()),generation=useRef(0);state=useLiveSession({status,setStatus,questions,setQuestions,answerCacheRef:cache,draftGenRef:generation,recordSpeechSample:()=>{},resetForSession:()=>{},source:"tab",profile:"",posting:null,autoDraft:false,setSetupExpanded:()=>{},setShowHistory:()=>{}});state={...state,questions};return createElement(CameraQuestionSource,{contextKey:state.cameraSessionEpoch,onSubmit:state.addManualQuestion});}
  const container=document.createElement("div"),root=createRoot(container);document.body.append(container);
  const click=async(text)=>act(async()=>[...container.querySelectorAll("button")].find(button=>button.textContent.includes(text)).click());
  try{
    await act(async()=>root.render(createElement(Probe)));expect(state.cameraSessionEpoch).toBe(0);
    await act(async()=>state.start());expect(state.cameraSessionEpoch).toBe(1);
    await click("Start camera");await click("Capture question");
    let pending;await act(async()=>{pending=state.stop();});expect(state.cameraSessionEpoch).toBe(2);
    expect(owned.stop).toHaveBeenCalledTimes(1);expect(unrelated.stop).not.toHaveBeenCalled();
    await act(async()=>resolveRead("Stale previous-session question?"));expect(container.querySelector("textarea")).toBeNull();
    await act(async()=>{release();await pending;});await act(async()=>state.start());expect(state.cameraSessionEpoch).toBe(3);
    camera.read.mockResolvedValue("Original OCR question?");await click("Start camera");await click("Capture question");
    const editor=container.querySelector("textarea");await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(editor,"Edited live camera question?");editor.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(state.questions).toHaveLength(0);await click("Add camera question");expect(state.questions.map(row=>row.question)).toEqual(["Edited live camera question?"]);
  }finally{release();await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();}
});
