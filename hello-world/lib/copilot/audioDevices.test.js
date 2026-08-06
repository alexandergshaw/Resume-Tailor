import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeMicDevices, listMicrophones, resolveStoredMicDeviceId, SYSTEM_DEFAULT_OPTION } from "./audioDevices";

function device({ deviceId, kind = "audioinput", label = "" } = {}) {
  return { deviceId, kind, label };
}

describe("normalizeMicDevices", () => {
  it("always returns System default first, with deviceId null, even with no devices", () => {
    const result = normalizeMicDevices([]);
    expect(result).toEqual([SYSTEM_DEFAULT_OPTION]);
    expect(result[0].deviceId).toBeNull();
  });

  it("filters out everything that isn't kind === 'audioinput'", () => {
    const devices = [
      device({ deviceId: "cam1", kind: "videoinput", label: "Webcam" }),
      device({ deviceId: "spk1", kind: "audiooutput", label: "Speakers" }),
      device({ deviceId: "mic1", kind: "audioinput", label: "Blue Yeti" }),
    ];
    const result = normalizeMicDevices(devices);
    expect(result).toEqual([SYSTEM_DEFAULT_OPTION, { deviceId: "mic1", label: "Blue Yeti" }]);
  });

  it("keeps a real, non-empty label as-is", () => {
    const result = normalizeMicDevices([device({ deviceId: "mic1", label: "Blue Yeti" })]);
    expect(result[1]).toEqual({ deviceId: "mic1", label: "Blue Yeti" });
  });

  it("trims whitespace-only labels down to empty before falling back to a placeholder", () => {
    const result = normalizeMicDevices([device({ deviceId: "mic1", label: "   " })]);
    expect(result[1].label).toBe("Microphone 1");
  });

  it("gives an unlabeled device a positional placeholder — pre-permission, this is the norm, not an error", () => {
    const devices = [
      device({ deviceId: "mic1", label: "" }),
      device({ deviceId: "mic2", label: "" }),
      device({ deviceId: "mic3", label: "" }),
    ];
    const result = normalizeMicDevices(devices);
    expect(result.map((o) => o.label)).toEqual(["System default", "Microphone 1", "Microphone 2", "Microphone 3"]);
  });

  it("numbers placeholders over kept audioinput devices only, so a camera in the middle doesn't shift the count", () => {
    const devices = [
      device({ deviceId: "mic1", label: "" }),
      device({ deviceId: "cam1", kind: "videoinput", label: "" }),
      device({ deviceId: "mic2", label: "" }),
    ];
    const result = normalizeMicDevices(devices);
    expect(result.map((o) => o.label)).toEqual(["System default", "Microphone 1", "Microphone 2"]);
  });

  it("de-duplicates repeated deviceId entries, keeping the first occurrence", () => {
    const devices = [
      device({ deviceId: "mic1", label: "Blue Yeti" }),
      device({ deviceId: "mic1", label: "Blue Yeti (duplicate row)" }),
    ];
    const result = normalizeMicDevices(devices);
    expect(result).toEqual([SYSTEM_DEFAULT_OPTION, { deviceId: "mic1", label: "Blue Yeti" }]);
  });

  it("drops the browser's 'default'/'communications' alias ids entirely — they are not distinct physical devices", () => {
    const devices = [
      device({ deviceId: "default", label: "Default - Blue Yeti" }),
      device({ deviceId: "communications", label: "Communications - Blue Yeti" }),
      device({ deviceId: "mic1", label: "Blue Yeti" }),
    ];
    const result = normalizeMicDevices(devices);
    expect(result).toEqual([SYSTEM_DEFAULT_OPTION, { deviceId: "mic1", label: "Blue Yeti" }]);
  });

  it("does not let a dropped alias id consume a placeholder number", () => {
    const devices = [
      device({ deviceId: "default", label: "" }),
      device({ deviceId: "mic1", label: "" }),
    ];
    const result = normalizeMicDevices(devices);
    expect(result).toEqual([SYSTEM_DEFAULT_OPTION, { deviceId: "mic1", label: "Microphone 1" }]);
  });

  it("skips a device with a missing/non-string deviceId without throwing", () => {
    const devices = [device({ deviceId: undefined, label: "Ghost mic" }), device({ deviceId: "mic1", label: "Real mic" })];
    const result = normalizeMicDevices(devices);
    expect(result).toEqual([SYSTEM_DEFAULT_OPTION, { deviceId: "mic1", label: "Real mic" }]);
  });

  it("skips a device missing kind entirely without throwing", () => {
    const devices = [{ deviceId: "mic1", label: "No kind field" }];
    expect(normalizeMicDevices(devices)).toEqual([SYSTEM_DEFAULT_OPTION]);
  });

  it("skips null/undefined entries in the array without throwing", () => {
    const devices = [null, undefined, device({ deviceId: "mic1", label: "Real mic" })];
    expect(normalizeMicDevices(devices)).toEqual([SYSTEM_DEFAULT_OPTION, { deviceId: "mic1", label: "Real mic" }]);
  });

  it("degrades to just System default for non-array input instead of throwing", () => {
    expect(normalizeMicDevices(null)).toEqual([SYSTEM_DEFAULT_OPTION]);
    expect(normalizeMicDevices(undefined)).toEqual([SYSTEM_DEFAULT_OPTION]);
    expect(normalizeMicDevices("not-an-array")).toEqual([SYSTEM_DEFAULT_OPTION]);
    expect(normalizeMicDevices({ 0: device({ deviceId: "mic1" }) })).toEqual([SYSTEM_DEFAULT_OPTION]);
  });

  it("never throws on a garbage-filled array (numbers, strings, arrays as entries)", () => {
    expect(() => normalizeMicDevices([1, "two", [3], true, {}])).not.toThrow();
    expect(normalizeMicDevices([1, "two", [3], true, {}])).toEqual([SYSTEM_DEFAULT_OPTION]);
  });
});

describe("listMicrophones", () => {
  // Node itself defines a read-only `navigator` global with no mediaDevices
  // on it (see capture.test.js's ensureNavigator, same reasoning) — only the
  // object's own properties can be reassigned, not the binding itself.
  const originalMediaDevices = globalThis.navigator?.mediaDevices;

  afterEach(() => {
    if (originalMediaDevices === undefined) {
      if (globalThis.navigator) delete globalThis.navigator.mediaDevices;
    } else {
      globalThis.navigator.mediaDevices = originalMediaDevices;
    }
  });

  function ensureNavigator() {
    if (typeof globalThis.navigator === "undefined") {
      Object.defineProperty(globalThis, "navigator", { value: {}, writable: true, configurable: true });
    }
  }

  it("calls enumerateDevices and passes the result through normalizeMicDevices", async () => {
    ensureNavigator();
    const rawDevices = [device({ deviceId: "mic1", label: "Blue Yeti" })];
    const enumerateDevices = vi.fn(async () => rawDevices);
    globalThis.navigator.mediaDevices = { enumerateDevices };

    const result = await listMicrophones();

    expect(enumerateDevices).toHaveBeenCalledTimes(1);
    expect(result).toEqual(normalizeMicDevices(rawDevices));
  });

  it("never requests permission — does not call getUserMedia", async () => {
    ensureNavigator();
    const enumerateDevices = vi.fn(async () => []);
    const getUserMedia = vi.fn();
    globalThis.navigator.mediaDevices = { enumerateDevices, getUserMedia };

    await listMicrophones();

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("returns just System default when mediaDevices is entirely absent", async () => {
    ensureNavigator();
    delete globalThis.navigator.mediaDevices;
    expect(await listMicrophones()).toEqual([SYSTEM_DEFAULT_OPTION]);
  });

  it("returns just System default when enumerateDevices is missing", async () => {
    ensureNavigator();
    globalThis.navigator.mediaDevices = {};
    expect(await listMicrophones()).toEqual([SYSTEM_DEFAULT_OPTION]);
  });

  it("returns just System default — never rejects — when enumerateDevices throws", async () => {
    ensureNavigator();
    globalThis.navigator.mediaDevices = {
      enumerateDevices: vi.fn(async () => {
        throw new Error("permission API glitch");
      }),
    };
    await expect(listMicrophones()).resolves.toEqual([SYSTEM_DEFAULT_OPTION]);
  });
});

describe("resolveStoredMicDeviceId", () => {
  const options = [SYSTEM_DEFAULT_OPTION, { deviceId: "mic1", label: "Blue Yeti" }, { deviceId: "mic2", label: "Webcam Mic" }];

  it("returns the stored id unchanged when it is still present in the fresh list", () => {
    expect(resolveStoredMicDeviceId("mic2", options)).toBe("mic2");
  });

  it("falls back to System default (null) when the stored id is no longer present — the unplugged-headset case", () => {
    expect(resolveStoredMicDeviceId("mic-unplugged", options)).toBeNull();
  });

  it("returns null for a falsy stored id without inspecting the list", () => {
    expect(resolveStoredMicDeviceId(null, options)).toBeNull();
    expect(resolveStoredMicDeviceId(undefined, options)).toBeNull();
    expect(resolveStoredMicDeviceId("", options)).toBeNull();
  });

  it("degrades to null for non-array options instead of throwing", () => {
    expect(resolveStoredMicDeviceId("mic1", null)).toBeNull();
    expect(resolveStoredMicDeviceId("mic1", undefined)).toBeNull();
    expect(resolveStoredMicDeviceId("mic1", "not-an-array")).toBeNull();
  });

  it("never resolves to the System default entry's own null id via string coercion", () => {
    // Guards against a loose equality bug — "null" the string must never
    // match deviceId: null.
    expect(resolveStoredMicDeviceId("null", options)).toBeNull();
  });
});
