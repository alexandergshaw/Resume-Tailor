// @vitest-environment jsdom
//
// useLatestRef: the ref reads the latest committed value, which is what lets an
// async handler see state that changed while it was awaiting.

import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useLatestRef } from "./useLatestRef.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let seen;

function Probe({ value }) {
  seen = useLatestRef(value);
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

async function renderWith(value) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root.render(createElement(Probe, { value }));
  });
}

describe("useLatestRef", () => {
  it("holds the first value on mount", async () => {
    await renderWith(false);
    expect(seen.current).toBe(false);
  });

  it("follows the value on re-render, and keeps one ref object across renders", async () => {
    await renderWith(false);
    const first = seen;
    await renderWith(true);
    expect(seen.current).toBe(true);
    expect(seen).toBe(first);
    await renderWith(false);
    expect(seen.current).toBe(false);
  });
});
