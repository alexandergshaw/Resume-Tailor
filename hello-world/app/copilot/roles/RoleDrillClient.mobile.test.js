// @vitest-environment jsdom
//
// MOBILE-G F-06 — "Speak as" mounts the FULL-size self-view at every width,
// where practice mode has mounted a compact one below `md` since its own
// mobile pass (PracticeClient.js:815-819, CameraPreview.js:11-17).
//
// WHAT WAS MEASURED, AND WHERE. jsdom has no layout engine, so nothing here
// measures a rendered height. The heights below were measured in a REAL
// browser (Chrome, Manrope loaded, the component's own serialized emotion CSS
// and DOM, `md`/`sm` media rules forced to match the emulated width so no
// desktop branch leaked in, root gutters `p: { xs: 1.5 }` = 12px from
// CopilotClient.js:564). `dvh` caps were read as a percentage of the pane's
// real height and rescaled to an 812px viewport:
//
//     roles mode today       351px wide x 365.4px tall   45dvh — 45% of the viewport
//     roles mode w/ compact  351px wide x 211.1px tall   26dvh — 26%
//     saving                                154.3px
//
// 365px of self-view is the largest single block on the "Speak as" screen at
// 375x812, sitting between the recording controls and the transcript. Note
// the width does NOT collapse the way practice mode's does: RoleDrillClient's
// row is a `Stack` with `alignItems: "stretch"` (RoleDrillClient.js:205), so
// the panel is a flex item stretched to the full 351px and only its height is
// clamped, whereas practice mode's compact instance is a block child whose
// clamped height transfers back through `aspect-ratio: 3/4` to a ~158px
// width. Roles mode therefore gets the better of the two compact renderings.
//
// WHAT THIS FILE PROVES is which cap the panel actually receives, per
// breakpoint bucket, read back through the serialized cascade. `useIsTablet`
// is a `useMediaQuery(down("md"))` call answered by `window.matchMedia` — it
// never touches a stylesheet, so `atWidth` cannot drive it (see
// computedStyleAtWidth.js's own LIMIT note) and it is mocked instead. The two
// halves are then read at the width that bucket actually covers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";

vi.mock("@/lib/copilot/roleDrillClient", () => ({
  fetchRoleSituation: vi.fn(),
  fetchRoleResponse: vi.fn(),
}));

// Hoisted so each case can set the bucket before mounting. `useIsMobile` is
// re-exported unchanged: this module is shared, and stubbing only the half
// under test would hand any future caller of the other half a silent `false`.
const responsive = vi.hoisted(() => ({ isTablet: false }));
vi.mock("@/app/hooks/useResponsive", () => ({
  useIsTablet: () => responsive.isTablet,
  useIsMobile: () => false,
}));

import RoleDrillClient from "./RoleDrillClient.js";
import { fetchRoleSituation } from "@/lib/copilot/roleDrillClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

async function render(isTablet) {
  responsive.isTablet = isTablet;
  await act(async () => {
    root.render(
      createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(RoleDrillClient, {})),
    );
  });
}

// The self-view with no stream takes the "No camera — audio only" branch,
// which carries the same panelSx as the video branch (CameraPreview.js:87 vs
// :96) and is the only node in this tree with that text.
function cameraPanel() {
  return [...container.querySelectorAll("div")].find((el) => el.textContent === "No camera — audio only");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Never resolves: the situation fetch is irrelevant here, and leaving it
  // pending keeps this mount free of act() warnings from a late resolution.
  fetchRoleSituation.mockImplementation(() => new Promise(() => {}));
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

describe("F-06: 'Speak as' uses the compact self-view below md", () => {
  it("[control] mounts exactly one self-view in each bucket — never two <video> against one stream", async () => {
    await render(true);
    expect([...container.querySelectorAll("div")].filter((el) => el.textContent === "No camera — audio only")).toHaveLength(1);
    await render(false);
    expect([...container.querySelectorAll("div")].filter((el) => el.textContent === "No camera — audio only")).toHaveLength(1);
  });

  it("below md the self-view takes the compact cap — 26dvh, not 45dvh", async () => {
    await render(true);
    const panel = cameraPanel();
    expect(panel, "self-view not found").toBeTruthy();
    expect(atWidth(375, () => window.getComputedStyle(panel).maxHeight)).toBe("26dvh");
  });

  it("at md and up the full-size self-view is unchanged — 62vh, the desktop cap", async () => {
    await render(false);
    const panel = cameraPanel();
    expect(panel, "self-view not found").toBeTruthy();
    // The whole point of gating on `useIsTablet` rather than passing `compact`
    // unconditionally: the desktop rendering of this mode must not move.
    expect(atWidth(1000, () => window.getComputedStyle(panel).maxHeight)).toBe("62vh");
  });
});
