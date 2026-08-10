import { describe, it, expect } from "vitest";
import {
  INTERVIEWER_SOURCES,
  DEFAULT_INTERVIEWER_SOURCE,
  displayCaptureSupported,
  sourceAvailability,
  resolveInterviewerSource,
  unavailableSourceReason,
} from "./captureSupport";

// AC-P7. `getDisplayMedia` is unsupported on EVERY mobile browser — Safari on
// iOS, Chrome for Android, Samsung Internet, Android Browser and Opera Mobile
// are all unsupported (caniuse mdn-api_mediadevices_getdisplaymedia). Live mode's "tab"
// and "system" sources call it directly (lib/copilot/session.js's
// THEM_CAPTURE_BY_SOURCE), so on a phone those two options are controls that
// can only ever throw. "inperson" is getUserMedia-only and works fine.
//
// This module decides what a device can actually offer. It is pure so it can
// be tested at all: no component or hook in this repo can be rendered in a
// test (vitest `environment: "node"`, no jsdom), which is exactly why the
// decision does not live inside CopilotClient.

describe("displayCaptureSupported", () => {
  it("is feature detection, never user-agent sniffing", () => {
    expect(displayCaptureSupported({ getDisplayMedia: () => {} })).toBe(true);
    expect(displayCaptureSupported({})).toBe(false);
    expect(displayCaptureSupported(null)).toBe(false);
    expect(displayCaptureSupported(undefined)).toBe(false);
  });

  it("rejects a non-callable getDisplayMedia rather than trusting the key's presence", () => {
    // A property that exists but is not a function still throws on call.
    expect(displayCaptureSupported({ getDisplayMedia: true })).toBe(false);
    expect(displayCaptureSupported({ getDisplayMedia: null })).toBe(false);
    expect(displayCaptureSupported({ getDisplayMedia: "yes" })).toBe(false);
  });
});

describe("sourceAvailability", () => {
  it("offers all three sources when the device can capture a display surface", () => {
    expect(sourceAvailability(true)).toEqual({ tab: true, system: true, inperson: true });
  });

  it("keeps in-person available when display capture is missing", () => {
    // The whole point: a phone must still be able to run a live session.
    const avail = sourceAvailability(false);
    expect(avail.inperson).toBe(true);
    expect(avail.tab).toBe(false);
    expect(avail.system).toBe(false);
  });

  it("covers exactly the declared source vocabulary, with no extra keys", () => {
    for (const supported of [true, false]) {
      expect(Object.keys(sourceAvailability(supported)).sort()).toEqual(
        [...INTERVIEWER_SOURCES].sort(),
      );
    }
  });
});

describe("resolveInterviewerSource", () => {
  it("is byte-identical to today's behaviour on a device that supports display capture", () => {
    // Today (CopilotClient.js): useState("tab"), then a stored value is
    // adopted only when it is one of the three known strings. Nothing about
    // that may change for a desktop user.
    expect(resolveInterviewerSource("tab", true)).toBe("tab");
    expect(resolveInterviewerSource("system", true)).toBe("system");
    expect(resolveInterviewerSource("inperson", true)).toBe("inperson");
    expect(resolveInterviewerSource(null, true)).toBe(DEFAULT_INTERVIEWER_SOURCE);
    expect(resolveInterviewerSource(undefined, true)).toBe(DEFAULT_INTERVIEWER_SOURCE);
    expect(resolveInterviewerSource("bogus", true)).toBe(DEFAULT_INTERVIEWER_SOURCE);
    expect(resolveInterviewerSource("", true)).toBe(DEFAULT_INTERVIEWER_SOURCE);
  });

  it("keeps 'tab' as the default when display capture exists", () => {
    // Pinned separately from the assertions above so a change to the default
    // is a deliberate act, not a silent side effect of this feature.
    expect(DEFAULT_INTERVIEWER_SOURCE).toBe("tab");
  });

  it("coerces a display-capture source to in-person when the device cannot capture one", () => {
    // The stored value is shared across devices via the same localStorage key
    // only in the sense that a user may have chosen "tab" on their laptop and
    // now be on their phone; either way the resolved value must be runnable.
    expect(resolveInterviewerSource("tab", false)).toBe("inperson");
    expect(resolveInterviewerSource("system", false)).toBe("inperson");
    expect(resolveInterviewerSource(null, false)).toBe("inperson");
    expect(resolveInterviewerSource("bogus", false)).toBe("inperson");
  });

  it("leaves an explicit in-person choice alone on every device", () => {
    expect(resolveInterviewerSource("inperson", false)).toBe("inperson");
    expect(resolveInterviewerSource("inperson", true)).toBe("inperson");
  });

  it("never returns a value outside the declared vocabulary", () => {
    const inputs = ["tab", "system", "inperson", "bogus", "", null, undefined, 0, {}, []];
    for (const stored of inputs) {
      for (const supported of [true, false]) {
        expect(INTERVIEWER_SOURCES).toContain(resolveInterviewerSource(stored, supported));
      }
    }
  });
});

describe("unavailableSourceReason", () => {
  it("says nothing when the source is usable", () => {
    expect(unavailableSourceReason("tab", true)).toBe("");
    expect(unavailableSourceReason("system", true)).toBe("");
    expect(unavailableSourceReason("inperson", true)).toBe("");
    expect(unavailableSourceReason("inperson", false)).toBe("");
  });

  it("explains the real cause and points at the option that does work", () => {
    const reason = unavailableSourceReason("tab", false);
    expect(reason).not.toBe("");
    // Must name the device/browser limitation, not blame the user, and must
    // name the working alternative — a disabled control with no explanation
    // is the failure this replaces.
    expect(reason.toLowerCase()).toContain("in person");
    // Never phrased as a permissions or consent problem: it is a capability
    // the browser does not have at all.
    expect(reason.toLowerCase()).not.toContain("denied");
    expect(reason.toLowerCase()).not.toContain("permission");
  });

  it("gives the same reason for both display-capture sources", () => {
    expect(unavailableSourceReason("system", false)).toBe(unavailableSourceReason("tab", false));
  });
});
