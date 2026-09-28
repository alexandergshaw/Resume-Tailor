// @vitest-environment jsdom
//
// U4 (plan §4) — GmailConnectionNotice (N3). Binds AC-6 / AC-7.
//
// The notice is the ONE inline, one-click remedy surface for a Gmail refusal.
// This file fails to COLLECT on HEAD (the module does not exist yet) — the
// intended red. Once built, it pins the reachable-remedy contract:
//
//   * not_connected     -> a Connect control whose activation target IS
//                          /api/gmail/connect (AC-6 checks the TARGET, not that
//                          "a button exists").
//   * reauth_required    -> a Reconnect control, same endpoint, copy naming the
//                          expired/revoked access.
//   * temporarily_unavailable -> NO remedy control (offering a reconnect on a
//                          self-healing failure is the WRONG remedy — AC-6). A
//                          quiet note only.
//   * null / undefined   -> renders nothing (connected, ok, or not-yet-checked).
//
// USER-INITIATED BY CONSTRUCTION (AC-6): the control is an <a href> — it cannot
// auto-navigate the tab to Google's consent screen, because nothing fires until
// the user clicks. The test asserts the resolved href, which also fails a control
// wired as onClick+router.push/window.location.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import GmailConnectionNotice from "./GmailConnectionNotice.js";

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

async function render(cause) {
  await act(async () => {
    root.render(createElement(GmailConnectionNotice, { cause }));
  });
}

// Any control whose activation reaches the connect endpoint. An <a href> is the
// production idiom (GmailButton.js:41); resolving the href is what proves the
// remedy is reachable, not merely present.
function connectControls() {
  return Array.from(container.querySelectorAll("a[href]")).filter((a) => {
    const href = a.getAttribute("href") || "";
    return href === "/api/gmail/connect" || href.endsWith("/api/gmail/connect");
  });
}

function visibleText() {
  return (container.textContent || "").trim();
}

describe("GmailConnectionNotice — a reachable, one-click, correct-per-cause remedy (AC-6/AC-7)", () => {
  it("not_connected -> exactly one Connect control targeting /api/gmail/connect", async () => {
    await render("not_connected");
    const controls = connectControls();
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute("href")).toBe("/api/gmail/connect");
    expect(visibleText()).toMatch(/connect/i);
  });

  it("reauth_required -> a Reconnect control on the same endpoint, copy naming lost access", async () => {
    await render("reauth_required");
    const controls = connectControls();
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute("href")).toBe("/api/gmail/connect");
    // Reconnect copy: names that access expired/was revoked (distinct from the
    // first-time Connect copy).
    expect(visibleText()).toMatch(/reconnect|expired|revoked|again/i);
  });

  it("temporarily_unavailable -> a quiet note and NO remedy control (anti-cry-wolf, AC-6)", async () => {
    await render("temporarily_unavailable");
    // The negative direction of the remedy: there is nothing the user can do, so
    // offering a reconnect here would be the wrong remedy on a self-healing blip.
    expect(connectControls()).toHaveLength(0);
    // ...but the state is still SURFACED (not silent) — some quiet copy renders.
    expect(visibleText().length).toBeGreaterThan(0);
  });

  it("null renders nothing at all (connected / ok / not-yet-checked)", async () => {
    await render(null);
    expect(connectControls()).toHaveLength(0);
    expect(visibleText()).toBe("");
  });

  it("undefined renders nothing (defaulted prop must not manufacture a notice)", async () => {
    await render(undefined);
    expect(connectControls()).toHaveLength(0);
    expect(visibleText()).toBe("");
  });

  it("does not auto-navigate: the remedy is a static href, never a firing handler (AC-6)", async () => {
    // Control against a build that renders a <button onClick={() => location = ...}>
    // — which would hijack the tab. The connect control must be an anchor carrying
    // the endpoint as its href.
    await render("not_connected");
    const control = connectControls()[0];
    expect(control).toBeTruthy();
    expect(control.tagName).toBe("A");
    expect(control.getAttribute("href")).toBe("/api/gmail/connect");
  });
});
