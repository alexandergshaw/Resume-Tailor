// @vitest-environment jsdom
//
// DriveButton is the settings-menu Google Drive connect/disconnect control,
// modelled on GmailButton.js (app/components/GmailButton.js:16,41,52-68).
// These tests exercise every state UX.md rev 2 §6.7 enumerates: loading,
// not-configured (renders nothing), a failed status fetch (degrades to
// disconnected, never to nothing — B-5), disconnected, connected, and
// disconnecting.
//
// NOT covered here: DriveButton is not yet mounted anywhere.
// `app/components/SettingsMenu.js` renders `GmailButton` but has no Drive
// equivalent, and `app/theme/themeSystem.test.js:128` pins that Gmail
// wiring only. There is no companion wiring test in this file (an earlier
// version of this comment claimed one existed below; it did not --
// WAVE2-SEAMS.md MAJOR-6). Mounting `DriveButton` in `SettingsMenu` and
// adding that wiring test belongs with whichever later change actually
// performs the mount.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DriveButton from "./DriveButton.js";

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

// The accessible name a screen reader would announce for a plain button/link
// with no aria-label/aria-labelledby/title override: its trimmed text
// content. Mirrors AttachmentPanel.test.js's helper of the same name, pared
// to what this component actually uses (no aria-label anywhere here, no
// Tooltip — UX.md §2.2's deliberate divergence).
function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = container.querySelector(`#${CSS.escape(labelledBy)}`);
    if (target) return target.textContent.trim();
  }
  const title = el.getAttribute("title");
  if (title) return title;
  return el.textContent.trim();
}

function installFetch(handler) {
  global.fetch = vi.fn(handler);
}

async function mount() {
  await act(async () => {
    root.render(createElement(DriveButton));
  });
  // The status fetch fires synchronously from the mount effect; a couple of
  // microtask/real-tick flushes let its .then()/.catch() chain land before
  // assertions run (mirrors AttachmentPanel.test.js's mount()).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function findByText(text) {
  return [...container.querySelectorAll("button, a")].find((el) => el.textContent.trim() === text) || null;
}

describe("DriveButton — loading", () => {
  it("shows Checking… while the status call is in flight, and nothing else", async () => {
    installFetch(() => new Promise(() => {})); // never resolves
    await act(async () => {
      root.render(createElement(DriveButton));
    });
    expect(container.textContent).toBe("Checking…");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("DriveButton — not configured", () => {
  it("renders nothing at all when the server has no Google client credentials", async () => {
    installFetch(() =>
      Promise.resolve({ ok: true, json: async () => ({ connected: false, configured: false }) }),
    );
    await mount();
    expect(container.textContent).toBe("");
    expect(container.innerHTML).toBe("");
  });

  // Positive control for the case above: with the SAME shape minus
  // `configured: false`, a control renders. Without this, "renders nothing
  // when unconfigured" would also be satisfied by a component that never
  // renders anything at all.
  it("positive control: the same fetch shape, configured, renders a control", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: false, configured: true }) }));
    await mount();
    expect(findByText("Connect Drive")).not.toBeNull();
  });
});

describe("DriveButton — status fetch failed", () => {
  it("degrades to the disconnected view, not to nothing (B-5)", async () => {
    installFetch(() => Promise.reject(new Error("network down")));
    await mount();
    const connect = findByText("Connect Drive");
    expect(connect).not.toBeNull();
    expect(connect.tagName).toBe("A");
    expect(connect.getAttribute("href")).toBe("/api/drive/connect");
  });

  it("also degrades to disconnected on a non-OK response", async () => {
    installFetch(() => Promise.resolve({ ok: false, json: async () => ({}) }));
    await mount();
    expect(findByText("Connect Drive")).not.toBeNull();
  });
});

describe("DriveButton — disconnected", () => {
  it("renders a 'Connect Drive' link whose accessible name is exactly its visible text", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: false, configured: true }) }));
    await mount();
    const connect = findByText("Connect Drive");
    expect(connect).not.toBeNull();
    expect(accessibleName(connect)).toBe("Connect Drive");
    expect(connect.getAttribute("href")).toBe("/api/drive/connect");
    // Not a nested menu, not a wrapped disabled control.
    expect(connect.hasAttribute("disabled")).toBe(false);
  });

  it("shows no Disconnect control and no connected caption while disconnected", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: false, configured: true }) }));
    await mount();
    expect(findByText("Disconnect Drive")).toBeNull();
    expect(container.textContent).not.toContain("Drive connected");
  });
});

describe("DriveButton — connected", () => {
  it("shows the connected state and a Disconnect Drive control with a matching accessible name", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true }) }));
    await mount();
    expect(container.textContent).toContain("Drive connected");
    const disconnect = findByText("Disconnect Drive");
    expect(disconnect).not.toBeNull();
    expect(disconnect.tagName).toBe("BUTTON");
    expect(accessibleName(disconnect)).toBe("Disconnect Drive");
    expect(disconnect.hasAttribute("disabled")).toBe(false);
  });

  it("carries both settings captions, verbatim", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true }) }));
    await mount();
    expect(container.textContent).toContain("Documents are saved to a “Resume Tailor” folder in your Drive.");
    expect(container.textContent).toContain(
      "Disconnecting only removes this app's access — your Docs stay in Drive.",
    );
  });

  it("state is conveyed in text, not colour alone (AC-A9): the word 'connected' is real text content", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true }) }));
    await mount();
    // Tripwire against a portal-rendered state (MUI Popper/Tooltip/Dialog):
    // this component uses none, so what the container sees must equal what
    // the document body sees.
    expect(document.body.textContent).toBe(container.textContent);
  });
});

describe("DriveButton — connected account email (optional, from the status response)", () => {
  it("renders the granting account's email as a subordinate qualifier when present", async () => {
    installFetch(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ connected: true, configured: true, email: "person@gmail.com" }),
      }),
    );
    await mount();
    expect(container.textContent).toContain("Drive connected");
    expect(container.textContent).toContain("person@gmail.com");
    // Subordinate: its own text node, not concatenated onto the primary
    // "Drive connected" line.
    const emailNode = [...container.querySelectorAll("p, span, div")].find(
      (el) => el.textContent.trim() === "person@gmail.com",
    );
    expect(emailNode).not.toBeUndefined();
    const connectedNode = [...container.querySelectorAll("p, span, div")].find(
      (el) => el.textContent.trim() === "Drive connected",
    );
    expect(connectedNode).not.toBeUndefined();
    expect(connectedNode).not.toBe(emailNode);
  });

  // Positive control for the "absent" tests below: the SAME fixture shape
  // with only `email` removed still renders a control, so "no stray empty
  // element when email is absent" isn't trivially satisfied by a component
  // that renders nothing at all.
  it("positive control: renders the plain connected state when email is absent", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true }) }));
    await mount();
    expect(findByText("Disconnect Drive")).not.toBeNull();
  });

  it("with no email field, falls back to plain 'Drive connected' — no empty element, no literal 'undefined'", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true }) }));
    await mount();
    expect(container.textContent).toContain("Drive connected");
    expect(container.textContent).not.toContain("undefined");
    const empties = [...container.querySelectorAll("p, span")].filter(
      (el) => el.textContent.trim() === "" && el.children.length === 0,
    );
    expect(empties).toHaveLength(0);
  });

  it("treats an empty-string email the same as absent", async () => {
    installFetch(() =>
      Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true, email: "" }) }),
    );
    await mount();
    expect(container.textContent).toContain("Drive connected");
    const empties = [...container.querySelectorAll("p, span")].filter(
      (el) => el.textContent.trim() === "" && el.children.length === 0,
    );
    expect(empties).toHaveLength(0);
  });

  it("treats a non-string email as absent rather than rendering it or crashing", async () => {
    installFetch(() =>
      Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true, email: 12345 }) }),
    );
    await mount();
    expect(container.textContent).toContain("Drive connected");
    expect(container.textContent).not.toContain("12345");
  });

  it("does not fold the email into the Disconnect button's accessible name", async () => {
    installFetch(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ connected: true, configured: true, email: "person@gmail.com" }),
      }),
    );
    await mount();
    const disconnect = findByText("Disconnect Drive");
    expect(disconnect).not.toBeNull();
    expect(accessibleName(disconnect)).toBe("Disconnect Drive");
    expect(accessibleName(disconnect)).not.toContain("person@gmail.com");
    expect(disconnect.textContent).not.toContain("person@gmail.com");
    expect(disconnect.hasAttribute("aria-describedby")).toBe(false);
    expect(disconnect.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("visible text stays a substring of the accessible name for the Disconnect control even with an email present (WCAG 2.5.3)", async () => {
    installFetch(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ connected: true, configured: true, email: "person@gmail.com" }),
      }),
    );
    await mount();
    const disconnect = findByText("Disconnect Drive");
    expect(accessibleName(disconnect)).toContain(disconnect.textContent.trim());
  });
});

describe("DriveButton — disconnecting", () => {
  it("takes no confirmation and shows a pending label while genuinely disabled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    let resolveDelete;
    global.fetch = vi.fn((url, options = {}) => {
      const method = (options && options.method) || "GET";
      if (method === "DELETE") {
        return new Promise((resolve) => {
          resolveDelete = () => resolve({ ok: true, json: async () => ({}) });
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true }) });
    });
    await mount();

    const disconnect = findByText("Disconnect Drive");
    await act(async () => {
      disconnect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    const pending = findByText("Disconnecting…");
    expect(pending).not.toBeNull();
    expect(pending.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });

    // Back to the disconnected view; no confirmation was ever shown, and the
    // DELETE call carried no body to confirm.
    expect(findByText("Connect Drive")).not.toBeNull();
    expect(findByText("Disconnect Drive")).toBeNull();
    const deleteCalls = global.fetch.mock.calls.filter(([, opts]) => opts && opts.method === "DELETE");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toBe("/api/drive/disconnect");
  });
});

describe("DriveButton — keyboard operability and focus", () => {
  it("the Connect Drive link is a native, focusable anchor with a visible outline left to the browser/theme (no custom focus suppression)", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: false, configured: true }) }));
    await mount();
    const connect = findByText("Connect Drive");
    connect.focus();
    expect(document.activeElement).toBe(connect);
    expect(connect.style.outline).toBe("");
  });

  it("the Disconnect Drive button is a native <button>, reachable by Tab order and activatable without a wrapper", async () => {
    installFetch(() => Promise.resolve({ ok: true, json: async () => ({ connected: true, configured: true }) }));
    await mount();
    const disconnect = findByText("Disconnect Drive");
    expect(disconnect.tagName).toBe("BUTTON");
    expect(disconnect.closest("[title]")).toBeNull(); // no Tooltip wrapper anywhere
  });
});

describe("DriveButton — source-text checks", () => {
  const SOURCE = readFileSync(path.join(process.cwd(), "app/components/DriveButton.js"), "utf8");

  it("uses only design tokens for colour, matching GmailButton's convention", () => {
    expect(SOURCE).toMatch(/var\(--text-muted\)/);
    expect(SOURCE).toMatch(/var\(--success\)/);
    expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("never wraps a control in a MUI Tooltip (UX.md §2.2's deliberate divergence)", () => {
    expect(SOURCE).not.toContain("Tooltip");
  });

  it("introduces no MUI non-native Select", () => {
    expect(SOURCE).not.toMatch(/from "@mui\/material\/Select"/);
    expect(SOURCE).not.toContain("role=\"combobox\"");
  });

  it("status-fetch failure degrades via .catch(() => setConnected(false)), GmailButton.js:19's exact posture", () => {
    // Anchored tightly to the .catch block's own closing brace so this does
    // NOT also match the unrelated setConnected(false) inside
    // handleDisconnect further down the file.
    expect(SOURCE).toMatch(/\.catch\(\(\) => \{\s*if \(cancelled\) return;\s*setConnected\(false\);\s*\}\);/);
  });
});
