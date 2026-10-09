// @vitest-environment jsdom
//
// N144b A3 rider — stabilise the NON-SILENT hearing-strip height on a phone.
// The landed LiveHearingStrip.mobile.test.js (F-05) scoped the two-line clamp
// to `up("sm")` so a phone never clips the actionable half of the SILENT
// diagnostic. But that also left the NON-silent strip free to grow 1–5 lines
// with every interim STT frame, so the whole stack below it jitters on every
// partial word. A3 clamps the NON-silent message to two lines at xs too, while
// leaving the silent branch exactly as F-05 shipped it (plan §2.2 A3, §3.1,
// ledger L16).
//
// WHAT THIS FILE PROVES. jsdom has no layout, so (like F-05) nothing here
// measures a height. It reads the DECLARED cascade with the same two
// instruments F-05 uses: `atWidth` + getComputedStyle for the responsive value,
// plus a direct stylesheet scan so a clamp hidden in a `max-width` rule (which
// atWidth cannot see) cannot read as a pass. The instruments are copied from
// LiveHearingStrip.mobile.test.js verbatim, with its own instrument-control.
//
// RED on HEAD: today the clamp is state-independent and bounded `up("sm")`, so
// the NON-SILENT message is NOT clamped at 375 — the first case below is red
// until A3 lands. The SILENT-at-375-unclamped case is the NEGATIVE CONTROL /
// regression guard: it is green on HEAD and must STAY green (it also kills the
// "A3 clamps the silent branch too" mutant, alongside the landed F-05 file).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import LiveHearingStrip from "./LiveHearingStrip.js";
import { HEARD_NOTHING_AFTER_MS } from "@/lib/copilot/liveHearing";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_000_000;

// "heard" (non-silent): an active interim is the earliest proof audio flows,
// so this never crosses the silence threshold regardless of the clock.
const NONSILENT_PROPS = {
  live: true,
  finals: [],
  interims: { them: "tell me about a time you debugged something hard and what the root cause turned out to be" },
  startedAt: T0,
  liveSince: T0,
  now: T0 + 1_000,
  speakerSnapshot: {},
  source: "inperson",
};

// The silent branch, verbatim from the landed F-05 file — the negative control.
const SILENT_PROPS = {
  live: true,
  finals: [],
  interims: {},
  startedAt: T0,
  liveSince: T0,
  now: T0 + HEARD_NOTHING_AFTER_MS + 1_000,
  speakerSnapshot: {},
  source: "inperson",
};

let container;
let root;

async function render(props) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(LiveHearingStrip, props)));
  });
}

const message = () => container.querySelector(".MuiAlert-message");

function clampAt(width) {
  return atWidth(width, () => {
    const style = window.getComputedStyle(message());
    return {
      display: style.display,
      overflow: style.overflow,
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
    };
  });
}

// Copied verbatim from LiveHearingStrip.mobile.test.js — every rule that
// actually MATCHES `el`, with its media condition. See that file's header for
// why matching (not a class substring) and `Array.from` are both load-bearing.
function rulesFor(el) {
  const out = [];
  const walk = (rules, condition) => {
    for (const rule of Array.from(rules)) {
      if (rule.constructor.name === "CSSMediaRule") {
        walk(rule.cssRules, (rule.conditionText || rule.media.mediaText || "").trim());
        continue;
      }
      if (!rule.selectorText) continue;
      try {
        if (!el.matches(rule.selectorText)) continue;
      } catch {
        continue;
      }
      out.push({ condition, selector: rule.selectorText, text: rule.cssText });
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, "");
    } catch {
      continue;
    }
  }
  return out;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("A3: the NON-silent hearing strip is clamped to two lines at xs", () => {
  it("[control] the non-silent branch really renders the interim as the visible message", async () => {
    await render(NONSILENT_PROPS);
    expect(message().textContent).toBe(
      "Them: tell me about a time you debugged something hard and what the root cause turned out to be",
    );
  });

  it("[instrument control] rulesFor() reaches the rules that style the message element", async () => {
    await render(NONSILENT_PROPS);
    const rules = rulesFor(message());
    // MUI's own AlertMessage rule sets `padding: 8px 0`. If the helper cannot
    // see that, its clamp answers below mean nothing.
    expect(rules.some((r) => /padding/.test(r.text)), "instrument sees no rules for .MuiAlert-message").toBe(true);
  });

  it("at 375 the non-silent message IS clamped: -webkit-box, line-clamp 2, hidden (RED on HEAD)", async () => {
    await render(NONSILENT_PROPS);
    expect(clampAt(375)).toEqual({ display: "-webkit-box", overflow: "hidden", lineClamp: "2" });
  });

  it("at 1000 the non-silent clamp is still present (not removed at desktop)", async () => {
    await render(NONSILENT_PROPS);
    const at1000 = clampAt(1000);
    expect(at1000.display).toBe("-webkit-box");
    expect(at1000.lineClamp).toBe("2");
  });
});

describe("A3 negative control: the SILENT branch stays unclamped at xs (F-05 preserved)", () => {
  it("at 375 the silent message is NOT clamped — the actionable half is never cut on a phone", async () => {
    await render(SILENT_PROPS);
    const at375 = clampAt(375);
    expect(at375.display).not.toBe("-webkit-box");
    expect(at375.lineClamp === "" || at375.lineClamp === "none").toBe(true);
    expect(at375.overflow).toBe("auto");
  });

  it("the silent clamp is still declared only under (min-width:600px) — never at xs, never max-width", async () => {
    await render(SILENT_PROPS);
    const clampRules = rulesFor(message()).filter((r) => /-webkit-line-clamp/.test(r.text));
    expect(clampRules.length).toBeGreaterThan(0);
    for (const rule of clampRules) {
      expect(rule.condition, `silent clamp declared under: ${JSON.stringify(rule.condition)}`).toBe("(min-width:600px)");
    }
  });

  it("the screen-reader role=alert region carries the full unclamped silence string", async () => {
    await render(SILENT_PROPS);
    const alertRegion = container.querySelector('[role="alert"]');
    expect(alertRegion).toBeTruthy();
    expect(alertRegion.textContent).toContain("Check that your microphone is selected and not muted.");
    // The visually-hidden region is never clamped (no -webkit-box on it).
    expect(window.getComputedStyle(alertRegion).display).not.toBe("-webkit-box");
  });
});
