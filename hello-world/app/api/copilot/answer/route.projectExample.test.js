// N143 seam 5 — T10 (the done-frame census, the R-B silent-failure guard) and
// T9 (the never-in-a-question-independent-server-cache static guard).
//
// This is a DELIBERATE source-text census, not a prose assertion: the property
// IS the shape of the source — that `projectExample` rides EVERY Gemini
// success payload and NEITHER embedded one. A missed Gemini branch drops Row 1
// to a clean NA that reads identically to "feature off", with every behavioural
// test still green (R-B). Only a per-branch census catches it. Source is
// comment-stripped first (shared stripComments) so a comment mentioning
// projectExample cannot satisfy a presence check nor trip an absence check, and
// every branch slice carries a canary proving the slice is the real one.
//
// RED on HEAD: `projectExample` appears zero times in route.js, so every
// presence assertion fails and every canary passes. It greens when the
// implementer builds projectExample once in POST, passes it into streamAnswer,
// and spreads `...(projectExample ? { projectExample } : {})` onto the three
// Gemini sites (streamAnswer done ×2 shapes, answer-mode Gemini, points-mode
// Gemini) — and onto NEITHER embedded branch (design r2 §4.4 / F).

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "../../../../lib/sourceScan/tokenizeSource.js";

const ROUTE = fileURLToPath(new URL("./route.js", import.meta.url));
const ANSWER_CONTEXT = fileURLToPath(new URL("../../../../lib/copilot/answerContext.js", import.meta.url));

let src = null;

beforeAll(() => {
  src = stripComments(readFileSync(ROUTE, "utf8"));
});

// Slice the comment-stripped source between a start anchor and the next
// occurrence of an end anchor (searched from just after the start). Returns ""
// if either is absent, so a presence assertion on a missing anchor fails
// rather than passing vacuously.
function slice(startAnchor, endAnchor) {
  const s = src.indexOf(startAnchor);
  if (s === -1) return "";
  const from = s + startAnchor.length;
  const e = endAnchor ? src.indexOf(endAnchor, from) : src.length;
  return src.slice(s, e === -1 ? src.length : e);
}

describe("done-frame census — projectExample rides the 3 Gemini sites (T10 / R-B)", () => {
  it("[control] the five success sites are present and findable on HEAD", () => {
    // Canary: without these anchors the census below measures nothing.
    expect(src).toContain("const done = isAnswerMode");
    expect(src).toContain("return streamAnswer({");
    expect(src).toContain("draftSampleAnswerLocal({");
    expect(src).toContain("draftAnswerLocal({");
    expect((src.match(/const \{ geminiModel \} = getServerEnv\(\);/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("streamAnswer's done object carries projectExample in BOTH shapes", () => {
    const doneBlock = slice("const done = isAnswerMode", 'write({ t: "done"');
    // Canary: this really is the done-assembly block.
    expect(doneBlock).toContain("cues");
    expect(doneBlock).toContain("pageSources");
    // Teeth: present, and present in BOTH object-literal shapes (answer +
    // points). Dropping the spread from one shape drops the count to 1 → red.
    expect(doneBlock).toContain("projectExample");
    expect((doneBlock.match(/projectExample/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("projectExample is passed into the streamAnswer(...) call from POST", () => {
    const callBlock = slice("return streamAnswer({", "});");
    expect(callBlock).toContain("grounding");
    expect(callBlock).toContain("projectExample");
  });

  it("the non-streaming answer-mode GEMINI payload carries projectExample", () => {
    // Anchor on the answer-mode system instruction config, unique in the file
    // (streamAnswer's config uses the `systemInstruction` variable + a
    // thinkingConfig; the embedded branches have no config). This isolates the
    // answer-mode Gemini Response.json, so the presence check cannot be
    // satisfied by streamAnswer's done further up.
    const answerGemini = slice(
      'config: { systemInstruction: ANSWER_SYSTEM, responseMimeType: "application/json" },',
      "draftAnswerLocal({",
    );
    expect(answerGemini).toContain("deriveAnswerFromPoints");
    expect(answerGemini).toContain("projectExample");
  });

  it("the non-streaming points-mode GEMINI payload carries projectExample", () => {
    // Anchor on the points-mode system instruction, unique in the file.
    const pointsGemini = slice('config: { systemInstruction: POINTS_SYSTEM, responseMimeType: "application/json" },', null);
    // Canary: this is the points-mode Gemini tail. The slice starts AT the
    // config line, after the prompt build, so the canary is a token that follows
    // it (the points normalisation) rather than buildPointsPrompt, which only
    // occurs before the anchor.
    expect(pointsGemini).toContain("normalizeModelPoints");
    expect(pointsGemini).toContain("projectExample");
  });

  it("[mutation control] NEITHER embedded branch carries projectExample (omission = NA)", () => {
    const answerEmbedded = slice("draftSampleAnswerLocal({", "const { geminiModel } = getServerEnv();");
    const pointsEmbedded = slice("draftAnswerLocal({", "const { geminiModel } = getServerEnv();");
    expect(answerEmbedded).toContain("draftSampleAnswerLocal");
    expect(pointsEmbedded).toContain("draftAnswerLocal");
    // The embedded payloads must render NA by OMISSION. Spreading projectExample
    // here reds. (This is the no-op-direction control for the census: it must
    // STAY green on HEAD and after a correct implementation.)
    expect(answerEmbedded).not.toContain("projectExample");
    expect(pointsEmbedded).not.toContain("projectExample");
  });
});

describe("the per-question pick is read FRESH and never cached server-side (T9 / AC-7, R-H)", () => {
  it("the answer route reads the pool directly (getProjectPool) and selects fresh (selectPoolProject)", () => {
    // Positive: the fresh per-question read the design requires (design r2 §4.3).
    expect(src).toMatch(/getProjectPool/);
    expect(src).toMatch(/selectPoolProject/);
  });

  it("the pick is not written into the pool row from the answer route (no upsertProjectPool import)", () => {
    // The answer route never persists the pick; only the prewarm route writes
    // the pool. A pick written back would be a question-dependent value in a
    // question-independent store.
    expect(src).not.toMatch(/upsertProjectPool/);
  });

  it("answerContext.js (the session-duration cache, keyed userId::applicationId) gains no pool field", () => {
    // The named cache hazard: a per-question pick frozen in the session cache
    // answers question two with question one's pick, every other test green.
    // M1 forbids adding the pool to this cache's fan-out — assert it stays
    // untouched by this feature.
    const ctx = stripComments(readFileSync(ANSWER_CONTEXT, "utf8"));
    expect(ctx).not.toMatch(/projectExample|projectPool|selectPoolProject|application_project_pool/);
  });
});
