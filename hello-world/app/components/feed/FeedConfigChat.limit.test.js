// @vitest-environment jsdom
//
// N60 SECOND CHUNK, Step D (4b) -- AC2-S6's UI half (brief item 6). The chat
// route is bounded at one turn per ten minutes (12 / 600_000 ms, landed Step C).
// When the candidate hits that limit the surface must SHOW it -- a "too many
// messages, try again shortly" state -- never a silent no-op or a spinner that
// spins forever. A dead input teaches the user the product is broken.
//
// Driven the real way: mount FeedAutomationPanel, type, send, and let the
// stubbed /api/feed-config/chat answer 429. We assert (a) a visible limit
// message, (b) NO derived-config review is shown (the turn did not silently
// "succeed"), and (c) the send control is usable again (not stuck disabled /
// no perpetual spinner). The CONTROL below runs the same harness against a 200
// response and gets a review -- so the limit case cannot pass against a build
// that ALWAYS shows an error.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import FeedAutomationPanel from "./FeedAutomationPanel.js";

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

const CONFIG = {
  name: "Backend roles",
  jobKeywords: ["backend"],
  maxYearsExp: "any",
  selectedCategories: [],
  selectedCompanies: [],
  excludedCompanies: [],
  excludedTitleKeywords: [],
  autoTailorMinIntervalMinutes: 60,
  emailOnNewJobs: false,
};

let chatStatus; // 200 | 429
let unhandled;

function installFetch() {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.startsWith("/api/feed-config/chat")) {
      if (chatStatus === 429) {
        return Promise.resolve({ ok: false, status: 429, json: async () => ({ error: "Too many messages" }) });
      }
      return json({ config: CONFIG });
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

async function sendOne(message = "backend jobs") {
  const input = chatInput();
  expect(input, "a chat message box").toBeTruthy();
  await typeInto(input, message);
  const send = sendButton();
  expect(send, "a send control").toBeTruthy();
  await click(send);
  await settle();
}

beforeEach(() => {
  chatStatus = 200;
  unhandled = [];
  process.on?.("unhandledRejection", (e) => unhandled.push(e));
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

describe("AC2-S6 UI half: hitting the chat limit shows a visible message, not a dead input", () => {
  it("a 429 renders a visible rate-limit message and NO review", async () => {
    chatStatus = 429;
    await mountPanel();
    await sendOne();
    const text = (container.textContent || "").toLowerCase();
    // A human-readable limit message -- the exact wording is the design's, but
    // it must signal "too fast / wait / too many", not vanish.
    expect(
      /too (many|fast)|slow down|try again|moment|shortly|rate|wait a/i.test(text),
      "a visible rate-limit message after a 429",
    ).toBe(true);
    // The turn did NOT silently succeed: no derived config shown.
    expect(container.textContent, "no review is produced by a rejected turn").not.toContain(CONFIG.name);
    // The send control is still usable (not stuck disabled / perpetual spinner).
    const send = sendButton();
    expect(send, "the send control still exists after the limit").toBeTruthy();
    expect(send.disabled, "the send control is not left permanently disabled").toBe(false);
    expect(unhandled, "the 429 is handled, not thrown as an unhandled rejection").toHaveLength(0);
  });

  it("CONTROL: a 200 turn produces a review and NO limit message", async () => {
    // Proves the harness can produce the success state, so the 429 case is not
    // passing against a build that always shows an error / never shows a review.
    chatStatus = 200;
    await mountPanel();
    await sendOne();
    expect(container.textContent, "a successful turn shows the derived config").toContain(CONFIG.name);
    expect(
      /too (many|fast)|slow down|rate limit/i.test((container.textContent || "").toLowerCase()),
      "no limit message on a successful turn",
    ).toBe(false);
  });
});
