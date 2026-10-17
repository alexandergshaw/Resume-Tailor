// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createElement,act} from "react";
import {createRoot} from "react-dom/client";
import FeedConfigChat from "./FeedConfigChat";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let container,root,onSend;
beforeEach(()=>{container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);onSend=vi.fn();});
afterEach(()=>{act(()=>root.unmount());container.remove();});
function render(props={}){act(()=>root.render(createElement(FeedConfigChat,{onSend,status:"idle",...props})));}
function button(name){return [...container.querySelectorAll("button")].find(x=>x.textContent===name);}
function composer(){return container.querySelector("textarea:not([aria-hidden])");}
function type(text){act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(composer(),text);composer().dispatchEvent(new Event("input",{bubbles:true}));});}
describe("Setup chat presentation controls",()=>{
 it("starter prefills and focuses the composer without sending until explicitly requested",()=>{render();act(()=>button("Remote platform roles").click());expect(composer().value).toBe("Find remote platform engineering roles.");expect(document.activeElement).toBe(composer());expect(onSend).not.toHaveBeenCalled();type("Remote platform roles with Python");act(()=>button("Send message").click());expect(onSend).toHaveBeenCalledExactlyOnceWith("Remote platform roles with Python");});
 it("ordinary Enter does not send and Ctrl+Enter sends once",()=>{render();type("Platform roles\nRemote only");act(()=>composer().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));expect(onSend).not.toHaveBeenCalled();act(()=>composer().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true})));expect(onSend).toHaveBeenCalledExactlyOnceWith("Platform roles\nRemote only");});
 it("blank, overlimit, busy and uncertain states cannot dispatch",()=>{render();expect(button("Send message").disabled).toBe(true);type("x".repeat(2001));act(()=>composer().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true})));expect(onSend).not.toHaveBeenCalled();render({status:"loading"});expect(button("Send message").disabled).toBe(true);expect(button("Check every 2 hours").disabled).toBe(true);render({disabled:true});expect(button("Tailor my resume only").disabled).toBe(true);expect(onSend).not.toHaveBeenCalled();});
 it("renders labelled speakers and preserves message text without HTML interpretation",()=>{render({history:[{role:"user",content:"<b>Remote roles</b>"},{role:"assistant",content:"Review your proposal."}]});expect(container.textContent).toContain("You");expect(container.textContent).toContain("Setup assistant");expect(container.textContent).toContain("<b>Remote roles</b>");expect(container.querySelector("b")).toBeNull();expect(container.querySelector('[role="log"]').getAttribute("aria-live")).toBe("polite");});
});
