// @vitest-environment jsdom
//
// THE THIRD OCCURRENCE of one bug, so this file is written to catch a fourth.
//
// In MUI's `sx` a unitless number is not pixels. Verified against this repo's
// node_modules/@mui/system/styleFunctionSx/defaultSxConfig.js (MUI 9.0.1):
// `width`/`height`/`maxWidth`/`maxHeight` go through `sizingTransform`, where a
// number in 0..1 is a PERCENTAGE, and `margin`/`padding`/`gap` go through the
// 8px spacing scale. So a "visually hidden" clip-rect written the way plain CSS
// reads —
//
//     { position: "absolute", width: 1, height: 1, margin: -1, ... }
//
// — does not render a 1px box nudged 1px. It renders
// `width: 100%; height: 100%; margin: -8px`: a full-size, absolutely positioned
// element. It still LOOKS right, because `clip` and `overflow: hidden` keep
// doing their job; what it does instead is silently extend the document's
// scroll width, which on a phone is invisible because app/globals.css clips
// horizontal overflow at the root.
//
// lib/copilot/answerStatus.js holds the correct, unit-bearing version and
// records the whole history in its own comment. Six copilot regions shipped the
// broken form and were fixed in 5258564; the fix was unit-bearing strings plus
// a test that asserts UNITS rather than values, because a test that asserts a
// NUMBER is satisfied by the next wrong number.
//
// It shipped again anyway, in app/meeting/MeetingInsightList.js and
// app/meeting/MeetingTranscript.js, both of which hand-inlined their own copy
// and both of whose header comments present the inlining as a virtue ("Small
// and self-contained beats a cross-feature import here"). That comment is what
// makes this a recurrence rather than an accident, which is why the guard below
// is a RENDER test over the whole mounted tree rather than an assertion about
// two named constants: it holds for a region that does not exist yet.
//
// Why a render test and not a source read: `sx` reinterpretation happens inside
// emotion, not in the source, so the source literal is the input and the
// computed style is the property. jsdom resolves emotion's injected CSS here —
// measured in this repo's setup: `sx={{width: 1}}` computes to "100%",
// `sx={{width: "1px"}}` computes to "1px". The `plantedRegions` case at the
// bottom is the positive control that keeps that true.
//
// NOTE on `clip`: jsdom's cssstyle parses the comma form `rect(0, 0, 0, 0)` but
// computes the space-separated form `rect(0 0 0 0)` (which is what the correct
// shared style uses) as "auto". So nothing here fingerprints on computed
// `clip` — it would be backwards, flagging the FIXED shape and not the broken
// one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import MeetingInsightList from "./MeetingInsightList.js";
import MeetingTranscript from "./MeetingTranscript.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

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

async function render(element) {
  await act(async () => {
    root.render(element);
  });
}

// A length is acceptable iff it carries an explicit unit AND is small. Both
// halves are load-bearing and neither alone is enough:
//
//   - the UNIT half is the lesson 5258564 recorded. "100%" fails it, and so
//     would any future unitless value that sizingTransform reinterprets.
//   - the MAGNITUDE half exists because the spacing bug survives a unit check:
//     `margin: -1` computes to "-8px", which IS px. Asserting "-1px" exactly
//     would be asserting a value, which the previous fix explicitly warns
//     against; asserting "at most a couple of px" states the actual property —
//     this element occupies, and is displaced by, a negligible box — and no
//     wrong number satisfies it.
const LENGTH = /^(-?\d*\.?\d+)px$/;
const MAX_PX = 2;

function sizeProblem(name, value) {
  const m = LENGTH.exec(String(value));
  if (!m) return `${name} computed to "${value}", which carries no px unit — sx reinterpreted a unitless number`;
  if (Math.abs(Number(m[1])) > MAX_PX) {
    return `${name} computed to "${value}", far larger than a clip-rect's ${MAX_PX}px — sx applied a scale to a unitless number`;
  }
  return null;
}

// Margins are checked in ONE direction only, and deliberately.
//
// The bug's signature on margin is a NEGATIVE spacing-scale value: `margin: -1`
// -> -8px, an element pulled out of flow by eight times what was written. A
// POSITIVE margin on one of these spans cannot come from the style object at
// all — every copy of it, right and wrong, writes a negative margin — it comes
// from a layout parent, and one really is in play here: MUI's Stack applies
// `margin: 0` plus `margin-left: <spacing>` to each non-first child, which
// wins the cascade over the child's own emotion class and is exactly what
// ReferenceControl's `<Stack spacing={1}>` does to its hidden region. Failing
// on that would be failing on correct code, so the rule states only what is
// actually required: this element must not pull ITSELF off its static position
// by more than a couple of pixels.
function marginProblem(name, value) {
  const m = LENGTH.exec(String(value));
  if (!m) return `${name} computed to "${value}", which carries no px unit — sx reinterpreted a unitless number`;
  if (Number(m[1]) < -MAX_PX) {
    return `${name} computed to "${value}", a spacing-scale pull rather than the ${MAX_PX}px a clip-rect nudges by — sx rescaled a unitless number`;
  }
  return null;
}

// `padding` and `border` are 0 in every copy, and 0 needs no unit, so they are
// not swept.
function problemsFor(el) {
  const cs = getComputedStyle(el);
  return [
    sizeProblem("width", cs.width),
    sizeProblem("height", cs.height),
    marginProblem("marginTop", cs.marginTop),
    marginProblem("marginRight", cs.marginRight),
    marginProblem("marginBottom", cs.marginBottom),
    marginProblem("marginLeft", cs.marginLeft),
  ].filter(Boolean);
}

// The fingerprint of a screen-reader-only overlay, read off COMPUTED style so
// it matches an element regardless of which constant (or inline literal) it
// came from. This is what makes the guard general: a region added to either
// component next year is swept on the day it is written, without this file
// naming it.
function isScreenReaderOnly(el) {
  const cs = getComputedStyle(el);
  return cs.position === "absolute" && cs.whiteSpace === "nowrap" && cs.overflow === "hidden";
}

function screenReaderOnlyElements() {
  return [...container.querySelectorAll("*")].filter(isScreenReaderOnly);
}

function describeEl(el) {
  const role = el.getAttribute("role");
  return `<${el.tagName.toLowerCase()}${role ? ` role="${role}"` : ""}>${(el.textContent || "").slice(0, 40)}`;
}

const pageInsight = {
  id: "i1",
  text: "Mention that reconciliation dropped from three days to under an hour.",
  kind: "point",
  source: { kind: "page", pageId: "p-1", pageTitle: "Payments migration" },
};
const transcriptInsight = {
  id: "i4",
  text: "They just said the SLA is 24 hours, not 48.",
  kind: "point",
  source: { kind: "transcript", pageId: null, pageTitle: null },
};

describe("MeetingTranscript's visually-hidden 'Still speaking:' prefix", () => {
  it("computes to a negligible box, not a full-size overlay", async () => {
    await render(
      createElement(MeetingTranscript, {
        turns: [{ id: "t1", speaker: "you", text: "Are we still gated on the legacy processor?", at: 1000 }],
        interims: { them: "Only for refunds" },
        source: "tab",
      }),
    );
    const regions = screenReaderOnlyElements();
    // Positive control for THIS case: the interim row really does render one,
    // so the sweep below cannot pass by matching nothing.
    expect(regions.length, "no screen-reader-only element found to check").toBeGreaterThanOrEqual(1);
    expect(regions.some((el) => (el.textContent || "").includes("Still speaking"))).toBe(true);
    for (const el of regions) {
      expect(problemsFor(el), `${describeEl(el)} — ${problemsFor(el).join("; ")}`).toEqual([]);
    }
  });
});

describe("MeetingInsightList's visually-hidden live regions", () => {
  it("computes the topic-change region to a negligible box", async () => {
    await render(
      createElement(MeetingInsightList, {
        insights: [pageInsight],
        topic: "Refund SLA",
        topicChanged: true,
        loading: false,
        error: "",
      }),
    );
    const regions = screenReaderOnlyElements();
    expect(regions.length, "no screen-reader-only element found to check").toBeGreaterThanOrEqual(1);
    for (const el of regions) {
      expect(problemsFor(el), `${describeEl(el)} — ${problemsFor(el).join("; ")}`).toEqual([]);
    }
  });

  // The one that multiplies. ReferenceControl renders a role="status" span per
  // insight card, and neither MUI's Card (styled with `overflow: hidden` but no
  // `position`) nor CardContent (padding only) is positioned — so each overlay's
  // containing block is the initial one, not its card, and each is a full-size
  // box rather than a card-size one. Two cards is two of them; a real meeting
  // has many.
  it("computes EVERY per-card reference region to a negligible box, not one per card", async () => {
    await render(
      createElement(MeetingInsightList, {
        insights: [pageInsight, transcriptInsight],
        topic: "Refund SLA",
        topicChanged: false,
        loading: false,
        error: "",
        onFindReferences: () => {},
        referencesByInsightId: {
          i1: { status: "loading" },
          i4: { status: "done", result: { references: [], grounded: true } },
        },
      }),
    );
    const regions = screenReaderOnlyElements();
    // One per card plus the list-level topic region.
    expect(regions.length, "expected a hidden region per insight card").toBeGreaterThanOrEqual(3);
    const failures = regions
      .map((el) => ({ el, problems: problemsFor(el) }))
      .filter((r) => r.problems.length > 0)
      .map((r) => `${describeEl(r.el)} — ${r.problems.join("; ")}`);
    expect(failures, `${failures.length} of ${regions.length} hidden regions are full-size overlays`).toEqual([]);
  });

  it("does not put a positioned ancestor between the region and the initial containing block", async () => {
    // Why the size matters at all rather than being a harmless over-declaration:
    // an absolutely positioned element inside an UNpositioned Card resolves
    // against the initial containing block and escapes that Card's
    // `overflow: hidden`, so a 100%-wide overlay is 100% of the PAGE. Pinned so
    // that if someone later positions the Card, this case fails and the size
    // rule can be re-argued deliberately instead of silently relaxing.
    await render(
      createElement(MeetingInsightList, {
        insights: [pageInsight],
        topic: "Refund SLA",
        loading: false,
        error: "",
        onFindReferences: () => {},
        referencesByInsightId: { i1: { status: "loading" } },
      }),
    );
    const region = screenReaderOnlyElements().find((el) => el.getAttribute("role") === "status");
    expect(region, "no role=status region rendered").toBeTruthy();
    let positioned = null;
    for (let el = region.parentElement; el && el !== document.body; el = el.parentElement) {
      const pos = getComputedStyle(el).position;
      if (pos && pos !== "static") {
        positioned = el;
        break;
      }
    }
    expect(positioned, "a positioned ancestor now exists; re-read this case's comment").toBe(null);
  });
});

describe("the harness itself", () => {
  // Without this the whole file could go green by measuring nothing, or by
  // jsdom quietly ceasing to resolve emotion's injected CSS.
  it("flags a planted plain-CSS clip-rect passed to sx", async () => {
    const planted = {
      position: "absolute",
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      border: 0,
    };
    await render(createElement(Box, { component: "span", sx: planted }, "planted"));
    const [el] = screenReaderOnlyElements();
    expect(el, "the fingerprint failed to match a textbook visually-hidden element").toBeTruthy();
    const problems = problemsFor(el);
    // The exact three the bug produces: width 100%, height 100%, margin -8px on
    // all four sides.
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(getComputedStyle(el).width).toBe("100%");
    expect(getComputedStyle(el).marginTop).toBe("-8px");
  });

  it("passes a planted unit-bearing clip-rect", async () => {
    const planted = {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: 0,
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      whiteSpace: "nowrap",
      border: 0,
    };
    await render(createElement(Box, { component: "span", sx: planted }, "planted"));
    const [el] = screenReaderOnlyElements();
    expect(el).toBeTruthy();
    expect(problemsFor(el)).toEqual([]);
  });

  it("rejects a unit-bearing but oversized length, so the unit check alone cannot pass it", () => {
    // The hole a units-only rule leaves: `margin: -1` computes to "-8px", which
    // has a unit. Asserted directly on the classifiers so the rule is pinned
    // independently of any component.
    expect(marginProblem("marginTop", "-8px")).toMatch(/spacing-scale pull/);
    expect(sizeProblem("width", "400%")).toMatch(/no px unit/);
    expect(sizeProblem("width", "100%")).toMatch(/no px unit/);
    expect(sizeProblem("width", "1px")).toBe(null);
    expect(marginProblem("marginTop", "-1px")).toBe(null);
    // A layout parent's positive margin is not this bug — see marginProblem's
    // own comment. Pinned so the exemption is deliberate rather than emergent.
    expect(marginProblem("marginLeft", "8px")).toBe(null);
  });

  it("passes a correct region nested in a Stack that adds its own spacing margin", async () => {
    // The exact structure of ReferenceControl, so the rule above is proven to
    // tolerate `<Stack spacing={1}>` BEFORE the implementer meets it. Without
    // this case, the fix would leave a red test and look like a bad fix.
    const good = {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: 0,
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      whiteSpace: "nowrap",
      border: 0,
    };
    await render(
      createElement(
        Stack,
        { direction: "row", spacing: 1 },
        createElement(Box, { component: "span" }, "first"),
        createElement(Box, { component: "span", role: "status", sx: good }, "announcement"),
      ),
    );
    const [el] = screenReaderOnlyElements();
    expect(el, "the fingerprint failed to match the region inside a Stack").toBeTruthy();
    // Positive control that the Stack really is contributing the margin this
    // rule exempts — if MUI ever stops doing that, this case says so rather
    // than silently making the exemption dead.
    expect(getComputedStyle(el).marginLeft).toBe("8px");
    expect(problemsFor(el)).toEqual([]);
  });
});
