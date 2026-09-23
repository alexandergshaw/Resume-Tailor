// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N49 + N51 TDD hand-off -- THE ACCEPTANCE FRAME (plan.r4.md section 11.2,
// rows F-A .. F-G; binds to <scratchpad>/chunks/N49/ac.r1.md).
//
// What a reader of a finished pack must be able to tell, and cannot today:
// which interview stages, questions and interviewer titles were actually
// REPORTED by somebody, which are the model's guesses, and which sources say
// so. The owner's real prep pack ships fabricated stage citations and no
// confidence labels at all, which is the defect this chunk exists to fix.
// ---------------------------------------------------------------------------
//
// THE OWNER'S SCOPE RULING BINDS THIS FILE. The feature applies ONLY to a
// pack carrying a research snapshot. A pack generated before N49 ships keeps
// today's behaviour EXACTLY -- its model-authored citation links still render
// and nothing is labelled. So this file has two halves that pull in opposite
// directions, and both are load-bearing:
//
//   * F-A and F-B are the NARROWING guard, over the frozen snapshot-LESS
//     fixture. They are GREEN ON HEAD, and F-B is green VACUOUSLY (it counts
//     elements of a kind that does not exist yet). Neither is evidence of
//     anything on its own. Their power was established the only way it can
//     be -- by a mutant: plan.r4.md executed `dp5` (restore D-P5, so
//     `researchStateOf` returns a state for a snapshot-less pack) and both
//     rows went red, 2 failed / 7 passed. This file re-runs that mutant in
//     its own reference tree rather than citing it.
//   * F-C .. F-G are RED ON HEAD, each because the thing it asserts does not
//     render at all. Each case's own comment says which.
//
// THE DOM CONTRACT THIS FILE IMPOSES, and why it is attributes rather than
// text matching. Three hooks, all in the same discipline as the shipped
// `data-citation-marker` on N43's own marker:
//   [data-n49-item="stage"|"question"|"role"]  the host element of one
//       labelled item: it contains that item's own text and exactly one token.
//   [data-n49-token="reported"|"single"|"unsourced"]  the confidence token,
//       whose visible text is the label and NOTHING else.
//   [data-n49-source]  one anchor per publisher, a sibling of the token
//       inside the same host (never inside it, so the token's text stays the
//       label alone).
//   [data-n49-state]  the research-state line, at most one per panel.
//   [data-n49-roles-dropped]  the refused-titles disclosure.
// Counting tokens alone would be satisfied by a build that renders 21 empty
// tokens, so every census row below ALSO reads the host's own text back and
// matches it against the fixture's strings. That is what makes "the labels
// cover a subset" (risk R34) impossible to pass rather than merely unlikely.
//
// WHAT THIS FILE DELIBERATELY DOES NOT PIN:
//   * The dash in "Possible - not sourced". design.r3.md section 8.1 spells
//     it with an em dash and plan.r4.md section 9.2 with a hyphen; 1c owns
//     that typography. Every label assertion below is dash-agnostic and pins
//     the WORDS and the NUMBER, which are the content. Cost, stated: a build
//     that ships a different dash than 1c settles on passes this file.
//   * Where the roles line sits relative to the questions. plan.r4.md
//     section 9.3 calls it a design choice and hierarchyGuards.test.js does
//     not constrain it, so the census matches on item TEXT, never on order.
//   * Pixels, and any WRONG declared value. Same limits as every other panel
//     suite here.
//   * Whether the panel would look right in a browser. jsdom renders the
//     tree and computes declared styles; it lays nothing out.
//
// WHAT NO ASSERTION IN THIS FILE CAN CATCH, said plainly: a label that is
// correct in kind and wrong in NUMBER for a reason the fixture does not
// exercise -- for instance a build that counts publishers correctly for 1 and
// 2 and miscounts 5. The fixture's largest publisher count is 2 because
// VERIFIED_MIN_PUBLISHERS is 2 and that is the boundary that decides the
// label; a build's arithmetic above the boundary is T10's (publisherKey.test)
// to pin, not this file's.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PrepPackPanel from "./PrepPackPanel.js";
import FrozenHeadPanel from "@/test/helpers/prepPanelFrozenHead.js";
import { maximalPanelProps, maximalClaims } from "@/test/helpers/prepMaximalFixture.js";
import {
  maximalResearchPack,
  maximalResearchPanelProps,
  researchItems,
  researchSources,
  expectedKind,
  RESEARCHED_AT,
} from "@/test/helpers/prepResearchFixture.js";
import { norm, visibleText } from "@/test/helpers/prepPanelInstruments.js";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { citationHost } from "@/lib/tracking/citationHref";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let containers;
let roots;
beforeEach(() => {
  containers = [];
  roots = [];
});
afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()));
  containers.forEach((node) => node.remove());
});

/** Mount a component with the props the real call site sends. Every render in
 *  this file goes through here and through the DEFAULT export, never through
 *  an inner component: `StagesSection`, `PrepStageBlock` and the state line
 *  are all reachable only by mounting the panel a candidate actually sees.
 *  That is the reachability requirement, and it is why F-D2 (the
 *  EmptySection branch) can exist at all -- an inner-component test cannot
 *  reach a branch the panel chooses. */
async function mount(Component, props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  containers.push(container);
  roots.push(root);
  await act(async () => root.render(createElement(Component, props)));
  return container;
}

const tokens = (root) => [...root.querySelectorAll("[data-n49-token]")];
const hosts = (root) => [...root.querySelectorAll("[data-n49-item]")];
const stateLines = (root) => [...root.querySelectorAll("[data-n49-state]")];

/** The host's own text with ALL of N49's apparatus removed, so a census can
 *  compare what the host LABELS against the fixture's string without the
 *  label, the source links or an inert-link notice polluting the comparison.
 *
 *  Stripping is generic -- every descendant carrying any `data-n49-*`
 *  attribute goes -- rather than a list of three selectors, so an
 *  implementation that adds a fourth piece of apparatus does not silently
 *  break the census for a reason unrelated to what it is measuring. What
 *  stops a build hiding the item's own text inside apparatus and passing
 *  trivially is that the result is compared for EQUALITY against the
 *  fixture's non-empty strings, never merely for containment. */
function hostItemText(host) {
  const clone = host.cloneNode(true);
  for (const node of clone.querySelectorAll("*")) {
    if ([...node.attributes].some((attr) => attr.name.startsWith("data-n49-"))) node.remove();
  }
  return norm(clone.textContent);
}

/** AC-N49's overclaim ban. Stems, not word boundaries: "verifies" and
 *  "confirming" must not walk through a `\bverified\b` test. */
const OVERCLAIM = /(verif|fact[-\s]?check|confirm|proven)/i;

// ---------------------------------------------------------------------------
// F-A / F-B -- THE NARROWING. A pack with no research snapshot is untouched.
// ---------------------------------------------------------------------------

describe("F-A [GREEN ON HEAD BY DESIGN] a snapshot-less pack renders byte-identically to the last shipped panel", () => {
  // This row cannot go red until N49 lands something, which is exactly its
  // job: it is the tripwire on the owner's ruling that a pre-N49 pack keeps
  // today's behaviour. The oracle is test/helpers/prepPanelFrozenHead.js, a
  // frozen byte copy of this panel at 8519fa4 with its three relative imports
  // rewritten and nothing else changed.
  //
  // WHY BOTH PANELS RENDER IN THE SAME DOCUMENT: MUI/emotion assigns class
  // names by hashing serialized styles at insertion time. They are stable
  // within a process and not across versions, so a frozen innerHTML STRING
  // would break on the next MUI bump for a reason having nothing to do with
  // N49. Rendering both here makes identical sx produce identical class
  // names, so the comparison carries no version coupling. Checked before
  // relying on it: neither this panel nor PrepSectionActions nor
  // PrepPackNamesStrip calls useId or Math.random or emits aria-controls, so
  // no per-instance identifier can make two renders differ innocently.
  for (const transients of [false, true]) {
    it(`is byte-identical for maximalPanelProps({ transients: ${transients} })`, async () => {
      const props = () => maximalPanelProps({ transients });
      const live = await mount(PrepPackPanel, props());
      const frozen = await mount(FrozenHeadPanel, props());
      // The floor: an empty render, or a panel that threw and rendered
      // nothing, would otherwise satisfy byte equality trivially.
      expect(live.innerHTML.length).toBeGreaterThan(5000);
      expect(live.innerHTML).toBe(frozen.innerHTML);
    });
  }

  it("[control] the oracle is not a copy of the module under test -- the two are separate modules", () => {
    // If a refactor ever made prepPanelFrozenHead.js re-export PrepPackPanel,
    // every assertion above would become f(x) === f(x): permanently green and
    // permanently incapable of failing. That is the consolidation trap in
    // loop-traps-tests, and this is the cheapest guard against it.
    expect(FrozenHeadPanel).not.toBe(PrepPackPanel);
  });
});

describe("F-B [GREEN ON HEAD, AND VACUOUSLY SO] a snapshot-less pack renders no N49 apparatus", () => {
  // DISCLOSED: on HEAD this passes because no build renders a token or a
  // state line at all, so it asserts the absence of a feature that does not
  // exist. It counts as coverage only once mutant `dp5` has been shown to
  // kill it -- which is why the paired positive control below exists, and why
  // the mutant run is part of the hand-off rather than an optional extra.
  it("renders zero provenance tokens and zero research-state lines", async () => {
    const root = await mount(PrepPackPanel, maximalPanelProps({ transients: false }));
    expect(tokens(root)).toHaveLength(0);
    expect(stateLines(root)).toHaveLength(0);
    expect(hosts(root)).toHaveLength(0);
  });

  it("[positive control] the SAME assertions find apparatus on a snapshot pack, so the selectors are not dead", async () => {
    // Without this, a typo in the attribute name would make every F-B row
    // green forever against any build whatsoever.
    const root = await mount(PrepPackPanel, maximalResearchPanelProps());
    expect(tokens(root).length).toBeGreaterThan(0);
    expect(stateLines(root)).toHaveLength(1);
  });

  it("keeps N43's stage-name citation marker on a snapshot-less pack", async () => {
    // The other half of the ruling: the marker relocation of plan.r4.md
    // section 5.3 applies to snapshot stages ONLY. A build that relocates
    // unconditionally passes F-B (it renders no token) and breaks the owner's
    // pack, so absence of the new thing is not enough -- the old thing must
    // still be there.
    const root = await mount(PrepPackPanel, maximalPanelProps({ transients: false }));
    const headings = [...root.querySelectorAll("h4")];
    const stageHeadings = headings.filter((h) => norm(h.textContent) === "Recruiter screen");
    expect(stageHeadings).toHaveLength(1);
    const marker = stageHeadings[0].parentElement.querySelector("[data-citation-marker]");
    expect(marker).not.toBeNull();
    expect(marker.tagName.toLowerCase()).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// F-C -- THE CENSUS. Every item declares its confidence. No subset passes.
// ---------------------------------------------------------------------------

describe("F-C [RED ON HEAD: nothing renders a token] the label census over a snapshot pack", () => {
  // RED because `[data-n49-item]` does not exist, so `hosts(root)` is empty
  // and the first length assertion fails against an expected 21.
  //
  // This is the row that kills MZ-4 (a missing provenance yields an empty
  // label) and MZ-5 (tokens on stage names only). MZ-4 only bites because the
  // fixture's stage 3 carries NO provenance key at all -- plan.r4.md finding
  // 16 records that the FIRST version of that fixture did not, and the mutant
  // survived. Keeping that explicit here rather than buried in the fixture:
  // if anyone ever "tidies" stage 3 by giving it a provenance of zero
  // publishers, this census still passes and MZ-4 comes back to life.
  let root;
  let items;
  beforeEach(async () => {
    root = await mount(PrepPackPanel, maximalResearchPanelProps());
    items = researchItems();
  });

  it("[fixture canary] the fixture offers 21 items and covers all three label kinds", () => {
    // A canary on the test's own derivation, not on the build. If a fixture
    // edit silently drops the unsourced rows, every assertion below still
    // passes while measuring less -- this is what notices.
    expect(items).toHaveLength(21);
    const byKind = items.reduce((acc, item) => {
      const kind = expectedKind(item.provenance);
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {});
    expect(byKind).toEqual({ reported: 5, single: 7, unsourced: 9 });
    // At least one item must carry NO provenance key at all (MZ-4's bite).
    expect(items.some((item) => item.provenance === undefined)).toBe(true);
    // And the kinds must span all three item types, or "cover a subset" is
    // untestable: a stage-names-only build would satisfy a stage-only census.
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(["stage", "role", "question"]));
  });

  it("renders exactly one labelled host per item -- stage names, questions AND interviewer titles", () => {
    expect(hosts(root)).toHaveLength(items.length);
    const renderedKinds = hosts(root)
      .map((h) => h.getAttribute("data-n49-item"))
      .sort();
    const expectedKinds = items.map((i) => i.kind).sort();
    expect(renderedKinds).toEqual(expectedKinds);
  });

  it("labels the RIGHT items: every host's own text is one of the fixture's strings, and every string is hosted", () => {
    // The assertion that makes a subset impossible. Counting hosts alone is
    // satisfied by 21 hosts on the wrong 21 items; comparing the multisets of
    // (kind, text) is not.
    const rendered = hosts(root)
      .map((h) => `${h.getAttribute("data-n49-item")} ${hostItemText(h)}`)
      .sort();
    const expected = items.map((i) => `${i.kind} ${norm(i.text)}`).sort();
    expect(rendered).toEqual(expected);
  });

  it("puts exactly one token inside each host, and no token anywhere outside one", () => {
    for (const host of hosts(root)) {
      expect(host.querySelectorAll("[data-n49-token]")).toHaveLength(1);
    }
    expect(tokens(root)).toHaveLength(items.length);
    for (const token of tokens(root)) {
      expect(token.closest("[data-n49-item]")).not.toBeNull();
    }
  });

  it("gives each item the kind its OWN stored provenance implies, including the items with none", () => {
    const byText = new Map();
    for (const host of hosts(root)) {
      byText.set(`${host.getAttribute("data-n49-item")} ${hostItemText(host)}`, host);
    }
    const missed = [];
    for (const item of items) {
      const host = byText.get(`${item.kind} ${norm(item.text)}`);
      if (!host) {
        missed.push(`no host for ${item.kind} ${JSON.stringify(item.text)}`);
        continue;
      }
      const actual = host.querySelector("[data-n49-token]")?.getAttribute("data-n49-token");
      const want = expectedKind(item.provenance);
      if (actual !== want) missed.push(`${item.kind} ${JSON.stringify(item.text)}: want ${want}, got ${actual}`);
    }
    expect(missed).toEqual([]);
  });

  it("writes each kind's own sentence, with the publisher COUNT in the reported one", () => {
    // Dash-agnostic by design (see this file's header). What is pinned: the
    // words, and -- for the only kind that carries a number -- that the
    // number is the stored publisher count rather than the number of source
    // rows. One fixture question cites two sources on one publisher host, so
    // a build that prints `src.length` reads "2" where it must read "1".
    const shape = {
      reported: /^Reported by (\d+) sources$/,
      single: /^Possible\s*[-‐-―−:]?\s*1 source$/,
      unsourced: /^Possible\s*[-‐-―−:]?\s*not sourced$/,
    };
    const problems = [];
    let examined = 0;
    for (const item of items) {
      const host = hosts(root).find(
        (h) => h.getAttribute("data-n49-item") === item.kind && hostItemText(h) === norm(item.text),
      );
      if (!host) {
        problems.push(`no host for ${item.kind} ${JSON.stringify(item.text)}`);
        continue;
      }
      examined += 1;
      const token = host.querySelector("[data-n49-token]");
      const text = norm(visibleText(token));
      const kind = expectedKind(item.provenance);
      const match = shape[kind].exec(text);
      if (!match) {
        problems.push(`${kind} token reads ${JSON.stringify(text)}`);
        continue;
      }
      if (kind === "reported" && Number(match[1]) !== item.provenance.publishers) {
        problems.push(`${JSON.stringify(item.text)} says ${match[1]} sources, stored publishers is ${item.provenance.publishers}`);
      }
    }
    expect(problems).toEqual([]);
    // Without this, the loop above is vacuously green whenever no host
    // exists -- which is every build before N49 lands. A per-item forEach
    // over an empty match set is the most common shape of a test that
    // cannot fail.
    expect(examined).toBe(items.length);
  });

  it("[under-fire control] a missing provenance reads as POSSIBLE and never as verified or blank", async () => {
    // The failure that matters most is the silent one: an item the research
    // never matched rendering as though it had been. Stage 3 carries no
    // provenance key at all, so this is the real shape, not a synthetic one.
    const unsourced = items.filter((i) => i.provenance === undefined);
    expect(unsourced.length).toBeGreaterThan(0);
    for (const item of unsourced) {
      const host = hosts(root).find(
        (h) => h.getAttribute("data-n49-item") === item.kind && hostItemText(h) === norm(item.text),
      );
      const token = host.querySelector("[data-n49-token]");
      const text = norm(visibleText(token));
      expect(text).not.toBe("");
      expect(text).not.toMatch(OVERCLAIM);
      expect(token.getAttribute("data-n49-token")).toBe("unsourced");
    }
  });
});

// ---------------------------------------------------------------------------
// F-C2 -- the links behind a reported item.
// ---------------------------------------------------------------------------

describe("F-C2 [RED ON HEAD: no research anchors exist] one link per publisher, gated the way every other link here is", () => {
  let root;
  beforeEach(async () => {
    root = await mount(PrepPackPanel, maximalResearchPanelProps());
  });

  it("renders one anchor per publisher on a reported item, with the shipped href/target/rel discipline", async () => {
    const items = researchItems().filter((i) => expectedKind(i.provenance) === "reported");
    expect(items.length).toBeGreaterThan(0);
    const problems = [];
    for (const item of items) {
      const host = hosts(root).find(
        (h) => h.getAttribute("data-n49-item") === item.kind && hostItemText(h) === norm(item.text),
      );
      if (!host) {
        problems.push(`no host for ${JSON.stringify(item.text)}`);
        continue;
      }
      const anchors = [...host.querySelectorAll("a[data-n49-source]")];
      if (anchors.length !== item.provenance.publishers) {
        problems.push(`${JSON.stringify(item.text)}: ${anchors.length} anchors for ${item.provenance.publishers} publishers`);
        continue;
      }
      for (const anchor of anchors) {
        const href = anchor.getAttribute("href");
        if (safeExternalHref(href) !== href) problems.push(`href ${JSON.stringify(href)} is not one safeExternalHref returns unchanged`);
        if (anchor.getAttribute("target") !== "_blank") problems.push(`${href}: target ${anchor.getAttribute("target")}`);
        if (anchor.getAttribute("rel") !== "noopener noreferrer") problems.push(`${href}: rel ${anchor.getAttribute("rel")}`);
        const publisher = citationHost(href);
        if (norm(anchor.textContent) !== publisher) {
          problems.push(`${href}: text ${JSON.stringify(norm(anchor.textContent))} is not the host ${publisher}`);
        }
        const name = anchor.getAttribute("aria-label") || "";
        const wanted = /^Source (\d+): (.+)$/.exec(name);
        if (!wanted || wanted[2] !== publisher) problems.push(`${href}: accessible name ${JSON.stringify(name)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("numbers research sources consistently, one number per source, first appearances ascending", () => {
    // NOT "the numbers ascend in document order": two items may legitimately
    // cite the SAME publisher, and the second mention keeps the first's
    // number, so the raw sequence can dip. The fixture exercises that on
    // purpose (a stage name and a question both cite news.example.com). What
    // must hold is the pair of properties a reader actually relies on: one
    // number always means one source, and a number's FIRST appearance comes
    // after every smaller number's first appearance, so scanning upward for
    // "Source 7" never runs past "Source 9".
    const anchors = [...root.querySelectorAll("a[data-n49-source]")];
    expect(anchors.length).toBeGreaterThan(0);
    const byNumber = new Map();
    const firstAppearances = [];
    const problems = [];
    for (const anchor of anchors) {
      const n = Number(/^Source (\d+):/.exec(anchor.getAttribute("aria-label") || "")?.[1]);
      const href = anchor.getAttribute("href");
      if (!Number.isInteger(n)) {
        problems.push(`no number on ${href}`);
        continue;
      }
      if (byNumber.has(n)) {
        if (byNumber.get(n) !== href) problems.push(`Source ${n} is both ${byNumber.get(n)} and ${href}`);
      } else {
        byNumber.set(n, href);
        firstAppearances.push(n);
      }
    }
    expect(problems).toEqual([]);
    expect(firstAppearances).toEqual([...firstAppearances].sort((a, b) => a - b));
    expect(new Set(byNumber.values()).size).toBe(byNumber.size);
  });

  it("never builds an anchor from a URL the href gate refuses, even when the stored count claims a publisher", () => {
    // A stored provenance can be stale, hand-edited or forged. The fixture's
    // "the Platform team" role cites source 4, whose URL is javascript:, and
    // claims `publishers: 1`. The label may still say one source -- that is
    // what was stored -- but no anchor may exist and the raw URL must appear
    // nowhere in the document.
    const unsafe = researchSources()[4].url;
    expect(safeExternalHref(unsafe)).toBeNull();
    const host = hosts(root).find(
      (h) => h.getAttribute("data-n49-item") === "role" && hostItemText(h) === "the Platform team",
    );
    expect(host).toBeTruthy();
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(root.innerHTML).not.toContain("javascript:");
    // ... and the item is still not silent: an inert row, not a deleted one.
    expect(norm(visibleText(host))).toContain("the Platform team");
  });
});

// ---------------------------------------------------------------------------
// F-D / F-D2 -- the research-state line is reachable in every state.
// ---------------------------------------------------------------------------

describe("F-D / F-D2 [RED ON HEAD: no state line exists] the state line renders from the stages GROUP, not from inside StagesSection", () => {
  // The two packs below are exactly the ones a reader most needs the
  // disclosure for, and exactly the two the shipped panel skips
  // StagesSection for: `stageList(pack).length === 0` returns null before any
  // body renders, and a `completeSections` without "stages" renders
  // EmptySection instead. Mutant MZ-6 (put the line back inside
  // StagesSection) must fail BOTH.
  //
  // Reachability note: both cases mount the whole panel and let it choose its
  // own branch. A test that rendered StagesSection directly could not reach
  // the EmptySection branch at all, which is the entire finding.
  it("F-D: a snapshot pack whose stage list is empty still renders exactly one state line", async () => {
    const pack = maximalResearchPack();
    pack.sections.stages.stages = [];
    const root = await mount(PrepPackPanel, maximalResearchPanelProps({}, { pack }));
    expect(stateLines(root)).toHaveLength(1);
    expect(norm(visibleText(stateLines(root)[0]))).not.toBe("");
  });

  it("F-D2: a snapshot pack whose completeSections omits stages still renders exactly one state line", async () => {
    const root = await mount(
      PrepPackPanel,
      maximalResearchPanelProps({}, { completeSections: ["aboutYou", "whyRole", "askThem"], status: "partial" }),
    );
    // Precondition, asserted so this case can never pass vacuously against a
    // build that simply rendered StagesSection anyway.
    const emptyText = norm(root.textContent);
    expect(emptyText).toContain("No interview-stage breakdown here yet.");
    expect(stateLines(root)).toHaveLength(1);
  });

  it("[control] a snapshot-LESS pack in the same two states renders NO state line", async () => {
    // The over-fire control. Without it, a build that renders the line
    // unconditionally -- the withdrawn D-P5 -- passes both rows above.
    // VACUOUS until N49 lands (it counts elements of a kind that does not
    // exist yet); it becomes evidence the moment a build renders one, and
    // mutant `dp5` is what proves it does.
    const empty = maximalPanelProps({ transients: false });
    empty.pack = { ...empty.pack, sections: { ...empty.pack.sections, stages: { stages: [] } } };
    expect(stateLines(await mount(PrepPackPanel, empty))).toHaveLength(0);
    const partial = maximalPanelProps({ transients: false }, { completeSections: ["aboutYou"], status: "partial" });
    expect(stateLines(await mount(PrepPackPanel, partial))).toHaveLength(0);
  });

  it("the state line carries the research date's four-digit year and claims nothing about the world", async () => {
    const root = await mount(PrepPackPanel, maximalResearchPanelProps());
    const line = norm(visibleText(stateLines(root)[0]));
    expect(line).not.toBe("");
    expect(line).toContain(String(new Date(RESEARCHED_AT).getUTCFullYear()));
    expect(line).not.toMatch(OVERCLAIM);
    // A vocabulary ban, and weak as such -- it pins the SPELLING of two
    // sentences the design forbids, not their shape. Kept because these two
    // are the specific false claims a summary of a failed search reaches for.
    expect(line).not.toMatch(/there are no reports|does not publish|no such interviews/i);
  });
});

// ---------------------------------------------------------------------------
// F-E -- nothing is deleted.
// ---------------------------------------------------------------------------

describe("F-E [RED ON HEAD: the claim's text is an anchor's label today] a relocated marker never deletes the claim's text", () => {
  // On a snapshot stage the name line's one apparatus slot belongs to the
  // N49 token, so N43's marker moves: to the suggested answer when there is
  // one, and nowhere when there is not. "Nowhere" is the dangerous branch --
  // PrepPackPanel.js's SourceList is the ONLY place `claim.text` renders
  // anywhere on this panel, so dropping the entry would delete a whole
  // sentence from the page with nothing erroring.
  //
  // The fixture's stage 2 has a resolved support and an EMPTY
  // recommendedAnswer, which is that branch. Its claim is c2, cited by
  // nothing else in this pack, so the assertions below are unambiguous.
  const c2 = maximalClaims().find((c) => c.id === "c2").text;
  const c1 = maximalClaims().find((c) => c.id === "c1").text;

  it("keeps the claim's sentence on screen as PLAIN TEXT, not as any link's label", async () => {
    const root = await mount(PrepPackPanel, maximalResearchPanelProps());
    expect(norm(visibleText(root))).toContain(c2);
    const anchorTexts = [...root.querySelectorAll("a")].map((a) => norm(a.textContent));
    expect(anchorTexts).not.toContain(c2);
  });

  it("does not file that sentence under a heading that calls it a source", async () => {
    const root = await mount(PrepPackPanel, maximalResearchPanelProps());
    const sourceHeadings = [...root.querySelectorAll("h4")].filter((h) => norm(h.textContent).startsWith("Sources for"));
    for (const heading of sourceHeadings) {
      expect(norm(heading.parentElement.textContent)).not.toContain(c2);
    }
  });

  it("[positive control] a stage WITH a suggested answer keeps its marker and its numbered source entry", async () => {
    // The paired control. Without it, "delete every stage source entry"
    // passes both rows above: no claim text under a Sources heading, and no
    // anchor carrying it either.
    const root = await mount(PrepPackPanel, maximalResearchPanelProps());
    const sourceHeadings = [...root.querySelectorAll("h4")].filter((h) => norm(h.textContent).startsWith("Sources for"));
    const stagesList = sourceHeadings.find((h) => norm(h.textContent) === "Sources for Interview stages");
    expect(stagesList).toBeTruthy();
    expect(norm(stagesList.parentElement.textContent)).toContain(c1);
    const markers = [...root.querySelectorAll("[data-citation-marker]")];
    expect(markers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// F-F -- no token or state line may overclaim.
// ---------------------------------------------------------------------------

describe("F-F [RED ON HEAD: no token exists to read] no label overclaims", () => {
  it("no token and no state line uses a word that means the app checked the fact itself", async () => {
    const root = await mount(PrepPackPanel, maximalResearchPanelProps());
    const texts = [...tokens(root), ...stateLines(root)].map((node) => norm(visibleText(node)));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      // The under-fire control, inline: a build that renders an EMPTY token
      // trivially satisfies a vocabulary ban, so non-emptiness is asserted
      // for every element the ban is applied to.
      expect(text).not.toBe("");
      expect(text).not.toMatch(OVERCLAIM);
    }
  });

  it("[control] the ban's own regex fires on the words it exists to catch", () => {
    // A canary on the instrument. If OVERCLAIM were mistyped, the row above
    // would be green against any label whatsoever.
    for (const word of ["Verified", "verifies", "fact-check", "fact check", "Confirmed", "confirming", "proven"]) {
      expect(word).toMatch(OVERCLAIM);
    }
    for (const word of ["Reported by 2 sources", "Possible - 1 source", "Possible - not sourced"]) {
      expect(word).not.toMatch(OVERCLAIM);
    }
  });
});

// ---------------------------------------------------------------------------
// F-G -- a refused interviewer title is disclosed, never silent.
// ---------------------------------------------------------------------------

describe("F-G [RED ON HEAD: no roles, no counter, no disclosure] refused titles are visible", () => {
  // The measured cost of N51's allow-list is that it drops real job titles --
  // 27.3% of a held-out slice, 58.3% of the owner's own role family
  // (plan.r4.md section 6; the corpus is in interviewerRoles.test.js). That
  // loss is acceptable ONLY while it is disclosed: without this row, "no
  // titles were reported" and "titles were reported and this app refused
  // them" look identical on screen, and the second is the one that makes a
  // candidate walk in expecting the wrong panel.
  it("renders a disclosure on a stage whose rolesDroppedCount is above zero", async () => {
    const root = await mount(PrepPackPanel, maximalResearchPanelProps());
    const notices = [...root.querySelectorAll("[data-n49-roles-dropped]")];
    expect(notices).toHaveLength(1);
    const text = norm(visibleText(notices[0]));
    expect(text).not.toBe("");
    // The count is the content: a disclosure that does not say HOW MANY is a
    // sentence, not a measurement.
    expect(text).toMatch(/\b2\b/);
  });

  it("[control] a stage that reported no titles at all renders NO such disclosure", async () => {
    // The over-fire control. A build that shows the notice on every stage
    // passes the row above and tells the candidate their titles were refused
    // when nothing was ever reported.
    const pack = maximalResearchPack();
    for (const stage of pack.sections.stages.stages) stage.rolesDroppedCount = 0;
    const root = await mount(PrepPackPanel, maximalResearchPanelProps({}, { pack }));
    expect(root.querySelectorAll("[data-n49-roles-dropped]")).toHaveLength(0);
    // ... and the pack still renders, so this is not an empty-render pass.
    expect(tokens(root).length).toBeGreaterThan(0);
  });

  it("[control] a snapshot-LESS pack never renders the disclosure, whatever it carries", async () => {
    // VACUOUS until N49 lands, like every absence row in this file. It earns
    // its place once the disclosure exists, because planting a
    // `rolesDroppedCount` on a legacy stage is exactly how the narrowing
    // leaks (risk R33).
    const pack = maximalPanelProps({ transients: false }).pack;
    for (const stage of pack.sections.stages.stages) stage.rolesDroppedCount = 3;
    const root = await mount(PrepPackPanel, maximalPanelProps({ transients: false }, { pack }));
    expect(root.querySelectorAll("[data-n49-roles-dropped]")).toHaveLength(0);
  });
});
