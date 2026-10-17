// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createElement,useLayoutEffect,act} from "react";
import {createRoot} from "react-dom/client";
import {useFeedConfigChat} from "./useFeedConfigChat";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,chat,account;
function Probe(){const value=useFeedConfigChat({accountId:account});useLayoutEffect(()=>{chat=value;});return null;}
const response=config=>({ok:true,status:200,json:async()=>({config})});
const render=()=>act(async()=>root.render(createElement(Probe)));
async function propose(config){fetch.mockResolvedValueOnce(response(config));await act(async()=>chat.sendMessage("Find jobs"));}
beforeEach(()=>{account="a";container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);vi.stubGlobal("fetch",vi.fn());});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("Setup chat search names",()=>{
 it.each([
  [{jobKeywords:["Backend","Remote","Third"],selectedCompanies:["Other"]},"Backend · Remote"],
  [{selectedCompanies:["Acme","Example","Third"]},"Acme · Example jobs"],
  [{},"My job search"],
  [{name:"  Model name  ",jobKeywords:["Backend"]},"Model name"],
 ])("suggests a bounded local name with existing-field precedence: %j",async(config,name)=>{await render();await propose(config);expect(chat.draft.name).toBe(name);expect(fetch).toHaveBeenCalledTimes(1);});
 it("bounds suggested names to the existing 200-character contract",async()=>{await render();await propose({jobKeywords:["a".repeat(190),"b".repeat(190)]});expect(chat.draft.name).toHaveLength(200);});
 it("preserves an edited name when a later proposal suggests a different name",async()=>{
  await render();await propose({name:"Model first",jobKeywords:["Backend"]});act(()=>chat.setName("My 東京 search "));act(()=>chat.setEmailOnNewJobs(true));expect(chat.draft.name).toBe("My 東京 search ");
  await propose({name:"Model overwrite",jobKeywords:["Remote"]});expect(chat.draft.name).toBe("My 東京 search ");expect(JSON.parse(fetch.mock.calls[1][1].body).currentConfig.name).toBe("My 東京 search ");
  fetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>({search:{id:"saved"}})});await act(async()=>chat.accept());expect(JSON.parse(fetch.mock.calls[2][1].body).name).toBe("My 東京 search ");
 });
 it("allows normal multiword typing and bounds manual edits without trimming each keystroke",async()=>{await render();await propose({});for(const value of ["My","My ","My job","My job 東京"]){act(()=>chat.setName(value));expect(chat.draft.name).toBe(value);}act(()=>chat.setName("é".repeat(201)));expect(chat.draft.name).toBe("é".repeat(200));});
 it.each(["","   "])("keeps a deliberate blank through other edits and later model proposals, and guards direct save: %j",async name=>{await render();await propose({});act(()=>chat.setName(name));act(()=>chat.setJobKeywords(["New"]));await propose({name:"Do not refill"});expect(chat.draft.name).toBe(name);await act(async()=>chat.accept());expect(fetch).toHaveBeenCalledTimes(2);expect(chat.error).toContain("Search name field in Your proposal");expect(chat.uncertain).toBe(false);act(()=>chat.setName("Fixed"));expect(chat.error).toBe("");});
 it("clears manual preference on new proposal and saved-search reopen",async()=>{await render();await propose({});act(()=>chat.setName("Manual"));act(()=>chat.reset());expect(chat.draft).toBe(null);await propose({name:"Fresh model"});expect(chat.draft.name).toBe("Fresh model");act(()=>chat.setName("Other manual"));act(()=>chat.reset({name:"Saved name",jobKeywords:["Saved"]}));expect(chat.draft.name).toBe("Saved name");await propose({name:"New copy suggestion"});expect(chat.draft.name).toBe("New copy suggestion");});
 it("clears state on a mounted account replacement and fences delayed responses",async()=>{await render();await propose({name:"Private A"});act(()=>chat.setName("Manual private A"));let resolve;fetch.mockReturnValueOnce(new Promise(r=>{resolve=r;}));let sending;act(()=>{sending=chat.sendMessage("private followup");});account="b";await render();expect(chat.draft).toBe(null);expect(chat.history).toEqual([]);await act(async()=>{resolve(response({name:"Stale A"}));await sending;});expect(chat.draft).toBe(null);await propose({name:"Account B"});expect(chat.draft.name).toBe("Account B");});
 it("editing a saved name invalidates Saved so an explicit save creates a copy",async()=>{await render();await propose({name:"Original"});fetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>({search:{id:"one"}})});await act(async()=>chat.accept());expect(chat.saved.id).toBe("one");act(()=>chat.setName("Copy"));expect(chat.saved).toBe(null);expect(fetch).toHaveBeenCalledTimes(2);fetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>({search:{id:"two"}})});await act(async()=>chat.accept());expect(JSON.parse(fetch.mock.calls[2][1].body).name).toBe("Copy");});
});
