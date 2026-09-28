// @vitest-environment jsdom
//
// N60 SECOND CHUNK, Step D (4b) -- brief item 7: THE STORED INTERVAL MUST REACH
// THE CARD. The Step A implementer surfaced and LEFT a gap: rowToSavedSearchEntry
// (app/page.js:578) maps ten saved_searches columns into the UI entry shape but
// does NOT map auto_tailor_min_interval_minutes. FeedAutomationCard's confirm
// reads entry.autoTailorMinIntervalMinutes -- which is therefore ALWAYS undefined
// in production, so clampIntervalMinutes(undefined) === 60 and every card states
// "about every hour" no matter what interval is stored. Harmless only while
// nothing could set an interval; Step D's chat is what makes it settable, so this
// is the step that must close it.
//
// The plan closes it by extracting the mapper to lib/feed/savedSearchEntry.js
// (net-neutral on page.js) and mapping the interval there. This file drives the
// JOIN the way production does: a DB-shaped row -> the SHARED mapper -> the card's
// confirm copy. It imports the EXTRACTED module (RED at HEAD: the module does not
// exist), and its assertions FAIL for a mapper that omits the interval column
// (the exact gap), because the confirm would then show the default, not the
// stored value.
//
// FeedAutomationCard.cadence.test.js (landed Step A) already pins that the confirm
// states describeCadence(entry.autoTailorMinIntervalMinutes). It does so by
// feeding the interval DIRECTLY into the entry -- it does not exercise the mapper,
// so it stays green against the very gap this file exists to catch. This file is
// the missing hop, not a duplicate.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import FeedAutomationCard from "./FeedAutomationCard.js";
// The EXTRACTED shared mapper (plan Step D). Absent at HEAD -> this import is the
// RED. The card and page.js both consume it in production, so it is not a
// test-only export.
import { rowToSavedSearchEntry } from "../../../lib/feed/savedSearchEntry.js";
// The real cadence contract -- expected copy comes from here, never a literal.
import { describeCadence, clampIntervalMinutes } from "../../../lib/feed/cronSchedule.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

// A saved_searches ROW as the API returns it (snake_case columns), NOT a UI
// entry. The whole point is to prove the mapper carries the interval column.
function row(overrides = {}) {
  return {
    id: "srv-1",
    name: "Backend roles",
    job_keywords: ["backend"],
    max_years_exp: "any",
    selected_categories: [],
    selected_companies: [],
    excluded_companies: [],
    excluded_title_keywords: [],
    auto_tailor_enabled: false,
    auto_tailor_daily_cap: 10,
    email_on_new_jobs: false,
    auto_tailor_min_interval_minutes: 180,
    ...overrides,
  };
}

let container;
let root;

async function mountCardFromRow(dbRow) {
  const entry = rowToSavedSearchEntry(dbRow);
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme },
        createElement(FeedAutomationCard, {
          entry,
          setSavedSearchAutoTailor: vi.fn(),
          emailConfigured: true,
          emailReason: null,
        }),
      ),
    );
  });
  return entry;
}
async function click(el) {
  await act(async () => {
    el.click();
  });
}
function autoTailorSwitch() {
  const label = Array.from(document.querySelectorAll("label")).find((l) => /auto.?tailor/i.test(l.textContent || ""));
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

// ---------------------------------------------------------------------------
// Unit: the mapper carries the interval column. This is the direct discriminator
// of the gap; the JOIN below proves it MATTERS to what the user sees.
// ---------------------------------------------------------------------------
describe("rowToSavedSearchEntry maps the stored auto-tailor interval", () => {
  it("carries auto_tailor_min_interval_minutes onto entry.autoTailorMinIntervalMinutes", () => {
    const entry = rowToSavedSearchEntry(row({ auto_tailor_min_interval_minutes: 180 }));
    expect(entry.autoTailorMinIntervalMinutes, "the stored interval reaches the entry").toBe(180);
  });

  it("still maps the fields the inline version already carried (regression guard)", () => {
    // A control so a rewrite that maps the interval but drops an existing field
    // is caught here rather than in an unrelated page.js suite.
    const entry = rowToSavedSearchEntry(row({ name: "X", auto_tailor_daily_cap: 7, email_on_new_jobs: true }));
    expect(entry.id).toBe("srv-1");
    expect(entry.name).toBe("X");
    expect(entry.jobKeywords).toEqual(["backend"]);
    expect(entry.autoTailorDailyCap).toBe(7);
    expect(entry.emailOnNewJobs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// JOIN: a stored interval reaches the CARD'S CONFIRMATION TEXT (brief item 7).
// ---------------------------------------------------------------------------
describe("a stored interval reaches the card's confirmation copy through the mapper", () => {
  it("a 180-minute stored interval makes the confirm state 'every 3 hours', not the default", async () => {
    await mountCardFromRow(row({ auto_tailor_min_interval_minutes: 180 }));
    const sw = autoTailorSwitch();
    expect(sw, "the auto-tailor enable switch renders").toBeTruthy();
    await click(sw);
    const text = topDialogText();
    const delivered = describeCadence(clampIntervalMinutes(180)); // "about every 3 hours"
    const theDefault = describeCadence(clampIntervalMinutes(null)); // "about every hour"
    expect(text, `confirm must state the STORED cadence "${delivered}"`).toContain(delivered);
    // The gap this file exists to catch: a mapper that drops the column leaves
    // autoTailorMinIntervalMinutes undefined -> the confirm would state the
    // DEFAULT. Assert it does NOT (the stored value is not 60).
    expect(text, "the confirm must not fall back to the default cadence").not.toContain(theDefault);
  });

  it("a different stored interval (30) states 'every 30 minutes' (tracks the value, not a literal)", async () => {
    await mountCardFromRow(row({ auto_tailor_min_interval_minutes: 30 }));
    await click(autoTailorSwitch());
    const expected = describeCadence(clampIntervalMinutes(30)); // "every 30 minutes"
    expect(topDialogText(), `confirm states "${expected}"`).toContain(expected);
  });
});
