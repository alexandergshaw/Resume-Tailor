// The knowledge panel's style constants, asserted as a STATIC READ of the
// exported objects rather than by rendering and simulating.
//
// WHY STATIC. `:focus-visible` is measurably flaky in this harness (5 true /
// 5 false over 10 identical runs of the same assertion), so a focus-ring
// criterion (AC-V3.4) proved by simulating focus is a test that fails one
// run in two for reasons that have nothing to do with the code. The ring is
// therefore a property of an exported object, and this file reads that
// object. The same reasoning covers the no-opacity and no-colour-literal
// rules: they are properties of the constants, so they are read from the
// constants.
//
// WHY THE SWEEPS WALK THE MODULE NAMESPACE rather than a hand-listed set of
// exports: a constant added next month is swept on the day it is written,
// which a hand-listed set is not. Every sweep asserts the number of style
// objects it actually visited BEFORE asserting anything about them, so a
// walker that silently matched nothing cannot pass.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as styles from "./knowledgePanelStyles.js";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TECH_WATCH = path.join(HERE, "TechWatchPanel.js");
const SELF = path.join(HERE, "knowledgePanelStyles.js");

// Every plain object reachable from an export, plus both branches of every
// exported style FACTORY (a factory whose collapsed branch is never visited
// is exactly where a colour literal or an `opacity` would hide).
function styleObjects() {
  const out = [];
  const seen = new Set();
  const visit = (value, trail) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    out.push({ trail, obj: value });
    for (const [key, child] of Object.entries(value)) visit(child, `${trail}.${key}`);
  };
  for (const [name, value] of Object.entries(styles)) {
    if (typeof value === "function") {
      // A style factory: both branches. A render helper (renderInertLink)
      // throws or returns a React element, and is skipped by the guard in
      // `visit` because an element is not walked for style keys.
      for (const arg of [true, false]) {
        let produced;
        try {
          produced = value(arg);
        } catch {
          produced = null;
        }
        visit(produced, `${name}(${arg})`);
      }
      continue;
    }
    visit(value, name);
  }
  return out;
}

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

describe("knowledgePanelStyles — the container matches the precedent it claims", () => {
  it("takes border, borderRadius and backgroundColor from TechWatchPanel's own region, read from that file", () => {
    const source = readFileSync(TECH_WATCH, "utf8");
    const border = /\bborder:\s*"([^"]+)"/.exec(source);
    const radius = /\bborderRadius:\s*([0-9.]+)/.exec(source);
    const bg = /\bbackgroundColor:\s*"([^"]+)"/.exec(source);
    // Assert the reads landed before comparing anything to them, or a regex
    // that stopped matching would make every comparison below vacuous.
    expect(border, "TechWatchPanel border not found").not.toBeNull();
    expect(radius, "TechWatchPanel borderRadius not found").not.toBeNull();
    expect(bg, "TechWatchPanel backgroundColor not found").not.toBeNull();

    expect(styles.PANEL_SX.border).toBe(border[1]);
    expect(styles.PANEL_SX.borderRadius).toBe(Number(radius[1]));
    expect(styles.PANEL_SX.backgroundColor).toBe(bg[1]);
    expect(styles.PANEL_SX.p).toBe(1.5);
  });

  it("sits at mt: 3 — the AttachmentPanel gap, not TechWatchPanel's mt: 2", () => {
    expect(styles.PANEL_SX.mt).toBe(3);
  });
});

describe("knowledgePanelStyles — the focus ring is four longhands, never the shorthand", () => {
  it("carries outlineWidth, outlineStyle, outlineColor and outlineOffset", () => {
    expect(styles.FOCUS_SX.outlineWidth).toBe("2px");
    expect(styles.FOCUS_SX.outlineStyle).toBe("solid");
    expect(styles.FOCUS_SX.outlineColor).toBe("var(--accent)");
    expect(styles.FOCUS_SX.outlineOffset).toBe("2px");
  });

  it("never uses the `outline` shorthand — jsdom's parser drops it, so a spec written with it reads back as none", () => {
    expect(Object.keys(styles.FOCUS_SX)).not.toContain("outline");
    expect(readFileSync(SELF, "utf8")).not.toMatch(/\boutline:\s/);
  });

  it("wires the ring onto every button through &:focus-visible", () => {
    expect(styles.BTN_SX["&:focus-visible"]).toEqual(styles.FOCUS_SX);
  });
});

describe("knowledgePanelStyles — the three rules that are cheap to get wrong", () => {
  it("visits every exported style object (the walker is not silently empty)", () => {
    const found = styleObjects();
    expect(found.length).toBeGreaterThanOrEqual(12);
  });

  it("has no `opacity` key anywhere — an aria-disabled control stays readable, so 1.4.3's inactive exemption cannot be claimed", () => {
    const found = styleObjects();
    expect(found.length).toBeGreaterThan(0);
    const offenders = found.filter(({ obj }) => Object.hasOwn(obj, "opacity")).map(({ trail }) => trail);
    expect(offenders).toEqual([]);
  });

  it("has no colour literal anywhere — a literal flips in neither theme channel", () => {
    const found = styleObjects();
    expect(found.length).toBeGreaterThan(0);
    const offenders = [];
    for (const { trail, obj } of found) {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string" && COLOUR_LITERAL.test(value)) offenders.push(`${trail}.${key} = ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pins every outlined control's border explicitly rather than inheriting a default", () => {
    expect(styles.BTN_SX.borderColor).toBe("var(--border-control)");
    expect(styles.FIELD_SX["& .MuiOutlinedInput-notchedOutline"].borderColor).toBe("var(--border-control)");
  });
});

describe("knowledgePanelStyles — the hidden live region", () => {
  it('uses "1px" STRINGS, never the number 1 — in sx a bare 1 computes 100% and turns a hidden sink into a full-panel overlay', () => {
    expect(styles.HIDDEN_STATUS_SX.width).toBe("1px");
    expect(styles.HIDDEN_STATUS_SX.height).toBe("1px");
    expect(styles.HIDDEN_STATUS_SX.margin).toBe("-1px");
  });

  it("clips itself out of the visual layer without leaving the accessibility tree", () => {
    expect(styles.HIDDEN_STATUS_SX.position).toBe("absolute");
    expect(styles.HIDDEN_STATUS_SX.overflow).toBe("hidden");
    expect(styles.HIDDEN_STATUS_SX.clip).toBe("rect(0 0 0 0)");
    // `display: none` and `visibility: hidden` would remove it from the
    // accessibility tree entirely and silence every announcement.
    expect(styles.HIDDEN_STATUS_SX.display).toBeUndefined();
    expect(styles.HIDDEN_STATUS_SX.visibility).toBeUndefined();
  });

  it("carries a zero-width toggle character so two identical announcements still differ in the DOM", () => {
    expect(styles.ANNOUNCE_TOGGLE).toBe(String.fromCodePoint(0x200b));
  });
});

describe("knowledgePanelStyles — the long-form body cap", () => {
  it("collapses to the literal string 17em and expands to none", () => {
    expect(styles.COLLAPSED_BODY_MAX_HEIGHT).toBe("17em");
    expect(styles.BODY_SX(false).maxHeight).toBe("17em");
    expect(styles.BODY_SX(true).maxHeight).toBe("none");
  });

  it("hides the overflow rather than scrolling it — a nested scroller traps the wheel and hides content from find-in-page", () => {
    expect(styles.BODY_SX(false).overflow).toBe("hidden");
    expect(styles.BODY_SX(false).overflowY).toBeUndefined();
    expect(readFileSync(SELF, "utf8")).not.toMatch(/overflowY:\s*"auto"/);
  });

  it("adds overflowWrap to the markdown descendants and nothing else — at (0,1,1) these beat MarkdownPreview's own rules silently", () => {
    const descendantKeys = Object.keys(styles.PROSE_SX).filter((k) => k.startsWith("&"));
    expect(descendantKeys.length).toBe(1);
    for (const key of descendantKeys) {
      expect(Object.keys(styles.PROSE_SX[key])).toEqual(["overflowWrap"]);
    }
  });
});

describe("knowledgePanelStyles — zero motion", () => {
  it("declares no transition, animation or keyframes: prefers-reduced-motion has no guard in this repo to respect", () => {
    const source = readFileSync(SELF, "utf8");
    for (const banned of ["transition:", "animation:", "@keyframes", "scrollIntoView"]) {
      expect(source.includes(banned), `${banned} present`).toBe(false);
    }
  });
});

describe("knowledgePanelStyles — renderInertLink is TOTAL", () => {
  it("returns an element for every link token, so MarkdownPreview's own href branch is unreachable", () => {
    const cases = [
      { href: "https://acme.example/x", external: true },
      { href: "/api/experience/pages/1", external: false },
      { href: "mailto:a@b", external: false },
      { href: "javascript:alert(1)", external: false },
      { href: "", external: false },
    ];
    expect(cases.length).toBe(5);
    for (const [i, token] of cases.entries()) {
      const el = styles.renderInertLink({ ...token, key: `k-${i}`, children: ["label"] });
      // `undefined` is MarkdownPreview's documented fall-through value, and
      // falling through renders href={token.href} UNGATED for same-origin
      // and mailto:. A total function is what makes the panel anchor-free.
      expect(el, `token ${i} fell through`).not.toBeUndefined();
      expect(el.type).toBe("span");
      expect(el.props.children).toEqual(["label"]);
      expect(el.props.href).toBeUndefined();
    }
  });
});
