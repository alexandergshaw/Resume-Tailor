// @vitest-environment jsdom
//
// PHASE 1 of AC-back-button-r2 — THE NAVIGATION STACK MODEL.
//
// Criteria covered here: AC-1, AC-2, AC-3, AC-4, AC-5, AC-19, AC-B1a, AC-B1b.
// The button's own rendering (modes, labels, touch floor, focus ring) is
// app/components/BackButton.test.js; the call-site census is
// app/navigation/surfaceStack.sweep.test.js; the header slot and the sticky
// arithmetic are app/components/AppHeader.backButton.test.js.
//
// PHASE 2 IS NOT IN SCOPE AND IS NOT TESTED. Nothing in this file calls
// `history.pushState`, registers a `popstate` listener, or touches
// `lib/activityLog`. AC-1 asserts the OPPOSITE of r1's deleted AC-2: after
// three in-app navigations the browser's history must be byte-for-byte
// untouched. That is the whole point of dropping the mirror (r2 §0), so it is
// asserted rather than assumed.
//
// ---------------------------------------------------------------------------
// THE MODULE CONTRACT THIS FILE PINS (r2 §5, §6.1)
// ---------------------------------------------------------------------------
//
//   app/hooks/useSurfaceNav.js
//     export const SURFACE_FIELDS = ["mainTab", "activeSection"];
//     export function SurfaceNavProvider({ children })
//         Holds the stack. Mounted in app/layout.js ABOVE <AppHeader />, so
//         the header's control and page.js's surfaces share one stack while
//         living in different subtrees — which is why every test below
//         renders <BackButton /> as a SIBLING of the surface host, never as
//         its child.
//     export function useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection })
//         page.js's consumer. Registers the current descriptor and the raw
//         setters with the provider and returns:
//           navigate(partial)  merge `partial` over the current descriptor;
//                              push the CURRENT descriptor and apply the
//                              merged one — unless the merge is equal to the
//                              current descriptor, in which case do nothing.
//           goMainTab(value)   === navigate({ mainTab: value })
//           goSection(value)   === navigate({ activeSection: value })
//
//   app/components/BackButton.js
//     default export, no required props. Renders `data-testid="back-control"`
//     in Back / Exit / Home mode and `data-testid="back-control-spacer"` in
//     the Absent case (r2 §6.3).
//
// The default surface is `{ mainTab: "applying", activeSection: "url" }` —
// page.js:200 and page.js:154's own `useState` initial values, not a number
// invented here.
//
// ---------------------------------------------------------------------------
// WHY `navigate` MUST READ THE CURRENT SURFACE FROM A REF, NOT FROM ITS
// RENDER CLOSURE
// ---------------------------------------------------------------------------
//
// StatusBar.js:278-279 is the shape that forces it:
//
//     setMainTab("manualApplying");
//     setActiveSection(isUrlJob ? "url" : "manual");
//
// Two calls, one gesture, both made from the SAME render's closure with no
// re-render in between. r2 §6.2 row 5 requires that to produce EXACTLY ONE
// stack entry. AC-4a below performs it verbatim — one captured `nav`, two
// synchronous calls — so an implementation that pushes per call, or that
// computes "current" from a stale closure, fails on the observable outcome
// rather than on a structural assertion about how it is written.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, useEffect, useState, act, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SURFACE_FIELDS, SurfaceNavProvider, useSurfaceNav } from "../hooks/useSurfaceNav.js";
import BackButton from "../components/BackButton.js";

// AppHeader mounts BackButton on every route; the control reads the pathname
// to tell the Exit mode from the Home mode (r2 §6.3). Every case in THIS file
// is on "/" — the Exit mode belongs to BackButton.test.js.
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP_DIR = path.join(process.cwd(), "app");

// page.js:294-302's allow-list, verbatim.
const TAB_VALUES = [
  "applying",
  "manualApplying",
  "interviewing",
  "feed",
  "library",
  "experience",
  "copilot",
];

const DEFAULT_SURFACE = { mainTab: "applying", activeSection: "url" };

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
});

// ---------------------------------------------------------------------- harness

// Reproduces `page.js:3049`'s conditional render — `{mainTab === "library" &&
// <LibraryEditor />}` — with a probe standing in for the editor. Its
// `useState(0)` is LibraryEditor.js:28's `const [tab, setTab] = useState(0)`,
// which is the state r2 §4 rules OUT of the descriptor. This is what makes
// AC-B1b observable at all: the real component's sub-tab is unreachable from
// a test, a probe's is not.
function LibraryProbe() {
  const [tab, setTab] = useState(0);
  return createElement(
    Fragment,
    null,
    createElement("span", { "data-testid": "library-tab" }, String(tab)),
    createElement(
      "button",
      { type: "button", "data-testid": "library-tab-to-3", onClick: () => setTab(3) },
      "go to library tab 3",
    ),
  );
}

/**
 * Stands in for `app/page.js`: owns `mainTab` and `activeSection`, routes
 * every mutation through the hook, and carries one NON-surface piece of state
 * (`seed`, standing in for `interviewSearch`) so AC-5 can prove the descriptor
 * does not quietly swallow it.
 */
function SurfaceHost({ apiRef, rehydrate = false }) {
  const [mainTab, setMainTab] = useState(DEFAULT_SURFACE.mainTab);
  const [activeSection, setActiveSection] = useState(DEFAULT_SURFACE.activeSection);
  const [seed, setSeed] = useState("");

  const nav = useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection });
  // Published from an effect rather than the render body: assigning to
  // `apiRef.current` during render trips react-hooks/refs. No dependency array,
  // so every render republishes, and `act()` flushes this before any test reads
  // it -- every read below is already inside `act`.
  useEffect(() => {
    apiRef.current = { nav, setSeed };
  }, [apiRef, nav, setSeed]);

  // page.js:288-313, in the one respect that matters: the localStorage
  // rehydration runs in a MOUNT EFFECT and calls the RAW setters, never
  // `navigate()` (r2 §6.1). AC-19 is what stops an implementation that
  // watches `mainTab` in an effect from turning every cold start into a
  // phantom first entry.
  useEffect(() => {
    if (!rehydrate) return;
    const saved = localStorage.getItem("activeSection");
    if (saved === "url" || saved === "manual" || saved === "screenshots") {
      // Deliberate: this models page.js's cold-start rehydration, which IS a
      // setState inside a mount effect. AC-19 exists to prove that exact shape
      // creates no phantom stack entry, so rewriting it to satisfy the lint rule
      // would delete the thing under test.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveSection(saved);
    }
    const savedTab = localStorage.getItem("mainTab");
    if (TAB_VALUES.includes(savedTab)) {
      // Same as above: the raw setter is the point of the fixture. (No disable
      // needed here -- the rule reports once per effect, on the first setState.)
      setMainTab(savedTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createElement(
    Fragment,
    null,
    createElement("span", { "data-testid": "main-tab" }, mainTab),
    createElement("span", { "data-testid": "active-section" }, activeSection),
    createElement("span", { "data-testid": "seed" }, seed),
    mainTab === "library" && createElement(LibraryProbe),
  );
}

/**
 * The real mount shape: the provider wraps BOTH the header's control and the
 * surface host, and they are siblings. A provider that handed the stack down
 * only to its own subtree would fail every case here.
 */
async function mount({ rehydrate = false } = {}) {
  const apiRef = { current: null };
  await act(async () => {
    root.render(
      createElement(
        SurfaceNavProvider,
        null,
        createElement(BackButton),
        createElement(SurfaceHost, { apiRef, rehydrate }),
      ),
    );
  });
  return apiRef;
}

const read = (testid) => {
  const node = container.querySelector(`[data-testid="${testid}"]`);
  return node ? node.textContent : null;
};

const surface = () => ({ mainTab: read("main-tab"), activeSection: read("active-section") });

const control = () => container.querySelector('[data-testid="back-control"]');
const spacer = () => container.querySelector('[data-testid="back-control-spacer"]');

const labelOfControl = () => {
  const node = control();
  return node ? node.getAttribute("aria-label") : null;
};

async function clickBack() {
  const node = control();
  expect(
    node,
    "no [data-testid=\"back-control\"] to click — the control is absent, so this case cannot " +
      "measure a back press at all. A failed instrument is INVALID, not a zero.",
  ).toBeTruthy();
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// ==========================================================================
// AC-B1a — descriptor purity (r2 §4)
// ==========================================================================

describe("AC-B1a — the descriptor holds only state app/page.js owns", () => {
  // The four components page.js conditionally renders (page.js:3048-3052), so
  // a `mainTab` change UNMOUNTS them and their `useState` initialisers run
  // again on the way back. Any field named after state that lives in one of
  // these cannot be restored, and promising it in the button's label would be
  // a lie the user can see.
  const UNMOUNTING = {
    "copilot/CopilotClient.js": "mode",
    "components/LibraryEditor.js": "tab",
    "components/LiveFeedTab.js": "view",
    "components/experience/ExperienceTab.js": "selectedId",
  };

  const sourceOf = (rel) => readFileSync(path.join(APP_DIR, rel), "utf8");

  /** Every `const [x, setX] = useState(` name declared in a source. */
  function stateNamesIn(src) {
    return [...src.matchAll(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*[A-Za-z_$][\w$]*\s*\]\s*=\s*useState/g)]
      .map((m) => m[1]);
  }

  it("[instrument] the four unmounting components really do declare the state r2 §4 names", () => {
    // Without this, an empty or broken parse would make every exclusion below
    // pass vacuously.
    for (const [rel, expected] of Object.entries(UNMOUNTING)) {
      const names = stateNamesIn(sourceOf(rel));
      expect(names.length, `no useState declarations parsed out of app/${rel}`).toBeGreaterThan(0);
      expect(names, `app/${rel} no longer declares \`${expected}\` as local state`).toContain(expected);
    }
  });

  it("SURFACE_FIELDS is exactly the two fields page.js owns", () => {
    expect(
      SURFACE_FIELDS,
      "r2 §4's ruling is structural: the descriptor may contain ONLY state declared in app/page.js. " +
        "Adding `libraryTab`, `copilotMode`, `feedView` or `experienceSelectedId` here without first " +
        "lifting that state out of its component is the defect this assertion exists to stop.",
    ).toEqual(["mainTab", "activeSection"]);
  });

  it("every SURFACE_FIELDS entry is declared as useState in app/page.js", () => {
    const pageNames = stateNamesIn(sourceOf("page.js"));
    expect(pageNames.length, "no useState declarations parsed out of app/page.js").toBeGreaterThan(20);
    for (const field of SURFACE_FIELDS) {
      expect(
        pageNames,
        `SURFACE_FIELDS names \`${field}\`, but app/page.js declares no \`const [${field}, ...] = useState(\`. ` +
          `A descriptor field page.js does not own cannot be applied on a back press.`,
      ).toContain(field);
    }
  });

  it("no SURFACE_FIELDS entry names state that unmounts on a tab switch", () => {
    const offenders = [];
    for (const rel of Object.keys(UNMOUNTING)) {
      const names = new Set(stateNamesIn(sourceOf(rel)));
      for (const field of SURFACE_FIELDS) {
        if (names.has(field)) offenders.push(`${field} is component-local state in app/${rel}`);
      }
    }
    expect(
      offenders,
      `a descriptor field that lives inside a component page.js conditionally renders is destroyed by ` +
        `the very navigation the stack exists to reverse:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

// ==========================================================================
// AC-1 — Phase 1 writes NO history
// ==========================================================================

describe("AC-1 — three in-app navigations leave the browser's history untouched", () => {
  it("neither history.length nor location.href moves", async () => {
    const apiRef = await mount();
    const lengthBefore = window.history.length;
    const hrefBefore = window.location.href;

    await act(async () => apiRef.current.nav.goMainTab("library"));
    await act(async () => apiRef.current.nav.goMainTab("manualApplying"));
    await act(async () => apiRef.current.nav.goSection("manual"));

    // The control: three navigations really did happen. Without this the
    // history assertions would pass against an implementation that does
    // nothing at all.
    expect(surface()).toEqual({ mainTab: "manualApplying", activeSection: "manual" });

    expect(
      window.history.length,
      "Phase 1 mirrors nothing into the History API. A `pushState` here is Phase 2 (r2 §8), which is " +
        "NOT approved: it drags in a popstate handler, a per-page-load nonce, a 24-overlay predicate " +
        "and surgery on lib/activityLog, none of which the user asked for.",
    ).toBe(lengthBefore);
    expect(
      window.location.href,
      "the URL stays out of it (r2 §6.4) — that is what protects the existing /copilot and /library " +
        "deep links and the localStorage persistence.",
    ).toBe(hrefBefore);
  });
});

// ==========================================================================
// AC-2, AC-3 — push and pop
// ==========================================================================

describe("AC-2 — one navigation pushes one entry, and one back press spends it", () => {
  it("applying → interviewing → back lands on applying with an empty stack", async () => {
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("interviewing"));

    expect(surface().mainTab).toBe("interviewing");
    expect(
      labelOfControl(),
      "with one entry on the stack the control must name where it goes back TO",
    ).toBe("Back to Materials");

    await clickBack();

    expect(surface()).toEqual(DEFAULT_SURFACE);
    expect(
      control(),
      "back to the default surface with the stack spent, the control must be ABSENT (r2 §6.3's " +
        "fourth row) — its presence here means the pop left an entry behind.",
    ).toBeNull();
    expect(spacer(), "the fixed-width spacer must hold the control's place").toBeTruthy();
  });
});

describe("AC-3 — navigating to the surface you are already on pushes nothing", () => {
  it("four clicks on the already-selected tab cannot build a stack of self-entries", async () => {
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("library"));
    await act(async () => apiRef.current.nav.goMainTab("library"));
    await act(async () => apiRef.current.nav.goMainTab("library"));
    await act(async () => apiRef.current.nav.goMainTab("library"));

    expect(surface().mainTab).toBe("library");

    await clickBack();

    expect(
      surface(),
      "one back press after one real navigation and three self-navigations must land on the surface " +
        "before the real one. Landing on `library` means the self-entries were pushed.",
    ).toEqual(DEFAULT_SURFACE);
    expect(control(), "the stack must be empty, not three deep in self-entries").toBeNull();
  });

  it("a section navigation to the already-active section pushes nothing either", async () => {
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("manualApplying"));
    await act(async () => apiRef.current.nav.goSection("url")); // already "url"

    await clickBack();

    expect(surface()).toEqual(DEFAULT_SURFACE);
    expect(control()).toBeNull();
  });
});

// ==========================================================================
// AC-4 — the two-level gesture (StatusBar.goToCard)
// ==========================================================================

describe("AC-4 — StatusBar.goToCard changes two surface fields and produces ONE entry", () => {
  it("two routed setter calls in one gesture, from one captured nav, pop together", async () => {
    // StatusBar.js:278-279 verbatim: both setters are props captured from the
    // same render, invoked back to back with no re-render between them.
    const apiRef = await mount();
    const { nav } = apiRef.current;

    await act(async () => {
      nav.goMainTab("manualApplying");
      nav.goSection("manual");
    });

    expect(
      surface(),
      "both fields must land. An implementation that computes `current` from its render closure " +
        "applies the second call against a stale descriptor and loses the first.",
    ).toEqual({ mainTab: "manualApplying", activeSection: "manual" });

    await clickBack();

    expect(
      surface(),
      "ONE back press must restore BOTH prior values (r2 §6.2 row 5). Landing on " +
        "{manualApplying, url} or {applying, manual} means two entries were pushed for one gesture.",
    ).toEqual(DEFAULT_SURFACE);
    expect(
      control(),
      "a second entry survived the single back press — the gesture produced more than one",
    ).toBeNull();
  });

  it("the same jump written as one navigate() call behaves identically", async () => {
    const apiRef = await mount();
    await act(async () =>
      apiRef.current.nav.navigate({ mainTab: "manualApplying", activeSection: "manual" }),
    );
    expect(surface()).toEqual({ mainTab: "manualApplying", activeSection: "manual" });

    await clickBack();
    expect(surface()).toEqual(DEFAULT_SURFACE);
    expect(control()).toBeNull();
  });
});

// ==========================================================================
// AC-5 — the fourth programmatic jump (useDuplicateApplyCheck)
// ==========================================================================

describe("AC-5 — onOpenApplications changes a surface field AND a non-surface one", () => {
  it("produces exactly one entry, and back does not roll the search seed back", async () => {
    // useDuplicateApplyCheck.js:259-261 sets `setMainTab("interviewing")` and
    // `setInterviewSearch(searchSeed)` in one gesture. Only the first is a
    // surface field, so the descriptor must carry the first and ignore the
    // second — r2 §4's line, observed rather than asserted structurally.
    const apiRef = await mount();
    const { nav, setSeed } = apiRef.current;

    await act(async () => {
      setSeed("acme-corp");
      nav.goMainTab("interviewing");
    });

    expect(surface().mainTab).toBe("interviewing");
    expect(read("seed"), "[instrument] the non-surface state never took the seed").toBe("acme-corp");

    await clickBack();

    expect(surface()).toEqual(DEFAULT_SURFACE);
    expect(
      control(),
      "one gesture, one entry — a second entry here means the non-surface update pushed one of its own",
    ).toBeNull();
    expect(
      read("seed"),
      "the descriptor is {mainTab, activeSection} and nothing else, so a back press must leave " +
        "`interviewSearch` exactly where the user left it. Reverting it would mean the stack is " +
        "silently snapshotting state the label never promised.",
    ).toBe("acme-corp");
  });
});

// ==========================================================================
// AC-19 — rehydration does not push
// ==========================================================================

describe("AC-19 — a cold start from localStorage begins with an EMPTY stack", () => {
  it("restoring mainTab=library leaves the control in Home mode, not Back mode", async () => {
    localStorage.setItem("mainTab", "library");
    await mount({ rehydrate: true });

    expect(surface().mainTab, "[instrument] the rehydration effect never ran").toBe("library");
    expect(
      labelOfControl(),
      "page.js:303's `setMainTab(savedTab)` is a RESTORE, not a navigation. A stack entry here means " +
        "the implementation watches `mainTab` in an effect instead of routing through navigate(), so " +
        "every cold start opens with a phantom entry pointing at `applying` (r2 §6.1).",
    ).toBe("Go to Materials");
  });

  it("the Home mode is itself reversible — it pushes, so back returns to where it started", async () => {
    localStorage.setItem("mainTab", "library");
    await mount({ rehydrate: true });

    await clickBack(); // Home: go to Materials
    expect(surface()).toEqual(DEFAULT_SURFACE);
    expect(
      labelOfControl(),
      "r2 §6.3: the Home mode navigates, so it pushes, so it is itself reversible",
    ).toBe("Back to Library");

    await clickBack();
    expect(surface().mainTab).toBe("library");
    expect(labelOfControl()).toBe("Go to Materials");
  });
});

// ==========================================================================
// AC-B1b — the tab-0 case, observed directly
// ==========================================================================

describe("AC-B1b — the documented limit of the restored descriptor, made visible", () => {
  it("back to Library restores Library, and the library's own sub-tab resets to 0", async () => {
    localStorage.setItem("mainTab", "library");
    const apiRef = await mount({ rehydrate: true });

    expect(read("library-tab"), "[instrument] the library branch did not render").toBe("0");

    await act(async () => {
      container
        .querySelector('[data-testid="library-tab-to-3"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(
      read("library-tab"),
      "[instrument] the probe's sub-tab never moved to 3, so the case below would prove nothing",
    ).toBe("3");

    await act(async () => apiRef.current.nav.goMainTab("applying"));
    expect(
      container.querySelector('[data-testid="library-tab"]'),
      "[instrument] the conditional render did not unmount the library branch — this case only has " +
        "teeth because page.js:3049's `{mainTab === \"library\" && …}` really is an unmount",
    ).toBeNull();

    await clickBack();

    expect(
      surface().mainTab,
      "(i) the descriptor's own field must be restored — this half is the feature working",
    ).toBe("library");
    expect(
      read("library-tab"),
      "(ii) THE DOCUMENTED LIMIT (r2 §4): `libraryTab` lives in LibraryEditor.js:28, inside a " +
        "component page.js unmounts on every tab change, so it is NOT in the descriptor and NOT " +
        "restored. Reading 3 here means an implementation is seeding component-local state it " +
        "promised not to touch — which is Phase 2 work (r2 §8.6) requiring four component " +
        "contracts to be lifted first, and which AC-B1a forbids structurally.",
    ).toBe("0");
  });
});
