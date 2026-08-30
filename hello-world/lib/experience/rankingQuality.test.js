// Does the ranker actually pick the right page?
//
// Every other test around this feature pins a RULE — that ties break on
// position, that a blank query preserves input order, that the budget holds.
// None of them asks the only question the user cares about: given a real
// interview question and a realistic knowledge base, does their own best page
// come out on top?
//
// This file is that question, as a fixture set, and it exists because the old
// ranker's failures were MEASURED before they were fixed. A ranking change
// with no measurement is a preference, not an improvement.
//
// HOW THE FIXTURES ARE BUILT, and this took three attempts, in two opposite
// directions. Both failures are worth keeping because they are the two halves
// of the same mistake.
//
// FIRST: five of six cases passed against the very scorer they were written to
// indict. The "acronym" case gave its target page a title containing
// "traffic", a seven-letter word the old tokenizer reads perfectly well, so it
// measured nothing. A fixture whose two sides are not distinguishable by the
// thing under test proves only that two unrelated strings are unrelated. Every
// case below now states what the old rule scores.
//
// SECOND, and more dangerous: once every case failed, nobody checked that any
// of them could be MADE to pass. The repaired acronym case turned out to be
// unsatisfiable — its two pages carried exactly two query terms each, all with
// document frequency 1 in a two-page corpus, so inverse document frequency
// could not separate them at all, and both term frequency and length
// normalisation favoured the wrong page. Swept across k1 in {0.5, 1.2, 2.0}
// and b in {0, 0.75, 1.0}: the wrong page wins all nine.
//
// A fixture set validated in only one direction is half a measurement, and it
// is the more dangerous half — it reads as a specification while being
// impossible to satisfy, and an implementer chasing it will tune a scorer
// until something else breaks. Every case here is now checked BOTH ways:
// it fails under the old rule, and it passes under the intended one.
//
// It tests through `rankPagesByRelevance` — the entry point both the interview
// copilot and the meeting copilot reach — not through whatever scorer sits
// underneath, so these cases outlive the implementation.

import { describe, it, expect } from "vitest";
import { rankPagesByRelevance } from "./knowledgeBase.js";

function page(id, title, body, position) {
  return { id, title, body, position, archived_at: null, generated_kind: null };
}

const winnerOf = (pages, query) => rankPagesByRelevance(pages, query)[0]?.id;

describe("ranking quality — the cases the old scorer got wrong", () => {
  it("finds the page about the acronyms the question names", () => {
    // THE HEADLINE FAILURE. The four-character floor deletes AWS, SQL and Go
    // outright, symmetrically, so a technical question's most specific tokens
    // are invisible on both sides.
    //
    // OLD RULE: decoy scores 2 (traffic, using), target scores 0 — everything
    // the target shares with the question (aws, sql, go, 10x) is under the
    // four-character floor. The decoy wins outright.
    //
    // The question is the one R-257 is recorded against, and it is load-bearing
    // that it names THREE acronyms only the target has. An earlier version
    // asked "How did you scale traffic using AWS and SQL?" — two query terms on
    // each side, every one with document frequency 1 in a two-page corpus, so
    // term weighting had nothing to separate them with and both term frequency
    // and length favoured the decoy. That version was unsatisfiable at every k1
    // and b; this comment is here so nobody reintroduces it while "simplifying"
    // the fixture.
    //
    // CAVEAT, so a later change does not quietly narrow the margin: part of the
    // separation is that "scaled" does not match "scale" under a tokenizer with
    // no stemmer. A naive trailing -ed/-ing/-s strip does NOT reopen this —
    // measured across the sweep above, the target still wins every
    // combination. What reopens it is a Porter-class stemmer that also folds
    // the silent "e" ("scale" -> "scal", matching "scaled" -> "scal"): that one
    // hands the decoy the term back and loses this case at the shipped
    // settings (and in most of the sweep). The question to ask about a new
    // stemmer is "does it fold the silent e", not "does it strip suffixes".
    const decoy = page(
      "decoy",
      "Traffic planning notes",
      "- Notes on how we scale and forecast traffic, using the quarterly spreadsheet",
      0,
    );
    const target = page(
      "target",
      "Read path rebuild",
      "- Moved the hot read path onto AWS Aurora and cut SQL round trips per call\n- Rewrote the handler in Go",
      1,
    );
    expect(
      winnerOf([decoy, target], "Walk me through how you scaled our API to handle 10x traffic using AWS, SQL and Go."),
    ).toBe("target");
  });

  it("prefers the page that documents the story over the page that documents interviewing", () => {
    // Measured on the shipped scorer: boilerplate 6, real page 4, because
    // "time", "about", "what" and "situation" counted as evidence. An
    // "Interview prep" page is one real users of this product keep.
    const prep = page(
      "prep",
      "Interview prep",
      "- Remember to describe the situation and what the approach was\n- Talk about a time when the problem was difficult and say what you did\n- Have a story ready about the situation, the approach and the result",
      0,
    );
    const real = page(
      "stakeholder",
      "Billing rewrite sign-off",
      "- Convinced a skeptical stakeholder to adopt the new approach after two review rounds",
      1,
    );
    expect(
      winnerOf(
        [prep, real],
        "Tell me about a time when you had to convince a skeptical stakeholder to adopt a new approach. What was the situation and what did you do?",
      ),
    ).toBe("stakeholder");
  });

  it("does not let a long page win a tie it only reached by being long", () => {
    // Both pages contain BOTH query terms, so the old rule scores them 2 and 2
    // and the tie falls to `position` — which the sprawling page wins by
    // sitting higher in the sidebar.
    //
    // Under the new rule, both pages carry "ledger" and "sharding" at term
    // frequency 1 apiece — "precise" keeps "ledger" only in its TITLE, not
    // repeated in its body, precisely so tf cannot be what separates the two.
    // With tf and idf therefore identical on both sides, length normalisation
    // is the ONLY thing left that can decide the winner: one page is sixty
    // bullets about everything else with a single passing mention, the other
    // is one bullet about exactly this.
    const sprawling = page(
      "sprawl",
      "Platform notes",
      [
        "## Everything",
        ...Array.from({ length: 60 }, (_, i) => `- Note ${i} on deploys, alerts, dashboards, retries and backups`),
        "- We also did some ledger sharding at one point",
      ].join("\n"),
      0,
    );
    const precise = page(
      "precise",
      "Ledger sharding",
      "- Sharded it by tenant and cut write contention",
      1,
    );
    expect(winnerOf([sprawling, precise], "Describe the ledger sharding.")).toBe("precise");
  });

  it("lets the rare term decide when the common one is on every page", () => {
    // A knowledge base organised around one subject is the normal way to keep
    // one, and "ledger" then stops distinguishing anything.
    //
    // OLD RULE: the platform page scores 2 (ledger, built) and the
    // reconciliation page scores 1 (reconciliation), so the page that merely
    // repeats the theme beats the page that answers the question. Weighting by
    // how many pages contain a term is exactly what fixes it.
    const pages = [
      page("platform", "Ledger platform", "- Built the ledger platform and the ledger admin console", 0),
      page("recon", "Nightly job", "- The nightly reconciliation runs against every tenant at 2am", 1),
      page("audit", "Ledger audit trail", "- Built the ledger audit trail export", 2),
      page("fees", "Ledger fee rules", "- Built the ledger fee rule engine", 3),
      page("backfill", "Ledger backfill", "- Built the ledger backfill tooling", 4),
    ];
    expect(winnerOf(pages, "Tell me about the ledger reconciliation you built.")).toBe("recon");
  });

  it("still ranks the obvious case the old scorer already got right", () => {
    // The control. A change that fixed the four cases above by breaking this
    // one would be a trade, not an improvement.
    //
    // The loser has to SCORE for this to work. An earlier version gave the
    // garden page no overlap at all, so it scored exactly 0 under every rule
    // old and new — and a control whose loser scores zero cannot detect a
    // trade. It can only detect a ranker that has stopped working entirely.
    // The garden page now shares "migration" with the question, so the two are
    // genuinely being compared.
    const pages = [
      page("garden", "Community garden rota", "- The watering rota, the compost schedule and the shed migration", 0),
      page("payments", "Payments migration", "- Moved settlement onto a new processor over two quarters", 1),
    ];
    expect(winnerOf(pages, "Tell me about the payments migration and the settlement work.")).toBe("payments");
  });

  it("leaves input order alone when there is nothing to rank against", () => {
    // The guarantee every existing caller depends on, restated here because
    // this file is what a future ranker will be judged by.
    const pages = [page("a", "A", "alpha", 0), page("b", "B", "beta", 1), page("c", "C", "gamma", 2)];
    expect(rankPagesByRelevance(pages, "").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("still sorts by position on an empty query when the input isn't already in position order", () => {
    // The case above uses pages already in position order, so it cannot tell
    // an actual position sort apart from `if (terms.size === 0) return pages`
    // — an early return that looks like a free optimisation on an empty
    // query but silently skips the sort every current caller depends on to
    // put an out-of-order array back into position order. Positions 9 and 2,
    // deliberately reversed from input order, are what forces the sort to
    // actually run.
    expect(rankPagesByRelevance([page("i", "I", "x", 9), page("j", "J", "y", 2)], "").map((p) => p.id)).toEqual([
      "j",
      "i",
    ]);
  });
});
