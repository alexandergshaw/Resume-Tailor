// @vitest-environment jsdom
//
// N143 fix round F2, practice mode (useSampleAnswer). Two properties:
//
//   m1  A Row 2 still in flight when the draft it belongs to is replaced never
//       leaves a pending placeholder behind. Verified reachable-or-not here
//       rather than assumed: the practice hook writes state wholesale on every
//       path that moves its Row 2 generation, so the old pending cannot
//       survive -- these cases pin that, including the path where the NEW
//       draft fails, which is the one a one-sided "drop the stale settle" fix
//       would strand.
//   heal  a FRESH answer (a real request or a silent queue) reports its Row 1
//       status and application to onRowOneStatus, the pool prewarm's
//       self-heal; a reveal served from the cache makes no server call and
//       reports nothing; a throwing callback cannot turn a delivered answer
//       into an error card.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const liveCalls = [];
function makeDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const READY = (title) => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title,
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
});

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  fetchProjectExampleLive: vi.fn(() => {
    const d = makeDeferred();
    liveCalls.push(d);
    return d.promise;
  }),
}));

import { useSampleAnswer } from "./useSampleAnswer.js";
import * as answerClient from "@/lib/copilot/answerClient.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Tell me about an incident you handled.";
const BASE = { question: QUESTION, profile: "", interviewType: "general", applicationId: "app-1", codeLanguage: "auto" };

let api;
function Probe(props) {
  api = useSampleAnswer(props);
  return null;
}

let root;
async function mount(props = BASE) {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe, props)));
}

async function rerender(props) {
  await act(async () => root.render(createElement(Probe, props)));
}

const answerResponse = (projectExample) => ({
  points: ["I led the response."],
  cues: ["the response"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [null],
  grounding: { resume: false, coverLetter: false, pages: false },
  ...(projectExample ? { projectExample } : {}),
});

beforeEach(() => {
  liveCalls.length = 0;
  answerClient.draftAnswer.mockReset();
  answerClient.fetchProjectExampleLive.mockClear();
});

describe("m1 -- a replaced draft never strands a pending Row 2", () => {
  it("[control] the pending placeholder shows while Row 2 is in flight", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("one")));
    await mount();
    await act(async () => api.toggle());
    expect(api.projectExampleLive).toEqual({ status: "pending" });
  });

  it("a Regenerate while Row 2 is pending replaces the row; the old settle neither repaints nor strands it", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("one")));
    await mount();
    await act(async () => api.toggle());
    const old = liveCalls[0];

    const next = makeDeferred();
    answerClient.draftAnswer.mockReturnValueOnce(next.promise);
    await act(async () => api.regenerate());
    // The new draft is loading: nothing of the old Row 2 is carried across.
    expect(api.status).toBe("loading");
    expect(api.projectExampleLive).toBeUndefined();

    await act(async () => old.resolve({ projectExample: READY("OLD LIVE") }));
    expect(api.projectExampleLive).toBeUndefined();

    await act(async () => next.resolve(answerResponse(READY("two"))));
    expect(api.status).toBe("done");
    expect(api.projectExampleLive).toEqual({ status: "pending" });
    await act(async () => liveCalls[1].resolve({ projectExample: READY("NEW LIVE") }));
    expect(api.projectExampleLive.title).toBe("NEW LIVE");
  });

  it("a Regenerate whose NEW draft fails leaves no pending Row 2 on the error card", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("one")));
    await mount();
    await act(async () => api.toggle());
    expect(api.projectExampleLive).toEqual({ status: "pending" });

    answerClient.draftAnswer.mockRejectedValueOnce(new Error("model down"));
    await act(async () => api.regenerate());
    expect(api.status).toBe("error");
    expect(api.projectExampleLive).toBeUndefined();
    expect(api.projectExample).toBeUndefined();

    // And the old Row 2 settling afterwards still cannot reach the error card.
    await act(async () => liveCalls[0].resolve({ projectExample: READY("OLD LIVE") }));
    expect(api.projectExampleLive).toBeUndefined();
  });

  it("moving to another question and revealing its queued draft takes the panel wholesale; the first question's late Row 2 paints nothing on it", async () => {
    const OTHER = "Describe a time you disagreed with a teammate.";
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("one")));
    await mount();
    await act(async () => api.toggle());
    const first = liveCalls[0];
    expect(api.projectExampleLive).toEqual({ status: "pending" });

    // The second question's draft was queued silently while the first was open.
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("two")));
    await act(async () => api.queue(OTHER, "", "general", "app-1", "auto"));
    await rerender({ ...BASE, question: OTHER });
    await act(async () => api.toggle());
    expect(api.status).toBe("done");
    expect(api.projectExample.title).toBe("two");
    expect(api.projectExampleLive).toEqual({ status: "pending" });
    expect(liveCalls).toHaveLength(2);

    await act(async () => first.resolve({ projectExample: READY("FIRST LIVE") }));
    expect(api.projectExampleLive).toEqual({ status: "pending" });
    await act(async () => liveCalls[1].resolve({ projectExample: READY("SECOND LIVE") }));
    expect(api.projectExampleLive.title).toBe("SECOND LIVE");
  });
});

describe("heal -- a fresh answer reports its Row 1 status to the pool prewarm", () => {
  it("a revealed (real request) answer reports the application and the status", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse({ status: "pending" }));
    const onRowOneStatus = vi.fn();
    await mount({ ...BASE, onRowOneStatus });
    await act(async () => api.toggle());
    expect(onRowOneStatus).toHaveBeenCalledTimes(1);
    expect(onRowOneStatus).toHaveBeenCalledWith("app-1", "pending");
  });

  it("a silent queue reports too, and the later reveal from its cache reports nothing more", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse({ status: "pending" }));
    const onRowOneStatus = vi.fn();
    await mount({ ...BASE, onRowOneStatus });
    await act(async () => api.queue(QUESTION, "", "general", "app-1", "auto"));
    expect(onRowOneStatus).toHaveBeenCalledTimes(1);
    expect(onRowOneStatus).toHaveBeenCalledWith("app-1", "pending");

    await act(async () => api.toggle());
    expect(api.status).toBe("done");
    expect(onRowOneStatus).toHaveBeenCalledTimes(1);
  });

  it("an answer that carried no Row 1 reports an undefined status (the receiver ignores it)", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(undefined));
    const onRowOneStatus = vi.fn();
    await mount({ ...BASE, onRowOneStatus });
    await act(async () => api.toggle());
    expect(onRowOneStatus).toHaveBeenCalledWith("app-1", undefined);
  });

  it("a callback that throws cannot turn the delivered answer into an error card", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse({ status: "pending" }));
    await mount({
      ...BASE,
      onRowOneStatus: () => {
        throw new Error("boom");
      },
    });
    await act(async () => api.toggle());
    expect(api.status).toBe("done");
    expect(api.error).toBe("");
  });

  it("works with no callback at all (every caller that predates it)", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse({ status: "pending" }));
    await mount();
    await act(async () => api.toggle());
    expect(api.status).toBe("done");
  });
});
