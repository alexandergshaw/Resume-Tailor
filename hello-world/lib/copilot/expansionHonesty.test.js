// THE SERVER-SIDE PROVENANCE FILTERS for expansion sub-bullets.
//
// Shape is expansionContract.js's ("is this a speakable sentence?"). This
// module answers the other half: "may this sentence be spoken as the
// CANDIDATE'S OWN EXPERIENCE, and is every specific in it actually theirs?"
// It is server-only because it needs the source material the client is
// deliberately never given.
//
// Applied on BOTH engines. The deterministic drafter quotes whole lines and
// passes trivially; the point of running it there too is that the guarantee is
// a property of the response, not of which branch produced it.
//
// Type B red: the module does not exist yet.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { filterExpansionCandidates } from "./expansionHonesty.js";

const SRC = readFileSync(fileURLToPath(new URL("./expansionHonesty.js", import.meta.url)), "utf8");

// ONE named source unit: the page the parent bullet was cited from. Every
// containment question below is asked against THIS, never against a
// concatenation of everything the server holds.
const UNIT = {
  kind: "page",
  pageId: "p1",
  pageTitle: "Settlement ledger rebuild",
  lines: [
    "I reconciled every settlement by hand for a week.",
    "I cut the replay backlog by 43% in the first sprint.",
    "I paged the on-call team twice during the incident.",
  ],
};

const PARENT = "I rebuilt the ledger after the settlement outage.";

function keep(texts, unit = UNIT) {
  return filterExpansionCandidates(texts.map((text) => ({ text })), { parentPoint: PARENT, unit }).map((s) => s.text);
}

describe("expansionHonesty — AC-4.2/4.3: quoted from ONE named unit", () => {
  it("keeps a sentence quoted whole out of one line of the unit", () => {
    expect(keep(["I reconciled every settlement by hand for a week."])).toEqual([
      "I reconciled every settlement by hand for a week.",
    ]);
  });

  it("drops a sentence stitched across TWO lines of the same unit", () => {
    // Three tokens of one line plus three of another is a quote of neither.
    expect(keep(["I reconciled every settlement and paged the on-call team twice."])).toEqual([]);
  });

  it("drops a sentence that is not in the unit at all", () => {
    expect(keep(["I rewrote the settlement scheduler in Rust over a weekend."])).toEqual([]);
  });

  it("attaches the unit's page id to every survivor", () => {
    const out = filterExpansionCandidates(
      [{ text: "I paged the on-call team twice during the incident." }],
      { parentPoint: PARENT, unit: UNIT },
    );
    expect(out[0].pageId).toBe("p1");
    expect(out[0].source).toMatchObject({ kind: "page", pageId: "p1" });
  });
});

describe("expansionHonesty — AC-4.8: numerals are scoped to the NAMED unit", () => {
  it("keeps a figure that is in the named unit", () => {
    expect(keep(["I cut the replay backlog by 43% in the first sprint."])).toHaveLength(1);
  });

  it("drops a figure that is nowhere in the named unit", () => {
    expect(keep(["I cut the replay backlog by 91% in the first sprint."])).toEqual([]);
  });

  it("drops a figure that is in the CORPUS but not in the named unit", () => {
    // The case a whole-corpus containment check passes and this one does not.
    // "40%" is genuinely somewhere in the candidate's material; it is not on
    // the page this bullet was cited from, so quoting it here transplants a
    // number from one project onto another.
    const unit = { ...UNIT, lines: [...UNIT.lines] };
    expect(
      filterExpansionCandidates([{ text: "I cut the replay backlog by 40% in the first sprint." }], {
        parentPoint: PARENT,
        unit,
        corpusLines: ["Elsewhere on another page I improved throughput by 40% overall."],
      }),
    ).toEqual([]);
  });

  it("a longer number in the unit does not license a substring of it", () => {
    const unit = { ...UNIT, lines: ["I shipped the ledger rewrite in 2043 across every region."] };
    expect(keep(["I shipped the ledger rewrite in 43 across every region."], unit)).toEqual([]);
  });
});

describe("expansionHonesty — AC-4.11: the contact-shape reject list", () => {
  // THIS IS THE ONLY CONTROL THAT STOPS THE EXFILTRATION CASE, AND CONTAINMENT
  // CANNOT SUBSTITUTE FOR IT. A hostile job posting reaches the resume through
  // the tailor pipeline and then reaches this prompt as the candidate's own
  // material. If it asks for the candidate's address, the model's output is
  // every token present in the material -- so AC-4.2's containment check would
  // POSITIVELY CERTIFY it. Do not delete these cases as redundant with the
  // containment tests above; they are the opposite of redundant.
  const cases = [
    ["an email address", "I emailed alex.shaw@example.com about the ledger every week."],
    ["a URL", "I posted the write-up at https://example.com/ledger for the team."],
    ["a bare www host", "I posted the write-up at www.example.com for the whole team."],
    ["a phone-shaped run", "I called the vendor on +1 (555) 123-4567 during the incident."],
    ["a long digit run", "I quoted account 123456789012 to the payments desk that week."],
    ["a street address", "I worked from 221 Baker Street through the whole migration."],
  ];

  for (const [label, text] of cases) {
    it(`drops ${label} even when every token of it is in the material`, () => {
      // The unit CONTAINS the sentence verbatim, so containment says yes.
      const unit = { ...UNIT, lines: [text] };
      expect(keep([text], unit)).toEqual([]);
    });
  }
});

describe("expansionHonesty — AC-4.10/4.13: it is the candidate's own past work", () => {
  it("drops a third-person or imperative sentence", () => {
    const unit = { ...UNIT, lines: ["The team reconciled every settlement by hand for a week."] };
    expect(keep(["The team reconciled every settlement by hand for a week."], unit)).toEqual([]);
  });

  it("drops a motivation line rather than an experience line", () => {
    const line = "I want to work on settlement systems at a larger scale.";
    expect(keep([line], { ...UNIT, lines: [line] })).toEqual([]);
  });

  it("drops a sentence that merely restates its parent", () => {
    expect(keep([PARENT], { ...UNIT, lines: [PARENT] })).toEqual([]);
  });

  it("never throws, whatever it is handed", () => {
    expect(filterExpansionCandidates(null, {})).toEqual([]);
    expect(filterExpansionCandidates([null, 7, {}, { text: "" }], { parentPoint: PARENT, unit: UNIT })).toEqual([]);
    expect(filterExpansionCandidates([{ text: "x" }], { parentPoint: PARENT })).toEqual([]);
  });
});

describe("expansionHonesty — what it must not re-declare", () => {
  it("uses the repo's own predicates rather than copies of them", () => {
    expect(SRC).toContain("literallyMentioned");
    expect(SRC).toContain("isPastWorkLine");
    expect(SRC).toContain("MOTIVATION_LINE_RE");
    expect(SRC).toContain("materialQuote");
  });

  it("declares no word counter and no whole-corpus containment shortcut", () => {
    expect(SRC).not.toMatch(/split\(\/\\s\+\/\)/);
    // combineMaterial is a CONCATENATOR that performs no check at all, and it
    // omits page bullets entirely. Certifying a sub-bullet against the joined
    // corpus is exactly how a figure from one project gets transplanted onto
    // another, which is the defect AC-4.3 exists for.
    expect(SRC).not.toMatch(/import[^;]*combineMaterial/);
  });

  it("is server-only: no React, no app/ import, no browser storage", () => {
    expect(SRC).not.toMatch(/from "react"/);
    expect(SRC).not.toMatch(/from "@\/app\//);
    expect(SRC).not.toMatch(/localStorage|sessionStorage|document\./);
  });
});
