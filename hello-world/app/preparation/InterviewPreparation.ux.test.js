// @vitest-environment jsdom
// Behavioral contract tests authored independently of N179 presentation implementation.
// Native keyboard activation, CSS visibility and viewport geometry require a browser.
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { webcrypto } from "node:crypto";
import InterviewPreparation from "./InterviewPreparation";
import { createWorkspace, serializeWorkspace, workspaceKey } from "@/lib/interviewPreparation/workspaceStore";
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
const external = vi.hoisted(() => ({ docs: vi.fn() }));
vi.mock("@/lib/copilot/applicationDocsClient", () => ({ loadApplicationDocs: external.docs }));
vi.mock("@/app/settings/engine", () => ({ readEngine: () => "embedded", useEngine: () => ({ engine: "embedded", setEngine: () => {} }) }));
vi.mock("@/app/copilot/PostingPicker", () => ({ default: () => createElement("p", null, "External application picker fixture") }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const labels = ["1. Interview brief", "2. Role and evidence", "3. Company research", "4. Interviewer focus", "5. Your candidacy", "6. Reusable examples", "7. Common and practical questions", "8. Questions to ask", "9. Timed mock interview", "10. Improve weak answers", "11. Call reference and environment", "12. After the call"];
const key = workspaceKey("UX-TEST", null);
let host, root;
const compact = node => node.textContent.replace(/\s+/g, " ").trim();
const allButtons = () => [...host.querySelectorAll('nav[aria-label="Interview preparation activities"] button')];
const buttons = () => allButtons().filter(node => /^\d+\.\s/.test(compact(node)));
function button(text) { const found = [...host.querySelectorAll("button")].find(node => compact(node) === text); expect(found, text).toBeTruthy(); return found; }
function field(label) { const found = [...host.querySelectorAll("input,textarea,select")].find(node => node.getAttribute("aria-label") === label); expect(found, label).toBeTruthy(); return found; }
async function click(node) { await act(async () => node.click()); }
async function select(index) { const node = buttons().find(node => compact(node).startsWith(labels[index])); expect(node, labels[index]).toBeTruthy(); await click(node); return node; }
async function edit(label, value) { const node = field(label); await act(async () => { const proto = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function mount(value) { if (value) window.localStorage.setItem(key, serializeWorkspace(value)); await act(async () => root.render(createElement(InterviewPreparation, { userId: "UX-TEST", aggressiveness: 3 }))); }
function setup() { const found = button("Use supplied resume and cover").closest("details"); expect(found, "setup uses mounted native disclosure").toBeTruthy(); return found; }
function review() { const found = host.querySelector('[aria-label="Independent adversarial review"]')?.closest("details"); expect(found, "real review remains inside mounted native disclosure").toBeTruthy(); return found; }
function outsideText() { const copy = host.cloneNode(true); copy.querySelectorAll("details:not([open])").forEach(node => { const summary = node.querySelector(":scope > summary"); node.replaceChildren(...(summary ? [summary] : [])); }); return compact(copy); }
function noPost() { expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0); }
beforeEach(() => { window.localStorage.clear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); external.docs.mockReset().mockResolvedValue({ resume: "", coverLetter: "" }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "absent", completeSections: [] }) })); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("N179 focused workbench contract", () => {
  it("defaults to the interview plan plus twelve truthful tools with one current destination", async () => {
    await mount();
    expect(buttons()).toHaveLength(12); expect(allButtons()).toHaveLength(13); expect(host.querySelector("#active-preparation-tool").textContent).toBe("Interview plan"); expect(allButtons().filter(node=>node.getAttribute("aria-current")==="step")).toHaveLength(1); expect(compact(allButtons()[0])).toMatch(/Interview plan/);
    const nav = host.querySelector('nav[aria-label="Interview preparation activities"]');
    for (const group of ["Understand", "Prepare answers", "Practice", "Interview day"]) expect(compact(nav)).toContain(group);
    // Independent expected controls, not imported from the implementation STAGES table.
    const controls = ["Job title", "Job description", "Products, services and problem solved", "Supplied professional biography or notes", "Your relevant background", "Example 1 title", "Start date and notice", null, null, null, null, "What you promised to provide"];
    for (let index = 0; index < labels.length; index++) {
      const selected = await select(index);
      expect(allButtons().filter(node => node.getAttribute("aria-current") === "step")).toEqual([selected]);
      expect(selected.disabled).toBe(false);
      if (controls[index]) field(controls[index]);
      else {
        const actions = { 7: "Build questions to ask", 8: "Build grounded sample answer", 9: "Suggest grounded repair", 10: "Build call reference" };
        button(actions[index]);
      }
    }
    noPost();
  });

  it("keeps setup and real review mounted while closed, preserves edited drafts and source inputs through toggles and reopen", async () => {
    await mount(); const documents = setup(), independentReview = review();
    expect(documents.open).toBe(false); expect(independentReview.open).toBe(false);
    const useDocuments = button("Use supplied resume and cover"), reviewAction = button("Review current preparation");
    await click(documents.querySelector(":scope > summary")); expect(documents.open).toBe(true);
    await edit("Supplied resume for manual context", "EXACT RESUME SENTINEL");
    await click(documents.querySelector(":scope > summary")); expect(documents.open).toBe(false);
    await select(4); await edit("Your editable candidacy draft", "EXACT EDITED DRAFT SENTINEL");
    for (const disclosure of [documents, independentReview]) { await click(disclosure.querySelector(":scope > summary")); await click(disclosure.querySelector(":scope > summary")); }
    expect(button("Use supplied resume and cover")).toBe(useDocuments); expect(button("Review current preparation")).toBe(reviewAction);
    expect(field("Supplied resume for manual context").value).toBe("EXACT RESUME SENTINEL");
    await select(0); await select(4); expect(field("Your editable candidacy draft").value).toBe("EXACT EDITED DRAFT SENTINEL");
    await act(async () => root.render(null)); await mount(); await select(4);
    expect(field("Your editable candidacy draft").value).toBe("EXACT EDITED DRAFT SENTINEL"); expect(field("Supplied resume for manual context").value).toBe("EXACT RESUME SENTINEL");
    noPost();
  });

  it("exposes source, strength and blocked review reason without opening either disclosure", async () => {
    await mount(); setup(); review();
    expect(outsideText()).toContain("Source context:"); expect(outsideText()).toContain("Current requested strength");
    expect(outsideText()).toContain("Historical document-generation strength: unknown");
    await vi.waitFor(() => expect(outsideText()).toMatch(/review status:\s*unreviewed/i));
    // The exact current reason comes from the real mounted review, not a fake receipt.
    const inner = host.querySelector('[aria-label="Independent adversarial review"]');
    const reason = [...inner.querySelectorAll("p")].find(node => /No independent semantic review has been completed|Build and bind current draft\/source identities first/.test(node.textContent));
    expect(reason, "actual acceptance reason exists").toBeTruthy(); expect(outsideText()).toContain(compact(reason));
    expect(button("Accept reviewed suggestion").disabled).toBe(true); noPost();
  });

  it("keeps numeric source conflicts visible outside closed setup after explicit local source selection", async () => {
    const value = createWorkspace(); value.inputs.resume = "I led migration delivery for 10 engineers."; value.inputs.coverLetter = "I led migration delivery for 20 engineers.";
    await mount(value); const disclosure = setup(); await click(disclosure.querySelector(":scope > summary")); await click(button("Use supplied resume and cover"));
    await vi.waitFor(() => expect(host.textContent).toContain("different numbers/dates"));
    if (disclosure.open) await click(disclosure.querySelector(":scope > summary"));
    expect(outsideText()).toContain("different numbers/dates"); expect(outsideText()).toContain("Source context: ready"); noPost();
  });

  it("keeps corruption recovery visible while setup and review remain closed", async () => {
    window.localStorage.setItem(key, "{CORRUPT SENTINEL"); await mount();
    expect(outsideText()).toContain("Saved data is corrupt");
    const reset = button("Reset this workspace"); expect(reset.closest("details:not([open])")).toBeNull();
    await click(reset); button("Cancel reset"); await click(button("Cancel reset")); expect(window.localStorage.getItem(key)).toBe("{CORRUPT SENTINEL"); noPost();
  });

  it("retains unsaved drafts and exposes storage failure and retry outside closed disclosures", async () => {
    await mount(); await select(0); const writer = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("UX quota failure sentinel"); });
    await edit("Company", "RETAIN UNSAVED COMPANY"); expect(outsideText()).toContain("UX quota failure sentinel");
    const retry = button("Retry saving"); expect(retry).toBeTruthy(); expect(retry.closest("details:not([open])")).toBeNull();
    expect(field("Company").value).toBe("RETAIN UNSAVED COMPANY"); writer.mockRestore(); await click(retry);
    expect(JSON.parse(window.localStorage.getItem(key)).inputs.company).toBe("RETAIN UNSAVED COMPANY"); noPost();
  });

  it("derives saved, suggested and practice navigation statuses from actual saved aliases", async () => {
    const value = createWorkspace(); const artifact = draft => ({ draft, version: 1, contextId: null, claimEvidence: [], history: [], suggestion: null });
    value.artifacts.brief = artifact("SAVED BRIEF"); value.artifacts.sample = artifact("SAVED SAMPLE"); value.artifacts.repairSuggestion = { ...artifact(""), suggestion: { text: "SUGGESTED REPAIR", basis: "local" } };
    await mount(value); expect(compact(buttons()[0])).toMatch(/(?:saved draft|draft saved)/i); expect(compact(buttons()[8])).toMatch(/(?:saved draft|draft saved)/i); expect(compact(buttons()[9])).toMatch(/unreviewed suggestion/i); expect(compact(buttons()[1])).toMatch(/not started/i);
    await act(async () => root.render(null)); value.artifacts.sample = artifact(""); value.attempts = [{ id: "typed-answer", question: "Ownership?", answer: "ACTUAL SAVED PRACTICE", seconds: 30, review: null }]; await mount(value);
    expect(compact(buttons()[8])).toMatch(/saved practice answer/i); noPost();
  });

  it("offers a native skip link to the focusable active heading without hydration stealing focus", async () => {
    const before = document.createElement("button"); document.body.appendChild(before); before.focus();
    try {
      await mount(); expect(document.activeElement).toBe(before);
      const link = [...host.querySelectorAll('a[href^="#"]')].find(node => /skip.*(?:tool|activity|preparation)/i.test(node.textContent)); expect(link).toBeTruthy();
      for (const index of [0, 4, 11]) { await select(index); const target = document.getElementById(link.hash.slice(1)); expect(target).toBeTruthy(); expect(target.matches("h1,h2,h3,h4,h5,h6")).toBe(true); expect(target.tabIndex).toBe(-1); target.focus(); expect(document.activeElement).toBe(target); }
      // Native buttons and direct summary children carry keyboard semantics; actual Enter/Space is a browser oracle.
      for (const disclosure of [setup(), review()]) expect(disclosure.querySelector(":scope > summary")).toBeTruthy(); noPost();
    } finally { before.remove(); }
  });
});
