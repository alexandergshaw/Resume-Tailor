// AC-R1 (step-5 contract tests, written before the implementation) — the pure
// decisions behind recording an answer in the "Speak as" mode.
//
// These exist as a separate module (rather than inline in the hook) for the
// reason this repo's own vitest config forces: `environment: "node"` by
// default, so a decision left inside a React hook is only reachable through a
// jsdom render, and a decision that cannot be executed cheaply is a decision
// nobody mutation-tests. Every assertion below is on an observable return
// value, never on how it is computed.

import { describe, it, expect } from "vitest";
import {
  MAX_ROLE_QUESTION_CHARS,
  canStartRoleAnswer,
  recordingStatusMessage,
  roleAnswerContext,
  roleAutoStartDecision,
  roleAnswerQuestion,
  roleRecordingPrivacyNotice,
} from "./roleDrillAnswer.js";

const SITUATION = {
  id: "manager-first",
  prompt: "Your VP asks, in front of two other directors, why the integration project is two weeks behind.",
  context: "The VP already has the dates; what they want is your read on it.",
};

describe("roleAnswerQuestion", () => {
  it("names the role, then the situation, then its context, as one line", () => {
    expect(roleAnswerQuestion({ roleLabel: "People manager", situation: SITUATION })).toBe(
      "Speaking as People manager: " +
        "Your VP asks, in front of two other directors, why the integration project is two weeks behind. " +
        "The VP already has the dates; what they want is your read on it.",
    );
  });

  it("is empty with no situation to answer", () => {
    expect(roleAnswerQuestion({ roleLabel: "People manager", situation: null })).toBe("");
    expect(roleAnswerQuestion({ roleLabel: "People manager" })).toBe("");
  });

  it("drops the role prefix rather than emitting a dangling colon when the label is missing", () => {
    const out = roleAnswerQuestion({ roleLabel: "", situation: SITUATION });
    expect(out).toBe(`${SITUATION.prompt} ${SITUATION.context}`);
    expect(out.startsWith("Speaking as")).toBe(false);
    expect(out).not.toContain(":  ");
  });

  it("survives a situation with no context line without leaving trailing whitespace", () => {
    const out = roleAnswerQuestion({ roleLabel: "Attorney", situation: { ...SITUATION, context: "" } });
    expect(out).toBe(`Speaking as Attorney: ${SITUATION.prompt}`);
    expect(out).toBe(out.trim());
  });

  it("collapses newlines and runs of whitespace so the prompt reaches the model as one line", () => {
    const out = roleAnswerQuestion({
      roleLabel: "Clinician",
      situation: { id: "x", prompt: "A patient\n\nasks   twice.", context: "They are   frightened." },
    });
    expect(out).toBe("Speaking as Clinician: A patient asks twice. They are frightened.");
  });

  it("caps the question at the route's own limit", () => {
    const long = "word ".repeat(400).trim();
    const out = roleAnswerQuestion({ roleLabel: "Executive", situation: { id: "x", prompt: long, context: long } });
    expect(MAX_ROLE_QUESTION_CHARS).toBe(600);
    expect(out.length).toBe(MAX_ROLE_QUESTION_CHARS);
    // A positive control against a cap that "passes" by returning nothing.
    expect(out.startsWith("Speaking as Executive: word word")).toBe(true);
  });
});

describe("roleAnswerContext", () => {
  it("sends the situation as the question and nothing personal alongside it", () => {
    const isSaveEnabled = () => true;
    expect(
      roleAnswerContext({ roleLabel: "People manager", situation: SITUATION, includeFrames: true, isSaveEnabled }),
    ).toEqual({
      question: roleAnswerQuestion({ roleLabel: "People manager", situation: SITUATION }),
      type: "general",
      interviewType: "general",
      posting: null,
      profile: "",
      applicationId: null,
      includeFrames: true,
      isSaveEnabled,
    });
  });

  it("carries the frames opt-in through as a real boolean", () => {
    const off = roleAnswerContext({ roleLabel: "Teacher", situation: SITUATION, includeFrames: false });
    expect(off.includeFrames).toBe(false);
    const missing = roleAnswerContext({ roleLabel: "Teacher", situation: SITUATION });
    expect(missing.includeFrames).toBe(false);
  });

  it("never carries a posting, a résumé, a cover letter or the prep context", () => {
    const ctx = roleAnswerContext({ roleLabel: "Tech lead", situation: SITUATION, includeFrames: true });
    // Positive control first: the fields that MUST be populated are, so a
    // gutted implementation returning `{}` cannot satisfy the absence checks.
    expect(ctx.question.length).toBeGreaterThan(20);
    expect(ctx.type).toBe("general");
    expect(ctx.posting).toBeNull();
    expect(ctx.profile).toBe("");
    expect(ctx.applicationId).toBeNull();
    // `metrics` is deliberately absent: usePracticeAnswer computes it itself
    // inside doneAnswer and merges it into the request — a context that
    // carried one would be a second, competing source of truth.
    expect(Object.keys(ctx).sort()).toEqual([
      "applicationId",
      "includeFrames",
      "interviewType",
      "isSaveEnabled",
      "posting",
      "profile",
      "question",
      "type",
    ]);
  });
});

describe("canStartRoleAnswer", () => {
  const live = { status: "live", situation: SITUATION, answering: false, settling: false };

  it("allows a start only with a live session and a situation on screen", () => {
    expect(canStartRoleAnswer(live)).toBe(true);
  });

  it("refuses every individual blocker", () => {
    expect(canStartRoleAnswer({ ...live, status: "connecting" })).toBe(false);
    expect(canStartRoleAnswer({ ...live, status: "idle" })).toBe(false);
    expect(canStartRoleAnswer({ ...live, status: "error" })).toBe(false);
    expect(canStartRoleAnswer({ ...live, situation: null })).toBe(false);
    expect(canStartRoleAnswer({ ...live, answering: true })).toBe(false);
    expect(canStartRoleAnswer({ ...live, settling: true })).toBe(false);
  });
});

describe("roleAutoStartDecision", () => {
  const armedAndReady = {
    armed: true,
    status: "live",
    situation: SITUATION,
    situationPending: false,
    answering: false,
    settling: false,
  };

  it("starts once the session is live and the situation is on screen", () => {
    expect(roleAutoStartDecision(armedAndReady)).toBe("start");
  });

  it("WAITS rather than dropping the press while the session is still connecting", () => {
    expect(roleAutoStartDecision({ ...armedAndReady, status: "connecting" })).toBe("wait");
  });

  it("WAITS rather than dropping the press while a situation is still loading", () => {
    // The bug this exists for: the drill keeps the PREVIOUS situation on
    // screen while a new one fetches, so `situation` is truthy and the press
    // looked startable. Recording began against a scene the user was about to
    // be moved off, and the new one then swapped in under the running
    // recorder. Waiting is what makes the press fire against the scene the
    // user actually reads.
    expect(roleAutoStartDecision({ ...armedAndReady, situationPending: true })).toBe("wait");
    // Also true on a cold mount, where there is no situation at all yet — the
    // press must survive until one lands, not be silently discarded.
    expect(
      roleAutoStartDecision({ ...armedAndReady, situation: null, situationPending: true }),
    ).toBe("wait");
  });

  it("drops a press that can never turn into a recording", () => {
    expect(roleAutoStartDecision({ ...armedAndReady, armed: false })).toBe("drop");
    expect(roleAutoStartDecision({ ...armedAndReady, status: "idle" })).toBe("drop");
    expect(roleAutoStartDecision({ ...armedAndReady, status: "error" })).toBe("drop");
    expect(roleAutoStartDecision({ ...armedAndReady, answering: true })).toBe("drop");
    expect(roleAutoStartDecision({ ...armedAndReady, settling: true })).toBe("drop");
    // A failed situation fetch: nothing on screen and nothing coming. Holding
    // the press armed forever would fire it against whatever eventually
    // arrives, minutes later, with no press from the user.
    expect(
      roleAutoStartDecision({ ...armedAndReady, situation: null, situationPending: false }),
    ).toBe("drop");
  });

  it("never returns anything but the three decisions", () => {
    for (const status of ["idle", "connecting", "live", "error"]) {
      for (const situationPending of [true, false]) {
        for (const situation of [SITUATION, null]) {
          for (const answering of [true, false]) {
            expect(["start", "wait", "drop"]).toContain(
              roleAutoStartDecision({ armed: true, status, situation, situationPending, answering, settling: false }),
            );
          }
        }
      }
    }
  });
});

describe("recordingStatusMessage", () => {
  it("speaks for each stage of one answer", () => {
    expect(recordingStatusMessage({ answering: true })).toMatch(/recording/i);
    expect(recordingStatusMessage({ settling: true })).toMatch(/finish/i);
  });

  it("announces that the feedback arrived, which is the whole point of pressing Done", () => {
    // The review and feedback panels mount in exactly the state the message
    // used to be empty for. A user who presses Done without looking hears
    // "Finishing your answer", then silence, while two panels of results
    // appear.
    const done = recordingStatusMessage({ answering: false, settling: false, hasAnswer: true });
    expect(done).not.toBe("");
    expect(done).toMatch(/feedback|review|ready/i);
  });

  it("is silent before anything has been recorded", () => {
    expect(recordingStatusMessage({})).toBe("");
    expect(recordingStatusMessage({ answering: false, settling: false, hasAnswer: false })).toBe("");
  });

  it("never repeats itself between consecutive stages", () => {
    // React bails on an unchanged setState, so an announcement byte-identical
    // to the one already committed produces NO DOM mutation and a screen
    // reader says nothing at all. Every adjacent pair in the loop must differ.
    const cycle = [
      recordingStatusMessage({ answering: false, settling: false, hasAnswer: false }),
      recordingStatusMessage({ answering: true }),
      recordingStatusMessage({ settling: true }),
      recordingStatusMessage({ answering: false, settling: false, hasAnswer: true }),
      recordingStatusMessage({ answering: true }),
    ];
    for (let i = 1; i < cycle.length; i += 1) {
      expect(cycle[i], `stage ${i} repeats stage ${i - 1}: "${cycle[i]}"`).not.toBe(cycle[i - 1]);
    }
  });
});

describe("roleRecordingPrivacyNotice", () => {
  it("names the transcription provider, the feedback destination and where the clip goes", () => {
    expect(
      roleRecordingPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: false,
        framesWillUpload: false,
        saveEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the role you picked, the situation text, and the pace, filler and body-language measurements taken during your answer are sent to Google Gemini for feedback. " +
        "Your answer video, its transcript, those measurements and the feedback are saved to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  it("discloses the frames upload only while the switch is on", () => {
    const on = roleRecordingPrivacyNotice({
      sttProviderName: "Deepgram",
      isEmbedded: false,
      framesWillUpload: true,
      saveEnabled: false,
    });
    expect(on).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the role you picked, the situation text, and the pace, filler and body-language measurements taken during your answer are sent to Google Gemini for feedback, along with up to three still frames from each answer. " +
        "Your video clip stays in your browser and is dropped when the session ends.",
    );
    const off = roleRecordingPrivacyNotice({
      sttProviderName: "Deepgram",
      isEmbedded: false,
      framesWillUpload: false,
      saveEnabled: false,
    });
    expect(off).not.toContain("still frames");
  });

  it("credits this server, not the browser, on the embedded engine", () => {
    const out = roleRecordingPrivacyNotice({
      sttProviderName: "Deepgram",
      isEmbedded: true,
      framesWillUpload: true,
      saveEnabled: false,
    });
    expect(out).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your feedback is generated on this server with no AI provider — your answer, the role, the situation and your measurements are never sent to Google. Your audio still goes to the transcription provider named above. " +
        "Your video clip stays in your browser and is dropped when the session ends.",
    );
    // The embedded guarantee is about the AI provider, never about the STT
    // socket — the audio still leaves the browser and the notice must say so.
    expect(out).toContain("streamed to Deepgram");
  });

  it("names the body-language measurement that is sent whether or not frames are", async () => {
    // The critique route builds buildDeliveryNotes(metrics) and
    // buildBodyLanguageFacts(metrics.bodyLanguage) UNCONDITIONALLY on the
    // Gemini path (app/api/copilot/critique/route.js), and the body-language
    // sampler runs on every answer regardless of the frames switch. So a
    // numeric read of the user's posture, gaze, gestures and framing reaches
    // Google even with "Include camera frames" off. A notice that named only
    // the transcript let the frames switch read as THE control over camera
    // data, which it is not.
    for (const framesWillUpload of [true, false]) {
      const out = roleRecordingPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: false,
        framesWillUpload,
        saveEnabled: false,
      });
      expect(out).toContain("body-language measurements");
      expect(out).toContain("Google Gemini");
    }
  });

  it("does not pretend the embedded engine keeps the audio on the machine", () => {
    const out = roleRecordingPrivacyNotice({
      sttProviderName: "Deepgram",
      isEmbedded: true,
      framesWillUpload: false,
      saveEnabled: false,
    });
    // The embedded guarantee is about the AI provider only. Audio is streamed
    // for transcription on EVERY engine, and a reader who stops at the
    // embedded sentence must not come away thinking otherwise.
    expect(out).toContain("no AI provider");
    expect(out).toContain("Your audio still goes to the transcription provider");
  });

  it("says what is stored, not just that a video is", () => {
    const out = roleRecordingPrivacyNotice({
      sttProviderName: "Deepgram",
      isEmbedded: false,
      framesWillUpload: false,
      saveEnabled: true,
    });
    // savePracticeAnswer writes the question, the transcript, the metrics
    // (body language included) and the critique alongside the clip.
    expect(out).toContain("its transcript, those measurements and the feedback");
  });

  it("does not guess a transcription provider before one is known", () => {
    const out = roleRecordingPrivacyNotice({ isEmbedded: false, framesWillUpload: false, saveEnabled: true });
    expect(out.startsWith("Your audio is streamed for transcription. ")).toBe(true);
    expect(out).not.toContain("undefined");
  });

  it("never claims a posting or the prep context is sent, because neither exists in this mode", () => {
    for (const isEmbedded of [true, false]) {
      for (const framesWillUpload of [true, false]) {
        for (const saveEnabled of [true, false]) {
          const out = roleRecordingPrivacyNotice({
            sttProviderName: "Deepgram",
            isEmbedded,
            framesWillUpload,
            saveEnabled,
          });
          // Positive control: the notice really is describing this feature,
          // so "it says nothing about a posting" cannot be satisfied by an
          // empty string.
          expect(out).toContain("Your audio is streamed to Deepgram for transcription.");
          expect(out.toLowerCase()).not.toContain("posting");
          expect(out.toLowerCase()).not.toContain("prep context");
          expect(out.toLowerCase()).not.toContain("resume");
          expect(out.toLowerCase()).not.toContain("cover letter");
        }
      }
    }
  });
});
