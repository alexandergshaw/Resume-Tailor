// @vitest-environment jsdom
//
// AC-R1 (step-5 contract tests, written before the implementation) —
// recording an answer in the "Speak as" mode and getting the same feedback
// practice mode gives.
//
// Rendered rather than reasoned about, for the same reason
// RoleDrillClient.contract.test.js is: the acceptance criteria here ARE the
// wiring — whether pressing one button both opens the capture session and
// starts the recorder, what the critique request actually carries, whether
// the review and feedback panels appear at all. A hook tested in isolation
// cannot see any of that, and this repo has already shipped a refactor whose
// twenty-seven green piece-level tests never noticed the caller rendered none
// of the pieces.
//
// Everything with a socket, a camera, a recorder or a network call is
// mocked; the register data, the notice text and the panels themselves are
// the real modules.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const sessions = vi.hoisted(() => []);
const recorders = vi.hoisted(() => []);

vi.mock("@/lib/copilot/roleDrillClient", () => ({
  fetchRoleSituation: vi.fn(),
  fetchRoleResponse: vi.fn(),
}));

vi.mock("@/lib/copilot/practiceSession", () => ({
  PracticeSession: class FakePracticeSession {
    constructor(opts) {
      this.opts = opts;
      this.stream = null;
      this.stopped = false;
      this.cameraOff = false;
      this.micMuted = false;
      sessions.push(this);
    }

    async start() {
      this.stream = { id: "fake-stream", getTracks: () => [] };
      this.opts.onStream?.(this.stream, true);
      this.opts.onStatus?.("live");
    }

    async stop() {
      this.stopped = true;
    }

    setCameraOff(v) {
      this.cameraOff = v;
    }

    setMicMuted(v) {
      this.micMuted = v;
    }
  },
}));

// The real AnswerRecorder refuses to start while one is already live
// (`if (!this.supported || this._recorder) return;` — answerRecorder.js), and
// usePracticeAnswer reuses ONE instance for a whole session. A double that
// counted every start() unconditionally would score a "Try again" that forgot
// to stop the previous recording as a success, while in a browser that press
// records nothing at all. The guard is reproduced here so the missing stop is
// what fails.
vi.mock("@/lib/copilot/answerRecorder", () => ({
  AnswerRecorder: class FakeAnswerRecorder {
    constructor() {
      this.supported = true;
      this.mimeType = "video/webm";
      this.started = 0;
      this.stopped = 0;
      this.live = false;
      this.lastStream = null;
      recorders.push(this);
    }

    start(stream) {
      if (!this.supported || this.live) return;
      this.lastStream = stream;
      this.live = true;
      this.started += 1;
    }

    async stop() {
      if (!this.live) return null;
      this.live = false;
      this.stopped += 1;
      return { size: 1024, type: "video/webm" };
    }
  },
}));

// Only the sampler is replaced — it wants a real <video> and a canvas, which
// jsdom does not have. Everything else in the module stays REAL: answerMetrics.js
// and critiqueLocal.js both import `summarizeVideoStats` from here, and a
// whole-module factory would quietly replace those with `undefined` for every
// importer, so a future change that started calling one would fail with
// "not a function" rather than being measured by this suite.
vi.mock("@/lib/copilot/videoStats", async (importOriginal) => ({
  ...(await importOriginal()),
  VideoFrameSampler: class FakeVideoFrameSampler {
    start() {}
    stop() {
      return { summary: { hadVideo: true, frames: 10 }, frames: ["data:image/jpeg;base64,AAAA"] };
    }
  },
}));

vi.mock("@/lib/copilot/bodyLandmarks", () => ({
  BodyLanguageSampler: class FakeBodyLanguageSampler {
    start() {}
    stop() {
      return { available: false, reason: "no-samples" };
    }
  },
}));

vi.mock("@/lib/copilot/critiqueClient", () => ({ critiqueAnswer: vi.fn() }));

vi.mock("@/lib/supabase/practiceAnswers", () => ({
  savePracticeAnswer: vi.fn(),
  updatePracticeAnswerCritique: vi.fn(),
}));

import RoleDrillClient from "./RoleDrillClient.js";
import { fetchRoleSituation, fetchRoleResponse } from "@/lib/copilot/roleDrillClient";
import { critiqueAnswer } from "@/lib/copilot/critiqueClient";
import { savePracticeAnswer } from "@/lib/supabase/practiceAnswers";
import { DEFAULT_ROLE, roleRegister } from "@/lib/copilot/roleRegisters";
import { setEngine } from "@/app/settings/engine";
import { roleAnswerQuestion } from "@/lib/copilot/roleDrillAnswer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const SITUATION = {
  id: `${DEFAULT_ROLE}-first`,
  prompt: "Your director stops you in the hallway and asks why the release slipped a week.",
  context: "The director already has the dates; what they want is your read on it.",
};

const CRITIQUE = {
  score: 72,
  verdict: "A clear answer that owns the slip without over-explaining it.",
  strengths: ["Named the cause in the first sentence."],
  improvements: ["Give the new date before the reasoning."],
  missing: ["What you changed so it does not happen again."],
  star: null,
  delivery: ["Pace was steady at 138 words per minute."],
  source: "gemini",
};

function accessibleName(el) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  if (el.id) {
    const associated = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (associated) return (associated.textContent || "").trim();
  }
  const wrapping = el.closest("label");
  if (wrapping) return (wrapping.textContent || "").trim();
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  const inner = (clone.textContent || "").trim();
  return inner || (el.getAttribute("title") || "").trim();
}

// Holds the next situation fetch open so a test can act while it is still in
// flight — the window in which the card still shows the PREVIOUS situation.
function deferSituation() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  fetchRoleSituation.mockReturnValueOnce(promise);
  return {
    async land(situation) {
      await act(async () => {
        resolve({ role: DEFAULT_ROLE, situation, source: "embedded", exhausted: false });
        await vi.advanceTimersByTimeAsync(0);
      });
    },
  };
}

const SITUATION_B = {
  id: `${DEFAULT_ROLE}-second`,
  prompt: "A teammate tells you in your one to one that they are thinking of leaving.",
  context: "Nothing has been said to anyone else yet.",
};

const buttons = () => [...container.querySelectorAll("button")];
const buttonNamed = (re) => buttons().find((b) => re.test(accessibleName(b)));
const text = () => container.textContent || "";

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(RoleDrillClient, { sttProviderName: "Deepgram", ...props }));
  });
}

async function click(el, label = "control") {
  expect(el, `${label} not found`).toBeTruthy();
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.click();
  });
}

// Delivers one finalized utterance through whatever session is live, the way
// the real STT socket does — this is the only way words ever reach the
// answer, so a test that skips it measures an empty answer.
//
// `audioCursor` is not decoration. A final is admitted into the answer by
// its AUDIO-time offset, not its arrival order (isFinalInAnswerWindow,
// lib/copilot/answerWindow.js): the window's lower bound is the audio clock
// as it stood when "Start answering" fired, and that clock only ever moves
// forward across the whole session. A second answer that replayed
// `start: 0` would therefore be rejected in full, and the test would go on
// to assert against an EMPTY answer while still passing — so every
// utterance is stamped after the last one, exactly as a real socket would.
let audioCursor = 0;

async function speak(words, { duration = 4 } = {}) {
  const session = sessions[sessions.length - 1];
  expect(session, "no capture session was ever started").toBeTruthy();
  const start = audioCursor;
  audioCursor += duration;
  await act(async () => {
    session.opts.onTranscript?.({ transcript: words, isFinal: true, start, duration });
  });
}

// "Done" hands off to a ~1.8s transcript drain before anything is computed.
async function finishAnswer() {
  await click(buttonNamed(/^Done$/), "Done");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

// One press, from a cold mode to a running recorder.
async function startSpeaking() {
  await click(buttonNamed(/Start speaking/i), "Start speaking");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessions.length = 0;
  recorders.length = 0;
  audioCursor = 0;
  try {
    globalThis.localStorage.clear();
  } catch {
    /* jsdom always has one; a private-mode throw must not fail the suite */
  }
  // The engine is a real module-scope external store, not component state —
  // a test that switches it must not leak that choice into the next one.
  setEngine("gemini");
  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
  globalThis.URL.revokeObjectURL = vi.fn();
  fetchRoleSituation.mockResolvedValue({
    role: DEFAULT_ROLE,
    situation: SITUATION,
    source: "embedded",
    exhausted: false,
  });
  fetchRoleResponse.mockResolvedValue({
    role: DEFAULT_ROLE,
    lines: roleRegister(DEFAULT_ROLE).beatLabels.map((label) => ({ label, text: "A sentence." })),
    cadence: roleRegister(DEFAULT_ROLE).cadence,
    terms: roleRegister(DEFAULT_ROLE).vocabulary,
    termsUsed: [],
    avoid: roleRegister(DEFAULT_ROLE).avoid,
    source: "embedded",
  });
  critiqueAnswer.mockResolvedValue(CRITIQUE);
  savePracticeAnswer.mockResolvedValue({ data: { id: "row-1" }, error: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Speak as - the recording surface (AC-R1.1, AC-R1.2)", () => {
  it("offers a microphone and a way to start speaking, and grabs no hardware until asked", async () => {
    await render();
    expect(buttonNamed(/Start speaking/i), "no way to start speaking").toBeTruthy();
    expect(text(), "no microphone label").toMatch(/Your microphone/i);
    // The prose alone lives in a <Typography>; without this the label could
    // sit above nothing at all. The role picker is a native <select>, so the
    // mic picker is identified by its own accessible name, not by tag.
    const micControl = [...container.querySelectorAll('select,[role="combobox"]')].find((el) =>
      /microphone/i.test(accessibleName(el)),
    );
    expect(micControl, "no microphone picker").toBeTruthy();
    expect(sessions, "a capture session was opened before the user asked for one").toHaveLength(0);
    expect(recorders, "the recorder was started before the user asked for one").toHaveLength(0);
  });

  it("opens the camera and mic session and starts recording from ONE press", async () => {
    await render({ micDeviceId: "mic-7" });
    await startSpeaking();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].opts.micDeviceId).toBe("mic-7");
    expect(sessions[0].opts.withVideo, "camera frames and body language need video").toBe(true);
    expect(recorders, "one press must also start the recorder").toHaveLength(1);
    expect(recorders[0].started).toBe(1);
    expect(buttonNamed(/^Done$/), "no way to finish the answer").toBeTruthy();
    expect(text()).toMatch(/Recording your answer/i);
  });

  it("states where the audio and the answer go before anything is recorded", async () => {
    await render();
    expect(text()).toContain("Your audio is streamed to Deepgram for transcription.");
    expect(text()).toContain("sent to Google Gemini for feedback");
    expect(text().toLowerCase()).not.toContain("prep context");
  });
});

describe("Speak as - the feedback that comes back (AC-R1.3, AC-R1.4, AC-R1.7)", () => {
  it("judges what was actually said, and shows both the measurements and the critique", async () => {
    await render();
    await startSpeaking();
    await speak("I owned the slip in the first sentence and gave the director the new date.");
    await finishAnswer();

    expect(critiqueAnswer).toHaveBeenCalledTimes(1);
    const payload = critiqueAnswer.mock.calls[0][0];
    expect(payload.answer).toContain("I owned the slip in the first sentence");
    expect(payload.question).toBe(
      roleAnswerQuestion({ roleLabel: roleRegister(DEFAULT_ROLE).label, situation: SITUATION }),
    );
    // Asserting the SHAPE of the metrics would be satisfied by a hand-rolled
    // object built beside the shared pipeline. These two are not: the key set
    // is computeAnswerMetrics's own, and `bodyLanguage` is merged onto it by
    // usePracticeAnswer.doneAnswer and nowhere else. A fork that reproduced
    // them would also have to reproduce the generation guard, the live
    // save-switch re-read, and the muted-mic seed that come with them.
    expect(payload.metrics).toEqual(
      expect.objectContaining({
        wordCount: expect.any(Number),
        speechDurationSec: expect.any(Number),
        wordsPerMinute: expect.any(Number),
        paceLabel: expect.any(String),
        paceIsPlausible: expect.any(Boolean),
        discourseMarkerCount: expect.any(Number),
        micMuted: false,
      }),
    );
    expect(payload.metrics.wordCount).toBeGreaterThan(0);
    expect(payload.metrics.bodyLanguage, "the body-language sampler's result never reached the critique").toEqual({
      available: false,
      reason: "no-samples",
    });

    expect(text(), "the critique's verdict never reached the screen").toContain(CRITIQUE.verdict);
    expect(text()).toContain("Named the cause in the first sentence.");
    // A measured VALUE, not a row label — "Speaking time" renders for a
    // wholly empty answer too, with the value "unavailable".
    expect(text(), "the delivery measurements panel is missing").toMatch(/\d+ words\/min/);
  });

  it("sends nothing about a posting, a résumé, a cover letter or the prep context", async () => {
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();

    const payload = critiqueAnswer.mock.calls[0][0];
    // Positive control: this really is a populated request, so the absence
    // checks below cannot be satisfied by a call that never happened.
    expect(payload.answer.length).toBeGreaterThan(10);
    expect(payload.posting).toBeNull();
    expect(payload.profile).toBe("");
    expect(payload.applicationId).toBeNull();
  });

  it("attaches no camera frames while the opt-in is off, and does once it is on", async () => {
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();
    expect(critiqueAnswer.mock.calls[0][0].frames).toEqual([]);

    const framesSwitch = [...container.querySelectorAll("input[type='checkbox']")].find((el) =>
      /camera frames/i.test(accessibleName(el)),
    );
    expect(framesSwitch, "no camera-frames opt-in").toBeTruthy();
    await click(buttonNamed(/Try again/i), "Try again");
    await act(async () => {
      framesSwitch.click();
    });
    await speak("A second attempt, said differently this time.");
    await finishAnswer();
    // Positive control: the second answer really was recorded. Without it a
    // second attempt whose transcript was silently rejected (its audio-time
    // window is later than the first's — see speak()) would still satisfy the
    // frames assertion, since frames are collected independently of words.
    expect(critiqueAnswer.mock.calls[1][0].answer).toContain("A second attempt");
    expect(critiqueAnswer.mock.calls[1][0].frames.length).toBeGreaterThan(0);
  });

  it("offers the drill's own loop, not practice mode's wording", async () => {
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();

    // TWO of them: the situation card has carried a "New situation" button
    // since this mode shipped, so finding merely one proves nothing about the
    // feedback panel's own action having been labelled at all.
    const named = buttons().filter((b) => /^New situation$/.test(accessibleName(b)));
    expect(named, "the feedback panel must lead back into the drill").toHaveLength(2);
    expect(buttonNamed(/^Try again$/)).toBeTruthy();
    expect(buttonNamed(/^Next question$/), "there are no questions in this mode").toBeFalsy();
  });

  it("re-arms the recorder for the SAME situation on Try again, with no second press", async () => {
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();

    // usePracticeAnswer reuses one AnswerRecorder for the whole session, so
    // a second recording is a second start() on the SAME instance, never a
    // second instance — asserting on the array length here would pass
    // against a Try again that records nothing at all.
    const startsBefore = recorders[0].started;
    const stopsBefore = recorders[0].stopped;
    await click(buttonNamed(/^Try again$/), "Try again");
    expect(recorders[0].started, "Try again must start recording again by itself").toBe(startsBefore + 1);
    expect(recorders[0].lastStream, "the recorder was re-armed with no live stream").toBeTruthy();
    expect(recorders[0].stopped, "Try again must finalize the previous recording first").toBe(stopsBefore);
    expect(text()).toContain(SITUATION.prompt);
    expect(fetchRoleSituation, "Try again must not fetch a different situation").toHaveBeenCalledTimes(1);
  });

  it("saves the answer to practice history with no posting attached", async () => {
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();

    expect(savePracticeAnswer).toHaveBeenCalledTimes(1);
    const saved = savePracticeAnswer.mock.calls[0][0];
    expect(saved.applicationId).toBeNull();
    expect(saved.postingTitle).toBe("");
    expect(saved.postingCompany).toBe("");
    expect(saved.transcript).toContain("A full sentence spoken out loud");
    expect(saved.critique).toEqual(CRITIQUE);
  });
});

describe("Speak as - the drill itself still works (AC-R1.8, AC-R1.9)", () => {
  it("keeps the model answer a disclosure that never touches the recorder", async () => {
    await render();
    await startSpeaking();
    const startsBefore = recorders[0].started;

    await click(buttonNamed(/Reveal a model answer/i), "Reveal a model answer");
    expect(recorders[0].started, "revealing an answer must not start a second recording").toBe(startsBefore);
    expect(recorders[0].stopped, "revealing an answer must not stop the recording").toBe(0);
    expect(buttonNamed(/^Done$/), "the recording must still be running").toBeTruthy();
    expect(text()).toContain("Hide model answer");
  });

  it("releases the camera and microphone when the mode is left", async () => {
    await render();
    await startSpeaking();
    expect(sessions[0].stopped).toBe(false);
    await act(async () => root.unmount());
    expect(sessions[0].stopped, "leaving Speak as must release the camera and mic").toBe(true);
    // Re-created so afterEach's unmount has something valid to act on.
    root = createRoot(container);
  });

  it("throws away an answer that is still settling when a new situation is asked for", async () => {
    await render();
    await startSpeaking();
    await speak("Half an answer, abandoned mid-sentence.");

    // Pressing "New situation" while merely RECORDING could never reach the
    // critique in any implementation — doneAnswer is its only caller. The
    // window that can actually leak is the ~1.8s transcript drain after Done,
    // where a stale continuation must find its generation bumped and write
    // nothing (the BUG-11 shape this codebase has already been bitten by).
    await click(buttonNamed(/^Done$/), "Done");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fetchRoleSituation.mockResolvedValue({
      role: DEFAULT_ROLE,
      situation: { ...SITUATION, id: `${DEFAULT_ROLE}-second`, prompt: "A different scene entirely." },
      source: "embedded",
      exhausted: false,
    });
    await click(buttonNamed(/^New situation$/), "New situation");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchRoleSituation, "the new situation was never requested").toHaveBeenCalledTimes(2);
    expect(text(), "the new situation never reached the screen").toContain("A different scene entirely.");
    expect(critiqueAnswer, "an abandoned answer must never be judged").not.toHaveBeenCalled();
    expect(text(), "an abandoned answer left its review panel on screen").not.toContain(CRITIQUE.verdict);
    expect(text(), "an abandoned critique stranded the panel mid-flight").not.toMatch(/Analy[sz]ing your answer/i);
  });

  it("sends no camera frames on the embedded engine, even with the opt-in already on", async () => {
    await render();
    await startSpeaking();

    const framesSwitch = [...container.querySelectorAll("input[type='checkbox']")].find((el) =>
      /camera frames/i.test(accessibleName(el)),
    );
    expect(framesSwitch, "no camera-frames opt-in").toBeTruthy();
    await act(async () => {
      framesSwitch.click();
    });
    expect(framesSwitch.checked, "positive control: the opt-in really is on").toBe(true);

    // The engine is a global preference changed elsewhere in the app, so it
    // can move underneath a switch that is already on — which is exactly the
    // case where a naive `includeFrames: sendFrames` ships a photograph of
    // the user's face to Google while the notice on screen swears nothing is
    // sent there at all.
    await act(async () => {
      setEngine("embedded");
    });
    expect(text(), "the notice must state the embedded guarantee").toContain("never sent to Google");

    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();
    expect(critiqueAnswer).toHaveBeenCalledTimes(1);
    expect(critiqueAnswer.mock.calls[0][0].answer, "positive control: a real answer was sent").toContain(
      "A full sentence",
    );
    expect(critiqueAnswer.mock.calls[0][0].frames).toEqual([]);
  });

  it("does not upload when saving is switched off while the critique is still running", async () => {
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");

    const saveSwitch = [...container.querySelectorAll("input[type='checkbox']")].find((el) =>
      /save recordings/i.test(accessibleName(el)),
    );
    expect(saveSwitch, "no save-recordings switch").toBeTruthy();
    expect(saveSwitch.checked, "positive control: saving defaults on").toBe(true);
    await act(async () => {
      saveSwitch.click();
    });

    await finishAnswer();
    // The upload happens seconds after Done, once the critique settles, so the
    // switch must be re-read at THAT moment. A latched snapshot taken when
    // Done was pressed — or no reader passed at all, which persistAnswer
    // treats as "enabled" — uploads a recording the user just declined.
    expect(critiqueAnswer, "positive control: the answer was still judged").toHaveBeenCalledTimes(1);
    expect(savePracticeAnswer).not.toHaveBeenCalled();
  });

  it("says plainly when the answer could not be saved, rather than implying it was kept", async () => {
    savePracticeAnswer.mockResolvedValue({ data: null, error: "You must be signed in to save practice answers." });
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();

    expect(savePracticeAnswer).toHaveBeenCalledTimes(1);
    expect(text()).toContain("You must be signed in to save practice answers.");
  });
});

describe("Speak as - the situation you are actually answering (AC-R1.2, AC-R1.7)", () => {
  it("never judges the answer against a situation that replaced the one you spoke to", async () => {
    await render();
    await startSpeaking();
    await finishAnswer();
    critiqueAnswer.mockClear();

    // "New situation" from the feedback panel: the fetch is in flight and the
    // card still shows the OLD situation until it lands (useRoleDrill keeps
    // the previous one on screen deliberately). Pressing "Start speaking" in
    // that window used to record immediately against the stale scene, and the
    // new one would then swap in underneath the running recorder — so the
    // critique graded the answer, and the saved history row, against a scene
    // the user never read.
    const pending = deferSituation();
    await click(buttonNamed(/^New situation$/), "New situation");
    const startsBefore = recorders[0].started;
    await startSpeaking();

    // THE ASSERTION THAT MATTERS. Judging against the situation on screen at
    // Done is not enough on its own: with the recorder running against the
    // stale scene, "what was on screen at Done" is already the NEW one, so an
    // outcome-only check passes against the exact bug it is named for. What
    // has to hold is that no recording exists while the card is still showing
    // a situation the user is about to be moved off.
    expect(recorders[0].started, "recording began against a situation about to be replaced").toBe(startsBefore);
    expect(text(), "positive control: the old scene really is still on screen").toContain(SITUATION.prompt);

    await pending.land(SITUATION_B);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(recorders[0].started, "the armed press was dropped instead of waiting").toBe(startsBefore + 1);
    expect(text()).toContain(SITUATION_B.prompt);

    await speak("This answer is about the teammate who is thinking of leaving.");
    await finishAnswer();

    expect(critiqueAnswer).toHaveBeenCalledTimes(1);
    const asked = critiqueAnswer.mock.calls[0][0].question;
    expect(asked, "graded against a scene the user never saw").toContain(SITUATION_B.prompt);
    expect(asked).not.toContain(SITUATION.prompt);
  });

  it("gets from the feedback panel to a fresh situation being recorded in ONE press", async () => {
    await render();
    await startSpeaking();
    await finishAnswer();

    const startsBefore = recorders[0].started;
    const pending = deferSituation();
    await click(buttonNamed(/^New situation$/), "New situation");
    await pending.land(SITUATION_B);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(text()).toContain(SITUATION_B.prompt);
    expect(recorders[0].started, "a second press was needed to start recording").toBe(startsBefore + 1);
  });
});

describe("Speak as - the primary control never lies about what it will do (AC-R1.1)", () => {
  it("cannot be pressed while there is no situation to answer", async () => {
    const pending = deferSituation();
    await act(async () => {
      root.render(createElement(RoleDrillClient, { sttProviderName: "Deepgram" }));
    });

    const start = buttonNamed(/Start speaking/i);
    expect(start, "no primary control").toBeTruthy();
    // It used to be enabled here. Pressing it acquired the camera and
    // microphone — permission prompt, camera light on — armed a press that
    // `canStartRoleAnswer` then rejected, disarmed it, and recorded nothing,
    // with no message anywhere on screen.
    expect(start.disabled, "enabled with nothing to answer").toBe(true);
    await pending.land(SITUATION);
    expect(buttonNamed(/Start speaking/i).disabled, "still disabled once a situation arrived").toBe(false);
  });

  it("cannot be pressed when the situation failed to load", async () => {
    fetchRoleSituation.mockRejectedValueOnce(new Error("Situation request failed (500)."));
    await act(async () => {
      root.render(createElement(RoleDrillClient, { sttProviderName: "Deepgram" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(container.querySelector('[role="alert"]'), "positive control: the failure is on screen").toBeTruthy();
    expect(buttonNamed(/Start speaking/i).disabled, "enabled with nothing to answer").toBe(true);
    expect(sessions, "the camera and mic were acquired for nothing").toHaveLength(0);
  });
});

describe("Speak as - Stop ends the session without destroying what you are reading", () => {
  it("keeps the review and the feedback on screen after Stop", async () => {
    await render();
    await startSpeaking();
    await speak("A full sentence spoken out loud in the room.");
    await finishAnswer();
    expect(text(), "positive control: the feedback arrived").toContain(CRITIQUE.verdict);

    await click(buttonNamed(/^Stop$/), "Stop");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Stop's job is to release the camera and microphone. In this mode it sits
    // in the SAME row as Start speaking/Done, so it is pressed right after an
    // answer — wiping the score, the strengths and the replay the user is
    // still reading, with no warning and no undo.
    expect(sessions[0].stopped, "Stop must still release the hardware").toBe(true);
    expect(text(), "Stop deleted the feedback").toContain(CRITIQUE.verdict);
    expect(text(), "Stop deleted the review").toMatch(/\d+ words\/min/);
  });

  it("still discards an answer that was mid-recording when Stop was pressed", async () => {
    await render();
    await startSpeaking();
    await speak("Half an answer, cut off by Stop.");

    await click(buttonNamed(/^Stop$/), "Stop");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(critiqueAnswer, "an answer cut off by Stop must never be judged").not.toHaveBeenCalled();
    expect(text()).not.toMatch(/Recording your answer/i);
  });
});

describe("Speak as - accessibility of the new surface (AC-R1.12, AC-R1.13)", () => {
  it("gives every control on the recording surface its own name", async () => {
    await render();
    await startSpeaking();

    // `aria-hidden` elements are not in the accessibility tree at all, so a
    // name requirement does not apply to them — MUI's non-native Select, for
    // one, renders an internal `<input aria-hidden="true">` that no screen
    // reader ever reaches. Sweeping them in would force real components into
    // contortions to satisfy a rule that does not govern them.
    const controls = [...container.querySelectorAll("button, select, input, [role='combobox']")].filter(
      (el) => !el.closest('[aria-hidden="true"], [hidden]'),
    );
    const names = controls.map((el) => accessibleName(el));
    expect(names.filter((n) => !n), "a control with no accessible name").toEqual([]);
    expect(new Set(names).size, `two controls share a name: ${names.join(" | ")}`).toBe(names.length);
    for (const el of controls) {
      // MUI's Tooltip-on-a-disabled-span idiom steals the control's own
      // accessible name; a disabled control's reason belongs in plain DOM
      // text pointed at by aria-describedby.
      if (el.disabled) {
        expect(el.closest("[title]"), `a Tooltip is sitting on disabled control "${accessibleName(el)}"`).toBeFalsy();
      }
    }
  });

  it("keeps the reveal's own status region first, and empty, so its contract still holds", async () => {
    await render();
    // RoleDrillClient.contract.test.js reads `querySelector('[role="status"]')`
    // — the FIRST such node — and requires it to be empty until an answer is
    // revealed. A recording announcement inserted ahead of it would break that
    // suite without any assertion here explaining why.
    const first = container.querySelector('[role="status"]');
    expect(first, "the reveal's status region is gone").toBeTruthy();
    expect((first.textContent || "").trim()).toBe("");
  });

  it("keeps every file this feature touches under the size cap", () => {
    for (const rel of [
      "app/copilot/CopilotClient.js",
      "app/copilot/practice/usePracticeCaptureSession.js",
      "app/copilot/practice/AnswerFeedback.js",
      "lib/copilot/practiceNotices.js",
      "lib/copilot/roleDrillAnswer.js",
    ]) {
      const lines = readFileSync(path.join(process.cwd(), rel), "utf8").split("\n").length;
      expect(lines, `${rel} is ${lines} lines`).toBeLessThan(1000);
    }
  });
});
