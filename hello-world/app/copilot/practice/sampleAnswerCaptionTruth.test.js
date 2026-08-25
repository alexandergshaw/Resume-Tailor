// @vitest-environment jsdom
//
// The sample-answer panel must not contradict itself.
//
// THE DEFECT THIS EXISTS TO PREVENT. `sourceCaption` enumerates where the
// draft came from, and its fallback branch says the answer was drafted "from
// your prep context only — no submitted resume or cover letter was found for
// this posting." That sentence was written before the knowledge base was a
// source. Now the bullets directly ABOVE it can each read "From your Payments
// migration page." — so one panel makes two contradictory claims about the
// same draft, and the one in smaller type is the false one.
//
// With a resume on file it is not a contradiction, but it is still wrong by
// omission: the caption enumerates the sources and silently drops the one the
// bullets are naming.
//
// This is the same class of defect as the attachment-honesty notice in
// lib/experience/knowledgeBase.js — a claim about provenance that used to be
// true and quietly stopped being true when a source was added beside it.
//
// The caption must be driven by what was actually put in the PROMPT, never by
// which pages the model chose to cite: an answer can be grounded in pages the
// model drew on without naming, and a caption that under-claims is as wrong as
// one that over-claims.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import SampleAnswer from "./SampleAnswer.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const BASE = {
  visible: true,
  status: "done",
  points: ["We sharded the ledger by tenant."],
  cues: ["The sharding"],
  buzzwords: [],
  anchor: null,
  idealProject: null,
  pageSources: [{ id: "p1", title: "Payments migration" }],
  error: "",
  isEmbedded: false,
  onToggle: () => {},
  onRetry: () => {},
  onRegenerate: () => {},
};

async function render(props) {
  await act(async () => {
    root.render(createElement(SampleAnswer, { ...BASE, ...props }));
  });
}

describe("the sample answer's source caption tells the truth about the knowledge base", () => {
  it("does not claim prep context ONLY when project pages fed the draft", async () => {
    await render({ grounding: { resume: false, coverLetter: false, pages: true } });
    // Positive control first: the citation really is on screen, so the
    // assertion below is about a contradiction and not about an empty panel.
    expect(container.textContent).toContain("From your Payments migration page.");
    expect(container.textContent).not.toContain("prep context only");
  });

  it("names the project pages among the sources when a resume was used too", async () => {
    await render({ grounding: { resume: true, coverLetter: false, pages: true } });
    const text = container.textContent.toLowerCase();
    expect(text).toContain("resume");
    // Wording is free; the panel must acknowledge the pages as a source rather
    // than enumerate around them.
    expect(text).toContain("page");
  });

  it("still says prep context only when NO page reached the draft", async () => {
    // The original sentence must survive for the case it was written for —
    // otherwise the fix trades one false claim for another.
    await render({
      grounding: { resume: false, coverLetter: false, pages: false },
      pageSources: [],
    });
    expect(container.textContent).toContain("prep context only");
    expect(container.textContent).not.toContain("From your");
  });

  it("treats an entry cached before the field existed as no pages, not as pages", async () => {
    // `grounding.pages` is absent on an entry cached before this shipped.
    // Reading `undefined` as truthy would make the panel claim a knowledge
    // base source for a draft that never had one.
    await render({ grounding: { resume: false, coverLetter: false }, pageSources: [] });
    expect(container.textContent).toContain("prep context only");
  });
});
