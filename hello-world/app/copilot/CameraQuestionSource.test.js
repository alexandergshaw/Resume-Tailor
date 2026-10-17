// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks=vi.hoisted(()=>({capture:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/copilot/cameraQuestion",()=>({captureCameraFrame:mocks.capture,readCameraFrame:mocks.read}));
import CameraQuestionSource from "./CameraQuestionSource";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,props,track,media;
const button=(text)=>[...container.querySelectorAll("button")].find(x=>x.textContent.includes(text));
async function click(text){await act(async()=>{button(text).click();});}
async function render(extra={}){props={...props,...extra};await act(async()=>root.render(createElement(CameraQuestionSource,props)));}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
beforeEach(async()=>{container=document.createElement("div");document.body.append(container);root=createRoot(container);props={onSubmit:vi.fn(()=>true),contextKey:{}};track={stop:vi.fn(),onended:null};media={getTracks:()=>[track]};Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:vi.fn(async()=>media)},configurable:true});mocks.capture.mockReset().mockResolvedValue({size:50});mocks.read.mockReset().mockResolvedValue("Tell me about your work?");await render();});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
describe("explicit camera source",()=>{
  it("starts only explicitly with video, captures once, reviews before strict Add",async()=>{
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
    expect(container.textContent).toContain("sent to this server");await click("Start camera");expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledExactlyOnceWith({video:{facingMode:{ideal:"environment"}},audio:false});
    expect(container.querySelector("video").getAttribute("aria-label")).toBe("Question camera viewfinder");await click("Capture question");
    expect(mocks.read).toHaveBeenCalledTimes(1);expect(props.onSubmit).not.toHaveBeenCalled();expect(container.querySelector("textarea").value).toBe("Tell me about your work?");
    await click("Add camera question");expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("Tell me about your work?");expect(container.textContent).toContain("Camera question Added");
  });
  it("retains rejected review and refuses silent overlength truncation",async()=>{
    props.onSubmit.mockReturnValue(false);await click("Start camera");await click("Capture question");await click("Add camera question");expect(container.querySelector("textarea").value).toContain("Tell me");expect(container.textContent).toContain("not added");
    mocks.read.mockResolvedValue("a".repeat(1201));await click("Capture question");expect(button("Add camera question").disabled).toBe(true);expect(container.textContent).toContain("1201/1200");
  });
  it("cleans late permission and preserves unrelated tracks across context changes",async()=>{
    const unrelated={stop:vi.fn()};const waiting=deferred();navigator.mediaDevices.getUserMedia.mockReturnValue(waiting.promise);await click("Start camera");await render({contextKey:{}});await act(async()=>waiting.resolve(media));expect(track.stop).toHaveBeenCalledTimes(1);expect(unrelated.stop).not.toHaveBeenCalled();expect(container.querySelector("video")).toBeNull();expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("fences late OCR after close and returns focus to Start",async()=>{
    const waiting=deferred();mocks.read.mockReturnValue(waiting.promise);await click("Start camera");await click("Capture question");await click("Close question camera");expect(track.stop).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(button("Start camera"));await act(async()=>waiting.resolve("Stale question"));expect(container.textContent).not.toContain("Stale question");expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("fences deferred frame before fetch on disabled transition",async()=>{
    const waiting=deferred();mocks.capture.mockReturnValue(waiting.promise);await click("Start camera");await click("Capture question");await render({disabled:true});await act(async()=>waiting.resolve({size:5}));expect(mocks.read).not.toHaveBeenCalled();expect(track.stop).toHaveBeenCalledTimes(1);
  });
  it("shows denial, retries, handles ended tracks and unreadable failures",async()=>{
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(Object.assign(Error(),{name:"NotAllowedError"}));await click("Start camera");expect(container.textContent).toContain("permission denied");await click("Start camera");mocks.read.mockRejectedValue(Error("No readable question. Retry."));await click("Capture question");expect(container.textContent).toContain("No readable question");await act(async()=>track.onended());expect(track.stop).toHaveBeenCalledTimes(1);expect(container.textContent).toContain("Camera stopped");expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("does not submit duplicate reads and stops owned stream on unmount",async()=>{
    const waiting=deferred();mocks.read.mockReturnValue(waiting.promise);await click("Start camera");await click("Capture question");expect(button("Reading…").disabled).toBe(true);expect(mocks.capture).toHaveBeenCalledTimes(1);await act(async()=>root.unmount());expect(track.stop).toHaveBeenCalledTimes(1);await act(async()=>waiting.resolve("late"));root=createRoot(container);
  });
  it.each([
    "Unauthorized: sign in again (401)", "Image is too large (413)", "Capture a PNG image (415)",
    "No readable question (422)", "Too many camera reads (429)", "Camera reader is busy (503)",
    "Reading timed out (504)", "Failed to fetch",
  ])("renders failure %s, preserves editable text and allows successful retry",async(message)=>{
    await click("Start camera");await click("Capture question");
    const editor=container.querySelector("textarea");await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(editor,"My edited camera draft?");editor.dispatchEvent(new Event("input",{bubbles:true}));});
    mocks.read.mockRejectedValueOnce(Error(message));await click("Capture question");expect(container.textContent).toContain(message);expect(container.querySelector("textarea").value).toBe("My edited camera draft?");expect(props.onSubmit).not.toHaveBeenCalled();
    await click("Capture question");expect(container.textContent).toContain("Review and edit");expect(button("Add camera question").disabled).toBe(false);
  });
  it("shows unsupported camera API and recovers after a device becomes available",async()=>{
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:undefined});await click("Start camera");expect(container.textContent).toContain("Camera unavailable");expect(button("Capture question").disabled).toBe(true);
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn(async()=>media)}});await click("Start camera");await click("Capture question");expect(container.querySelector("textarea").value).toBe("Tell me about your work?");
  });
});
