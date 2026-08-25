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

    expect(content).toContain(`file-${MAX_LISTED_ATTACHMENTS - 1}.pdf`);
    expect(content).not.toContain(`file-${MAX_LISTED_ATTACHMENTS}.pdf`);
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
