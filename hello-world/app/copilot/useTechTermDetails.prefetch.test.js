// @vitest-environment jsdom
//
// N153 — the tech-term api's new keyFor/prefetch methods AND the relocated
// session-log semantics (ruling L1, design §7). RED on HEAD: the api exposes no
// keyFor/prefetch today, so api.prefetch is undefined and the calls below throw.
//
// Driven through the REAL TechTermDetailScope + the real store; only the network
// CLIENT is mocked (the existing suite's pattern). The warm LEAF wiring and the
// collapse gating are a separate real-parent test (AnswerAids.warmOnMount.test.js);
// here the methods and the logging trigger are exercised directly.
//
// The L1 ruling this pins (ledger N153-L9):
//   • a prefetch NEVER emits the detail-outcome log (the log records terms the
//     candidate OPENED, and auto-prefetch is not an open);
//   • the FIRST user-open of a term logs its outcome once, deduped per key for
//     the scope's lifetime — including when the record was already warmed by a
//     prefetch (the open-driven report reads the settled store).
// The headline teeth: a build where prefetch logs (ruling L3) reds "a prefetch
// never logs"; a build where open stopped logging reds "the first open logs once".

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchTechTermDetail = vi.fn();
vi.mock("@/lib/copilot/techTermDetailClient", () => ({
  fetchTechTermDetail: (...args) => fetchTechTermDetail(...args),
}));

import { TechTermDetailScope, useTechTermDetailApi } from "./useTechTermDetails.js";
import { resetTechTermDetailStore } from "@/lib/copilot/techTermDetailStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TERMS = ["idempotency keys", "circuit breaker"];
const TECH_TERMS = { status: "ready", terms: TERMS };
const QUESTIONS = [{ id: "q1", question: "How do you make retries safe?", techTerms: TECH_TERMS }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

let container;
let root;
let api;

function Probe() {
  api = useTechTermDetailApi();
  return null;
}

beforeEach(() => {
  resetTechTermDetailStore();
  fetchTechTermDetail.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mountScope({ onDetailOutcome } = {}) {
  await act(async () =>
    root.render(
      createElement(TechTermDetailScope, { questions: QUESTIONS, request: REQUEST, onDetailOutcome }, createElement(Probe)),
    ),
  );
}

// A settle flush: begin* writes its terminal record a few microtasks after the
// fetcher resolves; this lets that write and any open-driven report land.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("keyFor and prefetch exist and resolve the term", () => {
  it("keyFor returns a stable string for a resolvable term and null otherwise", async () => {
    await mountScope();
    expect(typeof api.keyFor).toBe("function");
    const k = api.keyFor("idempotency keys");
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
    expect(api.keyFor("idempotency keys")).toBe(k);
    expect(api.keyFor("a term no answer suggested")).toBeNull();
  });

  it("prefetch issues one request and never opens the chip", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "Idempotency keys make a retry safe.", empty: false });
    await mountScope();
    await act(async () => api.prefetch("idempotency keys"));
    await settle();
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(1);
    expect(api.isOpen("idempotency keys")).toBe(false);
    expect(api.get("idempotency keys").status).toBe("done");
  });

  it("a click after a prefetch issues no second request", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "x", empty: false });
    await mountScope();
    await act(async () => api.prefetch("idempotency keys"));
    await settle();
    await act(async () => api.toggle("idempotency keys"));
    await settle();
    expect(api.isOpen("idempotency keys")).toBe(true);
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(1);
  });
});

describe("L1: prefetch never logs; the first user-open logs once", () => {
  it("a prefetch that is never opened emits NO outcome log", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "x", empty: false });
    const onDetailOutcome = vi.fn();
    await mountScope({ onDetailOutcome });
    await act(async () => api.prefetch("idempotency keys"));
    await settle();
    // The record is settled, but the candidate never opened it — the log, which
    // records terms the candidate EXPLORED, must stay silent.
    expect(api.get("idempotency keys").status).toBe("done");
    expect(onDetailOutcome).not.toHaveBeenCalled();
  });

  it("the first OPEN of a prefetched term logs its outcome once, and a reopen logs nothing", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "x", empty: false });
    const onDetailOutcome = vi.fn();
    await mountScope({ onDetailOutcome });

    await act(async () => api.prefetch("idempotency keys"));
    await settle();
    expect(onDetailOutcome).not.toHaveBeenCalled();

    // First user-open: logs once, reading the already-settled store.
    await act(async () => api.toggle("idempotency keys"));
    await settle();
    expect(onDetailOutcome).toHaveBeenCalledTimes(1);
    expect(onDetailOutcome).toHaveBeenCalledWith({ term: "idempotency keys", status: "done", code: null });

    // Collapse and reopen: deduped by the scope's loggedRef -> still once.
    await act(async () => api.toggle("idempotency keys"));
    await settle();
    await act(async () => api.toggle("idempotency keys"));
    await settle();
    expect(onDetailOutcome).toHaveBeenCalledTimes(1);
  });

  it("an ordinary open (no prefetch) still logs its outcome once", async () => {
    // The log did not disappear with the relocation: a term opened directly,
    // never prefetched, still reports exactly once.
    fetchTechTermDetail.mockResolvedValue({ detail: "x", empty: false });
    const onDetailOutcome = vi.fn();
    await mountScope({ onDetailOutcome });
    await act(async () => api.toggle("circuit breaker"));
    await settle();
    expect(onDetailOutcome).toHaveBeenCalledTimes(1);
    expect(onDetailOutcome).toHaveBeenCalledWith({ term: "circuit breaker", status: "done", code: null });
  });

  it("reports a failed open with its enumerated code, never the provider message", async () => {
    fetchTechTermDetail.mockRejectedValue(Object.assign(new Error("raw provider text"), { code: "timeout" }));
    const onDetailOutcome = vi.fn();
    await mountScope({ onDetailOutcome });
    await act(async () => api.toggle("idempotency keys"));
    await settle();
    expect(onDetailOutcome).toHaveBeenCalledWith({ term: "idempotency keys", status: "error", code: "timeout" });
    expect(JSON.stringify(onDetailOutcome.mock.calls)).not.toContain("raw provider text");
  });
});
