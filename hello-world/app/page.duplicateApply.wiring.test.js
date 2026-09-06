// The duplicate-application flag, wave W3B (3-plan-dupapply.md §2.8):
// wiring the already-shipped lib/duplicateApply/ core into app/page.js's
// tailoring entry points, plus the live region.
//
// WHY SOURCE-SCANNING: `app/page.js` is a single un-exported "use client"
// component (`export default function Home()`). It cannot be mounted for a
// behavioral test without pulling in Supabase, fetch, and a screen's worth
// of other hooks for no benefit -- see app/page.autoTailoredUrl.test.js's
// own header and test/repro/appliedStatusDataLoss.test.js's "cannot be
// imported" note for the same constraint on this same file. That precedent
// reads the real source and asserts on its shape; this file follows it.
//
// The actually-behavioral properties (§4 A-1/A-2/A-3, S-2's merge, the
// unfiltered row set) are NOT tested here: they live in
// app/hooks/useDuplicateApplyCheck.js, an ordinary exported hook that CAN
// be mounted, and app/hooks/useDuplicateApplyCheck.test.js tests them for
// real, by mounting it -- exactly like app/hooks/useManualTailor.test.js
// does for its own pipeline. This file covers the complementary property
// that hook cannot see from inside itself: WHERE in app/page.js's three
// handlers each fire point sits relative to their own try/finally, and how
// the live region and <StatusBar> wire to the hook's return value.
//
// Line numbers are NOT used as anchors; every function is located by its
// signature and extracted by brace-depth counting, so the assertions track
// the functions wherever they move.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pageSource = readFileSync(fileURLToPath(new URL("./page.js", import.meta.url)), "utf8");

function findMatchingClose(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Extracts the full `{ ... }` body of the first function whose signature
// matches `signatureRegex`, using brace-depth counting (never a non-greedy
// regex) so nested blocks don't truncate the match early.
//
// Every `signatureRegex` passed in this file ends EXACTLY at the function
// body's opening brace (a trailing literal `\{`) -- the last character of
// the match IS that brace. Required because these signatures (`opts = {}`)
// contain a brace of their own, so searching forward from `match.index` for
// the next "{" (as app/page.autoTailoredUrl.test.js's simpler helper does,
// safely, only because its own signatures contain no braces) would find
// that earlier brace instead of the real body start.
function extractFunctionBody(source, signatureRegex) {
  const match = source.match(signatureRegex);
  if (!match) return null;
  const braceStart = match.index + match[0].length - 1;
  if (source[braceStart] !== "{") return null;
  const braceEnd = findMatchingClose(source, braceStart, "{", "}");
  if (braceEnd === -1) return null;
  return source.slice(match.index, braceEnd + 1);
}

describe("entry point wiring -- structural position of each fire point", () => {
  it("[E2] handleTailorJob fires before handleTrackJob's own write, and before its own try", () => {
    const body = extractFunctionBody(pageSource, /async function handleTailorJob\(job, opts = \{\}\)\s*\{/);
    expect(body).not.toBeNull();
    const fireIdx = body.indexOf("dupeApply.runDuplicateCheck(");
    const trackIdx = body.indexOf("await handleTrackJob(job);");
    const tryIdx = body.indexOf("try {");
    expect(fireIdx).toBeGreaterThan(-1);
    expect(fireIdx).toBeLessThan(trackIdx);
    expect(fireIdx).toBeLessThan(tryIdx);
    // Exactly one fire in this handler (both signals are known at t=0 from
    // `job`, per 1c's entry-point table -- no second, post-response fire).
    expect(body.match(/dupeApply\.runDuplicateCheck\(/g)).toHaveLength(1);
  });

  it("[E1] handleTailorFeedPosting fires after tracking the job, before its own try", () => {
    const body = extractFunctionBody(pageSource, /async function handleTailorFeedPosting\(posting\)\s*\{/);
    expect(body).not.toBeNull();
    const fireIdx = body.indexOf("dupeApply.runDuplicateCheck(");
    const trackedIdx = body.indexOf('updateTailoringJob(syntheticJobId, { status: "tailoring" });');
    const tryIdx = body.indexOf("try {");
    expect(fireIdx).toBeGreaterThan(-1);
    expect(fireIdx).toBeGreaterThan(trackedIdx);
    expect(fireIdx).toBeLessThan(tryIdx);
    expect(body.match(/dupeApply\.runDuplicateCheck\(/g)).toHaveLength(1);
  });

  it("[E3] handleUrlSubmit fires TWICE: Signal-1 outside the try, Signal-2 inside it and separately wrapped", () => {
    const body = extractFunctionBody(pageSource, /async function handleUrlSubmit\(event, opts = \{\}\)\s*\{/);
    expect(body).not.toBeNull();
    const fireIndices = [];
    let cursor = 0;
    for (;;) {
      const idx = body.indexOf("dupeApply.runDuplicateCheck(", cursor);
      if (idx === -1) break;
      fireIndices.push(idx);
      cursor = idx + 1;
    }
    expect(fireIndices).toHaveLength(2);
    const [firstFire, secondFire] = fireIndices;
    const outerTryIdx = body.indexOf("try {");
    // Signal-1 fires before the handler's own (outer) try.
    expect(firstFire).toBeLessThan(outerTryIdx);
    // Signal-2 fires after the outer try has started, and after the
    // response's company is known.
    expect(secondFire).toBeGreaterThan(outerTryIdx);
    expect(secondFire).toBeGreaterThan(body.indexOf("await response.json();"));
    expect(secondFire).toBeGreaterThan(body.indexOf("const nextCompany ="));
    // The second fire is wrapped in its OWN local try/catch -- a `try {`
    // closer to it than the outer one, whose matching `catch` sits before
    // finishByOpeningPreview.
    const localTryIdx = body.lastIndexOf("try {", secondFire);
    expect(localTryIdx).toBeGreaterThan(outerTryIdx);
    const localCatchIdx = body.indexOf("} catch {", secondFire);
    expect(localCatchIdx).toBeGreaterThan(-1);
    expect(localCatchIdx).toBeLessThan(body.indexOf("finishByOpeningPreview("));
    // Both fires reuse the SAME runStartedAt binding (dupeRunStartedAt), so
    // the two evaluations of one run agree on "now".
    expect(body).toMatch(/const dupeRunStartedAt = Date\.now\(\);/);
    const runStartedAtMentions = (body.match(/runStartedAt:\s*dupeRunStartedAt/g) || []).length;
    expect(runStartedAtMentions).toBe(2);
  });

  it("useManualTailor is wired with onCheckDuplicate: dupeApply.runDuplicateCheck", () => {
    const callSite = pageSource.match(/const manualTailor = useManualTailor\(\{[\s\S]*?\}\);/);
    expect(callSite).not.toBeNull();
    expect(callSite[0]).toMatch(/onCheckDuplicate:\s*dupeApply\.runDuplicateCheck/);
  });

  it("no handler calls evaluatePriorApplications directly -- only through the hook", () => {
    // The hook (app/hooks/useDuplicateApplyCheck.js) is the ONLY place that
    // imports evaluatePriorApplications; page.js must not import or
    // reference it, or a fire point could bypass the hook's own §4 A-1
    // guard.
    expect(pageSource).not.toMatch(/evaluatePriorApplications/);
  });
});

// ---------------------------------------------------------------------------
// The live region (S-11/S-9/S-12): unconditionally mounted, immediately
// before <StatusBar>, never nested inside a banner.
// ---------------------------------------------------------------------------

describe("the live region", () => {
  it("is a Box with role=status/aria-live=polite, visually hidden, mounted immediately before <StatusBar>", () => {
    const idx = pageSource.indexOf('data-dupe-flag="live"');
    expect(idx).toBeGreaterThan(-1);
    const statusBarIdx = pageSource.indexOf("<StatusBar");
    expect(statusBarIdx).toBeGreaterThan(idx);
    // Nothing else renders between the live region and <StatusBar> -- i.e.
    // it is not buried inside some other conditional that could unmount it.
    const between = pageSource.slice(idx, statusBarIdx);
    expect(between).toMatch(/role="status"/);
    expect(between).toMatch(/aria-live="polite"/);
    expect(between).toMatch(/sx=\{visuallyHidden\}/);
  });

  it("is NOT inside app/components/StatusBar.js's own render (this wave does not touch that file)", () => {
    const statusBarSource = readFileSync(
      fileURLToPath(new URL("./components/StatusBar.js", import.meta.url)),
      "utf8",
    );
    expect(statusBarSource).not.toMatch(/data-dupe-flag="live"/);
  });

  it("the inner announcement is null, never an empty string, when there is nothing to say", () => {
    const idx = pageSource.indexOf('data-dupe-flag="live"');
    const snippet = pageSource.slice(idx, idx + 400);
    expect(snippet).toMatch(
      /dupeApply\.dupeNotice\?\.announcement \? <span key=\{dupeApply\.dupeAnnounceSeq\}>\{dupeApply\.dupeNotice\.announcement\}<\/span> : null/,
    );
  });

  it("<StatusBar> receives the hook's dupeNotice, onOpenApplications and onDupeDismiss, unmodified", () => {
    // StatusBar.js (Wave 3A, already landed) declares exactly these three
    // prop names -- `onOpenApplications` is its OWN top-level prop, called
    // as `onOpenApplications(searchSeed)`, not a field embedded inside
    // `dupeNotice` (which StatusBar.js renders verbatim).
    const callSite = pageSource.match(/<StatusBar\b[\s\S]*?\/>/);
    expect(callSite).not.toBeNull();
    expect(callSite[0]).toMatch(/dupeNotice=\{dupeApply\.dupeNotice\}/);
    expect(callSite[0]).toMatch(/onOpenApplications=\{dupeApply\.onOpenApplications\}/);
    expect(callSite[0]).toMatch(/onDupeDismiss=\{dupeApply\.onDupeDismiss\}/);
  });

  it("is NOT wrapped in a conditional -- nothing immediately before <Box> or after </Box> could unmount it", () => {
    // The three assertions above (role/aria-live/sx, byte-identical between
    // the marker and <StatusBar>) all still pass against a page that wraps
    // the WHOLE block in `{dupeApply.dupeNotice ? ( ... ) : null}` -- a
    // conditional wrapper disturbs none of role="status", aria-live="polite"
    // or sx={visuallyHidden}, and "between idx and <StatusBar>" still
    // contains all three because the wrapper sits OUTSIDE that range. A
    // region that only mounts once it has content announces nothing (S-11):
    // this checks the actual JSX nesting instead of the text between two
    // markers. Walks backward from <Box's own start past whitespace and the
    // region's own `{/* ... */}` doc comment (never past a second one, so a
    // real preceding sibling's comment still counts as a boundary) to the
    // nearest real character, and forward from </Box> past whitespace only.
    function charImmediatelyBefore(source, index) {
      let s = source.slice(0, index);
      for (;;) {
        const withoutSpace = s.replace(/\s+$/, "");
        const withoutComment = withoutSpace.replace(/\{\/\*[\s\S]*?\*\/\}$/, "");
        if (withoutComment === s) return s.slice(-1);
        s = withoutComment;
      }
    }
    function firstNonSpaceCharAfter(source, index) {
      let i = index;
      while (i < source.length && /\s/.test(source[i])) i++;
      return source[i];
    }
    const idx = pageSource.indexOf('data-dupe-flag="live"');
    const boxStart = pageSource.lastIndexOf("<Box", idx);
    // A `{cond ? (` or `{cond && (` guard's last character before the
    // element is always "(" (both forms), or "&" for a parenthesis-free
    // `{cond && <Box>}` -- never "}" (a normal preceding sibling's close, as
    // in the real tree today) or "<"/text.
    expect(["(", "&"]).not.toContain(charImmediatelyBefore(pageSource, boxStart));
    const boxEnd = pageSource.indexOf("</Box>", idx) + "</Box>".length;
    // A ternary/AND wrapper's first character after </Box> is always the
    // closing ")" -- never "<" (the real next sibling, <StatusBar>, today).
    expect(firstNonSpaceCharAfter(pageSource, boxEnd)).not.toBe(")");
  });
});

// ---------------------------------------------------------------------------
// R3/R4: the hook's inputs, asserted at the ONE call site that supplies them.
// useDuplicateApplyCheck.test.js proves the hook behaves correctly given
// honest inputs (mounts it for real); it cannot prove page.js SUPPLIES
// honest inputs, because it never imports page.js. This is that missing
// half, source-scanned like everything else in this file.
// ---------------------------------------------------------------------------

describe("[R3/R4] useDuplicateApplyCheck's call site passes the raw, honestly-derived inputs", () => {
  const callSite = pageSource.match(/const dupeApply = useDuplicateApplyCheck\(\{[\s\S]*?\}\);/);

  it("the call site exists (sanity check for the extractor itself)", () => {
    expect(callSite).not.toBeNull();
  });

  it("[R3] applicationData is passed by shorthand identity -- never a filtered/sorted derivative", () => {
    // The search box's filtered+sorted list (visibleApplicationData, derived
    // a few lines above this call site) would silently under-count a
    // duplicate check against whatever the user last typed into Interviewing
    // search -- the exact defect 1c U-7 #6 names. Shorthand (`applicationData,`)
    // is the only spelling that cannot also be `applicationData: <anything else>`.
    expect(callSite[0]).toMatch(/\bapplicationData,/);
    expect(callSite[0]).not.toMatch(/applicationData\s*:/);
  });

  it("[R4] applicationError and applicationLoadedOnce are passed by shorthand identity -- never a hardcoded literal", () => {
    // A page that hands the hook `applicationError: null, applicationLoadedOnce: true`
    // permanently lies about the list's load state -- a failed or
    // still-in-flight load would read as "ready" (§4 A-2's exact failure
    // mode) no matter what actually happened.
    expect(callSite[0]).toMatch(/\bapplicationError,/);
    expect(callSite[0]).toMatch(/\bapplicationLoadedOnce,/);
    expect(callSite[0]).not.toMatch(/applicationError\s*:/);
    expect(callSite[0]).not.toMatch(/applicationLoadedOnce\s*:/);
  });
});

// ---------------------------------------------------------------------------
// §4 A-3 (row 4 of this wave's review): the stranded-row compensation must
// filter by TRACKING_TAB_HIDDEN_STATUSES, not merely "has an appliedAt".
// This lives inside app/hooks/useDuplicateApplyCheck.js itself, not at a
// page.js call site -- included here (which already reads a sibling file's
// source for the StatusBar.js check above) because useDuplicateApplyCheck.test.js's
// own "stranded is false when there is no entry" case does not exercise this
// branch and so cannot fail if the status filter is dropped.
// ---------------------------------------------------------------------------

describe("[row 4] the stranded-row compensation filters by TRACKING_TAB_HIDDEN_STATUSES", () => {
  const hookSource = readFileSync(
    fileURLToPath(new URL("./hooks/useDuplicateApplyCheck.js", import.meta.url)),
    "utf8",
  );

  it("candidateStrandedApplied requires the stranded status to be a hidden tracking-tab status, not merely a present appliedAt", () => {
    // Dropping `TRACKING_TAB_HIDDEN_STATUSES.includes(stranded.status) &&`
    // would let ANY stranded row with an appliedAt count -- including one at
    // a perfectly normal, still-visible status -- over-firing the
    // compensation far beyond the legacy-row-demoted-to-a-hidden-status case
    // it exists for (§4 A-3).
    expect(hookSource).toMatch(
      /candidateStrandedApplied\s*=\s*[\s\S]{0,20}!!stranded\s*&&\s*TRACKING_TAB_HIDDEN_STATUSES\.includes\(stranded\.status\)\s*&&\s*stranded\.appliedAt\s*!=\s*null/,
    );
  });
});
