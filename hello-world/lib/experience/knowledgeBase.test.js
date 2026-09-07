// The contract for lib/experience/knowledgeBase.js — the knowledge base as
// ranked, budgeted context for a model that is about to answer an interview
// question. Written from the acceptance criteria BEFORE the module existed,
// so every case here describes behaviour the feature must have rather than
// behaviour the implementation happens to produce.
//
// The comments say WHY, because most of these rules are a bug someone
// already paid for once — either in this repo's own history or, for the
// ranking and honesty rules, in lib/meeting/meetingContext.js, which learned
// them first and whose reasoning is cited per case.
//
// A first draft of this file was put through a 70-mutant harness before any
// implementation existed, and 17 mutants survived it. The cases carrying a
// "SURVIVOR" note below are the ones added to kill them; each names the
// mutation it exists to catch, because a case whose reason is not written
// down is the first one a future reader deletes as noise.

import { describe, it, expect } from "vitest";
import {
  rankPagesByRelevance,
  splitBlocks,
  excerptForQuery,
  stripLinePrefixes,
  noAttachmentBytesNotice,
  buildKnowledgeBaseBlock,
  contributesMaterial,
  hasUsableId,
  ELISION_MARKER,
  MAX_LISTED_ATTACHMENTS,
  MIN_PAGE_CHARS,
  NOTICE_RESERVE_CHARS,
} from "./knowledgeBase.js";
import { significantTerms, isEligiblePage } from "@/lib/copilot/projectStories.js";

// The meeting copilot's wider rule, as a contrast to the copilot's real
// isEligiblePage (imported above, deliberately, rather than restated here —
// a private copy of the rule proves the parameter is wired but proves
// nothing about the rule the route actually passes).
const everythingEligible = () => true;

function page(id, title, body, extra = {}) {
  return { id, title, body, position: 0, archived_at: null, generated_kind: null, ...extra };
}

// A body long enough to force the excerpt path at a small test budget, whose
// relevant material sits at the END so a test cannot pass by taking a prefix.
function longBodyWithTailMatch() {
  return [
    "## Overview",
    "This page covers the general shape of the work and some background.",
    "",
    "## Groundwork",
    ...Array.from({ length: 40 }, (_, i) => `- Routine chore number ${i} about paperwork and scheduling`),
    "",
    "## Outcome",
    "- Cut the settlement latency from three days to four hours using Kafka",
  ].join("\n");
}

const QUERY = "kafka settlement latency ledger sharding";

describe("rankPagesByRelevance", () => {
  it("orders pages by how much they overlap the query, most first", () => {
    const pages = [
      page("a", "Onboarding checklist", "paperwork and badges"),
      page("b", "Payments migration", "kafka settlement latency ledger"),
      page("c", "Team offsite", "hiking and dinner"),
    ];
    const ranked = rankPagesByRelevance(pages, "how did you improve settlement latency with kafka");
    // The whole sequence, not just "b is first" — a ranker that returned
    // [b] alone, or that dropped the non-matching pages, would satisfy a
    // weaker assertion while losing material the budget could still hold.
    expect(ranked.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks a score tie on the page's own position, not on array order", () => {
    const pages = [
      page("late", "Kafka notes", "kafka", { position: 9 }),
      page("early", "Kafka notes", "kafka", { position: 2 }),
    ];
    expect(rankPagesByRelevance(pages, "kafka").map((p) => p.id)).toEqual(["early", "late"]);
  });

  it("leaves the input order untouched when there is nothing to rank against (AC-1.4)", () => {
    // The byte-identity guarantee every existing caller depends on: with no
    // query, this must behave exactly like the unranked packer it replaces.
    const pages = [page("a", "A", "alpha"), page("b", "B", "beta"), page("c", "C", "gamma")];
    expect(rankPagesByRelevance(pages, "").map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(rankPagesByRelevance(pages, undefined).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("never throws on junk", () => {
    expect(rankPagesByRelevance(null, "kafka")).toEqual([]);
    expect(rankPagesByRelevance(undefined, undefined)).toEqual([]);
    expect(rankPagesByRelevance([null, undefined, {}], "kafka")).toHaveLength(3);
  });
});

describe("splitBlocks", () => {
  it("returns each block's exact source text, never a re-rendering", () => {
    // THE RULE THIS FILE EXISTS FOR at the block level: the prompt must carry
    // the user's own words. A parser-based implementation (parseMarkdown)
    // would drop `**`, link hrefs and list markers, putting text in the
    // prompt that the user never wrote — in a feature whose entire premise
    // is that these are their own project pages.
    const body = "## Results\n\n- Cut p99 by **40%** on [the ledger](https://x.test)\n";
    const blocks = splitBlocks(body);
    expect(blocks.map((b) => b.text)).toEqual([
      "## Results",
      "- Cut p99 by **40%** on [the ledger](https://x.test)",
    ]);
    // Positive control on the property itself: every block is a real
    // substring of the source. An implementation that reconstructed the text
    // could still match the array above by luck on a simple fixture.
    for (const block of blocks) expect(body).toContain(block.text);
  });

  it("keeps a list item and its indented continuation lines together", () => {
    const body = "- Led the rewrite\n  and shipped it in Q3\n- Mentored two engineers";
    expect(splitBlocks(body).map((b) => b.text)).toEqual([
      "- Led the rewrite\n  and shipped it in Q3",
      "- Mentored two engineers",
    ]);
  });

  it("treats a fenced code block as atomic, blank lines and all", () => {
    // A fence split on its blank line yields two blocks, either of which can
    // be selected alone — putting an unterminated fence in the prompt.
    const body = "```js\nconst a = 1;\n\nconst b = 2;\n```";
    const blocks = splitBlocks(body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("code");
    expect(blocks[0].text).toBe(body);
  });

  it("points every non-heading block at the heading it sits under", () => {
    // A heading's OWN headingIndex is -1: it does not sit under itself, and
    // it does not sit under the heading before it either — otherwise
    // restoring context for a selected block would drag in every earlier
    // heading in the page.
    const body = "## Alpha\n\n- one\n\n## Beta\n\n- two";
    const blocks = splitBlocks(body);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "listItem", "heading", "listItem"]);
    expect(blocks.map((b) => b.headingIndex)).toEqual([-1, 0, -1, 2]);
  });

  it("never throws on junk", () => {
    expect(splitBlocks(null)).toEqual([]);
    expect(splitBlocks("")).toEqual([]);
    expect(splitBlocks("```\nunterminated fence")).toHaveLength(1);
  });
});

describe("excerptForQuery", () => {
  it("returns the whole body, byte-identical, when it fits", () => {
    const body = "## Results\n\n- Cut p99 by 40%";
    const out = excerptForQuery(body, { queryTerms: significantTerms("results"), budget: 1000 });
    expect(out).toEqual({ text: body, excerpted: false });
  });

  it("reaches material at the END of a long page rather than taking a prefix (AC-2.5)", () => {
    // The defect this is named for: a 30000-char page relevant to the
    // question must yield the matching section, not the first N characters.
    const body = longBodyWithTailMatch();
    const out = excerptForQuery(body, {
      queryTerms: significantTerms("how did you cut settlement latency with kafka"),
      budget: 400,
    });
    expect(out.excerpted).toBe(true);
    expect(out.text).toContain("Cut the settlement latency from three days to four hours using Kafka");
    // Positive control against "it just took everything": the routine chores
    // must NOT all be there, or the budget was not applied at all.
    expect(out.text.length).toBeLessThanOrEqual(400);
    expect(out.text).not.toContain("Routine chore number 20");
  });

  it("carries the heading a selected block sits under, so the excerpt does not start nowhere", () => {
    const body = longBodyWithTailMatch();
    const out = excerptForQuery(body, {
      queryTerms: significantTerms("settlement latency kafka"),
      budget: 400,
    });
    expect(out.text).toContain("## Outcome");
  });

  it("marks the gap when the material it kept is not contiguous", () => {
    const body = longBodyWithTailMatch();
    const out = excerptForQuery(body, {
      queryTerms: significantTerms("overview background settlement latency kafka"),
      budget: 500,
    });
    expect(out.text).toContain(ELISION_MARKER);
  });

  it("never cuts inside a line, and therefore never inside a sentence (AC-2.2)", () => {
    const body = longBodyWithTailMatch();
    const out = excerptForQuery(body, {
      queryTerms: significantTerms("settlement latency kafka paperwork"),
      budget: 350,
    });
    const sourceLines = new Set(body.split("\n").map((l) => l.trimEnd()));
    for (const line of out.text.split("\n")) {
      if (!line.trim() || line === ELISION_MARKER) continue;
      expect(sourceLines.has(line.trimEnd())).toBe(true);
    }
  });

  it("reports NOT excerpted when every block survived, even on the excerpt path (AC-2.3)", () => {
    // SURVIVOR: `excerpted: true` hard-coded on the excerpt path. The early
    // return covers the fits-whole case, so without this a page that only
    // exceeded its budget because of blank-line padding gets labelled an
    // excerpt and carries EXCERPT_HEADING_SUFFIX — telling the model the page
    // continues when it does not.
    const body = "- alpha one\n\n\n\n\n\n\n\n\n\n- beta two\n\n\n\n\n\n\n\n\n\n- gamma three";
    expect(body.trim().length).toBeGreaterThan(45);
    const out = excerptForQuery(body, { queryTerms: significantTerms("alpha beta gamma"), budget: 45 });
    expect(out.excerpted).toBe(false);
    expect(out.text).toContain("- alpha one");
    expect(out.text).toContain("- gamma three");
    expect(out.text).not.toContain(ELISION_MARKER);
  });

  it("falls back to a whole-block prefix when nothing overlaps, preserving document order", () => {
    // The degenerate case is today's behaviour: no query, or no overlap, must
    // not scramble the page into relevance order it cannot justify.
    const body = "- alpha one two three\n- beta one two three\n- gamma one two three";
    const out = excerptForQuery(body, { queryTerms: significantTerms("zzzz"), budget: 45 });
    expect(out.excerpted).toBe(true);
    expect(out.text.startsWith("- alpha")).toBe(true);
  });

  it("never exceeds its budget and never throws", () => {
    const out = excerptForQuery(longBodyWithTailMatch(), {
      queryTerms: significantTerms("settlement kafka paperwork"),
      budget: 120,
    });
    expect(out.text.length).toBeLessThanOrEqual(120);
    // Positive control: 120 chars is enough for at least one whole block, so
    // an implementation that gave up and returned "" would be wrong.
    expect(out.text.length).toBeGreaterThan(0);
    expect(() => excerptForQuery(null, { queryTerms: significantTerms("kafka"), budget: 10 })).not.toThrow();
    expect(excerptForQuery(null, { queryTerms: significantTerms("kafka"), budget: 10 }).text).toBe("");
  });
});

describe("stripLinePrefixes", () => {
  // THE BUG THIS PREVENTS (architecture §1.1): the live transcript arrives
  // labelled — "Them: ...", "You: ...", or a user-entered display name.
  // significantTerms tokenises /[a-z0-9]{4,}/, so "them" passes, appears once
  // per interviewer turn, becomes the most frequent token in the ranking
  // query, and scores every page containing the word "them" above zero.
  it("drops the speaker label from every line, keeping the spoken words", () => {
    const transcript = "Them: tell me about a hard migration\nYou: sure, the payments one\nSarah Chen: go on";
    expect(stripLinePrefixes(transcript)).toBe(
      "tell me about a hard migration\nsure, the payments one\ngo on",
    );
  });

  it("actually removes the label's terms from the ranking query", () => {
    // Asserting the STRING is not enough — the property that matters is that
    // the label can no longer score a page. This is the positive control.
    const stripped = stripLinePrefixes("Them: how did you scale it\nThem: and then\nThem: and then");
    expect(significantTerms(stripped).has("them")).toBe(false);
    expect(significantTerms(stripped).has("scale")).toBe(true);
  });

  it("leaves a real sentence that merely contains a colon alone", () => {
    // A prefix is short and name-shaped. "The result was clear: we shipped"
    // is content, and eating its first clause would silently delete material
    // from the ranking query.
    const line = "The thing that finally worked was this: we sharded by tenant";
    expect(stripLinePrefixes(line)).toBe(line);
  });

  it("leaves a clause alone when it runs past a sentence break (SURVIVOR)", () => {
    // SURVIVOR: dropping the "prefix contains no . ! ?" clause. Only the
    // five-word rule was covered, and "Yes. Well" is two words — so without
    // this the answer's own opening sentence vanishes from the ranking query.
    const line = "Yes. Well: we sharded by tenant";
    expect(stripLinePrefixes(line)).toBe(line);
  });

  it("leaves a long clause alone even when it is only a few words (SURVIVOR)", () => {
    // SURVIVOR: dropping the 40-character ceiling. Three words, 44 characters
    // — a clause, not a name.
    const line = "Extraordinarily complicated interdependencies: we shipped anyway";
    expect(stripLinePrefixes(line)).toBe(line);
  });

  it("requires the space after the colon that a real label has (SURVIVOR)", () => {
    // SURVIVOR: stripping on a bare ":". "ratio:14" and "Node:js" are content.
    expect(stripLinePrefixes("Them:tell me about it")).toBe("Them:tell me about it");
  });

  it("drops blank lines so they cannot pad the query (SURVIVOR)", () => {
    // SURVIVOR: keeping blank lines. Harmless to scoring, but the stripped
    // text is also what a caller may log or splice, and a run of empty lines
    // in the middle of it reads as missing transcript.
    expect(stripLinePrefixes("Them: one\n\n\nYou: two")).toBe("one\ntwo");
  });

  it("never throws on junk", () => {
    expect(stripLinePrefixes(null)).toBe("");
    expect(stripLinePrefixes(undefined)).toBe("");
  });
});

describe("noAttachmentBytesNotice", () => {
  it("reproduces the meeting copilot's sentence byte for byte for that surface", () => {
    // meetingContext.js:58-59's constant. Keeping these identical is what
    // lets the meeting copilot adopt this helper later with zero test churn.
    expect(noAttachmentBytesNotice("this meeting")).toBe(
      "No attachment file contents were read for this meeting — only the file names and any saved notes above were seen.",
    );
  });

  it("names whatever surface it was given", () => {
    expect(noAttachmentBytesNotice("this answer")).toContain("this answer");
  });
});

describe("buildKnowledgeBaseBlock", () => {
  const NOTICE = noAttachmentBytesNotice("this answer");
  const base = {
    isEligible: isEligiblePage,
    budget: 4000,
    budgetLabel: "interview copilot's context budget",
    attachmentNotice: NOTICE,
  };

  it("reaches a relevant page the old unranked packer could never have shown (AC-1.3)", () => {
    // THE DEFECT THIS WHOLE CHANGE EXISTS FOR. listPages orders by `position`,
    // and the packer it replaces took pages in that order until the budget ran
    // out. The one page about the question sits at position 11, behind more
    // than a budget's worth of irrelevant pages (11 fillers at 600 chars each,
    // against a 4000-char budget), so it was structurally unreachable no
    // matter what was asked.
    const filler = Array.from({ length: 11 }, (_, i) =>
      page(`filler-${i}`, `Filler ${i}`, "x".repeat(600), { position: i }),
    );
    const target = page("target", "Payments migration", "Cut settlement latency using kafka", { position: 11 });
    const out = buildKnowledgeBaseBlock({ ...base, pages: [...filler, target], query: "kafka settlement latency" });

    expect(out.includedPageIds).toContain("target");
    expect(out.includedPageIds[0]).toBe("target");
    expect(out.block).toContain("Cut settlement latency using kafka");
  });

  it("puts each page's id in its heading so a citation can be checked against it", () => {
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [page("p1", "Payments migration", "kafka")],
      query: "kafka",
    });
    expect(out.block).toContain("## Payments migration (page id: p1)");
    expect(out.includedPages).toEqual([{ id: "p1", title: "Payments migration", excerpted: false }]);
  });

  it("honours the REAL isEligiblePage, not a rule of its own (AC-7.3 / A4)", () => {
    // SURVIVOR: selectBestStory and this builder both dropping eligibility
    // entirely. The copilot's rule excludes a generated research report,
    // because a model's claims about an industry spoken aloud as the
    // candidate's own experience is a lie the user does not know they are
    // telling. That rule now has no other test in the repo — wave 2A deletes
    // the describe block that used to carry it.
    const pages = [
      page("real", "Payments migration", "kafka settlement"),
      page("generated", "Research: payments", "kafka settlement", { generated_kind: "research" }),
      page("archived", "Old payments notes", "kafka settlement", { archived_at: "2026-01-01T00:00:00Z" }),
    ];
    const copilot = buildKnowledgeBaseBlock({ ...base, pages, query: "kafka settlement" });
    expect(copilot.includedPageIds).toEqual(["real"]);

    // The same input under the meeting copilot's wider rule includes all
    // three — proving the parameter is actually consulted and not decoration.
    const meeting = buildKnowledgeBaseBlock({
      ...base,
      pages,
      query: "kafka settlement",
      isEligible: everythingEligible,
    });
    expect(meeting.includedPageIds).toEqual(["real", "generated", "archived"]);
  });

  it("returns an empty block, and NOTHING else, when no page is eligible (AC-3.4)", () => {
    // The byte-identity guarantee both prompt builders depend on: a caller
    // with no eligible pages must be able to splice this in and get a
    // prompt identical to one that never called it. A header with nothing
    // under it, or a lone notice, breaks that.
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [page("g", "Research", "anything", { generated_kind: "research" })],
      query: "anything",
    });
    expect(out.block).toBe("");
    expect(out.includedPages).toEqual([]);
    expect(out.includedPageIds).toEqual([]);
  });

  it("returns an empty block when pages ARE eligible but none can fit (SURVIVOR, AC-3.4)", () => {
    // SURVIVOR: emitting a bare header when the eligible set is non-empty but
    // nothing survives the budget. The ineligible branch was covered and this
    // one was not, so a prompt header with nothing under it shipped — breaking
    // the same pinned byte-identity assertions from the other direction.
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [page("p1", "Payments migration", "kafka ".repeat(120))],
      query: "kafka",
      budget: 40,
    });
    expect(out.block).toBe("");
    expect(out.includedPages).toEqual([]);
    expect(out.droppedPageCount).toBe(1);
  });

  it("STOPS at the first page it cannot fit rather than skipping to a smaller one (SURVIVOR)", () => {
    // SURVIVOR: `break` changed to `continue`. This list is RELEVANCE-RANKED,
    // so skip-and-continue silently promotes a shorter, less relevant page
    // over a longer, more relevant one, and neither the model nor the user can
    // tell it happened. Only BLOCK-level packing inside one page's excerpt
    // may skip-and-continue, because its gaps are already marked and the list
    // is not itself the ranking. (meetingContext.js's buildMeetingContext
    // stops for the identical reason.)
    const first = page("first", "Payments migration", "kafka settlement latency ledger sharding notes", {
      position: 0,
    });
    // One unbroken paragraph: no block of it can fit a per-page excerpt share,
    // so it yields nothing and the packing must stop there.
    const unsplittable = page("unsplittable", "Ledger sharding", `kafka settlement latency ledger ${"w".repeat(800)}`, {
      position: 1,
    });
    const tiny = page("tiny", "Kafka footnote", "kafka settlement", { position: 2 });

    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [first, unsplittable, tiny],
      query: QUERY,
      budget: 900,
    });
    expect(out.includedPageIds).toEqual(["first"]);
    expect(out.droppedPageCount).toBe(2);
  });

  it("labels a page it had to cut, and never labels one it did not (AC-2.3)", () => {
    const short = page("short", "Short", "kafka settlement latency");
    const long = page("long", "Long", longBodyWithTailMatch());
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [long, short],
      query: "kafka settlement latency",
      budget: 900,
    });
    const byId = Object.fromEntries(out.includedPages.map((p) => [p.id, p.excerpted]));
    expect(byId.long).toBe(true);
    expect(byId.short).toBe(false);
    expect(out.truncated).toBe(true);
  });

  it("lists attachments through formatAttachment and says plainly that no bytes were read (AC-4.2/4.3)", () => {
    const withFiles = page("p1", "Payments migration", "kafka", {
      attachments: [
        { name: "ledger-design.pdf", kind: "pdf", notes: "sharded by tenant", storage_path: "u/secret/path.pdf" },
        { name: "rollout.pptx", kind: "slides", notes: "" },
      ],
    });
    const out = buildKnowledgeBaseBlock({ ...base, pages: [withFiles], query: "kafka" });

    expect(out.block).toContain("ledger-design.pdf");
    expect(out.block).toContain("sharded by tenant");
    // formatAttachment's own rule for a deck, inherited rather than restated.
    expect(out.block).toContain("contents not read");
    expect(out.block).toContain(NOTICE);
    // The enforcement point: no storage path may ever reach a prompt.
    expect(out.block).not.toContain("u/secret/path.pdf");
  });

  it("says no bytes were read even when NOTHING on the page is a disclaimed kind (SURVIVOR, AC-4.3)", () => {
    // SURVIVOR: gating the blanket notice on the block already containing
    // "contents not read". The previous fixture held a .pptx, so a notice that
    // only ever fired for decks was indistinguishable from a correct one — and
    // an answer read out loud would claim the model had seen a PDF's contents.
    // formatAttachment deliberately says NOTHING for pdf/image/text, because
    // in the Ask AI flow those bytes really are sent. Here they never are.
    const withFiles = page("p1", "Payments migration", "kafka", {
      attachments: [
        { name: "ledger-design.pdf", kind: "pdf", notes: "sharded by tenant" },
        { name: "dashboard.png", kind: "image", notes: "p99 after the cutover" },
      ],
    });
    const out = buildKnowledgeBaseBlock({ ...base, pages: [withFiles], query: "kafka" });
    expect(out.block).not.toContain("contents not read");
    expect(out.block).toContain(NOTICE);
  });

  it("says nothing about attachments when there are none", () => {
    const out = buildKnowledgeBaseBlock({ ...base, pages: [page("p1", "T", "kafka")], query: "kafka" });
    expect(out.block).not.toContain(NOTICE);
    expect(out.block).not.toContain("Attachments:");
  });

  it("caps one page's attachment inventory and says how many it did not list (SURVIVOR)", () => {
    // SURVIVOR: MAX_LISTED_ATTACHMENTS and the per-page attachment character
    // cap never applied. formatAttachment clips each notes field at 600
    // characters, so one page with a large inventory can spend the entire
    // budget on a file list and starve every body — including its own.
    const many = page("p1", "Payments migration", "kafka settlement latency ledger", {
      attachments: Array.from({ length: MAX_LISTED_ATTACHMENTS + 12 }, (_, i) => ({
        name: `artefact-${i}.pdf`,
        kind: "pdf",
        notes: "n".repeat(400),
      })),
    });
    const out = buildKnowledgeBaseBlock({ ...base, pages: [many], query: QUERY });

    expect(out.block).toContain("artefact-0.pdf");
    expect(out.block).not.toContain(`artefact-${MAX_LISTED_ATTACHMENTS + 11}.pdf`);
    expect(out.block).toContain("not listed");
    // The page's own words must survive its file list.
    expect(out.block).toContain("kafka settlement latency ledger");
  });

  it("announces exactly how many pages it dropped", () => {
    // SURVIVOR: droppedPageCount hard-coded. The first draft compared the
    // block against the count the same call returned, which any constant
    // greater than zero satisfies. The number is asserted literally here.
    const pages = Array.from({ length: 6 }, (_, i) =>
      page(`p${i}`, `Page ${i}`, `kafka settlement ${"y".repeat(700)}`, { position: i }),
    );
    const out = buildKnowledgeBaseBlock({ ...base, pages, query: "kafka settlement", budget: 1600 });
    expect(out.droppedPageCount).toBe(6 - out.includedPages.length);
    expect(out.includedPages.length).toBeGreaterThan(0);
    expect(out.block).toContain(`${out.droppedPageCount} pages not included`);
    expect(out.block).toContain("interview copilot's context budget");
  });

  it("never exceeds its budget, and still says something when the budget is real", () => {
    // The bodies here are SPLITTABLE — prose plus bullets, which is what a
    // project page actually is. An earlier draft of this case used a single
    // unbroken 1200-character line, which no honest excerpt can fit into a
    // small budget; the positive control below then forced an implementation
    // to emit a page heading with nothing under it just to be non-empty. See
    // the case directly after this one for what that must do instead.
    const body = [
      "## Overview",
      "The payments settlement work, end to end.",
      ...Array.from({ length: 20 }, (_, i) => `- Kafka settlement latency note number ${i} about the ledger`),
    ].join("\n");
    const pages = Array.from({ length: 30 }, (_, i) => page(`p${i}`, `Page ${i}`, body, { position: i }));
    for (const budget of [2000, 6000, 12000]) {
      const out = buildKnowledgeBaseBlock({ ...base, pages, query: QUERY, budget });
      expect(out.block.length).toBeLessThanOrEqual(budget);
      // Positive control: at every one of these budgets several whole blocks
      // fit, so an empty block means the packer gave up, not that the budget
      // was respected.
      expect(out.block.length).toBeGreaterThan(0);
      expect(out.includedPageIds.length).toBeGreaterThan(0);
      expect(out.block).toContain("Kafka settlement latency note number");
    }
  });

  it("never emits a page heading with nothing under it", () => {
    // A page whose body is one unbroken run cannot be excerpted honestly —
    // every block of it is larger than the budget, and cutting inside a line
    // is forbidden. The only honest outcome is to say nothing about that page
    // at all.
    //
    // WHY THIS MATTERS MORE THAN IT LOOKS: the alternative — a heading alone —
    // hands the model a real page TITLE and a real, citable page ID, plus a
    // suffix saying the page continues, and no content whatsoever. That is an
    // invitation to invent a project and attribute the invention to a page the
    // candidate really has, which they then read aloud in an interview. The
    // same reasoning formatAttachment applies when it says, in words, that a
    // video was not watched rather than leaving a bare filename.
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [page("p0", "Payments migration", `kafka settlement latency ${"z".repeat(1200)}`)],
      query: QUERY,
      budget: 500,
    });
    expect(out.block).toBe("");
    expect(out.includedPages).toEqual([]);
    expect(out.droppedPageCount).toBe(1);
  });

  it("refuses a page that has nothing to contribute, however it got that way (SURVIVOR)", () => {
    // REGRESSION against a guard the port dropped. The block builder this
    // replaced filtered on `p.title || p.body`; nothing replaced it, so an
    // EMPTY page stub — which every real user has, because creating a page and
    // filling it in later is the normal way to use the tree — sailed through
    // eligibility, produced a heading with no body, and always fit.
    //
    // It is the same failure as "never emits a page heading with nothing under
    // it" arriving through a different door, and it is worse here: it also
    // makes `block` non-empty, which flips BOTH prompt builders into their
    // pages variant — reordered blocks, changed authority sentence, and a
    // demand that the model cite page ids — on behalf of pages that say
    // nothing. AC-3.4's byte identity is only tested for "no pages at all".
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [
        page("real", "Payments migration", "- Sharded the ledger by tenant"),
        page("blank-both", "", ""),
        page("titled-but-empty", "Draft page I never wrote", "   "),
      ],
      query: "ledger tenant",
    });
    expect(out.includedPageIds).toEqual(["real"]);
    expect(out.block).not.toContain("Draft page I never wrote");
  });

  it("stays byte-identically silent when every page is an empty stub (AC-3.4)", () => {
    // The consequence above, stated as the guarantee the prompt builders rely
    // on: a knowledge base of stubs must be indistinguishable from no
    // knowledge base at all.
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [page("s1", "Someday", ""), page("s2", "", ""), page("s3", "Notes", "\n\n  \n")],
      query: "anything",
    });
    expect(out.block).toBe("");
    expect(out.includedPageIds).toEqual([]);
  });

  it("never fills a page's excerpt with nothing but its own section headings (SURVIVOR)", () => {
    // Block-level packing is skip-and-continue, so when every CONTENT block on
    // a page is larger than that page's share, the only blocks that fit are the
    // page's own `##` headings — and a table of contents was accepted as an
    // excerpt. Reproduced at the real production budget: 186 characters of
    // headings and elision markers, a citable page id, and a suffix promising
    // the page continues.
    //
    // The existing "never emits a page heading with nothing under it" case
    // CANNOT reach this branch: its fixture has no headings at all, so
    // splitBlocks yields one oversized paragraph and the excerpt is empty.
    const section = (i) => ["## Section " + i, "Prose about the ledger and settlement work. ".repeat(120)].join("\n");
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [page("big", "Payments migration", [0, 1, 2, 3, 4].map(section).join("\n\n"))],
      query: "ledger settlement",
    });
    if (out.includedPageIds.length > 0) {
      // Whatever it shows, at least one line must be the user's own prose
      // rather than a heading or an elision marker.
      const lines = out.block
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("##") && l.trim() !== ELISION_MARKER);
      expect(lines.join(" ")).toContain("Prose about the ledger");
    } else {
      expect(out.block).toBe("");
    }
  });

  it("gives a lone relevant page most of the budget, not a third of it (SURVIVOR, AC-2.1)", () => {
    // EXCERPT_SHARE_DIVISOR exists so page one cannot starve pages two and
    // three. With no page two there is nothing to protect, and capping anyway
    // handed a single relevant page 3973 of 12000 characters — LESS than the
    // 6000-char cap this whole change exists to raise, in exactly the case the
    // feature is about.
    const body = [
      "## Overview",
      ...Array.from({ length: 400 }, (_, i) => `- Ledger sharding note ${i} about tenants and p99 latency`),
    ].join("\n");
    const out = buildKnowledgeBaseBlock({ ...base, pages: [page("solo", "Ledger sharding", body)], query: "ledger sharding tenants", budget: 12000 });
    expect(out.block.length).toBeGreaterThan(8000);
    expect(out.block.length).toBeLessThanOrEqual(12000);
  });

  it("refuses a page with no usable id, because the prompt asks the model to cite one", () => {
    const out = buildKnowledgeBaseBlock({
      ...base,
      pages: [{ title: "No id", body: "kafka", archived_at: null }, page("ok", "Has id", "kafka")],
      query: "kafka",
    });
    expect(out.includedPageIds).toEqual(["ok"]);
  });

  it("never throws, whatever it is handed", () => {
    expect(() => buildKnowledgeBaseBlock(null)).not.toThrow();
    expect(() => buildKnowledgeBaseBlock({})).not.toThrow();
    expect(() =>
      buildKnowledgeBaseBlock({ ...base, pages: [null, undefined, {}, { id: 5 }], query: null }),
    ).not.toThrow();
    expect(buildKnowledgeBaseBlock({ ...base, pages: null, query: null }).block).toBe("");
  });
});

// ---------------------------------------------------------------------------
// droppedPages — the identity this builder used to destroy
// ---------------------------------------------------------------------------
//
// THE OWNER'S OWN WORDS, on the count-only version of exactly this defect:
// "there is that note that Some of your project pages were too large to fit in
// the AI's context budget and were left out. i need to know exactly which ones
// were left out". lib/experience/tailorContext.js, pageContext.js and
// lib/meeting/meetingContext.js each answered that question for their own
// surface; this builder was the last one still returning an integer and
// throwing the identity away at a `break`, a `continue` and a `.slice()`.
//
// THREE FACTS, AND ONLY ONE OF THEM IS "DROPPED". A page here can be
//   included whole      — its text is in the block, byte for byte;
//   included EXCERPTED  — part of its body is in the block, its id is citable,
//                         and the heading says so in words. Already identified
//                         by `includedPages[].excerpted`; it is NOT dropped,
//                         and a return value that said so would tell a user
//                         their page was left out while the model was reading
//                         a third of it;
//   dropped             — nothing of it reached the block at all.
// `droppedPages` is that last bucket and exactly that bucket: one undivided
// list, because every member carries the same claim to the reader ("not
// included to fit the budget") and the same non-remedy. The mechanism that
// discarded it — the MIN_PAGE_CHARS floor on what is left, a body no honest
// excerpt could fit, or an attachment-only page skipped past — is internal,
// unstable across ranking changes, and changes nothing about what the user is
// owed. What is NOT in it, deliberately: a page that failed eligibility, had no
// usable id, or brought no material. The budget is not why those were left out,
// they were never counted into `droppedPageCount` either, and the whole point of
// naming a set is that the names and the count describe ONE set.
//
// AND THE NAMES DO NOT GO IN `block`, which is where this builder must diverge
// from its three siblings and the reason has nothing to do with the notice
// reserve. `block` is handed to lib/copilot/roleTermsFlag.js's
// geminiRoleTermsFlag as the material a drafted claim is judged against, so a
// dropped page's title inside the notice makes its terms count as BACKED by a
// page the model never saw — the honesty flag going quiet exactly when the
// budget has made it most necessary. See "keeps them OUT of the block" below;
// the first draft of this change did splice them in, and turned
// route.roleTermsUnbacked.test.js's own fixture self-check red.
describe("buildKnowledgeBaseBlock: naming what the budget left out", () => {
  const LABEL = "interview copilot's context budget";
  const nameBase = {
    isEligible: isEligiblePage,
    budget: 4000,
    budgetLabel: LABEL,
    attachmentNotice: noAttachmentBytesNotice("this answer"),
  };
  // An empty query scores every page 0, so BM25's stable sort leaves `position`
  // order untouched — which makes "ranked order" a fixture the arithmetic below
  // can be reasoned about, rather than a scoring result a future ranker change
  // could silently reorder underneath these cases.
  const inPositionOrder = { query: "" };
  const noticeOf = (block) => block.slice(block.lastIndexOf("[Note:"));

  // included: p1 whole. p2 is one unbroken 600-character run, so no block of it
  // can fit a per-page share and it yields nothing — packing stops there, and
  // p3 goes with it.
  const stoppedPacking = () =>
    buildKnowledgeBaseBlock({
      ...nameBase,
      ...inPositionOrder,
      budget: 1000,
      pages: [
        page("p1", "Payments migration", "a".repeat(300), { position: 0 }),
        page("p2", "Ledger sharding", "b".repeat(600), { position: 1 }),
        page("p3", "Ledger footnote", "kafka", { position: 2 }),
      ],
    });

  it("names the pages it left out, in ranked order, and never the ones it kept", () => {
    // The mutant this kills first: naming `included` instead of the remainder.
    // Same shape, same real titles, every "does it name anything" assertion
    // green, and the reader is told the exact opposite of the truth.
    const out = stoppedPacking();
    expect(out.includedPageIds).toEqual(["p1"]);
    expect(out.droppedPages).toEqual(["Ledger sharding", "Ledger footnote"]);
    expect(out.droppedPageCount).toBe(out.droppedPages.length);
    expect(out.droppedPages).not.toContain("Payments migration");
  });

  it("keeps them OUT of the block, whose notice stays the count it always was", () => {
    // THE ONE PLACE THIS BUILDER MUST DIVERGE FROM ITS THREE SIBLINGS.
    // pageContext.js and lib/meeting/meetingContext.js splice their names into
    // their own model-facing notice, rationed inside NOTICE_RESERVE_CHARS by
    // droppedNames.js. A first draft did the same here and was wrong, for a
    // reason that only exists on this surface: `block` is not only the prompt,
    // it is the EVIDENCE BASE. app/api/copilot/answer/route.js hands it to
    // lib/copilot/roleTermsFlag.js's geminiRoleTermsFlag as `pagesBlock`, and
    // that is the material `unsupportedRoleTerms` judges a drafted claim
    // against — so a dropped page's title in the notice makes its terms count
    // as BACKED, by a page the model was never shown. The honesty flag stops
    // firing exactly when the budget has made it most necessary.
    //
    // Measured, not argued: route.roleTermsUnbacked.test.js's own fixture
    // self-check asserts `kb.block` does not contain "Workday" for a page the
    // budget pushed out, and the named-notice draft turned it red. The names go
    // in the RETURN VALUE, which no honesty check reads — tailorContext.js's
    // split, reached here by a different road.
    const out = stoppedPacking();
    const notice = noticeOf(out.block);
    expect(notice).toBe(`[Note: 2 pages not included to fit the ${LABEL}.]`);
    expect(out.block).not.toContain("Ledger sharding");
    expect(out.block).not.toContain("Ledger footnote");
    // No quotation mark anywhere in the notice: not a name, and not half of one.
    expect(notice).not.toContain("“");
  });

  it("costs the user's own page budget nothing, because the notice never grew", () => {
    // The reserve is carved out of `budgetForPages` on EVERY call, including the
    // ones that drop nothing, so a notice that grew with the names would be paid
    // for in real knowledge base by everyone. Forty dropped pages with titles
    // longer than the whole reserve, and the notice is still one short sentence.
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      ...inPositionOrder,
      pages: [
        page("keep", "Keeper", "k".repeat(3400), { position: 0 }),
        ...Array.from({ length: 40 }, (_, i) =>
          page(`d-${i}`, `${"T".repeat(NOTICE_RESERVE_CHARS)}${i}`, "notes", { position: i + 1 }),
        ),
      ],
    });
    const notice = noticeOf(out.block);
    expect(out.droppedPageCount).toBe(40);
    expect(out.droppedPages).toHaveLength(40);
    expect(notice).toBe(`[Note: 40 pages not included to fit the ${LABEL}.]`);
    expect(notice.length).toBeLessThanOrEqual(NOTICE_RESERVE_CHARS);
    expect(out.block.length).toBeLessThanOrEqual(nameBase.budget);
    // The clamp never reached the notice: it still closes.
    expect(out.block.endsWith(".]")).toBe(true);
    // And the identity survives in full, un-rationed, where nothing reads it as
    // evidence — every one of the forty, at full length.
    expect(out.droppedPages[0].length).toBe(NOTICE_RESERVE_CHARS + 1);
  });

  it("calls an untitled dropped page what its own heading would have called it", () => {
    // One constant, so a caller rendering this list and a reader looking at a
    // page heading are never hunting for two different names for one page — and
    // never handed an empty string, which would say the page is called nothing
    // at all, or a raw uuid, which says nothing to a human.
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      ...inPositionOrder,
      budget: 1000,
      pages: [
        page("p1", "Payments migration", "a".repeat(300), { position: 0 }),
        page("p2", "   ", "b".repeat(600), { position: 1 }),
      ],
    });
    expect(out.droppedPages).toEqual(["Untitled project"]);
    expect(out.droppedPages[0]).not.toBe("");
    expect(out.droppedPages[0]).not.toContain("p2");
    // The same word the heading of an untitled page would have carried.
    expect(
      buildKnowledgeBaseBlock({ ...nameBase, ...inPositionOrder, pages: [page("p2", "   ", "kafka")] }).block,
    ).toContain("## Untitled project (page id: p2)");
  });

  it("reports an EXCERPTED page as included-but-cut, never as dropped", () => {
    // The conflation this exists to prevent: an excerpted page's material IS in
    // the prompt and its id IS citable, so calling it "not included to fit the
    // budget" is a false claim about what the model was shown — the one kind of
    // claim this module exists to keep honest. The identity of a cut page is
    // already available, and it is `includedPages[].excerpted`, not a second
    // list that could disagree with it.
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      pages: [page("long", "Long", longBodyWithTailMatch()), page("short", "Short", "kafka settlement latency")],
      query: "kafka settlement latency",
      budget: 900,
    });
    expect(out.includedPages).toContainEqual({ id: "long", title: "Long", excerpted: true });
    expect(out.truncated).toBe(true);
    expect(out.droppedPages).toEqual([]);
    expect(out.droppedPageCount).toBe(0);
    expect(out.block).not.toContain("not included to fit");
  });

  it("keeps an excerpted page out of the list even when a real drop happens too", () => {
    // The case above has nothing dropped at all, so an implementation that put
    // every excerpted page in the list would fail it — but so would one that
    // simply returned []. Here "cut" is excerpted and "gone" is genuinely
    // dropped, which separates the two.
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      ...inPositionOrder,
      budget: 1200,
      pages: [
        page("cut", "Long", longBodyWithTailMatch(), { position: 0 }),
        page("gone", "Ledger sharding", "w".repeat(900), { position: 1 }),
      ],
    });
    expect(out.includedPages).toContainEqual({ id: "cut", title: "Long", excerpted: true });
    expect(out.droppedPages).toEqual(["Ledger sharding"]);
    expect(out.droppedPageCount).toBe(1);
  });

  it("names a page the loop skipped PAST as well as the one it stopped on", () => {
    // The `!bodyFull` exception to the STOP rule: a page kept by
    // contributesMaterial for its attachment notes alone can never be rescued by
    // an excerpt, so the loop continues past it instead of sacrificing every
    // page behind it. A dropped-set inferred from a single stop index would
    // therefore name the wrong pages here — p3 is included and sits BEHIND the
    // page that was dropped.
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      ...inPositionOrder,
      budget: 1000,
      pages: [
        page("p1", "Alpha ledger", "a".repeat(200), { position: 0 }),
        page("p2", "Runbook", "", {
          position: 1,
          attachments: [{ name: "runbook.pdf", kind: "pdf", notes: "n".repeat(400) }],
        }),
        page("p3", "Ledger footnote", "c".repeat(100), { position: 2 }),
      ],
    });
    expect(out.includedPageIds).toEqual(["p1", "p3"]);
    expect(out.droppedPages).toEqual(["Runbook"]);
    expect(out.droppedPageCount).toBe(1);
    expect(noticeOf(out.block)).toBe(`[Note: 1 page not included to fit the ${LABEL}.]`);
  });

  it("attempts a page when exactly MIN_PAGE_CHARS of budget is left, and drops nothing", () => {
    // The floor is on what REMAINS, not on how big a page is, and it is
    // strictly-less-than. Written against the exported constants rather than
    // 400/200, so an off-by-one there cannot become an off-by-one here too:
    // after p1 the packer has exactly MIN_PAGE_CHARS left, p2 fits inside it,
    // and `remaining <= MIN_PAGE_CHARS` would drop a page that fits.
    const head = "## Alpha (page id: p1)";
    const body = "a".repeat(178);
    const budget = NOTICE_RESERVE_CHARS + head.length + "\n\n".length + body.length + MIN_PAGE_CHARS;
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      ...inPositionOrder,
      budget,
      pages: [
        page("p1", "Alpha", body, { position: 0 }),
        page("p2", "Beta", "b".repeat(100), { position: 1 }),
      ],
    });
    expect(out.block).toContain(head);
    expect(out.includedPageIds).toEqual(["p1", "p2"]);
    expect(out.droppedPages).toEqual([]);
    expect(out.droppedPageCount).toBe(0);
  });

  it("never names a page the BUDGET did not drop", () => {
    // An ineligible page, a page with no usable id and an empty stub are all
    // excluded before packing starts, are deliberately absent from
    // droppedPageCount ("the budget is not why it was left out"), and must be
    // absent from the names for the same reason — otherwise the sentence claims
    // a budget failure that never happened, and the count and the list stop
    // describing one set.
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      pages: [
        page("real", "Payments migration", "- Sharded the ledger by tenant"),
        page("generated", "Research: payments", "kafka ledger", { generated_kind: "research" }),
        page("stub", "Draft page I never wrote", "   "),
        { title: "No id at all", body: "kafka ledger tenant", archived_at: null, generated_kind: null },
      ],
      query: "ledger tenant",
    });
    expect(out.includedPageIds).toEqual(["real"]);
    expect(out.droppedPages).toEqual([]);
    expect(out.droppedPageCount).toBe(0);
    expect(out.block).not.toContain("not included to fit");
  });

  it("keeps the count and the names describing one identical set, at every budget", () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      page(`p${i}`, `Page ${i}`, `kafka settlement ${"y".repeat(300)}`, { position: i }),
    );
    for (const budget of [500, 800, 1200, 2000, 3000, 6000, 12000]) {
      const out = buildKnowledgeBaseBlock({ ...nameBase, pages, query: "kafka settlement", budget });
      expect(out.droppedPageCount).toBe(out.droppedPages.length);
      expect(out.droppedPages.length + out.includedPages.length).toBe(pages.length);
      const kept = out.includedPages.map((p) => p.title);
      for (const name of out.droppedPages) expect(kept).not.toContain(name);
    }
  });

  it("returns an empty name list, never undefined, whatever it is handed", () => {
    expect(buildKnowledgeBaseBlock(null).droppedPages).toEqual([]);
    expect(buildKnowledgeBaseBlock({}).droppedPages).toEqual([]);
    expect(
      buildKnowledgeBaseBlock({ ...nameBase, pages: [null, undefined, {}, { id: 5 }], query: null }).droppedPages,
    ).toEqual([]);
    expect(
      buildKnowledgeBaseBlock({ ...nameBase, pages: [page("p1", "T", "kafka")], query: "kafka" }).droppedPages,
    ).toEqual([]);
  });

  it("still names every page when NOTHING could be included at all", () => {
    // The early return had its own copy of the result object, so it is its own
    // case: a caller whose whole knowledge base was dropped needs the names
    // most, and gets an empty block with no notice in it to carry them.
    const out = buildKnowledgeBaseBlock({
      ...nameBase,
      ...inPositionOrder,
      budget: 500,
      pages: [
        page("p1", "Payments migration", `kafka ${"z".repeat(1200)}`, { position: 0 }),
        page("p2", "Ledger sharding", `kafka ${"z".repeat(1200)}`, { position: 1 }),
      ],
    });
    expect(out.block).toBe("");
    expect(out.includedPages).toEqual([]);
    expect(out.droppedPageCount).toBe(2);
    expect(out.droppedPages).toEqual(["Payments migration", "Ledger sharding"]);
  });
});

// ---------------------------------------------------------------------------
// The two admission predicates, as a PUBLIC seam
// ---------------------------------------------------------------------------
//
// WHY THESE ARE EXPORTED, AND WHY THE ALTERNATIVE IS A DEFECT.
// buildKnowledgeBaseBlock computes three exclusion reasons — failed
// eligibility, no usable id, no material — and returns none of them: a caller
// that wants to tell a user WHICH of their pages was left out, and why, has to
// classify the pages itself. It can either be handed the same function objects
// this module filters with, or write a second copy of the rules. A second copy
// drifts, silently, and the drift is invisible because both copies are green
// against their own tests.
//
// So the falsifier for the export is not "the function exists". It is that a
// caller composing the exported predicates reaches EXACTLY the admission
// verdict the builder reaches, page by page, over a fixture where the three
// reasons are all live at once.
//
// THE FIXTURE IS PRODUCTION-SHAPED AND GENUINELY NESTED, deliberately, and it
// is added BESIDE the flat `page()` helper above rather than replacing it. 29
// of 52 page fixtures in this repo omit `parent_id`, including every fixture in
// this file; lib/experience/tree.js coerces the missing key to null, so every
// page becomes a root and every subtree collapses to a single page. A consumer
// of these predicates that walks a subtree would pass a whole suite built on
// that shape while collecting nothing. The nesting is asserted, not assumed.

const KB_USER = "11111111-1111-4111-8111-111111111111";

// A page as `listPages` actually returns one: every column the tree and the
// staleness comparison read, none of them defaulted away.
function realPage(id, title, body, extra = {}) {
  return {
    id,
    user_id: KB_USER,
    parent_id: null,
    position: 0,
    title,
    body,
    archived_at: null,
    generated_kind: null,
    generated_at: null,
    attachments: [],
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-09-01T09:00:00.000Z",
    ...extra,
  };
}

// root
//  ├─ area-a ─┬─ leaf-headings   (body is nothing but a `##` heading)
//  │          ├─ leaf-filename   (one attachment, a bare file name)
//  │          └─ leaf-notes      (one attachment carrying saved notes)
//  ├─ area-b ─── leaf-archived   (archived_at set)
//  ├─ area-c                     (blank id)
//  └─ area-d                     (no id key at all)
// area-b is itself a generated research page.
function nestedKnowledgeBase() {
  return [
    realPage("root", "Payments platform", "Ledger sharding cut settlement latency using Kafka."),
    realPage("area-a", "Settlement", "Settlement runs on Kafka with a sharded ledger.", {
      parent_id: "root",
      position: 0,
    }),
    realPage("leaf-headings", "Overview only", "## Overview\n\n## Next", {
      parent_id: "area-a",
      position: 0,
    }),
    realPage("leaf-filename", "Diagrams", "", {
      parent_id: "area-a",
      position: 1,
      // The shape `withDerivedKind` produces: the stored row plus a derived
      // `kind`. A bare file name and nothing to read.
      attachments: [{ name: "architecture.pdf", kind: "pdf", notes: "", transcript: "" }],
    }),
    realPage("leaf-notes", "Runbook", "", {
      parent_id: "area-a",
      position: 2,
      attachments: [
        {
          name: "runbook.pdf",
          kind: "pdf",
          notes: "Kafka consumer lag alarms page the on-call engineer.",
        },
      ],
    }),
    realPage("area-b", "Acme — company research", "Acme runs a Kafka ledger.", {
      parent_id: "root",
      position: 1,
      generated_kind: "company_research",
      generated_at: "2026-08-20T09:00:00.000Z",
    }),
    realPage("leaf-archived", "Old settlement notes", "Kafka ledger sharding, superseded.", {
      parent_id: "area-b",
      position: 0,
      archived_at: "2026-08-25T09:00:00.000Z",
    }),
    realPage("   ", "Blank id", "Kafka ledger sharding notes.", { parent_id: "root", position: 2 }),
    { ...realPage("unused", "No id key", "Kafka ledger sharding notes.", { parent_id: "root", position: 3 }), id: undefined },
  ];
}

describe("hasUsableId / contributesMaterial as exported predicates", () => {
  const kbBase = {
    isEligible: isEligiblePage,
    budget: 12000,
    budgetLabel: "context budget",
    attachmentNotice: noAttachmentBytesNotice("this answer"),
    query: "kafka ledger settlement",
  };

  it("the fixture really is three levels deep, so a subtree walk over it cannot collapse", () => {
    // Guards the whole section. If this fixture were flat — the shape every
    // other fixture in this file has — every case below would still pass while
    // proving nothing about a page that is not a root.
    const pages = nestedKnowledgeBase();
    const byId = new Map(pages.map((p) => [p.id, p]));
    const depth = (p) => {
      let d = 0;
      let at = p;
      while (at && at.parent_id && byId.has(at.parent_id)) {
        at = byId.get(at.parent_id);
        d += 1;
      }
      return d;
    };
    expect(Math.max(...pages.map(depth))).toBe(2);
    expect(pages.filter((p) => depth(p) === 2).map((p) => p.id).sort()).toEqual([
      "leaf-archived",
      "leaf-filename",
      "leaf-headings",
      "leaf-notes",
    ]);
  });

  it("exports both predicates as functions", () => {
    expect(typeof hasUsableId).toBe("function");
    expect(typeof contributesMaterial).toBe("function");
  });

  it("composes into EXACTLY the builder's admission set, over a budget big enough for all of it", () => {
    // The binding that makes the export worth having. If either predicate were
    // re-implemented rather than exported, this is the assertion that catches
    // the first byte of drift.
    const pages = nestedKnowledgeBase();
    const admitted = pages
      .filter(isEligiblePage)
      .filter(hasUsableId)
      .filter(contributesMaterial)
      .map((p) => p.id);

    const out = buildKnowledgeBaseBlock({ ...kbBase, pages });
    expect(admitted.slice().sort()).toEqual(["area-a", "leaf-notes", "root"]);
    expect(out.includedPageIds.slice().sort()).toEqual(admitted.slice().sort());
    expect(out.droppedPageCount).toBe(0);
  });

  it("rejects, page by page, for the reason the builder rejects it for", () => {
    const pages = nestedKnowledgeBase();
    const by = (id) => pages.find((p) => (p.id ?? "unused") === id);

    expect(isEligiblePage(by("area-b"))).toBe(false); // generated
    expect(isEligiblePage(by("leaf-archived"))).toBe(false); // archived
    expect(hasUsableId(by("   "))).toBe(false); // blank id
    expect(hasUsableId(by("unused"))).toBe(false); // no id at all
    expect(contributesMaterial(by("leaf-headings"))).toBe(false); // headings only
    expect(contributesMaterial(by("leaf-filename"))).toBe(false); // a bare file name

    // And every one of them is absent from the block the builder produced.
    const out = buildKnowledgeBaseBlock({ ...kbBase, pages });
    for (const id of ["area-b", "leaf-archived", "leaf-headings", "leaf-filename"]) {
      expect(out.includedPageIds).not.toContain(id);
      expect(out.block).not.toContain(`page id: ${id}`);
    }
  });

  it("is the WHOLE material rule, not the body half of it", () => {
    // The re-implementation an implementer reaches for is `!!page.body.trim()`.
    // It admits a headings-only page and a bare-file-name page — both of which
    // ship a real title and a real CITABLE page id with nothing readable behind
    // them, into a prompt that demands page-id citations. These four cases are
    // what tell that copy apart from the rule the builder actually enforces.
    expect(contributesMaterial(realPage("h", "T", "## Overview"))).toBe(false);
    expect(contributesMaterial(realPage("e", "T", "   \n\n  "))).toBe(false);
    expect(
      contributesMaterial(realPage("f", "T", "", { attachments: [{ name: "a.pdf", kind: "pdf" }] })),
    ).toBe(false);
    expect(contributesMaterial(realPage("p", "T", "Real prose about the ledger."))).toBe(true);
  });

  it("counts an attachment only when it carries something to READ", () => {
    const withAttachment = (attachment) =>
      contributesMaterial(realPage("a", "T", "", { attachments: [attachment] }));
    expect(withAttachment({ name: "a.pdf", kind: "pdf", notes: "  " })).toBe(false);
    expect(withAttachment({ name: "a.pdf", kind: "pdf", notes: "Saved notes." })).toBe(true);
    expect(withAttachment({ name: "a.pdf", kind: "pdf", transcript: "Spoken words." })).toBe(true);
    // Notes with no attachment line to hang them on are still nothing.
    expect(withAttachment({ notes: "Saved notes." })).toBe(false);
  });

  it("refuses an id that is missing, blank, whitespace or not a string", () => {
    expect(hasUsableId(realPage("root", "T", "prose"))).toBe(true);
    expect(hasUsableId(realPage("", "T", "prose"))).toBe(false);
    expect(hasUsableId(realPage("   ", "T", "prose"))).toBe(false);
    expect(hasUsableId({ ...realPage("x", "T", "prose"), id: 5 })).toBe(false);
    expect(hasUsableId({ ...realPage("x", "T", "prose"), id: null })).toBe(false);
  });

  it("neither predicate throws on junk, because the builder's totality depends on it", () => {
    for (const junk of [null, undefined, 7, "x", [], {}]) {
      expect(() => hasUsableId(junk)).not.toThrow();
      expect(() => contributesMaterial(junk)).not.toThrow();
      expect(hasUsableId(junk)).toBe(false);
      expect(contributesMaterial(junk)).toBe(false);
    }
  });
});
