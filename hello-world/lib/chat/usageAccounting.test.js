// THE INSTRUMENT'S OWN TESTS.
//
// Nothing in this repo read `usageMetadata` before this module existed (grepped
// at HEAD 9c27a63: zero hits outside node_modules), so no model call in the app
// could be costed. That is what makes the other two findings in this area
// arguable rather than measurable, and it is why this module landed first.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: a failed instrument is INVALID,
// never its zero value. A missing `usageMetadata` must not read as "this turn
// cost 0 tokens" -- that is a number a developer would believe, and it is the
// single most expensive way this module could be wrong. Absent is `null`;
// a real zero from the provider stays `0`. The two are never conflated, in the
// record OR in the rendered line.

import { describe, it, expect } from "vitest";
import { readUsageTokens, summarizeContextChars, formatUsageLogLine } from "./usageAccounting.js";

// The field list, read off the module's REAL OUTPUT rather than off an exported
// constant -- a constant asserted against itself proves nothing about what the
// reader actually populates. Pinned against @google/genai's
// `GenerateContentResponseUsageMetadata`
// (node_modules/@google/genai/dist/genai.d.ts). `cachedContentTokenCount` is on
// the list deliberately: it is the field a prompt-caching change would move,
// and a cost readout that cannot show it cannot show the saving.
const EXPECTED_FIELDS = [
  "promptTokenCount",
  "cachedContentTokenCount",
  "candidatesTokenCount",
  "thoughtsTokenCount",
  "toolUsePromptTokenCount",
  "totalTokenCount",
];

// ---------------------------------------------------------------------------
// readUsageTokens -- absent vs. zero
// ---------------------------------------------------------------------------

describe("readUsageTokens: absent is null, zero is zero", () => {
  it("returns null when the response carries no usage metadata at all", () => {
    // The shape every existing test in this area mocks: `{ text: "ok" }`.
    expect(readUsageTokens({ text: "ok" })).toBeNull();
    expect(readUsageTokens(undefined)).toBeNull();
    expect(readUsageTokens(null)).toBeNull();
    expect(readUsageTokens({ usageMetadata: null })).toBeNull();
    expect(readUsageTokens({ usageMetadata: "42" })).toBeNull();
  });

  it("returns null when usageMetadata exists but carries no usable number", () => {
    // A present-but-empty instrument is still a failed instrument. Returning
    // a record of six nulls here would let a caller render "0" six times.
    expect(readUsageTokens({ usageMetadata: {} })).toBeNull();
    expect(readUsageTokens({ usageMetadata: { promptTokenCount: "1200" } })).toBeNull();
    expect(readUsageTokens({ usageMetadata: { promptTokenCount: NaN } })).toBeNull();
    expect(readUsageTokens({ usageMetadata: { promptTokenCount: Infinity } })).toBeNull();
    expect(readUsageTokens({ usageMetadata: { promptTokenCount: -5 } })).toBeNull();
  });

  it("keeps a REAL zero as 0 -- this is the case the null rule must not eat", () => {
    // `cachedContentTokenCount: 0` is the provider saying "nothing was served
    // from cache", which is a measurement. It must survive as 0 while the
    // fields the provider did not report stay null.
    const tokens = readUsageTokens({
      usageMetadata: { promptTokenCount: 26_000, cachedContentTokenCount: 0 },
    });
    expect(tokens).not.toBeNull();
    expect(tokens.promptTokenCount).toBe(26_000);
    expect(tokens.cachedContentTokenCount).toBe(0);
    expect(tokens.candidatesTokenCount).toBeNull();
    expect(tokens.totalTokenCount).toBeNull();
  });

  it("reads a full metadata object field for field", () => {
    const tokens = readUsageTokens({
      usageMetadata: {
        promptTokenCount: 26_412,
        cachedContentTokenCount: 24_000,
        candidatesTokenCount: 180,
        thoughtsTokenCount: 64,
        toolUsePromptTokenCount: 0,
        totalTokenCount: 26_656,
        // Not a token count; must not leak into the record.
        promptTokensDetails: [{ modality: "TEXT", tokenCount: 26_412 }],
      },
    });
    expect(tokens).toEqual({
      promptTokenCount: 26_412,
      cachedContentTokenCount: 24_000,
      candidatesTokenCount: 180,
      thoughtsTokenCount: 64,
      toolUsePromptTokenCount: 0,
      totalTokenCount: 26_656,
    });
    expect(Object.keys(tokens)).toEqual(EXPECTED_FIELDS);
  });

  it("never throws on a hostile response object", () => {
    const hostile = {
      get usageMetadata() {
        throw new Error("boom");
      },
    };
    expect(() => readUsageTokens(hostile)).not.toThrow();
    expect(readUsageTokens(hostile)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// summarizeContextChars -- what the re-sent context is actually made of
// ---------------------------------------------------------------------------

describe("summarizeContextChars: which section the prompt is actually made of", () => {
  it("totals the sections and names the dominant one with its share", () => {
    // The measured profile that started this work: a 4 KB resume, 25
    // applications, one pinned posting. `applications` is the section that
    // dominates, and the summary has to SAY so -- a total alone cannot start
    // an argument about what to cut.
    const summary = summarizeContextChars([
      { id: "pinnedContext", chars: 2_100 },
      { id: "resumeText", chars: 4_096 },
      { id: "applications", chars: 96_956 },
    ]);
    expect(summary.totalChars).toBe(103_152);
    expect(summary.bySection).toEqual({
      pinnedContext: 2_100,
      resumeText: 4_096,
      applications: 96_956,
    });
    expect(summary.largest.id).toBe("applications");
    expect(summary.largest.chars).toBe(96_956);
    // 96,956 / 103,152 = 93.99%, reported to one decimal place.
    expect(summary.largest.pct).toBe(94);
  });

  it("returns a zero total and NO largest for an empty context", () => {
    // Zero sections is a real, reachable state (a signed-in user with no
    // resume, no applications and nothing pinned) -- not a failed measurement,
    // so 0 is the honest answer here and `largest` is null because there is no
    // section to name, not because the instrument broke.
    const summary = summarizeContextChars([]);
    expect(summary.totalChars).toBe(0);
    expect(summary.bySection).toEqual({});
    expect(summary.largest).toBeNull();
  });

  it("ignores junk entries rather than counting them as zero-length sections", () => {
    const summary = summarizeContextChars([
      null,
      { id: "applications", chars: 10 },
      { id: "", chars: 99 },
      { id: "resumeText", chars: "40" },
      { chars: 7 },
    ]);
    expect(summary.totalChars).toBe(10);
    expect(summary.bySection).toEqual({ applications: 10 });
  });

  it("never throws on a non-array", () => {
    expect(() => summarizeContextChars(undefined)).not.toThrow();
    expect(summarizeContextChars("nope").totalChars).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatUsageLogLine -- the developer-readable line
// ---------------------------------------------------------------------------

describe("formatUsageLogLine: the line a developer reads in the server log", () => {
  const context = summarizeContextChars([
    { id: "resumeText", chars: 4_096 },
    { id: "applications", chars: 96_956 },
  ]);

  it("prints the token counts, the context total, and the dominant section", () => {
    const line = formatUsageLogLine({
      model: "gemini-2.5-flash",
      tokens: {
        promptTokenCount: 26_412,
        cachedContentTokenCount: 0,
        candidatesTokenCount: 180,
        thoughtsTokenCount: null,
        toolUsePromptTokenCount: null,
        totalTokenCount: 26_592,
      },
      context,
      transcriptChars: 1_024,
    });
    expect(line.startsWith("[chat] usage ")).toBe(true);
    expect(line).toContain("model=gemini-2.5-flash");
    expect(line).toContain("prompt=26412");
    expect(line).toContain("cached=0");
    expect(line).toContain("output=180");
    expect(line).toContain("total=26592");
    expect(line).toContain("contextChars=101052");
    expect(line).toContain("transcriptChars=1024");
    expect(line).toContain("applications=96956");
    expect(line).toContain("largest=applications");
    // One line, so it survives a log aggregator that splits on newlines.
    expect(line).not.toContain("\n");
  });

  it("says UNAVAILABLE, and prints no token number at all, when the instrument failed", () => {
    // THE headline rule. If this line ever renders `prompt=0` for a response
    // that carried no usageMetadata, every cost conversation downstream of it
    // starts from a fabricated number.
    const line = formatUsageLogLine({
      model: "gemini-2.5-flash",
      tokens: null,
      context,
      transcriptChars: 1_024,
    });
    expect(line).toContain("tokens=unavailable");
    expect(line).not.toMatch(/\bprompt=/);
    expect(line).not.toMatch(/\bcached=/);
    expect(line).not.toMatch(/\btotal=/);
    // The context measurement is OURS and did not fail, so it is still printed.
    expect(line).toContain("contextChars=101052");
  });

  it("prints n/a, never 0, for a field the provider omitted", () => {
    const line = formatUsageLogLine({
      model: "m",
      tokens: {
        promptTokenCount: 100,
        cachedContentTokenCount: null,
        candidatesTokenCount: null,
        thoughtsTokenCount: null,
        toolUsePromptTokenCount: null,
        totalTokenCount: null,
      },
      context: summarizeContextChars([]),
      transcriptChars: 0,
    });
    expect(line).toContain("prompt=100");
    expect(line).toContain("cached=n/a");
    expect(line).toContain("output=n/a");
    expect(line).toContain("total=n/a");
    expect(line).not.toContain("cached=0");
    expect(line).not.toContain("total=0");
  });

  it("never throws on missing arguments", () => {
    expect(() => formatUsageLogLine({})).not.toThrow();
    expect(() => formatUsageLogLine()).not.toThrow();
    expect(formatUsageLogLine()).toContain("[chat] usage ");
  });
});
