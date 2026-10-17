// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createElement,act} from "react";
import {createRoot} from "react-dom/client";
import FeedConfigPanel from "./FeedConfigPanel";
let chatProps,reviewProps;
vi.mock("./FeedConfigChat",()=>({default:props=>{chatProps=props;return createElement("div",{"aria-label":"Conversation"},props.history.map(t=>t.content).join("\n"));}}));
vi.mock("./DerivedConfigReview",()=>({default:props=>{reviewProps=props;return createElement("button",{disabled:props.disabled,onClick:props.onAccept},"Save new search");}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let container,root,props;
const good=(config={})=>({ok:true,status:200,json:async()=>({config:{name:"Platform",jobKeywords:["platform"],...config},assistantMessage:"Review this proposal",mode:"model"})});
beforeEach(()=>{container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);props={currentUser:{id:"a"},savedSearches:[],setSavedSearches:vi.fn()};vi.stubGlobal("fetch",vi.fn());});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(createElement(FeedConfigPanel,{key:props.currentUser.id,...props})));}
describe("N170 real hook lifecycle",()=>{
 it("serializes same-tick sends and carries manual edits into the next turn",async()=>{fetch.mockResolvedValue(good());await render();await act(async()=>{const first=chatProps.onSend("platform roles");chatProps.onSend("duplicate");await first;});expect(fetch).toHaveBeenCalledTimes(1);act(()=>reviewProps.setSelectedCompanies(["Example"]));await act(async()=>chatProps.onSend("every 2 hours"));const body=JSON.parse(fetch.mock.calls[1][1].body);expect(body.currentConfig.selectedCompanies).toEqual(["Example"]);expect(body.history.map(t=>t.role)).toEqual(["user","assistant"]);});
 it("ignores delayed responses from a switched account",async()=>{let resolve;fetch.mockReturnValue(new Promise(r=>{resolve=r;}));await render();let send;act(()=>{send=chatProps.onSend("private account a roles");});props={...props,currentUser:{id:"b"}};await render();await act(async()=>{resolve(good());await send;});expect(chatProps.history).toEqual([]);expect(container.textContent).not.toContain("private account a");});
 it("keeps a failed save draft and blocks duplicate uncertain retries until reload",async()=>{fetch.mockResolvedValueOnce(good());await render();await act(async()=>chatProps.onSend("platform roles"));fetch.mockRejectedValueOnce(new TypeError("network"));await act(async()=>reviewProps.onAccept());expect(chatProps.error).toMatch(/uncertain/);const before=fetch.mock.calls.length;await act(async()=>reviewProps.onAccept());expect(fetch.mock.calls.length).toBe(before);expect([...container.querySelectorAll("button")].find(x=>x.textContent==="Start new proposal").disabled).toBe(true);fetch.mockResolvedValueOnce({ok:true,json:async()=>({searches:[]})});const reload=[...container.querySelectorAll("button")].find(x=>/Reload saved/.test(x.textContent));await act(async()=>reload.click());expect(props.setSavedSearches).toHaveBeenCalledWith([]);expect([...container.querySelectorAll("button")].find(x=>x.textContent==="Start new proposal").disabled).toBe(false);});
});


describe("N170 actual save account fence and reopen",()=>{
 it("does not publish a delayed save result after account switch",async()=>{
  fetch.mockResolvedValueOnce(good());await render();await act(async()=>chatProps.onSend("platform roles"));let resolve;fetch.mockReturnValueOnce(new Promise(r=>{resolve=r;}));let saving;act(()=>{saving=reviewProps.onAccept();});props={...props,currentUser:{id:"b"}};await render();await act(async()=>{resolve({ok:true,json:async()=>({search:{id:"private-a",name:"Account A"}})});await saving;});expect(props.setSavedSearches).not.toHaveBeenCalled();expect(container.textContent).not.toContain("Account A");
 });
 it("reopens a saved search as a copy and clears transcript on deliberate reset",async()=>{
  props={...props,savedSearches:[{id:"stored",name:"Stored platform",jobKeywords:["platform"],selectedCompanies:["Example"],tailoringDocumentMode:"resume_only"}]};await render();const select=container.querySelector('select[aria-label="Start from a saved search"]');await act(async()=>{select.value="stored";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(reviewProps.draft.jobKeywords).toEqual(["platform"]);expect(reviewProps.draft.tailoringDocumentMode).toBe("resume_only");fetch.mockResolvedValueOnce(good());await act(async()=>chatProps.onSend("every 2 hours"));expect(JSON.parse(fetch.mock.calls[0][1].body).currentConfig.selectedCompanies).toEqual(["Example"]);const reset=[...container.querySelectorAll("button")].find(x=>x.textContent==="Start new proposal");await act(async()=>reset.click());expect(chatProps.history).toEqual([]);
 });
 it("same-tick save clicks create only one request",async()=>{
  fetch.mockResolvedValueOnce(good());await render();await act(async()=>chatProps.onSend("platform roles"));fetch.mockResolvedValueOnce({ok:true,json:async()=>({search:{id:"saved-1",name:"Platform"}})});await act(async()=>{const saving=reviewProps.onAccept();reviewProps.onAccept();await saving;});expect(fetch).toHaveBeenCalledTimes(2);expect(props.setSavedSearches).toHaveBeenCalledTimes(1);
 });
});
