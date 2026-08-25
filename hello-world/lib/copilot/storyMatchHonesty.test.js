// `matched` is not a relevance score. It is the HONESTY GATE that decides
// whether the deterministic engine is allowed to speak one of the
// candidate's pages as the answer to this question — and whether the app
// tells them, in writing, which page the answer came from.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT, reproduced verbatim from the real
// module before the fix:
//
//   question: "Tell me about a time you disagreed with your manager."
//   -> picked "Beekeeping club minutes", matched: true
//      Situation: Beekeeping club minutes.
//      Action: We spent time each spring checking the hives with the club members.
//      Result: Notes from the meeting about honey extraction.
//
// because "time" and "with" occur on that page. `matched` was
// `overlapScore(...) > 0` over bare set-overlap on /[a-z0-9]{4,}/, so ordinary
// interview phrasing — "tell me about a time when you had to work with..." —
// clears the four-character floor against essentially any prose page a person
// has written. A gate that is near-always open is not a gate, and this one
// now also drives a citation the candidate reads aloud.
//
// SCOPE, deliberately: this hardens `matched` ONLY. `significantTerms` and
// `overlapScore` are a shared contract imported by lib/meeting/insightsLocal.js
// and lib/meeting/meetingContext.js, and the ranking they drive is a separate,
// larger piece of work (see R-257). Nothing here may change what those two
// functions return or how pages are ORDERED — only whether the top-scoring
// page is honest enough to speak.

import { describe, it, expect } from "vitest";
import { selectBestStory, starPointsFromStory, significantTerms, overlapScore } from "./projectStories.js";

function page(id, title, body, position = 0) {
  return { id, title, body, position, archived_at: null, generated_kind: null };
}

const BEE = page(
  "bee",
  "Beekeeping club minutes",
  "- We spent time each spring checking the hives with the club members\n- Notes from the meeting about honey extraction",
  0,
);
const LEDGER = page(
  "ledger",
  "Payments ledger",
  "- Sharded the ledger by tenant and cut p99 latency by 40 percent\n- Migrated settlement onto Kafka",
  7,
);

describe("matched is an honesty gate, not a co-occurrence check", () => {
  it("refuses a page whose only overlap with the question is interview boilerplate", () => {
    const story = selectBestStory([BEE, LEDGER], {
      question: "Tell me about a time you disagreed with your manager.",
    });
    // It may still PICK a page — ranking always returns its best guess — but
    // it must not claim the page matched, because nothing about it did.
    expect(story.matched).toBe(false);
  });

  it("still matches when the question is genuinely about the page", () => {
    // The positive control, and the thing that stops the fix from being
    // "return false always" — which would pass the case above and silently
    // disable the entire deterministic knowledge-base path.
    const story = selectBestStory([BEE, LEDGER], {
      question: "Tell me about a time you sharded a ledger by tenant to cut latency.",
    });
    expect(story.matched).toBe(true);
    expect(story.pageId).toBe("ledger");
  });

  it("matches on a real term even when boilerplate is present too", () => {
    // Real questions carry both. Stripping the boilerplate must not strip the
    // signal with it.
    const story = selectBestStory([BEE, LEDGER], {
      question: "Tell me about a time you had to migrate settlement onto Kafka.",
    });
    expect(story.matched).toBe(true);
    expect(story.pageId).toBe("ledger");
  });

  it("does not depend on there being more than one page to compare against", () => {
    // The single-page knowledge base is the common case for a new user, and a
    // document-frequency rule computed over one page must not collapse into
    // "everything is common, so nothing ever matches".
    const alone = selectBestStory([LEDGER], {
      question: "Tell me about a time you sharded a ledger by tenant.",
    });
    expect(alone.matched).toBe(true);

    const unrelated = selectBestStory([BEE], {
      question: "Tell me about a time you disagreed with your manager.",
    });
    expect(unrelated.matched).toBe(false);
  });

  it("leaves the shared tokenizer and scorer exactly as they were", () => {
    // lib/meeting/** imports both of these. Hardening the gate must not move
    // them: R-257 records the ranking work as its own chunk precisely because
    // it is a cross-domain contract change.
    expect([...significantTerms("Handled 8080 requests with Kafka")].sort()).toEqual(
      [...new Set("handled 8080 requests with kafka".match(/[a-z0-9]{4,}/g))].sort(),
    );
    expect(overlapScore(significantTerms("kafka ledger"), "kafka")).toBe(1);
    expect(overlapScore(significantTerms("kafka ledger"), "kafka ledger tenant")).toBe(2);
  });
});

// A SECOND round of holes, found after the first hardening shipped. Each is a
// real question a candidate will be asked, and each is recorded because the
// gate has now been wrong three different ways and the next reader deserves
// the whole list rather than the last fix.
//
// The rule these pin: a term the QUESTION contributes for free carries no
// evidence, however rare it looks. "time", "project" and "worked" appear in
// most behavioural questions ever asked; matching a page on one of them is a
// coincidence, not a story. The counterweight is that a single strong term
// IS enough when it names the page — "Kafka" against a page titled "Kafka
// ingestion" is exactly what the candidate meant.
describe("the gate is not fooled by the words every interview question contains", () => {
  const SETTLE = page(
    "settle",
    "Settlement pipeline",
    "- Cut settlement time from three days to one\n- Added a nightly reconciliation job",
    0,
  );
  const DESIGN = page("design", "Design system", "- Built the component library in Storybook", 1);
  const GARDEN = page("garden", "Community garden rota", "- I worked on the watering rota project every other weekend", 0);
  const BILLING = page("billing", "Billing service", "- Rewrote the billing service in Go", 1);

  for (const question of [
    "Tell me about a time you failed.",
    "Tell me about a time you received difficult feedback.",
    "Tell me about a time you had to say no.",
  ]) {
    it(`refuses a page whose only overlap is "time" — ${JSON.stringify(question)}`, () => {
      // The whole overlap here is the word "time", because the page happens to
      // say "settlement time". Nothing about the page answers any of these.
      expect(selectBestStory([SETTLE, DESIGN], { question }).matched).toBe(false);
    });
  }

  it('refuses a page matched only on "worked" and "project"', () => {
    // Two terms, so a count threshold alone would let this through — and the
    // candidate would answer a question about a project that went wrong with
    // their community garden watering rota.
    expect(
      selectBestStory([GARDEN, BILLING], {
        question: "Tell me about a time you worked on a project that did not go to plan.",
      }).matched,
    ).toBe(false);
  });

  it("accepts one strong term when it names the page", () => {
    // The other direction, and just as important: a document-frequency rule
    // over a small knowledge base marked this generic — both pages say Kafka,
    // so "more than half" called it common — and silently refused the
    // candidate their own material for a question that names it outright.
    const kafkaA = page("k1", "Kafka ingestion", "- Built the ingestion topics", 0);
    const kafkaB = page("k2", "Kafka retention tuning", "- Tuned retention windows", 1);
    const story = selectBestStory([kafkaA, kafkaB], { question: "Tell me about your Kafka experience." });
    expect(story.matched).toBe(true);
  });

  it("does not accept a strong term that appears only in the body when it stands alone", () => {
    // The counterweight to the case above, so "one term is enough" cannot be
    // read as "one term anywhere is enough".
    const page1 = page("p1", "Quarterly planning notes", "- We evaluated Kafka and decided against it", 0);
    expect(selectBestStory([page1], { question: "Tell me about your Kafka experience." }).matched).toBe(false);
  });
});

describe("a STAR story's beats stay in the order they happened", () => {
  it("never reports an earlier bullet as the Result of a later one", () => {
    // `bullets` is ordered by relevance so the Action beat is the one that
    // answers the question. The Result beat must still come AFTER the action
    // in the page as written, or the answer says a thing that happened first
    // was the outcome of a thing that happened second.
    const p = page(
      "checkout",
      "Checkout rewrite",
      [
        "- Kicked off in Q1 with a kickoff meeting",
        "- Reduced checkout errors by 80 percent after the rewrite",
        "- Rewrote the checkout flow in TypeScript",
      ].join("\n"),
      0,
    );
    const story = selectBestStory([p], { question: "Tell me about rewriting the checkout flow in TypeScript." });
    expect(story.matched).toBe(true);
    const points = starPointsFromStory(story);
    expect(points[1]).toBe("Action: Rewrote the checkout flow in TypeScript.");
    // "Kicked off in Q1" precedes the action in the page, so it cannot be its
    // result. Either a later bullet or no Result beat at all is honest.
    expect(points[2]).not.toBe("Result: Kicked off in Q1 with a kickoff meeting.");
  });
});

// The gate was being asked about the wrong page.
//
// `selectBestStory` picks its winner with the RAW overlap score — scaffolding
// and stopwords included — and only then asks whether that winner is honest.
// So a page full of interview boilerplate wins the argmax on words like
// "time", "difficult" and "problem", fails the gate, and the genuinely
// relevant page is never considered at all. The candidate is told they have
// nothing to say about a subject they have a whole page about.
//
// "Interview prep" is not a contrived fixture — it is a page real users of
// this product keep.
describe("the gate is asked about the best ELIGIBLE page, not just the top scorer", () => {
  const PREP = page(
    "prep",
    "Interview prep",
    "- Notes on how to handle a difficult problem question\n- Remember to describe the situation and the time it took",
    0,
  );
  const TERRAFORM = page("tf", "Terraform migration", "- Debugged the Terraform state locking issue", 1);
  const JOURNAL = page("journal", "Weekly journal", "- A difficult week: spent time on the usual problem list and had to handle the backlog", 0);
  const KAFKA = page("kafka", "Kafka ingestion pipeline", "- Built the ingestion topics and tuned retention", 1);

  it("reaches the relevant page when a boilerplate page outscores it", () => {
    const story = selectBestStory([PREP, TERRAFORM], {
      question: "Tell me about a time you had to debug a difficult Terraform problem.",
    });
    expect(story.pageId).toBe("tf");
    expect(story.matched).toBe(true);
  });

  it("reaches it when the boilerplate page wins on scaffolding words alone", () => {
    // The question deliberately carries several scaffolding words the journal
    // page happens to contain — "difficult", "problem", "handle" — so the
    // journal takes the raw argmax with a score of 3 against the Kafka page's
    // 1. Under the old code the gate was then asked about the journal, it
    // correctly said no, and the Kafka page was never looked at.
    const story = selectBestStory([JOURNAL, KAFKA], {
      question: "Tell me about a difficult problem you had to handle with Kafka ingestion.",
    });
    expect(story.pageId).toBe("kafka");
    expect(story.matched).toBe(true);
  });

  it("still returns the top scorer, unmatched, when NO page clears the gate", () => {
    // The fallback must not become "return null" — callers rely on getting a
    // best guess back, and `matched: false` is what keeps it honest.
    const story = selectBestStory([PREP, JOURNAL], { question: "Tell me about a time you failed." });
    expect(story).not.toBe(null);
    expect(story.matched).toBe(false);
  });
});
