// N157 SC-gen -- the parts of studyPlanGenerate.js that studyPlanGenerate.test.js
// does not reach: the deterministic embedded builder, and how a model reply is
// SHAPED before normalizePlan sees it (citation filtering, dedupe, provenance).
// These pin behaviour the implementation chose beyond the landed tests, so a
// change to any of them is a visible edit here.

import { describe, it, expect, vi } from "vitest";
import { buildEmbeddedStudyPlan, generateStudyPlan } from "@/lib/studyPlan/studyPlanGenerate.js";
import { itemKey } from "@/lib/studyPlan/studyPlanSchema.js";

const URL_A = "https://www.reuters.com/business/acme";
const APP_ID = "22222222-2222-2222-2222-222222222222";

function evidence(markdown, overrides = {}) {
  return {
    complete: true,
    researchedAt: "2026-09-01T00:00:00.000Z",
    postingFingerprint: "fp",
    items: [{ topicHint: "", text: markdown, citations: [{ url: URL_A }], sourced: true }],
    reason: null,
    ...overrides,
  };
}

const textsOf = (topic) => topic.items.map((i) => i.text);
const allItems = (plan) => plan.modules.flatMap((m) => m.topics.flatMap((t) => t.items));

describe("buildEmbeddedStudyPlan -- deterministic, mechanical cards", () => {
  const MD = ["Intro line about Acme.", "", "## Products", "- Warehouse robots", "- Cold-storage depots", "", "---", "", "## Culture", "1. Ships weekly"].join("\n");

  it("makes a topic per heading and a card per line, dropping list markers and rules", () => {
    const plan = buildEmbeddedStudyPlan(evidence(MD), {});
    expect(plan.engine).toBe("embedded");
    expect(plan.modules).toHaveLength(1);
    const topics = plan.modules[0].topics;
    expect(topics.map((t) => t.title)).toEqual(["Research notes", "Products", "Culture"]);
    expect(topics.map(textsOf)).toEqual([["Intro line about Acme."], ["Warehouse robots", "Cold-storage depots"], ["Ships weekly"]]);
  });

  it("gives each card its content-derived key and the citations of the evidence it came from", () => {
    const plan = buildEmbeddedStudyPlan(evidence(MD), {});
    for (const item of allItems(plan)) {
      expect(item.id).toBe(itemKey(item));
      expect(item.citations).toEqual([{ url: URL_A }]);
      expect(item.sourced).toBe(true);
    }
    expect(plan.provenance).toEqual({ research: "complete", unsourcedTopicIds: [] });
  });

  it("flags every topic unsourced and the research partial when the evidence has no citations", () => {
    const plan = buildEmbeddedStudyPlan(
      evidence(MD, {
        complete: false,
        reason: "unsourced",
        items: [{ topicHint: "", text: MD, citations: [], sourced: false }],
      }),
      {},
    );
    expect(plan.provenance.research).toBe("partial");
    expect(plan.provenance.unsourcedTopicIds).toEqual(plan.modules[0].topics.map((t) => t.id));
    expect(plan.provenance.unsourcedTopicIds.length).toBeGreaterThan(0);
  });

  it("spreads new and review cards by newReviewRatio", () => {
    const lines = ["alpha one", "bravo two", "charlie three", "delta four"].join("\n");
    const kinds = (ratio) => allItems(buildEmbeddedStudyPlan(evidence(lines), { newReviewRatio: ratio })).map((i) => i.kind);
    expect(kinds(0.5)).toEqual(["new", "review", "new", "review"]);
    expect(kinds(1)).toEqual(["new", "new", "new", "new"]);
    expect(kinds(0)).toEqual(["review", "review", "review", "review"]);
  });

  it("leaves out a section whose heading matches an excluded area, ignoring case", () => {
    const plan = buildEmbeddedStudyPlan(evidence(MD), { topicScope: { excludedAreas: ["PRODUCTS"] } });
    expect(plan.modules[0].topics.map((t) => t.title)).toEqual(["Research notes", "Culture"]);
  });

  it("collapses a repeated line to one card", () => {
    const plan = buildEmbeddedStudyPlan(evidence("same fact\nsame fact\nother fact"), {});
    expect(allItems(plan).map((i) => i.text)).toEqual(["same fact", "other fact"]);
  });

  it("bounds the number of cards", () => {
    const many = Array.from({ length: 100 }, (_, i) => `fact number ${i}`).join("\n");
    expect(allItems(buildEmbeddedStudyPlan(evidence(many), {}))).toHaveLength(60);
  });

  it("returns a plan with no modules when there is nothing to build from", () => {
    expect(buildEmbeddedStudyPlan(evidence("", { items: [] }), {}).modules).toEqual([]);
    expect(buildEmbeddedStudyPlan(null, {}).modules).toEqual([]);
  });
});

describe("a model reply is shaped before it is normalized", () => {
  function supabaseDouble() {
    const store = new Map();
    const client = {
      from() {
        return {
          upsert(row) {
            store.set(row.application_id, { ...(store.get(row.application_id) || {}), ...row });
            return { select: () => ({ maybeSingle: async () => ({ data: store.get(row.application_id), error: null }) }) };
          },
        };
      },
    };
    return { store, client };
  }

  const readDigest = async () => ({ status: "ready", markdown: "## Acme\n\nBuilds robots.", researched_at: "2026-09-01T00:00:00.000Z", sources: [{ url: URL_A }] });

  async function run(modules) {
    const { store, client } = supabaseDouble();
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ modules }) }));
    await generateStudyPlan({
      supabase: client, readDigest, generateContent, model: "m", engine: "gemini",
      applicationId: APP_ID, userId: "u", company: "Acme", role: "Engineer", postingFingerprint: "fp", knobs: {},
    });
    return store.get(APP_ID).plan;
  }

  it("keeps a citation that came from the evidence and drops one the model made up", async () => {
    const plan = await run([
      {
        title: "M",
        topics: [
          { title: "Cited", area: "a", items: [{ text: "Q1", citations: [{ url: URL_A }, { url: "https://evil.example/invented" }] }] },
          { title: "Invented only", area: "b", items: [{ text: "Q2", citations: [{ url: "https://evil.example/invented" }] }] },
        ],
      },
    ]);
    const [cited, invented] = plan.modules[0].topics;
    expect(cited.items[0].citations).toEqual([{ url: URL_A }]);
    expect(cited.items[0].sourced).toBe(true);
    expect(invented.items[0].citations).toEqual([]);
    expect(invented.items[0].sourced).toBe(false);
    expect(plan.provenance.unsourcedTopicIds).toEqual([invented.id]);
    expect(plan.provenance.research).toBe("complete");
  });

  it("collapses two cards with one content key and prunes empty topics and modules", async () => {
    const plan = await run([
      { title: "M", topics: [{ title: "T", area: "a", items: [{ text: "Same", topicHint: "h" }, { text: "Same", topicHint: "h" }, { text: "  " }] }, { title: "Empty", items: [] }] },
      { title: "Hollow", topics: [] },
    ]);
    expect(plan.modules).toHaveLength(1);
    expect(plan.modules[0].topics).toHaveLength(1);
    expect(plan.modules[0].topics[0].items).toHaveLength(1);
  });

  it("gives an untitled topic a title taken from its content, so two do not share one id", async () => {
    const plan = await run([
      { title: "M", topics: [{ items: [{ text: "First card", topicHint: "alpha" }] }, { items: [{ text: "Second card", topicHint: "beta" }] }] },
    ]);
    const [first, second] = plan.modules[0].topics;
    expect(first.title).toBe("alpha");
    expect(second.title).toBe("beta");
    expect(first.id).not.toBe(second.id);
  });
});
