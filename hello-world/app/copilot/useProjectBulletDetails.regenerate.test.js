// @vitest-environment jsdom
//
// N155 — useProjectBulletDetails.regenerate(descriptor, {context}) (AC3) and the
// N153 coexistence (AC17 forced). regenerate takes the SAME descriptor the hook's
// toggle takes ({title, bulletIndex, bullet}), resolves the EXISTING key, forces a
// fetch, and rides the context in the request — never the key.
//
// RED on HEAD, on the assertion: each behavioural case leads with the typeof check.
// The key-function greps (both projectBulletDetailKey and the hook's indexKeyFor)
// are the GREEN guard half.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const fetchProjectBulletDetail = vi.fn();
vi.mock("@/lib/copilot/projectBulletDetailClient", () => ({ fetchProjectBulletDetail: (...a) => fetchProjectBulletDetail(...a) }));

import { ProjectBulletDetailScope, useProjectBulletDetailApi } from "./useProjectBulletDetails.js";
import { resetProjectBulletDetailStore } from "@/lib/copilot/projectBulletDetailStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EXAMPLE = {
  status: "ready",
  title: "Rebuilt the paging rotation",
  competency: "incident response",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within the target"],
};
const QUESTIONS = [{ id: "q1", question: "Tell me about reducing toil.", projectExample: EXAMPLE }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };
const DESCRIPTOR = { title: EXAMPLE.title, bulletIndex: 0, bullet: EXAMPLE.bullets[0] };

let latestApi = null;
function Probe() {
  latestApi = useProjectBulletDetailApi();
  return null;
}

let container;
let root;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetProjectBulletDetailStore();
  fetchProjectBulletDetail.mockReset();
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
  await act(async () => root.render(createElement(ProjectBulletDetailScope, { questions: QUESTIONS, request: REQUEST }, createElement(Probe))));
}

describe("AC3 — regenerate overwrites the current key, context rides the request", () => {
  it("exposes a regenerate method taking the SAME descriptor shape as toggle", async () => {
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");
  });

  it("two different contexts write to ONE key (never a forked sibling)", async () => {
    fetchProjectBulletDetail.mockImplementation(async (req) => ({ detail: `ctx:${req.userContext}`, empty: false }));
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");

    const key = latestApi.keyFor(DESCRIPTOR);
    await act(async () => { latestApi.regenerate(DESCRIPTOR, { context: "first" }); await flush(); });
    expect(latestApi.keyFor(DESCRIPTOR)).toBe(key);
    await act(async () => { latestApi.regenerate(DESCRIPTOR, { context: "second" }); await flush(); });

    expect(latestApi.get(DESCRIPTOR).detail).toBe("ctx:second");
    const contextsSent = fetchProjectBulletDetail.mock.calls.map((c) => c[0].userContext);
    expect(contextsSent).toContain("first");
    expect(contextsSent).toContain("second");
  });

  it("[guard] neither projectBulletDetailKey nor indexKeyFor carries userContext/context", () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const contract = strip(readFileSync(path.join(process.cwd(), "lib/copilot/projectBulletDetailContract.js"), "utf8"));
    const keyFn = contract.slice(contract.indexOf("export function projectBulletDetailKey"));
    expect(keyFn).not.toContain("userContext");
    const hook = strip(readFileSync(path.join(process.cwd(), "app/copilot/useProjectBulletDetails.js"), "utf8"));
    const indexKeyFor = hook.slice(hook.indexOf("function indexKeyFor"), hook.indexOf("function indexBullets"));
    expect(indexKeyFor).not.toContain("userContext");
  });
});

describe("AC17 — a regenerate forces a fetch over a settled/prefetched record", () => {
  it("fetches again even though the record already settled", async () => {
    fetchProjectBulletDetail.mockResolvedValue({ detail: "base", empty: false });
    await mount();
    expect(typeof latestApi.regenerate).toBe("function");

    await act(async () => { latestApi.toggle(DESCRIPTOR); await flush(); });
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(1);

    await act(async () => { latestApi.regenerate(DESCRIPTOR, { context: "" }); await flush(); });
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(2);
  });
});
