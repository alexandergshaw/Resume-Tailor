// @vitest-environment jsdom
//
// N154 — the per-bullet-detail scope's resolve/keyFor/prefetch/toggle/retry
// (app/copilot/useProjectBulletDetails.js). RED on HEAD: the module does not
// exist, so the import fails at collection.
//
// Driven through the REAL ProjectBulletDetailScope + the real store; only the
// network CLIENT is mocked. The warm-leaf wiring and collapse gating are a
// separate real-parent test (AnswerAids.projectBulletDetail.warmOnMount.test.js);
// here the api methods and the logging trigger are exercised directly.
//
// Headline teeth:
//   • R1 (positive control): a REAL bullet from a REAL questions fixture resolves
//     — resolves(descriptor) true. The silent failure of this whole feature is a
//     control that renders nothing because the scope's index key and the
//     control's descriptor compute different strings.
//   • R2: keyFor (the warm key) and toggle (the click) go through the SAME
//     resolve, so a click after a prefetch issues no second paid request and
//     opens the record the warm already filled.
//   • R5 (stability half): keyFor returns the SAME string across calls, so the
//     warm fires once per key, not once per store write.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchProjectBulletDetail = vi.fn();
vi.mock("@/lib/copilot/projectBulletDetailClient", () => ({
  fetchProjectBulletDetail: (...args) => fetchProjectBulletDetail(...args),
}));

import { ProjectBulletDetailScope, useProjectBulletDetailApi } from "./useProjectBulletDetails.js";
import { resetProjectBulletDetailStore } from "@/lib/copilot/projectBulletDetailStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROW1 = {
  status: "ready",
  competency: "incident response",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within the target"],
  hypothetical: true,
  engine: "gemini",
};
const ROW2 = {
  status: "ready",
  competency: "",
  title: "Scaled a read-replica fleet",
  bullets: ["Added read replicas behind a proxy", "Cut p99 latency materially"],
  hypothetical: true,
  engine: "gemini",
};
const QUESTIONS = [{ id: "q1", question: "Tell me about an incident.", projectExample: ROW1, projectExampleLive: ROW2 }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

// What a bullet knows about itself — exactly what the control passes down.
const D1 = { title: ROW1.title, bulletIndex: 0, bullet: ROW1.bullets[0] };
const D1b = { title: ROW1.title, bulletIndex: 1, bullet: ROW1.bullets[1] };
const D2 = { title: ROW2.title, bulletIndex: 0, bullet: ROW2.bullets[0] };
const UNRESOLVABLE = { title: "A project no answer produced", bulletIndex: 0, bullet: "nope" };

let container;
let root;
let api;

function Probe() {
  api = useProjectBulletDetailApi();
  return null;
}

beforeEach(() => {
  resetProjectBulletDetailStore();
  fetchProjectBulletDetail.mockReset();
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
      createElement(
        ProjectBulletDetailScope,
        { questions: QUESTIONS, request: REQUEST, onDetailOutcome },
        createElement(Probe),
      ),
    ),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("resolve + keyFor (R1 positive control, R5 stability)", () => {
  it("[R1] a real bullet from a real questions fixture resolves; an unknown one does not", async () => {
    await mountScope();
    expect(api.resolves(D1)).toBe(true);
    expect(api.resolves(D1b)).toBe(true);
    expect(api.resolves(D2)).toBe(true); // Row 2 (projectExampleLive) is indexed too
    expect(api.resolves(UNRESOLVABLE)).toBe(false);
  });

  it("[R5] keyFor returns a stable non-empty string for a resolvable bullet, null otherwise", async () => {
    await mountScope();
    const k = api.keyFor(D1);
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
    // Stable across calls — this is what lets useWarmOnMount fire once per key.
    expect(api.keyFor(D1)).toBe(k);
    // Two different bullets of one project get different keys (no collision).
    expect(api.keyFor(D1b)).not.toBe(k);
    expect(api.keyFor(UNRESOLVABLE)).toBeNull();
  });
});

describe("prefetch and the dedupe against a later click (R2)", () => {
  it("prefetch issues one request through the queue and never opens the control", async () => {
    fetchProjectBulletDetail.mockResolvedValue({ detail: "A strong candidate might describe...", empty: false });
    await mountScope();
    await act(async () => api.prefetch(D1));
    await settle();
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(1);
    expect(api.isOpen(D1)).toBe(false);
    expect(api.get(D1).status).toBe("done");
  });

  it("[R2] a click after a prefetch opens the warmed record and issues NO second request", async () => {
    fetchProjectBulletDetail.mockResolvedValue({ detail: "warmed detail", empty: false });
    await mountScope();
    await act(async () => api.prefetch(D1));
    await settle();
    await act(async () => api.toggle(D1));
    await settle();
    expect(api.isOpen(D1)).toBe(true);
    // keyFor (warm) and toggle (click) share resolve, so the same key dedupes.
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(1);
    expect(api.get(D1).detail).toBe("warmed detail");
  });

  it("an unresolvable descriptor prefetches nothing and toggles nothing", async () => {
    await mountScope();
    await act(async () => api.prefetch(UNRESOLVABLE));
    await act(async () => api.toggle(UNRESOLVABLE));
    await settle();
    expect(fetchProjectBulletDetail).not.toHaveBeenCalled();
  });

  it("toggle opens directly (no prefetch) and retry only re-issues a settled error", async () => {
    fetchProjectBulletDetail.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "http" }));
    await mountScope();
    await act(async () => api.toggle(D1));
    await settle();
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(1);
    expect(api.get(D1).status).toBe("error");
    // A non-retry call does not re-issue a settled error.
    await act(async () => api.toggle(D1)); // collapse
    await act(async () => api.toggle(D1)); // reopen — settled error, no new call
    await settle();
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(1);
    // retry re-issues exactly once.
    fetchProjectBulletDetail.mockResolvedValueOnce({ detail: "second try", empty: false });
    await act(async () => api.retry(D1));
    await settle();
    expect(fetchProjectBulletDetail).toHaveBeenCalledTimes(2);
  });
});

describe("the session log records opens, not prefetches (L1)", () => {
  it("a prefetch that is never opened emits NO outcome log", async () => {
    fetchProjectBulletDetail.mockResolvedValue({ detail: "x", empty: false });
    const onDetailOutcome = vi.fn();
    await mountScope({ onDetailOutcome });
    await act(async () => api.prefetch(D1));
    await settle();
    expect(api.get(D1).status).toBe("done");
    expect(onDetailOutcome).not.toHaveBeenCalled();
  });

  it("the first OPEN of a prefetched bullet logs once; a reopen logs nothing", async () => {
    fetchProjectBulletDetail.mockResolvedValue({ detail: "x", empty: false });
    const onDetailOutcome = vi.fn();
    await mountScope({ onDetailOutcome });
    await act(async () => api.prefetch(D1));
    await settle();
    expect(onDetailOutcome).not.toHaveBeenCalled();

    await act(async () => api.toggle(D1));
    await settle();
    expect(onDetailOutcome).toHaveBeenCalledTimes(1);
    // The outcome carries status + code; whether the callback object carries
    // more is the scope's business — the NO-CONTENT-in-the-log rule is pinned at
    // the wiring by the PII census (AnswerAids.projectBulletDetail.sites.test.js).
    expect(onDetailOutcome.mock.calls[0][0]).toMatchObject({ status: "done", code: null });

    await act(async () => api.toggle(D1)); // collapse
    await settle();
    await act(async () => api.toggle(D1)); // reopen
    await settle();
    expect(onDetailOutcome).toHaveBeenCalledTimes(1);
  });

  it("reports a failed open with its enumerated code, never the provider message", async () => {
    fetchProjectBulletDetail.mockRejectedValue(Object.assign(new Error("raw provider text"), { code: "timeout" }));
    const onDetailOutcome = vi.fn();
    await mountScope({ onDetailOutcome });
    await act(async () => api.toggle(D1));
    await settle();
    expect(onDetailOutcome.mock.calls[0][0]).toMatchObject({ status: "error", code: "timeout" });
    expect(JSON.stringify(onDetailOutcome.mock.calls)).not.toContain("raw provider text");
  });
});
