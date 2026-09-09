// @vitest-environment jsdom
//
// MOBILE-G F-05 — the "what is the copilot hearing" strip's two-line clamp,
// scoped so it stops deleting the actionable half of the diagnostic on a
// phone.
//
// WHAT WAS MEASURED, AND WHERE. jsdom has no layout engine, so nothing in
// this file measures a height, a line count or an overflow. The clipping that
// motivates the change was measured in a REAL browser (Chrome, Manrope
// loaded, the component's own serialized emotion CSS and its own DOM, the
// live-mode root box's `p: { xs: 1.5 }` = 12px gutters from
// CopilotClient.js:564), against the worst-case silent string
// `hearingState()` can produce plus `silenceHint("inperson")` — 134 chars:
//
//     viewport   .MuiAlert-message   clientHeight / scrollHeight   clipped
//     320x812    230px wide          56 / 116                      60px (3 of 5 lines)
//     375x812    285px wide          56 / 96                       40px (2 of 4 lines)
//     430x812    340px wide          56 / 76                       20px (1 of 3 lines)
//     900x812    810px wide          56 / 56                       0px
//
// At 375 the clipped half is exactly "Check that your microphone is selected
// and not muted." — the only sentence on the screen that tells the user what
// to DO about a deaf session. A sweep at 10px steps put the last clipping
// width at 540 and the first clean one at 550, so `up("sm")` (600) leaves a
// ~50px margin and no residual clipping band between the fix and the clamp.
// Screen-reader users were never affected: LiveHearingStrip.js's `role="alert"`
// region carries the full, unclamped string and is asserted by
// LiveHearingStrip.test.js.
//
// WHAT THIS FILE CAN PROVE is that the clamp is DECLARED behind a real
// `min-width` bound rather than applying everywhere. Two independent
// instruments, because each misses what the other catches:
//
//   1. `atWidth` + getComputedStyle — the serialized cascade, read back the
//      way a browser would resolve it. This is the instrument that would
//      catch a clamp keyed `{ xs: ..., sm: undefined }`, the repo's recorded
//      "a breakpoint key of undefined does not switch a rule off" trap: such
//      a rule still reads back clamped at 375.
//   2. A direct stylesheet scan — `atWidth` can only rewrite `min-width`
//      media rules (see computedStyleAtWidth.js's own LIMIT note), so a
//      clamp that reappeared inside a `max-width` rule would be invisible to
//      instrument 1 at EVERY width (jsdom evaluates `max-width` as false
//      always) and would read back as a passing "not clamped at 375". The
//      scan reads the rule text itself, so it sees where the declaration
//      actually lives.

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

let container;
let root;

// The silent branch, which is the one that carries the two-sentence string:
// no interims, no finals, and a clock already past the silence threshold.
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

async function render(props = SILENT_PROPS) {
  await act(async () => {
    root.render(
      createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(LiveHearingStrip, props)),
    );
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

// Every rule in the document that actually MATCHES `el`, paired with the
// media condition it sits under ("" for a top-level rule).
//
// Matching, not a class-name substring: the clamp is written as
// `"& .MuiAlert-message"` inside the ALERT ROOT's `sx`, so emotion emits
// `.css-<rootHash> .MuiAlert-message` — a selector carrying the root's class,
// not the message's. A helper that looked for the message element's own
// emotion class (the first version of this one did) finds zero rules and
// reports the clamp as absent no matter where it is declared: a fabricated
// pass once the `toBeGreaterThan(0)` guard below is satisfied by anything
// else. Selectors jsdom's engine cannot parse are skipped rather than allowed
// to throw — skipping can only ever LOSE a rule, never invent one, and the
// non-emptiness guard below is what stops a total loss from reading as a pass.
//
// NOTE the `Array.from`: a raw CSSRuleList is not iterable in jsdom, and a
// `for...of` over one silently yields nothing — the same fabricated-pass
// failure by a different route.
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
      continue; // a sheet with no readable rules; there are none here
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
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("F-05: the two-line clamp does not apply on a phone", () => {
  it("[control] the silent branch really does render the two-sentence string the measurement was taken against", async () => {
    await render();
    // If this ever shortens, the browser measurement in this file's header
    // stops describing the shipped string and the whole case has to be
    // re-taken. 134 chars at 285px of message box is 4 lines.
    expect(message().textContent).toBe(
      "No speech has been detected in a while. The copilot may not be hearing anything. " +
        "Check that your microphone is selected and not muted.",
    );
  });

  it("at 375 the message is not clamped: no -webkit-box, no line-clamp, and MUI's own overflow", async () => {
    await render();
    const at375 = clampAt(375);
    expect(at375.display).not.toBe("-webkit-box");
    expect(at375.lineClamp === "" || at375.lineClamp === "none").toBe(true);
    // MUI's own AlertMessage styled rule sets `overflow: auto`; that is the
    // value that must show through once the clamp's `hidden` is gone.
    expect(at375.overflow).toBe("auto");
  });

  it("at 1000 the clamp is unchanged — two lines, -webkit-box, hidden", async () => {
    await render();
    expect(clampAt(1000)).toEqual({ display: "-webkit-box", overflow: "hidden", lineClamp: "2" });
  });

  it("[instrument control] rulesFor() actually reaches the rules that style the message element", async () => {
    await render();
    const rules = rulesFor(message());
    // MUI's own AlertMessage styled rule sets `padding: 8px 0`. If the helper
    // cannot even see that, its "no clamp found" answer below means nothing.
    expect(rules.some((r) => /padding/.test(r.text)), "instrument sees no rules for .MuiAlert-message").toBe(true);
  });

  it("the clamp is declared under a min-width bound, never at top level and never under max-width", async () => {
    await render();
    const clampRules = rulesFor(message()).filter((r) => /-webkit-line-clamp/.test(r.text));
    expect(clampRules.length).toBeGreaterThan(0);
    for (const rule of clampRules) {
      // `(min-width:0px)` is MUI's `xs`, which matches at EVERY width — the
      // repo's "a breakpoint key of undefined does not switch a rule off"
      // trap. A bare "" (top level) is the same defect without the media
      // wrapper. A `max-width` condition would be invisible to `atWidth`
      // above, so it is banned here rather than relied on being caught there.
      expect(rule.condition, `clamp declared under: ${JSON.stringify(rule.condition)}`).toBe(
        "(min-width:600px)",
      );
    }
  });
});
