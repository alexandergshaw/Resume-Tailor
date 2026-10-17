// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createElement,useLayoutEffect,act} from "react";
import {createRoot} from "react-dom/client";
import {useFeedConfigChat} from "./useFeedConfigChat";
import {activityLogSnapshot} from "@/lib/activityLog/appActivityLog.js";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,chat,eventOffset;
function Probe(){const value=useFeedConfigChat({accountId:"PRIVATE_ACCOUNT_CANARY"});useLayoutEffect(()=>{chat=value;});return createElement("div",{role:"alert"},value.error);}
const privateDraft={name:"PRIVATE_NAME_CANARY",jobKeywords:["PRIVATE_KEYWORD_CANARY"]};
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
async function prepare(){await act(async()=>root.render(createElement(Probe)));act(()=>chat.reset(privateDraft));}
async function reject(status,body){fetch.mockResolvedValueOnce(response(status,body));await act(async()=>chat.accept());}
const events=()=>activityLogSnapshot().events.slice(eventOffset);
beforeEach(()=>{container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);vi.stubGlobal("fetch",vi.fn());eventOffset=activityLogSnapshot().events.length;});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("Setup chat save reasons",()=>{
 it("explains a missing search name and keeps the draft retryable",async()=>{
  await prepare();await reject(400,{code:"SEARCH_NAME_REQUIRED",error:"PRIVATE_RESPONSE_CANARY"});
  expect(container.textContent).toContain("Ask the setup chat to name your search");expect(chat.draft.name).toBe(privateDraft.name);expect(chat.uncertain).toBe(false);expect(chat.status).toBe("error");
  fetch.mockResolvedValueOnce(response(200,{search:{id:"saved"}}));await act(async()=>chat.accept());expect(fetch).toHaveBeenCalledTimes(2);expect(chat.saved.id).toBe("saved");
 });
 it.each([
  [400,"DOCUMENT_MODE_INVALID","Choose Resume only or Resume + cover letter"],
  [401,"AUTH_REQUIRED","Sign in again"],
  [409,"SAVED_SEARCH_LIMIT","Remove an existing saved search"],
  [409,"DOCUMENT_MODE_SCHEMA_REQUIRED","administrator"],
  [400,"INVALID_JSON","could not read the save request"],
 ])("explains status %s code %s",async(status,code,copy)=>{await prepare();await reject(status,{code,error:"PRIVATE_RESPONSE_CANARY"});expect(chat.error).toContain(copy);expect(chat.uncertain).toBe(false);expect(chat.draft.name).toBe(privateDraft.name);});
 it.each([
  [400,"Missing or invalid 'name'.","name your search"],
  [400,"Choose a supported document option before saving.","Choose Resume only"],
  [400,"Choose Resume only or Resume + cover letter.","Choose Resume only"],
  [409,"You can have at most 25 saved searches.","Remove an existing"],
 ])("recognizes only fixed legacy contract %s %s",async(status,error,copy)=>{await prepare();await reject(status,{error});expect(chat.error).toContain(copy);});
 it.each([[400,"SAVED_SEARCH_LIMIT"],[409,"SEARCH_NAME_REQUIRED"],[500,"DOCUMENT_MODE_SCHEMA_REQUIRED"],[409,"UNKNOWN"]])("does not trust mismatched status %s code %s",async(status,code)=>{await prepare();await reject(status,{code,error:"<script>PRIVATE_RESPONSE_CANARY</script>"});expect(chat.error).toContain(`HTTP ${status}`);expect(chat.error).toContain("did not provide a specific reason");expect(chat.error).not.toMatch(/limit of 25|name your search|server setup|PRIVATE_RESPONSE_CANARY/);});
 it("treats a malformed rejected body as a definite rejection, with retry available",async()=>{await prepare();fetch.mockResolvedValueOnce({ok:false,status:400,json:async()=>{throw new SyntaxError("PRIVATE_RESPONSE_CANARY");}});await act(async()=>chat.accept());expect(chat.error).toContain("HTTP 400");expect(chat.uncertain).toBe(false);fetch.mockResolvedValueOnce(response(200,{search:{id:"retry"}}));await act(async()=>chat.accept());expect(chat.saved.id).toBe("retry");});
 it.each(["malformed","missing-id","transport"])("retains uncertainty locking for %s successful/lost saves",async kind=>{await prepare();if(kind==="transport")fetch.mockRejectedValueOnce(new Error("PRIVATE_RESPONSE_CANARY"));else fetch.mockResolvedValueOnce(kind==="malformed"?{ok:true,status:200,json:async()=>{throw new SyntaxError("PRIVATE_RESPONSE_CANARY");}}:response(200,{}));await act(async()=>chat.accept());expect(chat.uncertain).toBe(true);expect(chat.error).toContain("Reload saved searches");await act(async()=>chat.accept());expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(events())).toContain("SAVE_OUTCOME_UNCERTAIN");expect(JSON.stringify(events())).not.toContain("PRIVATE_");});
 it("records only normalized rejection fields in the actual activity ledger",async()=>{await prepare();await reject(400,{code:"SEARCH_NAME_REQUIRED",error:"PRIVATE_RESPONSE_CANARY",name:"PRIVATE_SERVER_NAME"});const actual=events();expect(actual).toHaveLength(1);expect(actual[0]).toMatchObject({channel:"feed-config",type:"save.failed",reason:"SEARCH_NAME_REQUIRED",status:400});expect(Object.keys(actual[0]).sort()).toEqual(["at","channel","reason","seq","status","t","type"]);expect(JSON.stringify(actual)).not.toContain("PRIVATE_");expect(container.textContent).not.toContain("PRIVATE_RESPONSE_CANARY");});
 it("keeps unknown raw bodies out of both feedback and diagnostics",async()=>{await prepare();await reject(500,{error:"PRIVATE_RESPONSE_CANARY",code:"PRIVATE_CODE_CANARY"});expect(chat.error).toContain("HTTP 500");expect(events()[0]).toMatchObject({reason:"SEARCH_SAVE_REJECTED",status:500});expect(JSON.stringify(events())).not.toContain("PRIVATE_");});
});

