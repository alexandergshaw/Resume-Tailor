// @vitest-environment jsdom
//
// N153 — the per-item mount-warm hook (app/copilot/useWarmOnMount.js).
//
// RED on HEAD: the module does not exist yet, so the import throws at collection
// and every case here is red. Intended red: the hook the two render leaves use
// to warm an expander "as soon as it comes up on screen" is not built.
//
// THE LOAD-BEARING PROPERTY (design §2, ledger N153-L1): the warm fires ONCE per
// distinct non-empty key, read through a ref so it NEVER re-runs on a re-render —
// specifically not on the store-write re-render the N149 fix introduced (a store
// write bumps the api's identity, which re-renders every consumer leaf). The
// firing effect therefore depends on a stable STRING (the resolved key) and
// nothing else. The headline teeth below: re-rendering with the SAME key, handing
// a NEW warmFn each render, must still fire exactly once — a build that put
// warmFn in the effect's dep array (or fired on every render) reds it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import { useWarmOnMount } from "./useWarmOnMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// A harness that calls the real hook with whatever (warmKey, warmFn) the test
// re-renders it with. `tick` is an unrelated prop the test bumps to force a
// re-render WITHOUT changing the key — the store-write re-render, modelled.
function Harness({ warmKey, warmFn, tick }) {
  useWarmOnMount(warmKey, warmFn);
  return createElement("output", { "data-tick": "" }, String(tick ?? 0));
}

async function render(props) {
  await act(async () => root.render(createElement(Harness, props)));
}

describe("the warm fires once per distinct key", () => {
  it("calls warmFn exactly once on mount for a non-empty key", async () => {
    const warmFn = vi.fn();
    await render({ warmKey: "k-1", warmFn });
    expect(warmFn).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire for a null or empty key (the item is not resolvable yet)", async () => {
    const warmFn = vi.fn();
    await render({ warmKey: null, warmFn });
    expect(warmFn).not.toHaveBeenCalled();

    await render({ warmKey: "", warmFn, tick: 1 });
    expect(warmFn).not.toHaveBeenCalled();
  });

  it("does NOT re-fire when the component re-renders with the SAME key", async () => {
    // The N149 store-write re-render: the key is unchanged and the component
    // re-renders repeatedly, and the warm must stay quiet. The SAME warmFn
    // identity is handed every render, so a build whose firing effect runs on
    // every render (no dep array) calls it four times and reds here. The sibling
    // case below, which changes the fn identity on a same-key re-render, is what
    // catches a build that instead put warmFn in the dep array.
    let n = 0;
    const warmFn = vi.fn();
    await render({ warmKey: "stable", warmFn, tick: (n += 1) });
    await render({ warmKey: "stable", warmFn, tick: (n += 1) });
    await render({ warmKey: "stable", warmFn, tick: (n += 1) });
    await render({ warmKey: "stable", warmFn, tick: (n += 1) });
    expect(container.querySelector("[data-tick]").textContent).toBe("4"); // it really re-rendered
    expect(warmFn).toHaveBeenCalledTimes(1);
  });

  it("fires again, with the LATEST warmFn, when the key changes to a new value", async () => {
    const first = vi.fn();
    const second = vi.fn(); // handed on the SAME-key re-render, must never fire
    const third = vi.fn(); // handed when the key changes, the one that must fire
    await render({ warmKey: "A", warmFn: first });
    await render({ warmKey: "A", warmFn: second, tick: 1 });
    await render({ warmKey: "B", warmFn: third, tick: 2 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("fires once per item across a mount of several independent keys", async () => {
    // Each leaf has its own hook instance; distinct keys each warm once.
    const fns = { a: vi.fn(), b: vi.fn(), c: vi.fn() };
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(Harness, { warmKey: "a", warmFn: fns.a }),
          createElement(Harness, { warmKey: "b", warmFn: fns.b }),
          createElement(Harness, { warmKey: "c", warmFn: fns.c }),
        ),
      ),
    );
    expect(fns.a).toHaveBeenCalledTimes(1);
    expect(fns.b).toHaveBeenCalledTimes(1);
    expect(fns.c).toHaveBeenCalledTimes(1);
  });

  it("[control] a bumped unrelated prop with NO warmFn would throw if the hook called it — it is a no-op key path", async () => {
    // Guards against a build that fires even when warmFn is absent: here warmFn
    // is undefined and the key is set, so a hook that called warmFn() blindly
    // would throw. Optional invocation keeps it a no-op.
    await render({ warmKey: "has-key", warmFn: undefined });
    // Reaching here without throwing is the assertion; make it explicit.
    expect(container.querySelector("[data-tick]")).not.toBeNull();
  });
});
