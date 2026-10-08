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

  it("KEEPS a sentence stitched across TWO lines of the same unit (N149: materials are context, not a cage)", () => {
    // Three tokens of one line plus three of another is a quote of neither, and
    // it used to be dropped for that reason alone. It carries no figure and no
    // capitalized entity the unit lacks, so it is now welcome: the cage that
    // demanded every term be quoted is gone, and the figure and entity scopes
    // below are what hold the line instead.
    expect(keep(["I reconciled every settlement and paged the on-call team twice."])).toEqual([
      "I reconciled every settlement and paged the on-call team twice.",
    ]);
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

// ---------------------------------------------------------------------------
// N149: composed prose is welcome; an invented figure or entity is not.
// ---------------------------------------------------------------------------
// The mechanical filter holds exactly three things for a sentence the model
// COMPOSED: every figure traces to the cited unit, every capitalized named
// entity traces to the cited unit, and the exfiltration / first-person /
// not-the-parent / not-motivation gates still apply. A fabricated generic
// accomplishment, credential, title, date or lowercase tool name is NOT decided
// here: the prompt refuses those, and no test below claims otherwise.
describe("expansionHonesty — N149: figures and capitalized entities, scoped to the unit", () => {
  // The three rungs of the seeded-fixture regression. (a) and (b) each carry
  // exactly ONE fault and nothing else a gate could drop it for, so neither can
  // be rescued by, or blamed on, the other; (c) is the no-op control.
  const INVENTED_ENTITY = "I rebuilt the scheduler in Rust.";
  const INVENTED_FIGURE = "I cut errors by 73 percent.";
  const CLEAN_COMPOSED = "I designed the reconciliation to replay idempotently so a retry could not double-post.";

  it("[seeded fixture] drops the invented entity and the invented figure, keeps the clean composed line", () => {
    expect(keep([INVENTED_ENTITY, INVENTED_FIGURE, CLEAN_COMPOSED])).toEqual([CLEAN_COMPOSED]);
  });

  it("[no-op control] clean composed prose passes, which proves the quote-everything cage is gone", () => {
    // It is not a quote of any line of UNIT, and it names terms (idempotently,
    // retry, double-post) that UNIT never mentions. A filter that still demanded
    // every term trace to the unit would drop it; this one has no reason to.
    expect(keep([CLEAN_COMPOSED])).toEqual([CLEAN_COMPOSED]);
  });

  it("each fault is dropped on its own, not only as a pair", () => {
    expect(keep([INVENTED_ENTITY])).toEqual([]);
    expect(keep([INVENTED_FIGURE])).toEqual([]);
  });

  it("keeps a capitalized entity the NAMED unit mentions, case-insensitively", () => {
    // The unit spells it lowercase; the candidate sentence capitalizes it.
    const unit = { ...UNIT, lines: ["I wrote the replay script in python and ran it against the ledger."] };
    expect(keep(["I chose Python because the retry logic had to be easy to test."], unit)).toHaveLength(1);
    expect(keep(["I chose Rust because the retry logic had to be fast."], unit)).toEqual([]);
  });

  it("sees a SENTENCE-INITIAL entity, which a scoring heuristic would skip", () => {
    expect(keep(["Rust is what I picked to model the retry state safely."])).toEqual([]);
  });

  it("sees internal-capital and all-caps entities, digits allowed", () => {
    for (const text of [
      "I moved the ledger onto PostgreSQL to get transactional replay.",
      "I archived the old settlements in S3 before the cutover.",
      "I ran the replay on AWS so it could scale out.",
    ]) {
      expect(keep([text]), text).toEqual([]);
    }
  });

  it("an entity in the unit does not license a figure, and a figure in the unit does not license an entity", () => {
    const unit = { ...UNIT, lines: ["I wrote the replay script in Python and cut the backlog by 43%."] };
    expect(keep(["I cut the backlog by 91% using Python."], unit)).toEqual([]);
    expect(keep(["I cut the backlog by 43% using Rust."], unit)).toEqual([]);
    expect(keep(["I cut the backlog by 43% using Python."], unit)).toHaveLength(1);
  });

  it("still drops a composed motivation line, now that isPastWorkLine no longer does", () => {
    expect(keep(["I would love to build this at a much larger scale someday."])).toEqual([]);
  });

  it("still drops a composed contact detail, on every path", () => {
    expect(keep(["I emailed the vendor at ops@example.com to confirm the replay."])).toEqual([]);
  });

  it("still drops a composed third-person sentence", () => {
    expect(keep(["The retry design made the replay safe to run twice."])).toEqual([]);
  });

  it("a quoted-whole line that names an entity is kept, because the unit names it", () => {
    const unit = { ...UNIT, lines: ["I wrote the replay script in Rust over a weekend."] };
    expect(keep(["I wrote the replay script in Rust over a weekend."], unit)).toHaveLength(1);
  });
});

describe("expansionHonesty — N149: an EMPTY unit (no page matched) degrades honestly", () => {
  const EMPTY = { kind: "page", pageId: null, pageTitle: null, lines: [] };
  const GENERIC = "I explained the trade-off between retrying and failing fast to the whole team.";

  it("admits generic first-person prose, with no page id attached", () => {
    const out = filterExpansionCandidates([{ text: GENERIC }], { parentPoint: PARENT, unit: EMPTY });
    expect(out.map((s) => s.text)).toEqual([GENERIC]);
    expect(out[0].pageId).toBeNull();
  });

  it("admits it for a missing unit as well as an empty one", () => {
    expect(filterExpansionCandidates([{ text: GENERIC }], { parentPoint: PARENT })).toHaveLength(1);
  });

  it("NEGATIVE: drops an invented figure when there is nothing to trace it to", () => {
    expect(
      filterExpansionCandidates([{ text: "I cut the replay backlog by 40% in the first sprint." }], {
        parentPoint: PARENT,
        unit: EMPTY,
      }),
    ).toEqual([]);
  });

  it("NEGATIVE: drops an invented capitalized entity when there is nothing to trace it to", () => {
    expect(
      filterExpansionCandidates([{ text: "I rewrote the replay worker in Kubernetes over a weekend." }], {
        parentPoint: PARENT,
        unit: EMPTY,
      }),
    ).toEqual([]);
  });

  it("NEGATIVE: still drops a contact detail", () => {
    expect(
      filterExpansionCandidates([{ text: "I posted the notes at www.example.com for the whole team." }], {
        parentPoint: PARENT,
        unit: EMPTY,
      }),
    ).toEqual([]);
  });
});

describe("expansionHonesty — what it must not re-declare", () => {
  it("uses the repo's own predicates rather than copies of them", () => {
    expect(SRC).toContain("literallyMentioned");
    expect(SRC).toContain("namedEntityTokens");
    expect(SRC).toContain("MOTIVATION_LINE_RE");
    expect(SRC).toContain("materialQuote");
  });

  it("has retired the quote-everything cage and its past-work predicate", () => {
    // isPastWorkLine was reached only through composedPasses. Putting it back
    // on the accept path would re-cage exactly the method prose this change
    // exists to allow. It stays exported and used inside answerLocal.js; this
    // is a retirement from THIS module, not a deletion.
    expect(SRC).not.toContain("isPastWorkLine");
    expect(SRC).not.toContain("composedPasses");
    expect(SRC).not.toContain("significantTerms");
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
