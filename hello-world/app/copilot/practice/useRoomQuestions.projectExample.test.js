// @vitest-environment jsdom
//
// N143 fix round F2 (m2): practice mode's detected-question cards
// (useRoomQuestions -> QuestionFeed) must show the example rows like every other
// producer. runDraft used to destructure only points/type/cues/buzzwords/
// resumeAnchor/pageSources, DROPPING projectExample, so a room-detected card
// rendered no example group at all while the server had done the pool read.
//
// The instrument is the REAL QuestionFeed fed by the REAL hook, asserted off the
// rendered DOM: a hook-state assertion alone would not catch a feed that never
// receives the props (measurement-instruments). Row 2 is driven with deferred
// promises so the in-between states are observable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  fetchProjectExampleLive: vi.fn(() => {
    const d = makeDeferred();
    liveCalls.push(d);
    return d.promise;
  }),
}));

import { useRoomQuestions } from "./useRoomQuestions.js";
import QuestionFeed from "../QuestionFeed.js";
import * as answerClient from "@/lib/copilot/answerClient.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GROUP_LABEL = "Example projects (invented)";
const R1_WARMING = "Still being prepared. Shows from your next question.";
const R1_NO_MATCH = "No close match for this question.";
const R2_PENDING = "Writing one for this question";
const QUESTION = "How would you scale this?";

const READY = (over = {}) => ({
  status: "ready",
  competency: "capacity planning",
  domain: "SRE",
  title: "Sized the launch fleet",
  bullets: ["Held p99 latency flat through a 4x launch", "Cut idle capacity from 40% to 15%"],
  hypothetical: true,
  ...over,
});

const answer = (projectExample) => ({
  points: ["Name the constraint first."],
  cues: ["Constraint"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [null],
  type: "technical",
  ...(projectExample === undefined ? {} : { projectExample }),
});

let latest;
function Harness({ applicationId = "app-1", onRowOneStatus }) {
  const room = useRoomQuestions({ applicationId, profile: "p", myTag: null, collecting: false, onRowOneStatus });
  latest = room;
  return createElement(QuestionFeed, { questions: room.questions, onDraft: room.onDraft });
}

let container;
let root;

async function mount(props) {
  await act(async () => root.render(createElement(Harness, props)));
}

async function ask(text = QUESTION) {
  await act(async () => {
    latest.addManualQuestion(text);
  });
}

const text = () => container.textContent || "";

beforeEach(() => {
  vi.clearAllMocks();
  liveCalls.length = 0;
  answerClient.draftAnswer.mockResolvedValue(answer(READY()));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("a detected card carries Row 1 from the answer (the dropped-field defect)", () => {
  it("[positive control] renders the example group and the picked project on the card", async () => {
    await mount();
    await ask();
    expect(latest.questions[0].status).toBe("done");
    expect(latest.questions[0].projectExample).toMatchObject({ status: "ready", title: "Sized the launch fleet" });
    expect(text()).toContain(GROUP_LABEL);
    expect(text()).toContain("Sized the launch fleet");
    expect(text()).toContain("Held p99 latency flat through a 4x launch");
  });

  it("carries a pending and a no_match value as their own quiet lines, not as nothing", async () => {
    answerClient.draftAnswer.mockResolvedValue(answer({ status: "pending" }));
    await mount();
    await ask();
    expect(text()).toContain(R1_WARMING);

    answerClient.draftAnswer.mockResolvedValue(answer({ status: "no_match" }));
    await ask("What would you do differently next time?");
    expect(text()).toContain(R1_NO_MATCH);
  });

  it("an answer with no Row 1 value (server omitted it) renders no group and fires no Row 2", async () => {
    answerClient.draftAnswer.mockResolvedValue(answer(undefined));
    await mount();
    await ask();
    expect(latest.questions[0].status).toBe("done");
    expect(latest.questions[0].projectExample).toBeUndefined();
    expect(text()).not.toContain(GROUP_LABEL);
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
  });
});

describe("a detected card also gets Row 2 (the projectExampleLive wiring)", () => {
  it("fires one Row 2 request for the question and application, shows the pending line, then the example", async () => {
    await mount();
    await ask();
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
    const arg = answerClient.fetchProjectExampleLive.mock.calls[0][0];
    expect(arg.applicationId).toBe("app-1");
    expect(arg.question).toBe(QUESTION);
    expect(latest.questions[0].projectExampleLive).toEqual({ status: "pending" });
    expect(text()).toContain(R2_PENDING);

    await act(async () => {
      liveCalls[0].resolve({ projectExample: READY({ title: "Wrote one just now", bullets: ["Moved a launch window", "Held the error budget"] }) });
    });
    expect(latest.questions[0].projectExampleLive.title).toBe("Wrote one just now");
    expect(text()).toContain("Wrote one just now");
    expect(text()).not.toContain(R2_PENDING);
  });

  it("no application selected: no Row 1 to gate on, so no Row 2", async () => {
    await mount({ applicationId: null });
    await ask();
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
  });

  it("a redraft clears the previous rows and takes the new answer's own", async () => {
    await mount();
    await ask();
    await act(async () => {
      liveCalls[0].resolve({ projectExample: READY({ title: "OLD LIVE" }) });
    });
    expect(text()).toContain("OLD LIVE");

    answerClient.draftAnswer.mockResolvedValue(answer(READY({ title: "NEW PICK" })));
    await act(async () => {
      latest.onDraft(latest.questions[0].id);
    });
    expect(latest.questions[0].projectExample.title).toBe("NEW PICK");
    expect(text()).toContain("NEW PICK");
    expect(text()).not.toContain("OLD LIVE");
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(2);
  });

  it("a superseded draft's late Row 2 paints nothing on the card a newer draft owns", async () => {
    await mount();
    await ask();
    const stale = liveCalls[0];
    await act(async () => {
      latest.onDraft(latest.questions[0].id);
    });
    await act(async () => {
      stale.resolve({ projectExample: READY({ title: "STALE LIVE" }) });
    });
    expect(text()).not.toContain("STALE LIVE");
    expect(latest.questions[0].projectExampleLive).toEqual({ status: "pending" });
    await act(async () => {
      liveCalls[1].resolve({ projectExample: READY({ title: "CURRENT LIVE" }) });
    });
    expect(text()).toContain("CURRENT LIVE");
  });

  it("an interview-type change (invalidateDrafts) clears both rows and drops the late settle", async () => {
    await mount();
    await ask();
    expect(latest.questions[0].projectExampleLive).toEqual({ status: "pending" });
    await act(async () => {
      latest.invalidateDrafts();
    });
    expect(latest.questions[0].status).toBe("idle");
    expect(latest.questions[0].projectExample).toBeUndefined();
    expect(latest.questions[0].projectExampleLive).toBeUndefined();
    expect(text()).not.toContain(GROUP_LABEL);

    await act(async () => {
      liveCalls[0].resolve({ projectExample: READY({ title: "LATE LIVE" }) });
    });
    expect(latest.questions[0].projectExampleLive).toBeUndefined();
    expect(text()).not.toContain("LATE LIVE");
  });

  it("a draft whose card was invalidated before it resolved spends no Row 2 request", async () => {
    const first = makeDeferred();
    answerClient.draftAnswer.mockReturnValueOnce(first.promise);
    await mount();
    await ask();
    await act(async () => {
      latest.invalidateDrafts();
    });
    await act(async () => {
      first.resolve(answer(READY()));
    });
    expect(latest.questions[0].status).toBe("idle");
    expect(answerClient.fetchProjectExampleLive).not.toHaveBeenCalled();
  });
});

describe("the warm-up report", () => {
  it("tells onRowOneStatus the application and the Row 1 status of each drafted answer", async () => {
    answerClient.draftAnswer.mockResolvedValue(answer({ status: "pending" }));
    const onRowOneStatus = vi.fn();
    await mount({ onRowOneStatus });
    await ask();
    expect(onRowOneStatus).toHaveBeenCalledTimes(1);
    expect(onRowOneStatus).toHaveBeenCalledWith("app-1", "pending");
  });

  it("a callback that throws cannot turn the delivered answer into an error card", async () => {
    await mount({
      onRowOneStatus: () => {
        throw new Error("boom");
      },
    });
    await ask();
    expect(latest.questions[0].status).toBe("done");
    expect(latest.questions[0].error).toBe("");
  });
});
