// @vitest-environment jsdom
//
// Adversarial-review fix, post-AC-Q9: app/copilot/CopilotClient.js mounts
// RoleDrillClient from a ternary (`mode === "roles" ? <RoleDrillClient /> :
// ...`), so leaving "Speak as" for another mode UNMOUNTS this whole tree.
// Before this fix, every piece of useRoleDrill's state lived in plain
// `useState` and died with it - re-entering the mode looked exactly like a
// first visit, so the mount effect paid for a fresh fetchRoleSituation (a
// real Gemini call on the default engine) for a round trip the user
// experienced as free, with the asked list zeroed and `exhausted` reset.
//
// This file proves the fix: roleDrillStore.js hoists the situation, its
// revealed answer, and the asked list out of the component into a
// module-scoped (localStorage-backed) store, so a return visit restores
// instead of refetching. Deliberately separate from
// RoleDrillClient.contract.test.js (frozen, not to be edited) rather than
// added to it.
//
// This suite calls roleDrillStore's `resetRoleDrillStore` in its own
// `beforeEach` - the one place that test-only export exists to be called
// from (see that module's own doc comment: production code has no reason
// to ever call it). RoleDrillClient.contract.test.js does not know this
// store exists and does not need to reset it itself: that file's own
// `beforeEach` already clears `localStorage`, and this store's snapshots
// are memoized against the raw string actually in `localStorage`, so a
// direct `localStorage.clear()` is picked up as "nothing known" on the very
// next read regardless of which module reads it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/roleDrillClient", () => ({
  fetchRoleSituation: vi.fn(),
  fetchRoleResponse: vi.fn(),
}));

import RoleDrillClient from "./RoleDrillClient.js";
import { fetchRoleSituation, fetchRoleResponse } from "@/lib/copilot/roleDrillClient";
import { DEFAULT_ROLE, roleRegister } from "@/lib/copilot/roleRegisters";
import { resetRoleDrillStore } from "./roleDrillStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REGISTER = roleRegister(DEFAULT_ROLE);

const SITUATION = {
  id: `${DEFAULT_ROLE}-restore-case`,
  prompt: "Your director stops you in the hallway and asks why the release slipped a week.",
  context: "The director already has the dates; what they want is your read on it.",
};

function situationPayload() {
  return { role: DEFAULT_ROLE, situation: SITUATION, source: "embedded", exhausted: false };
}

function responsePayload() {
  return {
    role: DEFAULT_ROLE,
    lines: REGISTER.beatLabels.map((label, i) => ({
      label,
      text: `Line ${i + 1}: this is a full sentence a person could say out loud in the room.`,
    })),
    cadence: REGISTER.cadence,
    terms: REGISTER.vocabulary,
    termsUsed: REGISTER.vocabulary.slice(0, 2).map((v) => v.term),
    avoid: REGISTER.avoid,
    source: "embedded",
  };
}

let container;
let root;

const text = () => container.textContent || "";
const buttonNamed = (re) => [...container.querySelectorAll("button")].find((b) => re.test((b.textContent || "")));

async function render() {
  await act(async () => {
    root.render(createElement(RoleDrillClient, {}));
  });
}

async function click(el) {
  expect(el, "control not found").toBeTruthy();
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    globalThis.localStorage.clear();
  } catch {
    /* jsdom always has one; a private-mode throw must not fail the suite */
  }
  // The store is module-scoped (that's the entire point of the fix), so it
  // outlives a component unmount by design - it must be reset explicitly
  // between test cases in this file instead, the same way `localStorage`
  // itself is cleared above.
  resetRoleDrillStore();
  fetchRoleSituation.mockResolvedValue(situationPayload());
  fetchRoleResponse.mockResolvedValue(responsePayload());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("RoleDrillClient - restoring across an unmount/remount", () => {
  it("shows the same situation and its revealed answer again with no new fetch", async () => {
    await render();
    expect(fetchRoleSituation).toHaveBeenCalledTimes(1);

    await click(buttonNamed(/reveal a model answer/i));
    expect(fetchRoleResponse).toHaveBeenCalledTimes(1);
    expect(text()).toContain("why the release slipped");
    expect(text()).toContain("Line 1:");

    // The exact scenario the wiring wave's mode ternary produces: leaving
    // "Speak as" unmounts this component; returning to it mounts a brand
    // new instance with no React state carried over.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();

    // Restored: same situation, same revealed answer, already open - not
    // merely available on a fresh click.
    expect(text()).toContain("why the release slipped");
    expect(text()).toContain("Line 1:");
    const reveal = buttonNamed(/model answer/i);
    expect(reveal.getAttribute("aria-expanded")).toBe("true");

    // The actual bug: neither request fired again to produce that content.
    expect(fetchRoleSituation).toHaveBeenCalledTimes(1);
    expect(fetchRoleResponse).toHaveBeenCalledTimes(1);
  });
});
