// @vitest-environment jsdom
//
// The insight loop's whole reason for existing is composition, not logic:
// WHEN a read fires (wired to a real, un-mocked lib/meeting/chunkTrigger.js
// — see "the burst test" below, which would pass for the wrong reason if
// the trigger itself were mocked out) and whether a result that arrives too
// late lands anywhere. Both are invisible to a pure-function test under this
// repo's default `environment: "node"`, so this follows app/copilot/
// useCompanyBrief.test.js's jsdom Probe/flush pattern — itself following
// useCopilotDashboard.wiring.test.js — plus fake timers for the tick, the
// same combination app/hooks/useTechWatch.test.js's own polling test uses.
//
// Only lib/meeting/insightClient.js is mocked (the network edge); chunkTrigger.js
// and insightContract.js run for real, so a mutation to either would show up
// here too, not just in their own test files.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/meeting/insightClient", () => ({ fetchInsights: vi.fn() }));

import { useMeetingInsights, buildTranscriptText } from "./useMeetingInsights.js";
import { fetchInsights } from "@/lib/meeting/insightClient";
import { MIN_NEW_WORDS, SETTLE_MS, MIN_INTERVAL_MS } from "@/lib/meeting/chunkTrigger";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Exactly the shape lib/meeting/insightClient.js resolves with on a
// successful read — `topic` a plain STRING ("" until one is identified) and
// `topicChanged` the route's own verdict, never anything this hook derives.
function okResult(insights = [], topic = "", topicChanged = false) {
  return { ok: true, insights, topic, topicChanged };
}

let container;
let root;
let latest;

function Probe({ turns, sessionId, live, pageId, engine }) {
  latest = useMeetingInsights({ turns, sessionId, live, pageId, engine });
  return null;
}

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function render(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush();
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

function makeTurn(id, text) {
  return { id, speaker: "them", text, at: Date.now() };
}

beforeEach(() => {
  vi.useFakeTimers();
  latest = null;
  fetchInsights.mockReset();
  fetchInsights.mockResolvedValue(okResult());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("useMeetingInsights — the request", () => {
  it("sends the transcript, topic, knownInsightIds, pageId, and engine on a nudge", async () => {
    const turns = [makeTurn(1, "Let's discuss the launch date.")];
    await render({ turns, sessionId: "m1", live: true, pageId: "page-9", engine: "embedded" });

    await act(async () => {
      latest.nudge();
    });
    await flush();

    expect(fetchInsights).toHaveBeenCalledTimes(1);
    const call = fetchInsights.mock.calls[0][0];
    expect(call.transcript).toContain("Let's discuss the launch date.");
    expect(call.topic).toBe("");
    expect(call.knownInsightIds).toEqual([]);
    expect(call.pageId).toBe("page-9");
    expect(call.engine).toBe("embedded");
  });

  it("labels transcript lines through meetingSpeakerLabel, never the raw routing value", async () => {
    const turns = [
      { id: 1, speaker: "them", text: "Shall we start?", at: Date.now() },
      { id: 2, speaker: "you", text: "Sure, go ahead.", at: Date.now() },
      { id: 3, speaker: "room", text: "Let's begin.", at: Date.now() },
    ];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();

    const { transcript } = fetchInsights.mock.calls[0][0];
    expect(transcript).toContain("Others: Shall we start?");
    expect(transcript).toContain("You: Sure, go ahead.");
    expect(transcript).toContain("Let's begin.");
    expect(transcript).not.toContain("room:");
    expect(transcript).not.toContain("them:");
  });

  it("feeds the previous read's topic back as the next request's topic", async () => {
    fetchInsights.mockResolvedValueOnce(okResult([], "Launch timeline"));
    const turns = [makeTurn(1, "First turn.")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(latest.topic).toBe("Launch timeline");

    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(fetchInsights.mock.calls[1][0].topic).toBe("Launch timeline");
  });

  // Mutation this catches: storing the response's topic without checking it
  // is a string (e.g. keeping a `{ text, changed, confidence }` object as
  // "the topic"). That object re-exports as a non-string to the renderer —
  // whose `typeof topic === "string"` guard then pins the heading on "Not
  // yet identified" forever — and stringifies into the NEXT request's own
  // `topic` field as the literal "[object Object]", which is pasted into
  // the model's prompt as the previous topic and concatenated into the
  // page-ranking query, where "object" scores as a search term.
  it("re-exports the topic as a string, and never sends a non-string one back", async () => {
    fetchInsights.mockResolvedValueOnce({
      ok: true,
      insights: [],
      topic: { text: "Launch timeline", changed: true, confidence: "high" },
      topicChanged: true,
    });
    const turns = [makeTurn(1, "First turn.")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();

    expect(typeof latest.topic).toBe("string");

    await act(async () => {
      latest.nudge();
    });
    await flush();
    const sentBack = fetchInsights.mock.calls[1][0].topic;
    expect(typeof sentBack).toBe("string");
    expect(sentBack).not.toContain("[object Object]");
  });

  // Mutation this catches: dropping `topicChanged` from the hook's return
  // (or latching it to true once set). The renderer's "(just changed)" cue
  // and its live-region announcement are driven entirely by this value —
  // nothing downstream recomputes it, because insightContract.js's
  // normalizeTopic already compared NORMALIZED text server-side so a
  // trailing period or a trivial rephrase is not reported as movement.
  it("forwards the route's topicChanged verdict, and clears it on a read that did not change the topic", async () => {
    fetchInsights.mockResolvedValueOnce(okResult([], "Refund SLAs", true));
    const turns = [makeTurn(1, "First turn.")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(latest.topicChanged).toBe(true);

    fetchInsights.mockResolvedValueOnce(okResult([], "Refund SLAs", false));
    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(latest.topicChanged).toBe(false);
    expect(latest.topic).toBe("Refund SLAs");
  });
});

describe("useMeetingInsights — a caller that never names its session", () => {
  // Mutation this catches: comparing `state.forSessionId === sessionId`
  // without the `?? null` on both sides. "No session id" has two spellings —
  // an omitted prop (undefined) and an explicit `null` (what
  // `sessionId={meeting?.id ?? null}` produces for the same "no meeting
  // yet") — and `null === undefined` is false, so a strict comparison treats
  // one unnamed session as two and silently drops everything read under the
  // other spelling. The second half of this test is the half that fails
  // under that mutation; the first half only establishes there was something
  // to lose.
  it("treats an omitted sessionId and an explicit null as the SAME unnamed session", async () => {
    fetchInsights.mockResolvedValueOnce(
      okResult(
        [{ id: "i_1", text: "Unnamed session insight.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }],
        "Launch timeline",
      ),
    );
    const turns = [makeTurn(1, "x")];
    await render({ turns, live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();

    expect(latest.insights.map((i) => i.id)).toEqual(["i_1"]);
    expect(latest.topic).toBe("Launch timeline");
    expect(latest.status).toBe("done");

    // The same caller re-renders, now spelling "no meeting" as an explicit
    // null. Nothing about the meeting on screen changed, so nothing it read
    // may disappear.
    await render({ turns, sessionId: null, live: true, pageId: null, engine: "gemini" });
    expect(latest.insights.map((i) => i.id)).toEqual(["i_1"]);
    expect(latest.topic).toBe("Launch timeline");
  });
});

describe("buildTranscriptText — exported so the saved-page builder shares it", () => {
  // Mutation this catches: giving a "room" turn a label (or un-exporting
  // this function, which forces the saved-page builder to grow a second copy
  // of the rule and lets the two drift). A shared in-person mic carries no
  // signal for who is talking, so its lines go out unlabelled rather than
  // mislabelled — that honesty is the whole of this feature's speaker
  // attribution.
  it("labels 'them'/'you' and leaves a 'room' turn with no label at all", () => {
    const text = buildTranscriptText([
      { id: 1, speaker: "them", text: "Shall we start?", at: 1 },
      { id: 2, speaker: "you", text: "Sure, go ahead.", at: 2 },
      { id: 3, speaker: "room", text: "Let's begin.", at: 3 },
    ]);

    expect(text).toBe("Others: Shall we start?\nYou: Sure, go ahead.\nLet's begin.");
  });
});

describe("useMeetingInsights — the burst test", () => {
  it("a burst of transcript frames followed by a pause produces exactly ONE read", async () => {
    let turns = [];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });

    // Five frames, ~400ms apart, each carrying MIN_NEW_WORDS/5 words — well
    // over MIN_NEW_WORDS by the end of the burst, and each new final resets
    // chunkTrigger's own SETTLE_MS clock (this is the debounce itself, not
    // this test re-implementing it). A naive implementation that evaluated
    // the trigger from a transcript-arrival callback, rather than the 1s
    // tick, would fire on some subset of these five arrivals; this
    // implementation must fire on NONE of them yet.
    for (let i = 0; i < 5; i += 1) {
      turns = [...turns, makeTurn(i + 1, words(Math.ceil(MIN_NEW_WORDS / 4)))];
      await act(async () => {
        root.render(createElement(Probe, { turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" }));
      });
      await advance(400);
    }
    expect(fetchInsights).not.toHaveBeenCalled();

    // The room goes quiet. Advance well past SETTLE_MS with no further
    // turns arriving.
    await advance(SETTLE_MS + tickAllowance());

    expect(fetchInsights).toHaveBeenCalledTimes(1);

    // Advancing further still — including past MIN_INTERVAL_MS, where a
    // pacing-only implementation might fire again — must not produce a
    // second call: no new words have landed since the one read that already
    // happened, and chunkTrigger's own word-count gate is what prevents an
    // idle room from ever costing anything (see chunkTrigger.test.js's
    // "costs nothing at all during a silence").
    await advance(MIN_INTERVAL_MS + tickAllowance());
    expect(fetchInsights).toHaveBeenCalledTimes(1);
  });
});

// A little slack past an exact threshold so the assertion isn't riding a
// razor's-edge tick boundary against the 1s interval granularity.
function tickAllowance() {
  return 1500;
}

describe("useMeetingInsights — accumulation", () => {
  it("merges new insights in front of existing ones, deduped by id", async () => {
    fetchInsights.mockResolvedValueOnce(
      okResult([
        { id: "i_1", text: "First point.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } },
      ]),
    );
    const turns = [makeTurn(1, "x")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(latest.insights.map((i) => i.id)).toEqual(["i_1"]);

    fetchInsights.mockResolvedValueOnce(
      okResult([
        { id: "i_2", text: "Second point.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } },
        { id: "i_1", text: "First point, restated.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } },
      ]),
    );
    await act(async () => {
      latest.nudge();
    });
    await flush();

    // i_2 (new) leads; the repeated i_1 keeps its FIRST-seen entry rather
    // than being duplicated or reordered to the back.
    expect(latest.insights.map((i) => i.id)).toEqual(["i_2", "i_1"]);
  });

  it("sends the accumulated ids back as knownInsightIds on the next read", async () => {
    fetchInsights.mockResolvedValueOnce(
      okResult([{ id: "i_1", text: "First.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }]),
    );
    const turns = [makeTurn(1, "x")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();

    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(fetchInsights.mock.calls[1][0].knownInsightIds).toEqual(["i_1"]);
  });
});

describe("useMeetingInsights — a failed read is retryable, not destructive", () => {
  it("keeps prior insights and surfaces the error on a failed read", async () => {
    fetchInsights.mockResolvedValueOnce(
      okResult([{ id: "i_1", text: "First.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }]),
    );
    const turns = [makeTurn(1, "x")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(latest.insights).toHaveLength(1);

    fetchInsights.mockResolvedValueOnce({ ok: false, error: "Insight generation failed." });
    await act(async () => {
      latest.nudge();
    });
    await flush();

    expect(latest.status).toBe("error");
    expect(latest.error).toBe("Insight generation failed.");
    expect(latest.insights.map((i) => i.id)).toEqual(["i_1"]);
  });
});

describe("useMeetingInsights — the supersession test", () => {
  it("a read that resolves AFTER stop() lands nowhere: no insight, no error", async () => {
    let resolveRead;
    fetchInsights.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const turns = [makeTurn(1, "x")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(fetchInsights).toHaveBeenCalledTimes(1);

    // Stop: live goes false while the read above is still pending.
    await render({ turns, sessionId: "m1", live: false, pageId: null, engine: "gemini" });

    await act(async () => {
      resolveRead(
        okResult([{ id: "i_late", text: "Too late.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }]),
      );
    });
    await flush();

    expect(latest.insights).toEqual([]);
    expect(latest.error).toBe("");
    // Mutation this catches: dropping the `!live && status === "loading"`
    // derivation. The superseded read returns without ever writing to state,
    // so `status` is still literally "loading" — and since `sessionId` never
    // changed, that state still belongs to the session on screen. Presented
    // raw, the panel spins "Listening for insights…" for a meeting that is
    // over, indefinitely.
    expect(latest.status).not.toBe("loading");
  });

  it("a read that resolves AFTER a new meeting starts lands nowhere", async () => {
    let resolveRead;
    fetchInsights.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const turns = [makeTurn(1, "x")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();

    // A brand new meeting starts — different sessionId, fresh (empty)
    // turns, exactly as app/meeting/useMeetingSession.js's own turns state
    // would look immediately after a fresh start().
    await render({ turns: [], sessionId: "m2", live: true, pageId: null, engine: "gemini" });

    await act(async () => {
      resolveRead(
        okResult([{ id: "i_stale", text: "From the old meeting.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }]),
      );
    });
    await flush();

    expect(latest.insights).toEqual([]);
    expect(latest.error).toBe("");
  });

  it("a read that resolves after unmount throws nothing and updates nothing", async () => {
    let resolveRead;
    fetchInsights.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const turns = [makeTurn(1, "x")];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });
    await act(async () => {
      latest.nudge();
    });
    await flush();

    await act(async () => {
      root.unmount();
    });

    await expect(
      act(async () => {
        resolveRead(okResult([{ id: "i_x", text: "x", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }]));
      }),
    ).resolves.not.toThrow();
  });

  it("nudge discards an automatic read still in flight, and only the nudge's own result lands", async () => {
    let resolveAuto;
    fetchInsights.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAuto = resolve;
        }),
    );
    let turns = [makeTurn(1, words(MIN_NEW_WORDS))];
    await render({ turns, sessionId: "m1", live: true, pageId: null, engine: "gemini" });

    // Let the automatic loop fire on its own (enough words, a settled
    // room, no prior read).
    await advance(SETTLE_MS + tickAllowance());
    expect(fetchInsights).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("loading");

    // The user asks explicitly while the automatic read is still pending.
    fetchInsights.mockResolvedValueOnce(
      okResult([{ id: "i_nudge", text: "From the nudge.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }]),
    );
    await act(async () => {
      latest.nudge();
    });
    await flush();
    expect(fetchInsights).toHaveBeenCalledTimes(2);
    expect(latest.insights.map((i) => i.id)).toEqual(["i_nudge"]);

    // The stale automatic read finally resolves — it must not clobber the
    // nudge's own, already-landed result.
    await act(async () => {
      resolveAuto(
        okResult([{ id: "i_stale_auto", text: "Should not appear.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }]),
      );
    });
    await flush();
    expect(latest.insights.map((i) => i.id)).toEqual(["i_nudge"]);
  });
});

describe("useMeetingInsights — the tick does not run when not live", () => {
  it("issues no automatic reads while live is false", async () => {
    const turns = [makeTurn(1, words(MIN_NEW_WORDS))];
    await render({ turns, sessionId: "m1", live: false, pageId: null, engine: "gemini" });
    await advance(MIN_INTERVAL_MS + tickAllowance());
    expect(fetchInsights).not.toHaveBeenCalled();
  });
});
