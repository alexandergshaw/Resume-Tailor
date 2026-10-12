import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { draftAnswer, draftAnswerStreaming } from "./answerClient.js";
import { ENGINE_STORAGE_KEY } from "@/app/settings/engine";

// N162 Wave A AC-N162-5 — the answer client forwards the coding toggle as ONE
// explicit request field, `includeCodingSolution`, on BOTH the non-streaming
// (draftAnswer, practice) and streaming (draftAnswerStreaming, live) paths.
// Written from the design (§6.2) BEFORE the field is wired.
//
// THE CONTRACT this pins (so Waves B/C/D build to it):
//   - answerClient does NOT read the store; it FORWARDS whatever the hook
//     captured once per draft (capture-once discipline, design §6.1). So the
//     value in the body is exactly the value passed in.
//   - A boolean passed in (true or false) appears verbatim in the body.
//   - When the caller OMITS the field it is `undefined`, which JSON.stringify
//     drops — so the body is byte-identical to today for a caller that never
//     passes it. This is deliberate: answerClient is NOT defaulted to false
//     (if it were, every existing non-coding call site would start emitting a
//     new key and the byte-identity guard in answerClient.test.js:148-162 would
//     break). The OFF default lives in the STORE, captured by the hook as the
//     literal boolean false — which this client then forwards as `false`.
//
// RED on HEAD: `includeCodingSolution` is not destructured or serialized today
// (grep: 0 hits under hello-world/app and hello-world/lib this round; canary
// `engine` resolves many). So the body never carries it, and every
// "present with value X" assertion below is red until the field is wired. The
// "omitted -> absent" case is GREEN on HEAD and stays green (the regression
// guard / control that answerClient is forward-only, never self-defaulting).

function streamingResponse(chunks) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    json: async () => ({}),
  };
}

function frame(obj) {
  return `${JSON.stringify(obj)}\n`;
}

function installStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  return store;
}

function mockFetch(status, body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

let store;
beforeEach(() => {
  store = installStorage();
});
afterEach(() => {
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

const BASE = {
  question: "Code a function that reverses a linked list.",
  context: "Prep notes.",
  profile: "Experienced engineer.",
  interviewType: "technical_screen",
  applicationId: "app-123",
  codeLanguage: "python",
  mode: "answer",
};

describe("draftAnswer forwards includeCodingSolution", () => {
  it("serializes includeCodingSolution: true when the toggle is ON", () => {
    mockFetch(200, { points: ["Point."], type: "technical" });
    return draftAnswer({ ...BASE, includeCodingSolution: true }).then(() => {
      const [, opts] = global.fetch.mock.calls[0];
      expect(JSON.parse(opts.body).includeCodingSolution).toBe(true);
    });
  });

  it("serializes includeCodingSolution: false when the toggle is OFF (present, explicit)", () => {
    // The OFF default the hook captures from the store is the literal boolean
    // false; the client forwards it verbatim, so OFF is present-as-false, not
    // absent. RED on HEAD (field not wired).
    mockFetch(200, { points: ["Point."], type: "technical" });
    return draftAnswer({ ...BASE, includeCodingSolution: false }).then(() => {
      const [, opts] = global.fetch.mock.calls[0];
      const parsed = JSON.parse(opts.body);
      expect(parsed.includeCodingSolution).toBe(false);
      expect(typeof parsed.includeCodingSolution).toBe("boolean");
    });
  });

  it("OFF request body is byte-identical to today's body plus the one new field (regression)", () => {
    // The non-coding/off request is unchanged behaviourally except for the one
    // explicit field. All existing keys keep their values and no other key
    // appears. RED on HEAD (includeCodingSolution absent today).
    store[ENGINE_STORAGE_KEY] = "gemini";
    mockFetch(200, { points: ["Point."], type: "technical" });
    return draftAnswer({ ...BASE, includeCodingSolution: false }).then(() => {
      const [, opts] = global.fetch.mock.calls[0];
      expect(JSON.parse(opts.body)).toEqual({
        question: BASE.question,
        context: BASE.context,
        profile: BASE.profile,
        interviewType: BASE.interviewType,
        applicationId: BASE.applicationId,
        codeLanguage: BASE.codeLanguage,
        mode: BASE.mode,
        engine: "gemini",
        includeCodingSolution: false,
      });
    });
  });

  it("OMITS the key entirely when the caller does not pass it (control: forward-only, never self-defaulting)", () => {
    // GREEN on HEAD and after: answerClient must not invent a default, or the
    // existing byte-identity guard (answerClient.test.js) breaks. This is the
    // control distinguishing a forward from a hardwired default. A mutant that
    // hardwires includeCodingSolution: true/false would fail this.
    mockFetch(200, { points: ["Point."], type: "technical" });
    return draftAnswer({ ...BASE }).then(() => {
      const [, opts] = global.fetch.mock.calls[0];
      expect(opts.body).not.toContain("includeCodingSolution");
      expect(Object.prototype.hasOwnProperty.call(JSON.parse(opts.body), "includeCodingSolution")).toBe(false);
    });
  });
});

describe("draftAnswerStreaming forwards includeCodingSolution", () => {
  it("serializes includeCodingSolution: true when the toggle is ON", () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "done", points: ["a"], type: "technical" })]),
    );
    return draftAnswerStreaming({ ...BASE, mode: "points", includeCodingSolution: true }, { onPoints: () => {} }).then(() => {
      const [, opts] = global.fetch.mock.calls[0];
      expect(JSON.parse(opts.body).includeCodingSolution).toBe(true);
    });
  });

  it("serializes includeCodingSolution: false when the toggle is OFF (present, explicit)", () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "done", points: ["a"], type: "technical" })]),
    );
    return draftAnswerStreaming({ ...BASE, mode: "points", includeCodingSolution: false }, { onPoints: () => {} }).then(() => {
      const [, opts] = global.fetch.mock.calls[0];
      const parsed = JSON.parse(opts.body);
      expect(parsed.includeCodingSolution).toBe(false);
      expect(typeof parsed.includeCodingSolution).toBe("boolean");
    });
  });

  it("OMITS the key entirely when the caller does not pass it (control: forward-only)", () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "done", points: ["a"], type: "technical" })]),
    );
    return draftAnswerStreaming({ ...BASE, mode: "points" }, { onPoints: () => {} }).then(() => {
      const [, opts] = global.fetch.mock.calls[0];
      expect(opts.body).not.toContain("includeCodingSolution");
      expect(Object.prototype.hasOwnProperty.call(JSON.parse(opts.body), "includeCodingSolution")).toBe(false);
    });
  });
});
