// N105 Step 6 -- the client half of the level control: what the slider shows and
// what a tailor request carries, with the Ideal stop behind the dark-launch gate.
//
// The gate (idealDelivery.js) and the activity log are mocked so ON/OFF can be
// driven and the recorded decision inspected; everything else is the real
// tailorLevel.js vocabulary.

import { describe, it, expect, vi, beforeEach } from "vitest";

const gate = vi.hoisted(() => ({ enabled: false }));
vi.mock("./idealDelivery.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, idealLevelEnabled: () => gate.enabled };
});
vi.mock("@/lib/activityLog/appActivityLog", () => ({ recordDecision: vi.fn() }));

import { recordDecision } from "@/lib/activityLog/appActivityLog";
import { levelSliderModel, appendTailorLevel } from "./tailorLevelRequest.js";

// The request fields a run would carry: appendTailorLevel returns exactly what it
// wrote onto the FormData (its decision recording is covered further down).
const tailorLevelFields = (tailorMode, aggressiveness, opts) =>
  appendTailorLevel(new FormData(), tailorMode, aggressiveness, opts);

beforeEach(() => {
  gate.enabled = false;
  vi.clearAllMocks();
});

describe("levelSliderModel -- the slider's max, marks and value", () => {
  it("gate OFF: five stops, three marks, no Ideal", () => {
    const model = levelSliderModel("", 3);
    expect(model.min).toBe(1);
    expect(model.max).toBe(5);
    expect(model.marks).toEqual([
      { value: 1, label: "Light" },
      { value: 3, label: "Balanced" },
      { value: 5, label: "Strong" },
    ]);
    expect(model.value).toBe(3);
  });

  it("gate OFF: a stale saved 'ideal' mode is ignored -- the slider shows the saved 1..5 level", () => {
    expect(levelSliderModel("ideal", 4).value).toBe(4);
  });

  it("gate ON: six stops, the Ideal mark is added at 6", () => {
    gate.enabled = true;
    const model = levelSliderModel("", 3);
    expect(model.max).toBe(6);
    expect(model.marks.map((m) => m.label)).toEqual(["Light", "Balanced", "Strong", "Ideal"]);
    expect(model.marks[3].value).toBe(6);
    expect(model.value).toBe(3);
  });

  it("gate ON: the Ideal mode puts the slider on 6 without touching the saved level", () => {
    gate.enabled = true;
    expect(levelSliderModel("ideal", 4).value).toBe(6);
  });

  it("gate ON: only the exact mode 'ideal' selects the Ideal stop", () => {
    gate.enabled = true;
    expect(levelSliderModel("IDEAL-ish", 2).value).toBe(2);
    expect(levelSliderModel(undefined, 2).value).toBe(2);
  });
});

describe("tailorLevelFields -- the request fields", () => {
  it("gate OFF: Ideal mode still yields the saved aggressiveness and NO tailorMode", () => {
    expect(tailorLevelFields("ideal", 4)).toEqual({ aggressiveness: 4 });
  });

  it("gate ON: Ideal mode yields tailorMode and NO aggressiveness (never aggressiveness=6)", () => {
    gate.enabled = true;
    const fields = tailorLevelFields("ideal", 4);
    expect(fields).toEqual({ tailorMode: "ideal" });
    expect(fields).not.toHaveProperty("aggressiveness");
  });

  it("gate ON: a standard mode yields the saved aggressiveness", () => {
    gate.enabled = true;
    expect(tailorLevelFields("", 2)).toEqual({ aggressiveness: 2 });
  });

  it("gate ON: a cover-scope run stays on the saved level even in Ideal mode", () => {
    gate.enabled = true;
    expect(tailorLevelFields("ideal", 4, { scope: "cover" })).toEqual({ aggressiveness: 4 });
  });
});

describe("appendTailorLevel -- FormData and the n105-ideal-run decision", () => {
  it("standard run: appends aggressiveness only and records nothing", () => {
    const fd = new FormData();
    appendTailorLevel(fd, "", 4, { engine: "gemini" });
    expect(fd.get("aggressiveness")).toBe("4");
    expect(fd.has("tailorMode")).toBe(false);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("Ideal run (gate ON): appends tailorMode only and records an 'acted' decision with content-free fields", () => {
    gate.enabled = true;
    const fd = new FormData();
    appendTailorLevel(fd, "ideal", 4, { engine: "gemini" });
    expect(fd.get("tailorMode")).toBe("ideal");
    expect(fd.has("aggressiveness")).toBe(false);
    expect(recordDecision).toHaveBeenCalledTimes(1);
    expect(recordDecision).toHaveBeenCalledWith("n105-ideal-run", "acted", {
      reason: "ideal-requested",
      engine: "gemini",
      level: "ideal",
    });
  });

  it("stale Ideal mode with the gate OFF: sends the standard level and records a 'skipped' decision", () => {
    const fd = new FormData();
    appendTailorLevel(fd, "ideal", 4, { engine: "gemini" });
    expect(fd.get("aggressiveness")).toBe("4");
    expect(fd.has("tailorMode")).toBe(false);
    expect(recordDecision).toHaveBeenCalledTimes(1);
    expect(recordDecision.mock.calls[0][0]).toBe("n105-ideal-run");
    expect(recordDecision.mock.calls[0][1]).toBe("skipped");
  });

  it("a missing or non-string engine is recorded as a code, not passed through", () => {
    gate.enabled = true;
    appendTailorLevel(new FormData(), "ideal", 3, {});
    expect(recordDecision.mock.calls[0][2].engine).toBe("unknown");
    appendTailorLevel(new FormData(), "ideal", 3, { engine: { toString: () => "secret" } });
    expect(recordDecision.mock.calls[1][2].engine).toBe("unknown");
  });
});
