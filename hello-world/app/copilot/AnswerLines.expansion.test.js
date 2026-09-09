// @vitest-environment jsdom
//
// THE FEATURE THE USER ASKED FOR: "the answer appears (either live or
// practice), and I need to go more in depth on one of the bullets. i click
// that bullet, and that bullet expands to reveal sub bullets that describe in
// further detail on that overall bullet's answer."
//
// ONE DELIBERATE DEVIATION FROM THE LITERAL REQUEST, and it is the one thing
// here worth an owner's ruling: the bullet's own SENTENCE is not the button.
// The control is a row directly under it whose accessible name names the
// bullet. Three measured reasons: MUI ButtonBase sets `user-select: none`, so
// the answer text would stop being selectable mid-interview; ButtonBase is a
// centred inline-flex, which breaks a multi-sentence paragraph at the app's
// 320px floor; and the no-cue rendering has no head to wrap.
//
// THE INVARIANT THAT COSTS THE MOST IF IT BREAKS. AnswerLines.emphasis.test.js
// counts `li.querySelectorAll("strong")` with a DESCENDANT selector and pins
// it at exactly 1 on the emphasis branch and exactly 0 on the bare branch. So
// a single `<strong>` anywhere inside an expanded panel fails six existing
// assertions in a file this chunk is not allowed to touch. Nothing in the
// expansion subtree may be `<strong>`, `<b>` or `<em>`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

import AnswerLines from "./AnswerLines.js";
import { ExpansionScope } from "./useAnswerExpansions.js";
import { resetExpansionStore } from "@/lib/copilot/expansionStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PANEL_SRC = readFileSync(path.join(process.cwd(), "app/copilot/ExpansionPanel.js"), "utf8");
const LINES_SRC = readFileSync(path.join(process.cwd(), "app/copilot/AnswerLines.js"), "utf8");
// Source assertions are about CODE, not prose. This file's own header, and the
// panel's, NAME the things the sweeps below forbid in order to say why they are
// not there, so a raw grep would fail on the documentation that prevents the
// defect. The ask route's suite takes exactly this precaution for the same
// reason.
const PANEL_CODE = PANEL_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// THE TOP-LEVEL BULLETS ONLY. `"ul > li"` is ambiguous the moment a bullet is
// expanded, because a sub-bullet is also a `ul > li`; using it would make
// "leaves every sibling untouched" pass by counting the wrong five elements.
function topItems(rootEl) {
  const list = rootEl.querySelector("ul");
  return list ? [...list.querySelectorAll(":scope > li")] : [];
}

const LINES = [
  {
    label: "Situation",
    cue: "",
    // THE EMPHASISED RUN IS DELIBERATELY PAST THE EIGHTH WORD. The accessible
    // name falls back to the point's first eight words when there is no run,
    // so a run inside those eight words makes the emphasis branch untestable:
    // measured, deleting the branch left this file green with a run over
    // "rebuilt the ledger". "finally contained" is word nine and ten.
    point: "I rebuilt the ledger after the settlement outage was finally contained.",
    pageSource: { id: "p1", title: "Payments migration" },
    emphasis: { start: 53, end: 70 },
    sourceIndex: 0,
  },
  {
    label: "Action",
    cue: "paged the on-call",
    point: "I paged the on-call team during the incident.",
    pageSource: null,
    emphasis: null,
    sourceIndex: 1,
  },
  {
    label: "",
    cue: "",
    point: "I ran the postmortem with the payments group the next morning.",
    pageSource: null,
    emphasis: null,
    sourceIndex: 2,
  },
];

// The one exclusion mechanism, used by every assertion that has to read "the
// bullet's own text". Done by hand five different ways it would drift; here it
// is one helper keyed on one attribute the panel puts on each of its roots.
function bare(li) {
  const clone = li.cloneNode(true);
  clone.querySelectorAll("[data-expansion]").forEach((n) => n.remove());
  return clone.textContent;
}

// A controllable stand-in for what useAnswerExpansions returns, so the render
// contract can be tested without a network or a store.
function fakeApi(initial = {}) {
  const open = new Set();
  const records = new Map();
  const calls = [];
  const api = {
    get: (line) => records.get(line.point) || { status: "idle", subBullets: [], caption: "", code: null },
    isOpen: (line) => open.has(line.point),
    toggle: (line) => {
      calls.push(["toggle", line.point]);
      if (open.has(line.point)) open.delete(line.point);
      else open.add(line.point);
    },
    retry: (line) => calls.push(["retry", line.point]),
  };
  for (const [point, record] of Object.entries(initial)) {
    records.set(point, record);
    open.add(point);
  }
  return { api, open, records, calls };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  resetExpansionStore();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function render(element) {
  await act(async () => {
    root.render(element);
  });
  return container;
}

const withApi = (api, lines = LINES) => createElement(AnswerLines, { lines, expansion: api });

// ---------------------------------------------------------------------------
// A. The control
// ---------------------------------------------------------------------------
describe("one control per bullet, and none without an api", () => {
  it("renders exactly one control per top-level <li>", async () => {
    const { api } = fakeApi();
    const el = await render(withApi(api));
    const items = topItems(el);
    expect(items).toHaveLength(3);
    for (const li of items) expect(li.querySelectorAll("button")).toHaveLength(1);
  });

  it("renders NOTHING extra without an api, which is what keeps the existing render tests green", async () => {
    const el = await render(createElement(AnswerLines, { lines: LINES }));
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(el.querySelectorAll("[data-expansion]")).toHaveLength(0);
  });

  it("renders zero controls and zero <li> for an empty answer", async () => {
    const { api } = fakeApi();
    const el = await render(withApi(api, []));
    expect(el.querySelectorAll("li")).toHaveLength(0);
    expect(el.querySelectorAll("button")).toHaveLength(0);
  });

  it("is a real native <button type='button'> that the app-wide focus ring reaches", async () => {
    // BOTH halves are load-bearing. The native element is what gives Enter and
    // Space activation for free, and the app's focus ring is a MuiButtonBase
    // style override keyed on the class MUI emits -- a bare styled <button>
    // gets NO focus ring in this app, and ButtonBase sets `outline: 0` on
    // itself, so there would be nothing at all.
    const { api } = fakeApi();
    const el = await render(withApi(api));
    const control = el.querySelector("li button");
    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("type")).toBe("button");
    expect(control.classList.contains("MuiButtonBase-root")).toBe(true);
  });

  it("declares no focus indicator of its own", () => {
    // The theme already draws one, in four longhands, on the class above. A
    // second ring on a different selector in shorthand form silently undoes
    // that deliberate choice.
    for (const forbidden of [":focus-visible", "Mui-focusVisible", "outline", "boxShadow"]) {
      expect(PANEL_SRC).not.toContain(forbidden);
    }
  });

  it("[control] the focus-indicator sweep can actually fail", () => {
    const fixture = '{ "&:focus-visible": { outline: "2px solid var(--accent)" } }';
    expect(fixture).toContain(":focus-visible");
    expect(fixture).toContain("outline");
  });

  it("takes the 44px touch floor from the theme module, not the re-export shim", () => {
    expect(PANEL_SRC).toContain("TOUCH_TARGET_SX");
    expect(PANEL_SRC).toContain('from "@/app/theme/mobileSx"');
    expect(PANEL_SRC).not.toContain('from "./mobileSx"');
    // Its own invariant forbids it where another control sits within 12px
    // vertically, and six bullets put controls far closer than that.
    expect(PANEL_SRC).not.toContain("TOUCH_PILL_SX");
  });

  it("has no Tooltip and no icon font anywhere in the panel", () => {
    // A MUI Tooltip OVERRIDES a control's accessible name in this repo's MUI
    // version, which would silently undo the aria-label assertions below.
    expect(PANEL_SRC).not.toContain("Tooltip");
    expect(PANEL_SRC).not.toContain("@mui/icons-material");
  });
});

// ---------------------------------------------------------------------------
// B. The accessible name
// ---------------------------------------------------------------------------
describe("the control says WHICH bullet it opens", () => {
  it("names each bullet distinctly, and every name starts with the visible label", async () => {
    // WCAG 2.5.3 Label in Name: a speech-input user says what they can see.
    const { api } = fakeApi();
    const el = await render(withApi(api));
    const labels = [...el.querySelectorAll("li button")].map((b) => b.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.startsWith("More detail")).toBe(true);
  });

  it("prefers the emphasised run, then the cue, then the point's first words", async () => {
    // After the truncation chunk, `cue` is "" on the ordinary case and the
    // EMPHASISED RUN carries the words the cue used to -- in the point's own
    // case, already computed. It is a better short name than eight arbitrary
    // words, so it is used when it is there.
    // MUTATION PROOF: delete the emphasis branch; the first case goes red.
    const { api } = fakeApi();
    const el = await render(withApi(api));
    const labels = [...el.querySelectorAll("li button")].map((b) => b.getAttribute("aria-label"));
    expect(labels[0]).toContain("finally contained");
    expect(labels[0]).not.toContain("I rebuilt the ledger after"); // not the fallback
    expect(labels[1]).toContain("paged the on-call");
    expect(labels[2]).toContain("I ran the postmortem with the payments group");
  });

  it("keeps the VISIBLE label identical in both states", async () => {
    const { api } = fakeApi();
    const el = await render(withApi(api));
    const control = el.querySelector("li button");
    const visible = (btn) =>
      [...btn.childNodes]
        .filter((n) => !(n.nodeType === 1 && n.getAttribute("aria-hidden") === "true"))
        .map((n) => n.textContent)
        .join("");
    const collapsed = visible(control);
    await act(async () => control.click());
    await render(withApi(api));
    expect(visible(container.querySelector("li button"))).toBe(collapsed);
  });

  it("renders without throwing when a line carries no cue, label or emphasis", async () => {
    const { api } = fakeApi();
    const el = await render(withApi(api, [{ label: "", cue: "", point: "Short.", pageSource: null }]));
    expect(el.querySelector("li button").getAttribute("aria-label")).toContain("Short.");
  });
});

// ---------------------------------------------------------------------------
// C. Expanding
// ---------------------------------------------------------------------------
describe("clicking a bullet reveals sub-bullets under THAT bullet", () => {
  const DONE = {
    status: "done",
    caption: "Found on this server with no AI provider in your Payments migration page.",
    subBullets: [
      { text: "I reconciled every settlement by hand for a week.", pageSource: { id: "p1", title: "Payments migration" }, source: null },
      { text: "I wrote the replay script that closed the gap.", pageSource: null, source: null },
    ],
  };

  it("puts the nested <ul> INSIDE the same <li>, as a direct child", async () => {
    // A direct child, which is why there is no MUI <Collapse>: it renders
    // three intervening <div>s, so `:scope > ul` returns null and a screen
    // reader walks a different tree from the one the design describes.
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    expect(li.querySelector(":scope > ul > li")).not.toBeNull();
    expect(li.querySelectorAll(":scope > ul > li")).toHaveLength(2);
    for (const child of li.querySelector(":scope > ul").children) expect(child.tagName).toBe("LI");
  });

  it("leaves every sibling bullet untouched", async () => {
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    const items = topItems(el);
    expect(items).toHaveLength(3);
    expect(items[1].querySelector("ul")).toBeNull();
    expect(items[2].querySelector("ul")).toBeNull();
  });

  it("does not change the parent bullet's own text", async () => {
    const plain = await render(createElement(AnswerLines, { lines: LINES }));
    const before = [...topItems(plain)].map((li) => li.textContent);
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    const after = [...topItems(el)].map(bare);
    expect(after).toEqual(before);
    // MUTATION PROOF: render the panel ABOVE the point instead of after it;
    // this goes red. Note it is a comparison of two renders, never a literal
    // expected string -- the label's position differs per branch, so there is
    // no single literal that could stay correct.
  });

  it("keeps the citation exactly where it was, before the control", async () => {
    // The citation is visible with zero extra clicks and is never moved behind
    // a disclosure. DOM order inside the <li> is text, citation, control,
    // panel.
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    const kids = [...li.children];
    const citationAt = kids.findIndex((k) => k.textContent.startsWith("From your Payments migration"));
    const controlAt = kids.findIndex((k) => k.querySelector("button"));
    const panelAt = kids.findIndex((k) => k.tagName === "UL");
    expect(citationAt).toBeGreaterThan(-1);
    expect(citationAt).toBeLessThan(controlAt);
    expect(controlAt).toBeLessThan(panelAt);
  });

  it("adds NO <strong>, <b> or <em> anywhere in the expansion subtree", async () => {
    // Six assertions in AnswerLines.emphasis.test.js -- a file this chunk may
    // not touch -- count <strong> with a descendant selector.
    // MUTATION PROOF: bold the control's label; both counts go wrong.
    const { api } = fakeApi({ [LINES[0].point]: DONE, [LINES[2].point]: DONE });
    const el = await render(withApi(api));
    const items = topItems(el);
    expect(items[0].querySelectorAll("strong")).toHaveLength(1); // the emphasis branch's own
    expect(items[2].querySelectorAll("strong")).toHaveLength(0); // the bare branch has none
    for (const li of items) {
      expect(li.querySelectorAll("[data-expansion] strong, [data-expansion] b, [data-expansion] em")).toHaveLength(0);
    }
    expect(PANEL_CODE).not.toMatch(/<strong|<b>|<em[\s>]/);
  });

  it("marks its own subtree so the exclusion above is mechanical, not by hand", async () => {
    // MUTATION PROOF: drop data-expansion; the exclusion no-ops and the
    // "does not change the parent bullet's own text" comparison goes red.
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    expect(li.querySelectorAll(":scope > [data-expansion]").length).toBeGreaterThan(0);
  });

  it("carries the caption and each sub-bullet's own citation", async () => {
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    const subs = li.querySelectorAll(":scope > ul > li");
    expect(subs[0].textContent).toContain("From your Payments migration page.");
    expect(subs[1].textContent).not.toContain("From your");
    expect(li.textContent).toContain("no AI provider");
  });

  it("never nests a third level", async () => {
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    expect(li.querySelectorAll(':scope > ul > li [aria-expanded]')).toHaveLength(0);
  });

  it("sets no listStyle and no list role on either list", async () => {
    // With no listStyle set, the UA's own `ul ul { list-style-type: circle }`
    // distinguishes the two levels by marker SHAPE rather than colour, for
    // free. `listStyle: "none"` would additionally cost the list its role in
    // WebKit; role="presentation"/"none" propagates to the <li>s.
    const { api } = fakeApi({ [LINES[0].point]: DONE });
    const el = await render(withApi(api));
    for (const ul of el.querySelectorAll("ul")) {
      expect(ul.getAttribute("role")).toBeNull();
      expect(ul.style.listStyle).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// D. aria-expanded, aria-controls, and the second click
// ---------------------------------------------------------------------------
describe("state is announced, and the second click collapses", () => {
  it("starts collapsed, with no aria-controls pointing at nothing", async () => {
    // aria-controls is set ONLY when the panel exists. There is no <Collapse>
    // and no hidden panel, so a collapsed aria-controls would be a dangling
    // IDREF, which is invalid ARIA rather than merely untidy.
    const { api } = fakeApi();
    const el = await render(withApi(api));
    for (const btn of el.querySelectorAll("li button")) {
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      expect(btn.getAttribute("aria-controls")).toBeNull();
    }
    expect(el.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0);
  });

  it("flips aria-expanded and a non-colour glyph together", async () => {
    const { api } = fakeApi({ [LINES[0].point]: { status: "done", subBullets: [{ text: "x", pageSource: null }], caption: "" } });
    const el = await render(withApi(api));
    const btn = el.querySelectorAll("li button")[0];
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const glyph = btn.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    const openGlyph = glyph.textContent;
    const collapsed = el.querySelectorAll("li button")[1];
    expect(collapsed.querySelector('[aria-hidden="true"]').textContent).not.toBe(openGlyph);
  });

  it("resolves aria-controls to an element that is actually there", async () => {
    for (const record of [
      { status: "done", subBullets: [{ text: "x", pageSource: null }], caption: "" },
      { status: "loading", subBullets: [], caption: "" },
      { status: "empty", subBullets: [], caption: "" },
      { status: "error", subBullets: [], caption: "", code: "http" },
    ]) {
      const { api } = fakeApi({ [LINES[0].point]: record });
      const el = await render(withApi(api));
      const btn = el.querySelectorAll("li button")[0];
      const id = btn.getAttribute("aria-controls");
      expect(id).toBeTruthy();
      expect(el.ownerDocument.getElementById(id)).not.toBeNull();
    }
  });

  it("gives every panel a unique id across three answers on one screen", async () => {
    const { api } = fakeApi();
    const el = await render(
      createElement(
        "div",
        null,
        withApi(api),
        withApi(api),
        withApi(api),
      ),
    );
    const buttons = [...el.querySelectorAll("li button")];
    expect(buttons).toHaveLength(9);
    // The ids are per-instance, so a fourth render cannot collide either. An
    // implementation deriving them from the line index alone fails this.
    const ids = new Set(buttons.map((b) => b.dataset.panelId));
    expect(ids.size).toBe(buttons.length);
  });

  it("derives no id from model- or user-supplied text", () => {
    expect(PANEL_SRC).toContain("useId");
    expect(PANEL_SRC).not.toMatch(/id=\{[^}]*line\.(point|cue|pageSource)/);
  });

  it("collapses on the second activation, with no second request", async () => {
    const { api, calls } = fakeApi();
    const el = await render(withApi(api));
    const btn = el.querySelectorAll("li button")[0];
    await act(async () => btn.click());
    await render(withApi(api));
    expect(container.querySelectorAll("li button")[0].getAttribute("aria-expanded")).toBe("true");
    await act(async () => container.querySelectorAll("li button")[0].click());
    await render(withApi(api));
    const after = topItems(container)[0];
    expect(after.querySelector(":scope > ul")).toBeNull();
    expect(after.querySelector("button").getAttribute("aria-expanded")).toBe("false");
    expect(calls.filter(([kind]) => kind === "toggle")).toHaveLength(2);
  });

  it("keeps focus on the control across expand and collapse", async () => {
    const { api } = fakeApi();
    const el = await render(withApi(api));
    const btn = el.querySelectorAll("li button")[0];
    btn.focus();
    await act(async () => btn.click());
    await render(withApi(api));
    expect(document.activeElement).toBe(container.querySelectorAll("li button")[0]);
  });

  it("never scrolls anything into view", () => {
    expect(PANEL_SRC).not.toContain("scrollIntoView");
    expect(LINES_SRC).not.toContain("scrollIntoView");
    expect(PANEL_SRC).not.toContain('position: "sticky"');
  });
});

// ---------------------------------------------------------------------------
// E. Loading, empty, error
// ---------------------------------------------------------------------------
describe("the three states that are not sub-bullets", () => {
  it("shows loading as a caption, never as an <li>, and never as a <ul>", async () => {
    // An <li> would inflate the item count a screen reader announces.
    const { api } = fakeApi({ [LINES[0].point]: { status: "loading", subBullets: [], caption: "" } });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    expect(li.querySelector(":scope > ul")).toBeNull();
    expect(li.textContent).toContain("Finding more detail");
    expect(li.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("does not swap the glyph for a spinner while loading", async () => {
    // During loading aria-expanded is ALREADY "true", which is exactly when
    // the non-colour state affordance is needed.
    const { api } = fakeApi({ [LINES[0].point]: { status: "loading", subBullets: [], caption: "" } });
    const el = await render(withApi(api));
    const btn = el.querySelectorAll("li button")[0];
    expect(btn.querySelector('[aria-hidden="true"]').textContent.trim()).not.toBe("");
    expect(btn.querySelector(".MuiCircularProgress-root")).toBeNull();
  });

  it("says plainly when there is nothing more, without painting it as a failure", async () => {
    const { api } = fakeApi({ [LINES[0].point]: { status: "empty", subBullets: [], caption: "" } });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    expect(li.textContent).toContain("Nothing more we can back up");
    expect(li.querySelector(":scope > ul")).toBeNull(); // an empty <ul> announces "list, 0 items"
    expect(li.querySelector('[role="alert"]')).toBeNull();
    expect(li.querySelector(".MuiAlert-root")).toBeNull();
    expect(li.textContent).not.toContain("Retry"); // retrying an honest empty buys the same answer twice
    expect(li.querySelectorAll("button")).toHaveLength(1);
    expect(li.querySelector("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a failure as an alert with a Retry that re-issues exactly one request", async () => {
    const { api, calls } = fakeApi({ [LINES[0].point]: { status: "error", subBullets: [], caption: "", code: "http" } });
    const el = await render(withApi(api));
    const li = topItems(el)[0];
    expect(li.querySelector('[role="alert"]')).not.toBeNull();
    expect(li.textContent).toContain("Could not get more detail");
    const retry = [...li.querySelectorAll("button")].find((b) => b.textContent.includes("Retry"));
    expect(retry).toBeTruthy();
    expect(retry.getAttribute("aria-label")).toContain("Retry more detail for");
    await act(async () => retry.click());
    expect(calls.filter(([kind]) => kind === "retry")).toHaveLength(1);
  });

  it("distinguishes a timeout from an ordinary failure, and a disabled feature from both", async () => {
    const timeout = fakeApi({ [LINES[0].point]: { status: "error", subBullets: [], caption: "", code: "timeout" } });
    let el = await render(withApi(timeout.api));
    expect(el.textContent).toContain("That took too long to look up.");

    const disabled = fakeApi({ [LINES[0].point]: { status: "error", subBullets: [], caption: "", code: "disabled" } });
    el = await render(withApi(disabled.api));
    const li = topItems(el)[0];
    expect(li.textContent).toContain("unavailable");
    // Retrying something an operator switched off is a lie.
    expect([...li.querySelectorAll("button")].some((b) => b.textContent.includes("Retry"))).toBe(false);
  });

  it("never damages the parent bullet on a failure or an empty", async () => {
    const plain = await render(createElement(AnswerLines, { lines: LINES }));
    const before = [...topItems(plain)].map((li) => li.textContent);
    for (const status of ["error", "empty", "loading"]) {
      const { api } = fakeApi({ [LINES[0].point]: { status, subBullets: [], caption: "", code: "http" } });
      const el = await render(withApi(api));
      expect([...topItems(el)].map(bare)).toEqual(before);
      const control = topItems(el)[0].querySelector("button");
      expect(control.disabled).toBe(false);
    }
  });

  it("keeps the error alert usable at 320px", async () => {
    // All three treatments are needed together: flexWrap does nothing while
    // the action keeps `margin-left: auto`, and wrapping never triggers while
    // the message cannot shrink below its content width. The APPEARANCE at
    // 320px is a browser check -- jsdom does not lay out -- but the treatment
    // is declared CSS and is readable here.
    const { api } = fakeApi({ [LINES[0].point]: { status: "error", subBullets: [], caption: "", code: "http" } });
    const el = await render(withApi(api));
    const alert = el.querySelector(".MuiAlert-root");
    expect(getComputedStyle(alert).flexWrap).toBe("wrap");
    const action = el.querySelector(".MuiAlert-action");
    expect(getComputedStyle(action).marginLeft).toBe("0px");
    expect(getComputedStyle(action).paddingLeft).toBe("0px");
    expect(getComputedStyle(el.querySelector(".MuiAlert-message")).minWidth).toBe("0px");
  });
});

// ---------------------------------------------------------------------------
// F. Colour
// ---------------------------------------------------------------------------
describe("no new contrast failure", () => {
  it("uses only --text-secondary and --text-primary, never --text-muted", () => {
    // Both caption (0.75rem) and body2 (0.875rem) are below the 18.66px
    // large-text threshold, so the large-text allowance does not apply to
    // either. --text-muted measures 3.90:1 on this surface's fill, against the
    // 4.5:1 WCAG 1.4.3 requires.
    expect(PANEL_SRC).not.toContain("--text-muted");
    expect(PANEL_SRC).not.toContain("--danger");
    expect(PANEL_SRC).toContain("--text-secondary");
  });

  it("introduces no raw colour value at all", () => {
    expect(PANEL_SRC).not.toMatch(/rgb\(|rgba\(|hsl\(|#[0-9a-fA-F]{3,8}\b/);
  });

  it("keeps AnswerLines' own diff to an import, a prop and one element", () => {
    // The point-rendering region is not this chunk's, and the emphasis span it
    // produces is pinned by a file this chunk may not touch.
    expect(LINES_SRC).toContain("/* expansion:start */");
    expect(LINES_SRC).toContain("/* expansion:end */");
    const slice = LINES_SRC.slice(
      LINES_SRC.indexOf("/* expansion:start */"),
      LINES_SRC.indexOf("/* expansion:end */"),
    );
    expect(slice.length).toBeGreaterThan(20); // the slice is not empty
    expect(slice).not.toContain("sx=");
    expect(slice).not.toContain("strong");
    expect(LINES_SRC).not.toContain("useSyncExternalStore");
    expect(PANEL_SRC).not.toContain("useSyncExternalStore");
  });
});

// ---------------------------------------------------------------------------
// G. End to end, through the real hook and the real store
// ---------------------------------------------------------------------------
describe("through the real hook: a click actually fetches, once", () => {
  const QUESTIONS = [
    {
      id: 1,
      question: "Tell me about a failure.",
      // The RAW drafted points, STAR labels included, exactly as the answer
      // route returned them. The rendered lines above are these with the label
      // stripped, which is why the route has to strip before comparing.
      points: [
        "Situation: I rebuilt the ledger after the settlement outage was finally contained.",
        "Action: I paged the on-call team during the incident.",
        "I ran the postmortem with the payments group the next morning.",
      ],
      status: "done",
    },
  ];

  function scoped(children) {
    return createElement(
      ExpansionScope,
      {
        questions: QUESTIONS,
        request: { applicationId: "app-1", profile: "", interviewType: "behavioral", codeLanguage: "auto", engine: "embedded" },
      },
      children,
    );
  }

  it("wires the control through context, with no prop and no surface change", async () => {
    const el = await render(scoped(createElement(AnswerLines, { lines: LINES })));
    expect(el.querySelectorAll("li button")).toHaveLength(3);
  });

  it("issues exactly one request per bullet, however many times it is clicked", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        subBullets: [{ text: "I reconciled every settlement by hand.", pageSource: null, source: null }],
        caption: "Found on this server with no AI provider in your Ledger page.",
        empty: false,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const el = await render(scoped(createElement(AnswerLines, { lines: LINES })));
    const btn = el.querySelectorAll("li button")[0];
    await act(async () => btn.click());
    await act(async () => container.querySelectorAll("li button")[0].click()); // collapse
    await act(async () => container.querySelectorAll("li button")[0].click()); // re-open
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(topItems(container)[0].textContent).toContain("I reconciled every settlement by hand.");
  });

  it("sends the SOURCE index, not the rendered line index", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ subBullets: [], caption: "", empty: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    const el = await render(scoped(createElement(AnswerLines, { lines: LINES })));
    await act(async () => el.querySelectorAll("li button")[1].click());
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.pointIndex).toBe(1);
    expect(sent.parentPoint).toBe("I paged the on-call team during the incident.");
    expect(sent.points).toEqual(QUESTIONS[0].points);
    expect(sent.question).toBe("Tell me about a failure.");
  });

  it("renders nothing at all when the answer's own question cannot be resolved", async () => {
    // Better than guessing: a control that cannot name the question it belongs
    // to could only elaborate the wrong bullet.
    const el = await render(
      createElement(
        ExpansionScope,
        { questions: [], request: { applicationId: "app-1" } },
        createElement(AnswerLines, { lines: LINES }),
      ),
    );
    expect(el.querySelectorAll("li button")).toHaveLength(0);
  });

  it("does not prefetch: a rendered answer issues zero requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(scoped(createElement(AnswerLines, { lines: LINES })));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
