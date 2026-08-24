// The deterministic no-LLM path for the meeting copilot. See insightsLocal.js's
// own header for what it is and is not allowed to claim; these tests pin
// that contract, not just its happy path.

import { describe, it, expect } from "vitest";
import { localInsights } from "./insightsLocal.js";

const page = (over = {}) => ({
  id: "pg-1",
  title: "Untitled page",
  body: "",
  archived_at: null,
  ...over,
});

describe("the topic", () => {
  it("presents the transcript's own top terms, never a summary", () => {
    // freq: roadmap x3, timeline x3, budget x2, stakeholders x1. Ties (roadmap
    // vs timeline, both x3) break alphabetically, so the order is pinned, not
    // just the membership — a mutation that dropped the tiebreak or picked
    // only 3 terms would both be caught here.
    const transcript = "Roadmap roadmap roadmap budget budget timeline timeline timeline stakeholders";
    const { topic } = localInsights({ pages: [], transcript, topic: "" });
    expect(topic.text).toBe("roadmap, timeline, budget, stakeholders");
  });

  it("is low confidence under a short transcript", () => {
    const { topic } = localInsights({ pages: [], transcript: "Quick chat about timeline.", topic: "" });
    expect(topic.confidence).toBe("low");
  });

  it("is medium confidence above the threshold, and never high — even for a long transcript", () => {
    // Positive control for the ceiling itself, not just the low->medium step:
    // a long, rich transcript is exactly the input a real summarizer would
    // call "high confidence" on. This heuristic counted words, it didn't
    // read anything, so "medium" is the most it may ever claim.
    const longTranscript = Array.from({ length: 60 }, (_, i) => `distinctterm${i}`).join(" ");
    const { topic } = localInsights({ pages: [], transcript: longTranscript, topic: "" });
    expect(topic.confidence).toBe("medium");
    expect(topic.confidence).not.toBe("high");
  });

  it("reports changed by comparing against the previous topic argument, not its own opinion", () => {
    const transcript = "Roadmap roadmap roadmap budget budget timeline timeline timeline stakeholders";
    const same = localInsights({ pages: [], transcript, topic: "roadmap, timeline, budget, stakeholders" });
    expect(same.topic.changed).toBe(false);

    const different = localInsights({ pages: [], transcript, topic: "an entirely different previous topic" });
    expect(different.topic.changed).toBe(true);
  });
});

describe("\"your page X covers this\"", () => {
  const transcript = "Are we still gated on the legacy payment processor migration?";

  const pageWithBullets = page({
    id: "pg-a",
    title: "Payments Migration",
    body: [
      "Intro paragraph with no bullet marker.",
      "- Migrated billing off the legacy payment processor entirely.",
      "- Cut reconciliation time to under an hour.",
    ].join("\n"),
  });

  const pageWithoutBullets = page({
    id: "pg-c",
    title: "Client Feedback Notes",
    body: "We had a long call about processor migration feedback but nothing itemized here.",
  });

  const lowerOverlapPage = page({
    id: "pg-d",
    title: "Standup Notes",
    body: "There was a brief mention of the processor only.",
  });

  const unrelatedPage = page({
    id: "pg-b",
    title: "Random Notes",
    body: "Just some unrelated thoughts about lunch plans and weekend logistics.",
  });

  it("quotes the page's own best-matching bullet line verbatim, never a paraphrase", () => {
    const { insights } = localInsights({ pages: [pageWithBullets], transcript, topic: "" });
    const pageInsights = insights.filter((i) => i.source.kind === "page");
    expect(pageInsights).toHaveLength(1);
    // Exact string, not a substring match: the bullet about the legacy
    // processor scores higher overlap than the reconciliation-time bullet, so
    // this pins WHICH bullet won, not just that some bullet was used.
    expect(pageInsights[0].text).toBe("Migrated billing off the legacy payment processor entirely.");
    // "point", not "gap": the text is a sentence the user already wrote and
    // could say out loud right now. `kind` reaches the screen as a chip, so
    // labelling their own most-relevant bullet "Gap" would be a plain
    // falsehood. The honesty claim lives in `source`, asserted next.
    expect(pageInsights[0].kind).toBe("point");
    expect(pageInsights[0].source).toEqual({ kind: "page", pageId: "pg-a", pageTitle: "Payments Migration" });
  });

  it("falls back to naming the page when it matched but has no bullets to quote", () => {
    const { insights } = localInsights({ pages: [pageWithoutBullets], transcript, topic: "" });
    const pageInsights = insights.filter((i) => i.source.kind === "page");
    expect(pageInsights).toHaveLength(1);
    // The one branch that IS genuinely a gap, and the counterweight to the
    // test above: relevant material exists, but there is nothing quotable in
    // it yet, so this names the page instead of asserting anything from it.
    expect(pageInsights[0].kind).toBe("gap");
    // A title is not a claim — the fallback text must NAME the page, not just
    // repeat its bare title as though the title itself asserted something.
    expect(pageInsights[0].text).not.toBe("Client Feedback Notes");
    expect(pageInsights[0].text).toContain("Client Feedback Notes");
  });

  it("caps page insights at the top 2 by overlap, even with 3 matching pages", () => {
    const { insights } = localInsights({
      pages: [pageWithBullets, pageWithoutBullets, lowerOverlapPage],
      transcript,
      topic: "",
    });
    const pageIds = insights.filter((i) => i.source.kind === "page").map((i) => i.source.pageId);
    expect(pageIds).toHaveLength(2);
    // The two highest-overlap pages win; the weaker third candidate is left out
    // entirely rather than bumping one of the stronger two.
    expect(pageIds).toEqual(["pg-a", "pg-c"]);
  });

  it("never cites a page that shares no terms with the transcript at all", () => {
    // Positive control against "always include every eligible page" — this
    // page is eligible (not archived) but has zero overlap, and must produce
    // nothing.
    const { insights } = localInsights({ pages: [unrelatedPage], transcript, topic: "" });
    expect(insights.filter((i) => i.source.kind === "page")).toHaveLength(0);
  });

  it("never cites an archived page, even when it would otherwise be the best match", () => {
    const archived = { ...pageWithBullets, archived_at: "2026-01-01T00:00:00.000Z" };
    const { insights } = localInsights({ pages: [archived], transcript, topic: "" });
    expect(insights.filter((i) => i.source.kind === "page")).toHaveLength(0);
  });
});

describe("speaker labels are not meeting content", () => {
  // A realistically labelled call-mode transcript: the capture layer writes
  // "You: " / "Others: " onto every line, and both the topic terms and the
  // page scoring tokenise on /[a-z0-9]{4,}/, which "others" clears. Left in,
  // it is the single most frequent token in any call-mode meeting by a wide
  // margin — so the topic came back literally as "others, …" and a page
  // whose only overlap with the room was that one word scored above zero.
  const labelled = [
    "Others: What is the status of the payments migration?",
    "You: The migration is close to done.",
    "Others: And the reconciliation work?",
    "You: Reconciliation is under an hour now.",
    "Others: Anything blocking the rollout?",
    "You: Rollout is on track.",
  ].join("\n");

  it("never lets a speaker label become a topic term", () => {
    // Mutation caught: feeding the raw transcript to buildTopic again.
    // "Others" occurs more often here than any real subject word does.
    const { topic } = localInsights({ pages: [], transcript: labelled, topic: "" });
    expect(topic.text).not.toMatch(/\bothers\b/i);
    expect(topic.text).not.toMatch(/\byou\b/i);
    // Positive control: the terms it DID pick are the room's actual subject,
    // so this is not passing merely because the topic came back empty.
    expect(topic.text).toMatch(/migration|reconciliation|rollout|payments/);
  });

  it("never surfaces a page whose only overlap with the room is a speaker label", () => {
    // Mutation caught: feeding the raw transcript to pageInsights. This page
    // shares not one subject word with the conversation — only the word
    // "others", which this app wrote onto the transcript itself. Surfacing it
    // as "worth pulling up here" would defeat the module's own stated rule
    // that a zero-overlap page is never cited.
    const labelOnlyPage = page({
      id: "pg-label",
      title: "Team retrospective",
      body: "Some people prefer pairing, others prefer working solo.",
    });
    const { insights } = localInsights({ pages: [labelOnlyPage], transcript: labelled, topic: "" });
    expect(insights.filter((i) => i.source.kind === "page")).toHaveLength(0);
  });
});

describe("the page the meeting was started from", () => {
  const transcript = "Are we still gated on the legacy payment processor migration?";

  const pinnedPage = page({
    id: "pg-pinned",
    title: "Vendor renewal",
    body: "- Renewal terms were agreed in January and run through the year.",
  });

  const matchingPage = page({
    id: "pg-match",
    title: "Payments Migration",
    body: "- Migrated billing off the legacy payment processor entirely.",
  });

  it("ranks it first, ahead of a page with better term overlap", () => {
    // The model path (lib/meeting/meetingContext.js) has always sorted the
    // pinned page first; the embedded path dropped it entirely, so the
    // embedded engine — and every degraded fallback, which runs through
    // localInsights too — ranked the user's own chosen page on word overlap
    // alone. Mutation caught: ignoring pinnedPageId here.
    const { insights } = localInsights({
      pages: [matchingPage, pinnedPage],
      transcript,
      topic: "",
      pinnedPageId: "pg-pinned",
    });
    const pageIds = insights.filter((i) => i.source.kind === "page").map((i) => i.source.pageId);
    expect(pageIds).toEqual(["pg-pinned", "pg-match"]);
  });

  it("keeps it even at zero overlap, unlike every other page", () => {
    // The zero-overlap filter exists because term overlap is a GUESS and a
    // page sharing no word with the room is a bad guess. The pin is not a
    // guess — the user chose that page by having it open — so it is the one
    // page exempt, exactly as buildMeetingContext treats it. Without the
    // exemption the most relevant thing on screen would be withheld for
    // precisely as long as the conversation had not yet said its words.
    const { insights } = localInsights({
      pages: [pinnedPage],
      transcript,
      topic: "",
      pinnedPageId: "pg-pinned",
    });
    expect(insights.filter((i) => i.source.pageId === "pg-pinned")).toHaveLength(1);

    // Positive control for the filter itself: the same page, unpinned, is
    // still not surfaced.
    const unpinned = localInsights({ pages: [pinnedPage], transcript, topic: "" });
    expect(unpinned.insights.filter((i) => i.source.kind === "page")).toHaveLength(0);
  });

  it("ignores a pinned id that names an archived or unknown page", () => {
    // A pin is a relevance signal, never an eligibility override — and a
    // stale id from a page deleted mid-meeting must not throw.
    const archived = { ...pinnedPage, archived_at: "2026-01-01T00:00:00.000Z" };
    expect(
      localInsights({ pages: [archived], transcript, topic: "", pinnedPageId: "pg-pinned" }).insights.filter(
        (i) => i.source.kind === "page",
      ),
    ).toHaveLength(0);
    expect(() =>
      localInsights({ pages: [matchingPage], transcript, topic: "", pinnedPageId: "pg-gone" }),
    ).not.toThrow();
  });
});

describe("unanswered questions raised in the room", () => {
  const question = "Are we still on track for the launch?";
  const longAnswer =
    "Yes, we finished the integration testing last week and the results looked good across every environment we checked.";

  it("flags a question with no reply at all", () => {
    const { insights } = localInsights({ pages: [], transcript: question, topic: "" });
    const questionInsights = insights.filter((i) => i.kind === "question");
    expect(questionInsights).toHaveLength(1);
    expect(questionInsights[0].text).toMatch(/track for the launch/i);
    expect(questionInsights[0].source).toEqual({ kind: "transcript", pageId: null, pageTitle: null });
  });

  it("does not flag a question a following turn actually answers", () => {
    const transcript = [question, longAnswer].join("\n");
    const { insights } = localInsights({ pages: [], transcript, topic: "" });
    expect(insights.filter((i) => i.kind === "question")).toHaveLength(0);
  });

  it("still flags it when the only reply is a brief acknowledgement, not an answer", () => {
    // Positive control for SUBSTANTIVE_REPLY_MIN_WORDS: a short reply landing
    // in the very next turn must NOT be mistaken for an answer just because
    // of its timing.
    const transcript = [question, "Yeah, sure."].join("\n");
    const { insights } = localInsights({ pages: [], transcript, topic: "" });
    expect(insights.filter((i) => i.kind === "question")).toHaveLength(1);
  });

  it("still flags it when the only substantive reply lands outside the answer window", () => {
    const transcript = [question, "Yeah.", "Maybe.", "Not sure.", longAnswer].join("\n");
    const { insights } = localInsights({ pages: [], transcript, topic: "" });
    // The long reply is 4 turns after the question; ANSWER_WINDOW_TURNS only
    // looks 3 turns ahead, so it must never be seen.
    expect(insights.filter((i) => i.kind === "question")).toHaveLength(1);
  });

  it("never attributes the question to a speaker", () => {
    const { insights } = localInsights({
      pages: [],
      transcript: "Others: What is our timeline for launch?",
      topic: "",
    });
    const [q] = insights.filter((i) => i.kind === "question");
    expect(q.text).not.toMatch(/others/i);
    expect(q.text).toMatch(/timeline for launch/i);
    expect(q.source).toEqual({ kind: "transcript", pageId: null, pageTitle: null });
  });
});

describe("the honesty boundary", () => {
  // THE invariant for this path, and the only one: it may never emit
  // `source.kind: "model"`. There is no model here, so claiming one composed
  // a line would be a straight falsehood — and `source` is the field that
  // makes a provenance claim at all.
  //
  // This replaced an older assertion that also banned `kind: "point"`. That
  // ban was a proxy for "never compose", and it was the wrong proxy: it
  // forced a verbatim quote of the user's own bullet to be labelled "Gap" on
  // screen. Quoting is not composing. `kind` describes what the insight is
  // FOR; `source` describes where it came from; only the second one is a
  // claim this path could lie about.
  //
  // One realistic fixture drives every emitting branch at once — a matching
  // page with bullets, a matching page without any, an archived page, an
  // unrelated page, two unanswered questions and one answered — so a mutation
  // that reached for source.kind:"model" ANYWHERE in the file (the tempting
  // shortcut when a page citation fails to resolve) fails here.
  const pages = [
    page({
      id: "pg-a",
      title: "Payments Migration",
      body: [
        "Intro paragraph with no bullet marker.",
        "- Migrated billing off the legacy payment processor entirely.",
        "- Cut reconciliation time to under an hour.",
      ].join("\n"),
    }),
    page({ id: "pg-c", title: "Client Feedback Notes", body: "A call about processor migration feedback." }),
    page({
      id: "pg-archived",
      title: "Old Payments Migration Draft",
      body: "- Legacy payment processor migration reconciliation rollout notes.",
      archived_at: "2026-01-01T00:00:00.000Z",
    }),
    page({ id: "pg-unrelated", title: "Random Notes", body: "Lunch plans and weekend logistics." }),
  ];
  const transcript = [
    "Are we still gated on the legacy payment processor migration?",
    "Yeah, sort of.",
    "Who owns the reconciliation work after the migration?",
    "Good point.",
    "Hmm.",
    "Right.",
    "Did the rollout actually finish last quarter?",
    "Yes, it wrapped up in March and every region has been migrated since then without incident.",
  ].join("\n");

  const run = () => localInsights({ pages, transcript, topic: "payments migration" });

  it("never claims authorship: source.kind is never \"model\", on any branch", () => {
    const { insights } = run();
    expect(insights.length).toBeGreaterThan(0);
    const citableIds = ["pg-a", "pg-c"];
    for (const insight of insights) {
      expect(insight.source.kind).not.toBe("model");
      // Stronger than the bare inequality: the ONLY two provenances this path
      // can honestly claim are "the user wrote it" and "the room said it".
      expect(["page", "transcript"]).toContain(insight.source.kind);
      if (insight.source.kind === "page") {
        // And a page citation always names a live page that was actually read
        // this call — never the archived one, never the unrelated one, never
        // an id from nowhere.
        expect(citableIds).toContain(insight.source.pageId);
      }
    }
  });

  it("drove every emitting branch in that one fixture", () => {
    // Guards the test above from silently weakening: if a future change made
    // one of these branches stop firing, the invariant assertion would still
    // pass while covering less. This fails instead.
    const { insights } = run();
    const quoted = insights.find((i) => i.text === "Migrated billing off the legacy payment processor entirely.");
    expect(quoted?.kind).toBe("point");
    expect(quoted?.source).toEqual({ kind: "page", pageId: "pg-a", pageTitle: "Payments Migration" });

    const named = insights.find((i) => i.source.pageId === "pg-c");
    expect(named?.kind).toBe("gap");

    // Two questions nobody answered inside the window; the third ("Did the
    // rollout actually finish last quarter?") gets a substantive reply on the
    // very next turn and must NOT be surfaced.
    const questions = insights.filter((i) => i.kind === "question");
    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.source.kind)).toEqual(["transcript", "transcript"]);
    expect(insights.some((i) => /rollout actually finish/i.test(i.text))).toBe(false);
  });

  it("keeps a page citation that a prompt budget would have dropped — it never sends a prompt", () => {
    // The regression this path exists for. A citation here is true BY
    // CONSTRUCTION: the text was read straight out of that page in this call.
    // Nothing downstream may re-check it against lib/meeting/meetingContext.js's
    // budget-constrained includedPageIds and downgrade it to
    // { kind: "model" } — that would tell the user a model invented a line
    // they wrote themselves. Pinned here as well as at the route so the
    // guarantee belongs to this module, not to one caller's restraint.
    const huge = page({
      id: "pg-huge",
      title: "Payments Migration Master Doc",
      body: ["- Migrated billing off the legacy payment processor entirely.", "filler ".repeat(2000)].join("\n"),
    });
    const { insights } = localInsights({
      pages: [huge],
      transcript: "Are we still gated on the legacy payment processor migration?",
      topic: "",
    });
    expect(insights[0].source).toEqual({
      kind: "page",
      pageId: "pg-huge",
      pageTitle: "Payments Migration Master Doc",
    });
  });
});

describe("knownInsightIds", () => {
  it("drops an insight the client already has on screen", () => {
    const call = (known) =>
      localInsights({ pages: [], transcript: "Are we still on track for the launch?", topic: "", knownInsightIds: known });

    const first = call([]);
    expect(first.insights).toHaveLength(1);
    const knownId = first.insights[0].id;

    const second = call([knownId]);
    expect(second.insights).toHaveLength(0);
  });
});

describe("defensive behavior", () => {
  it("never throws on missing or junk input, mid-meeting", () => {
    expect(() => localInsights({})).not.toThrow();
    expect(() => localInsights()).not.toThrow();
    expect(() =>
      localInsights({ pages: [null, 42, {}], transcript: null, topic: undefined, knownInsightIds: null }),
    ).not.toThrow();

    const result = localInsights({});
    expect(result.topic.text).toBe("");
    expect(result.topic.confidence).toBe("low");
    expect(result.insights).toEqual([]);
  });
});
