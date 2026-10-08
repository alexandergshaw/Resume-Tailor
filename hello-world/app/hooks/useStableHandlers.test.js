// @vitest-environment jsdom
//
// useStableHandlers: one fixed-identity forwarder per name, each calling the
// LATEST handler. The tracking rows rely on both halves -- the identity so a
// React.memo child can skip, the forwarding so a click never runs a stale
// closure (TrackingTab.renderCount.test.js drives the pair end to end).

import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useStableHandlers } from "./useStableHandlers.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NAMES = ["onSave", "onClose"];

let container;
let root;
let seen;

function Probe({ handlers }) {
  seen = useStableHandlers(handlers, NAMES);
  return null;
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root.unmount();
    });
  }
  container?.remove();
  root = undefined;
  container = undefined;
});

async function renderWith(handlers) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root.render(createElement(Probe, { handlers }));
  });
}

describe("useStableHandlers", () => {
  it("returns exactly the named forwarders", async () => {
    await renderWith({ onSave: () => {}, onClose: () => {}, ignored: () => {} });
    expect(Object.keys(seen).sort()).toEqual(["onClose", "onSave"]);
  });

  it("keeps every forwarder's identity across renders that hand it brand-new functions", async () => {
    await renderWith({ onSave: () => 1, onClose: () => 2 });
    const first = seen;
    const { onSave, onClose } = seen;
    await renderWith({ onSave: () => 3, onClose: () => 4 });
    await renderWith({ onSave: () => 5, onClose: () => 6 });
    expect(seen).toBe(first);
    expect(seen.onSave).toBe(onSave);
    expect(seen.onClose).toBe(onClose);
  });

  it("calls the latest function, with its arguments, and returns its value", async () => {
    const calls = [];
    await renderWith({ onSave: (...args) => { calls.push(["old", args]); return "old"; }, onClose: () => {} });
    const { onSave } = seen;
    await renderWith({ onSave: (...args) => { calls.push(["new", args]); return "new"; }, onClose: () => {} });
    expect(onSave("a", 2)).toBe("new");
    expect(calls).toEqual([["new", ["a", 2]]]);
  });

  it("throws on a call to a name with no handler rather than silently doing nothing", async () => {
    await renderWith({ onSave: () => {} });
    expect(() => seen.onClose()).toThrow(TypeError);
  });
});
