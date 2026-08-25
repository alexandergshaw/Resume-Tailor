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
  ELISION_MARKER,
  MAX_LISTED_ATTACHMENTS,
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
