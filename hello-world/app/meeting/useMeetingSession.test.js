// @vitest-environment jsdom
//
// Every criterion here is about WIRING, not logic: which options
// CopilotSession is built with, how a raw transcript frame turns into a
// stored turn, and — the one this file exists to pin — whether an error
// mid-session discards the transcript gathered so far. None of that is
// visible under this repo's default `environment: "node"` (the hook body
// never runs), so this follows app/copilot/useCompanyBrief.test.js's own
// jsdom Probe/flush pattern, itself following useCopilotDashboard.wiring.
// test.js — mount a probe component that publishes the hook's live return
// value to an outer variable, drive it through the mocked CopilotSession's
// captured callbacks, assert on state between `act()` flushes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));

import { useMeetingSession } from "./useMeetingSession.js";
import { CopilotSession } from "@/lib/copilot/session";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Captures the options the hook constructed CopilotSession with, so a test
// can drive it (via sessionOptions.onTranscript/.onStatus/.onError) exactly
// the way the real capture layer does, instead of reaching into the hook's
// internals.
let sessionOptions = null;
let stopMock;

function installSessionMock() {
  stopMock = vi.fn().mockResolvedValue(undefined);
  CopilotSession.mockImplementation(function (options) {
    sessionOptions = options;
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = stopMock;
  });
}

let container;
let root;
let latest;

function Probe({ source, micDeviceId }) {
  latest = useMeetingSession({ source, micDeviceId });
  return null;
}

async function flush(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionOptions = null;
  installSessionMock();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function speak(speaker, text, extra = {}) {
  sessionOptions.onTranscript({
    speaker,
    transcript: text,
    isFinal: true,
    speechFinal: true,
    ...extra,
  });
}

describe("useMeetingSession — building the capture session", () => {
  it("constructs CopilotSession with attributeSpeakers:false and the caller's source/micDeviceId", async () => {
    await render({ source: "inperson", micDeviceId: "mic-7" });
    await act(async () => {
      await latest.start();
    });

    expect(CopilotSession).toHaveBeenCalledTimes(1);
    const opts = CopilotSession.mock.calls[0][0];
    expect(opts.attributeSpeakers).toBe(false);
    expect(opts.source).toBe("inperson");
    expect(opts.micDeviceId).toBe("mic-7");
  });

  it("does not build a second session while one is already running", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });
    await act(async () => {
      await latest.start();
    });
    expect(CopilotSession).toHaveBeenCalledTimes(1);
  });
});

describe("useMeetingSession — turns store the raw routing value", () => {
  it("records the speaker exactly as the frame carries it, for all three routing values", async () => {
    await render({ source: "inperson" });
    await act(async () => {
      await latest.start();
    });

    act(() => {
      speak("room", "Shall we start with the migration status?");
    });
    act(() => {
      speak("them", "Sure, go ahead.");
    });
    act(() => {
      speak("you", "The dual write window closes Friday.");
    });

    expect(latest.turns.map((t) => t.speaker)).toEqual(["room", "them", "you"]);
    expect(latest.turns.map((t) => t.text)).toEqual([
      "Shall we start with the migration status?",
      "Sure, go ahead.",
      "The dual write window closes Friday.",
    ]);
    // Never a resolved label — that translation belongs to the render
    // boundary (lib/meeting/insightContract.js's meetingSpeakerLabel), not
    // to this hook's stored data.
    expect(latest.turns.every((t) => t.speaker !== "Others" && t.speaker !== "You")).toBe(true);
  });

  it("assigns each turn a stable, growing id and a capture timestamp", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });
    act(() => speak("them", "First."));
    act(() => speak("them", "Second."));

    expect(latest.turns[0].id).not.toBe(latest.turns[1].id);
    expect(typeof latest.turns[0].at).toBe("number");
  });
});

describe("useMeetingSession — interim text keyed by routing value", () => {
  it("holds interim text for 'room', which a fixed {them,you} shape has no slot for", async () => {
    await render({ source: "inperson" });
    await act(async () => {
      await latest.start();
    });

    act(() => {
      sessionOptions.onTranscript({ speaker: "room", transcript: "Shall we start", isFinal: false });
    });
    expect(latest.interims.room).toBe("Shall we start");

    act(() => {
      speak("room", "Shall we start with the migration status?");
    });
    expect(latest.interims.room).toBe("");
    expect(latest.turns.map((t) => t.text)).toEqual(["Shall we start with the migration status?"]);
  });
});

describe("useMeetingSession — the textAlreadyDelivered guard (R-127)", () => {
  it("does not append a re-delivered final's text a second time", async () => {
    await render({ source: "inperson" });
    await act(async () => {
      await latest.start();
    });

    act(() => speak("room", "The dual write window closes Friday."));
    // ElevenLabs' commit_strategy=vad re-delivery of the same span, this
    // time carrying speechFinal.
    act(() => speak("room", "The dual write window closes Friday.", { textAlreadyDelivered: true }));

    expect(latest.turns).toHaveLength(1);
  });
});

describe("useMeetingSession — the transcript survives an error", () => {
  it("keeps every turn accumulated before an essential-source error", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });

    act(() => speak("them", "We're moving launch to March."));
    act(() => speak("you", "Understood, I'll update the roadmap doc."));
    expect(latest.turns).toHaveLength(2);

    // CopilotSession's own aggregateStatus() escalates an essential
    // source's socket error straight to onStatus("error") — see
    // session.js's header comment on the essential/non-essential split.
    act(() => {
      sessionOptions.onStatus("error");
    });

    expect(latest.status).toBe("error");
    expect(latest.turns.map((t) => t.text)).toEqual([
      "We're moving launch to March.",
      "Understood, I'll update the roadmap doc.",
    ]);
  });

  // Mutation this catches: deleting the ref-clearing branch in `start`'s
  // onStatus handler (reverting it to plain `onStatus: setStatus`). The test
  // above it passes either way — it only asserts the turns survive — so
  // without this one the entire recovery fix is a free mutation.
  it("lets Start build a NEW session after an error, without losing the transcript", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });
    act(() => speak("them", "We're moving launch to March."));

    act(() => {
      sessionOptions.onStatus("error");
    });
    expect(latest.status).toBe("error");
    // The dead session's own streams/sockets are released rather than left
    // dangling once the hook stops tracking it.
    expect(stopMock).toHaveBeenCalledTimes(1);

    // The user presses Start again — the only recovery this feature has,
    // since the STT layer never reconnects on its own.
    await act(async () => {
      await latest.start();
    });

    expect(CopilotSession).toHaveBeenCalledTimes(2);
    expect(latest.status).toBe("connecting");
    expect(latest.turns.map((t) => t.text)).toEqual(["We're moving launch to March."]);

    // And the rebuilt session is live enough to keep appending to that same
    // transcript, rather than being a constructed-but-unwired instance.
    act(() => speak("them", "Second half of the meeting."));
    expect(latest.turns.map((t) => t.text)).toEqual([
      "We're moving launch to March.",
      "Second half of the meeting.",
    ]);
  });

  it("keeps the transcript when a non-essential source reports a soft warning", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });

    act(() => speak("them", "Let's review the roadmap."));

    act(() => {
      sessionOptions.onError(new Error("Microphone unavailable. Continuing with interviewer audio only."));
    });

    expect(latest.warning).toBe("Microphone unavailable. Continuing with interviewer audio only.");
    expect(latest.turns.map((t) => t.text)).toEqual(["Let's review the roadmap."]);
  });

  it("keeps the transcript when start() itself rejects on a retry attempt", async () => {
    await render({ source: "inperson" });
    await act(async () => {
      await latest.start();
    });
    act(() => speak("room", "Turn one survives the retry."));
    await act(async () => {
      await latest.stop();
    });

    // The retry attempt fails outright (e.g. the mic was unplugged since the
    // first attempt) — session.start() rejects.
    CopilotSession.mockImplementationOnce(function (options) {
      sessionOptions = options;
      this.start = vi.fn().mockRejectedValue(new Error("Selected microphone is no longer available."));
      this.stop = vi.fn().mockResolvedValue(undefined);
    });

    await act(async () => {
      await latest.start();
    });

    expect(latest.error).toBe("Selected microphone is no longer available.");
    expect(latest.turns.map((t) => t.text)).toEqual(["Turn one survives the retry."]);
  });
});

describe("useMeetingSession — stop()", () => {
  it("awaits the session's own stop() and clears the ref so start() can build a new one", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });
    await act(async () => {
      await latest.stop();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("idle");

    await act(async () => {
      await latest.start();
    });
    expect(CopilotSession).toHaveBeenCalledTimes(2);
  });

  it("clears interim text but preserves settled turns", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });
    act(() => speak("them", "Settled turn."));
    act(() => {
      sessionOptions.onTranscript({ speaker: "you", transcript: "still talking", isFinal: false });
    });
    expect(latest.interims.you).toBe("still talking");

    await act(async () => {
      await latest.stop();
    });

    expect(latest.interims.you ?? "").toBe("");
    expect(latest.turns.map((t) => t.text)).toEqual(["Settled turn."]);
  });

  it("is a no-op when no session is running", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.stop();
    });
    expect(stopMock).not.toHaveBeenCalled();
    expect(latest.status).toBe("idle");
  });
});

describe("useMeetingSession — unmount tears the session down", () => {
  it("calls the session's stop() when the component unmounts mid-meeting", async () => {
    await render({ source: "tab" });
    await act(async () => {
      await latest.start();
    });

    await act(async () => {
      root.unmount();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
