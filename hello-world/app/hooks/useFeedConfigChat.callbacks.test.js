// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createElement,useLayoutEffect,act} from "react";
import {createRoot} from "react-dom/client";
import {useFeedConfigChat} from "./useFeedConfigChat";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,actions;
function Probe(props){const chat=useFeedConfigChat({accountId:"same-account",...props});useLayoutEffect(()=>{actions=chat;});return null;}
const proposal={ok:true,status:200,json:async()=>({config:{name:"Platform",jobKeywords:["platform"]},assistantMessage:"Review platform roles.",mode:"model"})};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function render(props){await act(async()=>root.render(createElement(Probe,props)));}
async function prepare(props){fetch.mockResolvedValueOnce(proposal);await render(props);await act(async()=>actions.sendMessage("platform roles"));expect(actions.draft.name).toBe("Platform");}
beforeEach(()=>{container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);actions=null;vi.stubGlobal("fetch",vi.fn());});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("latest committed callbacks during real pending hook operations",()=>{
 it("pending SAVE publishes only to the latest same-account onApplied callback",async()=>{
  const a=vi.fn(),b=vi.fn();await prepare({onApplied:a});const pending=deferred();fetch.mockReturnValueOnce(pending.promise);let saving;act(()=>{saving=actions.accept();});expect(fetch).toHaveBeenCalledTimes(2);expect(actions.status).toBe("saving");await render({onApplied:b});await act(async()=>{pending.resolve({ok:true,json:async()=>({search:{id:"saved",name:"Platform"}})});await saving;});expect(a).not.toHaveBeenCalled();expect(b).toHaveBeenCalledExactlyOnceWith({id:"saved",name:"Platform"});expect(actions.saved.id).toBe("saved");
 });
 it("pending reconciliation reload uses only the latest committed onReload callback",async()=>{
  const a=vi.fn(),b=vi.fn();await prepare({onReload:a});fetch.mockRejectedValueOnce(new TypeError("controlled uncertainty"));await act(async()=>actions.accept());expect(actions.uncertain).toBe(true);const pending=deferred();fetch.mockReturnValueOnce(pending.promise);let reloading;act(()=>{reloading=actions.reconcile();});expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls[2][0]).toBe("/api/saved-searches");await render({onReload:b});const rows=[{id:"saved",name:"Platform"}];await act(async()=>{pending.resolve({ok:true,json:async()=>({searches:rows})});await reloading;});expect(a).not.toHaveBeenCalled();expect(b).toHaveBeenCalledExactlyOnceWith(rows);expect(actions.reconciled).toBe(true);
 });
});
