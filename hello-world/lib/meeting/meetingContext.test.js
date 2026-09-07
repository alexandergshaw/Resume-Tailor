// The knowledge base as context for a live meeting: which pages get picked,
// what fits, and — the part that matters most — what the model is allowed to
// believe it was given.
//
// THE BUG THIS FILE EXISTS TO PREVENT is subtle and is baked into the code
// this module reuses. lib/experience/pageContext.js disclaims "contents not
// read" for slides, spreadsheets and archives, and deliberately does NOT
// disclaim images, PDFs or text files — because in the Ask AI flow those
// three really are downloaded and attached to the same request. So inside
// that module, SILENCE ABOUT A PDF MEANS "the bytes were sent".
//
// A meeting read sends no bytes at all. Reusing formatAttachment (which is
// correct, and required — a second copy of those rules is how they drift)
// inherits that silence into a flow where it is false. Nothing throws and
// nothing looks wrong; the model is simply handed `- Q3 board deck.pdf (PDF)
// - notes: revenue slide` and will say, out loud, in a real meeting, "your
// board deck shows revenue up 12%."
//
// Hence the blanket notice, and hence the first test below.

import { describe, it, expect } from "vitest";
import {
  buildMeetingContext,
  MAX_LISTED_ATTACHMENTS,
  MAX_MEETING_CONTEXT_CHARS,
  NOTICE_RESERVE_CHARS,
  stripSpeakerLabels,
} from "./meetingContext.js";

const page = (over = {}) => ({
  id: "p-1",
  title: "Payments migration",
  body: "We moved billing off the legacy processor and cut reconciliation to under an hour.",
  parent_id: null,
  position: 0,
  archived_at: null,
  attachments: [],
  ...over,
});

const call = (over = {}) => ({
  pages: [page()],
  topic: "payments migration",
  transcript: "Are we still gated on the legacy processor?",
  pinnedPageId: null,
  ...over,
});

describe("the attachment honesty claim", () => {
  it("states that no attachment contents were read, even for a PDF", () => {
    // The exact failure described in this file's header. Asserted on the
    // SENTENCE, not on its position, so moving the notice does not break it.
    const { content } = buildMeetingContext(
      call({
        pages: [
          page({
            attachments: [{ name: "Q3 board deck.pdf", kind: "pdf", notes: "revenue slide" }],
          }),
        ],
      }),
    );

    // The inventory is present at all…
    expect(content).toContain("Q3 board deck.pdf");
    // …and the model is told plainly that nothing was read.
    expect(content.toLowerCase()).toContain("no attachment file contents were read");
  });

  it("says it even when every attachment is a kind pageContext would disclaim anyway", () => {
    // A notice that only appeared when an image/pdf/text was present would be
    // correct-by-accident and would vanish the moment the page held only
    // decks. The claim is about the whole call, not about one line.
    const { content } = buildMeetingContext(
      call({ pages: [page({ attachments: [{ name: "kickoff.pptx", kind: "slides" }] })] }),
    );
    expect(content.toLowerCase()).toContain("no attachment file contents were read");
  });

  it("caps how many attachments one page may list, and says how many it left out", () => {
    // Real rows now reach this module from the database, so an unbounded
    // inventory is a real input: one page with hundreds of files could spend
    // the whole 9000-char budget on file names and stop the packing loop at
    // page one. Mirrors pageContext.js's MAX_LISTED_ATTACHMENTS. Mutation
    // caught: dropping the slice, or slicing silently with no notice — a
    // model reading a partial file list and believing it complete is the
    // same class of lie this whole module exists to prevent.
    const many = Array.from({ length: MAX_LISTED_ATTACHMENTS + 5 }, (_, i) => ({
      name: `file-${i}.pdf`,
      kind: "pdf",
    }));
    const { content } = buildMeetingContext(call({ pages: [page({ attachments: many })] }));

    // Scoped to the INVENTORY (everything ahead of the notice) rather than to
    // the whole string, and narrowed deliberately rather than weakened. The
    // cap is a claim about the file LIST, and the 21st file name is now a
    // legitimate part of the notice below it — as the name of a file that was
    // NOT listed, which is the whole point of this pass. Asserted against the
    // whole string, this test would have made naming the dropped files
    // impossible while proving nothing extra: an implementation that dropped
    // the slice still fails, because the 21st line would then be in the
    // inventory.
    const inventory = content.slice(0, content.lastIndexOf("[Note:"));
    expect(inventory).toContain(`- file-${MAX_LISTED_ATTACHMENTS - 1}.pdf`);
    expect(inventory).not.toContain(`- file-${MAX_LISTED_ATTACHMENTS}.pdf`);
    expect(content).toContain("5 attachments not listed");
  });

  it("never leaks a storage path or a signed url", () => {
    const { content } = buildMeetingContext(
      call({
        pages: [
          page({
            attachments: [
              {
                name: "spec.pdf",
                kind: "pdf",
                notes: "the contract",
                storage_path: "u1/experience/p-1/a1-spec.pdf",
                url: "https://example.com/signed/abc",
              },
            ],
          }),
        ],
      }),
    );
    expect(content).not.toContain("u1/experience");
    expect(content).not.toContain("https://");
  });
});

describe("which pages are chosen", () => {
  it("always puts the page the meeting was started from first", () => {
    // The user chose it by having it open. A good default beats a picker, and
    // this is the one relevance signal that is not a guess.
    const result = buildMeetingContext(
      call({
        pages: [
          page({ id: "p-1", title: "Unrelated", body: "Nothing to do with this." }),
          page({ id: "p-2", title: "Payments migration", body: "legacy processor rollout" }),
        ],
        pinnedPageId: "p-1",
      }),
    );
    expect(result.includedPageIds[0]).toBe("p-1");
  });

  it("ranks the rest by overlap with the topic and what has just been said", () => {
    const result = buildMeetingContext(
      call({
        topic: "hiring",
        transcript: "How many engineers are we hiring this quarter?",
        pages: [
          page({ id: "p-1", title: "Payments migration", body: "legacy processor reconciliation" }),
          page({ id: "p-2", title: "Hiring plan", body: "engineers we are hiring this quarter" }),
        ],
      }),
    );
    expect(result.includedPageIds[0]).toBe("p-2");
  });

  it("does not rank a page up for matching a speaker label", () => {
    // The ranking query concatenates the transcript, and significantTerms
    // tokenises on /[a-z0-9]{4,}/ — which "others" clears. So a page whose
    // only overlap with the room is that one ordinary English word scored
    // as a match, on a token this app wrote onto the transcript itself.
    //
    // The fixture is tuned so the two pages are separated by exactly that
    // one token: "p-label" matches only on "others" (1 unstripped, 0
    // stripped) and "p-real" matches only on "shall" (1 either way), with
    // "p-label" at the earlier position so it wins a tie. Stripped, p-real
    // ranks first; unstripped, the tie hands it to p-label.
    // Mutation caught: dropping stripSpeakerLabels from queryText.
    const result = buildMeetingContext(
      call({
        topic: "",
        transcript: ["Others: Shall we begin, everyone?", "Others: Shall we?"].join("\n"),
        pages: [
          page({
            id: "p-label",
            position: 0,
            title: "Retrospective",
            body: "Some prefer pairing, others prefer solo.",
          }),
          page({
            id: "p-real",
            position: 1,
            title: "Kickoff agenda",
            body: "We shall proceed once introductions wrap.",
          }),
        ],
      }),
    );
    expect(result.includedPageIds).toEqual(["p-real", "p-label"]);
  });

  it("leaves out archived pages", () => {
    const result = buildMeetingContext(
      call({ pages: [page({ id: "p-1", archived_at: "2026-01-01T00:00:00.000Z" })] }),
    );
    expect(result.includedPageIds).toEqual([]);
  });

  it("INCLUDES a page that was generated by another feature", () => {
    // Deliberate, and a reversal of what the interview copilot does. The user
    // directed that a recorded page is their experience and must be used, so
    // eligibility here turns on archived-or-not and nothing else. A meeting
    // page saved by this very feature is an ordinary page, and so is anything
    // else in the tree.
    const result = buildMeetingContext(
      call({ pages: [page({ id: "p-1", generated_kind: "meeting" })] }),
    );
    expect(result.includedPageIds).toEqual(["p-1"]);
  });

  it("survives a page list that is missing, empty or full of junk", () => {
    // This runs every ~20 seconds during a live meeting; it may not throw.
    expect(buildMeetingContext(call({ pages: undefined })).includedPageIds).toEqual([]);
    expect(buildMeetingContext(call({ pages: [] })).includedPageIds).toEqual([]);
    expect(buildMeetingContext(call({ pages: [null, 42, {}] })).includedPageIds).toEqual([]);
  });
});

describe("stripSpeakerLabels", () => {
  // Shared with lib/meeting/insightsLocal.js — one copy, so the two
  // relevance heuristics can never disagree about what counts as content.
  it("removes the label and keeps the words", () => {
    expect(stripSpeakerLabels("Others: What is the timeline?")).toBe("What is the timeline?");
    expect(stripSpeakerLabels("You: Nearly done.")).toBe("Nearly done.");
    // Case- and spacing-tolerant, because the label is matched against
    // insightContract.js's MEETING_LABELS rather than assumed verbatim.
    expect(stripSpeakerLabels("others :  Right.")).toBe("Right.");
  });

  it("strips only a LEADING label, never the same word mid-sentence", () => {
    // Mutation caught: a global replace. "Others" inside a real utterance is
    // a word someone actually said and must survive.
    expect(stripSpeakerLabels("You: Some agreed, others did not.")).toBe("Some agreed, others did not.");
  });

  it("leaves an unlabelled room transcript alone, and drops blank lines", () => {
    expect(stripSpeakerLabels("Shall we begin?\n\nYes.")).toBe("Shall we begin?\nYes.");
    expect(stripSpeakerLabels(null)).toBe("");
    expect(stripSpeakerLabels(undefined)).toBe("");
  });
});

describe("the budget", () => {
  const big = (id, n) => page({ id, title: `Page ${id}`, body: "word ".repeat(n) });

  it("stops at the first page that does not fit, rather than skipping it", () => {
    // The same rule lib/experience/knowledgeBase.js's buildKnowledgeBaseBlock
    // follows for the interview copilot, for the same reason — the two agree.
    // The list here is relevance-ranked, so continuing past a page that did
    // not fit silently promotes a less relevant short page over a more
    // relevant long one — and the model has no way to know that happened.
    const result = buildMeetingContext(
      call({ pages: [big("p-1", 200), big("p-2", 4000), big("p-3", 10)] }),
    );
    expect(result.includedPageIds).toContain("p-1");
    expect(result.includedPageIds).not.toContain("p-3");
  });

  it("stays inside the budget", () => {
    const result = buildMeetingContext(
      call({ pages: [big("p-1", 4000), big("p-2", 4000), big("p-3", 4000)] }),
    );
    expect(result.content.length).toBeLessThanOrEqual(MAX_MEETING_CONTEXT_CHARS);
  });

  it("tells the model how many pages it did not get, in words", () => {
    // A bare slice is what pageContext.js exists to prevent: a model reading
    // half a knowledge base and nobody, including the model, knowing it.
    const result = buildMeetingContext(
      call({ pages: [big("p-1", 4000), big("p-2", 4000), big("p-3", 4000)] }),
    );
    expect(result.droppedPageCount).toBeGreaterThan(0);
    expect(result.content).toMatch(/not included|were not included/i);
  });

  it("reports nothing dropped when the whole knowledge base fits", () => {
    // Positive control: a notice hard-coded into every response would satisfy
    // the test above and lie whenever everything fit.
    const result = buildMeetingContext(call({ pages: [page({ id: "p-1" })] }));
    expect(result.droppedPageCount).toBe(0);
    expect(result.content).not.toMatch(/not included/i);
  });

  it("names the pages it did not get, not just how many", () => {
    // "2 pages not included" tells the user their live copilot is answering
    // from a knowledge base with a hole in it and gives them no way to learn
    // where. The identity is perfectly determined — this loop STOPS rather
    // than skips (see the test above and the loop's own comment), so the
    // dropped set is exactly the tail of the ranked order — it simply was not
    // returned.
    //
    // The mutant this kills first: naming `included` instead. Same shape, same
    // real titles, every "does it name anything" assertion green, and the
    // reader is told the opposite of the truth.
    const result = buildMeetingContext(
      call({ pages: [big("p-1", 200), big("p-2", 4000), big("p-3", 10)] }),
    );
    expect(result.droppedPages).toEqual(["Page p-2", "Page p-3"]);
    expect(result.droppedPageCount).toBe(result.droppedPages.length);
    expect(result.content).toContain(
      "2 pages not included to fit the meeting context budget: “Page p-2”, “Page p-3”.",
    );
    // p-1 was included; it must not also be listed as left out.
    expect(result.content.slice(result.content.lastIndexOf("[Note:"))).not.toContain("“Page p-1”");
  });

  it("calls an untitled dropped page what the page block above already calls it", () => {
    // formatPageBlock falls back to "Untitled page" for a heading; the notice
    // must use the same word rather than an empty pair of quotes or the raw
    // id, or the reader is hunting for two different things.
    const result = buildMeetingContext(
      call({
        topic: "",
        transcript: "",
        pages: [
          big("p-1", 1700),
          page({ id: "p-blank", title: "   ", body: "notes ".repeat(40), position: 1 }),
        ],
      }),
    );
    expect(result.droppedPages).toEqual(["Untitled page"]);
    expect(result.content).toContain(
      "1 page not included to fit the meeting context budget: “Untitled page”.",
    );
    expect(result.content).not.toContain("“”");
    expect(result.content).not.toContain("p-blank");
  });

  it("names the attachments it did not list", () => {
    const many = Array.from({ length: MAX_LISTED_ATTACHMENTS + 5 }, (_, i) => ({
      name: `file-${i}.pdf`,
      kind: "pdf",
    }));
    const { content } = buildMeetingContext(call({ pages: [page({ attachments: many })] }));

    const named = Array.from({ length: 5 }, (_, i) => `“file-${MAX_LISTED_ATTACHMENTS + i}.pdf”`).join(", ");
    expect(content).toContain(
      `5 attachments not listed to fit the meeting context budget: ${named}.`,
    );
    // Off-by-one at the cap, pinned: the last LISTED file is not in the
    // sentence, and the first unlisted one is.
    expect(content.slice(content.lastIndexOf("[Note:"))).not.toContain(
      `“file-${MAX_LISTED_ATTACHMENTS - 1}.pdf”`,
    );
  });

  it("shrinks the name list rather than blowing the notice reserve", () => {
    // The trap: the notice is itself text, and it competes for the reserve
    // carved out to hold it. NOTICE_RESERVE_CHARS is a fixed number sized for
    // count-only sentences; a name list is not fixed. And the defensive clamp
    // at the end of buildMeetingContext cuts from the TAIL, which is exactly
    // where the notice sits — so a long list would destroy the sentence
    // explaining the truncation, mid-name, mid-quote.
    //
    // The decision, pinned here: the reserve does not move (it was carved out
    // of the page budget, and growing it costs real knowledge base). The NAMES
    // are what shrink, back into the "and N more" tally.
    const wordy = Array.from({ length: 40 }, (_, i) =>
      page({
        id: `p-${i}`,
        position: i + 1,
        title: `Quarterly rollout notes for the payments platform, page ${i}`,
        body: "notes",
      }),
    );
    const result = buildMeetingContext(
      call({ topic: "", transcript: "", pages: [big("p-keep", 1700), ...wordy] }),
    );

    expect(result.droppedPageCount).toBe(40);
    const notice = result.content.slice(result.content.lastIndexOf("[Note:"));
    expect(result.content.length).toBeLessThanOrEqual(MAX_MEETING_CONTEXT_CHARS);
    expect(notice.length).toBeLessThanOrEqual(NOTICE_RESERVE_CHARS);
    expect(notice.endsWith("]")).toBe(true);
    // No name cut mid-quote, and the COUNT — the number the reader needs even
    // when the names could not all fit — is never what gets sacrificed.
    expect(notice).not.toMatch(/“[^”]*$/);
    expect(notice).toContain("40 pages not included to fit the meeting context budget:");
    expect(notice).toMatch(/and \d+ more/);
  });

  it("keeps the bare count when not one name can fit", () => {
    // The degenerate end of the same rule. One title longer than the whole
    // reserve leaves nothing sayable, so the notice falls back to exactly the
    // sentence it prints today rather than a fragment of a title.
    const result = buildMeetingContext(
      call({
        topic: "",
        transcript: "",
        pages: [
          big("p-keep", 1700),
          page({ id: "p-huge", position: 1, title: "T".repeat(NOTICE_RESERVE_CHARS * 2), body: "notes" }),
        ],
      }),
    );
    const notice = result.content.slice(result.content.lastIndexOf("[Note:"));
    expect(notice).toContain("1 page not included to fit the meeting context budget.");
    expect(notice).not.toContain("budget:");
    expect(notice.length).toBeLessThanOrEqual(NOTICE_RESERVE_CHARS);
    expect(notice.endsWith("]")).toBe(true);
  });

  it("returns an empty name list, never undefined, when the whole base fits", () => {
    expect(buildMeetingContext(call({ pages: [page({ id: "p-1" })] })).droppedPages).toEqual([]);
  });

  // THE BOUNDARY THIS SUITE COULD NOT REACH UNTIL NOW.
  //
  // Every case above uses `big(id, n)` bodies that land wherever they land, so
  // `used` is never anywhere near `budgetForPages` when the notice is
  // assembled, and the two-part sum below never gets tested at all. "Stays
  // inside the budget" was therefore green against a body of ~4000 characters
  // against a budget of 8600 — it proved that the clamp exists, not that the
  // budgeting under it is right, and the clamp cannot fail that assertion by
  // construction. The defect is invisible from the outside for exactly that
  // reason: `content.length <= MAX` is true in the broken case too, because the
  // clamp made it true by eating the notice.
  //
  // What overflows is the "\n\n" that JOINS the page block to the notice. It is
  // spent by the join at the end of buildMeetingContext and budgeted by nobody:
  // `budgetForPages` is MAX minus the reserve exactly, and the reserve is what
  // assembleNotice may spend on the notice ALONE. So a body that fills
  // budgetForPages plus a notice that fills the reserve plus the join between
  // them is MAX + 2 before the clamp, and the clamp cuts from the TAIL — where
  // the notice lives. The user is then shown a sentence saying material was
  // dropped, with its own closing eaten: "…“Rollout notes”." with no "]".
  //
  // lib/experience/knowledgeBase.js has the identical two-part shape and is
  // safe, but NOT by a remedy that transfers here: its notice is count-only by
  // deliberate design (names would pollute the roleTermsFlag evidence base), so
  // 400 chars of reserve hold a ~76-char notice and the slack absorbs the join.
  // This module's notice spends the reserve down to its last character on
  // purpose, so it needs the join charged to the reserve explicitly.
  describe("the join between the page block and the notice", () => {
    const KEEP_ID = "p-keep";
    const KEEP_TITLE = "Kept";
    // What formatPageBlock emits for a page with a body and no attachments.
    const keptHeading = `## ${KEEP_TITLE} (page id: ${KEEP_ID})`;
    const BUDGET_FOR_PAGES = MAX_MEETING_CONTEXT_CHARS - NOTICE_RESERVE_CHARS;
    const JOIN = "\n\n";

    // A page whose whole block is exactly `blockLength` characters.
    const keptBody = (blockLength) => "x".repeat(blockLength - keptHeading.length - JOIN.length);
    const keptBlockText = (blockLength) => `${keptHeading}${JOIN}${keptBody(blockLength)}`;
    const keptPage = (blockLength) =>
      page({ id: KEEP_ID, title: KEEP_TITLE, position: 0, body: keptBody(blockLength) });

    // A page that can never fit whatever budget is left, so it is always the
    // one the loop stops at — its TITLE is the variable under study.
    const dropPage = (title) =>
      page({ id: "p-drop", title, position: 1, body: "y".repeat(MAX_MEETING_CONTEXT_CHARS) });

    const build = (keptLength, title) =>
      buildMeetingContext(
        call({ topic: "", transcript: "", pages: [keptPage(keptLength), dropPage(title)] }),
      );

    const noticeOf = (content) => content.slice(content.lastIndexOf("[Note:"));

    // The longest notice this module will ever assemble, found by MEASURING it
    // against a body small enough that the clamp cannot fire, rather than by
    // copying assembleNotice's own arithmetic into the test. A private copy of
    // that sum is the classic way a boundary test keeps passing while silently
    // testing a different boundary — and it is assembleNotice's arithmetic that
    // is under suspicion here, so the test may not assume it.
    const worst = (() => {
      let best = { title: "", notice: "" };
      for (let length = 1; length <= NOTICE_RESERVE_CHARS; length += 1) {
        const title = "T".repeat(length);
        const notice = noticeOf(build(4000, title).content);
        if (notice.length > best.notice.length) best = { title, notice };
      }
      return best;
    })();

    it("cannot assemble a notice longer than the reserve set aside for it", () => {
      // Self-check on the fixture above: `worst` really is a fully-named
      // notice, not a bare count that happened to be the longest thing found.
      expect(worst.notice).toContain("1 page not included to fit the meeting context budget: “");
      expect(worst.notice.endsWith("”.]")).toBe(true);
      expect(worst.notice.length).toBeLessThanOrEqual(NOTICE_RESERVE_CHARS);
    });

    it("leaves room for itself, so a full body and a full notice still fit", () => {
      // THE ARITHMETIC, stated as the contract it should be. Three measured
      // quantities, no constant copied out of the source: the largest body the
      // packer will admit, the join the assembly spends, and the largest notice
      // assembleNotice will produce. Their sum is what `content` is before the
      // defensive clamp touches it, and it must not need the clamp at all.
      const body = keptBlockText(BUDGET_FOR_PAGES);
      expect(body.length).toBe(BUDGET_FOR_PAGES);
      expect(body.length + JOIN.length + worst.notice.length).toBeLessThanOrEqual(
        MAX_MEETING_CONTEXT_CHARS,
      );
    });

    it("does not eat the closing of the sentence reporting the truncation", () => {
      // The harm, not the count. A notice cut to `…“Rollout notes”.` with no
      // "]" reads as a rendering failure, and a longer name list would be cut
      // mid-name, mid-quote — the exact outcome assembleNotice's own comment
      // says the rationing exists to prevent.
      const { content } = build(BUDGET_FOR_PAGES, worst.title);
      expect(content.endsWith("]")).toBe(true);
      expect(content).not.toMatch(/“[^”]*$/);
    });

    it("delivers the whole notice it assembled, not a prefix of it", () => {
      const { content } = build(BUDGET_FOR_PAGES, worst.title);
      // The page block is whole and precedes the notice, as the clamp's own
      // comment promises…
      expect(content.slice(0, content.lastIndexOf("[Note:"))).toBe(
        `${keptBlockText(BUDGET_FOR_PAGES)}${JOIN}`,
      );
      // …and the notice arrived intact rather than as whatever survived.
      expect(noticeOf(content)).toBe(worst.notice);
      expect(content.length).toBeLessThanOrEqual(MAX_MEETING_CONTEXT_CHARS);
    });

    it("charges the join to the reserve, never to the user's own pages", () => {
      // The wrong fix, pinned out. Paying for the join by shrinking
      // `budgetForPages` (or by growing NOTICE_RESERVE_CHARS, which is the same
      // subtraction wearing a different name) costs two characters of the
      // user's own knowledge base on EVERY read, including the overwhelming
      // majority that drop nothing and assemble no notice and so never spend
      // the join at all. A page block of exactly MAX minus the reserve is still
      // admitted whole, and nothing is reported as dropped.
      const result = buildMeetingContext(
        call({ topic: "", transcript: "", pages: [keptPage(BUDGET_FOR_PAGES)] }),
      );
      expect(result.includedPageIds).toEqual([KEEP_ID]);
      expect(result.droppedPageCount).toBe(0);
      expect(result.content).not.toContain("[Note:");
      expect(result.content.length).toBe(BUDGET_FOR_PAGES);
    });
  });

  it("reports which pages actually made it, for the attribution check", () => {
    // `includedPageIds` is what normalizeInsights uses to downgrade a page
    // claim the model was never shown. If this ever over-reports, that guard
    // silently stops guarding.
    const result = buildMeetingContext(
      call({ pages: [big("p-1", 10), big("p-2", 4000), big("p-3", 4000)] }),
    );
    for (const id of result.includedPageIds) {
      expect(result.content).toContain(`Page ${id}`);
    }
  });
});
