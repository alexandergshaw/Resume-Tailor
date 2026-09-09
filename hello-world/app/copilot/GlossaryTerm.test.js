// @vitest-environment jsdom
//
// THE HOVER ITSELF -- AC-H1..AC-H21, AC-Q4, AC-Q8, AC-Q9, AC-H22, AC-H18'/AC-R33.
// FAILING TESTS FIRST: `./GlossaryTerm.js` does not exist yet.
//
// WHAT THE HOVER SHOWS, and why each part is here rather than being a nicety:
// the stored definition, its provenance IN WORDS, and the ANCHOR QUOTE -- the
// posting line the term was anchored to, verbatim. The quote is what lets a
// candidate judge whether an ANTICIPATED term is really relevant to this job,
// which is the one thing a definition alone cannot tell them.
//
// THE LABEL IS THE HOST, NEVER "Researched". A candidate reading "Researched"
// thirty seconds before an interview may repeat the definition and say "I
// researched this" -- a claim about their own preparation that our label
// licensed and cannot support. The stored field is still
// `provenance: "researched"`; only the user-facing string changed, and the
// split is asserted in lib/copilot/glossaryCard.test.js.
//
// WHAT IS NOT ASSERTED HERE, AND WHY. jsdom has NO layout engine:
// getBoundingClientRect() returns zeroes, so the popover's POSITION, whether it
// is clipped by the answer pane, whether it flips above a bullet at the bottom
// of the pane, and whether a dotted underline reads as distinct from a link ON
// SCREEN are all unmeasurable here. They are browser checks and they are
// written down in docs/REGRESSION.md as such. A failed instrument is INVALID,
// never its zero value, so none of them is asserted as `0`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

import GlossaryTerm from "./GlossaryTerm.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SRC = readFileSync(path.join(process.cwd(), "app/copilot/GlossaryTerm.js"), "utf8");
// Comments are stripped before every source sweep below: this component's own
// header NAMES the things the sweeps forbid, in order to say why they are not
// there, and a raw grep would fail on the documentation that prevents the
// defect. The sibling expansion suite takes exactly this precaution.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const stray of document.querySelectorAll("[data-glossary='card']")) stray.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const EXPLICIT_SOURCED = {
  term: "covering index",
  kind: "explicit",
  category: "tech",
  evidence: "You will tune covering indexes on a 4TB table.",
  definition: "An index that carries every column a query needs, so the query is answered without visiting the table itself.",
  provenance: "researched",
  source_url: "https://www.postgresql.org/docs/current/indexes-index-only-scans.html",
  source_host: "postgresql.org",
  source_title: "Index-Only Scans and Covering Indexes",
};

const ANTICIPATED_RECALLED = {
  term: "MVCC",
  kind: "anticipated",
  category: "tech",
  parent: "PostgreSQL",
  anchor_quote: "Deep PostgreSQL experience is required.",
  definition: "Multiversion concurrency control: readers see a snapshot rather than blocking on writers.",
  provenance: "recalled",
};

const QUOTES_ONLY = {
  term: "settlement ledger",
  kind: "explicit",
  category: "other",
  evidence: "You will own the settlement ledger end to end.",
  definition: "",
  provenance: "recalled",
};

function mount(term, surface = term.term) {
  act(() => root.render(createElement(GlossaryTerm, { term, surface })));
  return container.querySelector("[data-glossary='term']");
}

const card = () => document.querySelector("[data-glossary='card']");
const open = (button) => act(() => button.click());

// React synthesises onMouseEnter/onMouseLeave from `mouseover`/`mouseout`
// (EnterLeaveEventPlugin), so a raw `mouseenter` event would never reach the
// component -- and onFocus is delegated through the bubbling `focusin`, so a
// hand-built `focus` event would not either. These dispatch what a real
// browser dispatches, and are the same helpers CitationDetail.test.js uses for
// the sibling popover in this same <li>.
const hoverIn = (el) =>
  act(() => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
const hoverOut = (el) =>
  act(() => el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));

// ---------------------------------------------------------------------------
// AC-H1 .. AC-H5 -- the control
// ---------------------------------------------------------------------------
describe("AC-H1/AC-H2/AC-H3 -- a real button whose name is the term and nothing else", () => {
  it("is a native <button type='button'>, not a span with handlers", () => {
    const button = mount(EXPLICIT_SOURCED);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("its accessible name is exactly its own visible text", () => {
    // No aria-label: it would REPLACE the term text, and WCAG 2.5.3 Label in
    // Name is the reason this control has no Tooltip either -- a MUI Tooltip
    // overrides its child's accessible name in this repo's MUI version.
    const button = mount(EXPLICIT_SOURCED, "Covering Index");
    expect(button.textContent).toBe("Covering Index");
    expect(button.getAttribute("aria-label")).toBeNull();
    expect(button.getAttribute("aria-labelledby")).toBeNull();
    expect(button.getAttribute("title")).toBeNull();
  });

  it("carries NO aria-describedby, so a screen reader is not read the definition on every focus", () => {
    const button = mount(EXPLICIT_SOURCED);
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBeNull(); // no dangling IDREF while closed
    open(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-controls"))).not.toBeNull();
  });

  it("AC-H4 -- it does not disturb the line box: inline, unpadded, inheriting type and colour", () => {
    const button = mount(EXPLICIT_SOURCED);
    const style = getComputedStyle(button);
    expect(style.display).toBe("inline");
    expect(style.padding).toBe("0px");
    expect(style.borderWidth === "0px" || style.border === "0px" || style.border === "0").toBe(true);
    // `color: inherit` is what the component DECLARES; jsdom resolves it, so
    // the observable form of the same rule is "the same colour as the sentence
    // it sits in". That is the assertion worth making anyway -- WCAG 1.4.1
    // says the term must not be distinguished BY COLOUR, and this is the half
    // of that which is measurable without a screen.
    expect(style.color).toBe(getComputedStyle(button.parentElement).color);
    expect(style.cursor).toBe("help");
  });

  it("AC-H5 -- it is distinguished by more than colour: a dotted underline", () => {
    // WCAG 1.4.1. Printed in greyscale the marked term is still identifiable,
    // and the affordance is the conventional glossary one rather than a link's.
    const button = mount(EXPLICIT_SOURCED);
    const decoration = `${getComputedStyle(button).textDecoration} ${getComputedStyle(button).textDecorationStyle}`;
    expect(decoration).toContain("underline");
    expect(decoration).toContain("dotted");
  });
});

// ---------------------------------------------------------------------------
// AC-H6 .. AC-H12 -- opening, closing, and the three input modalities
// ---------------------------------------------------------------------------
describe("AC-H6/AC-H7 -- hover, focus and activation all reach it", () => {
  it("opens IMMEDIATELY on focus -- a keyboard user never waits", () => {
    const button = mount(EXPLICIT_SOURCED);
    expect(card()).toBeNull();
    act(() => button.focus());
    expect(card()).not.toBeNull();
  });

  it("opens IMMEDIATELY on activation, and a second activation closes it (touch)", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    expect(card()).not.toBeNull();
    open(button);
    expect(card()).toBeNull();
  });

  it("opens on hover only after a delay, so sweeping a sentence opens no cascade", () => {
    vi.useFakeTimers();
    const button = mount(EXPLICIT_SOURCED);
    hoverIn(button);
    expect(card()).toBeNull();
    act(() => vi.advanceTimersByTime(119));
    expect(card()).toBeNull();
    act(() => vi.advanceTimersByTime(2));
    expect(card()).not.toBeNull();
  });

  it("a tap outside closes it", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    act(() => document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(card()).toBeNull();
  });
});

describe("AC-H10 -- WCAG 1.4.13, all three parts", () => {
  it("DISMISSIBLE: Escape closes it and does NOT move focus", () => {
    const button = mount(EXPLICIT_SOURCED);
    button.focus();
    open(button);
    expect(card()).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("HOVERABLE: the pointer can travel from the term onto the card and read it", () => {
    vi.useFakeTimers();
    const button = mount(EXPLICIT_SOURCED);
    hoverIn(button);
    act(() => vi.advanceTimersByTime(200));
    expect(card()).not.toBeNull();
    hoverOut(button);
    // Still open during the grace window, and the card's own mouseenter
    // cancels the close outright.
    // MUTATION PROOF: drop the card's own `onMouseEnter={clearTimer}` and this
    // goes red 200ms in.
    hoverIn(card());
    act(() => vi.advanceTimersByTime(5000));
    expect(card()).not.toBeNull();
  });

  it("PERSISTENT: no auto-dismiss timer -- it is still open a minute later", () => {
    vi.useFakeTimers();
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    act(() => vi.advanceTimersByTime(60_000));
    expect(card()).not.toBeNull();
  });

  it("a visible close control is present, and it closes", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    const close = card().querySelector("[data-glossary='close']");
    expect(close).not.toBeNull();
    expect(close.textContent.trim().length).toBeGreaterThan(0); // never an icon alone
    act(() => close.click());
    expect(card()).toBeNull();
  });
});

describe("AC-H11/AC-H12 -- a popover, not a modal", () => {
  it("does not move focus on open, and traps nothing", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    expect(document.activeElement).toBe(outside);
    expect(document.querySelector(".MuiBackdrop-root")).toBeNull();
    expect(document.querySelector("[aria-hidden='true'][role='presentation']")).toBeNull();
    outside.remove();
  });

  it("is portalled out of the trigger's own subtree", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    expect(button.contains(card())).toBe(false);
    expect(card().closest("li")).toBeNull();
  });

  it("its body is a scrollable, keyboard-reachable region", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    const body = card().querySelector("[data-glossary='body']");
    expect(body.getAttribute("tabindex")).toBe("0");
    const style = getComputedStyle(body);
    expect(style.overflowY).toBe("auto");
    expect(style.maxHeight).not.toBe("");
    expect(style.maxHeight).not.toBe("none");
  });
});

describe("AC-H9 -- at most one popover open at a time", () => {
  it("opening a second term closes the first", () => {
    act(() =>
      root.render(
        createElement(
          "p",
          null,
          createElement(GlossaryTerm, { key: "a", term: EXPLICIT_SOURCED, surface: "covering index" }),
          createElement(GlossaryTerm, { key: "b", term: ANTICIPATED_RECALLED, surface: "MVCC" }),
        ),
      ),
    );
    const [first, second] = container.querySelectorAll("[data-glossary='term']");
    open(first);
    expect(document.querySelectorAll("[data-glossary='card']")).toHaveLength(1);
    open(second);
    const cards = document.querySelectorAll("[data-glossary='card']");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("MVCC");
  });
});

// ---------------------------------------------------------------------------
// AC-Q4 / AC-Q8 / AC-Q9 -- what the card actually says
// ---------------------------------------------------------------------------
describe("AC-Q4/AC-Q9 -- the provenance is in words, and it comes FIRST", () => {
  const lines = () =>
    [...card().querySelectorAll("p, a")].map((n) => n.textContent.trim()).filter(Boolean);

  it("a sourced EXPLICIT term names the posting and the host, then links it last", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    const text = lines();
    expect(text[0]).toBe("covering index");
    expect(text[1]).toBe("In this posting · postgresql.org");
    expect(text).toContain("You will tune covering indexes on a 4TB table.");
    expect(text.at(-1)).toBe("Source: postgresql.org");
    expect(text.indexOf("In this posting · postgresql.org")).toBeLessThan(
      text.findIndex((t) => t.startsWith("An index that carries")),
    );
  });

  it("an ANTICIPATED, unsourced term says so in a sentence and shows its ANCHOR QUOTE", () => {
    const button = mount(ANTICIPATED_RECALLED);
    open(button);
    const text = lines();
    expect(text[1]).toBe("Likely to come up — not stated in this posting · No source");
    // The quote is the whole point: it is what lets a candidate judge whether
    // an anticipated term is really relevant to THIS job.
    expect(text).toContain("Deep PostgreSQL experience is required.");
    expect(text.at(-1)).toBe("This is a general definition. It has no source.");
    expect(card().querySelectorAll("a")).toHaveLength(0);
  });

  it("AC-E3 -- a quotes-only term shows the posting line and NO definition and NO link", () => {
    const button = mount(QUOTES_ONLY);
    open(button);
    const text = lines();
    expect(text[1]).toBe("From the posting");
    expect(text).toContain("You will own the settlement ledger end to end.");
    expect(card().querySelectorAll("a")).toHaveLength(0);
    expect(card().textContent).not.toContain("general definition");
  });
});

describe("AC-Q8 -- a recalled term's card says 'no source' IN WORDS, greyscale-safe", () => {
  it("differs from a sourced card in TEXT, not merely in markup", () => {
    const sourcedButton = mount(EXPLICIT_SOURCED);
    open(sourcedButton);
    const sourcedText = card().textContent;
    open(sourcedButton);

    const recalledButton = mount({ ...EXPLICIT_SOURCED, provenance: "recalled", source_url: undefined, source_host: undefined, source_title: undefined });
    open(recalledButton);
    const recalledText = card().textContent;

    expect(recalledText).not.toBe(sourcedText);
    expect(recalledText.toLowerCase()).toContain("no source");
    expect(sourcedText.toLowerCase()).not.toContain("no source");
    expect(sourcedText).toContain("postgresql.org");
    expect(recalledText).not.toContain("postgresql.org");
  });

  it("AC-R16' -- no card of any variant uses one of the five forbidden words", () => {
    const FORBIDDEN = ["verified", "confirmed", "corroborated", "sourced from", "researched"];
    for (const term of [EXPLICIT_SOURCED, ANTICIPATED_RECALLED, QUOTES_ONLY]) {
      const button = mount(term);
      open(button);
      const text = card().textContent.toLowerCase();
      for (const word of FORBIDDEN) {
        expect({ term: term.term, word, found: text.includes(word) }).toEqual({
          term: term.term,
          word,
          found: false,
        });
      }
      open(button);
    }
    // The sweep can fail: the same needles DO fire on a planted string.
    const planted = "researched, verified, confirmed, corroborated, sourced from";
    for (const word of FORBIDDEN) expect(planted.includes(word)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-H17 / AC-H18' / AC-R33 -- the link, and the row that is never trusted
// ---------------------------------------------------------------------------
describe("AC-H17 -- the link's conditions, each one observable", () => {
  it("renders one anchor, opened in a new tab, with a paired rel", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    const anchors = card().querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe(EXPLICIT_SOURCED.source_url);
    expect(anchors[0].getAttribute("target")).toBe("_blank");
    expect(anchors[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchors[0].textContent).toBe("Source: postgresql.org");
  });

  it("derives the visible host from the anchor's OWN href, never from source_host", () => {
    // SEC-F2. A drifted stored host must not be able to name a publisher the
    // link does not go to.
    const button = mount({ ...EXPLICIT_SOURCED, source_host: "acme-recruiting.example" });
    open(button);
    expect(card().textContent).not.toContain("acme-recruiting.example");
    expect(card().querySelector("a").textContent).toBe("Source: postgresql.org");
  });

  it("AC-Q7 -- source_title is rendered NOWHERE", () => {
    const button = mount({ ...EXPLICIT_SOURCED, source_title: "Click here for a free laptop" });
    open(button);
    expect(card().textContent).not.toContain("Click here");
  });

  it("a REFUSED url renders zero anchors and the card still shows the definition", () => {
    const button = mount({ ...EXPLICIT_SOURCED, source_url: "javascript:alert(1)" });
    open(button);
    expect(card().querySelectorAll("a")).toHaveLength(0);
    expect(card().textContent).toContain("An index that carries every column");
    expect(card().textContent).toContain("It has no source.");
    expect(card().textContent).toContain("In this posting · No source");
  });
});

describe("AC-H18'/AC-R33 -- the stored URL is re-validated at RENDER", () => {
  // `source_url` is model-influenced text in a SHARED table read back by a
  // different user's browser. A row written by an older, weaker ingest -- or by
  // a future regression -- must not be able to put a redirector or an
  // interstitial in front of a reader.
  const HOSTILE = {
    "vendor grounding redirect": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    "a link shortener": "https://t.co/abcdef",
    "a search interstitial": "https://www.google.com/url?q=https://evil.example/x",
  };

  for (const [name, url] of Object.entries(HOSTILE)) {
    it(`refuses ${name}, first line included`, () => {
      const button = mount({ ...EXPLICIT_SOURCED, source_url: url, source_host: "postgresql.org" });
      open(button);
      expect(card().querySelectorAll("a")).toHaveLength(0);
      expect(card().textContent).toContain("In this posting · No source");
      expect(card().textContent).toContain("This is a general definition. It has no source.");
      expect(card().textContent).not.toContain("postgresql.org");
    });
  }

  it("admits four REAL publishers, so the rule above is not passing by refusing everything", () => {
    const publishers = {
      "https://en.wikipedia.org/wiki/Database_index": "en.wikipedia.org",
      "https://www.postgresql.org/docs/current/indexes.html": "postgresql.org",
      "https://learn.microsoft.com/en-us/sql/relational-databases/indexes": "learn.microsoft.com",
      "https://datatracker.ietf.org/doc/html/rfc9110": "datatracker.ietf.org",
    };
    for (const [url, host] of Object.entries(publishers)) {
      const button = mount({ ...EXPLICIT_SOURCED, source_url: url });
      open(button);
      expect({ url, anchors: card().querySelectorAll("a").length }).toEqual({ url, anchors: 1 });
      expect(card().querySelector("a").textContent).toBe(`Source: ${host}`);
      open(button);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-H8 -- the tap-target ruling, measured at two widths
// ---------------------------------------------------------------------------
describe("AC-H8 -- the inline term is EXEMPT, the popover's controls are not", () => {
  it("the inline term declares no touch floor and stays inline at 375px", () => {
    // WCAG 2.5.8 carries an explicit inline exception for a target in a
    // sentence, and a 44px minimum on an inline word destroys the line box.
    const button = mount(EXPLICIT_SOURCED);
    const style = atWidth(375, () => {
      const s = getComputedStyle(button);
      return { minHeight: s.minHeight, minWidth: s.minWidth, display: s.display };
    });
    expect(style.display).toBe("inline");
    expect(["", "auto", "0px"]).toContain(style.minHeight);
    expect(["", "auto", "0px"]).toContain(style.minWidth);
  });

  it("the close control and the source link DO meet the 44px floor at 375px", () => {
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    const close = card().querySelector("[data-glossary='close']");
    const link = card().querySelector("a");
    const measured = atWidth(375, () => ({
      close: getComputedStyle(close).minHeight,
      link: getComputedStyle(link).minHeight,
    }));
    expect(measured).toEqual({ close: `${MOBILE_TAP_MIN}px`, link: `${MOBILE_TAP_MIN}px` });
  });

  it("and leave the desktop rendering alone at 1000px", () => {
    // The instrument is real, not a constant: the same read at a wider
    // viewport returns the property's own initial value.
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    const measured = atWidth(1000, () => ({
      close: getComputedStyle(card().querySelector("[data-glossary='close']")).minHeight,
      link: getComputedStyle(card().querySelector("a")).minHeight,
    }));
    expect(measured).toEqual({ close: "auto", link: "auto" });
  });

  it("takes the floor from the theme module, not the copilot re-export shim", () => {
    expect(SRC).toContain('from "@/app/theme/mobileSx"');
    expect(SRC).not.toContain('from "./mobileSx"');
  });
});

// ---------------------------------------------------------------------------
// AC-H13 / AC-H14 / AC-H19 / AC-H20 / AC-H21 -- the source sweeps
// ---------------------------------------------------------------------------
describe("the absences, each with a positive control", () => {
  it("AC-H14 -- a hover makes ZERO outbound requests", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const button = mount(EXPLICIT_SOURCED);
    for (let i = 0; i < 5; i += 1) {
      open(button);
      open(button);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(CODE).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|EventSource/);
    vi.unstubAllGlobals();
  });

  it("AC-H21 -- no publisher favicon, no preconnect, no prefetch", () => {
    // Any of them would be a third-party request fired AT HOVER, on a surface
    // used during a live interview, disclosing what the candidate looked up.
    expect(CODE).not.toMatch(/favicon|preconnect|prefetch|dns-prefetch|<img|<link/i);
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    expect(card().querySelectorAll("img, link, iframe, embed, object")).toHaveLength(0);
  });

  it("AC-H20 -- no frame of any kind, and no third-party content is fetched", () => {
    for (const needle of ["iframe", "embed", "object", "dangerouslySetInnerHTML", "srcdoc"]) {
      expect({ needle, found: CODE.includes(needle) }).toEqual({ needle, found: false });
    }
  });

  it("AC-H13 -- nothing here is announced through a live region", () => {
    expect(CODE).not.toMatch(/aria-live|role="status"|role="alert"/);
    const button = mount(EXPLICIT_SOURCED);
    open(button);
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(0);
  });

  it("AC-H1/AC-H11 -- no MUI Tooltip and no MUI Popover", () => {
    // Tooltip steals the child's accessible name; Popover renders inside Modal
    // and would trap focus over the sentence being read aloud.
    expect(CODE).not.toContain("Tooltip");
    expect(CODE).not.toMatch(/material\/Popover|material\/Dialog|material\/Modal/);
    expect(CODE).toContain("Popper");
  });

  it("AC-H19 -- the component contains NO literal href, and the vacuity is asserted", () => {
    // The hrefSafety sweep requires every literal href to be a same-origin
    // path or a fragment. This file has none at all, so that rule is satisfied
    // vacuously -- and here is the assertion that it really is vacuous rather
    // than assumed.
    expect(CODE).not.toMatch(/href="/);
    // ... and the ONE non-literal href it does carry is produced by a same-file
    // safeExternalHref binding, which is the shape app/components/
    // hrefSafety.sweep.test.js's `isGated` recognises.
    expect(CODE).toMatch(/const href = safeExternalHref\(/);
    expect(CODE).toMatch(/href=\{href\}/);
    expect((CODE.match(/target="_blank"/g) || []).length).toBe(
      (CODE.match(/rel="noopener noreferrer"/g) || []).length,
    );
  });

  it("the sweeps above can fail: each needle IS found in a planted sample", () => {
    const planted = 'href="/x" <iframe srcdoc favicon preconnect aria-live Tooltip fetch( dangerouslySetInnerHTML';
    for (const needle of ["href=\"", "iframe", "srcdoc", "favicon", "preconnect", "aria-live", "Tooltip", "fetch(", "dangerouslySetInnerHTML"]) {
      expect({ needle, found: planted.includes(needle) }).toEqual({ needle, found: true });
    }
  });
});
