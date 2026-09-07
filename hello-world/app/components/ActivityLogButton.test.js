// @vitest-environment jsdom
//
// THE CONTROL HALF. jsdom cannot download -- `triggerBlobDownload` clicks a
// temporary anchor and there is no download shelf to read -- so this file
// covers what the pure-function suites structurally cannot:
//
//   * a control EXISTS, is reachable in the settings menu, and is not merely
//     imported (this repo has shipped an extraction where 27 tests passed
//     against a caller that rendered none of the new components);
//   * ONE CLICK produces ONE FILE: no menu, no dialog, no confirmation;
//   * the click is wired to exactly the two pure functions whose OUTPUT the
//     other suites pin (renderActivityLog / activityLogFileName), so neither
//     half can be green while the pair is mis-wired;
//   * the recorder is installed by the app's chrome, not by opening the
//     popover -- a log that only starts recording once you go looking for it
//     would be empty in precisely the session you needed it for.
//
// The CONTENT of the file and the file NAME are lib/activityLog/
// activityLogDocument.test.js's half.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/document/download.js", () => ({ triggerBlobDownload: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({ createClient: vi.fn() }));

import { triggerBlobDownload } from "@/lib/document/download.js";
import { createClient } from "../../lib/supabase/client";
import ActivityLogButton from "./ActivityLogButton.js";
import SettingsMenu from "./SettingsMenu.js";
import { recordActivity, activityLogSnapshot } from "@/lib/activityLog/appActivityLog.js";
import { renderActivityLog, activityLogFileName } from "@/lib/activityLog/activityLogDocument.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  triggerBlobDownload.mockReset();
  createClient.mockReset();
  createClient.mockReturnValue({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function mountButton() {
  await act(async () => {
    root.render(createElement(ActivityLogButton));
  });
}

function theButton() {
  return [...container.querySelectorAll("button")].find((b) => /activity log/i.test(b.textContent || ""));
}

describe("the control", () => {
  it("renders one visible, named button", async () => {
    await mountButton();
    const button = theButton();
    expect(button, "no download-activity-log button rendered").toBeTruthy();
    expect(button.textContent).toMatch(/download/i);
    expect(button.disabled).toBe(false);
  });

  it("is enabled even before anything is recorded", async () => {
    // Deliberately unlike StatusBar's duplicate-check log button, which hides
    // itself until there is something to say. An EMPTY app-wide log is still
    // the answer to "what happened this session" -- it says the recorder
    // installed and nothing has happened since -- and a control that vanishes
    // when a user goes looking for it is the worse failure.
    await mountButton();
    expect(theButton().disabled).toBe(false);
  });

  it("produces one file on one click: no menu, no dialog, no confirmation", async () => {
    await mountButton();
    const bodyBefore = document.body.querySelectorAll('[role="dialog"], [role="menu"]').length;
    await act(async () => {
      theButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll('[role="dialog"], [role="menu"]')).toHaveLength(bodyBefore);
  });

  it("hands the download helper a markdown blob under the log's own file name", async () => {
    recordActivity("act", "test.click", { ok: true });
    await mountButton();
    await act(async () => {
      theButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const [blob, fileName] = triggerBlobDownload.mock.calls[0];
    expect(blob.type).toBe("text/markdown");
    expect(fileName).toBe(activityLogFileName(activityLogSnapshot()));
    expect(fileName).toMatch(/^activity-log-.*\.md$/);
  });

  it("writes the SAME bytes the pure renderer produces -- not an empty file", async () => {
    // The "download produces an empty file" mutant. Reading the Blob back is
    // the only way to prove the wiring carries content rather than a stub.
    recordActivity("net", "fetch", { method: "GET", path: "/api/probe", status: 200, ok: true });
    await mountButton();
    await act(async () => {
      theButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const [blob] = triggerBlobDownload.mock.calls[0];
    const text = await blob.text();
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain("/api/probe");
    expect(text).toContain("What this file does NOT contain");
    expect(text).toBe(renderActivityLog(activityLogSnapshot()));
  });

  it("captures activity recorded AFTER mount, so the snapshot is taken on click", async () => {
    await mountButton();
    recordActivity("act", "after.mount.marker", {});
    await act(async () => {
      theButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const text = await triggerBlobDownload.mock.calls[0][0].text();
    expect(text).toContain("after.mount.marker");
  });

  it("never lets a failing download take the settings menu down", async () => {
    triggerBlobDownload.mockImplementation(() => {
      throw new Error("no download shelf here");
    });
    await mountButton();
    await act(async () => {
      expect(() => theButton().dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
    });
  });
});

describe("the surface: Settings > Admin tools", () => {
  async function openSettings() {
    await act(async () => {
      root.render(createElement(SettingsMenu));
    });
    const gear = container.querySelector('[aria-label="Settings"]');
    expect(gear, "no [aria-label=Settings] gear button rendered").toBeTruthy();
    gear.focus();
    await act(async () => {
      gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (url === "/api/gmail/status") return Promise.resolve({ ok: true, json: async () => ({ connected: false }) });
      if (url === "/api/drive/status") {
        return Promise.resolve({ ok: true, json: async () => ({ connected: false, configured: true }) });
      }
      return Promise.reject(new Error(`unexpected fetch in settings wiring test: ${url}`));
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it("mounts a real, clickable download control under an Admin tools section", async () => {
    await openSettings();
    const labels = [...document.body.querySelectorAll("*")]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent.trim());
    expect(labels).toContain("Admin tools");
    const button = [...document.body.querySelectorAll("button")].find((b) => /activity log/i.test(b.textContent || ""));
    expect(button, "Admin tools rendered without a download control").toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
  });

  it("installs the recorder when the app chrome mounts, NOT when the popover opens", async () => {
    // The control renders inside a MUI Popover with no `keepMounted`, so it
    // does not exist in the DOM until a user opens Settings. If installation
    // lived there, the log would start recording at the moment someone went
    // looking for it and would be empty for everything before that.
    const before = global.fetch;
    await act(async () => {
      root.render(createElement(SettingsMenu));
    });
    expect(global.fetch, "SettingsMenu mounted without installing the recorder").not.toBe(before);
    expect(document.body.textContent).toBe(container.textContent);
  });

  it("records a real fetch once the chrome is mounted", async () => {
    await act(async () => {
      root.render(createElement(SettingsMenu));
    });
    await act(async () => {
      await global.fetch("/api/gmail/status");
    });
    const paths = activityLogSnapshot().events.map((e) => e.path);
    expect(paths).toContain("/api/gmail/status");
  });
});
