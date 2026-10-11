// @vitest-environment jsdom
//
// N155 — useAnswerExpansions.regenerate(line, {context}) (AC3) and the N153
// coexistence (AC17 forced): regenerate resolves the item's EXISTING key, forces a
// fetch over a settled/prefetched record, and rides the context in the REQUEST —
// never in the key, so two different contexts overwrite ONE key rather than forking
// a sibling.
//
// RED on HEAD, on the assertion: each behavioural case LEADS with
// `expect(typeof api.regenerate).toBe("function")`, which fails cleanly on HEAD
// (the method does not exist) rather than throwing an uncaught TypeError. The
// "context not in the key" grep is the GREEN guard half of AC3.
//
// Driven through the REAL scope and the REAL store; only the network client is
// replaced, so the key, the dedupe and the force path are all the real ones.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const fetchExpansion = vi.fn();
vi.mock("@/lib/copilot/expansionClient", () => ({ fetchExpansion: (...a) => fetchExpansion(...a) }));

import { ExpansionScope, useExpansionApi } from "./useAnswerExpansions.js";
import { resetExpansionStore } from "@/lib/copilot/expansionStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINE = { label: "", cue: "", point: "I ran the postmortem with the payments group the next morning.", pageSource: null, emphasis: null, sourceIndex: 0 };
const QUESTIONS = [{ id: 1, question: "Tell me about a failure.", points: ["I ran the postmortem with the payments group the next morning."], status: "done" }];
const REQUEST = { applicationId: "app-1", profile: "", interviewType: "behavioral", codeLanguage: "auto", engine: "embedded" };

let latestApi = null;
function Probe() {
  latestApi = useExpansionApi();
  return null;
}

let container;
let root;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetExpansionStore();
  fetchExpansion.mockReset();
  latestApi = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () => root.render(createElement(ExpansionScope, { questions: QUESTIONS, request: REQUEST }, createElement(Probe))));
}

describe("AC3 — regenerate overwrites the current key, context rides the request", () => {
  it("exposes a regenerate method taking the SAME arg shape as toggle", async () => {
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");
  });

  it("two different contexts write to ONE key (never a forked sibling)", async () => {
    fetchExpansion.mockImplementation(async (req) => ({
      subBullets: [{ text: `ctx:${req.userContext}`, pageSource: null, source: null }],
      caption: "",
      empty: false,
    }));
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");

    const key = latestApi.keyFor(LINE);
    await act(async () => { latestApi.regenerate(LINE, { context: "first" }); await flush(); });
    expect(latestApi.keyFor(LINE)).toBe(key); // the key did not move
    await act(async () => { latestApi.regenerate(LINE, { context: "second" }); await flush(); });

    // The record under the one key reflects the LAST context — not a sibling keyed
    // on the context. A build that put context in the key would write "second" under
    // a different key, leaving keyFor(LINE)'s record showing "first".
    expect(latestApi.get(LINE).subBullets[0].text).toBe("ctx:second");
    const contextsSent = fetchExpansion.mock.calls.map((c) => c[0].userContext);
    expect(contextsSent).toContain("first");
    expect(contextsSent).toContain("second");
  });

  it("[guard] the key functions never carry userContext/context (context not in the key)", () => {
    const contractSrc = readFileSync(path.join(process.cwd(), "lib/copilot/expansionContract.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const keyFn = contractSrc.slice(contractSrc.indexOf("export function expansionKey"));
    expect(keyFn).not.toContain("userContext");
  });
});

describe("AC17 — a regenerate forces a fetch over a settled/prefetched record", () => {
  it("fetches again even though the record already settled", async () => {
    fetchExpansion.mockResolvedValue({ subBullets: [{ text: "base", pageSource: null, source: null }], caption: "", empty: false });
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");

    // Settle the record the way a click would (one fetch).
    await act(async () => { latestApi.toggle(LINE); await flush(); });
    expect(fetchExpansion).toHaveBeenCalledTimes(1);

    // A regenerate forces a fresh fetch over that settled record (N153 dedupe bypassed).
    await act(async () => { latestApi.regenerate(LINE, { context: "" }); await flush(); });
    expect(fetchExpansion).toHaveBeenCalledTimes(2);
  });
});
