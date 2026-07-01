import { describe, it, expect } from "vitest";
import { summarize, splitSentences, rankSentences } from "./summarize.js";

describe("splitSentences", () => {
  it("splits on sentence boundaries without breaking intra-word dots", () => {
    expect(splitSentences("We use Node.js here. It scales well.")).toEqual([
      "We use Node.js here.",
      "It scales well.",
    ]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("keeps a $ amount attached to its sentence", () => {
    const s = splitSentences("Acme raised $50M. Growth continued.");
    expect(s).toHaveLength(2);
    expect(s[0]).toContain("$50M");
  });
});

describe("summarize", () => {
  it("returns the text unchanged when already short enough", () => {
    expect(summarize("One sentence only.", { maxSentences: 3 })).toBe("One sentence only.");
    expect(summarize("", { maxSentences: 3 })).toBe("");
  });

  it("selects the sentences carrying the document's frequent terms", () => {
    const text = [
      "Welcome to our site.", // filler
      "The company builds data pipelines for analytics.",
      "These data pipelines process analytics events at scale.", // most on-topic
      "Please accept cookies.", // filler
    ].join(" ");
    const out = summarize(text, { maxSentences: 2 });
    expect(out).toContain("data pipelines");
    expect(out).not.toContain("cookies");
  });

  it("preserves original sentence order in the output", () => {
    const text =
      "Analytics is central here. Filler line about nothing. We scale analytics pipelines with analytics tooling.";
    const out = summarize(text, { maxSentences: 2 });
    expect(out.indexOf("Analytics is central")).toBeLessThan(out.indexOf("We scale analytics"));
  });

  it("steers selection toward the query", () => {
    const text = [
      "The team values collaboration and mentorship every day.",
      "Filler sentence with generic words here.",
      "We deploy Kubernetes clusters across multiple regions.",
    ].join(" ");
    const withQuery = summarize(text, { maxSentences: 1, query: "kubernetes deployment" });
    expect(withQuery).toContain("Kubernetes");
  });

  it("is deterministic", () => {
    const text = "Alpha beta gamma delta. Beta gamma delta epsilon. Gamma delta epsilon zeta.";
    expect(summarize(text, { maxSentences: 2 })).toBe(summarize(text, { maxSentences: 2 }));
  });
});

describe("rankSentences", () => {
  it("ranks the most significant sentence first", () => {
    const ranked = rankSentences(
      "Hello there friend. Data engineering and data pipelines power our data platform.",
    );
    expect(ranked[0].sentence).toContain("Data engineering");
  });
});
