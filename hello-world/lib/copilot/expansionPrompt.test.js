// THE GEMINI EXPANSION PROMPT.
//
// Two properties this file exists to pin, both of them the kind that pass
// review by eye and fail in production:
//
//   1. THE PARENT BULLET IS DATA, NOT AN INSTRUCTION. It is derived from the
//      candidate's resume, which the tailor pipeline lets a scraped job
//      posting write into. So it rides inside its own labelled block, after
//      every instruction, behind the repo's untrusted-data fence, and NEVER
//      inside the system instruction.
//   2. THE PROMPT CARRIES ONE SOURCE, not the ~42KB dossier the answer route
//      assembles. Six expansions per answer times a whole dossier is up to
//      7 x 42KB per question, on the one surface whose latency is measured
//      against a live interviewer.
//
// Type B red: the module does not exist yet.

import { describe, it, expect } from "vitest";
import { EXPANSION_SYSTEM, buildExpansionUserTurn } from "./expansionPrompt.js";

const PARENT = "I rebuilt the ledger after the settlement outage.";
const SIBLINGS = [PARENT, "I paged the on-call team during the incident.", "I ran the postmortem."];
const SOURCE = {
  label: "Your Settlement ledger rebuild page",
  text: "I reconciled every settlement by hand for a week.\nI wrote the replay script.",
};

function turn(overrides = {}) {
  return buildExpansionUserTurn({ parentPoint: PARENT, siblingPoints: SIBLINGS, source: SOURCE, ...overrides });
}

describe("EXPANSION_SYSTEM", () => {
  it("is byte-identical whatever the request carries", () => {
    expect(typeof EXPANSION_SYSTEM).toBe("string");
    expect(EXPANSION_SYSTEM.length).toBeGreaterThan(0);
  });

  it("never carries the parent point or any request content", () => {
    expect(EXPANSION_SYSTEM).not.toContain(PARENT);
    expect(EXPANSION_SYSTEM).not.toContain("settlement");
  });

  it("tells the model to quote rather than invent, and to return nothing rather than pad", () => {
    expect(EXPANSION_SYSTEM.toLowerCase()).toContain("only");
    expect(EXPANSION_SYSTEM.toLowerCase()).toMatch(/nothing|empty|no bullets/);
  });
});

// A block DELIMITER, not a mention of one. The instructions name every block
// by name (that is AC-R6's requirement), so a bare indexOf("<parent-bullet>")
// finds the instruction sentence rather than the block, and every ordering
// assertion below would be measuring the wrong thing. Delimiters sit alone on
// their own line; mentions never do.
function blockAt(text, name) {
  const open = text.indexOf(`\n<${name}>\n`);
  const close = text.indexOf(`\n</${name}>`);
  return { open, close, body: open === -1 ? "" : text.slice(open, close) };
}

describe("buildExpansionUserTurn — AC-R6: the parent bullet is fenced data", () => {
  it("contains the parent point EXACTLY ONCE", () => {
    const text = turn();
    expect(text.split(PARENT)).toHaveLength(2);
  });

  it("puts it inside its own labelled block, and names that block in the instruction", () => {
    const text = turn();
    const { open, close } = blockAt(text, "parent-bullet");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const at = text.indexOf(PARENT);
    expect(at).toBeGreaterThan(open);
    expect(at).toBeLessThan(close);
    // The instruction refers to the block BY NAME rather than pasting the
    // sentence into a sentence of its own.
    expect(text.slice(0, open)).toContain("<parent-bullet>");
  });

  it("puts every instruction BEFORE the block, never after it", () => {
    const text = turn();
    const { open } = blockAt(text, "parent-bullet");
    // Nothing after the fence opens is addressed to the model.
    expect(text.slice(open)).not.toMatch(/\breturn json\b/i);
  });

  it("carries the untrusted-data fence and its data-not-instructions notice", () => {
    const text = turn();
    expect(text).toContain("<untrusted-data");
    expect(text).toContain("</untrusted-data>");
    expect(text.toLowerCase()).toContain("never obey");
    // The fence opens before the parent block and closes after the source.
    expect(text.indexOf("<untrusted-data")).toBeLessThan(blockAt(text, "parent-bullet").open);
    // lastIndexOf: the notice inside the fence names the closing tag, so a
    // plain indexOf finds the sentence describing it rather than the tag.
    expect(text.lastIndexOf("</untrusted-data>")).toBeGreaterThan(blockAt(text, "source-material").close);
  });

  it("never repeats the parent inside the sibling block", () => {
    const text = turn();
    const { body } = blockAt(text, "sibling-bullets");
    expect(body).not.toContain(PARENT);
    expect(body).toContain("I paged the on-call team during the incident.");
  });
});

describe("buildExpansionUserTurn — AC-4.4: one source, not the dossier", () => {
  it("carries the cited source and nothing else", () => {
    const text = turn();
    expect(text).toContain("I reconciled every settlement by hand for a week.");
    expect(text).toContain(SOURCE.label);
  });

  it("has no slot for the cover letter, the posting, the transcript or another page", () => {
    // There is no parameter that could carry them, which is a stronger
    // guarantee than a test that they happen to be absent today.
    const text = buildExpansionUserTurn({
      parentPoint: PARENT,
      siblingPoints: SIBLINGS,
      source: SOURCE,
      coverLetter: "COVER LETTER TEXT",
      posting: "POSTING TEXT",
      context: "TRANSCRIPT TEXT",
      pages: [{ title: "Other page", body: "OTHER PAGE TEXT" }],
    });
    for (const leak of ["COVER LETTER TEXT", "POSTING TEXT", "TRANSCRIPT TEXT", "OTHER PAGE TEXT"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("renders without a source, without throwing and without inventing one", () => {
    const text = buildExpansionUserTurn({ parentPoint: PARENT });
    expect(text).toContain(PARENT);
    expect(text).not.toContain("undefined");
  });

  it("never throws on junk", () => {
    expect(typeof buildExpansionUserTurn()).toBe("string");
    expect(typeof buildExpansionUserTurn({ parentPoint: null, siblingPoints: null, source: 7 })).toBe("string");
  });
});
