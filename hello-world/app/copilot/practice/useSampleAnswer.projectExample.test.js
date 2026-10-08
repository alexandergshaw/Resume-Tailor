// @vitest-environment jsdom
//
// Practice mode's half of the example-projects group: the sample answer carries
// Row 1 (picked server-side, riding the answer response) and fires Row 2 (an
// invented project for this question) after the answer lands. Row 2 is driven
// with DELAYED promises -- an immediate mock would prove nothing about the two
// properties that matter: that it never blocks the answer, and that a late
// result for a draft that has been replaced paints nothing.

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

describe("a fresh sample answer", () => {
  it("carries Row 1 from the response and fires Row 2 after the answer lands", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("Row one title")));
    await mount();
    await act(async () => api.toggle());

    expect(api.status).toBe("done");
    expect(api.projectExample.title).toBe("Row one title");
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
    const arg = answerClient.fetchProjectExampleLive.mock.calls[0][0];
    expect(arg.applicationId).toBe("app-1");
    expect(arg.question).toBe(QUESTION);
    expect(api.projectExampleLive).toEqual({ status: "pending" });

    await act(async () => liveCalls[0].resolve({ projectExample: READY("Row two title") }));
    expect(api.projectExampleLive.title).toBe("Row two title");
  });

  it("settles a failing Row 2 as failed and leaves the answer untouched", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("Row one title")));
    await mount();
    await act(async () => api.toggle());
    await act(async () => liveCalls[0].reject(new Error("model down")));
    expect(api.status).toBe("done");
    expect(api.points).toEqual(["I led the response."]);
    expect(api.projectExampleLive).toEqual({ status: "failed" });
  });

  it("fires no Row 2 and shows no Row 1 when there is no application or the response carried none", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(undefined));
    await mount({ ...BASE, applicationId: null });
    await act(async () => api.toggle());
    expect(api.status).toBe("done");
    expect(api.projectExample).toBeUndefined();
    expect(api.projectExampleLive).toBeUndefined();
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
  });

  it("fires no Row 2 when the answer carried no Row 1, even with an application selected (the server's 'does not apply' signal)", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(undefined));
    await mount();
    await act(async () => api.toggle());
    expect(api.status).toBe("done");
    expect(api.projectExample).toBeUndefined();
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
    expect(api.projectExampleLive).toBeUndefined();
  });

  it("fires no Row 2 for the embedded engine, whatever the answer carried", async () => {
    localStorage.setItem("tailorEngine", "embedded");
    try {
      answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("Row one title")));
      await mount();
      await act(async () => api.toggle());
      expect(api.status).toBe("done");
      expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
      expect(api.projectExampleLive).toBeUndefined();
    } finally {
      localStorage.clear();
    }
  });

  it("still fires Row 2 when Row 1 is warming or failed (the feature applies; only the pool is not ready)", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse({ status: "pending" }));
    await mount();
    await act(async () => api.toggle());
    expect(api.projectExample).toEqual({ status: "pending" });
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
  });

  it("drops a late Row 2 from a draft that a Regenerate has since replaced (positive control: the newer one paints)", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("Row one title")));
    await mount();
    await act(async () => api.toggle());
    const stale = liveCalls[0];

    await act(async () => api.regenerate());
    expect(liveCalls).toHaveLength(2);
    const current = liveCalls[1];

    await act(async () => stale.resolve({ projectExample: READY("STALE") }));
    expect(api.projectExampleLive?.title).not.toBe("STALE");

    await act(async () => current.resolve({ projectExample: READY("CURRENT") }));
    expect(api.projectExampleLive.title).toBe("CURRENT");
  });
});

describe("a sample answer revealed from the queue's cache", () => {
  it("fires a FRESH Row 2 (it makes no request of its own) and carries a final Row 1", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse(READY("Cached row one")));
    await mount();
    await act(async () => api.queue(QUESTION, "", "general", "app-1", "auto"));
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());
    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
    expect(api.projectExample.title).toBe("Cached row one");
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
    expect(api.projectExampleLive).toEqual({ status: "pending" });
    await act(async () => liveCalls[0].resolve({ projectExample: READY("Fresh row two") }));
    expect(api.projectExampleLive.title).toBe("Fresh row two");
  });

  it("does not replay a non-final Row 1 (a cached 'still being prepared' would outlive the pool it described)", async () => {
    answerClient.draftAnswer.mockResolvedValue(answerResponse({ status: "pending" }));
    await mount();
    await act(async () => api.queue(QUESTION, "", "general", "app-1", "auto"));
    await act(async () => api.toggle());
    expect(api.status).toBe("done");
    expect(api.projectExample).toBeUndefined();
  });
});
