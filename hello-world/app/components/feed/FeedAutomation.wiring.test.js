// @vitest-environment jsdom
//
// N60 S8 (THE DANGEROUS STEP) -- the acceptance tests that must land RED as the
// hand-off for making unattended auto-tailoring reachable by a real user.
// AC-R2 (the control works when rendered and clicked), AC-R3 (enabling states
// its cost behind a confirm), AC-E5's UI half (an unconfigured sender makes the
// control unavailable, never a silent no-op), and a companyResearchAccept-style
// CLASS guard so a new automation prop cannot be left unbound.
//
// -------------------------------------------------------------------------
// WHY RENDER-AND-CLICK AND NOT A SOURCE SCAN. This is the whole point of S8.
// `app/page.js:873-899` (`setSavedSearchAutoTailor`) ALREADY builds a PUT body
// carrying `autoTailorEnabled`/`autoTailorDailyCap`, and the sanitizer
// (`lib/savedSearch/savedSearchFields.js:113-118`) already accepts and persists
// them. So a source scan for "is the field settable from a request body" is
// GREEN at HEAD -- satisfied entirely by plumbing NO CONTROL DRIVES. The AC's
// own 0.3 says so: "A source scan can be satisfied by unreachable code."
// The last hop that is actually missing -- the repo's single most-repeated
// defect -- is a rendered control a user can click. That is what this file
// mounts and clicks. A handler or prop-spy call would NOT satisfy the
// reachability criterion; we drive the shipped toolbar the way a person does.
//
// WHAT IS RED AT HEAD, AND WHY. At HEAD `LiveFeedTab` has exactly two views,
// "feed" and "queue" (LiveFeedTab.js:65), reached from FeedToolbar's two-button
// group (FeedToolbar.js). There is no third "Automation" view and no
// per-search auto-tailor enable control anywhere. Every case below therefore
// fails at HEAD because the control it drives does not exist. Each case says,
// in its own comment, the wrong-reason failure it is paired against.
//
// jsdom LIMITS (measurement-instruments memory): no layout, and MUI Dialog
// portals to document.body -- so the confirm dialog is found by scanning the
// document, not the mount container.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import LiveFeedTab from "../LiveFeedTab.js";
// The confirm copy's number is bound to the SAME constant the cron enforces,
// never a literal typed into this test (AC-R3 / risk R-08). If the ceiling
// moves, the copy this asserts against moves with it.
import { MAX_TAILORS_PER_USER_PER_UTC_DAY } from "../../../lib/feed/autoTailorBounds.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport ---------------------------------------------------------------
// The Automation view is a sibling of the queue tab, OUTSIDE the filter sheet,
// so viewport does not gate it. We render desktop-width to keep the tree simple.
let viewportWidth = 1200;
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

// --- network ----------------------------------------------------------------
const PROFILE = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };

// A SERVER-BACKED saved search: its id is a UUID-shaped string, not the "ss-"
// prefix a local-only search carries. Only server-backed searches can be
// auto-tailored (a local search has no row for the cron to read).
function serverSearch(overrides = {}) {
  return {
    id: "srv-1",
    name: "Backend roles",
    emailOnNewJobs: false,
    autoTailorEnabled: false,
    autoTailorDailyCap: 10,
    ...overrides,
  };
}

let emailConfigured; // toggled per test for AC-E5
let statusReason;

const json = (body) => Promise.resolve({ ok: true, json: async () => body });

function installFetch() {
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url);
    if (u.startsWith("/api/alerts/status")) {
      return json({ emailConfigured, reason: statusReason, alertsPaused: false });
    }
    if (u.startsWith("/api/auto-apply-queue")) return json({ items: [] });
    if (u.startsWith("/api/user-profile")) return json({ profile: PROFILE });
    if (u.startsWith("/api/saved-searches/unviewed-counts")) return json({ counts: {} });
    if (u.startsWith("/api/saved-searches")) {
      const body = init.body ? JSON.parse(init.body) : {};
      return json({ search: { id: "srv-1", name: body.name, job_keywords: body.jobKeywords || [] } });
    }
    if (u.startsWith("/api/feed")) {
      return json({ items: [], nextCursor: null, lastUpdatedAt: "2026-09-07T12:00:00.000Z", sourceHealth: {} });
    }
    return json({});
  });
}

// --- mount ------------------------------------------------------------------
let container;
let root;
let setAutoTailorSpy;

function props(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    savedSearches: [serverSearch()],
    setSavedSearches: () => {},
    // Production: app/page.js:2824 passes the real PUT-issuing function here.
    // We spy on it: "toggling it sends the field" is asserted as this being
    // called with { autoTailorEnabled: true }. That the function then PUTs is
    // already covered by savedSearchFields.test.js + the [id] route.
    setSavedSearchAutoTailor: setAutoTailorSpy,
    deleteSavedSearch: () => {},
    GREENHOUSE_COMPANIES: [],
    COMPANY_CATEGORIES: [],
    onTailor: async () => "",
    canTailor: true,
    ...overrides,
  };
}

async function mount(overrides) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme }, createElement(LiveFeedTab, props(overrides))));
  });
  // The initial /api/feed load is behind a 300ms debounce; real timers (the tab
  // owns a 30s tick and a 60s refresh, so a fake clock re-enters the fetch).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
}

async function click(el) {
  await act(async () => {
    el.click();
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 500));
  });
}

function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  return (el.textContent || "").trim();
}
const buttons = () => Array.from(document.querySelectorAll("button"));
const named = (re) => buttons().find((b) => re.test(accessibleName(b)));

// Move to the Automation view by clicking the toolbar's third view button the
// way a user does. Returns the button (or undefined at HEAD, where it does not
// exist -- callers assert on that).
async function openAutomation() {
  const btn = named(/automation/i);
  if (btn) await click(btn);
  return btn;
}

// The per-search auto-tailor ENABLE control. MUI FormControlLabel renders a
// <label> wrapping the Switch's checkbox input; we find the label whose text
// names auto-tailoring (distinct from the "Email me new jobs" toggle) and take
// its checkbox. Returns null when no such control is rendered.
function autoTailorSwitch() {
  const label = Array.from(document.querySelectorAll("label")).find(
    (l) => /auto.?tailor/i.test(l.textContent || ""),
  );
  return label ? label.querySelector('input[type="checkbox"]') : null;
}

// The confirm dialog MUI portals to <body> after the enable switch is clicked.
function topDialog() {
  const all = Array.from(document.querySelectorAll('[role="dialog"]'));
  return all.length > 0 ? all[all.length - 1] : null;
}

beforeEach(() => {
  viewportWidth = 1200;
  emailConfigured = true;
  statusReason = null;
  setAutoTailorSpy = vi.fn();
  window.localStorage.clear();
  installFetch();
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

// ---------------------------------------------------------------------------
// HARNESS POSITIVE CONTROL. If this fails, every case below is measuring
// nothing and its result is INVALID -- not a zero (measurement-instruments).
// At HEAD it FAILS: there is no Automation view. That failure IS the S8 red.
// ---------------------------------------------------------------------------
describe("FeedAutomation harness", () => {
  it("mounts LiveFeedTab and can reach the Automation view from the toolbar", async () => {
    await mount();
    expect(container.querySelector("section"), "the tab mounts").toBeTruthy();
    const btn = await openAutomation();
    expect(btn, "a third 'Automation' view button in the toolbar's view group").toBeTruthy();
    await settle();
    expect(
      autoTailorSwitch(),
      "a per-search auto-tailor enable control inside the Automation view",
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC-R2 -- the control works when rendered and clicked. REACHABILITY.
// ---------------------------------------------------------------------------
describe("AC-R2: the auto-tailor enable control is reachable and writes the field", () => {
  it("enabling it (through the confirm) issues exactly one write carrying autoTailorEnabled:true", async () => {
    // Drive the shipped UI end to end: switch to the Automation view, flip the
    // enable switch, and pass the confirmation. The write must be EXACTLY ONE
    // call carrying the field true -- asserting the COUNT and the BODY, because
    // "exactly one write" is also satisfied by ZERO writes (the wrong-reason
    // pass this pairing exists to catch).
    await mount();
    const btn = await openAutomation();
    expect(btn, "the Automation view button must exist to drive this at all").toBeTruthy();
    await settle();

    const sw = autoTailorSwitch();
    expect(sw, "the auto-tailor enable switch").toBeTruthy();
    expect(sw.checked, "starts off (off is the safe default)").toBe(false);
    await click(sw);
    await settle();

    const dialog = topDialog();
    expect(dialog, "a confirmation before any unattended spending is turned on").toBeTruthy();
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) =>
      /(turn on|enable|start|confirm|yes)/i.test(accessibleName(b)),
    );
    expect(confirm, "a confirm button in the dialog").toBeTruthy();
    await click(confirm);
    await settle();

    const enablingCalls = setAutoTailorSpy.mock.calls.filter(
      ([, patch]) => patch && patch.autoTailorEnabled === true,
    );
    expect(enablingCalls, "exactly one enabling write, for this search").toHaveLength(1);
    expect(enablingCalls[0][0], "the write targets this saved search's id").toBe("srv-1");
  });

  it("mounting from a row with auto_tailor_enabled already true shows the control ON, with no click", async () => {
    // Catches a control that writes correctly but shows the wrong state after a
    // reload -- how a user re-enables something already on. Reflection only:
    // no interaction, and NO write is issued by merely mounting.
    await mount({ savedSearches: [serverSearch({ autoTailorEnabled: true })] });
    await openAutomation();
    await settle();
    const sw = autoTailorSwitch();
    expect(sw, "the enable control").toBeTruthy();
    expect(sw.checked, "reflects the fetched row's enabled state").toBe(true);
    expect(
      setAutoTailorSpy.mock.calls.filter(([, p]) => p && "autoTailorEnabled" in p),
      "mounting reflects state, it does not write",
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-R3 -- enabling states its cost behind a confirm; disabling is one action.
// ---------------------------------------------------------------------------
describe("AC-R3: enabling unattended work states its cost and requires confirmation", () => {
  it("activating the control writes NOTHING until the user confirms", async () => {
    await mount();
    await openAutomation();
    await settle();
    const sw = autoTailorSwitch();
    expect(sw).toBeTruthy();
    await click(sw);
    await settle();
    // The confirm is open, but no enabling write has happened yet.
    expect(topDialog(), "the confirmation is shown").toBeTruthy();
    expect(
      setAutoTailorSpy.mock.calls.filter(([, p]) => p && p.autoTailorEnabled === true),
      "no enabling write before the user confirms",
    ).toHaveLength(0);
  });

  it("the confirmation states the per-UTC-day ceiling (from the constant), unattended running, and that materials are parked not submitted", async () => {
    await mount();
    await openAutomation();
    await settle();
    await click(autoTailorSwitch());
    await settle();
    const text = (topDialog()?.textContent || "").toLowerCase();
    expect(text, "the confirmation must exist to read its copy").not.toBe("");
    // The number is READ FROM THE CONSTANT the cron enforces. A build that
    // hardcodes a different number is caught here; a build that reads the
    // constant tracks it if the owner moves it (R-08).
    expect(text).toContain(String(MAX_TAILORS_PER_USER_PER_UTC_DAY));
    // Runs unattended, with no user present.
    expect(text).toMatch(/unattended|without you|automatically|while you(?:'| a)re away|when you'?re (?:away|not)/);
    // Materials are generated and PARKED, never submitted on the user's behalf.
    expect(text).toMatch(/(not|never|won'?t|without).{0,24}(submit|appl(?:y|ied)|sen[dt])|parked|ready for you|you (?:can )?(?:review|send)/);
  });

  it("disabling takes ONE action and no confirmation (the deliberate asymmetry)", async () => {
    // Control for the confirm requirement above: turning it OFF must not demand
    // a confirm. A build that pops a confirm for both directions fails here; a
    // build that writes immediately for both fails the "no write before
    // confirm" case above. The pair pins the asymmetry.
    await mount({ savedSearches: [serverSearch({ autoTailorEnabled: true })] });
    await openAutomation();
    await settle();
    const sw = autoTailorSwitch();
    expect(sw?.checked, "starts ON").toBe(true);
    await click(sw);
    await settle();
    const disablingCalls = setAutoTailorSpy.mock.calls.filter(
      ([, p]) => p && p.autoTailorEnabled === false,
    );
    expect(disablingCalls, "one disabling write, immediately, no confirm").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-E5 (UI half) -- an unconfigured sender makes the control unavailable and
// impossible to switch on. The server reports it (/api/alerts/status); the
// browser cannot see an env var, so it must consume that report.
// ---------------------------------------------------------------------------
describe("AC-E5: the enable control is unavailable when the server reports email unconfigured", () => {
  it("cannot be switched on when emailConfigured is false", async () => {
    // NON-VACUITY: "cannot be switched on" is meaningless if the control is
    // never found. This asserts the control IS present but disabled, that
    // clicking it opens no confirm and writes nothing, and that the
    // server-supplied reason is surfaced. Paired with the CONTROL case below,
    // where the same control IS switchable.
    emailConfigured = false;
    statusReason = "EMAIL_FROM is not configured";
    await mount();
    await openAutomation();
    await settle();
    const sw = autoTailorSwitch();
    expect(sw, "the control still renders (unavailable), it is not simply absent").toBeTruthy();
    expect(sw.disabled, "the enable control is disabled while email is unconfigured").toBe(true);
    await click(sw);
    await settle();
    expect(topDialog(), "no confirmation may open for a disabled control").toBeNull();
    expect(
      setAutoTailorSpy.mock.calls.filter(([, p]) => p && p.autoTailorEnabled === true),
      "no enabling write is possible while unavailable",
    ).toHaveLength(0);
    const panelText = container.textContent || "";
    expect(panelText, "the server-supplied reason is shown, not guessed").toMatch(
      /email|unavailable|not (?:set up|configured)|can'?t send/i,
    );
  });

  it("CONTROL: the same control CAN be switched on when emailConfigured is true", async () => {
    // Without this the case above passes against a build whose control is
    // ALWAYS disabled -- which would silently make the whole feature
    // unreachable while looking safe.
    emailConfigured = true;
    await mount();
    await openAutomation();
    await settle();
    const sw = autoTailorSwitch();
    expect(sw, "the control renders").toBeTruthy();
    expect(sw.disabled, "not disabled when email is configured").toBe(false);
    await click(sw);
    await settle();
    expect(topDialog(), "clicking opens the confirmation, so it is switchable").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CLASS GUARD (companyResearchAccept.wiring idiom). Closes the class, not the
// instance: derive FeedAutomationCard's OWN declared props and require each to
// be threaded at its production call site, so a NEW automation prop added later
// and left unbound fails here instead of shipping silently. What this cannot
// catch: a prop passed but wired to the wrong value -- that is what the
// render-and-click cases above are for.
// ---------------------------------------------------------------------------
describe("class guard: every prop FeedAutomationCard declares is threaded at its call site", () => {
  const readIf = (rel) => {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const cardSrc = readIf("./FeedAutomationCard.js");
  const panelSrc = readIf("./FeedAutomationPanel.js");
  const tabSrc = readIf("../LiveFeedTab.js");

  function propNamesOf(source, componentName) {
    if (!source) return [];
    const sig = source.match(
      new RegExp(`export default function ${componentName}\\(\\{([\\s\\S]*?)\\}\\)\\s*\\{`),
    );
    if (!sig) return [];
    // Split on commas AND newlines so the guard does not depend on whether the
    // destructure is written one-prop-per-line or all on one line.
    return sig[1]
      .split(/[\n,]/)
      .map((line) => line.trim())
      .map((line) => line.match(/^([A-Za-z0-9_$]+)/)?.[1])
      .filter(Boolean);
  }
  function callSiteOf(source, tagName) {
    if (!source) return null;
    const m = source.match(new RegExp(`<${tagName}\\b[\\s\\S]*?/>`));
    return m ? m[0] : null;
  }

  it("FeedAutomationCard exists and declares an object-destructured prop list", () => {
    expect(cardSrc, "app/components/feed/FeedAutomationCard.js must exist").not.toBeNull();
    expect(propNamesOf(cardSrc, "FeedAutomationCard").length, "declared props").toBeGreaterThan(0);
  });

  it("declares at least the write callback and the config-availability prop", () => {
    // A floor, not a ceiling. The walk below is what enforces the class.
    const cardProps = propNamesOf(cardSrc, "FeedAutomationCard");
    expect(cardProps).toEqual(expect.arrayContaining(["setSavedSearchAutoTailor"]));
    expect(
      cardProps.some((n) => /email|config|available/i.test(n)),
      "an emailConfigured/availability prop (AC-E5 is consumed, not re-derived in the browser)",
    ).toBe(true);
  });

  it("every prop the card declares is passed at its production call site", () => {
    const cardProps = propNamesOf(cardSrc, "FeedAutomationCard");
    const site = callSiteOf(panelSrc, "FeedAutomationCard") || callSiteOf(tabSrc, "FeedAutomationCard");
    expect(site, "a <FeedAutomationCard .../> call site in the panel or the tab").not.toBeNull();
    for (const name of cardProps) {
      expect(
        new RegExp(`(^|[^A-Za-z0-9_$])${name}\\s*=\\{`).test(site) ||
          new RegExp(`\\{\\s*\\.\\.\\.`).test(site),
        `${name} is declared by FeedAutomationCard but not passed at its call site`,
      ).toBe(true);
    }
  });

  it("LiveFeedTab threads setSavedSearchAutoTailor into the automation surface", () => {
    // The reachability chain page.js -> LiveFeedTab -> panel -> card. This pins
    // the LiveFeedTab hop; the render-and-click cases pin the card hop.
    expect(tabSrc, "LiveFeedTab.js").not.toBeNull();
    const panelSite =
      callSiteOf(tabSrc, "FeedAutomationPanel") || callSiteOf(tabSrc, "FeedAutomationCard");
    expect(panelSite, "an automation surface mounted in LiveFeedTab").not.toBeNull();
    expect(panelSite).toMatch(/setSavedSearchAutoTailor=\{/);
  });
});
