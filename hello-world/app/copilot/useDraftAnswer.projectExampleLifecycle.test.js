// @vitest-environment jsdom
//
// N143 fix round F2, live mode (useDraftAnswer). Four properties, each against
// its own failure direction:
//
//   m3  Row 2 is gated on the ANSWER carrying a Row 1 value, like practice mode.
//       The server omits Row 1 exactly when the feature does not apply (no
//       application, or an engine the server treats as embedded), so firing on
//       the client's engine alone spent a request per question and flashed an
//       empty "Example projects" group while waiting to be told "nothing".
//   m1  A generation bump (posting / profile change, fresh Start) while Row 2 is
//       in flight must not leave the pending placeholder on the card forever:
//       the settle clears it. A newer draft that took the card is untouched.
//   probe  `projectExample.shown` carries fitScore and poolTags in LIVE mode,
//       so the owner probe reads the same evidence it reads in practice.
//   heal  a fresh answer reports its Row 1 status and application to
//       onRowOneStatus (the pool prewarm's self-heal), a reused answer does not,
//       and a throwing callback cannot turn a delivered answer into an error.
//
// Every Row 2 promise is a deferred the test settles by hand: an immediate mock
// would prove nothing about what stays on the card in the meantime.

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

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswerStreaming: vi.fn(),
  draftAnswer: vi.fn(),
  fetchProjectExampleLive: vi.fn(() => {
    const d = makeDeferred();
    liveCalls.push(d);
    return d.promise;
  }),
}));

import { useDraftAnswer } from "./useDraftAnswer.js";
import { groundingFor } from "@/lib/copilot/answerGrounding.js";
import { getInterviewType } from "./useInterviewType.js";
import { getCodeLanguage } from "./useCodeLanguage.js";
import * as answerClient from "@/lib/copilot/answerClient.js";
import { normalizeQuestion } from "@/lib/copilot/questions.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP = { id: "app-1" };
const QUESTION = "Tell me about an incident you handled.";
const READY_LIVE = {
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
};

const answer = (projectExample) => ({
  points: ["A drafted point."],
  type: "general",
  cues: [],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [],
  ...(projectExample === undefined ? {} : { projectExample }),
});

function mountHook({ onRowOneStatus } = {}) {
  const state = { questions: [{ id: "q1", status: "idle" }] };
  const logged = [];
  const draftGenRef = { current: 0 };
  const answerCacheRef = { current: new Map() };
  let runDraft = null;
  function Host() {
    runDraft = useDraftAnswer({
      profile: "",
      posting: APP,
      answerCacheRef,
      draftGenRef,
      buildContext: () => "",
      setQuestions: (updater) => {
        state.questions = updater(state.questions);
      },
      logEvent: (...args) => logged.push(args),
      onRowOneStatus,
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  return { state, logged, draftGenRef, answerCacheRef, run: () => runDraft, mount: () => act(async () => root.render(createElement(Host))) };
}

const entry = (state) => state.questions.find((q) => q.id === "q1");

beforeEach(() => {
  liveCalls.length = 0;
  answerClient.fetchProjectExampleLive.mockClear();
  answerClient.draftAnswerStreaming.mockReset();
  answerClient.draftAnswerStreaming.mockResolvedValue(answer({ status: "no_match" }));
});

describe("m3 -- Row 2 fires only when the answer carried a Row 1 value (live and practice are symmetric)", () => {
  it("[positive control] an answer carrying a Row 1 value fires exactly one Row 2 request", async () => {
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
    expect(entry(h.state).projectExampleLive).toEqual({ status: "pending" });
  });

  it("an answer with NO Row 1 value (server-embedded, or no application) fires no Row 2 and leaves no row on the card", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(answer(undefined));
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(entry(h.state).status).toBe("done");
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
    expect(entry(h.state).projectExampleLive).toBeUndefined();
    expect(entry(h.state).projectExample).toBeUndefined();
  });

  it("a malformed Row 1 value (no string status) counts as absent", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(answer({ nope: true }));
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
  });

  it("a Row 1 of any status gates it open, pending and failed included (Row 2 does not depend on the pool)", async () => {
    for (const status of ["pending", "failed", "ready", "no_match"]) {
      answerClient.fetchProjectExampleLive.mockClear();
      answerClient.draftAnswerStreaming.mockResolvedValue(answer({ status }));
      const h = mountHook();
      await h.mount();
      await act(async () => {
        await h.run()("q1", QUESTION);
      });
      expect(answerClient.fetchProjectExampleLive, status).toHaveBeenCalledTimes(1);
    }
  });

  it("a cache HIT follows the same gate: the cached answer's Row 1 presence decides", async () => {
    const h = mountHook();
    await h.mount();
    const grounding = groundingFor({
      profile: "",
      interviewType: getInterviewType(),
      applicationId: APP.id,
      codeLanguage: getCodeLanguage(),
    });
    const seed = { points: ["A cached point."], type: "general", cues: [], buzzwords: [], anchor: null, pageSources: [], ...grounding };

    h.answerCacheRef.current.set(normalizeQuestion(QUESTION), seed);
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(entry(h.state).cached).toBe(true);
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
    expect(entry(h.state).projectExampleLive).toBeUndefined();

    h.answerCacheRef.current.set(normalizeQuestion(QUESTION), { ...seed, projectExample: { status: "ready", title: "t", bullets: ["a"] } });
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
  });
});

describe("m1 -- a generation bump while Row 2 is in flight never leaves it pending", () => {
  it("clears the pending placeholder when the settle arrives after the generation moved", async () => {
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(entry(h.state).projectExampleLive).toEqual({ status: "pending" });

    // The user changes posting (CopilotClient bumps draftGenRef) mid-flight.
    h.draftGenRef.current += 1;
    await act(async () => {
      liveCalls[0].resolve({ projectExample: READY_LIVE });
    });
    expect(entry(h.state).projectExampleLive).toBeUndefined();
    // The answer itself is untouched by the clear.
    expect(entry(h.state).status).toBe("done");
    expect(entry(h.state).points).toEqual(["A drafted point."]);
    // And the superseded outcome is not logged as an outcome for this card.
    expect(h.logged.filter(([type]) => type === "projectExample.live")).toEqual([]);
  });

  it("clears on a failed settle too (the watchdog or a rejected request), not only a success", async () => {
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    h.draftGenRef.current += 1;
    await act(async () => {
      liveCalls[0].reject(new Error("network down"));
    });
    expect(entry(h.state).projectExampleLive).toBeUndefined();
  });

  it("[control] without a generation bump the same settle lands the example, and is logged", async () => {
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    await act(async () => {
      liveCalls[0].resolve({ projectExample: READY_LIVE });
    });
    expect(entry(h.state).projectExampleLive.title).toBe("Rebuilt the paging rotation");
    expect(h.logged.filter(([type]) => type === "projectExample.live")).toHaveLength(1);
  });

  it("a superseded settle never clears a NEWER draft's own pending row", async () => {
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    const first = liveCalls[0];

    h.draftGenRef.current += 1;
    await act(async () => {
      await h.run()("q1", QUESTION, { force: true });
    });
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(2);
    const second = liveCalls[1];
    expect(entry(h.state).projectExampleLive).toEqual({ status: "pending" });

    await act(async () => {
      first.resolve({ projectExample: READY_LIVE });
    });
    // The first draft's settle must neither paint nor clear the second's row.
    expect(entry(h.state).projectExampleLive).toEqual({ status: "pending" });

    await act(async () => {
      second.resolve({ projectExample: { ...READY_LIVE, title: "SECOND" } });
    });
    expect(entry(h.state).projectExampleLive.title).toBe("SECOND");
  });
});

describe("probe -- the live-mode projectExample.shown event carries the owner probe's evidence", () => {
  const POOL_TAGS = [
    { competency: "incident response", domain: "SRE", title: "Rebuilt the paging rotation" },
    { competency: "capacity planning", domain: "SRE", title: "Sized the launch fleet" },
  ];

  it("logs fitScore and poolTags next to status, competency and domain", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(
      answer({ ...READY_LIVE, fitScore: 2, poolTags: POOL_TAGS, engine: "gemini" }),
    );
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    const shown = h.logged.filter(([type]) => type === "projectExample.shown");
    expect(shown).toHaveLength(1);
    expect(shown[0][1]).toEqual({
      id: "q1",
      status: "ready",
      competency: "incident response",
      domain: "SRE",
      fitScore: 2,
      poolTags: POOL_TAGS,
    });
  });

  it("a no_match value logs its fitScore and pool too (the miss is the evidence)", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(answer({ status: "no_match", fitScore: 0, poolTags: POOL_TAGS }));
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    const [, payload] = h.logged.find(([type]) => type === "projectExample.shown");
    expect(payload).toMatchObject({ status: "no_match", fitScore: 0, poolTags: POOL_TAGS });
  });

  it("a pending value logs no evidence fields (there is no pick to explain)", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(answer({ status: "pending" }));
    const h = mountHook();
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    const [, payload] = h.logged.find(([type]) => type === "projectExample.shown");
    expect(payload.status).toBe("pending");
    expect(payload.fitScore).toBeUndefined();
    expect(payload.poolTags).toBeUndefined();
  });
});

describe("heal -- a fresh answer reports its Row 1 status to the pool prewarm", () => {
  it("reports the application and the status of a fresh answer's Row 1", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(answer({ status: "pending" }));
    const onRowOneStatus = vi.fn();
    const h = mountHook({ onRowOneStatus });
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(onRowOneStatus).toHaveBeenCalledTimes(1);
    expect(onRowOneStatus).toHaveBeenCalledWith(APP.id, "pending");
  });

  it("an answer with no Row 1 value reports an undefined status (the receiver ignores it)", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(answer(undefined));
    const onRowOneStatus = vi.fn();
    const h = mountHook({ onRowOneStatus });
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(onRowOneStatus).toHaveBeenCalledWith(APP.id, undefined);
  });

  it("a REUSED answer makes no server call and reports nothing", async () => {
    const onRowOneStatus = vi.fn();
    const h = mountHook({ onRowOneStatus });
    await h.mount();
    const grounding = groundingFor({
      profile: "",
      interviewType: getInterviewType(),
      applicationId: APP.id,
      codeLanguage: getCodeLanguage(),
    });
    h.answerCacheRef.current.set(normalizeQuestion(QUESTION), {
      points: ["A cached point."],
      type: "general",
      cues: [],
      buzzwords: [],
      anchor: null,
      pageSources: [],
      projectExample: { status: "pending" },
      ...grounding,
    });
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(entry(h.state).cached).toBe(true);
    expect(onRowOneStatus).not.toHaveBeenCalled();
  });

  it("a callback that throws cannot turn the delivered answer into an error card", async () => {
    answerClient.draftAnswerStreaming.mockResolvedValue(answer({ status: "pending" }));
    const h = mountHook({
      onRowOneStatus: () => {
        throw new Error("boom");
      },
    });
    await h.mount();
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(entry(h.state).status).toBe("done");
    expect(entry(h.state).error).toBeFalsy();
    expect(h.logged.some(([type]) => type === "answer.error")).toBe(false);
  });
});
