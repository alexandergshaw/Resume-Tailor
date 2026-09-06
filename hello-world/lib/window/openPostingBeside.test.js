import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  openPostingBeside,
  openBlankBeside,
  navigateBeside,
  isOpenBesideEnabled,
  setOpenBesideEnabled,
} from "./openPostingBeside.js";

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  const popup = { closed: false, opener: {}, focus: vi.fn(), moveTo: vi.fn(), resizeTo: vi.fn() };
  global.window = {
    localStorage: makeStore(),
    screen: { availLeft: 0, availTop: 0, availWidth: 1600, availHeight: 900 },
    moveTo: vi.fn(),
    resizeTo: vi.fn(),
    open: vi.fn(() => popup),
  };
  // expose for assertions
  global.__popup = popup;
});

describe("preference helpers", () => {
  it("defaults to enabled", () => {
    expect(isOpenBesideEnabled()).toBe(true);
  });

  it("persists a disabled preference", () => {
    setOpenBesideEnabled(false);
    expect(isOpenBesideEnabled()).toBe(false);
    setOpenBesideEnabled(true);
    expect(isOpenBesideEnabled()).toBe(true);
  });
});

describe("openPostingBeside", () => {
  it("returns null and does nothing for an empty url", () => {
    expect(openPostingBeside("")).toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("docks the app left and opens the popup on the right half", () => {
    const result = openPostingBeside("https://example.com/job");
    expect(window.moveTo).toHaveBeenCalledWith(0, 0);
    expect(window.resizeTo).toHaveBeenCalledWith(800, 900);
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/job",
      "_blank",
      "popup=1,width=800,height=900,left=800,top=0",
    );
    expect(result).toBe(global.__popup);
    expect(global.__popup.resizeTo).toHaveBeenCalledWith(800, 900);
    expect(global.__popup.moveTo).toHaveBeenCalledWith(800, 0);
    expect(global.__popup.focus).toHaveBeenCalled();
    expect(global.__popup.opener).toBeNull();
  });

  it("respects multi-monitor availLeft/availTop", () => {
    window.screen = { availLeft: 1920, availTop: 24, availWidth: 1280, availHeight: 720 };
    openPostingBeside("https://example.com/job");
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/job",
      "_blank",
      "popup=1,width=640,height=720,left=2560,top=24",
    );
    expect(global.__popup.moveTo).toHaveBeenCalledWith(2560, 24);
  });

  it("continues opening even if moveTo/resizeTo throw", () => {
    window.moveTo = vi.fn(() => {
      throw new Error("blocked");
    });
    const result = openPostingBeside("https://example.com/job");
    expect(window.open).toHaveBeenCalled();
    expect(result).toBe(global.__popup);
  });

  it("returns null when the popup is blocked", () => {
    window.open = vi.fn(() => null);
    expect(openPostingBeside("https://example.com/job")).toBeNull();
  });

  it("falls back to a plain new tab when the preference is disabled", () => {
    setOpenBesideEnabled(false);
    openPostingBeside("https://example.com/job");
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/job",
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.moveTo).not.toHaveBeenCalled();
  });

  it("falls back to a plain new tab when forceNewTab is set", () => {
    openPostingBeside("https://example.com/job", { forceNewTab: true });
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/job",
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.moveTo).not.toHaveBeenCalled();
  });
});

describe("openBlankBeside / navigateBeside", () => {
  it("opens a positioned blank popup without a url", () => {
    const popup = openBlankBeside();
    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "popup=1,width=800,height=900,left=800,top=0",
    );
    expect(popup).toBe(global.__popup);
  });

  it("returns null from openBlankBeside when the preference is disabled", () => {
    setOpenBesideEnabled(false);
    expect(openBlankBeside()).toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("navigateBeside points an open popup at the url and focuses it", () => {
    const popup = { closed: false, focus: vi.fn(), location: { href: "" } };
    expect(navigateBeside(popup, "https://example.com/job")).toBe(true);
    expect(popup.location.href).toBe("https://example.com/job");
    expect(popup.focus).toHaveBeenCalled();
  });

  it("navigateBeside returns false for a missing or closed popup", () => {
    expect(navigateBeside(null, "https://example.com/job")).toBe(false);
    expect(navigateBeside({ closed: true }, "https://example.com/job")).toBe(false);
  });
});

// --------------------------------------------------------------------------
// `positions.url` is attacker-reachable: `public.positions` has no `user_id`
// column and its update policy is `auth.role() = 'authenticated'`, so any
// signed-in account can overwrite any row's `url` (see
// lib/url/safeExternalHref.js for the full writeup and the anchor-side half
// of this fix, eb654d5). `window.open` and `popup.location.href =` have no
// framework filter in front of them the way React's `<a href>` does, so this
// module - the only thing standing between that column and a real browser
// navigation - must run every url through the same `safeExternalHref` used
// for anchors before it ever reaches `window.open` or a popup's `location`.
//
// The three shapes below are the ones that separate a correct implementation
// from `raw.startsWith("https://")`, per safeExternalHref.test.js. `data:`
// and a whitespace-padded url are included because they are two of the
// concrete schemes/forms measured to sail straight through React's own
// anchor handling untouched.
const UNSAFE_URLS = [
  ["https://acme.com@evil.example/x", "userinfo that reads as the real host"],
  ["https://user:pw@evil.example/x", "user:password before the real host"],
  ["https://", "an https url with an empty hostname"],
  ["data:text/html,<script>alert(1)</script>", "a data: url"],
  ["  https://acme.com/x  ", "a url with surrounding whitespace"],
];

describe("openPostingBeside refuses an unsafe posting url", () => {
  beforeEach(() => {
    window.alert = vi.fn();
  });

  for (const [url, label] of UNSAFE_URLS) {
    it(`never calls window.open for ${label}`, () => {
      openPostingBeside(url);
      expect(window.open).not.toHaveBeenCalled();
    });

    it(`does not fall back to a plain new tab for ${label} (forceNewTab)`, () => {
      // The forceNewTab / opted-out branch calls window.open directly; a
      // validation check placed only in the docked-popup branch would miss
      // this path entirely and still open the url.
      openPostingBeside(url, { forceNewTab: true });
      expect(window.open).not.toHaveBeenCalled();
    });

    it(`tells the user the link was refused, for ${label}`, () => {
      openPostingBeside(url);
      expect(window.alert).toHaveBeenCalledTimes(1);
    });

    it(`returns a truthy, non-popup result for ${label} so callers' own` +
      ` "if (!opened) window.open(url, ...)" fallback does not re-open it`, () => {
      const result = openPostingBeside(url);
      // Every caller of openPostingBeside (AutoApplyQueueTab.js,
      // LiveFeedTab.js, app/page.js) writes exactly this fallback to
      // downgrade a browser-blocked popup to a plain tab. `null` has to mean
      // "blocked, please retry raw" for THAT case to keep working, so an
      // unsafe url must come back truthy instead - otherwise refusing it
      // here is undone one line later, in a file this fix cannot edit.
      expect(result).toBeTruthy();
      expect(result).not.toBe(global.__popup);
    });
  }

  it("still opens a safe https url exactly as before", () => {
    const result = openPostingBeside("https://example.com/job");
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/job",
      "_blank",
      "popup=1,width=800,height=900,left=800,top=0",
    );
    expect(result).toBe(global.__popup);
  });
});

describe("navigateBeside refuses an unsafe posting url", () => {
  beforeEach(() => {
    window.alert = vi.fn();
  });

  for (const [url, label] of UNSAFE_URLS) {
    it(`does not navigate the popup for ${label}`, () => {
      const popup = { closed: false, focus: vi.fn(), close: vi.fn(), location: { href: "" } };
      navigateBeside(popup, url);
      expect(popup.location.href).toBe("");
    });

    it(`closes the preset blank popup rather than leaving it dangling, for ${label}`, () => {
      const popup = { closed: false, focus: vi.fn(), close: vi.fn(), location: { href: "" } };
      navigateBeside(popup, url);
      expect(popup.close).toHaveBeenCalled();
    });

    it(`tells the user the link was refused, for ${label}`, () => {
      const popup = { closed: false, focus: vi.fn(), close: vi.fn(), location: { href: "" } };
      navigateBeside(popup, url);
      expect(window.alert).toHaveBeenCalledTimes(1);
    });

    it(`returns true for ${label} so the caller's "if (!navigated)" fallback` +
      ` does not retry the same url through openPostingBeside/window.open`, () => {
      // app/page.js's applyAutoTailoredRow does exactly this:
      //   const navigated = navigateBeside(presetPopup, url);
      //   if (!navigated) { const opened = openPostingBeside(url); if (!opened) window.open(url, ...); }
      // navigateBeside cannot truthfully report success, but it MUST report
      // "handled" - false here re-enters the very chain this fix closes,
      // in a file (app/page.js) outside this change's scope.
      const popup = { closed: false, focus: vi.fn(), close: vi.fn(), location: { href: "" } };
      expect(navigateBeside(popup, url)).toBe(true);
    });
  }

  it("still navigates for a safe https url exactly as before", () => {
    const popup = { closed: false, focus: vi.fn(), close: vi.fn(), location: { href: "" } };
    expect(navigateBeside(popup, "https://example.com/job")).toBe(true);
    expect(popup.location.href).toBe("https://example.com/job");
    expect(popup.focus).toHaveBeenCalled();
  });
});
