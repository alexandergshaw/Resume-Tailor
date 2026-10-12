// N145 Wave B, seam 4 — the retry WIRING join. The real-parent mounts
// (CopilotDashboard.retryRowOne / SampleAnswer.retryRowOne) prove each surface
// FORWARDS onRetryRowOne/rowOneRetrying down to AnswerAids. They cannot prove
// the CLIENTS SUPPLY them: a value that exists at both ends and is dropped in
// the middle leaves every mount green and the live app with a dead button
// (the app/page.js ChatPanel precedent in loop-traps-tests). So this pins the
// middle of the chain off the source of the real mounting files, the same
// discipline projectExampleSelfHeal.wiring.test.js already uses for
// noteRowOneStatus. Comments are stripped, and each JSX opening tag is located
// with a brace-balanced scan so a nested `{...}` or an arrow `=>` cannot end it
// early.
//
// The chains, per mode (current surface only -- OWNER RULING 2026-10-12):
//   live      CopilotClient -> <CopilotDashboard> -> CurrentAnswerPanel -> AnswerAids
//   practice  PracticeClient -> <QuestionCard> -> <SampleAnswer> -> AnswerAids
//
// The handler the client builds is `regenerateOne(posting?.id)` and the
// in-flight fact is `prewarmingIds.has(posting?.id)` -- pinned so a retry that
// regenerates NO application (or the wrong one) reds here, which is the
// source-text half of "the retry hits the current surface, not the other".

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../lib/sourceScan/tokenizeSource.js";

function read(rel) {
  return stripComments(readFileSync(path.resolve(process.cwd(), rel), "utf8"));
}

const CLIENT = read("app/copilot/CopilotClient.js");
const PRACTICE = read("app/copilot/practice/PracticeClient.js");
const QUESTION_CARD = read("app/copilot/practice/QuestionCard.js");
const SAMPLE_ANSWER = read("app/copilot/practice/SampleAnswer.js");
const DASHBOARD = read("app/copilot/dashboard/CopilotDashboard.js");

// The text of a JSX opening tag starting at `marker` (e.g. "<CopilotDashboard")
// through its own closing `>`, tracking brace depth and skipping string
// literals so `onX={() => f()}` and quoted `>` do not end it early. `from`
// lets a caller resume past an earlier match (the two <AnswerAids> sites).
function openingTag(src, marker, from = 0) {
  const start = src.indexOf(marker, from);
  if (start === -1) return null;
  let brace = 0;
  let quote = null;
  for (let i = start + marker.length; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") brace += 1;
    else if (ch === "}") brace -= 1;
    else if (brace === 0 && ch === ">") return { text: src.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

// The parameter object of a `function NAME(` declaration, through the matching
// close paren -- for QuestionCard's destructured props.
function paramsOf(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

describe("[canary] the tag/param extractors find real, non-empty markup on HEAD", () => {
  it("finds each JSX opening tag and the QuestionCard params, each carrying a known-present attribute", () => {
    expect(openingTag(CLIENT, "<CopilotDashboard")?.text).toMatch(/\bquestions=/);
    expect(openingTag(PRACTICE, "<QuestionCard")?.text).toMatch(/\bsampleStatus=/);
    expect(openingTag(QUESTION_CARD, "<SampleAnswer")?.text).toMatch(/\bprojectExample=/);
    expect(openingTag(SAMPLE_ANSWER, "<AnswerAids")?.text).toMatch(/\bprojectExample=/);
    expect(openingTag(DASHBOARD, "<CurrentAnswerPanel")?.text).toMatch(/\bcurrent=/);
    expect(paramsOf(QUESTION_CARD, "function QuestionCard(")).toMatch(/\bquestion,/);
  });
});

describe("live: CopilotClient builds the current-application retry and supplies it to the dashboard (N145-3/N145-4)", () => {
  it("builds the handler from regenerateOne(posting?.id) and the in-flight fact from prewarmingIds.has(posting?.id)", () => {
    expect(CLIENT).toMatch(/regenerateOne\(\s*posting\?\.id/);
    expect(CLIENT).toMatch(/prewarmingIds\.has\(\s*posting\?\.id/);
  });

  it("passes onRetryRowOne and rowOneRetrying to <CopilotDashboard>", () => {
    const tag = openingTag(CLIENT, "<CopilotDashboard")?.text || "";
    expect(tag).toMatch(/\bonRetryRowOne=/);
    expect(tag).toMatch(/\browOneRetrying=/);
  });
});

describe("live: CopilotDashboard threads the retry to the CURRENT panel only (N145-4)", () => {
  it("passes onRetryRowOne and rowOneRetrying to <CurrentAnswerPanel>", () => {
    const tag = openingTag(DASHBOARD, "<CurrentAnswerPanel")?.text || "";
    expect(tag).toMatch(/\bonRetryRowOne=/);
    expect(tag).toMatch(/\browOneRetrying=/);
  });

  it("[control] the history card's AnswerAids receives NO retry handler (one retry per application serves later questions)", () => {
    // DISCLOSED vacuous on HEAD: neither <AnswerAids> carries it yet. Once the
    // feature lands this pins the current-surface-only rule -- the second
    // <AnswerAids> is HistoryItem's (CopilotDashboard.js:771), which must stay
    // retry-free while the first (CurrentAnswerPanel, :465) gains it.
    const first = openingTag(DASHBOARD, "<AnswerAids");
    expect(first).not.toBeNull();
    const second = openingTag(DASHBOARD, "<AnswerAids", first.end);
    expect(second, "two AnswerAids sites in CopilotDashboard").not.toBeNull();
    expect(second.text).not.toMatch(/\bonRetryRowOne=/);
  });
});

describe("practice: PracticeClient supplies the retry and QuestionCard forwards it to SampleAnswer (N145-3/N145-4)", () => {
  it("PracticeClient builds the current-application retry and supplies it to <QuestionCard>", () => {
    expect(PRACTICE).toMatch(/regenerateOne\(\s*posting\?\.id/);
    expect(PRACTICE).toMatch(/prewarmingIds\.has\(\s*posting\?\.id/);
    const tag = openingTag(PRACTICE, "<QuestionCard")?.text || "";
    expect(tag).toMatch(/\bonRetryRowOne=/);
    expect(tag).toMatch(/\browOneRetrying=/);
  });

  it("QuestionCard accepts onRetryRowOne/rowOneRetrying as props and forwards them to <SampleAnswer>", () => {
    const params = paramsOf(QUESTION_CARD, "function QuestionCard(") || "";
    expect(params).toMatch(/\bonRetryRowOne\b/);
    expect(params).toMatch(/\browOneRetrying\b/);
    const tag = openingTag(QUESTION_CARD, "<SampleAnswer")?.text || "";
    expect(tag).toMatch(/\bonRetryRowOne=/);
    expect(tag).toMatch(/\browOneRetrying=/);
  });

  it("SampleAnswer forwards onRetryRowOne/rowOneRetrying to <AnswerAids>", () => {
    const tag = openingTag(SAMPLE_ANSWER, "<AnswerAids")?.text || "";
    expect(tag).toMatch(/\bonRetryRowOne=/);
    expect(tag).toMatch(/\browOneRetrying=/);
  });
});
