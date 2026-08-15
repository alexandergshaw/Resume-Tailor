// @vitest-environment jsdom
//
// D3/D4/D5 — the live-region half of the "what is the copilot hearing"
// strip. Under the default `environment: "node"` this component never
// mounts at all; a per-file jsdom opt-in (the same idiom
// app/components/JobDescriptionTab.test.js and
// app/copilot/useCopilotDashboard.wiring.test.js already use) is what lets
// these assertions be about the actual rendered DOM rather than the pure
// hearingState() decision (already covered by lib/copilot/liveHearing.test.js).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import LiveHearingStrip from "./LiveHearingStrip.js";
import { HEARD_NOTHING_AFTER_MS } from "@/lib/copilot/liveHearing";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_000_000;

let container;
let root;

async function render(props) {
  await act(async () => {
    root.render(createElement(LiveHearingStrip, props));
  });
}

function politeRegion() {
  return container.querySelector('[role="status"]');
}
function alertRegion() {
  return container.querySelector('[role="alert"]');
}
function visibleAlertText() {
  const el = container.querySelector(".MuiAlert-message");
  return el ? el.textContent : null;
}

beforeEach(() => {
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

describe("D3: the visible transcript is not what gets announced", () => {
  it("carries no role/aria-live on the visible Alert while heard text updates", async () => {
    await render({
      live: true,
      finals: [],
      interims: { them: "so tell me about a", you: "" },
      startedAt: T0,
      now: T0 + 1_000,
      speakerSnapshot: {},
      source: "tab",
    });
    const alertBox = container.querySelector(".MuiAlert-root");
    expect(alertBox).toBeTruthy();
    expect(alertBox.getAttribute("role")).not.toBe("status");
    expect(alertBox.getAttribute("aria-live")).toBeNull();
    expect(visibleAlertText()).toContain("so tell me about a");
    // The interim transcript is never itself the announced text — the
    // polite region stays empty while "heard", not a copy of the transcript.
    expect(politeRegion().textContent).toBe("");
    expect(alertRegion().textContent).toBe("");
  });

  it("announces the listening sentence, politely, while waiting", async () => {
    await render({
      live: true,
      finals: [],
      interims: {},
      startedAt: T0,
      now: T0 + 2_000,
      speakerSnapshot: {},
      source: "tab",
    });
    expect(politeRegion().getAttribute("aria-live")).toBe("polite");
    expect(politeRegion().textContent).toMatch(/listening/i);
    expect(alertRegion().textContent).toBe("");
  });

  it("announces the silence sentence on the alert region, not the polite one", async () => {
    await render({
      live: true,
      finals: [],
      interims: {},
      startedAt: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS + 1,
      speakerSnapshot: {},
      source: "inperson",
    });
    expect(alertRegion()).toBeTruthy();
    expect(alertRegion().textContent).toMatch(/no speech has been detected/i);
    expect(alertRegion().textContent).toMatch(/microphone/i);
    // Never shared with the polite region — the two nodes are distinct.
    expect(politeRegion()).not.toBe(alertRegion());
    expect(politeRegion().textContent).toBe("");
  });
});

describe("D4: no zero-width-space parity mechanism", () => {
  it("renders byte-identical text across two separate silences", async () => {
    await render({
      live: true,
      finals: [],
      interims: {},
      startedAt: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS + 1,
      speakerSnapshot: {},
      source: "tab",
    });
    const first = alertRegion().textContent;

    // Heard something in between, then went quiet again — a second,
    // independent silence.
    await render({
      live: true,
      finals: [{ id: 1, speaker: "them", text: "Are you still there?", at: T0 + HEARD_NOTHING_AFTER_MS + 2_000 }],
      interims: {},
      startedAt: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS + 3_000,
      speakerSnapshot: {},
      source: "tab",
    });
    await render({
      live: true,
      finals: [{ id: 1, speaker: "them", text: "Are you still there?", at: T0 + HEARD_NOTHING_AFTER_MS + 2_000 }],
      interims: {},
      startedAt: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS + 2_000 + HEARD_NOTHING_AFTER_MS + 1,
      speakerSnapshot: {},
      source: "tab",
    });
    const second = alertRegion().textContent;
    const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

    // The whole point of D4: no nonce, no zero-width space — the same
    // silence sentence renders byte-for-byte the same both times.
    expect(second).toBe(first);
    expect(second).not.toContain(ZERO_WIDTH_SPACE);
    expect(first).not.toContain(ZERO_WIDTH_SPACE);
  });

  it("never leaks a zero-width space into the visible text either", async () => {
    await render({
      live: true,
      finals: [],
      interims: {},
      startedAt: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS + 1,
      speakerSnapshot: {},
      source: "tab",
    });
    expect(visibleAlertText()).not.toContain(String.fromCharCode(0x200b));
  });
});

describe("D5: the hidden live regions mount before they have anything to say", () => {
  it("renders both hidden regions even before a session goes live", async () => {
    await render({ live: false, finals: [], interims: {}, startedAt: null, now: 0, speakerSnapshot: {}, source: "tab" });
    // No visible Alert while not live...
    expect(container.querySelector(".MuiAlert-root")).toBeNull();
    // ...but the two live regions are already in the DOM, empty, ready to
    // receive a text change the instant the session actually starts.
    expect(politeRegion()).toBeTruthy();
    expect(alertRegion()).toBeTruthy();
    expect(politeRegion().textContent).toBe("");
    expect(alertRegion().textContent).toBe("");
  });

  it("the very first sentence of a session is a TEXT CHANGE on an already-mounted node, not a fresh mount", async () => {
    await render({ live: false, finals: [], interims: {}, startedAt: null, now: 0, speakerSnapshot: {}, source: "tab" });
    const politeBefore = politeRegion();
    expect(politeBefore).toBeTruthy();

    await render({
      live: true,
      finals: [],
      interims: {},
      startedAt: T0,
      now: T0 + 500,
      speakerSnapshot: {},
      source: "tab",
    });
    // Same DOM node, not a newly-inserted one carrying its final text —
    // exactly what NVDA/JAWS need to actually announce the change.
    expect(politeRegion()).toBe(politeBefore);
    expect(politeRegion().textContent).toMatch(/listening/i);
  });
});
