// A citation with no page name renders as "From your  page." — the two
// halves of a sentence with the subject missing, read out loud in an
// interview by someone trusting it.
//
// HOW IT HAPPENS. A project page needs a title OR a body to be eligible, so a
// page with a real body and a blank title is legitimate and common (the tree
// creates pages titled "" and people write the body first). `selectBestStory`
// returns `title: str(best.title).trim()` — "" for such a page — and the
// deterministic builders put that straight into `pageSources`.
// `resolvePageSource` in answerPoints.js validates only the `id`, so the empty
// title survives all the way to AnswerLines.js's `From your {title} page.`
//
// The Gemini path does not have this problem, and that asymmetry is the tell:
// `buildKnowledgeBaseBlock` already defends the exact same field with
// `str(page.title).trim() || "Untitled project"`. Two paths, one guarantee the
// renderer assumes, defended on one of them.
//
// Written from the review finding, before the fix.

import { describe, it, expect } from "vitest";
import { selectBestStory } from "./projectStories.js";
import { answerLines } from "./answerPoints.js";

const UNTITLED_PAGE = {
  id: "p1",
  title: "",
  body: [
    "- Built a Kafka settlement pipeline that cut latency from three days to four hours",
    "- Sharded the ledger by tenant and cut p99 by 40 percent",
  ].join("\n"),
  position: 0,
  archived_at: null,
  generated_kind: null,
};

describe("a page with no title never produces a nameless citation", () => {
  it("gives selectBestStory's result a readable name", () => {
    const story = selectBestStory([UNTITLED_PAGE], { question: "how did you shard the ledger by tenant" });
    expect(story.matched).toBe(true);
    expect(story.pageId).toBe("p1");
    // Whatever the fallback is, it must be something a person can read as the
    // name of a page. Asserting non-empty rather than a specific string keeps
    // the wording free while pinning the property.
    expect(story.title.trim()).not.toBe("");
  });

  it("never renders a citation sentence with a hole where the page name goes", () => {
    // The end-to-end property, asserted on the rendered line rather than on
    // the intermediate value, because that is where the user meets it.
    const story = selectBestStory([UNTITLED_PAGE], { question: "how did you shard the ledger by tenant" });
    const lines = answerLines(
      ["The sharding"],
      ["We sharded the ledger by tenant."],
      [{ id: story.pageId, title: story.title }],
    );
    expect(lines[0].pageSource).not.toBe(null);
    expect(lines[0].pageSource.title.trim()).not.toBe("");
  });

  it("still refuses a citation that has no usable page id at all", () => {
    // The existing guard must not be loosened by whatever fixes the title:
    // a page with no id cannot be cited, titled or not.
    const lines = answerLines(["cue"], ["A point."], [{ id: "   ", title: "Payments migration" }]);
    expect(lines[0].pageSource).toBe(null);
  });
});
