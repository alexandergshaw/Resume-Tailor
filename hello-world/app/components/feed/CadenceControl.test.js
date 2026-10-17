// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {createElement,act} from "react";
import {createRoot} from "react-dom/client";
import CadenceControl from "./CadenceControl";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,onChange;
beforeEach(()=>{container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);onChange=vi.fn();});
afterEach(()=>{act(()=>root.unmount());container.remove();});
function render(value){act(()=>root.render(createElement(CadenceControl,{value,onChange})));return container.querySelector('[role="combobox"]');}
describe("measured cadence selection agrees with effective summary",()=>{
 for(const [value,text] of [[120,"about every 2 hours"],[75,"every 75 minutes"],[5,"every 15 minutes"],["120","about every 2 hours"]])it(`displays actual selected interval ${value}`,()=>{const picker=render(value);expect(picker.textContent).toContain(text);expect(picker.textContent).not.toContain("Not set");expect(container.textContent).toContain(`Checked ${text}.`);expect(onChange).not.toHaveBeenCalled();const label=document.getElementById(picker.getAttribute("aria-labelledby").split(" ")[0]);expect(label.textContent).toBe("How often to check");});
 for(const value of [null,undefined,""," ",NaN,Infinity,true,{}])it(`keeps invalid or unset ${String(value)} at the same default in picker and summary`,()=>{const picker=render(value);expect(picker.textContent).toContain("Not set (about every hour)");expect(container.textContent).toContain("Checked about every hour.");expect(onChange).not.toHaveBeenCalled();});
 it("real menu choice reports numeric interval and explicit unset reports null",async()=>{let picker=render(120);await act(async()=>picker.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,button:0})));let choice=[...document.querySelectorAll('[role="option"]')].find(x=>x.textContent==="every 30 minutes");expect(choice).toBeTruthy();await act(async()=>choice.click());expect(onChange).toHaveBeenLastCalledWith(30);picker=render(30);await act(async()=>picker.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,button:0})));choice=[...document.querySelectorAll('[role="option"]')].find(x=>x.textContent.includes("Not set"));expect(choice).toBeTruthy();await act(async()=>choice.click());expect(onChange).toHaveBeenLastCalledWith(null);});
});
