// @vitest-environment jsdom
//
// The relay between the answer-drafting hooks and the example-pool prewarm's
// noteRowOneStatus. Pinned against its failure directions:
//   - a report reaches the CURRENT target once it is bound (a relay that never
//     forwards leaves every card warming forever);
//   - the relay's identity is stable across renders and rebinds (an unstable one
//     would change the identity of runDraft and every callback memoized on it);
//   - rebinding to a new target moves where reports go (the prewarm hook hands
//     back a new function when its own dependencies change);
//   - a report before anything is bound is dropped without throwing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useRowOneStatusRelay, useBindRowOneStatus } from "./useRowOneStatusRelay.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let seen;
const identities = [];

function Probe({ target, bind = true }) {
  const relay = useRowOneStatusRelay();
  useBindRowOneStatus(bind ? relay.bindRowOneStatus : () => {}, target);
  seen = relay;
  identities.push(relay.onRowOneStatus);
  return null;
}

async function render(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

beforeEach(() => {
  seen = undefined;
  identities.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useRowOneStatusRelay", () => {
  it("[positive control] forwards a report to the bound target with both arguments", async () => {
    const target = vi.fn();
    await render({ target });
    seen.onRowOneStatus("app-1", "pending");
    expect(target).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledWith("app-1", "pending");
  });

  it("drops a report, without throwing, while nothing is bound", async () => {
    const target = vi.fn();
    await render({ target, bind: false });
    expect(() => seen.onRowOneStatus("app-1", "pending")).not.toThrow();
    expect(target).not.toHaveBeenCalled();
  });

  it("keeps one identity across renders and rebinds", async () => {
    await render({ target: vi.fn() });
    await render({ target: vi.fn() });
    await render({ target: vi.fn() });
    expect(identities.length).toBeGreaterThanOrEqual(3);
    expect(new Set(identities).size).toBe(1);
  });

  it("sends reports to the NEW target after a rebind, and none to the old one", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await render({ target: first });
    await render({ target: second });
    seen.onRowOneStatus("app-2", "ready");
    expect(second).toHaveBeenCalledWith("app-2", "ready");
    expect(first).not.toHaveBeenCalled();
  });
});
