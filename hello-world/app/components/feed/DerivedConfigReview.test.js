// @vitest-environment jsdom
//
// N60 SECOND CHUNK, Step D (4b) -- the derived-config review is shown FIELD BY
// FIELD in the existing saved-search vocabulary, unset fields shown as unset,
// and every field is CORRECTABLE IN PLACE so that editing it changes what gets
// stored (AC2-C1, AC2-C2, AC2-C4c review half; brief items 1 and 3).
//
// This mounts the REAL FeedAutomationPanel -- the Automation view's single mount
// point -- and drives the chat turn through the rendered controls (the deriver
// route is stubbed via fetch). End-to-end reachability from the toolbar is
// pinned by FeedConfigChat.wiring.test.js; this file pins what the review DOES
// with a derived config once shown.
//
// jsdom LIMITS: no layout; MUI Select/Dialog portal to document.body. The
// controls edited here (an Autocomplete freeSolo keyword field, an alert Switch)
// are the ones that drive reliably in jsdom; the cadence DISPLAY is asserted
// without editing (item 3 needs no edit -- it needs the shown value to be the
// DELIVERED one).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import FeedAutomationPanel from "./FeedAutomationPanel.js";
// The real cadence contract -- the source of the expected copy, so no cadence
// figure is ever typed as a literal (the twice-caught hardcode trap, item 3).
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

const json = (body) => Promise.resolve({ ok: true, json: async () => body });

// A config with something set in every kind of field, plus one field left unset
// (excludedCompanies empty) so "unset shown as unset, not omitted" is testable.
const CONFIG = {
  name: "Senior backend, Boston",
  jobKeywords: ["backend", "golang"],
  maxYearsExp: "any",
  selectedCategories: [],
  selectedCompanies: [],
  excludedCompanies: [],
  excludedTitleKeywords: ["agency"],
  autoTailorMinIntervalMinutes: 60,
  emailOnNewJobs: true,
};

let chatConfig;
let applyBodies;

function installFetch() {
  applyBodies = [];
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url);
    if (u.startsWith("/api/feed-config/chat")) return json({ config: chatConfig });
    if (u.startsWith("/api/feed-config/apply")) {
      applyBodies.push(init.body ? JSON.parse(init.body) : {});
      return json({ search: { id: "srv-new", name: "x", job_keywords: [] } });
    }
    if (u.startsWith("/api/alerts/status")) return json({ emailConfigured: true, reason: null });
    return json({});
  });
}

let container;
let root;

async function mountPanel() {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme },
        createElement(FeedAutomationPanel, {
          currentUser: { id: "u1" },
          savedSearches: [],
          setSavedSearches: vi.fn(),
          setSavedSearchAutoTailor: vi.fn(),
          GREENHOUSE_COMPANIES: [],
          COMPANY_CATEGORIES: [],
        }),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

async function click(el) {
  await act(async () => {
    el.click();
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
}
async function typeInto(el, text) {
  await act(async () => {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pressEnter(el) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  });
}

// The rendered text WITH picker controls stripped out. A cadence <select>'s
// <option> list contains every cadence string, so asserting the container
// "contains" a cadence would pass even when the DISPLAYED/selected value is
// wrong (a hardcode survives). We assert the delivered cadence appears in the
// STATED summary text, not merely as a selectable option. (This mutant -- a
// hardcoded 'about every hour' in the cadence control -- was watched surviving
// the naive version of this test and killed by this one.)
function statedText() {
  const clone = container.cloneNode(true);
  clone.querySelectorAll("select, option, [role='listbox'], [role='option']").forEach((n) => n.remove());
  return clone.textContent || "";
}
const accessibleName = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim();
const buttons = () => Array.from(document.querySelectorAll("button"));
const named = (re) => buttons().find((b) => re.test(accessibleName(b)));

function chatInput() {
  const fields = Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type])'));
  return fields.find((f) =>
    /describe|jobs you want|what.*looking|tell us/i.test(
      `${f.getAttribute("placeholder") || ""} ${f.getAttribute("aria-label") || ""}`,
    ),
  );
}
const sendButton = () => named(/preview|generate|read|describe|configure|send|propose/i);
const acceptButton = () => named(/create automation|save automation|add search|start automat|create search|save search|accept/i);

// The MUI TextField label whose text matches `re`, resolved to its input.
function inputByLabel(re) {
  const label = Array.from(document.querySelectorAll("label")).find((l) => re.test(l.textContent || ""));
  if (!label) return null;
  const id = label.getAttribute("for");
  if (id && document.getElementById(id)) return document.getElementById(id);
  return label.parentElement ? label.parentElement.querySelector("input, textarea") : null;
}
// The review's alert Switch (distinct from a card's -- there are no cards here).
function emailSwitch() {
  const label = Array.from(document.querySelectorAll("label")).find((l) => /email/i.test(l.textContent || ""));
  return label ? label.querySelector('input[type="checkbox"]') : null;
}

async function toReview(config = CONFIG) {
  chatConfig = config;
  await mountPanel();
  const input = chatInput();
  expect(input, "a chat message box in the panel").toBeTruthy();
  await typeInto(input, "senior backend in boston");
  const send = sendButton();
  expect(send, "a send/preview control").toBeTruthy();
  await click(send);
  await settle();
}

beforeEach(() => {
  chatConfig = CONFIG;
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
// HARNESS positive control. Invalid, not zero, if it fails.
// ---------------------------------------------------------------------------
describe("DerivedConfigReview harness", () => {
  it("a chat turn produces a review that shows the derived config", async () => {
    await toReview();
    expect(container.textContent, "the derived config's name is shown for review").toContain(CONFIG.name);
  });
});

// ---------------------------------------------------------------------------
// AC2-C1 -- field by field, unset shown as unset (item 1).
// ---------------------------------------------------------------------------
describe("AC2-C1: the config is rendered field by field, unset shown as unset", () => {
  it("renders the filter fields with the shared JobFilterControls vocabulary", async () => {
    await toReview();
    // The keyword field the shared control renders must be present, carrying the
    // derived keyword as an editable chip (existing vocabulary, not a fork).
    expect(inputByLabel(/job title or keywords/i), "the shared keyword control is rendered").toBeTruthy();
    expect(container.textContent.toLowerCase(), "the derived keyword is shown").toContain("backend");
    // The exclude-title control (a field the config DID set) is present too.
    expect(inputByLabel(/exclude title keywords/i), "the shared exclude-title control is rendered").toBeTruthy();
  });

  it("a field the config did NOT set still renders its control (unset, not omitted)", async () => {
    // excludedCompanies is empty in CONFIG. "Shown as unset" is the load-bearing
    // half: an omitted control reads as 'it understood and left it alone'. The
    // shared control renders the Exclude-Companies field with its placeholder
    // even when empty, so the field is visibly present-but-empty.
    await toReview();
    expect(inputByLabel(/exclude companies/i), "the exclude-companies control renders even though unset").toBeTruthy();
    // A cadence affordance is present even when the derived cadence is null.
    const nullCadence = { ...CONFIG, autoTailorMinIntervalMinutes: null };
    // Re-mount with a null-cadence config and confirm the cadence field is still shown.
    await act(async () => {
      root.unmount();
    });
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await toReview(nullCadence);
    expect(
      /how often|frequency|check|cadence|interval|every/i.test(container.textContent || ""),
      "a cadence affordance is shown even when the derived cadence is unset",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2-C4c (review half) -- the DELIVERED cadence is shown, never the raw value.
// The twice-caught hardcode trap: the expected copy comes from the REAL
// describeCadence(clampIntervalMinutes(...)), so a fixed string cannot pass.
// ---------------------------------------------------------------------------
describe("AC2-C4c: the review states the delivered cadence, a pure function of the stored value", () => {
  it("a sub-floor proposed cadence (5) is shown as the delivered one (15), never '5'", async () => {
    await toReview({ ...CONFIG, autoTailorMinIntervalMinutes: 5 });
    const delivered = describeCadence(clampIntervalMinutes(5)); // "every 15 minutes"
    const text = statedText();
    expect(text, `the review must STATE the delivered cadence "${delivered}"`).toContain(delivered);
    expect(text, "the raw sub-floor request must not be echoed as the cadence").not.toMatch(/every\s*5\b/i);
  });

  it("an above-floor cadence (180) is shown via describeCadence, not a literal (kills a hardcoded string)", async () => {
    // A NON-hourly, non-default value: a review that hardcodes 'about every
    // hour' (or any fixed figure) fails to STATE the 180-minute copy. Asserted
    // on the stated summary, not the picker options (which list every cadence).
    await toReview({ ...CONFIG, autoTailorMinIntervalMinutes: 180 });
    const expected = describeCadence(clampIntervalMinutes(180)); // "about every 3 hours"
    const theDefault = describeCadence(clampIntervalMinutes(null)); // "about every hour"
    expect(statedText(), `must STATE "${expected}" from describeCadence`).toContain(expected);
    // A hardcoded default would say "about every hour" for a 180 config -- reject it.
    expect(statedText(), "must not fall back to a hardcoded default cadence").not.toContain(theDefault);
  });
});

// ---------------------------------------------------------------------------
// AC2-C2 -- every field is correctable in place, and the edit is what gets
// applied (item 1: "editing a derived field changes what gets applied").
// ---------------------------------------------------------------------------
describe("AC2-C2: editing a derived field changes what is stored on accept", () => {
  it("flipping the alert Switch changes email_on_new_jobs in the apply body", async () => {
    // CONFIG.emailOnNewJobs is true. Flip it off and confirm the STORED value is
    // the edited one, not the derived one. The alert Switch is the reliable
    // control kind in jsdom; the CONTROL below proves an un-edited accept keeps
    // the derived value, so this cannot pass against a build that always writes
    // false.
    await toReview();
    const sw = emailSwitch();
    expect(sw, "the review's email Switch").toBeTruthy();
    expect(sw.checked, "starts from the derived value (true)").toBe(true);
    await click(sw);
    await settle();
    const accept = acceptButton();
    expect(accept, "an accept control").toBeTruthy();
    await click(accept);
    await settle();
    expect(applyBodies, "one apply write").toHaveLength(1);
    const body = applyBodies[0];
    const emailValue = body.emailOnNewJobs ?? body.email_on_new_jobs;
    expect(emailValue, "the EDITED alert value (false) is what gets stored").toBe(false);
  });

  it("CONTROL: accepting WITHOUT editing stores the derived value (true)", async () => {
    // Without this, the case above passes against a build that always writes
    // false regardless of the switch.
    await toReview();
    await click(acceptButton());
    await settle();
    expect(applyBodies).toHaveLength(1);
    const emailValue = applyBodies[0].emailOnNewJobs ?? applyBodies[0].email_on_new_jobs;
    expect(emailValue, "the unedited derived value (true) is stored").toBe(true);
  });

  it("adding a keyword through the shared filter control changes the applied keywords", async () => {
    // Drives the SHARED JobFilterControls keyword Autocomplete (freeSolo: type +
    // Enter) so a chat-only fork could not silently diverge from the chip UI.
    await toReview();
    const kw = inputByLabel(/job title or keywords/i);
    expect(kw, "the shared keyword control").toBeTruthy();
    await typeInto(kw, "remote");
    await pressEnter(kw);
    await settle();
    await click(acceptButton());
    await settle();
    expect(applyBodies).toHaveLength(1);
    const keywords = applyBodies[0].jobKeywords ?? applyBodies[0].job_keywords ?? [];
    expect(keywords, "the derived keywords are still present").toEqual(expect.arrayContaining(["backend"]));
    expect(keywords, "the edit (a new keyword) reaches the apply body").toEqual(expect.arrayContaining(["remote"]));
  });
});

// ---------------------------------------------------------------------------
// AC2-C2 vocabulary-coupling guard -- the review REUSES JobFilterControls and
// the cadence control, it does not fork them. Source scan, canaried.
// ---------------------------------------------------------------------------
describe("the review reuses the shared controls rather than forking them", () => {
  const readIf = (rel) => {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  it("DerivedConfigReview imports JobFilterControls (not a chat-only copy)", () => {
    const src = readIf("./DerivedConfigReview.js");
    expect(src, "DerivedConfigReview.js must exist").not.toBeNull();
    // CANARY: the file names the shared control at all.
    expect(src, "[canary] the review references JobFilterControls").toMatch(/JobFilterControls/);
    // The load-bearing assertion: it IMPORTS it, so it cannot drift from chips.
    expect(src).toMatch(/import\s+JobFilterControls\s+from\s+["'][^"']*JobFilterControls["']/);
  });
  it("DerivedConfigReview uses the shared CadenceControl for cadence", () => {
    const src = readIf("./DerivedConfigReview.js");
    expect(src).toMatch(/CadenceControl/);
  });
});
