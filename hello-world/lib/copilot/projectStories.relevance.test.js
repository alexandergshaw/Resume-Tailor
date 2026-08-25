// selectBestStory's two new obligations, written from the acceptance
// criteria before they existed. In its own file so the existing
// projectStories.test.js contract stays readable and so these two properties
// can be sabotage-checked on their own.
//
// 1. It reports WHICH page it picked (`pageId`), because the deterministic
//    engine now has to say where each point came from, and it is the only
//    thing on that path that knows.
// 2. Its `bullets` come back in RELEVANCE order, not document order, because
//    starPointsFromStory takes bullets[0] as the Action beat — so a page
//    whose first bullet is boilerplate ("Kicked off in Q1") answered every
//    question with that boilerplate, no matter what was asked.

import { describe, it, expect } from "vitest";
import { selectBestStory, starPointsFromStory } from "./projectStories.js";

const PAGE = {
  id: "page-payments",
  title: "Payments migration",
  body: [
    "- Kicked off the project in Q1 with a kickoff meeting",
    "- Cut settlement latency from three days to four hours using Kafka",
    "- Wrote the runbook and handed it to the on-call rotation",
  ].join("\n"),
  position: 0,
  archived_at: null,
  generated_kind: null,
};

describe("selectBestStory — provenance", () => {
  it("reports the id of the page it picked", () => {
    const story = selectBestStory([PAGE], { question: "tell me about a hard migration" });
    expect(story.pageId).toBe("page-payments");
    expect(story.title).toBe("Payments migration");
  });

  it("reports a null id rather than a broken one when the page has no usable id", () => {
    const story = selectBestStory([{ ...PAGE, id: "  " }], { question: "migration" });
    expect(story.pageId).toBe(null);
  });
});

describe("selectBestStory — bullets in relevance order", () => {
  it("puts the bullet that answers the question first", () => {
    const story = selectBestStory([PAGE], {
      question: "how did you cut settlement latency",
      points: ["kafka"],
    });
    expect(story.bullets[0]).toBe("Cut settlement latency from three days to four hours using Kafka");
  });

  it("keeps document order for bullets that score the same", () => {
    // Otherwise the ordering is unstable and the answer changes between two
    // identical asks, which reads to a user as the feature being broken.
    const story = selectBestStory([PAGE], { question: "zzzz-nothing-matches" });
    expect(story.bullets).toEqual([
      "Kicked off the project in Q1 with a kickoff meeting",
      "Cut settlement latency from three days to four hours using Kafka",
      "Wrote the runbook and handed it to the on-call rotation",
    ]);
  });

  it("carries the relevant bullet into the STAR Action beat", () => {
    // The whole point of the reordering: this is what a candidate actually
    // says out loud on the deterministic engine.
    const story = selectBestStory([PAGE], { question: "how did you cut settlement latency with kafka" });
    const points = starPointsFromStory(story);
    expect(points[0]).toBe("Situation: Payments migration.");
    expect(points[1]).toBe("Action: Cut settlement latency from three days to four hours using Kafka.");
  });

  it("still reports honestly that nothing matched", () => {
    // `matched` is what stops an unrelated first-eligible page being spoken
    // as though it were chosen for the question.
    expect(selectBestStory([PAGE], { question: "zzzz-nothing-matches" }).matched).toBe(false);
    expect(selectBestStory([PAGE], { question: "settlement latency kafka" }).matched).toBe(true);
  });
});
