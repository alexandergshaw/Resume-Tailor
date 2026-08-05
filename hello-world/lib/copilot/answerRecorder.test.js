import { afterEach, describe, it, expect, vi } from "vitest";
import { pickSupportedMimeType, AnswerRecorder } from "./answerRecorder";

describe("pickSupportedMimeType", () => {
  it("returns the first candidate the predicate accepts, preserving preference order", () => {
    const supported = new Set(["video/webm", "video/mp4"]);
    const result = pickSupportedMimeType(
      ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"],
      (type) => supported.has(type),
    );
    expect(result).toBe("video/webm");
  });

  it("returns '' when none of the candidates are accepted", () => {
    const result = pickSupportedMimeType(
      ["video/webm;codecs=vp9,opus", "video/mp4"],
      () => false,
    );
    expect(result).toBe("");
  });

  it("returns '' when the candidate list is empty", () => {
    const result = pickSupportedMimeType([], () => true);
    expect(result).toBe("");
  });

  it("returns '' when isTypeSupported is not a function", () => {
    expect(pickSupportedMimeType(["video/webm"], undefined)).toBe("");
    expect(pickSupportedMimeType(["video/webm"], null)).toBe("");
    expect(pickSupportedMimeType(["video/webm"], "video/webm")).toBe("");
  });

  it("treats a predicate that throws on a candidate as not supported and keeps scanning", () => {
    const result = pickSupportedMimeType(["video/webm;codecs=vp9,opus", "video/mp4"], (type) => {
      if (type === "video/webm;codecs=vp9,opus") throw new Error("not implemented");
      return type === "video/mp4";
    });
    expect(result).toBe("video/mp4");
  });

  it("returns '' when every candidate's predicate call throws", () => {
    const result = pickSupportedMimeType(["video/webm", "video/mp4"], () => {
      throw new Error("boom");
    });
    expect(result).toBe("");
  });
});

// This module is only ever exercised in a browser, where MediaRecorder
// already exists — the node test environment has no MediaRecorder at all, so
// each test below installs a fake (or deletes it, to simulate an
// unsupporting browser) and this restores whatever was there before,
// keeping tests from leaking into each other.
const originalMediaRecorder = globalThis.MediaRecorder;

afterEach(() => {
  if (originalMediaRecorder === undefined) {
    delete globalThis.MediaRecorder;
  } else {
    globalThis.MediaRecorder = originalMediaRecorder;
  }
  vi.useRealTimers();
});

// A stand-in for the bits of the MediaRecorder interface answerRecorder.js
// actually touches: the static isTypeSupported check, the constructor, the
// dataavailable/stop event pair, state, and start()/stop(). Real
// MediaRecorder fires "dataavailable" and "stop" asynchronously, sometime
// after stop() is called — this double never fires them on its own so each
// test can control that timing explicitly with emitDataAvailable()/
// emitStop(), including firing them "late" (after a subsequent start()).
function installMediaRecorder({ isTypeSupported = () => true } = {}) {
  class FakeMediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options && options.mimeType;
      this.state = "recording";
      this._listeners = { dataavailable: [], stop: [] };
      FakeMediaRecorder.instances.push(this);
    }

    addEventListener(type, handler) {
      this._listeners[type].push(handler);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
    }

    emitDataAvailable(data) {
      for (const handler of this._listeners.dataavailable) handler({ data });
    }

    emitStop() {
      for (const handler of this._listeners.stop) handler({});
    }
  }
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported = isTypeSupported;
  globalThis.MediaRecorder = FakeMediaRecorder;
  return FakeMediaRecorder;
}

describe("AnswerRecorder", () => {
  it("treats start() as a no-op and stop() resolves null when MediaRecorder does not exist", async () => {
    delete globalThis.MediaRecorder;

    const recorder = new AnswerRecorder();
    expect(recorder.supported).toBe(false);

    recorder.start({ fake: "stream" });
    const result = await recorder.stop();

    expect(result).toBeNull();
  });

  it("treats start() as a no-op and stop() resolves null when no candidate mime type is supported", async () => {
    installMediaRecorder({ isTypeSupported: () => false });

    const recorder = new AnswerRecorder();
    expect(recorder.supported).toBe(false);

    recorder.start({ fake: "stream" });
    const result = await recorder.stop();

    expect(result).toBeNull();
  });

  it("resolves stop() with a Blob built from the collected chunks once the recorder's stop event fires", async () => {
    const FakeMediaRecorder = installMediaRecorder();
    const recorder = new AnswerRecorder();
    recorder.start({ fake: "stream" });
    const instance = FakeMediaRecorder.instances[0];

    instance.emitDataAvailable(new Blob(["hello "]));
    instance.emitDataAvailable(new Blob(["world"]));

    const stopPromise = recorder.stop();
    instance.emitStop();
    const blob = await stopPromise;

    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("hello world");
    expect(blob.type).toBe(recorder.mimeType);
  });

  it("resolves stop() with null when nothing was recording", async () => {
    installMediaRecorder();
    const recorder = new AnswerRecorder();

    const result = await recorder.stop();

    expect(result).toBeNull();
  });

  it("resolves stop() with null when the stop event fires but no chunks ever arrived", async () => {
    const FakeMediaRecorder = installMediaRecorder();
    const recorder = new AnswerRecorder();
    recorder.start({ fake: "stream" });
    const instance = FakeMediaRecorder.instances[0];

    const stopPromise = recorder.stop();
    instance.emitStop();
    const result = await stopPromise;

    expect(result).toBeNull();
  });

  it("resolves stop() with null once the guard timeout elapses, when the stop event never fires", async () => {
    vi.useFakeTimers();
    installMediaRecorder();
    const recorder = new AnswerRecorder();
    recorder.start({ fake: "stream" });
    // Deliberately never call instance.emitStop() -- simulates a track that
    // dies mid-recording and never fires MediaRecorder's own "stop" event.

    const stopPromise = recorder.stop();
    await vi.advanceTimersByTimeAsync(4000);
    const result = await stopPromise;

    expect(result).toBeNull();
  });

  it("is safe to call stop() twice in a row, resolving null the second time", async () => {
    const FakeMediaRecorder = installMediaRecorder();
    const recorder = new AnswerRecorder();
    recorder.start({ fake: "stream" });
    const instance = FakeMediaRecorder.instances[0];
    instance.emitDataAvailable(new Blob(["x"]));

    const firstStopPromise = recorder.stop();
    instance.emitStop();
    const firstResult = await firstStopPromise;
    const secondResult = await recorder.stop();

    expect(firstResult).toBeInstanceOf(Blob);
    expect(secondResult).toBeNull();
  });

  it("keeps a chunk that arrives late from a previous recording out of the next recording's chunk array", async () => {
    const FakeMediaRecorder = installMediaRecorder();
    const recorder = new AnswerRecorder();

    recorder.start({ fake: "stream-a" });
    const instanceA = FakeMediaRecorder.instances[0];
    instanceA.emitDataAvailable(new Blob(["a-chunk"]));

    // Recording A is told to stop, but (as with real MediaRecorder) its own
    // "stop" event has not fired yet -- the caller immediately begins a new
    // answer before A has finished settling.
    const stopPromiseA = recorder.stop();
    recorder.start({ fake: "stream-b" });
    const instanceB = FakeMediaRecorder.instances[1];

    // A's dataavailable now fires late, after B has already started. This is
    // the exact scenario the previous bug mishandled: without a closure over
    // A's own chunk array, this listener could read `this._chunks`
    // dynamically and push A's late data into B's in-progress recording.
    instanceA.emitDataAvailable(new Blob(["late-a-chunk"]));
    instanceB.emitDataAvailable(new Blob(["b-chunk"]));

    const stopPromiseB = recorder.stop();
    instanceB.emitStop();
    const blobB = await stopPromiseB;

    instanceA.emitStop();
    const blobA = await stopPromiseA;

    expect(await blobB.text()).toBe("b-chunk");
    expect(await blobA.text()).toBe("a-chunklate-a-chunk");
  });

  it("degrades to the unsupported no-op path when the MediaRecorder constructor throws", async () => {
    class ThrowingMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      constructor() {
        throw new Error("stream has no usable tracks");
      }
    }
    globalThis.MediaRecorder = ThrowingMediaRecorder;

    const recorder = new AnswerRecorder();
    expect(recorder.supported).toBe(true); // the constructor never instantiates MediaRecorder itself

    recorder.start({ fake: "stream" });
    expect(recorder.supported).toBe(false); // start() caught the throw and flipped it off

    const result = await recorder.stop();
    expect(result).toBeNull();
  });

  it("degrades to the unsupported no-op path when recorder.start() throws", async () => {
    const FakeMediaRecorder = installMediaRecorder();
    FakeMediaRecorder.prototype.start = function throwingStart() {
      throw new Error("start() failed");
    };

    const recorder = new AnswerRecorder();
    expect(recorder.supported).toBe(true);

    recorder.start({ fake: "stream" });
    expect(recorder.supported).toBe(false);

    const result = await recorder.stop();
    expect(result).toBeNull();
  });
});
