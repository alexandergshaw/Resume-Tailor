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
