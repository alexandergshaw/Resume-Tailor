// @vitest-environment jsdom
//
// N155 — useTechTermDetails.regenerate(term, {context}) (AC3) and the N153
// coexistence (AC17 forced). regenerate takes the SAME arg the hook's toggle takes
// (a bare term string), resolves the EXISTING key, forces a fetch, and rides the
// context in the request — never the key.
//
// RED on HEAD, on the assertion: each behavioural case leads with the typeof check,
// which fails cleanly on HEAD. The key-function grep is the GREEN guard half.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const fetchTechTermDetail = vi.fn();
vi.mock("@/lib/copilot/techTermDetailClient", () => ({ fetchTechTermDetail: (...a) => fetchTechTermDetail(...a) }));

import { TechTermDetailScope, useTechTermDetailApi } from "./useTechTermDetails.js";
import { resetTechTermDetailStore } from "@/lib/copilot/techTermDetailStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TERM = "idempotency keys";
const QUESTIONS = [{ id: "q1", question: "How do you make retries safe?", techTerms: { status: "ready", terms: [TERM] } }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

let latestApi = null;
function Probe() {
  latestApi = useTechTermDetailApi();
  return null;
}

let container;
let root;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetTechTermDetailStore();
  fetchTechTermDetail.mockReset();
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
  await act(async () => root.render(createElement(TechTermDetailScope, { questions: QUESTIONS, request: REQUEST }, createElement(Probe))));
}

describe("AC3 — regenerate overwrites the current key, context rides the request", () => {
  it("exposes a regenerate method taking the SAME arg shape as toggle (a term string)", async () => {
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");
  });

  it("two different contexts write to ONE key (never a forked sibling)", async () => {
    fetchTechTermDetail.mockImplementation(async (req) => ({ detail: `ctx:${req.userContext}`, empty: false }));
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");

    const key = latestApi.keyFor(TERM);
    await act(async () => { latestApi.regenerate(TERM, { context: "first" }); await flush(); });
    expect(latestApi.keyFor(TERM)).toBe(key);
    await act(async () => { latestApi.regenerate(TERM, { context: "second" }); await flush(); });

    expect(latestApi.get(TERM).detail).toBe("ctx:second");
    const contextsSent = fetchTechTermDetail.mock.calls.map((c) => c[0].userContext);
    expect(contextsSent).toContain("first");
    expect(contextsSent).toContain("second");
  });

  it("[guard] techTermDetailKey never carries userContext/context (context not in the key)", () => {
    const src = readFileSync(path.join(process.cwd(), "lib/copilot/techTermDetailContract.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const keyFn = src.slice(src.indexOf("export function techTermDetailKey"));
    expect(keyFn).not.toContain("userContext");
  });
});

describe("AC17 — a regenerate forces a fetch over a settled/prefetched record", () => {
  it("fetches again even though the record already settled", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "base", empty: false });
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");

    await act(async () => { latestApi.toggle(TERM); await flush(); });
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(1);

    await act(async () => { latestApi.regenerate(TERM, { context: "" }); await flush(); });
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(2);
  });
});
