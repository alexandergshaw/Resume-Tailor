// @vitest-environment jsdom
//
// The composition: the one component that joins capture, the insight loop and
// the two views, and that turns a finished meeting into a page.
//
// Everything below it is mocked, deliberately. Each piece has its own suite;
// what NOTHING else can test is whether they are actually wired to each
// other. A refactor in this repo has already shipped with three fully-tested
// components sitting beside a caller that never imported any of them, so the
// assertions here are about the CALLER's shape: does it render them, does it
// hand them the right things, and does a finished meeting actually become a
// page.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const hooks = vi.hoisted(() => ({
  // Exactly the shapes the real hooks return. `source` is deliberately NOT
  // here: the panel OWNS the capture source and passes it down into
  // useMeetingSession, so a mock that handed it back would let the panel
  // read it from the wrong place and still pass.
  session: {
    turns: [],
    interims: {},
    status: "idle",
    error: "",
    warning: "",
    start: vi.fn(),
    stop: vi.fn(),
  },
  // Likewise no `retry`: the insight hook exposes `nudge`, and retrying a
  // failed read IS asking again, so the panel wires the list's onRetry to it.
  insights: {
    insights: [],
    topic: "",
    topicChanged: false,
    status: "idle",
    error: "",
    nudge: vi.fn(),
  },
  transcriptProps: [],
  listProps: [],
}));

vi.mock("./useMeetingSession.js", () => ({ useMeetingSession: () => hooks.session }));
vi.mock("./useMeetingInsights.js", () => ({ useMeetingInsights: () => hooks.insights }));

vi.mock("./MeetingTranscript.js", () => ({
  default: function MockTranscript(props) {
    hooks.transcriptProps.push(props);
    return createElement("div", { "data-testid": "mock-transcript" });
  },
}));

vi.mock("./MeetingInsightList.js", () => ({
  default: function MockInsightList(props) {
    hooks.listProps.push(props);
    return createElement("div", { "data-testid": "mock-insights" });
  },
}));

import MeetingPanel from "./MeetingPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  hooks.session.turns = [];
  hooks.session.status = "idle";
  hooks.session.error = "";
  hooks.session.start.mockReset();
  hooks.session.stop.mockReset();
  hooks.insights.insights = [];
  hooks.insights.topic = "";
  hooks.insights.topicChanged = false;
  hooks.insights.nudge.mockReset();
  hooks.transcriptProps.length = 0;
  hooks.listProps.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  delete global.fetch;
});

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(MeetingPanel, { pageId: "p-1", onMeetingSaved: vi.fn(), ...props }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(el) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonNamed(re) {
  return [...container.querySelectorAll("button")].find((b) =>
    re.test(b.getAttribute("aria-label") || b.textContent || ""),
  );
}

const LIVE_TURNS = [
  { id: "t1", speaker: "you", text: "Are we still gated on the legacy processor?", at: 1000 },
  { id: "t2", speaker: "them", text: "Only for refunds now.", at: 4000 },
];

describe("before a meeting starts", () => {
  it("costs exactly one click to start, with no dialog and no source picker in the way", async () => {
    // The standing rule here is that a new flow should be one action with a
    // good default, not a wizard. The audio source already has a remembered
    // default; asking for it up front would make starting a meeting a
    // two-step negotiation with someone who is about to be talking.
    await render();
    const start = buttonNamed(/start a meeting/i);
    expect(start).toBeDefined();
    expect(start.disabled).toBe(false);

    await click(start);
    expect(hooks.session.start).toHaveBeenCalledTimes(1);
  });

  it("does not render the transcript or the insight list until it is running", async () => {
    await render();
    expect(container.querySelector('[data-testid="mock-transcript"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-insights"]')).toBeNull();
  });
});

describe("while the meeting is running", () => {
  beforeEach(() => {
    hooks.session.status = "live";
    hooks.session.turns = LIVE_TURNS;
    hooks.insights.topic = "Payments migration";
  });

  it("renders both views — this is the assertion nothing else can make", async () => {
    // If the panel ever stops importing one of these, every one of that
    // component's own tests still passes, because they import it directly.
    await render();
    expect(container.querySelector('[data-testid="mock-transcript"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mock-insights"]')).not.toBeNull();
  });

  it("hands the transcript the raw turns and the capture source", async () => {
    // The source is what decides whether the "one microphone is recording
    // everyone in the room" notice appears above the transcript; dropping it
    // silently removes that notice and leaves an unlabelled wall of text
    // looking like a bug rather than an honest limit.
    //
    // The panel owns `source` (it is what it passes INTO useMeetingSession),
    // so this asserts it reaches the view rather than pinning one value -
    // captureSupport resolves it, and jsdom has no getDisplayMedia, so the
    // resolved value here is whatever that coercion produces.
    await render();
    const props = hooks.transcriptProps.at(-1);
    expect(props.turns).toBe(hooks.session.turns);
    expect(typeof props.source).toBe("string");
    expect(props.source.length).toBeGreaterThan(0);
  });

  it("hands the insight list a STRING topic, never the whole topic object", async () => {
    // The regression this pins actually happened: the route returned
    // `{ text, changed, confidence }`, every consumer treated `topic` as a
    // string, and the heading silently read "Not yet identified" for the
    // whole meeting while the stored object went back to the server as
    // "[object Object]" and became a scoring term in page ranking.
    await render();
    const props = hooks.listProps.at(-1);
    expect(typeof props.topic).toBe("string");
    expect(props.topic).toBe("Payments migration");
    expect(typeof props.topicChanged).toBe("boolean");
  });

  it("wires the nudge and the retry to the loop that owns them", async () => {
    await render();
    const props = hooks.listProps.at(-1);
    props.onNudge();
    expect(hooks.insights.nudge).toHaveBeenCalledTimes(1);
    expect(typeof props.onRetry).toBe("function");
  });
});

describe("stopping saves the meeting as a page", () => {
  beforeEach(() => {
    hooks.session.status = "live";
    hooks.session.turns = LIVE_TURNS;
    hooks.insights.topic = "Payments migration";
    hooks.insights.insights = [
      { id: "i1", text: "Mention the reconciliation win.", kind: "point", source: { kind: "model" } },
    ];
  });

  it("stops capture and posts a built page in one action", async () => {
    // One click, no confirmation dialog and no title prompt. The result is an
    // ordinary editable page, so a dialog would tax the common correct case
    // to guard a slip that costs nothing.
    const saved = { id: "new-1", title: "Payments migration — Meeting notes (2026-03-04)" };
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ page: saved }) }));
    const onMeetingSaved = vi.fn();
    await render({ onMeetingSaved });

    await click(buttonNamed(/stop/i));

    expect(hooks.session.stop).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/meeting/save");
    const body = JSON.parse(options.body);
    // The body carries the meeting, not a placeholder - the topic, the
    // discussion point, and the words actually said.
    expect(body.title).toContain("Payments migration");
    expect(body.body).toContain("Mention the reconciliation win.");
    expect(body.body).toContain("Only for refunds now.");
  });

  it("tells its parent, so the page tree can show the new page", async () => {
    // The panel cannot refresh the tree itself: `pages` lives in a hook owned
    // by ExperienceTab. This repo has shipped that exact bug before - an
    // action that created a page the list never learned about - so the
    // callback is the whole mechanism and it is hard-called, never `?.()`.
    const saved = { id: "new-1", title: "Payments migration — Meeting notes (2026-03-04)" };
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ page: saved }) }));
    const onMeetingSaved = vi.fn();
    await render({ onMeetingSaved });

    await click(buttonNamed(/stop/i));

    expect(onMeetingSaved).toHaveBeenCalledTimes(1);
    expect(onMeetingSaved.mock.calls[0][0]).toEqual(saved);
  });

  it("keeps the whole meeting on screen when the save fails, and can retry it", async () => {
    // The transcript exists nowhere else - there is no server-side record of
    // a meeting until this POST succeeds. Losing it because the last step
    // failed would be the single most destructive thing this feature could
    // do.
    let attempt = 0;
    global.fetch = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, json: async () => ({ error: "Could not save." }) };
      return { ok: true, json: async () => ({ page: { id: "new-1", title: "Saved" } }) };
    });
    const onMeetingSaved = vi.fn();
    await render({ onMeetingSaved });

    await click(buttonNamed(/stop/i));

    expect(onMeetingSaved).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent.toLowerCase()).toContain("save");

    const retry = buttonNamed(/retry|save again/i);
    expect(retry, "a failed save must be retryable").toBeDefined();
    await click(retry);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(onMeetingSaved).toHaveBeenCalledTimes(1);
  });

  it("still stops the microphone even when the save fails", async () => {
    // Session teardown must never be conditional on the save. Leaving the mic
    // recording because a POST failed is the worst possible coupling.
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: "nope" }) }));
    await render();

    await click(buttonNamed(/stop/i));

    expect(hooks.session.stop).toHaveBeenCalledTimes(1);
  });
});

describe("reference lookups — the panel owns per-insight state, MeetingInsightList only reads it", () => {
  const insightA = { id: "i1", text: "Mention the reconciliation win.", kind: "point", source: { kind: "model" } };
  const insightB = { id: "i2", text: "Ask who owns the refund path.", kind: "question", source: { kind: "model" } };

  beforeEach(() => {
    hooks.session.status = "live";
    hooks.session.turns = LIVE_TURNS;
    hooks.insights.topic = "Payments migration";
    hooks.insights.insights = [insightA, insightB];
  });

  it("hands MeetingInsightList a referencesByInsightId map and an onFindReferences function", async () => {
    await render();
    const props = hooks.listProps.at(-1);
    expect(typeof props.onFindReferences).toBe("function");
    expect(typeof props.referencesByInsightId).toBe("object");
  });

  it("passes the engine the panel already reads through to the reference lookup", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url === "/api/meeting/references") return { ok: true, json: async () => ({ references: [], dropped: 0, grounded: true }) };
      return { ok: false, json: async () => ({}) };
    });
    await render();
    const props = hooks.listProps.at(-1);

    await act(async () => {
      props.onFindReferences(insightA);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const call = global.fetch.mock.calls.find(([url]) => url === "/api/meeting/references");
    expect(call).toBeDefined();
    const body = JSON.parse(call[1].body);
    // The panel reads engine via readEngine(); jsdom/localStorage has no
    // stored preference in this test, so whatever the default resolves to
    // is what must be forwarded — asserting a STRING (not undefined/null)
    // is what catches a mutation that drops `engine` from the POST body.
    expect(typeof body.engine).toBe("string");
    expect(body.insightText).toBe(insightA.text);
    expect(body.topic).toBe("Payments migration");
  });

  // Mutation this catches: reusing one shared piece of state (or one shared
  // key) for every insight's lookup, which would make a second insight's
  // fetch overwrite or clear the first's result the moment it starts.
  it("keys results by insight id, so two insights' references do not leak into each other", async () => {
    let resolveA;
    let resolveB;
    global.fetch = vi.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.insightText === insightA.text) {
        return new Promise((resolve) => {
          resolveA = () => resolve({ ok: true, json: async () => ({ references: [{ title: "A doc", url: "https://a.example.com/x", host: "a.example.com" }], dropped: 0, grounded: true }) });
        });
      }
      return new Promise((resolve) => {
        resolveB = () => resolve({ ok: true, json: async () => ({ references: [{ title: "B doc", url: "https://b.example.com/y", host: "b.example.com" }], dropped: 0, grounded: true }) });
      });
    });
    await render();
    const props = hooks.listProps.at(-1);

    await act(async () => {
      props.onFindReferences(insightA);
      props.onFindReferences(insightB);
    });

    await act(async () => {
      resolveA();
      resolveB();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const latest = hooks.listProps.at(-1);
    expect(latest.referencesByInsightId[insightA.id].result.references[0].title).toBe("A doc");
    expect(latest.referencesByInsightId[insightB.id].result.references[0].title).toBe("B doc");
  });

  // Mutation this catches: firing a second fetch for an insight that already
  // has one in flight (e.g. a double-click, or MeetingInsightList calling
  // onFindReferences again while `status` is still "loading").
  it("does not duplicate a request already in flight for the same insight", async () => {
    let callCount = 0;
    let resolveFirst;
    global.fetch = vi.fn(() => {
      callCount += 1;
      return new Promise((resolve) => {
        resolveFirst = () => resolve({ ok: true, json: async () => ({ references: [], dropped: 0, grounded: true }) });
      });
    });
    await render();
    const props = hooks.listProps.at(-1);

    await act(async () => {
      props.onFindReferences(insightA);
      props.onFindReferences(insightA);
    });
    expect(callCount).toBe(1);

    await act(async () => {
      resolveFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(callCount).toBe(1);
  });

  // The OLD version of this test only checked that two mock elements still
  // existed and that one prop kept its object identity — true for nearly
  // ANY implementation, including a blocking one, because nothing in it
  // actually raced against the stuck fetch. Driving a real concurrent
  // action (saving the meeting) all the way to completion is what makes the
  // assertion real: an implementation that accidentally awaited the
  // reference lookup — or gated a render on it — before letting Stop/save
  // proceed would leave `onMeetingSaved` never called, not silently pass.
  it("does not block saving the meeting while a reference lookup is still stuck in flight", async () => {
    global.fetch = vi.fn((url) => {
      if (url === "/api/meeting/references") return new Promise(() => {}); // never resolves
      return Promise.resolve({ ok: true, json: async () => ({ page: { id: "new-1", title: "Saved" } }) });
    });
    const onMeetingSaved = vi.fn();
    await render({ onMeetingSaved });
    const props = hooks.listProps.at(-1);

    await act(async () => {
      props.onFindReferences(insightA);
    });

    await click(buttonNamed(/stop/i));

    // The save completed right through a reference lookup that has still
    // never resolved.
    expect(onMeetingSaved).toHaveBeenCalledTimes(1);
  });
});

describe("reference lookups — surviving a new meeting", () => {
  // Fix 4: insightId() hashes NORMALIZED TEXT (see insightContract.js's own
  // comment — "same normalized text in, same id out ... in a different
  // process entirely"), so the identical discussion point raised again in a
  // LATER meeting reuses the exact same id. Without a guard, a reference
  // lookup that outlives the meeting it was fired from can land under that
  // shared id in a meeting that has since started — overwriting whatever
  // THAT meeting's own attempt already produced with a stale answer from a
  // meeting that is already over.
  //
  // Deliberately does NOT force `hooks.session.status = "live"` the way the
  // describe blocks above do: this test needs `running` to actually go
  // false after Stop and true again after a second Start, which only
  // happens here because it is driven by `meetingActive` — a forced "live"
  // status would keep the panel's running view up regardless of Stop, and
  // there would be no second meeting to abandon the first lookup into.
  it("discards a reference result that resolves after a new meeting has replaced this one", async () => {
    let resolveOldLookup;
    global.fetch = vi.fn((url) => {
      if (url === "/api/meeting/references") {
        return new Promise((resolve) => {
          resolveOldLookup = () =>
            resolve({
              ok: true,
              json: async () => ({
                references: [{ title: "Stale doc", url: "https://stale.example.com/x", host: "stale.example.com" }],
                dropped: 0,
                grounded: true,
              }),
            });
        });
      }
      if (url === "/api/meeting/save") {
        return Promise.resolve({ ok: true, json: async () => ({ page: { id: "saved-1", title: "Saved" } }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    // Named for what matters here: the SAME wording is raised again in the
    // second meeting below, so insightId() (a hash of normalized text) gives
    // it the same id both times — that shared id is the entire premise of
    // this test.
    const recurringInsight = { id: "i1", text: "Ask who owns the refund path.", kind: "question", source: { kind: "model" } };
    hooks.insights.insights = [recurringInsight];
    await render();

    await click(buttonNamed(/start a meeting/i));
    const firstMeetingProps = hooks.listProps.at(-1);
    await act(async () => {
      firstMeetingProps.onFindReferences(recurringInsight);
    });

    // The first meeting ends and a second one begins before the lookup
    // above ever resolves.
    await click(buttonNamed(/stop/i));
    await click(buttonNamed(/start a meeting/i));

    // Only now does the OLD meeting's lookup land.
    await act(async () => {
      resolveOldLookup();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const latest = hooks.listProps.at(-1);
    // The loading state this insight was left in when the first meeting
    // ended is exactly what should still be there — never overwritten by
    // the stale "done" write the discarded result would otherwise have
    // produced.
    expect(latest.referencesByInsightId[recurringInsight.id].status).toBe("loading");
    expect(latest.referencesByInsightId[recurringInsight.id].result).toBeNull();
    expect(JSON.stringify(latest.referencesByInsightId)).not.toContain("Stale doc");
  });
});
