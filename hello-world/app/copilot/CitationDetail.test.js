// @vitest-environment jsdom
//
// THE FEATURE THE USER ASKED FOR, in their own words: "with the sources that
// show up under each of the overall bullets (i.e. 'From your Management
// Experience page', these should actually be hoverable, and hovering over them
// should reveal a modal that shows the page and section in question" — and
// "when the note specifies 'from your management experience page', expand it a
// bit to provide a 3-4 word blurb as to what that section summarizes/entails."
//
// ONE DELIBERATE DEVIATION FROM THE LITERAL REQUEST: it is a POPOVER, not a
// modal. MUI's Modal/Dialog/Popover all trap focus, set aria-hidden on the rest
// of the app and lock page scroll — over the sentence the candidate is reading
// aloud mid-interview. A hover-opened focus trap is unusable by construction.
// MUI Popper is a bare positioned portal with none of that.
//
// AND ONE DELIBERATE DEVIATION FROM THE SIBLING CHUNK: ExpansionPanel refuses
// to make the bullet's own sentence a button, because ButtonBase sets
// `user-select: none` and the answer text must stay selectable. That reasoning
// is about the SPOKEN sentence. The citation caption is not spoken, and the
// user asked for exactly this ("*these* should actually be hoverable"), so here
// the caption IS the control — with the three ButtonBase layout hazards that
// ruling names neutralised explicitly and measured below.
//
// WHY NOT A MUI Tooltip, restated where it can fail: a Tooltip OVERRIDES its
// child control's accessible name in this repo's MUI version
// (AnswerLines.expansion.test.js:206-211 already pays for that lesson). Here
// the trigger's accessible name IS the visible citation sentence, so a Tooltip
// would silently destroy WCAG 2.5.3 Label in Name.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme";
import { atWidth } from "@/app/theme/computedStyleAtWidth";

import CitationDetail from "./CitationDetail.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CITATION_SRC = readFileSync(path.join(process.cwd(), "app/copilot/CitationDetail.js"), "utf8");
// Source assertions are about CODE, not prose: this component's own header
// NAMES the things the sweeps forbid in order to record why they are not there.
const CITATION_CODE = CITATION_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const QUOTE = "- Built a service that ran compatibility checks against every partner release";

const LOCATED = {
  id: "p1",
  title: "Management Experience",
  located: true,
  section: "Automating compatibility checks",
  quote: QUOTE,
  quoteTruncated: false,
  outline: ["Automating compatibility checks", "Incident response"],
  outlineMore: 0,
};

const OUTLINE_ONLY = {
  id: "p2",
  title: "Payments migration",
  located: false,
  section: null,
  quote: null,
  quoteTruncated: false,
  outline: ["Cutover plan", "Incident response"],
  outlineMore: 3,
};

// A citation from before this feature existed — and the shape a page with
// neither a match nor a heading still produces today.
const BARE = { id: "p3", title: "Ledger Rebuild" };

const SENTENCE = "From your Management Experience page, under Automating compatibility checks.";
const CUT_NOTE = "This section continues beyond what is shown here.";

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(...sources) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        ...sources.map((source, i) => createElement(CitationDetail, { source, key: i })),
      ),
    );
  });
  return container;
}

const trigger = (n = 0) => container.querySelectorAll("button")[n];
const panels = () => document.querySelectorAll("[data-citation='panel']");
const panel = () => panels()[0] || null;

// React synthesises onMouseEnter/onMouseLeave from `mouseover`/`mouseout`
// (EnterLeaveEventPlugin), so a raw `mouseenter` event would never reach the
// component. These dispatch what a real browser dispatches.
async function hoverIn(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  });
}
async function hoverOut(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  });
}
async function tick(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
const useTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

// The LAST author declaration of `prop` on a rule that actually matches `el`,
// or undefined. Used only where getComputedStyle is not a valid instrument
// (see the text-align case below). Selectors jsdom's engine cannot parse
// (MUI emits `::-moz-focus-inner`) are skipped rather than allowed to throw —
// skipping a rule can only ever LOSE a declaration, never invent one.
function lastDeclared(el, prop) {
  const declared = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!rule.selectorText) continue;
      try {
        if (!el.matches(rule.selectorText)) continue;
      } catch {
        continue;
      }
      if (rule.style[prop]) declared.push(rule.style[prop]);
    }
  }
  return declared.at(-1);
}

// ---------------------------------------------------------------------------
// A. The two tiers, and the one that renders no control at all
// ---------------------------------------------------------------------------
describe("a citation with nothing to reveal renders no control", () => {
  it("renders the sentence as inert text, byte-identical to today", async () => {
    // MUTATION PROOF: render the control unconditionally and this goes red —
    // and so does AnswerLines.expansion.test.js:152, which pins ONE button per
    // <li> against a bare {id, title} fixture.
    const el = await render(BARE);
    expect(el.textContent).toBe("From your Ledger Rebuild page.");
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(el.querySelectorAll("[data-citation]")).toHaveLength(0);
    expect(panels()).toHaveLength(0);
  });

  it("renders no control for an entry whose outline is empty and which located nothing", async () => {
    const el = await render({ id: "p4", title: "Hive notes", located: false, section: null, quote: null, outline: [], outlineMore: 0 });
    expect(el.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("the sentence names the section, and only the sentence does", () => {
  it("reads 'From your X page, under Y.' with no em dash and no ellipsis", async () => {
    const el = await render(LOCATED);
    expect(el.textContent).toContain(SENTENCE);
    expect(el.textContent).not.toContain("—");
    expect(el.textContent).not.toContain("…");
  });

  it("falls back to 'From your X page.' when no section was derived", async () => {
    const el = await render(OUTLINE_ONLY);
    expect(el.textContent).toContain("From your Payments migration page.");
    expect(el.textContent).not.toContain("under");
  });
});

// ---------------------------------------------------------------------------
// B. The trigger
// ---------------------------------------------------------------------------
describe("the trigger is a real button whose name is the sentence you can see", () => {
  it("is a native <button type='button'> the app-wide focus ring reaches", async () => {
    await render(LOCATED);
    const btn = trigger();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.classList.contains("MuiButtonBase-root")).toBe(true);
  });

  it("declares no focus indicator of its own", () => {
    // The theme draws one in four longhands on .Mui-focusVisible under
    // .MuiButtonBase-root. A second ring on a different selector in shorthand
    // form silently undoes it.
    expect(CITATION_CODE).not.toContain(":focus-visible");
    expect(CITATION_CODE).not.toContain("Mui-focusVisible");
    expect(CITATION_CODE).not.toContain("boxShadow");
    // Narrowed to CSS-shaped occurrences on purpose: `outline` is also the name
    // of this feature's own data field (the page's list of headings).
    expect(CITATION_CODE).not.toMatch(/outline(?:Style|Width|Color|Offset)?\s*:/);
  });

  it("[control] the focus-indicator sweep can actually fail", () => {
    const fixture = '{ "&:focus-visible": { outlineStyle: "solid", boxShadow: "0 0 0 2px" } }';
    expect(fixture).toContain(":focus-visible");
    expect(fixture).toContain("boxShadow");
    expect(fixture).toMatch(/outline(?:Style|Width|Color|Offset)?\s*:/);
  });

  it("takes its accessible name from the visible sentence, with no aria-label and no Tooltip", async () => {
    // MUTATION PROOF: wrap the trigger in a Tooltip and the first assertion goes
    // red — which is precisely the failure this repo has already paid for once.
    await render(LOCATED);
    const btn = trigger();
    const visible = [...btn.childNodes]
      .filter((n) => !(n.nodeType === 1 && n.getAttribute("aria-hidden") === "true"))
      .map((n) => n.textContent)
      .join("");
    expect(visible).toBe(SENTENCE);
    expect(btn.getAttribute("aria-label")).toBe(null);
    expect(btn.getAttribute("title")).toBe(null);
    expect(CITATION_CODE).not.toContain("Tooltip");
    expect(CITATION_CODE).not.toContain("@mui/icons-material");
  });

  it("takes the 44px touch floor from the theme module, and it actually measures 44px", async () => {
    await render(LOCATED);
    const btn = trigger();
    const minHeightAt = (width) => atWidth(width, () => window.getComputedStyle(btn).minHeight);
    expect(minHeightAt(375)).toBe("44px");
    expect(minHeightAt(1000)).toBe("auto");
    expect(CITATION_SRC).toContain("TOUCH_TARGET_SX");
    expect(CITATION_SRC).toContain('from "@/app/theme/mobileSx"');
    expect(CITATION_SRC).not.toContain('from "./mobileSx"');
    // TOUCH_PILL_SX's own invariant forbids it where another interactive
    // control sits within 12px vertically — the expansion control sits directly
    // beneath this one.
    expect(CITATION_SRC).not.toContain("TOUCH_PILL_SX");
    expect(CITATION_SRC).not.toContain("44px");
  });

  it("declares away the ButtonBase layout hazards, measured", async () => {
    // ButtonBase uppercases, centres its content, and MUI Button floors its
    // width at 64px — all three break a wrapped caption at the app's 320px
    // floor. Measured, not swept.
    await render(LOCATED);
    const style = window.getComputedStyle(trigger());
    expect(style.textTransform).toBe("none");
    expect(style.justifyContent).toBe("flex-start");
    expect(style.minWidth).toBe("0px");
    expect(style.whiteSpace).toBe("normal");
  });

  it("declares text-align: left on the rule that actually matches the button", async () => {
    // THE INSTRUMENT FAILS FOR THIS ONE PROPERTY, so its zero is not reported
    // as a result. Measured: jsdom resolves `text-align` on a <button> to the
    // UA default "center" even when an author class rule that DOES match the
    // element declares `left` (an inline style still wins, an author class does
    // not). getComputedStyle therefore cannot arbitrate this declaration here.
    //
    // What IS measurable is the cascade's INPUT: the last matching author rule.
    // Whether the caption actually renders left-aligned at 320px is a browser
    // check (R-360).
    await render(LOCATED);
    expect(lastDeclared(trigger(), "textAlign")).toBe("left");
  });

  it("[control] the matched-rule read can actually fail", async () => {
    await render(LOCATED);
    const other = document.createElement("button");
    document.body.appendChild(other);
    expect(lastDeclared(other, "textAlign")).toBe(undefined);
    other.remove();
  });
});

// ---------------------------------------------------------------------------
// C. Hover — WCAG 1.4.13 (Content on Hover or Focus)
// ---------------------------------------------------------------------------
describe("hover opens it, and leaving closes it after the delay", () => {
  it("opens with no delay and closes 200ms after the pointer leaves", async () => {
    useTimers();
    await render(LOCATED);
    await hoverIn(trigger());
    expect(panel()).not.toBeNull();
    await hoverOut(trigger());
    await tick(199);
    expect(panel(), "the close must not be instant — the pointer needs time to travel").not.toBeNull();
    await tick(2);
    expect(panel()).toBeNull();
  });

  it("HOVERABLE: the pointer may travel onto the panel and it stays", async () => {
    // MUTATION PROOF: drop the panel's own mouseenter cancel and this goes red.
    useTimers();
    await render(LOCATED);
    await hoverIn(trigger());
    await hoverOut(trigger());
    await hoverIn(panel());
    await tick(5000);
    expect(panel()).not.toBeNull();
  });

  it("PERSISTENT: nothing closes it on a timer", async () => {
    useTimers();
    await render(LOCATED);
    await act(async () => trigger().focus());
    expect(panel()).not.toBeNull();
    await tick(60000);
    expect(panel()).not.toBeNull();
    for (const forbidden of ["enterDelay", "leaveDelay", "autoHideDuration"]) {
      expect(CITATION_CODE).not.toContain(forbidden);
    }
  });

  it("DISMISSIBLE: Escape closes it without moving focus", async () => {
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    await render(LOCATED);
    elsewhere.focus();
    await hoverIn(trigger());
    expect(panel()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

// ---------------------------------------------------------------------------
// D. Keyboard and touch
// ---------------------------------------------------------------------------
describe("focus opens it, and activation latches it", () => {
  it("opens on focus, closes on blur, and stays open once activated", async () => {
    await render(LOCATED);
    const btn = trigger();
    await act(async () => btn.focus());
    expect(panel()).not.toBeNull();
    await act(async () => btn.blur());
    expect(panel()).toBeNull();

    await act(async () => btn.focus());
    await act(async () => btn.click()); // what Enter and Space dispatch on a native button
    await act(async () => btn.blur());
    expect(panel(), "an activated panel must survive a blur").not.toBeNull();
    await act(async () => btn.click());
    expect(panel()).toBeNull();
  });

  it("TOUCH: a tap latches it against the spurious mouseleave a phone sends", async () => {
    // MUTATION PROOF: drop the latch flag and this goes red — which is the
    // phone being broken, where `hover` does not exist and `mouseleave` arrives
    // unbidden right after the tap.
    useTimers();
    await render(LOCATED);
    const btn = trigger();
    await act(async () => btn.click());
    expect(panel()).not.toBeNull();
    await hoverOut(btn);
    await tick(5000);
    expect(panel()).not.toBeNull();
    await act(async () => btn.click());
    expect(panel()).toBeNull();
  });

  it("closes on a click outside it", async () => {
    await render(LOCATED);
    await act(async () => trigger().click());
    expect(panel()).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(panel()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E. ARIA
// ---------------------------------------------------------------------------
describe("state is announced and aria-controls never dangles", () => {
  it("sets aria-controls only while the panel exists", async () => {
    await render(LOCATED);
    const btn = trigger();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe(null);
    await act(async () => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const id = btn.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id)).not.toBeNull();
  });

  it("gives three citations on one screen three distinct panel ids", async () => {
    await render(LOCATED, { ...LOCATED, id: "pa" }, { ...LOCATED, id: "pb" });
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      await act(async () => container.querySelectorAll("button")[i].click());
      ids.push(container.querySelectorAll("button")[i].getAttribute("aria-controls"));
    }
    expect(new Set(ids).size).toBe(3);
    // Never derived from a model- or user-supplied string.
    expect(CITATION_CODE).toContain("useId");
    expect(CITATION_CODE).not.toMatch(/id=\{[^}]*source\./);
  });

  it("does not mount the panel while it is closed", async () => {
    // A hidden-but-mounted panel is read by screen readers and inflates every
    // count the sibling expansion chunk's tests take.
    await render(LOCATED);
    expect(panels()).toHaveLength(0);
    expect(CITATION_CODE).not.toContain("keepMounted");
  });
});

// ---------------------------------------------------------------------------
// F. What the panel says — the safety argument
// ---------------------------------------------------------------------------
describe("the panel shows the evidence, and says which tier it is", () => {
  it("LOCATED: the page, the section, the matched block verbatim, and the honest status line", async () => {
    // THE WHOLE SAFETY ARGUMENT. "This block is where the point came from" is
    // an INFERENCE, not a fact. The candidate can only falsify it if the words
    // are on screen. Do not drop the quote for space.
    await render(LOCATED);
    await act(async () => trigger().click());
    const text = panel().textContent;
    expect(text).toContain("Management Experience");
    expect(text).toContain("Under Automating compatibility checks.");
    expect(text).toContain(QUOTE);
    expect(text).toContain("These words appear on this page word for word.");
    expect(text).not.toContain("could not match");
  });

  it("PAGE: says plainly that it could not match, then lists the page's own sections", async () => {
    // MUTATION PROOF: render the LOCATED status line in both branches and this
    // goes red.
    await render(OUTLINE_ONLY);
    await act(async () => trigger().click());
    const text = panel().textContent;
    expect(text).toContain("We could not match this line word for word to one part of this page.");
    expect(text).toContain("Sections on this page:");
    expect(text).toContain("Cutover plan");
    expect(text).toContain("Incident response");
    expect(text).toContain("and 3 more.");
    expect(text).not.toContain("word for word to one part of this page. These words");
  });

  it("says when the quote was cut", async () => {
    await render({ ...LOCATED, quoteTruncated: true });
    await act(async () => trigger().click());
    expect(panel().textContent).toContain(CUT_NOTE);
    // A literal in the component, never an import of knowledgeBase.js's
    // EXCERPT_HEADING_SUFFIX: that constant is MODEL-facing and byte-locked by
    // its own tests, and must not gain a human reader.
    expect(CITATION_CODE).not.toContain("EXCERPT_HEADING_SUFFIX");
  });

  it("does not say it when the quote was whole", async () => {
    await render(LOCATED);
    await act(async () => trigger().click());
    expect(panel().textContent).not.toContain(CUT_NOTE);
  });

  it("portals the panel out of the answer list entirely", async () => {
    await render(LOCATED);
    await act(async () => trigger().click());
    expect(document.body.contains(panel())).toBe(true);
    expect(container.contains(panel())).toBe(false);
    expect(panel().closest("li")).toBe(null);
    expect(CITATION_CODE).not.toContain("disablePortal");
  });
});

// ---------------------------------------------------------------------------
// G. What this component may never contain
// ---------------------------------------------------------------------------
describe("no bold, no italic, no link, no icon, no raw colour, no request", () => {
  it("emits no <strong>, <b> or <em>, open or closed", async () => {
    // Six assertions in AnswerLines.emphasis.test.js — a file this chunk may not
    // touch — count <strong> with a DESCENDANT selector.
    await render(LOCATED);
    await act(async () => trigger().click());
    expect(document.querySelectorAll("[data-citation] strong, [data-citation] b, [data-citation] em")).toHaveLength(0);
    expect(container.querySelectorAll("strong, b, em")).toHaveLength(0);
    expect(CITATION_CODE).not.toMatch(/<strong|<b>|<em[\s>]/);
  });

  it("has no link, no icon and no raw colour value", () => {
    // No link to the page: navigating away from the answer mid-interview is the
    // wrong affordance, and it keeps this feature clear of
    // app/components/hrefSafety.sweep.test.js's gate entirely.
    expect(CITATION_CODE).not.toContain("href");
    expect(CITATION_CODE).not.toContain("<a ");
    expect(CITATION_CODE).not.toContain("--text-muted"); // 3.90:1 on this fill (R-228)
    expect(CITATION_CODE).not.toContain("--danger");
    expect(CITATION_CODE).not.toMatch(/rgb\(|rgba\(|hsl\(|#[0-9a-fA-F]{3,8}\b/);
    expect(CITATION_SRC).toContain("--text-secondary");
  });

  it("never scrolls anything into view and never sticks", () => {
    expect(CITATION_SRC).not.toContain("scrollIntoView");
    expect(CITATION_CODE).not.toContain('position: "sticky"');
  });

  it("issues no request, ever — the falsifiable form of 'no new route'", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(LOCATED, OUTLINE_ONLY, BARE);
    for (const btn of container.querySelectorAll("button")) {
      await hoverIn(btn);
      await act(async () => btn.focus());
      await act(async () => btn.click());
      await act(async () => btn.click());
      await hoverOut(btn);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(CITATION_CODE).not.toContain("fetch");
    vi.unstubAllGlobals();
  });
});
