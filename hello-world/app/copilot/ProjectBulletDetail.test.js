// @vitest-environment jsdom
//
// N154 — the per-bullet control + inline region (app/copilot/ProjectBulletDetail.js).
// RED on HEAD: the module does not exist, so the import fails at collection.
//
// Driven with a STUB scope (the api is injected by mocking useProjectBulletDetails)
// so every record state can be rendered deterministically. The real-scope
// reachability is a separate test (AnswerAids.projectBulletDetail.warmOnMount).
//
// The load-bearing properties:
//   • null when there is no scope OR the descriptor does not resolve — byte-
//     identical DOM to today, which is what keeps every existing AnswerAids suite
//     green;
//   • data-bullet-detail on the control (the exclusion the bullet-text test uses);
//   • aria-controls set only while open (no dangling IDREF);
//   • N155: the bespoke Retry is gone. The shared Regenerate control (carrying
//     data-regenerate) is the one re-issue affordance, on every open state except
//     loading and disabled: done, empty, error, timeout, and an evicted (idle)
//     bullet. A kill-switch state offers neither.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const h = vi.hoisted(() => ({ api: null }));
vi.mock("./useProjectBulletDetails.js", () => ({
  useProjectBulletDetailApi: () => h.api,
  ProjectBulletDetailScope: ({ children }) => children,
}));

import ProjectBulletDetail from "./ProjectBulletDetail.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROPS = {
  title: "Rebuilt the paging rotation",
  competency: "incident response",
  bulletIndex: 0,
  bullet: "Cut alert noise from 5 to 1 per shift",
  siblingBullets: ["Mean time to ack within the target"],
};

function makeApi({ record, open = false, resolves = true }) {
  return {
    keyFor: () => "k",
    prefetch: () => {},
    resolves: () => resolves,
    isOpen: () => open,
    get: () => record,
    toggle: vi.fn(),
    retry: vi.fn(),
    regenerate: vi.fn(),
  };
}

let container;
let root;

beforeEach(() => {
  h.api = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(createElement(ProjectBulletDetail, PROPS)));
}

const detailButton = () =>
  [...container.querySelectorAll("button")].find((b) => (b.textContent || "").includes("More detail"));
const retryButton = () =>
  [...container.querySelectorAll("button")].find((b) => /retry/i.test(b.textContent || "") || /retry/i.test(b.getAttribute("aria-label") || ""));
const regenerateButton = () =>
  [...container.querySelectorAll("button")].find((b) => /^regenerate/i.test(b.getAttribute("aria-label") || ""));
// The region's own text with the Regenerate control taken out by its one marker,
// so a read of "the detail prose" never captures "Regenerate" / "Add context".
function regionText() {
  const clone = container.cloneNode(true);
  clone.querySelectorAll("[data-regenerate]").forEach((n) => n.remove());
  return clone.textContent;
}

describe("renders nothing when it cannot be reached", () => {
  it("returns null with no scope mounted (byte-identical DOM)", async () => {
    h.api = null;
    await render();
    expect(container.innerHTML).toBe("");
  });

  it("returns null when the descriptor does not resolve", async () => {
    h.api = makeApi({ record: { status: "idle" }, resolves: false });
    await render();
    expect(container.innerHTML).toBe("");
  });
});

describe("the closed control", () => {
  beforeEach(() => {
    h.api = makeApi({ record: { status: "idle", detail: "", empty: false, code: null }, open: false });
  });

  it("renders a 'More detail' button carrying data-bullet-detail, collapsed, with no dangling aria-controls", async () => {
    await render();
    const btn = detailButton();
    expect(btn, "a 'More detail' button renders").toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    // aria-controls is set only while open — closed, it names nothing.
    expect(btn.getAttribute("aria-controls")).toBeFalsy();
    // The control carries data-bullet-detail (the bullet-text exclusion marker).
    expect(container.querySelector("[data-bullet-detail]")).not.toBeNull();
  });

  it("toggles the scope on click (the click is reachable, not a prop handler)", async () => {
    await render();
    await act(async () => detailButton().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(h.api.toggle).toHaveBeenCalledTimes(1);
  });
});

describe("the open region's states", () => {
  async function openWith(record) {
    h.api = makeApi({ record, open: true });
    await render();
  }

  it("loading: shows an aria-busy region and names it via aria-controls", async () => {
    await openWith({ status: "loading", detail: "", empty: false, code: null });
    const btn = detailButton();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const controls = btn.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(controls)}`)).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("done: shows the sanitized detail prose, with a Regenerate control the prose read excludes", async () => {
    await openWith({ status: "done", detail: "A strong candidate might describe tuning thresholds.", empty: false, code: null });
    // The read excludes [data-regenerate], so it is the prose alone: if the
    // control dropped its marker the words "Regenerate"/"Add context" would leak
    // into it and the not.toContain lines below would redden.
    const text = regionText();
    expect(text).toContain("A strong candidate might describe tuning thresholds.");
    expect(text).not.toContain("Regenerate");
    expect(text).not.toContain("Add context");
    expect(regenerateButton(), "Regenerate is offered under a settled detail").toBeTruthy();
  });

  it("empty: shows a message, offers NO Retry, and offers Regenerate", async () => {
    await openWith({ status: "empty", detail: "", empty: true, code: null });
    expect(retryButton()).toBeUndefined();
    // N155: regenerating an honest empty is allowed (a steered second look).
    expect(regenerateButton()).toBeTruthy();
  });

  it("error: shows a message and a Regenerate that calls the scope with no context", async () => {
    await openWith({ status: "error", detail: "", empty: false, code: "http" });
    expect(retryButton(), "the bespoke Retry is removed").toBeUndefined();
    const regenerate = regenerateButton();
    expect(regenerate, "a Regenerate button on error").toBeTruthy();
    await act(async () => regenerate.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(h.api.regenerate).toHaveBeenCalledTimes(1);
    expect(h.api.regenerate).toHaveBeenCalledWith({ title: PROPS.title, bulletIndex: PROPS.bulletIndex, bullet: PROPS.bullet }, { context: "" });
    expect(h.api.retry).not.toHaveBeenCalled();
  });

  it("timeout: offers Regenerate", async () => {
    await openWith({ status: "error", detail: "", empty: false, code: "timeout" });
    expect(regenerateButton()).toBeTruthy();
  });

  it("idle (an evicted open bullet): reads as a failure and keeps a Regenerate, never a dead end", async () => {
    await openWith({ status: "idle", detail: "", empty: false, code: null });
    expect(regionText()).toContain("Couldn't get more detail.");
    expect(retryButton()).toBeUndefined();
    const regenerate = regenerateButton();
    expect(regenerate, "an evicted open bullet still offers a re-issue").toBeTruthy();
    await act(async () => regenerate.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(h.api.regenerate).toHaveBeenCalledTimes(1);
  });

  it("loading: offers NO Regenerate (the click re-enters loading)", async () => {
    await openWith({ status: "loading", detail: "", empty: false, code: null });
    expect(regenerateButton()).toBeUndefined();
    expect(container.querySelector("[data-regenerate]")).toBeNull();
  });

  it("disabled (kill switch): shows a message and offers NEITHER Retry nor Regenerate", async () => {
    await openWith({ status: "error", detail: "", empty: false, code: "disabled" });
    expect(retryButton()).toBeUndefined();
    expect(regenerateButton()).toBeUndefined();
    expect(container.querySelector("[data-regenerate]")).toBeNull();
  });

  it("every top-level node carries data-bullet-detail", async () => {
    await openWith({ status: "done", detail: "Prose here.", empty: false, code: null });
    const roots = [...container.children];
    expect(roots.length).toBeGreaterThan(0);
    for (const node of roots) {
      expect(node.hasAttribute("data-bullet-detail"), `${node.tagName} carries data-bullet-detail`).toBe(true);
    }
  });
});
