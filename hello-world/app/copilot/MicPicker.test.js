// @vitest-environment jsdom
//
// AC-R1 follow-up — the microphone picker, which nothing in this repo pinned
// until now.
//
// That gap is the whole reason this file exists. The picker is shared by live
// mode (SessionSetup.js), practice mode (practice/PracticeControls.js) and the
// "Speak as" role drill (roles/RoleDrillControls.js), and it carries a real
// WCAG 2.5.3 defect: MUI's non-native Select points its trigger's
// `aria-labelledby` at the field label ONLY, never at the element holding the
// selected value, so the trigger's accessible name is "Microphone" while its
// visible text is the chosen device. RolePicker.js hit the identical problem
// and solved it with a native <select>.
//
// A first attempt at that conversion was reverted on 2026-08-20 because it
// shipped two rendering regressions into live and practice mode, neither of
// which any test could see. Both are pinned below, so the second attempt
// cannot repeat them:
//
//   1. The floating label stopped shrinking. MUI derives InputLabel's shrink
//      from the FormControl's `filled` state, which InputBase computes on
//      MOUNT from inputRef.current's DOM value. This component loads its
//      options ASYNCHRONOUSLY, so at mount the <select> holds only "System
//      default" and reads empty -> filled: false; the value-keyed effect never
//      re-fires, because the `value` prop itself never changed. Result: the
//      word "Microphone" renders at full size on top of the selected device
//      name, notch closed. Every user, first load, live mode.
//   2. A device id no longer in the list displayed as "System default". A
//      native <select> cannot hold an out-of-range value: the browser forces
//      selectedIndex 0 and fires no `change`. So the picker asserted a device
//      it was not using, while capture still applied the stale id as
//      `deviceId: { exact: ... }` and failed with OverconstrainedError.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/copilot/audioDevices", async (importOriginal) => ({
  ...(await importOriginal()),
  listMicrophones: vi.fn(),
}));

import MicPicker from "./MicPicker.js";
import { listMicrophones, SYSTEM_DEFAULT_OPTION } from "@/lib/copilot/audioDevices";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const HEADSET = { deviceId: "abc123", label: "Blue Yeti" };
const WEBCAM_MIC = { deviceId: "def456", label: "Logitech Webcam" };
const OPTIONS = [SYSTEM_DEFAULT_OPTION, HEADSET, WEBCAM_MIC];

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
  return (el.textContent || "").trim();
}

// What the control actually SHOWS. For a native select that is the selected
// option's own text, never the concatenation of every option.
function displayedSelection() {
  const native = container.querySelector("select");
  if (native) return (native.options[native.selectedIndex]?.textContent || "").trim();
  const trigger = container.querySelector('[role="combobox"]');
  return (trigger?.textContent || "").trim();
}

const label = () => container.querySelector("label");

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(MicPicker, { value: null, onChange: () => {}, ...props }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listMicrophones.mockResolvedValue(OPTIONS);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("MicPicker - the label never sits on top of the value", () => {
  it("shrinks the label when a device is already chosen at mount", async () => {
    // The mode switch case: CopilotClient unmounts and remounts each mode's
    // subtree, so moving live -> practice with a headset already chosen mounts
    // a fresh picker with `value` already set. This is where the reverted
    // attempt printed "Microphone" over "Blue Yeti".
    await render({ value: HEADSET.deviceId });
    expect(displayedSelection(), "positive control: the chosen device is showing").toBe(HEADSET.label);
    expect(label()?.getAttribute("data-shrink"), 'the label is sitting on top of the value').toBe("true");
  });

  it("shrinks the label with no device chosen, because the control still shows text", async () => {
    // "System default" is displayed even with `value: null` — there is no
    // blank state for the label to occupy.
    await render({ value: null });
    expect(displayedSelection()).toBe(SYSTEM_DEFAULT_OPTION.label);
    expect(label()?.getAttribute("data-shrink"), "the label is sitting on top of the value").toBe("true");
  });

  it("keeps the label shrunk once the async option list arrives", async () => {
    // The mount tick is the dangerous one: the options resolve a beat later,
    // and the value-keyed effect never re-fires because `value` did not change.
    let resolve;
    listMicrophones.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await render({ value: HEADSET.deviceId });
    await act(async () => {
      resolve(OPTIONS);
    });
    expect(displayedSelection()).toBe(HEADSET.label);
    expect(label()?.getAttribute("data-shrink")).toBe("true");
  });
});

describe("MicPicker - it never claims a device it is not using", () => {
  it("does not show a vanished device as System default", async () => {
    const onChange = vi.fn();
    await render({ value: "unplugged-999", onChange });

    // capture.js still applies the stored id as `deviceId: { exact: ... }`,
    // so a picker reading "System default" here is asserting something false
    // right before capture fails with OverconstrainedError. Whatever it shows,
    // it must not be the one device it definitely is not using.
    expect(displayedSelection()).not.toBe(SYSTEM_DEFAULT_OPTION.label);
    expect(displayedSelection().length, "the control shows nothing at all").toBeGreaterThan(0);
    // And it must not silently rewrite the user's stored selection.
    expect(onChange, "the picker changed the selection by itself").not.toHaveBeenCalled();
  });

  it("says the selected microphone is unavailable rather than staying silent", async () => {
    await render({ value: "unplugged-999" });
    expect((container.textContent || "").toLowerCase()).toMatch(/unavailable|no longer/);
  });
});

describe("MicPicker - accessible name matches visible text (WCAG 2.5.3)", () => {
  it("names the control without contradicting what is on screen", async () => {
    await render({ value: HEADSET.deviceId });
    const control = container.querySelector("select") || container.querySelector('[role="combobox"]');
    expect(control, "no microphone control").toBeTruthy();
    const name = accessibleName(control);
    expect(name.length, "the control has no accessible name").toBeGreaterThan(0);
    expect(name).toMatch(/microphone/i);
    expect(control.hasAttribute("aria-label"), "an aria-label would rename it for voice control").toBe(false);
  });
});

describe("MicPicker - the contract its callers depend on", () => {
  it("reports a real device by id and System default as null", async () => {
    const onChange = vi.fn();
    await render({ value: null, onChange });
    const native = container.querySelector("select");
    expect(native, "expected a native select").toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLSelectElement.prototype, "value").set;
      setter.call(native, WEBCAM_MIC.deviceId);
      native.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // useCaptureSetup writes this straight into MIC_STORAGE_KEY.
    expect(onChange).toHaveBeenLastCalledWith(WEBCAM_MIC.deviceId);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLSelectElement.prototype, "value").set;
      setter.call(native, "");
      native.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // null, never "" — capture.js omits the constraint entirely for null, and
    // SYSTEM_DEFAULT_OPTION's own contract is `deviceId: null`.
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("disables the real control, not just its wrapper", async () => {
    await render({ value: HEADSET.deviceId, disabled: true });
    const native = container.querySelector("select");
    expect(native.disabled, "the select is still operable while a session is live").toBe(true);
  });

  it("still explains why device names look like placeholders before permission", async () => {
    listMicrophones.mockResolvedValue([
      SYSTEM_DEFAULT_OPTION,
      { deviceId: "abc123", label: "Microphone 1" },
    ]);
    await render({ value: null });
    expect((container.textContent || "")).toMatch(/appear after the first session/i);
  });
});

describe("MicPicker - the 44px tap target", () => {
  it("shares RolePicker's native-select rule instead of keeping a private copy", () => {
    // R-235 measured this in a browser: TOUCH_FIELD_SX raises the InputBase
    // ROOT to 44px, but the native <select> inside is 40px, so a tap in the
    // top or bottom 2px lands on a div. jsdom has no layout, so the property
    // under test here is genuinely the shape of the source: the rule exists in
    // one shared place and both pickers use it.
    const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");
    const mobileSx = read("app/copilot/mobileSx.js");
    expect(mobileSx, "the rule is still a private copy inside RolePicker").toContain(
      "TOUCH_NATIVE_SELECT_SX",
    );
    for (const rel of ["app/copilot/MicPicker.js", "app/copilot/roles/RolePicker.js"]) {
      expect(read(rel), `${rel} does not use the shared native-select rule`).toContain(
        "TOUCH_NATIVE_SELECT_SX",
      );
    }
  });
});
