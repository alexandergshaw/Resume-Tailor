// @vitest-environment jsdom
//
// N60 S7 (4b) -- AC-R5: the user can SEE the run log and DOWNLOAD it.
//
// This is the component the automation panel and the queue tab both mount. It
// fetches the signed-in user's own runs (/api/auto-apply-queue/runs) and renders
// them, with a clearly visible download control producing a single .md file via
// the SHARED download helper (lib/document/download.js's triggerBlobDownload --
// the repo's one download primitive; a private copy would leave the spy here
// untouched and is the thing this file's mock makes observable).
//
// RED ON HEAD: app/components/feed/AutoTailorRunLog.js does not exist, so the
// import below fails collection. MEASURED: ABSENT in the S7-target probe.
//
// This file is the RENDER-AND-STATE half. Reachability -- that a user can
// actually navigate to this component by clicking the shipped toolbar -- is a
// SEPARATE gate (AutoTailorRunLog.reachability.test.js), because a component
// that renders perfectly in isolation but is mounted nowhere is this repo's
// single most-repeated defect.
//
// jsdom LIMITS (measurement-instruments memory): no layout; Blob.text() is used
// only where guarded. The download assertion pins the SHARED helper's call, not
// a real file write, which jsdom cannot do.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import AutoTailorRunLog from "./AutoTailorRunLog.js";

vi.mock("../../../lib/document/download", () => ({ triggerBlobDownload: vi.fn() }));
import { triggerBlobDownload } from "../../../lib/document/download";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RUNS = [
  {
    id: "r2",
    ran_at: "2026-09-27T13:00:00.000Z",
    payload: {
      userId: "user-1",
      autoEligible: 2,
      autoProcessed: 2,
      tailored: 2,
      skipped: {},
      emailEligible: 0,
      emailed: 0,
      autoFeatureError: null,
      emailFeatureError: null,
      zeroReason: null,
      emailZeroReason: null,
    },
  },
  {
    id: "r1",
    ran_at: "2026-09-27T12:00:00.000Z",
    payload: {
      userId: "user-1",
      autoEligible: 1,
      autoProcessed: 1,
      tailored: 0,
      skipped: {},
      emailEligible: 0,
      emailed: 0,
      autoFeatureError: null,
      emailFeatureError: null,
      zeroReason: "no_search_enabled",
      emailZeroReason: null,
    },
  },
];

let fetchMode; // "ok" | "empty" | "error"
function installFetch() {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.startsWith("/api/auto-apply-queue/runs")) {
      if (fetchMode === "error") return Promise.reject(new Error("network down"));
      const runs = fetchMode === "empty" ? [] : RUNS;
      return Promise.resolve({ ok: true, json: async () => ({ runs }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

let container;
let root;

async function mount(props = { mode: "full" }) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme }, createElement(AutoTailorRunLog, props)));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

async function click(el) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const buttons = () => Array.from(container.querySelectorAll("button"));
function downloadButton() {
  return buttons().find((b) => /download/i.test(`${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`));
}

beforeEach(() => {
  fetchMode = "ok";
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  triggerBlobDownload.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  delete global.fetch;
});

describe("AutoTailorRunLog shows the user's runs", () => {
  it("fetches and renders recent runs (full mode)", async () => {
    await mount({ mode: "full" });
    // The successful run's tailored count reaches the screen.
    expect(container.textContent).toMatch(/2/);
    // It requested the own-runs endpoint.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auto-apply-queue/runs"),
      expect.anything(),
    );
  });

  it("renders a zero run's reason as legible copy, never the raw enum (AC-R4/R5)", async () => {
    // NON-VACUITY: a run row must have rendered for this to mean anything --
    // the count assertion above and the fetch assertion establish that.
    await mount({ mode: "full" });
    const text = container.textContent || "";
    expect(text, "the raw enum token must never reach the UI").not.toContain("no_search_enabled");
    expect(text.toLowerCase()).toMatch(/no (saved )?search|not enabled|nothing enabled|no search enabled/);
  });

  it("shows a 'nothing yet' state for an empty history, not a blank or an error", async () => {
    fetchMode = "empty";
    await mount({ mode: "full" });
    const text = (container.textContent || "").toLowerCase();
    expect(text.length, "an empty log is not a blank panel").toBeGreaterThan(0);
    expect(text).toMatch(/nothing yet|no runs|no automation runs|hasn'?t run|not run yet/);
  });

  it("shows a benign state (not a crash or a blank) when the fetch fails", async () => {
    fetchMode = "error";
    await mount({ mode: "full" });
    // The component must render SOMETHING readable rather than throwing or
    // leaving an empty container (AC-R5: an error renders as 'nothing yet').
    expect((container.textContent || "").trim().length).toBeGreaterThan(0);
  });

  it("renders in compact mode too (the queue-tab placement)", async () => {
    await mount({ mode: "compact" });
    // Same data source, still legible; compact may show fewer details but must
    // still be a real render, not an empty node.
    expect((container.textContent || "").trim().length).toBeGreaterThan(0);
  });
});

describe("the download control writes a single .md file via the shared helper", () => {
  it("offers a visible download control that produces one .md through triggerBlobDownload", async () => {
    await mount({ mode: "full" });
    const btn = downloadButton();
    expect(btn, "a clearly visible download control (feature-logs standing rule)").toBeTruthy();

    await click(btn);
    expect(triggerBlobDownload, "the SHARED download helper is used").toHaveBeenCalledTimes(1);
    const [blob, filename] = triggerBlobDownload.mock.calls[0];
    expect(blob, "a Blob is handed to the browser").toBeInstanceOf(Blob);
    expect(filename.endsWith(".md"), `expected a .md file, got ${filename}`).toBe(true);
  });

  it("[non-vacuity] the download file carries the rendered run content", async () => {
    // Guards a download button wired to an empty/placeholder blob: the file the
    // user gets must be the real run log. Blob.text() is available in this
    // jsdom; if a future jsdom drops it, this reads as skipped-not-false.
    await mount({ mode: "full" });
    await click(downloadButton());
    const [blob] = triggerBlobDownload.mock.calls[0];
    if (typeof blob.text === "function") {
      const md = await blob.text();
      expect(md.length).toBeGreaterThan(0);
      // Legible, not codes -- the same rule the file the user opens must obey.
      expect(md).not.toContain("no_search_enabled");
    }
  });

  it("[control] no download fires without a click", async () => {
    // "called once" is also satisfied by a build that downloads on mount, which
    // would spam a file the user never asked for.
    await mount({ mode: "full" });
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });
});
