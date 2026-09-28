// @vitest-environment jsdom
//
// N60 SECOND CHUNK, Step D (4b) -- the acceptance tests that must land RED as the
// hand-off for the chat-driven configuration surface, driven THE WAY A USER
// DRIVES IT: mount the real LiveFeedTab, click the toolbar's "Automation"
// button, type a description, and watch the derived configuration appear for
// review BEFORE anything is stored.
//
// -------------------------------------------------------------------------
// WHY RENDER-AND-CLICK AND NOT A SOURCE SCAN (brief item 5). The missing last
// hop -- a rendered control a user reaches -- is this project's most repeated
// defect (seven instances). A source scan for "does the apply route exist / does
// the sanitizer omit the flag" is ALREADY GREEN at HEAD (Steps A/B/C landed the
// backend), satisfied entirely by plumbing NO CONTROL DRIVES. So this file mounts
// the shipped Automation view and drives the chat -> review -> accept flow the
// way a person does. A hook call or a prop-spy would NOT satisfy the reachability
// criterion.
//
// WHAT IS RED AT HEAD, AND WHY. At HEAD the Automation view (view === "automation",
// LiveFeedTab.js:722) renders FeedAutomationPanel, which mounts ONLY the per-search
// FeedAutomationCard list + the run log (FeedAutomationPanel.js, read in full).
// There is NO chat input and NO derived-config review anywhere. Every case below
// fails at HEAD because the control it drives does not exist -- the harness
// positive control names that failure as the Step D red. Each case also states,
// in its own comment, the wrong-reason pass it is paired against.
//
// jsdom LIMITS (measurement-instruments memory): no layout; MUI Dialog/portal
// content lands on document.body, so we scan the document, not the container.
//
// CANONICAL LABELS THIS FILE PINS (the implementer builds to these; the
// reference build in tests.stepD.md uses them verbatim):
//   * chat input  -- a textbox whose placeholder/aria-label contains "Describe"
//   * send control -- a button named /preview|generate|read|describe/i
//   * accept control -- a button named /create automation|save|add|start/i
// The regexes below are deliberately a little broader than the canonical label
// so a reasonable synonym still passes; the point pinned is the CONTROL, not the
// wording.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import LiveFeedTab from "../LiveFeedTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport ---------------------------------------------------------------
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
const json = (body) => Promise.resolve({ ok: true, json: async () => body });

// The config the STUBBED deriver returns for a chat turn. A fixed, known shape
// so every field can be checked in the review. Distinct from CONFIG_B, used for
// the two-turn membership test.
const CONFIG_A = {
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
const CONFIG_B = {
  name: "Junior frontend, remote",
  jobKeywords: ["frontend", "react"],
  maxYearsExp: "1",
  selectedCategories: [],
  selectedCompanies: [],
  excludedCompanies: [],
  excludedTitleKeywords: [],
  autoTailorMinIntervalMinutes: null,
  emailOnNewJobs: false,
};

let chatResponses; // queue of { status, config } for successive /chat POSTs
let chatBodies; // recorded request bodies to /api/feed-config/chat
let applyBodies; // recorded request bodies to /api/feed-config/apply

function installFetch() {
  chatBodies = [];
  applyBodies = [];
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url);
    if (u.startsWith("/api/feed-config/chat")) {
      chatBodies.push(init.body ? JSON.parse(init.body) : null);
      const next = chatResponses.shift() || { status: 200, config: CONFIG_A };
      if (next.status === 429) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: async () => ({ error: "Too many messages" }),
        });
      }
      return json({ config: next.config });
    }
    if (u.startsWith("/api/feed-config/apply")) {
      const body = init.body ? JSON.parse(init.body) : {};
      applyBodies.push(body);
      // Echo back a saved_searches-shaped row so the surface can map it in.
      return json({
        search: {
          id: "srv-new",
          name: body.name || "Chat search",
          job_keywords: body.jobKeywords || body.job_keywords || [],
          auto_tailor_min_interval_minutes:
            body.autoTailorMinIntervalMinutes ?? body.auto_tailor_min_interval_minutes ?? 60,
          email_on_new_jobs: !!(body.emailOnNewJobs ?? body.email_on_new_jobs),
        },
      });
    }
    if (u.startsWith("/api/alerts/status")) {
      return json({ emailConfigured: true, reason: null, alertsPaused: false });
    }
    if (u.startsWith("/api/auto-apply-queue")) return json({ items: [] });
    if (u.startsWith("/api/user-profile")) return json({ profile: PROFILE });
    if (u.startsWith("/api/saved-searches/unviewed-counts")) return json({ counts: {} });
    if (u.startsWith("/api/saved-searches")) return json({ searches: [] });
    if (u.startsWith("/api/feed")) {
      return json({ items: [], nextCursor: null, lastUpdatedAt: "2026-09-07T12:00:00.000Z", sourceHealth: {} });
    }
    return json({});
  });
}

// --- mount ------------------------------------------------------------------
let container;
let root;

function props(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    savedSearches: [],
    setSavedSearches: vi.fn(),
    setSavedSearchAutoTailor: vi.fn(),
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

// Set a controlled input/textarea's value the way React needs: through the
// prototype's native value setter, then dispatch the input event React listens
// on. A plain `el.value = x` is invisible to a controlled component.
async function typeInto(el, text) {
  await act(async () => {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  return (el.textContent || "").trim();
}
const buttons = () => Array.from(document.querySelectorAll("button"));
const named = (re) => buttons().find((b) => re.test(accessibleName(b)));

async function openAutomation() {
  const btn = named(/^automation$/i);
  if (btn) await click(btn);
  return btn;
}

// The chat message box: a textbox whose placeholder or aria-label asks the user
// to describe the jobs they want.
function chatInput() {
  const fields = Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type])'));
  return fields.find((f) => /describe|jobs you want|what.*looking|tell us/i.test(
    `${f.getAttribute("placeholder") || ""} ${f.getAttribute("aria-label") || ""}`,
  ));
}
// The chat send control -- turns the message into a proposed config for review.
function sendButton() {
  return named(/preview|generate|read|describe|configure|send|propose/i);
}
// The review's accept control -- the ONLY thing that stores the configuration.
function acceptButton() {
  return named(/create automation|save automation|add search|start automat|create search|save search|accept/i);
}
// Any control in the surface that would enable unattended auto-tailoring. There
// must be NONE in the chat/review surface (brief item 4).
function autoTailorEnableControl() {
  const label = Array.from(document.querySelectorAll("label")).find((l) => /auto.?tailor/i.test(l.textContent || ""));
  return label ? label.querySelector('input[type="checkbox"]') : null;
}

async function runOneTurn(message = "senior backend in boston, not agencies") {
  const input = chatInput();
  expect(input, "a chat message box in the Automation view").toBeTruthy();
  await typeInto(input, message);
  const send = sendButton();
  expect(send, "a send/preview control for the chat message").toBeTruthy();
  await click(send);
  await settle();
}

beforeEach(() => {
  viewportWidth = 1200;
  chatResponses = [{ status: 200, config: CONFIG_A }];
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
// NOTHING and its result is INVALID -- not a zero (measurement-instruments).
// At HEAD it FAILS: the Automation view has no chat input and no review. That
// failure IS the Step D red.
// ---------------------------------------------------------------------------
describe("FeedConfigChat harness", () => {
  it("mounts LiveFeedTab, reaches Automation, and finds a chat box that produces a review", async () => {
    await mount();
    expect(container.querySelector("section"), "the tab mounts").toBeTruthy();
    const btn = await openAutomation();
    expect(btn, "a third 'Automation' view button in the toolbar").toBeTruthy();
    await settle();
    expect(chatInput(), "a chat message box inside the Automation view").toBeTruthy();
    await runOneTurn();
    // After one turn the derived name must be visible somewhere in the surface.
    expect(container.textContent, "the derived config's name appears in the review").toContain(CONFIG_A.name);
  });
});

// ---------------------------------------------------------------------------
// brief item 1 + item 2 -- the review is shown BEFORE anything is stored, and
// NOTHING is stored until the candidate accepts.
// ---------------------------------------------------------------------------
describe("the derived config is reviewed before it is stored (AC2-C1), and stored only on accept (item 2)", () => {
  it("a chat turn renders the config for review and issues NO apply write", async () => {
    await mount();
    await openAutomation();
    await settle();
    await runOneTurn();

    // The chat route WAS called (the turn happened) ...
    expect(chatBodies.length, "the chat turn reached the deriver route").toBe(1);
    // ... and the review is showing the derived config's fields ...
    expect(container.textContent).toContain(CONFIG_A.name);
    expect(container.textContent.toLowerCase(), "a derived keyword is shown").toContain("backend");
    // ... but NOTHING has been stored. This is the non-vacuity guard: we have
    // REACHED a point where a write COULD happen (a config is on screen), and
    // it has not. A test that asserted "no write" before any config existed
    // would be vacuously true.
    expect(applyBodies, "no configuration is stored before the user accepts").toHaveLength(0);
  });

  it("clicking accept issues EXACTLY ONE apply write carrying the reviewed config", async () => {
    // Paired with the case above: "exactly one" is also satisfied by ZERO, so
    // the case above proves zero-before-accept and this proves one-on-accept.
    await mount();
    await openAutomation();
    await settle();
    await runOneTurn();
    const accept = acceptButton();
    expect(accept, "an accept/create control in the review").toBeTruthy();
    await click(accept);
    await settle();
    expect(applyBodies, "exactly one apply write, on the explicit accept").toHaveLength(1);
    expect(applyBodies[0].name, "the write carries the reviewed config's name").toBe(CONFIG_A.name);
  });

  it("abandoning the review (navigating back to the feed) stores nothing", async () => {
    // The user changes their mind. Leaving the review unaccepted must write
    // nothing -- a natural-language setup that silently commits on a stray
    // navigation is the exact silent-misread failure this chunk exists to stop.
    await mount();
    await openAutomation();
    await settle();
    await runOneTurn();
    expect(container.textContent).toContain(CONFIG_A.name); // reached the review
    const feedBtn = named(/^feed$/i);
    expect(feedBtn, "the Feed toolbar button to navigate away").toBeTruthy();
    await click(feedBtn);
    await settle();
    expect(applyBodies, "abandoning the review stores nothing").toHaveLength(0);
  });

  it("two different turns render two different reviews (membership: this turn's derivation, not a template)", async () => {
    // A byte-identical review across two different derivations would mean the
    // surface renders a fixed template, not what THIS turn produced.
    chatResponses = [{ status: 200, config: CONFIG_A }, { status: 200, config: CONFIG_B }];
    await mount();
    await openAutomation();
    await settle();
    await runOneTurn("senior backend in boston");
    expect(container.textContent).toContain(CONFIG_A.name);
    expect(container.textContent).not.toContain(CONFIG_B.name);
    await runOneTurn("junior frontend, remote");
    expect(container.textContent, "the second turn's derived name replaces the first").toContain(CONFIG_B.name);
  });
});

// ---------------------------------------------------------------------------
// brief item 4 -- the chat surface cannot enable unattended paid spending.
// ---------------------------------------------------------------------------
describe("the chat/review surface cannot enable unattended spending (AC2-C3, item 4)", () => {
  it("the review has NO auto-tailor enable control", async () => {
    await mount();
    await openAutomation();
    await settle();
    await runOneTurn();
    // The review is the chat surface; enabling stays behind FeedAutomationCard's
    // own cost-stating confirm, on a saved search, not here.
    // NON-VACUITY: the review IS showing (name present) so "no enable control"
    // is measured against a rendered surface, not an empty one.
    expect(container.textContent).toContain(CONFIG_A.name);
    expect(autoTailorEnableControl(), "no auto-tailor enable switch in the review surface").toBeNull();
  });

  it("the apply write never carries an enable flag, even after accept", async () => {
    await mount();
    await openAutomation();
    await settle();
    await runOneTurn();
    await click(acceptButton());
    await settle();
    expect(applyBodies).toHaveLength(1);
    const body = applyBodies[0];
    expect(body, "no camelCase enable flag in the apply body").not.toHaveProperty("autoTailorEnabled");
    expect(body, "no snake_case enable flag in the apply body").not.toHaveProperty("auto_tailor_enabled");
  });
});

// ---------------------------------------------------------------------------
// CLASS GUARD (companyResearchAccept.wiring idiom). Closes the class, not the
// instance: derive each new component's OWN declared props and require every one
// to be threaded at its production call site, so a NEW prop added later and left
// unbound fails here instead of shipping silently. What this cannot catch: a
// prop passed but wired to the WRONG value -- that is what the render-and-click
// cases above are for.
// ---------------------------------------------------------------------------
describe("class guard: every prop each new panel declares is threaded at its call site", () => {
  const readIf = (rel) => {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const panelSrc = readIf("./FeedAutomationPanel.js");
  const tabSrc = readIf("../LiveFeedTab.js");
  const chatSrc = readIf("./FeedConfigChat.js");
  const reviewSrc = readIf("./DerivedConfigReview.js");

  function propNamesOf(source, componentName) {
    if (!source) return [];
    const sig = source.match(new RegExp(`function ${componentName}\\(\\{([\\s\\S]*?)\\}\\)\\s*\\{`));
    if (!sig) return [];
    return sig[1]
      .split(/[\n,]/)
      .map((line) => line.trim())
      .map((line) => line.match(/^([A-Za-z0-9_$]+)/)?.[1])
      .filter(Boolean);
  }
  function callSiteOf(source, tagName) {
    if (!source) return null;
    // Self-closing tag only (the proven companyResearchAccept idiom): matching
    // to the first `/>` is safe against arrow functions in prop values, whereas
    // matching a bare `>` would truncate at a `=>`. These panels are rendered
    // with props only, so their call sites are self-closing.
    const m = source.match(new RegExp(`<${tagName}\\b[\\s\\S]*?/>`));
    return m ? m[0] : null;
  }
  function passedAtSite(site, name) {
    return (
      new RegExp(`(^|[^A-Za-z0-9_$])${name}\\s*=\\{`).test(site) || /\{\s*\.\.\./.test(site)
    );
  }

  it("FeedConfigChat.js and DerivedConfigReview.js exist and declare prop lists", () => {
    expect(chatSrc, "app/components/feed/FeedConfigChat.js must exist").not.toBeNull();
    expect(reviewSrc, "app/components/feed/DerivedConfigReview.js must exist").not.toBeNull();
  });

  it("every prop FeedConfigChat declares is passed at its FeedAutomationPanel call site", () => {
    const declared = propNamesOf(chatSrc, "FeedConfigChat");
    expect(declared.length, "FeedConfigChat declares props").toBeGreaterThan(0);
    const site = callSiteOf(panelSrc, "FeedConfigChat");
    expect(site, "a <FeedConfigChat .../> call site in FeedAutomationPanel").not.toBeNull();
    for (const name of declared) {
      expect(passedAtSite(site, name), `${name} declared by FeedConfigChat but not passed at its call site`).toBe(true);
    }
  });

  it("every prop DerivedConfigReview declares is passed at its FeedAutomationPanel call site", () => {
    const declared = propNamesOf(reviewSrc, "DerivedConfigReview");
    expect(declared.length, "DerivedConfigReview declares props").toBeGreaterThan(0);
    const site = callSiteOf(panelSrc, "DerivedConfigReview");
    expect(site, "a <DerivedConfigReview .../> call site in FeedAutomationPanel").not.toBeNull();
    for (const name of declared) {
      expect(passedAtSite(site, name), `${name} declared by DerivedConfigReview but not passed at its call site`).toBe(true);
    }
  });

  it("LiveFeedTab threads the config-chat plumbing (setSavedSearches + the filter catalogs) into FeedAutomationPanel", () => {
    // The reachability chain page.js -> LiveFeedTab -> FeedAutomationPanel ->
    // chat/review. The review needs setSavedSearches (to show the new search)
    // and the two filter catalogs (JobFilterControls reuse, AC2-C2). Pin that
    // LiveFeedTab forwards each of the panel's OWN declared props.
    const panelProps = propNamesOf(panelSrc, "FeedAutomationPanel");
    const site = callSiteOf(tabSrc, "FeedAutomationPanel");
    expect(site, "a <FeedAutomationPanel .../> call site in LiveFeedTab").not.toBeNull();
    for (const name of panelProps) {
      expect(
        passedAtSite(site, name),
        `${name} declared by FeedAutomationPanel but not forwarded by LiveFeedTab`,
      ).toBe(true);
    }
  });
});
