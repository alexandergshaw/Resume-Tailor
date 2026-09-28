// N61 (S2) -- the fact highlight in the DocumentPreviewDialog body, tested on
// the BYTE-SPLICE model path (a fact present in the letter but NOT highlighted
// is a fact the candidate cannot see to remove). markInsertedFacts must find
// the fact in a model PARSED BACK FROM REAL DOCX BYTES and flag its run(s) so
// renderModelToHtml distinguishes it.
//
// LOCATED, NOT TEXT-KEYED (fresh-verifier finding F2): the highlight keys on the
// fact's character OFFSET, not a global text search, so an overlapping/duplicated
// fact marks exactly its own span rather than the first text match.
//
// Pinned that an inherited default would otherwise decide (loop-tdd rule 11/13):
// (1) the fact highlight is a DISTINCT marker from the version-diff highlight
// (version-diff = <span background-color>, no data-fact; fact = <mark data-fact>)
// so the two are never conflated (AC-N61.13). (2) With no locators, the render is
// byte-identical to today's (no marker leaks into the combined/downloaded docx).
//
// Node, not jsdom: this asserts the produced HTML STRING. The highlight reaching
// the rendered modal body with the version-diff toggle off rides the auto-insert
// (S5/S6) dispatch, since only an auto-inserted fact appears in the prose un-asked.

import { describe, it, expect, beforeAll } from "vitest";
import { markInsertedFacts, markVersionChanges } from "@/lib/document/versionDiff.js";
import { parseDocxToModel, renderModelToHtml, linesToModel, modelToLines } from "@/lib/document/docxPreview.js";
import { planAcceptForEntry } from "@/lib/acceptedFacts/factInsertion.js";
import { applyCoverDocxEdits } from "@/lib/acceptedFacts/factDocx.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

const FACT = "Acme just opened a Dublin telemetry lab.";

let SPLICED_MODEL = null;
let PLAIN_MODEL = null;
let FACT_OFFSET = -1; // the fact's offset within its paragraph in the byte-parsed model

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  PLAIN_MODEL = await parseDocxToModel(Buffer.from(cl.docxB64, "base64"));
  const plan = planAcceptForEntry({ coverLetterResultLines: cl.resultLines }, { facts: [{ id: "f1", text: FACT, placement: "intro" }] });
  const spliced = await applyCoverDocxEdits(cl.docxB64, cl.resultLines, plan.cover.edits);
  if (!spliced.applied) throw new Error(`fixture splice failed: ${spliced.reason}`);
  SPLICED_MODEL = await parseDocxToModel(Buffer.from(spliced.docxB64, "base64"));
  for (const p of SPLICED_MODEL.paragraphs) {
    const t = p.runs.map((r) => r.text).join("");
    if (t.includes(FACT)) { FACT_OFFSET = t.indexOf(FACT); break; }
  }
});

function factMarkedText(html) {
  const out = [];
  const re = /<mark\b[^>]*\bdata-fact\b[^>]*>([\s\S]*?)<\/mark>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/<[^>]+>/g, ""));
  return out.join("");
}

describe("markInsertedFacts -- instrument sanity / non-vacuity", () => {
  it("the fixture really carries the fact through the byte path (else the highlight test is vacuous)", () => {
    expect(modelToLines(SPLICED_MODEL).some((l) => l.includes(FACT)), "byte model lacks the fact -- fixture broken").toBe(true);
    expect(modelToLines(PLAIN_MODEL).some((l) => l.includes(FACT)), "the plain letter already has the fact").toBe(false);
    expect(FACT_OFFSET, "could not locate the fact offset in the byte model").toBeGreaterThanOrEqual(0);
  });

  it("CANARY (lines path): the marker appears on the trivial one-run-per-line model", () => {
    const model = linesToModel(["Dear Hiring Manager,", `An intro. ${FACT} More text.`, "Sincerely,"]);
    const html = renderModelToHtml(markInsertedFacts(model, [{ text: FACT, offset: `An intro. `.length }]));
    expect(factMarkedText(html)).toContain(FACT);
  });
});

describe("markInsertedFacts -- BYTE path (the named silent failure)", () => {
  it("the fact spliced into REAL bytes is wrapped in a distinguishing data-fact marker at its offset", () => {
    const html = renderModelToHtml(markInsertedFacts(SPLICED_MODEL, [{ text: FACT, offset: FACT_OFFSET }]));
    expect(factMarkedText(html), "the byte-path model's fact text is not inside a data-fact marker").toContain(FACT);
    expect(factMarkedText(html)).not.toContain("Sincerely");
  });

  it("with no locators the render is byte-identical to today's (no marker leaks into combine/download)", () => {
    const before = renderModelToHtml(SPLICED_MODEL);
    const after = renderModelToHtml(markInsertedFacts(SPLICED_MODEL, []));
    expect(after).toBe(before);
    expect(factMarkedText(after)).toBe("");
  });
});

describe("markInsertedFacts -- distinct from the version-diff highlight (AC-N61.13)", () => {
  it("the fact highlight carries data-fact; the version-diff highlight does not", () => {
    const previous = ["totally", "different", "old", "lines"];
    const current = modelToLines(SPLICED_MODEL, { includeEmpty: true });
    const diffHtml = renderModelToHtml(markVersionChanges(SPLICED_MODEL, previous, current));
    expect(factMarkedText(diffHtml), "the version-diff highlight emitted a data-fact marker -- the two are conflated").toBe("");
    expect(diffHtml, "control: the version-diff highlight must actually fire").toContain("background-color:rgba(255,213,79,0.55)");

    const factHtml = renderModelToHtml(markInsertedFacts(SPLICED_MODEL, [{ text: FACT, offset: FACT_OFFSET }]));
    expect(factMarkedText(factHtml)).toContain(FACT);
  });
});

describe("F2: an overlapping-substring fact is marked at its OWN offset, not inside the longer fact", () => {
  it("marks the standalone occurrence, leaving the longer fact's copy unmarked", () => {
    const LONG = "Acme opened a Dublin telemetry lab.";
    const SHORT = "a Dublin telemetry lab."; // substring of LONG
    const line = `We are hiring. ${LONG} ${SHORT} Come join us.`;
    const model = linesToModel([line]);
    const standalone = line.indexOf(SHORT, line.indexOf(LONG) + LONG.length);
    const html = renderModelToHtml(markInsertedFacts(model, [{ text: SHORT, offset: standalone }]));
    expect(factMarkedText(html)).toBe(SHORT);
    // The text right after the mark is the OUTRO -> the STANDALONE occurrence was
    // marked. A text-keyed highlight marks the copy INSIDE long, after which comes
    // " a Dublin telemetry lab." instead of the outro.
    const m = html.match(/<\/mark>([\s\S]{0,60})/);
    const after = (m ? m[1] : "").replace(/<[^>]+>/g, "");
    expect(after.startsWith(" Come join us"), `text after the mark was ${JSON.stringify(after)} -- the wrong occurrence was marked`).toBe(true);
  });
});
