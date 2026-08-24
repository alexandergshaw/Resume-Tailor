// The meeting copilot's shared contract: what an insight IS, how it is
// identified across reads, and — the load-bearing part — what may be claimed
// about where it came from.
//
// This module is wave 1 and lands alone because the insights route, the
// embedded no-LLM path and the client all normalize through it. The whole
// point is that the Gemini path and the deterministic path CANNOT drift on
// the rules below: both call the same functions.

import { describe, it, expect } from "vitest";
import {
  INSIGHT_KINDS,
  SOURCE_KINDS,
  MEETING_LABELS,
  MAX_INSIGHTS_PER_READ,
  meetingSpeakerLabel,
  insightId,
  normalizeTopic,
  normalizeInsights,
} from "./insightContract.js";

const included = ["p-1", "p-2"];
const opts = (over = {}) => ({ includedPageIds: included, knownInsightIds: [], ...over });

const raw = (over = {}) => ({
  text: "Ask whether the rollout is still gated on the legacy processor.",
  kind: "point",
  source: { kind: "model" },
  ...over,
});

describe("speaker labels", () => {
  it("renders the two structural streams and nothing for a shared room mic", () => {
    // "You" and "Others" are only honest where the split is STRUCTURAL - two
    // independent capture streams, your mic versus the call's audio. A single
    // in-person microphone has no such split, so it gets no label at all
    // rather than a guessed one.
    expect(meetingSpeakerLabel("you")).toBe("You");
    expect(meetingSpeakerLabel("them")).toBe("Others");
    expect(meetingSpeakerLabel("room")).toBe("");
  });

  it("says nothing for a speaker it does not recognise", () => {
    // Never invent a label. An unrecognised value must degrade to no chip,
    // not to "Them" or to the raw string leaking onto the screen.
    expect(meetingSpeakerLabel(undefined)).toBe("");
    expect(meetingSpeakerLabel("speaker_2")).toBe("");
    expect(meetingSpeakerLabel("")).toBe("");
  });

  it("exposes the mapping as data, keyed by the internal routing values", () => {
    // The keys stay "them"/"you" because that is what the capture layer emits
    // and this repo's session code routes on - they are routing keys, not
    // labels. The translation happens here, at the render boundary, exactly
    // once.
    expect(MEETING_LABELS).toEqual({ them: "Others", you: "You", room: "" });
  });
});

describe("insightId", () => {
  it("is stable for the same text across separate reads", () => {
    // Ids are what let the client accumulate insights over a meeting without
    // showing the same point twice, and what `knownInsightIds` sends back to
    // the server. A random id would defeat both.
    expect(insightId("Mention the latency budget")).toBe(insightId("Mention the latency budget"));
  });

  it("ignores case, surrounding whitespace and trailing punctuation", () => {
    // A model asked the same question twice will phrase it with trivial
    // differences. Those are the same point to a human, so they must be the
    // same id - otherwise the list fills with near-duplicates.
    const base = insightId("Mention the latency budget");
    expect(insightId("  mention the latency budget  ")).toBe(base);
    expect(insightId("Mention the latency budget.")).toBe(base);
  });

  it("separates genuinely different points", () => {
    // Positive control: an id function that collapsed everything to a
    // constant would satisfy every assertion above.
    expect(insightId("Mention the latency budget")).not.toBe(insightId("Mention the rollout plan"));
  });

  it("returns a non-empty string even for empty input", () => {
    expect(typeof insightId("")).toBe("string");
    expect(insightId("").length).toBeGreaterThan(0);
  });
});

describe("normalizeTopic", () => {
  it("reports the first topic of a meeting as changed", () => {
    const topic = normalizeTopic("Payments migration", "");
    expect(topic.text).toBe("Payments migration");
    expect(topic.changed).toBe(true);
  });

  it("does not report a re-statement of the same topic as a change", () => {
    // `changed` is computed HERE, by comparing normalized strings - never
    // asked of the model. A model asked "did the topic change?" will say yes
    // far too often, and the UI uses this to decide whether to draw
    // attention to a new topic.
    expect(normalizeTopic("Payments migration", "Payments migration").changed).toBe(false);
    expect(normalizeTopic("  payments   migration ", "Payments migration").changed).toBe(false);
  });

  it("reports a genuinely different topic as changed", () => {
    expect(normalizeTopic("Hiring plan for Q3", "Payments migration").changed).toBe(true);
  });

  it("clamps confidence to the allowed values", () => {
    expect(normalizeTopic("X", "", "high").confidence).toBe("high");
    expect(normalizeTopic("X", "", "medium").confidence).toBe("medium");
    // Anything the model invents falls back to the most modest claim, not the
    // boldest one.
    expect(normalizeTopic("X", "", "certain").confidence).toBe("low");
    expect(normalizeTopic("X", "").confidence).toBe("low");
  });

  it("treats a missing or unusable topic as no topic, and not as a change", () => {
    expect(normalizeTopic("", "Payments migration").text).toBe("");
    expect(normalizeTopic(null, "Payments migration").changed).toBe(false);
    expect(normalizeTopic(undefined, "").text).toBe("");
  });
});

describe("normalizeInsights - attribution", () => {
  it("keeps a page attribution when that page really was in this call's context", () => {
    const [insight] = normalizeInsights(
      [raw({ source: { kind: "page", pageId: "p-1", pageTitle: "Payments migration" } })],
      opts(),
    );
    expect(insight.source.kind).toBe("page");
    expect(insight.source.pageId).toBe("p-1");
    expect(insight.source.pageTitle).toBe("Payments migration");
  });

  it("DOWNGRADES a page attribution the model was never shown", () => {
    // THE LOAD-BEARING RULE. A model handed four pages will cheerfully cite a
    // fifth it remembers from earlier in the conversation, or invent a
    // plausible id. Letting that through puts "your page X says…" on screen
    // for a page that contributed nothing - the user cannot tell their own
    // notes from the model's invention, which is the entire point of showing
    // a source at all.
    const [insight] = normalizeInsights(
      [raw({ source: { kind: "page", pageId: "p-99", pageTitle: "Something else" } })],
      opts(),
    );
    expect(insight.source.kind).toBe("model");
    expect(insight.source.pageId).toBeNull();
    expect(insight.source.pageTitle).toBeNull();
  });

  it("keeps the insight itself when it downgrades the attribution", () => {
    // Deliberate: a mis-attributed point may still be a good thing to say.
    // What is not allowed is the false provenance, so the claim is stripped
    // and the text survives.
    const [insight] = normalizeInsights(
      [raw({ text: "Ask about the rollback plan", source: { kind: "page", pageId: "p-99" } })],
      opts(),
    );
    expect(insight.text).toBe("Ask about the rollback plan");
  });

  it("never lets a non-page source carry a page id", () => {
    // A model that returns `{ kind: "transcript", pageId: "p-1" }` is making a
    // page claim through the back door.
    const [insight] = normalizeInsights(
      [raw({ source: { kind: "transcript", pageId: "p-1", pageTitle: "Payments migration" } })],
      opts(),
    );
    expect(insight.source.kind).toBe("transcript");
    expect(insight.source.pageId).toBeNull();
    expect(insight.source.pageTitle).toBeNull();
  });

  it("treats an unrecognised source kind as the model's own", () => {
    const [insight] = normalizeInsights([raw({ source: { kind: "the internet" } })], opts());
    expect(insight.source.kind).toBe("model");
  });

  it("treats a missing source as the model's own", () => {
    const [insight] = normalizeInsights([raw({ source: undefined })], opts());
    expect(insight.source.kind).toBe("model");
    expect(insight.source.pageId).toBeNull();
  });
});

describe("normalizeInsights - shape and volume", () => {
  it("gives every insight a stable id derived from its text", () => {
    const [insight] = normalizeInsights([raw({ text: "Mention the latency budget" })], opts());
    expect(insight.id).toBe(insightId("Mention the latency budget"));
  });

  it("drops anything with no usable text", () => {
    const result = normalizeInsights(
      [raw({ text: "" }), raw({ text: "   " }), raw({ text: null }), raw({ text: "Real point" })],
      opts(),
    );
    expect(result.map((i) => i.text)).toEqual(["Real point"]);
  });

  it("drops an unrecognised insight kind rather than guessing one", () => {
    const result = normalizeInsights(
      [raw({ kind: "prophecy" }), raw({ text: "Kept", kind: "question" })],
      opts(),
    );
    expect(result.map((i) => i.text)).toEqual(["Kept"]);
  });

  it("de-duplicates within one read, keeping the first", () => {
    const result = normalizeInsights(
      [raw({ text: "Mention the latency budget" }), raw({ text: "mention the latency budget." })],
      opts(),
    );
    expect(result).toHaveLength(1);
  });

  it("drops anything the client already has on screen", () => {
    // This is what makes accumulation across a long meeting cheap, and it is
    // why the id has to survive rephrasing.
    const known = insightId("Mention the latency budget");
    const result = normalizeInsights(
      [raw({ text: "  Mention the latency budget  " }), raw({ text: "A new point" })],
      opts({ knownInsightIds: [known] }),
    );
    expect(result.map((i) => i.text)).toEqual(["A new point"]);
  });

  it("caps how many arrive from one read", () => {
    const many = Array.from({ length: 12 }, (_, i) => raw({ text: `Point number ${i}` }));
    expect(normalizeInsights(many, opts())).toHaveLength(MAX_INSIGHTS_PER_READ);
    expect(normalizeInsights(many, opts({ cap: 2 }))).toHaveLength(2);
  });

  it("survives a model returning something that is not a list at all", () => {
    // Every one of these is a real shape a model has returned in this repo
    // before; none may throw into a live meeting.
    expect(normalizeInsights(undefined, opts())).toEqual([]);
    expect(normalizeInsights(null, opts())).toEqual([]);
    expect(normalizeInsights("Ask about the rollout", opts())).toEqual([]);
    expect(normalizeInsights([null, undefined, 42], opts())).toEqual([]);
  });

  it("treats an empty included-page list as attributing nothing to a page", () => {
    // The embedded path and a KB with no matching pages both produce this.
    const [insight] = normalizeInsights(
      [raw({ source: { kind: "page", pageId: "p-1" } })],
      opts({ includedPageIds: [] }),
    );
    expect(insight.source.kind).toBe("model");
  });

  it("exposes its vocabularies as closed lists", () => {
    // Both are asserted exactly, not by length or by `toContain`: a lower
    // bound cannot detect an added value, and an added source kind is the one
    // direction this contract can go wrong.
    expect(INSIGHT_KINDS).toEqual(["point", "question", "gap"]);
    expect(SOURCE_KINDS).toEqual(["page", "attachment", "transcript", "model"]);
  });
});
