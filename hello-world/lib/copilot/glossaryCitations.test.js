// AC-R26, AC-R27, AC-R28 -- the per-block citation walk and the document it
// assembles.
//
// WHY THIS MODULE EXISTS AT ALL. `lib/llm/interactionCitations.js`'s
// `extractCitationSources` walks every step FORWARDS and flattens every block's
// annotations with NO per-block base offset, and the only text it offers a
// caller is `interaction.output_text`. The SDK builds that field
// (`addOutputProperties`, node/index.cjs:19018-19074) as a BACKWARDS,
// barrier-terminated scan: text emitted before a `google_search_call` is
// EXCLUDED, and several blocks are CONCATENATED. Annotation offsets are
// per-block. So joining vendor offsets to text through `output_text` resolves
// CLEANLY onto the WRONG text whenever a response has more than one text block
// or any text before its first search step -- which is the canonical grounded
// flow. Nothing is malformed, so no refusal rule and no stage count can see it.
//
// The fixtures below are documentation-derived, exactly as
// `interactionCitations.js:31-33` declares its own to be. What is NOT
// documentation-derived is the offset semantics: those were read out of the
// shipped bundle.

import { describe, it, expect } from "vitest";
import {
  extractCitationSourcesByBlock,
  assembleResearchDocument,
} from "./glossaryCitations.js";

const citation = (url, title, s, e) => ({
  type: "url_citation",
  url,
  title,
  start_index: s,
  end_index: e,
});

describe("extractCitationSourcesByBlock keeps the block association (AC-R26)", () => {
  it("returns one entry per text block, in walk order, each with only its own citations", () => {
    const interaction = {
      steps: [
        {
          type: "model_output",
          content: [
            { type: "text", text: "alpha", annotations: [citation("https://a.example/1", "A", 0, 5)] },
            { type: "text", text: "beta", annotations: [citation("https://b.example/2", "B", 0, 4)] },
          ],
        },
      ],
    };
    const blocks = extractCitationSourcesByBlock(interaction);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("alpha");
    expect(blocks[0].citations).toEqual([
      { uri: "https://a.example/1", title: "A", startByte: 0, endByte: 5 },
    ]);
    expect(blocks[1].text).toBe("beta");
    expect(blocks[1].citations).toEqual([
      { uri: "https://b.example/2", title: "B", startByte: 0, endByte: 4 },
    ]);
    // The whole point: block 1's citation is NOT visible on block 2.
    expect(blocks[1].citations).toHaveLength(1);
  });

  it("records the step index each block came from", () => {
    const interaction = {
      steps: [
        { type: "model_output", content: [{ type: "text", text: "pre", annotations: [] }] },
        { type: "google_search_call" },
        { type: "model_output", content: [{ type: "text", text: "post", annotations: [] }] },
      ],
    };
    expect(extractCitationSourcesByBlock(interaction).map((b) => b.stepIndex)).toEqual([0, 2]);
  });

  it("skips annotation types other than url_citation", () => {
    const interaction = {
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: "x",
              annotations: [
                { type: "file_citation", file_id: "f" },
                { type: "place_citation", place_id: "p" },
                citation("https://real.example/x", "R", 0, 1),
              ],
            },
          ],
        },
      ],
    };
    const [block] = extractCitationSourcesByBlock(interaction);
    expect(block.citations).toHaveLength(1);
    expect(block.citations[0].uri).toBe("https://real.example/x");
  });

  it("never throws, for any malformed input, and yields an empty walk instead", () => {
    // The same degradation contract `extractCitationSources` states for itself.
    // A THROW here would land on the harvest's catch and discard paid work.
    expect(extractCitationSourcesByBlock(null)).toEqual([]);
    expect(extractCitationSourcesByBlock(undefined)).toEqual([]);
    expect(extractCitationSourcesByBlock({})).toEqual([]);
    expect(extractCitationSourcesByBlock({ steps: "not an array" })).toEqual([]);
    expect(extractCitationSourcesByBlock({ steps: [{ type: "model_output", content: "str" }] })).toEqual([]);
    expect(
      extractCitationSourcesByBlock({
        steps: [{ type: "model_output", content: [{ type: "text", text: "t", annotations: "no" }] }],
      })[0].citations,
    ).toEqual([]);
  });

  it("carries a non-string block text through as an empty string rather than undefined", () => {
    const [block] = extractCitationSourcesByBlock({
      steps: [{ type: "model_output", content: [{ type: "text", annotations: [] }] }],
    });
    expect(block.text).toBe("");
  });

  it("reads snake_case offsets and NEVER a camelCase spelling", () => {
    // Google's own JS sample for this surface reads `annotation.startIndex`,
    // which the wire does not send. `"x".slice(undefined, undefined)` returns
    // the WHOLE STRING rather than throwing, so a camelCase read is silently
    // wrong rather than loud.
    const [block] = extractCitationSourcesByBlock({
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: "abc",
              annotations: [{ type: "url_citation", url: "https://x.example/", startIndex: 0, endIndex: 3 }],
            },
          ],
        },
      ],
    });
    expect(block.citations[0].startByte).toBeUndefined();
    expect(block.citations[0].endByte).toBeUndefined();
  });
});

describe("assembleResearchDocument states its join rule (AC-R27, AC-R28)", () => {
  it("joins blocks WITHIN one step with the empty string, as the SDK does", () => {
    const blocks = [
      { text: "one", stepIndex: 0, citations: [] },
      { text: "two", stepIndex: 0, citations: [] },
    ];
    const doc = assembleResearchDocument(blocks);
    expect(doc.text).toBe("onetwo");
    expect(doc.ranges).toEqual([[0, 3], [3, 6]]);
  });

  it("joins blocks BETWEEN steps with a newline", () => {
    const blocks = [
      { text: "one", stepIndex: 0, citations: [] },
      { text: "two", stepIndex: 2, citations: [] },
    ];
    const doc = assembleResearchDocument(blocks);
    expect(doc.text).toBe("one\ntwo");
    expect(doc.ranges).toEqual([[0, 3], [4, 7]]);
  });

  it("assembles the whole document so nothing straddling a boundary is lost", () => {
    // AC-R28. Parsing per block silently LOSES any definition that straddles a
    // block boundary -- the r5 author's own first draft reported 11 of 12.
    const blocks = [
      { text: "1. A property of an operation applied rep", stepIndex: 0, citations: [] },
      { text: "eatedly to a value with no further effect.", stepIndex: 0, citations: [] },
    ];
    const doc = assembleResearchDocument(blocks);
    expect(doc.text).toContain("applied repeatedly");
  });

  it("returns an empty document for an empty walk", () => {
    expect(assembleResearchDocument([])).toEqual({ text: "", ranges: [] });
  });
});
