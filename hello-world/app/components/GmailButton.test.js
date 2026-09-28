// @vitest-environment jsdom
//
// U8 (plan §4) — GmailButton three-state (M5). Binds AC-9.
//
// HEAD (GmailButton.js:15-20) does `.then(r => r.ok ? r.json() : null)` then
// `.then(d => setConnected(d?.connected ?? false))` and `.catch(() => setConnected(false))`.
// So a non-OK status response AND a thrown fetch BOTH land on connected=false and
// render the "Connect Gmail" affordance — a false "disconnected" when the account
// is actually fine but the status check hiccuped (the same swallow-a-failure class
// N79 fixes for the messages fetch, R-C1).
//
// The two "check-failed" cases are the RED ones: on HEAD they render the Connect
// link, so "distinct from disconnected" (asserted as: no Connect link) fails. The
// connected and disconnected cases are the CONTROLS — they pass on HEAD and keep
// the fix honest in both directions (a build stuck on "check-failed" fails the
// disconnected control; a build stuck on "connected" fails the connected control).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import GmailButton from "./GmailButton.js";

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
  vi.restoreAllMocks();
  delete global.fetch;
});

// Render, then let the status fetch's promise chain settle. A macrotask turn
// inside act() drains the .then/.catch microtasks the effect scheduled (real
// timers here — no fake-timer deadlock).
async function renderWithStatus(fetchImpl) {
  global.fetch = vi.fn(fetchImpl);
  await act(async () => {
    root.render(createElement(GmailButton));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function connectControls() {
  return Array.from(container.querySelectorAll("a[href], button")).filter(
    (n) => (n.getAttribute && n.getAttribute("href")) === "/api/gmail/connect",
  );
}

function text() {
  return (container.textContent || "").trim();
}

describe("GmailButton — distinguishes 'couldn't check' from 'not connected' (AC-9)", () => {
  it("CONTROL (green on HEAD): connected:true renders the connected view, no Connect control", async () => {
    await renderWithStatus(async () => ({ ok: true, json: async () => ({ connected: true }) }));
    expect(connectControls()).toHaveLength(0);
    expect(text()).toMatch(/connected/i);
  });

  it("CONTROL (green on HEAD): connected:false renders the Connect control to /api/gmail/connect", async () => {
    await renderWithStatus(async () => ({ ok: true, json: async () => ({ connected: false }) }));
    const controls = connectControls();
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute("href")).toBe("/api/gmail/connect");
  });

  it("a THROWN status fetch renders a distinct 'couldn't check' state, NOT the disconnected affordance", async () => {
    // RED on HEAD: .catch(() => setConnected(false)) -> Connect control appears.
    await renderWithStatus(() => Promise.reject(new Error("network down")));
    expect(connectControls()).toHaveLength(0);
    // ...and the state is surfaced, not left stuck on the "Checking…" loader.
    expect(text().length).toBeGreaterThan(0);
    expect(text()).not.toMatch(/^Checking/i);
  });

  it("a non-OK (500) status response also renders 'couldn't check', NOT disconnected", async () => {
    // RED on HEAD: r.ok ? r.json() : null -> setConnected(false) -> Connect control.
    await renderWithStatus(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(connectControls()).toHaveLength(0);
    expect(text().length).toBeGreaterThan(0);
    expect(text()).not.toMatch(/^Checking/i);
  });

  it("the check-failed and disconnected states are observably DIFFERENT text", async () => {
    // The teeth of AC-9: a build that renders identical copy for both fails here
    // even if it technically drops the Connect link. Captures both renders and
    // compares.
    await renderWithStatus(async () => ({ ok: true, json: async () => ({ connected: false }) }));
    const disconnectedText = text();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await renderWithStatus(() => Promise.reject(new Error("network down")));
    const checkFailedText = text();

    expect(checkFailedText).not.toBe(disconnectedText);
  });
});
