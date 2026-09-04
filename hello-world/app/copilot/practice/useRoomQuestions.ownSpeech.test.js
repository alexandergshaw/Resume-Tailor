// @vitest-environment jsdom
//
// The candidate's OWN tagged speech must never leave the browser as a "room
// question". The disclosure this feature renders
// (practiceRoomQuestionPrivacy.js) promises egress only "If someone else in
// the room asks a question" — so a turn the app cannot attribute to someone
// else must produce no request at all.
//
// This file is a WIRE test, not a unit test of the decision rule
// (roomQuestions.test.js is that). `@/lib/copilot/detectClient` and
// `@/lib/copilot/answerClient` are deliberately NOT mocked: the whole point is
// what actually reaches `global.fetch` — the raw utterance on
// /api/copilot/detect, and the question text on /api/copilot/answer — so the
// real clients, the real engine read, and the real request bodies are all in
// the path. Asserting on a mocked client would only prove the hook called a
// function; it would say nothing about what left the machine.
//
// THE SPY PROVES ITSELF. Every describe below opens with a positive control
// that must RECORD a real request on the very path the other cases assert is
// silent. Without it an "no egress" pass is indistinguishable from a spy that
// was never installed, a hook that threw on mount, or a pre-filter that
// swallowed the utterance for an unrelated reason — this repo has already
// shipped a network assertion that could not fire.
//
// It also pins `globalThis.fetch === spy` at the end of each case:
// lib/copilot/bodyLandmarks.js (installTelemetryGuard, lines 107-121)
// permanently reassigns `globalThis.fetch` if it ever loads in this process,
// which would shadow the spy and make it silently blind. Nothing imported here
// pulls that module in today; the assertion is what keeps that true.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import { useRoomQuestions } from "./useRoomQuestions.js";
import { ENGINE_STORAGE_KEY } from "@/app/settings/engine";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// What the candidate says to THEMSELVES, out loud, between questions and
// before their first answer of the session has completed. Phrased as a
// question, which is the worst case: detectQuestion's heuristic
// (lib/copilot/questions.js) fires on the "how" opener, so nothing downstream
// pre-filters it away — the only thing that can stop it is the attribution
// gate itself.
const OWN_SPEECH = "how do I even start describing that migration project";
// Someone else in the room, for the positive controls.
const ROOM_SPEECH = "how would you scale this service";

const DETECT_REPLY = { isQuestion: true, question: "How would you scale this?", type: "technical" };
const ANSWER_REPLY = { points: ["Name the constraint."], cues: ["Constraint"], buzzwords: [] };

// Minimal stand-in for a fetch Response — detectClient/answerClient read only
// `ok`, `status` and `json()`.
function reply(json) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
}

let calls;
let spy;
let realFetch;

function installSpy() {
  calls = [];
  spy = vi.fn((input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    let body = null;
    try {
      body = init?.body ? JSON.parse(init.body) : null;
    } catch {
      body = { unparsed: String(init?.body) };
    }
    calls.push({ url, body });
    if (String(url).includes("/api/copilot/detect")) return reply(DETECT_REPLY);
    if (String(url).includes("/api/copilot/answer")) return reply(ANSWER_REPLY);
    return reply({});
  });
  globalThis.fetch = spy;
}

function callsTo(fragment) {
  return calls.filter((c) => String(c.url).includes(fragment));
}

// Every string this hook could possibly put on the wire, flattened, so a case
// can assert the candidate's words appear in NO request field rather than
// guessing which field would have carried them.
function everySentString() {
  return calls
    .map((c) => `${c.url} ${JSON.stringify(c.body)}`)
    .join(" ")
    .toLowerCase();
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
  return { state };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  installSpy();
  localStorage.clear();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  globalThis.fetch = realFetch;
  localStorage.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Gemini engine — the branch that runs in production wherever a Gemini key is
// configured. `readEngine()` (app/settings/engine.js) returns DEFAULT_ENGINE
// ("gemini") for empty storage, so this is also the default here, but it is
// SET EXPLICITLY rather than left to the default: `wantsEmbedded(undefined)`
// is environment-conditional (true with no key, false with one), and a test
// that leans on the ambient default proves whichever branch this dev machine
// happens to have rather than the one users run.
// ---------------------------------------------------------------------------
describe("room-question egress on the Gemini engine", () => {
  beforeEach(() => {
    localStorage.setItem(ENGINE_STORAGE_KEY, "gemini");
  });

  it("POSITIVE CONTROL: someone else's question really does reach both routes", async () => {
    const { state } = mountProbe({ myTag: 0, collecting: false });
    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: ROOM_SPEECH });
    });

    const detect = callsTo("/api/copilot/detect");
    expect(detect).toHaveLength(1);
    // The RAW speech, verbatim — this is the field the sweep found carrying it.
    expect(detect[0].body.utterance).toBe(ROOM_SPEECH);
    expect(detect[0].body.engine).toBe("gemini");

    const answer = callsTo("/api/copilot/answer");
    expect(answer).toHaveLength(1);
    expect(answer[0].body.question).toBe(DETECT_REPLY.question);
    expect(answer[0].body.profile).toBe("Senior engineer at Acme.");
    expect(answer[0].body.engine).toBe("gemini");

    expect(state.questions).toHaveLength(1);
    expect(globalThis.fetch).toBe(spy);
  });

  it("sends nothing when the candidate thinks out loud before their first answer completes", async () => {
    // THE DEFECT. `myTag` is null for the entire session until an answer with
    // at least one tagged final has completed (usePracticeAnswer.js), and a
    // solo session never learns one at all. With a tag on the frame and no
    // `myTag` to compare it against, the app knows only that SOMEONE spoke —
    // not that it was someone else. The disclosure promises egress only for
    // someone else.
    const { state } = mountProbe({ myTag: null, collecting: false });
    await act(async () => {
      state.onUtterance({ speakerTag: 0, text: OWN_SPEECH });
    });

    expect(callsTo("/api/copilot/detect")).toEqual([]);
    expect(callsTo("/api/copilot/answer")).toEqual([]);
    expect(everySentString()).not.toContain("migration project");
    expect(state.questions).toHaveLength(0);
    expect(globalThis.fetch).toBe(spy);
  });

  it("stays silent for an undefined myTag as well as a null one", async () => {
    // useRoomQuestions coerces `myTag ?? null` into its ref, but the decision
    // rule is called with whatever that ref holds, and the rule's own contract
    // treats undefined and null alike. Pinned so a caller that ever passes
    // undefined straight through cannot reopen this.
    const { state } = mountProbe({ myTag: undefined, collecting: false });
    await act(async () => {
      state.onUtterance({ speakerTag: 2, text: OWN_SPEECH });
    });

    expect(callsTo("/api/copilot/detect")).toEqual([]);
    expect(callsTo("/api/copilot/answer")).toEqual([]);
    expect(globalThis.fetch).toBe(spy);
  });

  it("still sends nothing once an answer has completed, for the candidate's learned tag", async () => {
    // The already-correct half, re-pinned on the wire rather than in the pure
    // rule: with myTag known, the candidate's own voice was always silent.
    const { state } = mountProbe({ myTag: 1, collecting: false });
    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: OWN_SPEECH });
    });

    expect(calls).toEqual([]);
    expect(globalThis.fetch).toBe(spy);
  });
});

// ---------------------------------------------------------------------------
// Embedded engine — confirmQuestion short-circuits to localDetection in the
// browser and never touches /api/copilot/detect at all (detectClient.js), so
// the egress to check on this path is the SECOND route: draftAnswer always
// posts to /api/copilot/answer regardless of engine (answerClient.js has no
// embedded short-circuit). A test that only watched the detect route would
// report this branch clean while the candidate's words were still leaving.
// ---------------------------------------------------------------------------
describe("room-question egress on the embedded engine", () => {
  beforeEach(() => {
    localStorage.setItem(ENGINE_STORAGE_KEY, "embedded");
  });

  it("POSITIVE CONTROL: someone else's question skips detect but still posts to the answer route", async () => {
    const { state } = mountProbe({ myTag: 0, collecting: false });
    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: ROOM_SPEECH });
    });

    expect(callsTo("/api/copilot/detect")).toEqual([]);
    const answer = callsTo("/api/copilot/answer");
    expect(answer).toHaveLength(1);
    expect(answer[0].body.engine).toBe("embedded");
    // localDetection returns the speech itself as the question on this path,
    // so the candidate's own words would be the payload verbatim.
    expect(String(answer[0].body.question).toLowerCase()).toContain("scale this service");
    expect(state.questions).toHaveLength(1);
    expect(globalThis.fetch).toBe(spy);
  });

  it("sends nothing when the candidate thinks out loud before their first answer completes", async () => {
    const { state } = mountProbe({ myTag: null, collecting: false });
    await act(async () => {
      state.onUtterance({ speakerTag: 0, text: OWN_SPEECH });
    });

    expect(calls).toEqual([]);
    expect(everySentString()).not.toContain("migration project");
    expect(state.questions).toHaveLength(0);
    expect(globalThis.fetch).toBe(spy);
  });
});

// ---------------------------------------------------------------------------
// Manual entry is the escape hatch that makes the tightened gate liveable: a
// candidate rehearsing with a friend can still get the first question of the
// session drafted by typing it, which is an explicit statement about someone
// else's question rather than a guess about a voice. Pinned here on the wire
// so a future tightening of the gate cannot close this route too.
// ---------------------------------------------------------------------------
describe("typed questions are unaffected by the attribution gate", () => {
  beforeEach(() => {
    localStorage.setItem(ENGINE_STORAGE_KEY, "gemini");
  });

  it("drafts a typed question even before any answer has completed", async () => {
    const { state } = mountProbe({ myTag: null, collecting: false });
    await act(async () => {
      state.addManualQuestion("How would you scale this service?");
    });

    expect(callsTo("/api/copilot/detect")).toEqual([]);
    const answer = callsTo("/api/copilot/answer");
    expect(answer).toHaveLength(1);
    expect(answer[0].body.question).toBe("How would you scale this service?");
    expect(globalThis.fetch).toBe(spy);
  });
});
