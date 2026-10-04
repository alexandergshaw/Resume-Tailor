// N105 Step 3b - the pure half of the Ideal chain: reading one stage's
// response and normalizing what it said. No client, no fetch.
//
// readStageText is the K7 / R-5 control: a stage is COMPLETE or it throws.
// The tests below drive it with hand-built response objects so each finish
// reason is its own row, including the one that matters most - a MAX_TOKENS
// stop whose text would otherwise have parsed as a plausible short document.

import { describe, it, expect } from "vitest";
import {
  normalizeAnalysis,
  normalizeDraft,
  parseStageJson,
  readStageText,
} from "./idealStageResult.js";
import { MAX_KEYWORDS, MAX_REQUIREMENTS } from "./idealChainConfig.js";

const response = (finishReason, text = '{"resultLines":["a"]}', extra = {}) => ({
  text,
  candidates: [{ finishReason }],
  ...extra,
});

describe("readStageText - only a STOP response is complete", () => {
  it("returns the trimmed text of a STOP response", () => {
    expect(readStageText(response("STOP", '  {"a":1}  '), "analysis")).toBe('{"a":1}');
  });

  it("rejects MAX_TOKENS even though its text is non-empty and would parse", () => {
    expect(() => readStageText(response("MAX_TOKENS", '{"resultLines":["a"]}'), "hypothetical")).toThrow(
      expect.objectContaining({ code: "truncated", stage: "hypothetical", name: "IdealChainError" }),
    );
  });

  it.each(["SAFETY", "RECITATION", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT"])(
    "rejects a %s stop",
    (reason) => {
      expect(() => readStageText(response(reason), "analysis")).toThrow(expect.objectContaining({ code: "stopped" }));
    },
  );

  it("rejects a candidate with no finish reason at all", () => {
    expect(() => readStageText({ text: "x", candidates: [{}] }, "analysis")).toThrow(
      expect.objectContaining({ code: "stopped" }),
    );
  });

  it("rejects a response with no candidate, naming the prompt-level block reason", () => {
    const blocked = { text: undefined, candidates: [], promptFeedback: { blockReason: "SAFETY" } };
    expect(() => readStageText(blocked, "read")).toThrow(
      expect.objectContaining({ code: "blocked", message: expect.stringContaining("SAFETY") }),
    );
    expect(() => readStageText(undefined, "read")).toThrow(expect.objectContaining({ code: "blocked" }));
  });

  it("rejects a STOP response whose text is blank or absent", () => {
    expect(() => readStageText(response("STOP", "  \n "), "analysis")).toThrow(expect.objectContaining({ code: "empty" }));
    expect(() => readStageText({ candidates: [{ finishReason: "STOP" }] }, "analysis")).toThrow(
      expect.objectContaining({ code: "empty" }),
    );
  });
});

describe("readStageText - the urlContext stage also checks the tool's retrieval status", () => {
  const withUrls = (statuses) =>
    response("STOP", "The posting text", {
      candidates: [
        {
          finishReason: "STOP",
          urlContextMetadata: { urlMetadata: statuses.map((s) => ({ retrievedUrl: "https://x.test", urlRetrievalStatus: s })) },
        },
      ],
    });

  it("rejects a read where no URL was retrieved, however fluent the text is", () => {
    for (const status of ["URL_RETRIEVAL_STATUS_ERROR", "URL_RETRIEVAL_STATUS_PAYWALL", "URL_RETRIEVAL_STATUS_UNSAFE"]) {
      expect(() => readStageText(withUrls([status]), "read", { urlRead: true })).toThrow(
        expect.objectContaining({ code: "empty", stage: "read" }),
      );
    }
  });

  it("accepts a read where at least one URL was retrieved", () => {
    expect(readStageText(withUrls(["URL_RETRIEVAL_STATUS_ERROR", "URL_RETRIEVAL_STATUS_SUCCESS"]), "read", { urlRead: true })).toBe(
      "The posting text",
    );
  });

  it("concludes nothing from absent metadata, and ignores the status outside the read stage", () => {
    expect(readStageText(response("STOP", "The posting text"), "read", { urlRead: true })).toBe("The posting text");
    expect(readStageText(withUrls(["URL_RETRIEVAL_STATUS_ERROR"]), "analysis")).toBe("The posting text");
  });
});

describe("parseStageJson", () => {
  it("parses strict JSON and refuses prose, with no regex rescue", () => {
    expect(parseStageJson('{"a":1}', "analysis")).toEqual({ a: 1 });
    expect(() => parseStageJson('Here you go: {"a":1}', "analysis")).toThrow(
      expect.objectContaining({ code: "unparseable", stage: "analysis" }),
    );
  });
});

describe("normalizeAnalysis", () => {
  const base = (patch) => ({ jobTitle: " Engineer ", companyName: "Acme", requirements: [], keywordMap: [], ...patch });

  it("mints ids itself, de-duplicates, drops malformed items, and defaults an unknown kind", () => {
    const out = normalizeAnalysis(
      base({
        requirements: [
          { text: "  Five years   of payments ", kind: "requirement" },
          { text: "five years of payments", kind: "preferred" }, // duplicate, different case/kind
          { text: "", kind: "tool" }, // blank
          null,
          { kind: "tool" }, // no text
          { text: "Knows Kubernetes", kind: "not-a-kind" },
          "Plain string item",
        ],
      }),
    );
    expect(out.postingAnalysis.requirements).toEqual([
      { id: "q1", text: "Five years of payments", kind: "requirement" },
      { id: "q2", text: "Knows Kubernetes", kind: "requirement" },
      { id: "q3", text: "Plain string item", kind: "requirement" },
    ]);
    expect(out.jobTitle).toBe("Engineer");
  });

  it("ignores model-supplied ids entirely", () => {
    const out = normalizeAnalysis(base({ requirements: [{ id: "evil", text: "A thing", kind: "tool" }] }));
    expect(out.postingAnalysis.requirements[0].id).toBe("q1");
  });

  it("orders the keyword map by priority, keeps ties in model order, and de-duplicates by keyword", () => {
    const out = normalizeAnalysis(
      base({
        requirements: [{ text: "r0", kind: "tool" }],
        keywordMap: [
          { keyword: "beta", section: "summary", priority: 2 },
          { keyword: "alpha", section: "headline", priority: 1, requirementIndex: 0 },
          { keyword: "gamma", section: "experience", priority: 2 },
          { keyword: "ALPHA", section: "summary", priority: 9 }, // duplicate
          { keyword: "delta", section: "nonsense", priority: 1 }, // unknown section
          { keyword: "", section: "summary", priority: 1 }, // blank
        ],
      }),
    );
    expect(out.keywordMap.entries.map((e) => e.keyword)).toEqual(["alpha", "beta", "gamma"]);
    expect(out.keywordMap.entries[0].requirementId).toBe("q1");
    expect(out.keywordMap.entries[1].requirementId).toBeNull();
  });

  it("maps a keyword's requirementIndex through de-duplication and dropped items", () => {
    const out = normalizeAnalysis(
      base({
        requirements: [
          { text: "", kind: "tool" }, // index 0, dropped
          { text: "Real one", kind: "tool" }, // index 1 -> q1
          { text: "real ONE", kind: "tool" }, // index 2, duplicate of q1
        ],
        keywordMap: [
          { keyword: "k1", section: "summary", priority: 1, requirementIndex: 2 },
          { keyword: "k2", section: "summary", priority: 2, requirementIndex: 0 },
        ],
      }),
    );
    expect(out.keywordMap.entries.map((e) => e.requirementId)).toEqual(["q1", null]);
  });

  it("bounds how much it hands on to the later prompts", () => {
    const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
    const out = normalizeAnalysis(
      base({
        requirements: many(MAX_REQUIREMENTS + 25, (i) => ({ text: `req ${i}`, kind: "tool" })),
        keywordMap: many(MAX_KEYWORDS + 25, (i) => ({ keyword: `kw${i}`, section: "summary", priority: i + 1 })),
      }),
    );
    expect(out.postingAnalysis.requirements).toHaveLength(MAX_REQUIREMENTS);
    expect(out.keywordMap.entries).toHaveLength(MAX_KEYWORDS);
  });

  it("fails the stage on a malformed envelope, not on a malformed item", () => {
    for (const bad of [null, [], "x", { requirements: [] }, { keywordMap: [] }, { requirements: {}, keywordMap: [] }]) {
      expect(() => normalizeAnalysis(bad)).toThrow(expect.objectContaining({ code: "invalid-shape" }));
    }
  });
});

describe("normalizeDraft", () => {
  it("joins the lines into result and fits to the slot count", () => {
    expect(normalizeDraft({ resultLines: ["a", "b", "c"] }, 3, "hypothetical")).toEqual({
      result: "a\nb\nc",
      resultLines: ["a", "b", "c"],
    });
    expect(normalizeDraft({ resultLines: ["a"] }, 3, "hypothetical").resultLines).toEqual(["a", "", ""]);
    expect(normalizeDraft({ resultLines: ["a", "b", "c", "d"] }, 2, "hypothetical").resultLines).toEqual(["a", "b"]);
  });

  it("rejects a missing list, a non-text line, and an all-blank draft", () => {
    expect(() => normalizeDraft({}, 3, "application-ready")).toThrow(
      expect.objectContaining({ code: "invalid-shape", stage: "application-ready" }),
    );
    expect(() => normalizeDraft(null, 3, "application-ready")).toThrow(expect.objectContaining({ code: "invalid-shape" }));
    expect(() => normalizeDraft({ resultLines: ["a", 7] }, 3, "application-ready")).toThrow(
      expect.objectContaining({ code: "invalid-shape" }),
    );
    expect(() => normalizeDraft({ resultLines: [" ", ""] }, 3, "application-ready")).toThrow(
      expect.objectContaining({ code: "empty" }),
    );
  });
});
