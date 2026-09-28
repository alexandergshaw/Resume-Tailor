// @vitest-environment jsdom
//
// N60 SECOND CHUNK, Step A (4b) -- AC2-C4c's confirm half (brief item 4). The
// enable confirmation must state the DELIVERED cadence, and the number must come
// from the cadence constant/describeCadence, NEVER a literal typed into the card.
//
// MEASURED at HEAD (FeedAutomationCard.js:85-89): the confirm states only the
// per-day CEILING and "nothing is submitted"; it says NOTHING about cadence. So
// "the confirm states the delivered cadence" fails today -- RED on HEAD. (It is
// also red for the collection reason that lib/feed/cronSchedule.js, which this
// file imports describeCadence/clampIntervalMinutes from, does not exist yet; the
// reference build in tests.stepA.md shows the card-omits-cadence red survives once
// the module exists, via a mutant that reverts only the card's cadence line.)
//
// WHY DRIVE THE REAL SWITCH, NOT confirmEnable/setConfirmOpen. The confirm is
// opened by the user toggling the "Auto-tailor new matches" Switch (onToggleAuto
// -> setConfirmOpen). We click that shipped control and read the dialog MUI
// portals to <body>; a direct setConfirmOpen call would not prove the confirm the
// user actually sees carries the cadence. (Whole-path reachability from the
// toolbar is already pinned by FeedAutomation.wiring.test.js; this file pins the
// COPY the card owns.)
//
// THE HARDCODE MUTANT MUST DIE. The expected string is computed from the REAL
// describeCadence(clampIntervalMinutes(interval)), and the driven interval is a
// NON-default, non-hourly value (30) -- so a card that hardcodes "about every
// hour" (or any fixed figure) does not contain the 30-minute copy and FAILS.
// The clamp case drives 5 and asserts the DELIVERED (15) cadence is stated and
// the raw "5" request is not (this exact literal-vs-derived trap was caught in
// the first chunk's AC-R3 confirm -- FeedAutomation.wiring.test.js).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import FeedAutomationCard from "./FeedAutomationCard.js";
import { MAX_TAILORS_PER_USER_PER_UTC_DAY } from "../../../lib/feed/autoTailorBounds.js";
// The real cadence contract -- the source of the expected copy, so no cadence
// figure is ever typed as a literal into this test.
import { describeCadence, clampIntervalMinutes } from "../../../lib/feed/cronSchedule.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// FormDialog -> useIsMobile -> matchMedia. Desktop width; the confirm is not
// viewport-gated.
window.matchMedia = (query) => ({
  matches: false,
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

function entryOf(overrides = {}) {
  // Server-backed: id must NOT start with "ss-" or the card renders the
  // sign-in-only stub instead of the controls.
  return {
    id: "srv-1",
    name: "Backend roles",
    emailOnNewJobs: false,
    autoTailorEnabled: false,
    autoTailorDailyCap: 10,
    autoTailorMinIntervalMinutes: 30,
    ...overrides,
  };
}

let container;
let root;

async function mountCard(entry) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme },
        createElement(FeedAutomationCard, {
          entry,
          setSavedSearchAutoTailor: vi.fn(),
          emailConfigured: true, // switch enabled (not unavailable)
          emailReason: null,
        }),
      ),
    );
  });
}

async function click(el) {
  await act(async () => {
    el.click();
  });
}

// The "Auto-tailor new matches" enable Switch: the label whose text names
// auto-tailoring (distinct from "Email me new jobs"), and its checkbox input.
function autoTailorSwitch() {
  const label = Array.from(document.querySelectorAll("label")).find((l) =>
    /auto.?tailor/i.test(l.textContent || ""),
  );
  return label ? label.querySelector('input[type="checkbox"]') : null;
}

function topDialogText() {
  const all = Array.from(document.querySelectorAll('[role="dialog"]'));
  const dlg = all.length > 0 ? all[all.length - 1] : null;
  return dlg ? dlg.textContent || "" : "";
}

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
});

describe("HARNESS positive control (invalid, not zero, if it fails)", () => {
  it("clicking the auto-tailor switch opens the confirm dialog", async () => {
    await mountCard(entryOf());
    const sw = autoTailorSwitch();
    expect(sw, "the auto-tailor enable switch must render").toBeTruthy();
    await click(sw);
    expect(topDialogText().toLowerCase(), "the confirm dialog opens on the switch click").toMatch(
      /turn on auto.?tailor/,
    );
  });
});

describe("AC2-C4c: the enable confirm states the delivered cadence, derived from the constant", () => {
  it("states the cadence describeCadence gives for this search's interval (kills a hardcoded figure)", async () => {
    await mountCard(entryOf({ autoTailorMinIntervalMinutes: 30 }));
    await click(autoTailorSwitch());
    const text = topDialogText();
    const expected = describeCadence(clampIntervalMinutes(30));
    expect(text, `confirm must state the delivered cadence "${expected}"`).toContain(expected);
    // The existing cost line must NOT be dropped to make room -- the ceiling is
    // still stated, from the SAME constant the cron enforces (not a literal).
    expect(text).toContain(String(MAX_TAILORS_PER_USER_PER_UTC_DAY));
  });

  it("states the DELIVERED (clamped) cadence for a sub-floor request, never the raw request", async () => {
    // A user whose stored interval is 5 gets 15. The confirm must say 15, not 5.
    await mountCard(entryOf({ autoTailorMinIntervalMinutes: 5 }));
    await click(autoTailorSwitch());
    const text = topDialogText();
    const delivered = describeCadence(clampIntervalMinutes(5)); // == describeCadence(15)
    expect(text, `confirm must state the delivered "${delivered}", not the requested 5`).toContain(delivered);
    // The raw request must not be echoed as the cadence.
    expect(text).not.toMatch(/every\s*5\b/i);
    expect(text).not.toMatch(/\b5\s*minutes?\b/i);
  });
});
