// @vitest-environment jsdom
//
// `useRoomQuestions` — practice mode's detection half — and what an
// interview-type change is allowed to do to it. Harness copied from
// `useRoomQuestions.manual.test.js` next door.
//
// Written BEFORE the implementation exists (step 4b): the file fails on the
// missing `../useInterviewType.js` module until the store moves, and on the
// missing `invalidateDrafts` export until the hook gains it.
//
// The distinction this file exists to hold, because it is the one an
// implementer collapses:
//
//   * Room questions are questions OTHER PEOPLE IN THE ROOM ACTUALLY ASKED. A
//     format change does not make them un-asked, and it has no claim on that
//     history. `resetForSession()` (`useRoomQuestions.js:325`) empties the
//     list, and adding it to the clearing list is the wrong remedy (AC-A21b).
//   * What the change DOES invalidate is the drafts built under the old
//     rubric. Today that is correct only by a `prev.map` accident.
//   * And invalidating drafts without a generation guard leaves the very stale
//     post-`await` write the invalidation was added to prevent. Verified at
//     source: every ref in `useRoomQuestions.js` (`:62`, `:63`, `:64`, `:65`,
//     `:71`, `:72`, `:77`) — there is NO generation or sequence ref of any
//     kind, and the catch at `:157-163` is unguarded too, so a late REJECTION
//     is half the hazard (AC-A21c).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useRoomQuestions } from "./useRoomQuestions.js";
import { setInterviewType, __resetInterviewTypeForTests } from "../useInterviewType.js";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

// Path helper, deliberately NOT `fileURLToPath(new URL(rel, import.meta.url))`:
// under `@vitest-environment jsdom` the global `URL` is jsdom's whatwg-url
// class, not Node's, and `fileURLToPath` rejects an instance of it with
// "The URL must be of scheme file". Passing `import.meta.url` as a STRING has
// no such realm problem, and `node:path` does the rest.
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "How would you scale this?";

const DRAFT_RESPONSE = {
  points: ["Name the constraint first.", "Then the tradeoff you took."],
  cues: ["Constraint", "Tradeoff"],
  buzzwords: ["latency"],
  resumeAnchor: { role: "Staff Engineer" },
  idealProject: { title: "Platform consolidation" },
  pageSources: [{ id: "p1", title: "Payments migration" }],
  type: "behavioral",
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Probe({ onState, myTag = null, collecting = false }) {
  const room = useRoomQuestions({
    applicationId: "app-1",
    profile: "Senior engineer at Acme.",
    myTag,
    collecting,
  });
  onState(room);
  return null;
}

const mounted = [];

function mountProbe(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe, { ...props, onState: (s) => Object.assign(state, s) }));
  });
  return { root, container, state };
}

beforeEach(() => {
  // `vi.restoreAllMocks()` does not clear a `vi.fn()` from a `vi.mock`
  // factory, and cases below install a rejecting implementation — hence
  // `mockReset`, not `mockClear`.
  draftAnswer.mockReset();
  confirmQuestion.mockReset();
  draftAnswer.mockResolvedValue(DRAFT_RESPONSE);
  confirmQuestion.mockResolvedValue({ isQuestion: true, question: QUESTION, type: "technical" });
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

describe("useRoomQuestions sends the selected interview type (AC-A21/AC-A22)", () => {
  it("carries the default when nothing has been selected — the positive control", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(draftAnswer.mock.calls[0][0]).toMatchObject({
      question: QUESTION,
      applicationId: "app-1",
      interviewType: "general",
    });
  });

  it("carries a type selected in the SAME SYNCHRONOUS TURN as the draft (AC-A20)", async () => {
    // Same falsifiability requirement live mode's own test carries: an
    // assertion that merely awaits before reading the body passes against a
    // ref implementation, because a mirrored ref is correct one tick later.
    const { state } = mountProbe();

    let bodyAtCallTime = null;
    act(() => {
      setInterviewType("system-design");
      state.addManualQuestion(QUESTION);
      bodyAtCallTime = draftAnswer.mock.calls[0]?.[0];
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(bodyAtCallTime).toBeTruthy();
    expect(bodyAtCallTime.interviewType).toBe("system-design");
  });
});

describe("invalidateDrafts keeps the QUESTIONS and clears the DRAFTS (AC-A21b)", () => {
  it("leaves the entries, their ids, their text and their classification standing", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    const before = state.questions[0];
    expect(before.status).toBe("done");
    expect(before.points).toEqual(DRAFT_RESPONSE.points);

    await act(async () => {
      state.invalidateDrafts();
    });

    const after = state.questions[0];
    expect(state.questions).toHaveLength(1);
    expect(after.id).toBe(before.id);
    expect(after.question).toBe(QUESTION);
    expect(after.at).toBe(before.at);
    expect(after.type).toBe(before.type);
  });

  it("resets the answer payload to exactly the shape a fresh entry is seeded with", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    await act(async () => {
      state.invalidateDrafts();
    });

    const entry = state.questions[0];
    expect(entry.status).toBe("idle");
    expect(entry.error).toBe("");
    expect(entry.cached).toBe(false);
    expect(entry.points).toBe(null);
    expect(entry.cues).toEqual([]);
    expect(entry.buzzwords).toEqual([]);
    expect(entry.anchor).toBe(null);
    expect(entry.idealProject).toBe(null);
    expect(entry.pageSources).toEqual([]);
  });

  it("clears an entry left in the ERROR state as well as a done one", async () => {
    draftAnswer.mockRejectedValueOnce(new Error("Failed to draft."));
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(state.questions[0].status).toBe("error");

    await act(async () => {
      state.invalidateDrafts();
    });
    expect(state.questions[0].status).toBe("idle");
    expect(state.questions[0].error).toBe("");
  });

  it("resetForSession() DOES empty the list — the positive control for the case above", async () => {
    // Without this, an `invalidateDrafts` that does nothing at all satisfies
    // "the questions survive". This proves the hook can clear the list and
    // deliberately does not.
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(state.questions).toHaveLength(1);

    await act(async () => {
      state.resetForSession();
    });
    expect(state.questions).toHaveLength(0);
  });

  it("does not reset the dedupe guard, so a question already on screen cannot be re-added", async () => {
    // `lastQNormRef` is deliberately NOT cleared: resetting it would let a
    // question that is still sitting in the feed be added a second time the
    // moment someone in the room repeats it.
    const { state } = mountProbe({ myTag: 0, collecting: false });
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    await act(async () => {
      state.invalidateDrafts();
    });

    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: "how would you scale this" });
    });
    expect(state.questions).toHaveLength(1);

    // Positive control: detection is alive, and a DIFFERENT question still
    // lands — so the absence above is the dedupe guard, not a deaf detector.
    confirmQuestion.mockResolvedValueOnce({
      isQuestion: true,
      question: "How do you test this?",
      type: "technical",
    });
    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: "and how do you test this" });
    });
    expect(state.questions).toHaveLength(2);
  });
});

describe("a draft resolving after an invalidation writes nothing (AC-A21c)", () => {
  it("on the success path", async () => {
    const pending = deferred();
    draftAnswer.mockImplementationOnce(() => pending.promise);

    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(state.questions[0].status).toBe("loading");

    await act(async () => {
      state.invalidateDrafts();
    });
    expect(state.questions[0].status).toBe("idle");

    await act(async () => {
      pending.resolve(DRAFT_RESPONSE);
      await pending.promise;
    });

    expect(state.questions[0].status).toBe("idle");
    expect(state.questions[0].points).toBe(null);
  });

  it("on the rejection path — the unguarded catch is half the hazard", async () => {
    const pending = deferred();
    draftAnswer.mockImplementationOnce(() => pending.promise);

    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    await act(async () => {
      state.invalidateDrafts();
    });

    await act(async () => {
      pending.reject(new Error("network gone"));
      await pending.promise.catch(() => {});
    });

    expect(state.questions[0].status).toBe("idle");
    expect(state.questions[0].error).toBe("");
  });

  it("an UN-invalidated draft still lands, on both paths — the positive controls", async () => {
    // Without these, a guard that rejects every post-await write passes both
    // cases above while making room questions permanently unanswerable.
    const ok = deferred();
    draftAnswer.mockImplementationOnce(() => ok.promise);
    const a = mountProbe();
    await act(async () => {
      a.state.addManualQuestion(QUESTION);
    });
    await act(async () => {
      ok.resolve(DRAFT_RESPONSE);
      await ok.promise;
    });
    expect(a.state.questions[0].status).toBe("done");
    expect(a.state.questions[0].points).toEqual(DRAFT_RESPONSE.points);

    const bad = deferred();
    draftAnswer.mockImplementationOnce(() => bad.promise);
    const b = mountProbe();
    await act(async () => {
      b.state.addManualQuestion("How do you test this?");
    });
    await act(async () => {
      bad.reject(new Error("network gone"));
      await bad.promise.catch(() => {});
    });
    expect(b.state.questions[0].status).toBe("error");
    expect(b.state.questions[0].error).toBe("network gone");
  });

  it("does not let an older draft overwrite a newer one for the same entry", async () => {
    const first = deferred();
    const second = deferred();
    draftAnswer
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    const id = state.questions[0].id;

    // "Redraft" over a draft that is still streaming.
    await act(async () => {
      state.onDraft(id);
    });

    const newer = { ...DRAFT_RESPONSE, points: ["The newer answer."] };
    await act(async () => {
      second.resolve(newer);
      await second.promise;
    });
    expect(state.questions[0].points).toEqual(newer.points);

    await act(async () => {
      first.resolve(DRAFT_RESPONSE);
      await first.promise;
    });
    expect(state.questions[0].points).toEqual(newer.points);
    expect(state.questions[0].status).toBe("done");
  });
});

describe("the comment asserting this hook sends no interview type is corrected (AC-A29)", () => {
  it("no longer says interviewType is left out of the request entirely", () => {
    // `useRoomQuestions.js:114-117` today reads: "`interviewType` is left out
    // of the request entirely, for the same reason live mode's own runDraft
    // never sends one". Both halves become false in this chunk, and this repo
    // treats a stale comment as a real defect.
    const src = readSource("./useRoomQuestions.js");
    expect(src).not.toMatch(/is left out of the request entirely/);
    expect(src).not.toMatch(/live mode'?s own runDraft never sends one/);
  });
});
