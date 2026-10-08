// @vitest-environment jsdom
//
// N144a T2 — the CollapsibleAid shared disclosure (docs/loop/N144a.plan.r1.md
// §3, ledger L4/L7/L8/L9/L10/L16). This is the component every answer aid will
// discolse through; the AnswerAids-level tests (T3) ride on it being right.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. jsdom has NO layout: getBoundingClientRect
// is zeros and no box is laid out, so nothing here asserts geometry (real tap
// size and footprint are the owner/browser pass, §8 G1/G2). What jsdom 29 DOES
// do is render the real component, expose the accessibility DOM, and run a real
// CSS cascade — so this file asserts DECLARED STRUCTURE (button/aria/mount) and
// DECLARED-VALUE cascade (min-height/width via atWidth), which are the
// properties that actually encode the contract.
//
// THE VIEWPORT STUB IS LOAD-BEARING. jsdom implements no matchMedia at all, so
// without this stub useIsMobile() is permanently false and every section would
// look "open" — the mobile branch would be invisible (plan §5/§6). The stub
// answers the real `(max-width:599.95px)` query MUI builds from a settable
// width. MUI memoises the MediaQueryList per hook instance, so the width is set
// BEFORE each mount and a different width means a fresh mount (plan §7.2).
//
// Headers are looked up BY ACCESSIBLE NAME, never by a `button[aria-expanded]`
// count — that generic selector is the hazard the dashboard suites already
// carry (plan §5).
//
// RED on HEAD: app/copilot/CollapsibleAid.js and lib/copilot/aidDisclosure.js
// do not exist, so the imports throw and the file fails to load. Intended red:
// the component is absent.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";

import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx";
import { createChoiceStore, resetAllChoiceStores } from "@/lib/copilot/choiceStore.js";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";
import CollapsibleAid from "./CollapsibleAid.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport emulation (copied shape from FormDialog.mobile.test.js) --------
const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = PHONE;

function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}

window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

const BODY = "aid-body-marker";
const LABEL = "Example projects (invented)";

// Accessible name with aria-hidden subtrees (the ▾/▸ glyph) stripped — the
// precedent helper from RoleDrillClient.contract.test.js. `button.textContent`
// alone would include the glyph.
function accessibleName(el) {
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  return (clone.textContent || "").trim();
}

let container;
let root;

beforeEach(() => {
  resetAllChoiceStores();
  try {
    localStorage.clear();
  } catch {
    /* memory-authoritative anyway */
  }
  viewportWidth = PHONE;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function makeStore(key = "copilot-test-aid") {
  const store = createChoiceStore({
    storageKey: key,
    defaultValue: null,
    normalize: (v) => (v === "open" || v === "closed" ? v : null),
    crossWindow: true,
  });
  store.hydrate();
  return store;
}

async function mount({ store, width = viewportWidth, defaultOpenOnMobile, labelledGroup, label = LABEL, body = BODY } = {}) {
  viewportWidth = width;
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(
          CollapsibleAid,
          { label, choiceStore: store, defaultOpenOnMobile, labelledGroup },
          createElement("p", null, body),
        ),
      ),
    );
  });
}

const header = (label = LABEL) =>
  [...container.querySelectorAll("button")].find((b) => accessibleName(b) === label);
const panelOf = (hdr) => {
  const id = hdr.getAttribute("aria-controls");
  return id ? container.querySelector(`#${CSS.escape(id)}`) : null;
};
async function click(el) {
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

// ---------------------------------------------------------------------------
// C1 — the header is a real native button named by its static label.
// ---------------------------------------------------------------------------
describe("C1: header is a native button whose accessible name is the static label", () => {
  it("renders a BUTTON type=button named exactly the label (glyph excluded)", async () => {
    await mount({ store: makeStore() });
    const hdr = header();
    expect(hdr, "a header button named by the label").toBeTruthy();
    expect(hdr.tagName).toBe("BUTTON");
    expect(hdr.getAttribute("type")).toBe("button");
    // The name is the label alone — the ▾/▸ glyph is in an aria-hidden span and
    // the name does NOT swap between Show/Hide (that double-signals with
    // aria-expanded; mui-a11y-traps / L8).
    expect(accessibleName(hdr)).toBe(LABEL);
  });
});

// ---------------------------------------------------------------------------
// C2/C3 — aria-expanded reflects state; aria-controls resolves in BOTH states
// to an always-mounted panel; body mounts only when open.
// ---------------------------------------------------------------------------
describe("C2/C3: aria-expanded, the always-mounted panel, and body mount/unmount", () => {
  it("open (desktop default): expanded=true, panel holds the body", async () => {
    await mount({ store: makeStore(), width: DESKTOP });
    const hdr = header();
    expect(hdr.getAttribute("aria-expanded")).toBe("true");
    const panel = panelOf(hdr);
    expect(panel, "aria-controls resolves to a real element").not.toBeNull();
    expect(panel.textContent).toContain(BODY);
  });

  it("collapsed (phone default): expanded=false, body is UNMOUNTED but the panel still resolves", async () => {
    await mount({ store: makeStore(), width: PHONE });
    const hdr = header();
    expect(hdr.getAttribute("aria-expanded")).toBe("false");
    // The body is out of the DOM entirely — not merely hidden with CSS (L9).
    expect(container.textContent).not.toContain(BODY);
    // aria-controls must still resolve so it is never a dangling reference.
    const panel = panelOf(hdr);
    expect(panel, "the panel wrapper is mounted even while collapsed").not.toBeNull();
    expect(panel.textContent).not.toContain(BODY);
  });
});

// ---------------------------------------------------------------------------
// C4 — the breakpoint default. The 600 boundary, NOT 900. Needs the stub.
// ---------------------------------------------------------------------------
describe("C4: default collapsed below 600, open from 600 up (the 600 boundary, not 900)", () => {
  for (const w of [375, 599]) {
    it(`collapsed at ${w}px with nothing stored`, async () => {
      await mount({ store: makeStore(), width: w });
      expect(header().getAttribute("aria-expanded")).toBe("false");
    });
  }
  for (const w of [600, 700, 1200]) {
    it(`open at ${w}px with nothing stored (700 is the useIsTablet mutant's grave)`, async () => {
      await mount({ store: makeStore(), width: w });
      expect(header().getAttribute("aria-expanded")).toBe("true");
    });
  }
  it("defaultOpenOnMobile=true is open even at 375", async () => {
    await mount({ store: makeStore(), width: 375, defaultOpenOnMobile: true });
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// C5 — a tap writes the OPPOSITE of the effective state and persists.
// ---------------------------------------------------------------------------
describe("C5: a tap toggles, writes the opposite of the effective state, and is read back on remount", () => {
  it("tapping a collapsed phone section opens it and stores 'open'", async () => {
    const store = makeStore();
    await mount({ store, width: PHONE });
    const hdr = header();
    expect(hdr.getAttribute("aria-expanded")).toBe("false");
    await click(hdr);
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain(BODY);
    expect(store.get()).toBe("open");

    // Remount at the SAME width: the stored choice wins, the section stays open.
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount({ store, width: PHONE });
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });

  it("tapping an open desktop section closes it and stores 'closed'", async () => {
    const store = makeStore();
    await mount({ store, width: DESKTOP });
    await click(header());
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(store.get()).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// C6 — NOTHING is written on mount (so a later release can change the default).
// ---------------------------------------------------------------------------
describe("C6: a mount writes nothing to storage or the store", () => {
  it("store stays null and the key is absent after a collapsed phone mount", async () => {
    const store = makeStore("copilot-c6-phone");
    await mount({ store, width: PHONE });
    expect(store.get()).toBeNull();
    expect(localStorage.getItem("copilot-c6-phone")).toBeNull();
  });

  it("store stays null and the key is absent after an open desktop mount", async () => {
    const store = makeStore("copilot-c6-desktop");
    await mount({ store, width: DESKTOP });
    expect(store.get()).toBeNull();
    expect(localStorage.getItem("copilot-c6-desktop")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C7 — an explicit stored choice wins over the breakpoint default.
// ---------------------------------------------------------------------------
describe("C7: a stored choice overrides the breakpoint default", () => {
  it("stored 'open' is open even on a phone", async () => {
    const store = makeStore();
    store.set("open");
    await mount({ store, width: PHONE });
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });

  it("stored 'closed' is closed even on desktop", async () => {
    const store = makeStore();
    store.set("closed");
    await mount({ store, width: DESKTOP });
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// C8 — one store drives every instance of it; two stores are independent.
// (The key-reuse mutant — tech wired to the examples store — dies here.)
// ---------------------------------------------------------------------------
describe("C8: instances sharing a store move together; separate stores do not cross-talk", () => {
  async function mountTwo(storeA, storeB) {
    viewportWidth = DESKTOP;
    await act(async () => {
      root.render(
        createElement(
          ThemeProvider,
          { theme: makeTheme("light") },
          createElement(
            "div",
            null,
            createElement(CollapsibleAid, { label: "Section A", choiceStore: storeA }, createElement("p", null, "body-A")),
            createElement(CollapsibleAid, { label: "Section B", choiceStore: storeB }, createElement("p", null, "body-B")),
          ),
        ),
      );
    });
  }

  it("two instances of ONE store both reflect a single toggle", async () => {
    const shared = makeStore("copilot-c8-shared");
    await mountTwo(shared, shared);
    const [a, b] = [...container.querySelectorAll("button")];
    expect(a.getAttribute("aria-expanded")).toBe("true");
    expect(b.getAttribute("aria-expanded")).toBe("true");
    await click(a);
    expect(a.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });

  it("two DIFFERENT stores are independent (no shared module state — FD-1)", async () => {
    const storeA = makeStore("copilot-c8-a");
    const storeB = makeStore("copilot-c8-b");
    await mountTwo(storeA, storeB);
    const [a, b] = [...container.querySelectorAll("button")];
    await click(a);
    expect(a.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(storeA.get()).toBe("closed");
    expect(storeB.get()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C9 — labelledGroup wraps in role=group named by the header; default does not.
// ---------------------------------------------------------------------------
describe("C9: role=group only when labelledGroup is set", () => {
  it("labelledGroup -> a role=group whose aria-labelledby resolves to the header", async () => {
    await mount({ store: makeStore(), width: DESKTOP, labelledGroup: true });
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    const labelledBy = group.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const named = container.querySelector(`#${CSS.escape(labelledBy)}`);
    expect(named).not.toBeNull();
    expect(accessibleName(named)).toBe(LABEL);
  });

  it("default (no labelledGroup) -> no role=group wrapper", async () => {
    await mount({ store: makeStore(), width: DESKTOP });
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C10 — the component introduces no heading, live region, status or aria-busy.
// (The "move the live region / add aria-busy to the panel" mutant dies here
// and in T3; a heading here would break heading order, R-125.)
// ---------------------------------------------------------------------------
describe("C10: no heading, no live region, no status, no aria-busy of its own", () => {
  it("open and collapsed both carry none of them", async () => {
    for (const width of [PHONE, DESKTOP]) {
      await act(async () => root.unmount());
      root = createRoot(container);
      await mount({ store: makeStore(`copilot-c10-${width}`), width, labelledGroup: true });
      expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
      expect(container.querySelector("[aria-live]")).toBeNull();
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// C11 — the touch floor comes from the shared token, phone-scoped.
// DECLARED-VALUE cascade via atWidth (geometry is the owner pass, G2).
// ---------------------------------------------------------------------------
describe("C11: header min-height 44 at 375 / auto at 1000, width 100% at 375 / auto at 1000", () => {
  const read = (el, prop, width) => atWidth(width, () => window.getComputedStyle(el)[prop]);

  it("[control] a plain Button without the token does NOT read a 44px floor at 375", async () => {
    // Proves the measurement discriminates: the 44px below is the token, not
    // something every control in the tree happens to carry.
    viewportWidth = DESKTOP;
    await act(async () => {
      root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Button, null, "plain")));
    });
    const plain = container.querySelector("button");
    expect(read(plain, "minHeight", 375)).not.toBe(`${MOBILE_TAP_MIN}px`);
  });

  it("the header carries the phone-scoped 44px floor and full-width tap row", async () => {
    await mount({ store: makeStore(), width: DESKTOP });
    const hdr = header();
    expect(read(hdr, "minHeight", 375)).toBe(`${MOBILE_TAP_MIN}px`);
    expect(read(hdr, "minHeight", 1000)).toBe("auto");
    expect(read(hdr, "width", 375)).toBe("100%");
    expect(read(hdr, "width", 1000)).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// C12 — a storage write failure does not break the in-memory toggle.
// ---------------------------------------------------------------------------
describe("C12: toggling still works when localStorage.setItem throws", () => {
  it("flips aria-expanded in memory under a throwing setItem", async () => {
    const store = makeStore("copilot-c12");
    await mount({ store, width: PHONE });
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      await click(header());
      expect(header().getAttribute("aria-expanded")).toBe("true");
      expect(store.get()).toBe("open");
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Source scans (comment-stripped). Spelling, not behaviour — paired with the
// DOM cases above. CANARY: the file must actually load and read as source.
// ---------------------------------------------------------------------------
describe("source scan: the shared token, no Tooltip/Collapse/order/aria-live/hand-rolled floor", () => {
  const SRC = () => stripComments(readFileSync(path.resolve(process.cwd(), "app/copilot/CollapsibleAid.js"), "utf8"));

  it("[canary] the source is present and is the component", () => {
    const src = SRC();
    expect(src).toContain("export default");
    expect(src).toContain("CollapsibleAid");
  });

  it("imports TOUCH_TARGET_SX from the shared theme module and spells no hand-rolled floor", () => {
    const src = SRC();
    expect(src).toContain("TOUCH_TARGET_SX");
    expect(src).toContain('from "@/app/theme/mobileSx"');
    // A literal minHeight/"44px" would satisfy C11 while re-opening the drift
    // the shared module exists to end (same ruling as SampleAnswer.touch).
    expect(src).not.toContain("minHeight");
    expect(src).not.toContain('"44px"');
  });

  it("uses no Tooltip, no Collapse, no CSS order, and declares no aria-live", () => {
    const src = SRC();
    expect(src).not.toMatch(/\bTooltip\b/);
    expect(src).not.toMatch(/\bCollapse\b/);
    expect(src).not.toMatch(/\border:\s*\d/);
    expect(src).not.toMatch(/aria-live/);
  });
});
