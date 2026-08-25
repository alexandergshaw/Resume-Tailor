// A STAR story's Result beat must come AFTER its Action in the page as
// written, or the candidate says out loud that a thing which happened first
// was the outcome of a thing that happened second.
//
// THE DEFECT: `selectBestStory`'s `bullets` are ordered by RELEVANCE, so that
// the Action beat is the bullet that actually answers the question.
// `starPointsFromStory` then took `bullets[1]` as the Result — the
// SECOND-most relevant bullet, which has no relationship to document order at
// all and is frequently earlier in the page than the Action. Reproduced on a
// real page shape:
//
//   Action: Cut settlement time from three days to one
//   Result: Added a nightly reconciliation job
//
// where the reconciliation job is bullet one and the settlement cut is bullet
// two. Nothing in the sentence tells the candidate it is backwards.
//
// WHY THIS FILE EXISTS SEPARATELY. storyMatchHonesty.test.js's checkout
// fixture was believed to pin this and does not: it asserts only that the
// Result is not the page's FIRST bullet ("Kicked off in Q1..."), and the old
// bullets[1] reading returned the page's SECOND bullet there — equally
// inverted, differently worded, so the assertion passed against the very code
// it was meant to reject. Verified by reverting the fix with that file green.
// The property needs a case that names the ORDERING, not one particular wrong
// answer.

import { describe, it, expect } from "vitest";
import { selectBestStory, starPointsFromStory } from "./projectStories.js";

function page(id, title, bullets) {
  return {
    id,
    title,
    body: bullets.map((b) => `- ${b}`).join("\n"),
    position: 0,
    archived_at: null,
    generated_kind: null,
  };
}

describe("the Result beat follows the Action in the page, not in the ranking", () => {
  it("skips a more-relevant bullet that precedes the Action and takes the next one that follows it", () => {
    // Ranking puts bullet 1 (index 1) second — it shares "settlement" with
    // the question — while the Action is bullet 2 (index 2). The Result must
    // be bullet 3 (index 3), the first one that actually follows the Action.
    const p = page("settle", "Settlement pipeline", [
      "Scoped the work with the payments team",
      "Wrote the settlement runbook before any code landed",
      "Cut settlement latency from three days to four hours",
      "Chargeback disputes fell by a third the following quarter",
    ]);
    const story = selectBestStory([p], { question: "How did you cut settlement latency to four hours?" });
    expect(story.matched).toBe(true);
    const points = starPointsFromStory(story);
    expect(points[1]).toBe("Action: Cut settlement latency from three days to four hours.");
    expect(points[2]).toBe("Result: Chargeback disputes fell by a third the following quarter.");
    // The exact bullet the old rule would have chosen — the second-most
    // relevant one, which happened BEFORE the action.
    expect(points[2]).not.toBe("Result: Wrote the settlement runbook before any code landed.");
  });

  it("takes the MOST RELEVANT bullet that follows the Action, not the earliest one", () => {
    // The rule `resultBeatFor` actually implements, pinned because nothing
    // else here distinguishes it from the one its doc comment used to claim
    // ("the first bullet that FOLLOWS the chosen Action in the page as
    // written"). Both readings agree on every other case in this file, so a
    // future "correction" toward the documented behaviour would have passed
    // unnoticed — a silent change to what a candidate says out loud.
    //
    // Two bullets follow the Action here. The DOCUMENT-order reading returns
    // the runbook line (index 1); the relevance-order reading returns the
    // replica-lag line (index 2), which shares "Postgres" and "billing" with
    // the question. The second is what the code does, and the better Result
    // beat: an outcome, not the next thing that happened.
    const p = page("billing", "Billing migration", [
      "Migrating the billing service to Postgres took two quarters",
      "Wrote a runbook for the cutover weekend",
      "Postgres replica lag fell to under a second after the billing cutover",
    ]);
    const story = selectBestStory([p], { question: "Tell me about migrating the billing service to Postgres." });
    expect(story.matched).toBe(true);
    const points = starPointsFromStory(story);
    expect(points[1]).toBe("Action: Migrating the billing service to Postgres took two quarters.");
    expect(points[2]).toBe("Result: Postgres replica lag fell to under a second after the billing cutover.");
    // The earlier of the two following bullets — what a document-order scan
    // would have returned.
    expect(points[2]).not.toBe("Result: Wrote a runbook for the cutover weekend.");
  });

  it("emits no Result beat at all when nothing in the page follows the Action", () => {
    // Two honest beats beat three with a false one. The old rule had a bullet
    // available here — the page has three — and used it, in reverse.
    const p = page("checkout", "Checkout rewrite", [
      "Kicked off in Q1 with a kickoff meeting",
      "Reduced checkout errors by 80 percent after the rewrite",
      "Rewrote the checkout flow in TypeScript",
    ]);
    const story = selectBestStory([p], { question: "Tell me about rewriting the checkout flow in TypeScript." });
    const points = starPointsFromStory(story);
    expect(points).toEqual(["Situation: Checkout rewrite.", "Action: Rewrote the checkout flow in TypeScript."]);
  });

  it("still reports a Result when the page really is in narrative order", () => {
    // The positive control, and the thing that stops the fix from being
    // "never emit a Result" — which would pass both cases above and silently
    // shorten every deterministic STAR answer in the app.
    const p = page("ingest", "Kafka ingestion", [
      "Built the ingestion topics and their partitioning",
      "Backfilled two years of events without downtime",
    ]);
    const story = selectBestStory([p], { question: "Tell me about building the ingestion topics." });
    const points = starPointsFromStory(story);
    expect(points).toEqual([
      "Situation: Kafka ingestion.",
      "Action: Built the ingestion topics and their partitioning.",
      "Result: Backfilled two years of events without downtime.",
    ]);
  });

  it("keeps the old bullets[1] reading for a story that carries no positions", () => {
    // A hand-assembled story — a caller's test double, or an entry cached
    // before `bulletPositions` existed — has no document order to consult.
    // Dropping the beat there would silently shorten those answers on the
    // strength of information that simply is not present.
    const points = starPointsFromStory({
      title: "Payments migration",
      bullets: ["Cut settlement time from three days to one", "Mentored two junior engineers"],
    });
    expect(points[2]).toBe("Result: Mentored two junior engineers.");
  });
});
