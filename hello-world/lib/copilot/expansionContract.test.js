// The frozen contract for expandable answer bullets. Everything both sides of
// the wire have to agree on lives in ONE module, so the client's cache key and
// the server's shape filter cannot drift apart.
//
// Type B red: the module does not exist yet, so this file fails at import.
// Every criterion below therefore carries a NAMED MUTATION PROOF, applied
// after the implementation lands — a test that has only ever been seen green
// is not evidence.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  EXPANSION_MIN,
  EXPANSION_MAX,
  MIN_SUB_BULLET_WORDS,
  EXPANSION_MIN_HEIGHT,
  MAX_PARENT_POINT_CHARS,
  expansionKey,
  profileHash,
  normalizeSubBullets,
  expansionCaption,
  emptyExpansion,
} from "./expansionContract.js";

const SRC = readFileSync(fileURLToPath(new URL("./expansionContract.js", import.meta.url)), "utf8");

const REQUEST = {
  profile: "twelve years of payments work",
  interviewType: "behavioral",
  applicationId: "app-1",
  codeLanguage: "auto",
  engine: "gemini",
};

describe("expansionContract — the constants", () => {
  it("floors at ONE sub-bullet, not two", () => {
    // One non-duplicate detail IS further detail. Routing it to the empty
    // state is a false negative the candidate cannot tell from a true one.
    expect(EXPANSION_MIN).toBe(1);
    expect(EXPANSION_MAX).toBe(5);
  });

  it("sets the panel's minimum height to the smallest SUCCESSFUL outcome", () => {
    // EXPANSION_MIN x one body2 line box (~20.02px). A floor of 40 would make
    // `loading -> 1 sub-bullet` shift the content below UPWARD, which is the
    // exact defect a min-height exists to prevent, because the reader's eye
    // has already moved. In MUI `sx`, `minHeight` is a SIZING key: a number
    // > 1 is px and <= 1 is a percentage, so 20 is 20px.
    expect(EXPANSION_MIN_HEIGHT).toBe(20);
  });

  it("bounds the parent point on the wire", () => {
    // Genuinely new. normalizeModelPoints bounds the point COUNT and never a
    // per-point LENGTH, so the parent point is unbounded on the wire today and
    // the prompt cost is unbounded with it.
    expect(Number.isInteger(MAX_PARENT_POINT_CHARS)).toBe(true);
    expect(MAX_PARENT_POINT_CHARS).toBeGreaterThan(0);
  });

  it("declares MIN_SUB_BULLET_WORDS as a literal, never aliased to the quote floor", () => {
    // GROUNDED_SPAN_MIN_WORDS is "the shortest verbatim run worth quoting from
    // material"; MIN_SUB_BULLET_WORDS is "the shortest speakable sub-bullet".
    // They are both 4 BY COINCIDENCE. Aliasing them makes a future change to
    // the quote floor silently move the sub-bullet floor. It would also be a
    // top-level read of a cycle-adjacent import.
    expect(MIN_SUB_BULLET_WORDS).toBe(4);
    expect(SRC).not.toMatch(/=\s*GROUNDED_SPAN_MIN_WORDS/);
  });

  it("[control] the alias sweep can actually fail", () => {
    expect("export const MIN_SUB_BULLET_WORDS = GROUNDED_SPAN_MIN_WORDS;").toMatch(
      /=\s*GROUNDED_SPAN_MIN_WORDS/,
    );
  });

  it("reads no cycle-internal binding at module-evaluation time", () => {
    // pointLength -> answerLocal -> materialQuote -> pointLength is a live ES
    // module cycle. A top-level read of any binding imported from inside it
    // throws a TDZ ReferenceError whenever the cycle is entered the other way.
    const topLevel = SRC.split("\n").filter((l) => /^(export )?const /.test(l));
    for (const line of topLevel) {
      expect(line).not.toMatch(/\w+\(/);
    }
  });

  it("is a lib module: no React, no app/ import", () => {
    expect(SRC).not.toMatch(/from "react"/);
    expect(SRC).not.toMatch(/from "@\/app\//);
  });
});

describe("expansionKey", () => {
  it("separates two engines", () => {
    const a = expansionKey({ question: "Tell me about a failure.", parentPoint: "I rebuilt the ledger.", request: REQUEST });
    const b = expansionKey({ question: "Tell me about a failure.", parentPoint: "I rebuilt the ledger.", request: { ...REQUEST, engine: "embedded" } });
    expect(a).not.toBe(b);
    // MUTATION PROOF: drop `engine` from the key; this goes red. It is why the
    // engine caption can never disagree with the text under it.
  });

  it("separates two parent points, and two questions", () => {
    const base = { question: "Q1", parentPoint: "I rebuilt the ledger.", request: REQUEST };
    expect(expansionKey(base)).not.toBe(expansionKey({ ...base, parentPoint: "I paged the on-call." }));
    expect(expansionKey(base)).not.toBe(expansionKey({ ...base, question: "Q2" }));
  });

  it("treats a point differing only in case or a trailing stop as the SAME point", () => {
    const a = expansionKey({ question: "Q", parentPoint: "I rebuilt the ledger.", request: REQUEST });
    const b = expansionKey({ question: "Q", parentPoint: "  i rebuilt the ledger  ", request: REQUEST });
    expect(a).toBe(b);
  });

  it("is unchanged by a different emphasis span on the same point", () => {
    // AC-8.2e. `emphasis` is a render concern — a redraft that changes only
    // WHICH run is bolded must not invalidate a paid expansion.
    // MUTATION PROOF: add `emphasis` to the key; this goes red.
    const line = { point: "I rebuilt the ledger.", emphasis: { start: 2, end: 9 } };
    const other = { point: "I rebuilt the ledger.", emphasis: null };
    expect(expansionKey({ question: "Q", parentPoint: line.point, request: REQUEST })).toBe(
      expansionKey({ question: "Q", parentPoint: other.point, request: REQUEST }),
    );
    expect(SRC).not.toMatch(/emphasis/);
  });

  it("carries the profile as a HASH, never the raw text", () => {
    const secret = `SECRET-${"x".repeat(9000)}-TAIL`;
    const key = expansionKey({ question: "Q", parentPoint: "P.", request: { ...REQUEST, profile: secret } });
    expect(key.length).toBeLessThan(1000);
    expect(key).not.toContain("x".repeat(200));
    // ...but it still discriminates.
    expect(key).not.toBe(expansionKey({ question: "Q", parentPoint: "P.", request: { ...REQUEST, profile: `${secret}!` } }));
  });

  it("profileHash never returns the input and never throws", () => {
    expect(profileHash(null)).toBe(profileHash(""));
    expect(profileHash("abc")).not.toBe("abc");
    expect(typeof profileHash(undefined)).toBe("string");
  });

  it("changes with interviewType, applicationId and codeLanguage", () => {
    const base = { question: "Q", parentPoint: "P.", request: REQUEST };
    for (const field of ["interviewType", "applicationId", "codeLanguage"]) {
      expect(expansionKey(base)).not.toBe(
        expansionKey({ ...base, request: { ...REQUEST, [field]: "different" } }),
      );
    }
  });
});

describe("normalizeSubBullets — SHAPE only", () => {
  const opts = { parentPoint: "I rebuilt the ledger." };
  const GOOD = "I reconciled every settlement by hand for a week.";
  const GOOD2 = "I wrote the replay script that closed the gap.";

  it("keeps complete speakable sentences", () => {
    expect(normalizeSubBullets([{ text: GOOD }, { text: GOOD2 }], opts).map((s) => s.text)).toEqual([GOOD, GOOD2]);
  });

  it("accepts bare strings as well as entries", () => {
    expect(normalizeSubBullets([GOOD], opts).map((s) => s.text)).toEqual([GOOD]);
  });

  it("drops blanks, whitespace-only entries and non-strings", () => {
    expect(normalizeSubBullets([GOOD, "", "   ", null, 7, { text: null }], opts).map((s) => s.text)).toEqual([GOOD]);
  });

  it("drops a fragment, a heading and an unterminated line", () => {
    expect(normalizeSubBullets([GOOD, "Ledger rebuild"], opts).map((s) => s.text)).toEqual([GOOD]);
    expect(normalizeSubBullets([GOOD, "I fixed it"], opts).map((s) => s.text)).toEqual([GOOD]);
  });

  it("drops a line under MIN_SUB_BULLET_WORDS", () => {
    expect(normalizeSubBullets([GOOD, "I did."], opts).map((s) => s.text)).toEqual([GOOD]);
  });

  it("drops a resume EMPLOYMENT HEADER that every other predicate accepts", () => {
    // A header is a job title, not something the candidate did. It is a very
    // likely miner output and reads as a sub-bullet if nothing rejects it.
    //
    // THE FIXTURE IS CHOSEN, NOT TYPED. Most headers ("Senior Engineer, Acme
    // Corp | Jan 2019 - Mar 2022") are already refused by standsAlone or by
    // the terminal-punctuation rule, so testing with one of those would pass
    // whether or not the header reject exists at all — measured: dropping the
    // predicate left that fixture green. This one is standsAlone-TRUE, 11
    // words, terminally punctuated, and isEmploymentHeaderLine-TRUE, so the
    // header reject is the only thing standing between it and the screen.
    // MUTATION PROOF: drop the isEmploymentHeaderLine reject; this goes red.
    const header = "Senior Engineering Manager, Acme Payments Corp, Jan 2019 - Mar 2022.";
    expect(normalizeSubBullets([GOOD, header], opts).map((s) => s.text)).toEqual([GOOD]);
  });

  it("drops a near-duplicate of its own parent point", () => {
    expect(normalizeSubBullets([GOOD, "  I REBUILT THE LEDGER  "], opts).map((s) => s.text)).toEqual([GOOD]);
  });

  it("drops a duplicate of an earlier survivor", () => {
    expect(normalizeSubBullets([GOOD, `${GOOD.toUpperCase()}`], opts).map((s) => s.text)).toEqual([GOOD]);
  });

  it("caps at EXPANSION_MAX", () => {
    const many = Array.from({ length: 9 }, (_, i) => `I closed the ${i} gap in the ledger run.`);
    expect(normalizeSubBullets(many, opts)).toHaveLength(EXPANSION_MAX);
  });

  it("returns [] when fewer than EXPANSION_MIN survive", () => {
    expect(normalizeSubBullets(["nope", ""], opts)).toEqual([]);
    expect(normalizeSubBullets(null, opts)).toEqual([]);
  });

  it("resolves a pageSource through the shared whitelist, never a second one", () => {
    const includedPages = [{ id: "p1", title: "Payments migration" }];
    const out = normalizeSubBullets(
      [{ text: GOOD, pageId: "p1" }, { text: GOOD2, pageId: "invented" }],
      { ...opts, includedPages },
    );
    expect(out[0].pageSource).toEqual({ id: "p1", title: "Payments migration" });
    expect(out[1].pageSource).toBeNull();
    expect(SRC).toContain("resolvePageSources");
  });

  it("carries the source reference through untouched (AC-R4)", () => {
    const out = normalizeSubBullets([{ text: GOOD, source: { kind: "page", pageId: "p1", bulletIndex: 3 } }], opts);
    expect(out[0].source).toEqual({ kind: "page", pageId: "p1", bulletIndex: 3 });
  });
});

describe("expansionCaption", () => {
  it("names the engine, and changes with it", () => {
    const sources = [{ kind: "page", pageTitle: "Payments migration" }];
    const embedded = expansionCaption({ isEmbedded: true, sources });
    const gemini = expansionCaption({ isEmbedded: false, sources });
    expect(embedded).toContain("no AI provider");
    expect(gemini).toContain("Gemini");
    expect(embedded).not.toBe(gemini);
  });

  it("names the page it actually mined", () => {
    expect(expansionCaption({ isEmbedded: true, sources: [{ kind: "page", pageTitle: "Payments migration" }] }))
      .toContain("Payments migration");
  });

  it("cannot claim a source that was not in the request", () => {
    const caption = expansionCaption({ isEmbedded: true, sources: [{ kind: "resume" }] });
    expect(caption).toContain("resume");
    expect(caption).not.toContain("project page");
  });

  it("is empty when there is nothing to describe", () => {
    expect(expansionCaption({ isEmbedded: true, sources: [] })).toBe("");
  });

  it("contains no em dash and no ellipsis", () => {
    // An em dash and a horizontal ellipsis are silent at default screen-reader
    // punctuation settings, so a sentence whose meaning turns on one is not
    // read out. (app/copilot/CodeLanguagePicker.test.js states the rule.)
    for (const sources of [[{ kind: "page", pageTitle: "P" }], [{ kind: "resume" }], [{ kind: "page", pageTitle: "P" }, { kind: "resume" }]]) {
      for (const isEmbedded of [true, false]) {
        const caption = expansionCaption({ isEmbedded, sources });
        expect(caption).not.toContain("—");
        expect(caption).not.toContain("…");
      }
    }
  });
});

describe("emptyExpansion", () => {
  it("is the one frozen 'nothing known' record", () => {
    const a = emptyExpansion();
    expect(a).toEqual({ subBullets: [], caption: "", empty: true });
    // A fresh object each call: the store holds it per key and must not alias.
    expect(emptyExpansion()).not.toBe(a);
  });
});
