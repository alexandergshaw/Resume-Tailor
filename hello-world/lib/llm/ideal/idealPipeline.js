// N105 Step 3c - the Ideal pipeline ORCHESTRATOR (server side, engine-agnostic).
//
//   1. engine.tailorIdeal(args)         the chain: posting analysis + keyword map,
//                                       a HYPOTHETICAL draft, and an
//                                       APPLICATION-READY CANDIDATE
//   2. decomposeToSpans(candidate)      app-minted spans + the layout to rebuild from
//   3. applicationReadyGate(spans)      kept / flagged / dropped (AC-4)
//   4. reconcileChronology(layout)      employer / education lines vs the user's real
//                                       records (AC-10); the gate cannot see them
//   5. recomposeFromSpans(layout, KEPT) the EMITTED application-ready document
//
// THE SAFETY PROPERTY (K2, D-6b). The emitted application-ready text is whatever
// step 5 returns and nothing else. It is handed the KEPT spans only, so a dropped
// or flagged claim is absent from the output by construction; flagged claims go
// to `removed` (the user can verify and add them back), dropped ones to `leftOut`.
// Nothing downstream of the engine reads `applicationReadyCandidate.result`,
// `.resultLines` or `.docxB64` again: a candidate docxB64 would carry the
// pre-gate text, so it is not forwarded, and the client builds the file's bytes
// from the recomposed lines. The hypothetical keeps its own text and bytes and is
// never gated: it is the best case, and the UI and filename mark it as such.
//
// Slice 1 has no reviewer (Step 9 is blocked on the shared reviewer), so
// `review` is null here. The band state machine reads a null review as "the
// review did not run", never as a clean result.
//
// A missing `realMaterial` is an EMPTY corpus: the gate drops every content span
// and the chronology check removes every employer line. Failing closed here is
// deliberate; the caller supplies the material (resume-derived spans plus the
// chronology) and the empty-resume refusal belongs to the route, before any call.
import { ensureHypotheticalMarker } from "@/lib/document/docx";
import { GATE_REASON, applicationReadyGate } from "@/lib/llm/ideal/applicationReadyGate";
import {
  buildRealEmployers,
  findRealEmployer,
  reconcileChronology,
} from "@/lib/llm/ideal/idealChronology";
import { stageError } from "@/lib/llm/ideal/idealStageResult";
import { groundToPosting } from "@/lib/llm/ideal/postingGrounding";
import { decomposeToSpans, recomposeFromSpans } from "@/lib/llm/ideal/spanDocument";

// A chain draft as { result, resultLines, jobTitle, companyName }; anything that
// is not a document fails the run (never a partial artifact, K7).
function readDraft(draft, label) {
  const fromLines =
    Array.isArray(draft?.resultLines) && draft.resultLines.length > 0
      ? draft.resultLines.map((line) => (typeof line === "string" ? line : ""))
      : null;
  const fromResult = typeof draft?.result === "string" ? draft.result.replace(/\r\n?/g, "\n").split("\n") : null;
  const lines = fromLines ?? fromResult;
  if (!lines) {
    throw stageError("pipeline", "invalid-shape", `The ${label} draft had no resume text. Nothing was produced.`);
  }
  return {
    result: typeof draft.result === "string" ? draft.result : lines.join("\n"),
    resultLines: lines,
    jobTitle: typeof draft.jobTitle === "string" ? draft.jobTitle : "",
    companyName: typeof draft.companyName === "string" ? draft.companyName : "",
  };
}

// The text of the nearest preceding line that is in the emitted document, in the
// same section (an employer line counts: "add back" lands under it), else null.
function anchorFor(entries, spanId, keptText) {
  const at = entries.findIndex((e) => e.kind === "span" && e.spanId === spanId);
  for (let i = at - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === "heading") return null;
    if (entry.kind === "employer") return entry.text;
    if (entry.kind === "span" && keptText.has(entry.spanId)) return keptText.get(entry.spanId);
  }
  return null;
}

/**
 * runIdealPipeline({ engine, args, realMaterial })
 *
 *   engine        a resolved engine with supportsIdeal === true and tailorIdeal()
 *   args          passed to engine.tailorIdeal verbatim; args.jobPosting (text) is
 *                 also what the posting analysis is grounded to
 *   realMaterial  { spans: [{ id, text, contextKey }],
 *                   chronology?: { employers: [{ name, start, end }],
 *                                  education?: [{ institution, degree?, start, end }] } }
 *
 * => { engine, result, resultLines, jobTitle, companyName,   // APPLICATION-READY (UX-42)
 *      ideal: { hypothetical, applicationReady, review: null, postingAnalysis,
 *               keywordMap, removed, leftOut, counts } }
 *
 * Throws a stage error (never returns a partial) when the engine cannot run the
 * Ideal level or the chain returns something that is not a pair of documents.
 */
export async function runIdealPipeline({ engine, args, realMaterial } = {}) {
  if (!engine || engine.supportsIdeal !== true || typeof engine.tailorIdeal !== "function") {
    throw stageError("input", "unsupported-engine", "This engine cannot produce the Ideal level. Nothing was produced.");
  }
  const chain = await engine.tailorIdeal(args);
  const hypothetical = readDraft(chain?.hypothetical, "hypothetical");
  const candidate = readDraft(chain?.applicationReadyCandidate, "application-ready");

  const real = realMaterial && typeof realMaterial === "object" ? realMaterial : { spans: [], chronology: null };
  const realEmployers = buildRealEmployers(real);

  // Spans under a real employer are keyed by the REAL employer name, so a line
  // that differs only by a corporate suffix is still judged against that
  // employer's own material.
  const { spans, layout } = decomposeToSpans(candidate.result, candidate.resultLines, {
    contextKeyOf: ({ employer }) =>
      findRealEmployer(realEmployers, employer?.name, employer?.dates)?.name ?? employer?.name ?? "",
  });
  const gated = applicationReadyGate({ candidateSpans: spans, realMaterial: real });
  const chronology = reconcileChronology(layout, realEmployers);

  const underInvented = (span) => chronology.invalidSpanIds.has(span.id);
  const kept = gated.kept.filter((span) => !underInvented(span));
  const emitted = recomposeFromSpans(chronology.layout, kept);

  const spanById = new Map(spans.map((span) => [span.id, span]));
  const keptText = new Map(kept.map((span) => [span.id, span.text]));
  const entries = chronology.layout.entries;

  const removed = gated.flagged.map((span) => ({
    spanId: span.id,
    text: span.text,
    section: spanById.get(span.id)?.section ?? "",
    contextKey: spanById.get(span.id)?.contextKey ?? "",
    reasonCode: span.reason,
    flag: span.flag,
    anchor: anchorFor(entries, span.id, keptText),
  }));
  const leftOut = [
    ...gated.dropped,
    ...gated.kept.filter(underInvented).map((span) => ({ ...span, reason: GATE_REASON.NO_MATCH })),
    ...chronology.removedEmployers.map((e) => ({ id: e.id, text: e.text, reason: GATE_REASON.NO_MATCH })),
  ].map((span) => ({ spanId: span.id, text: span.text, reasonCode: span.reason }));

  const grounded = groundToPosting(
    { postingAnalysis: chain.postingAnalysis, keywordMap: chain.keywordMap },
    args?.jobPosting,
  );

  const applicationReady = {
    result: emitted.result,
    resultLines: emitted.resultLines,
    jobTitle: candidate.jobTitle,
    companyName: candidate.companyName,
    title: candidate.jobTitle,
    isHypothetical: false,
  };

  return {
    engine: typeof chain.engine === "string" ? chain.engine : engine.name,
    result: applicationReady.result,
    resultLines: applicationReady.resultLines,
    jobTitle: applicationReady.jobTitle,
    companyName: applicationReady.companyName,
    ideal: {
      hypothetical: {
        result: hypothetical.result,
        resultLines: hypothetical.resultLines,
        jobTitle: hypothetical.jobTitle,
        companyName: hypothetical.companyName,
        title: ensureHypotheticalMarker(hypothetical.jobTitle || "Resume", true),
        isHypothetical: true,
        ...(typeof chain.hypothetical?.docxB64 === "string" ? { docxB64: chain.hypothetical.docxB64 } : {}),
      },
      applicationReady,
      review: null,
      postingAnalysis: grounded.postingAnalysis,
      keywordMap: grounded.keywordMap,
      removed,
      leftOut,
      counts: {
        kept: kept.length,
        // An accomplishment is a kept line that belongs to an employer or
        // project; summary and skills lines have no context key.
        keptAccomplishments: kept.filter((span) => spanById.get(span.id)?.contextKey).length,
        removed: removed.length,
        leftOut: leftOut.length,
      },
    },
  };
}
