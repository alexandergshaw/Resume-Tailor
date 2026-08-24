// @vitest-environment jsdom
//
// Same per-file jsdom override JobDescriptionTab.test.js and
// app/copilot/TranscriptView's own test coverage use (vitest.config.js
// stays `environment: "node"` by default — see that file's own comment).
// This component IS its render output — whether a "room" turn's speaker
// chip is present, whether the transcript names why some turns carry no
// speaker at all, whether an interim line reads differently to a screen
// reader than a final one — none of that survives being reduced to a pure
// function, so it has to be mounted.
//
// Presentational only: every case below is props in, DOM out. No fetching,
// no session, no capture — matches the component itself.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import MeetingTranscript from "./MeetingTranscript.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

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

async function render(props) {
  await act(async () => {
    root.render(createElement(MeetingTranscript, props));
  });
}

function chips() {
  return [...container.querySelectorAll(".MuiChip-label")].map((el) => el.textContent);
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

const baseTurns = [
  { id: "t1", speaker: "you", text: "Are we still gated on the legacy processor?", at: 1000 },
  { id: "t2", speaker: "room", text: "Only for refunds now.", at: 4000 },
];

describe("speaker chips — translated at the render boundary via meetingSpeakerLabel", () => {
  it("renders a chip for a 'you' turn (positive control)", async () => {
    await render({ turns: [baseTurns[0]], interims: {}, source: "tab" });
    expect(chips()).toContain("You");
  });

  // Paired with the positive control above on purpose: without it, a
  // component that rendered NO chips at all for any input would also pass
  // an assertion of absence alone. Proving the "room" case specifically
  // renders nothing requires proving the sibling "you" case DOES render
  // something, in the same suite.
  it("renders NO speaker chip at all for a 'room' turn — not a blank one", async () => {
    await render({ turns: [baseTurns[1]], interims: {}, source: "inperson" });
    // Exactly one chip on screen total: none belonging to the room turn.
    expect(chips()).toEqual([]);
    // The turn's own text still renders — this is a missing CHIP, not a
    // missing turn.
    expect(container.textContent).toContain("Only for refunds now.");
  });

  it("renders both correctly in the same transcript", async () => {
    await render({ turns: baseTurns, interims: {}, source: "inperson" });
    expect(chips()).toEqual(["You"]);
    expect(container.textContent).toContain("Are we still gated on the legacy processor?");
    expect(container.textContent).toContain("Only for refunds now.");
  });

  it("labels a 'them' turn as Others, not as Them or as the raw routing value", async () => {
    await render({
      turns: [{ id: "t3", speaker: "them", text: "We moved off it in March.", at: 2000 }],
      interims: {},
      source: "tab",
    });
    expect(chips()).toEqual(["Others"]);
  });
});

describe("speaker attribution notice — shown once, above the transcript, only when it applies", () => {
  it("shows the shared-microphone explanation for an in-person meeting", async () => {
    await render({ turns: baseTurns, interims: {}, source: "inperson" });
    expect(container.textContent).toContain(
      "One microphone is recording everyone in the room, so turns below are not attributed to a specific speaker.",
    );
  });

  it("shows nothing for a call, where speakers ARE structurally separated", async () => {
    await render({ turns: baseTurns, interims: {}, source: "tab" });
    expect(container.textContent).not.toContain("One microphone is recording everyone");
  });
});

describe("interim text — distinguishable from final text, not repeatedly announced", () => {
  it("marks interim text distinct from final turns via a real DOM attribute, not styling alone", async () => {
    await render({ turns: [baseTurns[0]], interims: { them: "Are we still gate" }, source: "tab" });
    // Positive control: the interim row IS marked...
    const interimNode = container.querySelector('[data-interim="true"]');
    expect(interimNode).not.toBeNull();
    expect(interimNode.textContent).toContain("Are we still gate");
    // ...and paired against the final row, which is NOT — proving this is a
    // genuine distinction between the two kinds of row, not an attribute
    // every row happens to carry.
    expect(container.querySelectorAll('[data-interim="true"]')).toHaveLength(1);
  });

  // Programmatic distinction, not merely visual: a screen reader that
  // lands on this row hears a cue that isn't present on a final row's
  // text, via real (if visually hidden) text content rather than styling
  // alone.
  it("carries a programmatic 'still speaking' cue a final turn's text does not", async () => {
    await render({
      turns: [baseTurns[0]],
      interims: { them: "we moved off it in Ma" },
      source: "tab",
    });
    expect(container.textContent).toContain("Still speaking:");
    // The final turn's own paragraph must NOT carry that cue.
    const finalPara = [...container.querySelectorAll("p")].find((p) =>
      p.textContent.includes("Are we still gated"),
    );
    expect(finalPara.textContent).not.toContain("Still speaking:");
  });

  it("never wraps interim text in a live region — it must not be announced on every partial update", async () => {
    await render({ turns: [], interims: { you: "partial text" }, source: "tab" });
    const interimNode = container.querySelector('[data-interim="true"]');
    expect(interimNode).not.toBeNull();
    expect(interimNode.closest('[aria-live]')).toBeNull();
    expect(interimNode.closest('[role="status"]')).toBeNull();
  });
});

describe("reaching the newest turn without hunting", () => {
  it("offers a real, always-enabled control that jumps to the latest turn", async () => {
    await render({ turns: baseTurns, interims: {}, source: "tab" });
    const jumpButton = buttons().find((b) => /jump to.*latest/i.test(b.getAttribute("aria-label") || b.textContent));
    expect(jumpButton).toBeDefined();
    expect(jumpButton.disabled).toBe(false);
    // Present in the tab order — never removed from it while its purpose
    // is on screen (this repo's own forbidden-bug rule).
    expect(jumpButton.tabIndex).not.toBe(-1);
  });

  it("offers no jump control before there is anything to jump to", async () => {
    await render({ turns: [], interims: {}, source: "tab" });
    expect(buttons().find((b) => /jump to.*latest/i.test(b.getAttribute("aria-label") || b.textContent))).toBeUndefined();
  });
});

describe("empty state", () => {
  it("shows a waiting message before any turn has arrived", async () => {
    await render({ turns: [], interims: {}, source: "tab" });
    expect(container.textContent).toContain("The transcript will appear here once the meeting starts");
  });
});
