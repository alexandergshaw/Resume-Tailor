// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
vi.mock("@/lib/copilot/practiceSession",()=>({PracticeSession:vi.fn()}));
import { PracticeSession } from "@/lib/copilot/practiceSession";
import { usePracticeCaptureSession } from "./usePracticeCaptureSession";
import CameraQuestionSource from "../CameraQuestionSource";
import { useRoomQuestions } from "./useRoomQuestions";
import { submitPracticeQuestion } from "@/lib/copilot/manualQuestion";
const camera=vi.hoisted(()=>({capture:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/copilot/cameraQuestion",()=>({captureCameraFrame:camera.capture,readCameraFrame:camera.read}));
vi.mock("@/lib/copilot/detectClient",()=>({confirmQuestion:vi.fn()}));
vi.mock("@/lib/copilot/answerClient",()=>({draftAnswer:vi.fn(async()=>({points:["A grounded answer"],cues:[],buzzwords:[]}))}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it("camera epoch changes on constant-clock starts and immediately at Stop entry before pending teardown",async()=>{
  vi.spyOn(Date,"now").mockReturnValue(1234);let state,release;const stopped=new Promise(resolve=>{release=resolve;});
  PracticeSession.mockImplementation(function(options){this.start=async()=>options.onStream({getTracks:()=>[selfView]},true);this.stop=()=>stopped;});
  let resolveRead,room,drill,order=[];camera.capture.mockResolvedValue({size:5});camera.read.mockImplementation(()=>new Promise(resolve=>{resolveRead=resolve;}));
  const owned={stop:vi.fn()},selfView={stop:vi.fn()};Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn(async()=>({getTracks:()=>[owned]}))}});
  function Probe(){const [status,setStatus]=useState("idle");state=usePracticeCaptureSession({status,setStatus});room=useRoomQuestions({applicationId:"camera-test",profile:"Engineer",myTag:null,collecting:false});const onSubmit=text=>submitPracticeQuestion(text,{advanceAsked:()=>order.push("bank"),abandonAnswer:()=>order.push("abandon"),resetAnswer:()=>order.push("reset"),setDrillQuestion:(question)=>{drill=question;order.push("drill");},addToFeed:(question)=>{order.push("feed");room.addManualQuestion(question);}});return createElement(CameraQuestionSource,{contextKey:state.cameraSessionEpoch,onSubmit});}
  const container=document.createElement("div"),root=createRoot(container);document.body.append(container);
  const click=async(text)=>act(async()=>[...container.querySelectorAll("button")].find(button=>button.textContent.includes(text)).click());
  try{
    await act(async()=>root.render(createElement(Probe)));expect(state.cameraSessionEpoch).toBe(0);
    await act(async()=>state.start());expect(state.cameraSessionEpoch).toBe(1);const originalLogId=state.activeSessionId;
    await click("Start camera");await click("Capture question");
    expect(state.stream.getTracks()).toEqual([selfView]);
    let pending;await act(async()=>{pending=state.stop();});expect(state.cameraSessionEpoch).toBe(2);expect(state.activeSessionId).toBe(originalLogId);
    await act(async()=>resolveRead("Stale practice question?"));expect(container.querySelector("textarea")).toBeNull();expect(owned.stop).toHaveBeenCalledTimes(1);expect(selfView.stop).not.toHaveBeenCalled();
    await act(async()=>{release();await pending;});await act(async()=>state.start());expect(state.cameraSessionEpoch).toBe(3);expect(state.activeSessionId).toBeGreaterThan(originalLogId);
    camera.read.mockResolvedValue("Original OCR practice question?");await click("Start camera");await click("Capture question");
    const editor=container.querySelector("textarea");await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(editor,"Edited practice camera question?");editor.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(room.questions).toHaveLength(0);await click("Add camera question");expect(drill).toBe("Edited practice camera question?");expect(room.questions.map(row=>row.question)).toEqual([drill]);expect(order).toEqual(["bank","abandon","reset","drill","feed"]);
  }finally{release();await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();}
});
