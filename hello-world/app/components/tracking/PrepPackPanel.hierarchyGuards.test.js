// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N50 TDD hand-off, part 2 -- what the restructure must HIDE (AC-N50.8's
// zero-visible half, H-5), how it must RANK type (AC-N50.4, H-7), and the
// guards it must not break on the way (AC-N50.9-.14, .17, .19), all over the
// ONE shared maximal fixture (test/helpers/prepMaximalFixture.js).
// Binds to <scratchpad>/chunks/N50/ac.r1.md; specified by plan.r2.md section 6.
// ---------------------------------------------------------------------------
//
// RED ON HEAD, and why (each case's comment repeats its own reason):
//   * H-5: all 36 restore rows (4 sections x (PREP_SECTION_REVISIONS_MAX - 1))
//     are on screen on first paint.
//   * H-7: the section heading is 13px, smaller than the 13.5px answer lines
//     it labels; the source-list entries and the names strip declare no
//     secondary colour, so both read as primary although they are T2.
//   * AC-N50.11 (group half), AC-N50.12 (opened-disclosure and transient
//     halves): no group, no disclosure, no transient exists yet, so each case
//     asserts its precondition first and is RED on that, never vacuous.
//   * AC-N50.14: the caption says "replaces the pack above", and both orphan
//     notice variants say "below".
// GREEN ON HEAD by design (non-regression guards, AC-N50.9/.10/.13/.17/.19):
// each says so in its own title. They exist because "cleaner" invites
// deletion, and this panel has twice shipped a populated field with no
// renderer (N48, N43).
//
// H-5 IS WRITTEN PER HELPER, never as one union (plan m1, checker-executed):
// jsdom does NOT hide a closed <details>'s children on its own (plan-probe F1,
// re-canaried in test/helpers/prepPanelInstruments.test.js), so the
// `visibleText` half is the only thing that notices a build which drops the
// authored `:not([open])` rule -- a union with `collapsedBehindAControl` would
// let that build pass.
//
// WHAT THIS FILE CANNOT ASSERT:
//   * Pixels. Every style assertion reads a DECLARED computed value; ranks, not
//     values, are pinned (AC-N50.4 fixes ranks only).
//   * The chips that show interviewer names are MUI Chip components that
//     declare their own text colour; AC-N50.4(c) is checked on every other T2
//     text element and the chips are EXEMPT here -- a disclosed gap, not a
//     pass (see the H-7 case).
//   * A WRONG declared margin (AC-N50.12's guard proves a declaration exists).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PrepPackPanel from "./PrepPackPanel.js";
import { PREP_SECTION_REVISIONS_MAX } from "@/lib/interviewPrep/prepConstants.js";
import { maximalPanelProps, maximalPack, maximalPackStrings, maximalClaims, maximalRevisions } from "@/test/helpers/prepMaximalFixture.js";
import {
  norm,
  visibleText,
  collapsedBehindAControl,
  controlName,
  accessibleName,
  headingElements,
  headingLevel,
  follows,
  unpinnedVerticalMargins,
} from "@/test/helpers/prepPanelInstruments.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});

async function render(props) {
  await act(async () => root.render(createElement(PrepPackPanel, props)));
  return container.firstElementChild;
}
function click(node) {
  return act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

const LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};
const ALL = ["aboutYou", "whyRole", "askThem", "stages"];
const buttons = (el) => [...el.querySelectorAll('button, [role="button"]')];
const restoreControls = (el) => buttons(el).filter((b) => /^restore\b/i.test(controlName(b)));
const sectionHeadingsOf = (el) => headingElements(el).filter((h) => headingLevel(h) === 3);
const groupFor = (el, section) => [...el.querySelectorAll('[role="group"]')].find((g) => accessibleName(g) === LABELS[section]);
const RESTORE_ROW_TEXT = /(earlier|restored) version \d+/i;

/** An element's OWN text: its direct text-node children, normalized. The
 *  host of a string is the element that holds it directly -- an answer line
 *  holds its text and a citation marker ELEMENT, so its visibleText carries
 *  the marker's digit while its own text does not. */
function ownText(node) {
  return norm([...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(""));
}
function hostOf(el, text) {
  return [...el.querySelectorAll("*")].find((n) => ownText(n) === norm(text)) || null;
}
const px = (node) => parseFloat(node.ownerDocument.defaultView.getComputedStyle(node).fontSize);
const colorOf = (node) => node.ownerDocument.defaultView.getComputedStyle(node).color;

describe("AC-N50.8 zero-visible half (H-5, PER HELPER) -- no restore control is on screen on first paint", () => {
  const RESTORABLE = 4 * (PREP_SECTION_REVISIONS_MAX - 1);

  it(`[positive control, green on HEAD] the maximal idle panel still MOUNTS all ${RESTORABLE} restore controls -- hidden, never removed (C3 not authorised)`, async () => {
    const el = await render(maximalPanelProps({ transients: false }));
    expect(restoreControls(el)).toHaveLength(RESTORABLE);
    expect(norm(el.textContent), "the rows' text must be in the DOM for the visibility halves below to mean anything").toMatch(RESTORE_ROW_TEXT);
  });

  it("[visibleText alone] the text a reader sees carries no restore row and no Restore control", async () => {
    // RED ON HEAD: 36 rows on screen. Kills D1 (the authored hide rule
    // dropped): jsdom then shows a closed details' children to this helper.
    const el = await render(maximalPanelProps({ transients: false }));
    expect(restoreControls(el).length).toBe(RESTORABLE);
    const seen = norm(visibleText(el));
    expect(seen).not.toMatch(RESTORE_ROW_TEXT);
    expect(seen).not.toMatch(/\bRestore\b/);
  });

  it("[collapsedBehindAControl alone] every restore control sits behind a collapsed control", async () => {
    // RED ON HEAD: nothing collapses them.
    const el = await render(maximalPanelProps({ transients: false }));
    const controls = restoreControls(el);
    expect(controls.length).toBe(RESTORABLE);
    const exposed = controls.filter((c) => !collapsedBehindAControl(c, el)).map(controlName);
    expect(exposed).toEqual([]);
  });
});

describe("AC-N50.4 (H-7) -- type rank matches the tiers (ranks, never values)", () => {
  const { t1, t2 } = maximalPackStrings();

  function t2Hosts(el) {
    const hosts = [];
    const need = (label, node) => hosts.push([label, node]);
    for (const text of t2) need(`suggested answer "${text.slice(0, 30)}"`, hostOf(el, text));
    need("suggested-answer label", hostOf(el, "Suggested answer:"));
    need("status banner", hostOf(el, "Your interview prep pack is ready."));
    need("orphan notice", [...el.querySelectorAll("*")].find((n) => /source material/i.test(ownText(n))) || null);
    for (const claim of maximalClaims().filter((c) => c.id !== "cO")) need(`source entry "${claim.id}"`, [...el.querySelectorAll("ol *")].find((n) => ownText(n) === claim.text) || null);
    for (const section of ALL) need(`sources heading ${section}`, headingElements(el).find((h) => accessibleName(h) === `Sources for ${LABELS[section]}`) || null);
    need("names strip: candidate name", hostOf(el, "Alex Shaw"));
    need("names strip: 'Your name:' label", hostOf(el, "Your name:"));
    need("destructive caption", el.querySelector('[data-testid="regenerate-caption"]'));
    need("whole-pack outcome alert", [...el.querySelectorAll('[role="alert"]')].find((n) => /isn't available/.test(n.textContent)) || null);
    return hosts;
  }

  it("[maximal] (a) every section heading's font-size is STRICTLY greater than every T1 body element's", async () => {
    // RED ON HEAD: h3 13px < answer line / askThem question 13.5px.
    const el = await render(maximalPanelProps({ transients: false }));
    const headings = sectionHeadingsOf(el);
    expect(headings).toHaveLength(4);
    const t1Hosts = t1.map((text) => [text, hostOf(el, text)]);
    expect(t1Hosts.filter(([, h]) => !h).map(([t]) => t), "T1 strings with no host element").toEqual([]);
    const smallestHeading = Math.min(...headings.map(px));
    const largestT1 = Math.max(...t1Hosts.map(([, h]) => px(h)));
    expect(Number.isFinite(smallestHeading) && Number.isFinite(largestT1)).toBe(true);
    expect(smallestHeading, `heading ${smallestHeading}px vs largest T1 body ${largestT1}px`).toBeGreaterThan(largestT1);
  });

  it("[maximal] (b) every T1 body element is at least as large as every T2 text element", async () => {
    // GREEN ON HEAD (guard): T1 13-13.5px, T2 11.5-12.5px today.
    const el = await render(maximalPanelProps({ transients: false }));
    const t1Sizes = t1.map((text) => px(hostOf(el, text)));
    const hosts = t2Hosts(el);
    expect(hosts.filter(([, n]) => !n).map(([l]) => l), "T2 elements with no host").toEqual([]);
    const largestT2 = Math.max(...hosts.map(([, n]) => px(n)));
    expect(Math.min(...t1Sizes)).toBeGreaterThanOrEqual(largestT2);
  });

  it("[maximal] (c) every T2 text element resolves its colour to var(--text-secondary) -- declared or inherited", async () => {
    // RED ON HEAD: the source-list entries (li/a) and the names strip declare
    // no colour and resolve to the primary text colour. Chips exempt (header).
    const el = await render(maximalPanelProps({ transients: false }));
    const hosts = t2Hosts(el);
    expect(hosts.filter(([, n]) => !n).map(([l]) => l), "T2 elements with no host").toEqual([]);
    const wrong = hosts.filter(([, n]) => colorOf(n) !== "var(--text-secondary)").map(([l, n]) => `${l}: ${colorOf(n)}`);
    expect(wrong).toEqual([]);
  });

  it("[transients] the in-progress and waiting lines are T2 as well: secondary colour, no larger than T1 body", async () => {
    // RED ON HEAD: no waiting line exists, and the panel ignores
    // `sectionActivity`, so no role=status region carries any text.
    const el = await render(maximalPanelProps());
    const lines = [...el.querySelectorAll('[role="status"] *, [role="status"]')].filter((n) => ownText(n).length > 0);
    expect(lines.length, "no activity line rendered").toBeGreaterThanOrEqual(2);
    const smallestT1 = Math.min(...t1.map((text) => px(hostOf(el, text))));
    for (const line of lines) {
      expect(colorOf(line), ownText(line)).toBe("var(--text-secondary)");
      expect(px(line)).toBeLessThanOrEqual(smallestT1);
    }
  });

  it("[a nameless stage] the 'Source for this stage' fallback line is T2 too (secondary colour, no larger than T1)", async () => {
    // RED ON HEAD: that line is bold 13px in the primary colour.
    const pack = maximalPack();
    pack.sections.stages.stages[3].name = null;
    const el = await render(maximalPanelProps({ transients: false }, { pack }));
    const line = hostOf(el, "Source for this stage");
    expect(line, "the nameless-stage fallback line did not render").toBeTruthy();
    expect(colorOf(line)).toBe("var(--text-secondary)");
    expect(px(line)).toBeLessThanOrEqual(Math.min(...t1.filter((t) => hostOf(el, t)).map((t) => px(hostOf(el, t)))));
  });
});

describe("AC-N50.9 -- nothing the pack carries is dropped (GUARD, green on HEAD)", () => {
  it("[maximal] every T1 and T2 string is first-paint visible, and every cited claim is named by its marker and listed", async () => {
    const el = await render(maximalPanelProps());
    const { t1, t2, claims } = maximalPackStrings();
    const seen = norm(visibleText(el));
    const missing = [...t1, ...t2].filter((text) => !seen.includes(norm(text)));
    expect(missing).toEqual([]);
    const markerNames = [...el.querySelectorAll("[data-citation-marker]")].map(controlName);
    const byText = new Map(maximalClaims().map((c) => [c.text, c]));
    for (const text of claims) {
      const claim = byText.get(text);
      if (claim.id === "cU") expect(markerNames.some((n) => /^Citation \d+: link unavailable$/.test(n))).toBe(true);
      else expect(markerNames.some((n) => n.endsWith(`: ${text}`)), `no marker names "${text}"`).toBe(true);
      expect(seen, `claim "${claim.id}" is not in any visible source list`).toContain(text);
    }
  });
});

describe("AC-N50.10 -- the suggested answer stays always visible, in full, after its questions (N48 GUARD, green on HEAD)", () => {
  it("[maximal] each stage's answer is on screen, outside any disclosure, unclamped, and after that stage's last question", async () => {
    const el = await render(maximalPanelProps());
    for (const stage of maximalPack().sections.stages.stages) {
      const host = hostOf(el, stage.recommendedAnswer);
      expect(host, `no host for ${stage.name}'s answer`).toBeTruthy();
      expect(collapsedBehindAControl(host, el)).toBe(false);
      expect(host.closest("details")).toBe(null);
      expect(norm(visibleText(host))).toBe(norm(stage.recommendedAnswer));
      const style = getComputedStyle(host);
      expect(style.textOverflow).not.toBe("ellipsis");
      expect((style.getPropertyValue("-webkit-line-clamp") || style.getPropertyValue("line-clamp")).trim()).toBe("");
      const lastQuestion = hostOf(el, stage.questions[stage.questions.length - 1]);
      expect(follows(lastQuestion, host), `${stage.name}: the answer must follow the questions`).toBe(true);
    }
  });
});

describe("AC-N50.11 -- an excluded section's WHOLE GROUP cannot see pack content", () => {
  const thin = () => ({
    version: 1,
    sections: {
      aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches.", support: null }] } },
      whyRole: { answer: { lines: [] } },
      askThem: { questions: [] },
      stages: { stages: [{ name: null, questions: [], recommendedAnswer: null, support: null }] },
    },
    claims: [],
  });
  const fat = () => {
    const p = maximalPack();
    p.sections.aboutYou = thin().sections.aboutYou;
    return p;
  };
  const props = (pack, completeSections) => maximalPanelProps({ transients: false }, { pack, status: "partial", completeSections });

  it("[invariance] the excluded whyRole group, controls included, is byte-identical for two wildly different pack contents", async () => {
    // RED ON HEAD: no group exists (the body half is already pinned by
    // PrepPackPanel.sectionHeaders.test.js's AC-N44.3 invariance case).
    const a = await render(props(thin(), ["aboutYou"]));
    const groupA = groupFor(a, "whyRole");
    expect(groupA, "no whyRole group").toBeTruthy();
    expect(buttons(groupA).some((b) => /regenerate/i.test(controlName(b))), "the group must carry its controls, or this compares less than the AC asks").toBe(true);
    const htmlA = groupA.outerHTML;
    const b = await render(props(fat(), ["aboutYou"]));
    expect(groupFor(b, "whyRole").outerHTML).toBe(htmlA);
  });

  it("[control] the same two packs render the whyRole group DIFFERENTLY once it is included -- the comparison can fire", async () => {
    const a = await render(props(thin(), ["aboutYou", "whyRole"]));
    const groupA = groupFor(a, "whyRole");
    expect(groupA, "no whyRole group").toBeTruthy();
    const htmlA = groupA.outerHTML;
    const b = await render(props(fat(), ["aboutYou", "whyRole"]));
    expect(groupFor(b, "whyRole").outerHTML).not.toBe(htmlA);
  });
});

describe("AC-N50.12 -- every UA-margin element states its margins, with every disclosure OPEN and in the transient states", () => {
  it("[maximal idle, every history disclosure opened by a real click] no guarded element hands its spacing to the browser", async () => {
    // RED ON HEAD on its precondition: there is no disclosure to open.
    const el = await render(maximalPanelProps({ transients: false }));
    const summaries = [...el.querySelectorAll("summary")];
    expect(summaries, "no history disclosure to open, so this guard would measure nothing").toHaveLength(4);
    for (const summary of summaries) await click(summary);
    expect([...el.querySelectorAll("details")].every((d) => d.open), "a real click did not open every disclosure").toBe(true);
    expect(unpinnedVerticalMargins(el)).toEqual([]);
  });

  it("[maximal with both N53 transients] the same guard holds", async () => {
    // RED ON HEAD on its precondition: no activity line renders.
    const el = await render(maximalPanelProps());
    const statusText = [...el.querySelectorAll('[role="status"]')].map((n) => norm(n.textContent)).filter(Boolean);
    expect(statusText.length, "no transient rendered, so this guard would measure nothing").toBeGreaterThanOrEqual(2);
    expect(unpinnedVerticalMargins(el)).toEqual([]);
  });
});

describe("AC-N50.13 -- citation markers keep their names and stay inline on T1 lines (GUARD, green on HEAD)", () => {
  it("[maximal] a cited marker is a link named `Source {n}: {claim}` for the claim its own href points at; an unsafe one is an inert span", async () => {
    const el = await render(maximalPanelProps());
    const markers = [...el.querySelectorAll("[data-citation-marker]")];
    expect(markers.length, "no markers rendered").toBeGreaterThan(0);
    const byUrl = new Map(maximalClaims().map((c) => [c.sourceUrl, c]));
    let unsafe = 0;
    for (const m of markers) {
      const n = m.getAttribute("data-citation-marker");
      if (m.tagName.toLowerCase() === "a") {
        const claim = byUrl.get(m.getAttribute("href"));
        expect(claim, `a marker links somewhere the pack never claimed: ${m.getAttribute("href")}`).toBeTruthy();
        expect(controlName(m)).toBe(`Source ${n}: ${claim.text}`);
      } else {
        unsafe += 1;
        expect(controlName(m)).toBe(`Citation ${n}: link unavailable`);
        expect(m.hasAttribute("href")).toBe(false);
        expect(m.hasAttribute("tabindex")).toBe(false);
      }
      expect(m.closest("details"), "a marker moved into T3").toBe(null);
      const described = m.getAttribute("aria-describedby");
      if (described) for (const id of described.trim().split(/\s+/)) expect(document.getElementById(id)).toBe(null);
    }
    expect(unsafe, "exactly one item cites the unsafe claim").toBe(1);
  });
});

describe("AC-N50.14 -- no copy states where something is on screen, in any state", () => {
  const POSITIONAL = /\b(above|below|beneath|underneath)\b/i;
  // FROZEN SNAPSHOT of HEAD's three positional strings (git show HEAD:
  // hello-world/app/components/tracking/PrepPackPanel.js, :280-281 and :595),
  // so the canary proves the regex bites on exactly the copy this criterion
  // exists to remove -- an empty-string reader cannot pass it.
  const HEAD_STRINGS = [
    "This pack's research produced source material that isn't tied to anything shown below.",
    "This pack's research also produced source material beyond what's tied to the citations below.",
    "Regenerating replaces the pack above the moment you start — before the new one is ready.",
  ];

  it("[canary] the regex matches every HEAD positional string and not the positional-free rewrite", () => {
    for (const s of HEAD_STRINGS) expect(s).toMatch(POSITIONAL);
    expect("Regenerating replaces this pack the moment you start.").not.toMatch(POSITIONAL);
  });

  it("[state matrix: six statuses x no pack / orphan-partial pack / orphan-empty pack x idle / in-flight / no-description] no rendered text is positional", async () => {
    // RED ON HEAD: "replaces the pack above" (every idle state with a pack)
    // and "citations below" / "shown below" (both orphan variants).
    const orphanEmpty = () => ({ ...maximalPack(), sections: { aboutYou: { answer: { lines: [{ text: "One line.", support: null }] } } } });
    const packs = [
      ["no pack", () => null],
      ["orphan-partial", () => maximalPack()],
      ["orphan-empty", orphanEmpty],
    ];
    const actions = [
      ["idle", {}],
      ["in-flight", { generating: true }],
      ["no-description", { hasDescription: false }],
    ];
    const offenders = [];
    let rendered = 0;
    for (const status of [null, "running", "ready", "partial", "failed", "unavailable"]) {
      for (const [packName, makePack] of packs) {
        for (const [actionName, extra] of actions) {
          const el = await render(maximalPanelProps({ transients: false }, { status, pack: makePack(), ...extra }));
          rendered += 1;
          const text = norm(el.textContent);
          if (POSITIONAL.test(text)) offenders.push(`${status}/${packName}/${actionName}: "${text.match(POSITIONAL)[0]}"`);
        }
      }
    }
    expect(rendered).toBe(54);
    expect(offenders).toEqual([]);
    // 54 full mounts of the maximal panel: an explicit budget, so a loaded
    // machine reports a timeout as a timeout rather than as a verdict.
  }, 60000);

  it("[N53 states] transients, section outcomes and a queued whole-pack regenerate carry no positional copy either", async () => {
    const outcomes = {
      aboutYou: { kind: "generate", revision: null, result: { status: "refused", reason: "in-flight" } },
      whyRole: { kind: "restore", revision: 4, result: { status: "conflict" } },
      stages: { kind: "restore", revision: 3, result: { error: "Something went wrong.", networkError: true } },
      askThem: { kind: "generate", revision: null, result: { status: "disabled" } },
    };
    for (const props of [maximalPanelProps(), maximalPanelProps({ transients: false }, { sectionOutcomes: outcomes, wholePackQueued: true })]) {
      const el = await render(props);
      expect(norm(el.textContent)).not.toMatch(POSITIONAL);
    }
  });
});

describe("AC-N50.17 -- room for N49, N51 and N42 (GUARDS, green on HEAD)", () => {
  const OVERCLAIM_WORDS = ["verified", "verify", "fact-check", "fact check", "confirmed", "confirms", "proven"];

  it("(a) every T1 item carries at most ONE inline trailing apparatus element -- the provenance slot N49 will occupy", async () => {
    const el = await render(maximalPanelProps());
    const { t1 } = maximalPackStrings();
    const over = [];
    for (const text of t1) {
      const host = hostOf(el, text);
      expect(host, `no host for "${text}"`).toBeTruthy();
      // A stage heading's slot is its sibling (the marker sits AFTER the h4,
      // never inside it -- H-4); everything else carries it as a child.
      const apparatus = /^h[1-6]$/i.test(host.tagName) ? [...host.parentElement.children].filter((c) => c !== host) : [...host.children];
      if (apparatus.length > 1) over.push(`"${text}" carries ${apparatus.length}`);
    }
    expect(over).toEqual([]);
  });

  it("(b) nothing on the maximal panel -- transients, outcomes, queued state included -- reads as verified", async () => {
    const outcomes = {
      aboutYou: { kind: "generate", revision: null, result: { status: "refused", reason: "error" } },
      whyRole: { kind: "restore", revision: 4, result: { status: "conflict" } },
    };
    let sawMarker = false;
    for (const props of [maximalPanelProps(), maximalPanelProps({ transients: false }, { sectionOutcomes: outcomes, wholePackQueued: true })]) {
      const el = await render(props);
      sawMarker = sawMarker || el.querySelectorAll("[data-citation-marker]").length > 0;
      const lower = norm(visibleText(el)).toLowerCase();
      for (const word of OVERCLAIM_WORDS) expect(lower, `forbidden vocabulary: "${word}"`).not.toContain(word);
    }
    expect(sawMarker, "under-fire control: a citation must actually render").toBe(true);
  });
});

describe("AC-N50.19 -- behaviours other chunks landed on this surface stay intact (GUARDS, green on HEAD)", () => {
  it("'Download prep log' is visible without interaction in the maximal, maximal-idle and absent states", async () => {
    for (const props of [maximalPanelProps(), maximalPanelProps({ transients: false }), maximalPanelProps({}, { pack: null, status: null, completeSections: [] })]) {
      const el = await render(props);
      const download = buttons(el).find((b) => /download prep log/i.test(controlName(b)));
      expect(download).toBeTruthy();
      expect(collapsedBehindAControl(download, el)).toBe(false);
      expect(norm(visibleText(download))).toMatch(/download prep log/i);
    }
  });

  it("the orphan notice sits before all four sections, and no button anywhere is disabled", async () => {
    const el = await render(maximalPanelProps());
    const notice = [...el.querySelectorAll("*")].find((n) => /source material/i.test(ownText(n)));
    expect(notice).toBeTruthy();
    expect(follows(notice, sectionHeadingsOf(el)[0])).toBe(true);
    expect(el.querySelectorAll("button[disabled], [aria-disabled='true']")).toHaveLength(0);
  });

  it("the destructive caption stays adjacent to the whole-pack control it warns about", async () => {
    const el = await render(maximalPanelProps({ transients: false }));
    const regen = buttons(el).find((b) => /^regenerate$/i.test(controlName(b)));
    const caption = el.querySelector('[data-testid="regenerate-caption"]');
    expect(regen).toBeTruthy();
    expect(caption).toBeTruthy();
    expect(caption.previousElementSibling && caption.previousElementSibling.contains(regen), "the caption must directly follow the row holding the control").toBe(true);
  });

  it("[fixture sanity] maximalRevisions reaches the panel: every section offers MAX - 1 restorable versions", async () => {
    const el = await render(maximalPanelProps({ transients: false }));
    const { liveRevisions } = maximalRevisions();
    for (const section of ALL) {
      const mine = restoreControls(el).filter((b) => controlName(b).includes(LABELS[section]));
      expect(mine).toHaveLength(PREP_SECTION_REVISIONS_MAX - 1);
      expect(mine.some((b) => controlName(b).endsWith(`version ${liveRevisions[section]}`))).toBe(false);
    }
  });
});
