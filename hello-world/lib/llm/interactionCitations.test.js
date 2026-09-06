// The Interactions-surface extractor (W2 of the footnotes chunk).
//
// Google's `client.interactions.create` returns an `Interaction`, not the
// `generateContent` response this repo's other seven grounded call sites
// read. The two shapes must never be confused:
//
//   generateContent:  response.candidates[0].groundingMetadata.groundingChunks
//   Interaction:      interaction.steps[] -> model_output -> content[] -> annotations[]
//
// Two traps this file exists to catch, both measured against the installed
// `@google/genai` 2.6.0 `.d.ts` and Google's own documentation (see
// scratchpad/3b-gemini-grounding-facts.md and 3b-grounding-surfaces.md):
//
//   1. The wire is snake_case (`start_index` / `end_index`). Google's own
//      *newer*-surface sample reads `annotation.startIndex` (camelCase) —
//      wrong for this wire, and it fails SILENTLY: `"x".slice(undefined,
//      undefined)` returns the whole string instead of throwing.
//   2. The response is a five-level optional walk (steps -> model_output ->
//      content -> text -> annotations). A naive walk that returns `[]` on
//      any miss cannot be told apart from "the model found nothing" — the
//      exact defect this whole feature exists to fix, one surface later.
//      `interactionStageCounts` exists so the miss is visible at the level
//      it happened, not laundered into one indistinguishable empty array.
//
// This module does not decide whether an empty result is OK — that is a
// judgement `digestCitations.js` (a sibling W2 module) and the route make.
// It only has one job: report faithfully, and never let an absence at one
// level pass as a decision made at a level below it.

import { describe, it, expect } from "vitest";
import {
  interactionOutputText,
  extractCitationSources,
  interactionSearched,
  interactionTruncated,
  interactionStageCounts,
} from "./interactionCitations.js";

// ---------------------------------------------------------------------------
// Fixtures. Every fixture below is CONSTRUCTED from the documented wire shape
// (scratchpad/3b-grounding-surfaces.md Q1/Q2, cross-checked against
// node_modules/@google/genai/dist/genai.d.ts's `Interaction`, `ModelOutputStep`,
// `TextContent`, `URLCitation`, `GoogleSearchCallStep`) — none are captured
// from a live call; there is no GEMINI_API_KEY in this checkout.
// ---------------------------------------------------------------------------

// Not an Interaction at all: the shape `models.generateContent` returns.
// Has no `steps` key whatsoever — this is what a caller gets today if the
// migration to `interactions.create` were silently reverted underneath it.
const GENERATE_CONTENT_SHAPE = {
  candidates: [
    {
      content: { parts: [{ text: "Nimbus raised $80M." }] },
      groundingMetadata: { groundingChunks: [] },
    },
  ],
};

function modelOutputStep(content) {
  return { type: "model_output", content };
}

function textBlock(text, annotations) {
  const block = { type: "text", text };
  if (annotations !== undefined) block.annotations = annotations;
  return block;
}

function urlCitation({ url, title, start_index, end_index, ...extra }) {
  return { type: "url_citation", url, title, start_index, end_index, ...extra };
}

const SEARCH_CALL_STEP = {
  type: "google_search_call",
  call_id: "call_1",
  arguments: { queries: ["Nimbus funding round"] },
};

const SEARCH_RESULT_STEP = {
  type: "google_search_result",
  call_id: "call_1",
  result: [{ search_suggestions: "<div>rendered search suggestions</div>" }],
};

// Row 6 of AC-digest-footnotes.md's degenerate-shape table: a well-formed,
// non-empty Interaction. `output_text` is what the real SDK synthesises from
// the last `model_output` step's text (1b N3) — a hand-built fixture must set
// it explicitly since no real transport ran.
const REALISTIC_TEXT = "Nimbus raised $80M. It runs three depots.";
const REALISTIC_INTERACTION = {
  id: "interaction_1",
  created: "2026-09-05T00:00:00Z",
  updated: "2026-09-05T00:00:05Z",
  status: "completed",
  output_text: REALISTIC_TEXT,
  steps: [
    SEARCH_CALL_STEP,
    SEARCH_RESULT_STEP,
    modelOutputStep([
      textBlock(REALISTIC_TEXT, [
        urlCitation({
          url: "https://www.crunchbase.com/organization/nimbus",
          title: "crunchbase.com",
          start_index: 0,
          end_index: 20,
        }),
        urlCitation({
          url: "https://news.example.com/nimbus-depots",
          title: "news.example.com",
          start_index: 21,
          end_index: 42,
        }),
      ]),
    ]),
  ],
};

describe("interactionOutputText", () => {
  it("returns the real text of a well-formed, non-empty Interaction", () => {
    expect(interactionOutputText(REALISTIC_INTERACTION)).toBe(REALISTIC_TEXT);
  });

  it("throws a TypeError on a generateContent-shaped body (steps is not an array)", () => {
    expect(() => interactionOutputText(GENERATE_CONTENT_SHAPE)).toThrow(TypeError);
  });

  it("throws on null, undefined, and a bare object — never returns '' for any of them", () => {
    for (const bad of [null, undefined, {}, "a string", 42]) {
      expect(() => interactionOutputText(bad)).toThrow(TypeError);
    }
  });

  // The AC-digest-footnotes.md degenerate-shape table (§AC-F20 item 4), rows
  // 2-5: each is a REAL Interaction (Array.isArray(steps) === true) whose SDK
  // would omit `output_text` entirely, because `addOutputProperties` does
  // `Object.assign(..., (output_text && { output_text }), ...)` and an empty
  // string is falsy. `output_text === undefined` does NOT by itself mean "not
  // an Interaction" — these fixtures must throw for a DIFFERENT reason than
  // GENERATE_CONTENT_SHAPE does (that one fails the Array.isArray gate; these
  // pass it and fail only because there is no usable text), and either way
  // the function's promise is that it never hands back "".
  const emptyButRealInteractions = {
    "steps: []": { status: "completed", steps: [] },
    "model_output with empty text": {
      status: "completed",
      steps: [modelOutputStep([textBlock("")])],
    },
    "model_output with no content": {
      status: "completed",
      steps: [{ type: "model_output" }],
    },
    "only a google_search_call step": {
      status: "completed",
      steps: [SEARCH_CALL_STEP],
    },
  };
  for (const [label, interaction] of Object.entries(emptyButRealInteractions)) {
    it(`throws rather than returning "" for a real Interaction with no text (${label})`, () => {
      expect(Array.isArray(interaction.steps)).toBe(true); // sanity: this IS an Interaction
      expect(() => interactionOutputText(interaction)).toThrow(TypeError);
    });
  }

  it("never returns the empty string for ANY input — throw or a non-empty string, nothing between", () => {
    const allFixtures = [
      GENERATE_CONTENT_SHAPE,
      REALISTIC_INTERACTION,
      ...Object.values(emptyButRealInteractions),
    ];
    for (const fixture of allFixtures) {
      let result;
      try {
        result = interactionOutputText(fixture);
      } catch {
        continue; // throwing satisfies "never returns ''"
      }
      expect(result).not.toBe("");
      expect(typeof result).toBe("string");
    }
  });
});

describe("extractCitationSources — the snake_case trap", () => {
  it("reads start_index/end_index (snake_case) as startByte/endByte, verbatim", () => {
    expect(extractCitationSources(REALISTIC_INTERACTION)).toEqual([
      {
        uri: "https://www.crunchbase.com/organization/nimbus",
        title: "crunchbase.com",
        startByte: 0,
        endByte: 20,
      },
      {
        uri: "https://news.example.com/nimbus-depots",
        title: "news.example.com",
        startByte: 21,
        endByte: 42,
      },
    ]);
  });

  // The decisive discriminator: a decoy camelCase pair on the SAME annotation
  // object, with different (wrong) values. Google's own newer-surface sample
  // reads `annotation.startIndex`/`endIndex` — an implementation that copied
  // that sample would report 999/999 here instead of the real 5/9 the wire
  // actually sent. This is not reachable by an implementation that merely
  // forgets to convert case; it specifically catches reading the WRONG key.
  it("ignores a camelCase startIndex/endIndex decoy on the same annotation object", () => {
    const interaction = {
      status: "completed",
      output_text: "Acme is hiring.",
      steps: [
        modelOutputStep([
          textBlock("Acme is hiring.", [
            urlCitation({
              url: "https://acme.example/careers",
              title: "acme.example",
              start_index: 5,
              end_index: 9,
              startIndex: 999,
              endIndex: 999,
            }),
          ]),
        ]),
      ],
    };
    expect(extractCitationSources(interaction)).toEqual([
      { uri: "https://acme.example/careers", title: "acme.example", startByte: 5, endByte: 9 },
    ]);
  });

  it("returns [] gracefully on a generateContent-shaped body — never throws", () => {
    expect(extractCitationSources(GENERATE_CONTENT_SHAPE)).toEqual([]);
  });

  it("returns [] on null/undefined/non-object input — never throws", () => {
    for (const bad of [null, undefined, "x", 1, []]) {
      expect(extractCitationSources(bad)).toEqual([]);
    }
  });

  it("only extracts url_citation annotations, skipping other annotation types", () => {
    const interaction = {
      status: "completed",
      output_text: "See the office.",
      steps: [
        modelOutputStep([
          textBlock("See the office.", [
            { type: "file_citation", file_id: "f1" },
            { type: "place_citation", place_id: "p1" },
            urlCitation({
              url: "https://acme.example/office",
              title: "acme.example",
              start_index: 0,
              end_index: 15,
            }),
          ]),
        ]),
      ],
    };
    expect(extractCitationSources(interaction)).toEqual([
      { uri: "https://acme.example/office", title: "acme.example", startByte: 0, endByte: 15 },
    ]);
  });

  it("folds two model_output steps in order, and skips non-model_output steps", () => {
    const interaction = {
      status: "completed",
      output_text: "One. Two.",
      steps: [
        modelOutputStep([textBlock("One.", [urlCitation({ url: "https://a.example/1", title: "a.example", start_index: 0, end_index: 4 })])]),
        SEARCH_RESULT_STEP,
        modelOutputStep([textBlock("Two.", [urlCitation({ url: "https://b.example/2", title: "b.example", start_index: 0, end_index: 4 })])]),
      ],
    };
    expect(extractCitationSources(interaction)).toEqual([
      { uri: "https://a.example/1", title: "a.example", startByte: 0, endByte: 4 },
      { uri: "https://b.example/2", title: "b.example", startByte: 0, endByte: 4 },
    ]);
  });
});

describe("interactionSearched", () => {
  it("is true when a google_search_call step is present", () => {
    expect(interactionSearched(REALISTIC_INTERACTION)).toBe(true);
  });

  it("is false when there is no search step at all (AC-F13 (b))", () => {
    const interaction = {
      status: "completed",
      output_text: "Unsourced text.",
      steps: [modelOutputStep([textBlock("Unsourced text.")])],
    };
    expect(interactionSearched(interaction)).toBe(false);
  });

  it("is false for a generateContent-shaped body and other non-Interactions", () => {
    expect(interactionSearched(GENERATE_CONTENT_SHAPE)).toBe(false);
    expect(interactionSearched(null)).toBe(false);
    expect(interactionSearched(undefined)).toBe(false);
    expect(interactionSearched({})).toBe(false);
  });
});

describe("interactionTruncated", () => {
  it("is false when status is 'completed'", () => {
    expect(interactionTruncated({ status: "completed" })).toBe(false);
  });

  for (const status of ["incomplete", "failed", "cancelled", "in_progress", "requires_action", "budget_exceeded"]) {
    it(`is true when status is '${status}'`, () => {
      expect(interactionTruncated({ status })).toBe(true);
    });
  }

  it("is false (unknown, not asserted-truncated) when status is missing or not a string", () => {
    expect(interactionTruncated({})).toBe(false);
    expect(interactionTruncated({ status: null })).toBe(false);
    expect(interactionTruncated({ status: 42 })).toBe(false);
    expect(interactionTruncated(null)).toBe(false);
    expect(interactionTruncated(undefined)).toBe(false);
  });
});

describe("interactionStageCounts — distinguishing ABSENT from PRESENT-AND-EMPTY", () => {
  it("counts every level for a well-formed, fully-populated Interaction", () => {
    expect(interactionStageCounts(REALISTIC_INTERACTION)).toEqual({
      steps: 3,
      modelOutputSteps: 1,
      textBlocks: 1,
      annotations: 2,
    });
  });

  it("is all-zero for a generateContent-shaped body — absent at the top", () => {
    expect(interactionStageCounts(GENERATE_CONTENT_SHAPE)).toEqual({
      steps: 0,
      modelOutputSteps: 0,
      textBlocks: 0,
      annotations: 0,
    });
  });

  it("is all-zero and never throws for null/undefined/non-object input", () => {
    for (const bad of [null, undefined, "x", 1, []]) {
      expect(interactionStageCounts(bad)).toEqual({ steps: 0, modelOutputSteps: 0, textBlocks: 0, annotations: 0 });
    }
  });

  // PRESENT AND EMPTY: the walk reaches all the way to the annotations level.
  // The text block genuinely exists; annotations is genuinely absent/empty.
  // This is AC-F13 row (c) / 1b's row 1 — "Google's search returned no
  // citations that could be placed" — a legitimate, non-anomalous zero.
  it("reports textBlocks:1, annotations:0 when annotations key is ABSENT entirely (present-and-empty)", () => {
    const interaction = {
      status: "completed",
      output_text: "Nothing to cite.",
      steps: [SEARCH_CALL_STEP, modelOutputStep([textBlock("Nothing to cite.")])],
    };
    expect(interactionStageCounts(interaction)).toEqual({
      steps: 2,
      modelOutputSteps: 1,
      textBlocks: 1,
      annotations: 0,
    });
  });

  it("reports textBlocks:1, annotations:0 when annotations is an explicit empty array (present-and-empty)", () => {
    const interaction = {
      status: "completed",
      output_text: "Nothing to cite.",
      steps: [SEARCH_CALL_STEP, modelOutputStep([textBlock("Nothing to cite.", [])])],
    };
    expect(interactionStageCounts(interaction)).toEqual({
      steps: 2,
      modelOutputSteps: 1,
      textBlocks: 1,
      annotations: 0,
    });
  });

  // ABSENT / MALFORMED NESTING: the walk breaks BEFORE the annotations level.
  // A model_output step exists (so `modelOutputSteps` is non-zero) but its
  // `content` is not walkable, so no text block was ever found. This must be
  // numerically distinguishable from the two present-and-empty cases above:
  // there, textBlocks is 1; here, textBlocks is 0 despite a real
  // model_output step existing. That gap is the "which level ate it" report
  // the plan's observability invariant requires.
  it("reports modelOutputSteps:1, textBlocks:0 when content is not an array (malformed nesting)", () => {
    const interaction = {
      status: "completed",
      steps: [{ type: "model_output", content: "not-an-array" }],
    };
    expect(interactionStageCounts(interaction)).toEqual({
      steps: 1,
      modelOutputSteps: 1,
      textBlocks: 0,
      annotations: 0,
    });
  });

  it("reports modelOutputSteps:1, textBlocks:0 when content is present but has no text block", () => {
    const interaction = {
      status: "completed",
      steps: [modelOutputStep([{ type: "image", data: "..." }])],
    };
    expect(interactionStageCounts(interaction)).toEqual({
      steps: 1,
      modelOutputSteps: 1,
      textBlocks: 0,
      annotations: 0,
    });
  });

  it("reports modelOutputSteps:0 when there is no model_output step at all (search-call-only)", () => {
    expect(interactionStageCounts({ status: "completed", steps: [SEARCH_CALL_STEP] })).toEqual({
      steps: 1,
      modelOutputSteps: 0,
      textBlocks: 0,
      annotations: 0,
    });
  });

  it("counts ALL annotations received, before filtering to url_citation (matches citation_outcome.counts.annotations)", () => {
    // Mixed annotation types: extractCitationSources keeps only the one
    // url_citation, but the RAW count the vendor sent is 3 — that raw count,
    // not the filtered one, is what belongs beside `searched` in the outcome
    // record (§6 of the plan: "received from the vendor, BEFORE any of our
    // filtering").
    const interaction = {
      status: "completed",
      output_text: "See the office.",
      steps: [
        modelOutputStep([
          textBlock("See the office.", [
            { type: "file_citation", file_id: "f1" },
            { type: "place_citation", place_id: "p1" },
            urlCitation({ url: "https://acme.example/office", title: "acme.example", start_index: 0, end_index: 15 }),
          ]),
        ]),
      ],
    };
    const counts = interactionStageCounts(interaction);
    expect(counts.annotations).toBe(3);
    expect(extractCitationSources(interaction)).toHaveLength(1);
  });

  it("does not throw on garbage entries mixed into steps or content arrays", () => {
    const interaction = {
      status: "completed",
      steps: [null, undefined, 42, "x", { type: "model_output", content: [null, undefined, 1, textBlock("ok", [null, 1, "x"])] }],
    };
    expect(() => interactionStageCounts(interaction)).not.toThrow();
    expect(() => extractCitationSources(interaction)).not.toThrow();
    const counts = interactionStageCounts(interaction);
    expect(counts.modelOutputSteps).toBe(1);
    expect(counts.textBlocks).toBe(1);
    expect(counts.annotations).toBe(0); // the three garbage "annotations" are not usable annotation objects
    expect(extractCitationSources(interaction)).toEqual([]);
  });
});
