// N59 step 4 (4b) -- the LAST-HOP census the behavioural tests cannot reach.
// AC-1 / AC-4 threading through app/page.js.
//
// The read-path behaviour tests hand-build an entry that already carries
// coverLetterDocxPath and prove the CONSUMER (previewBlobArgs, resolve, accept,
// auto-insert) does the right thing with it. None of them proves that a saved
// application, loaded and rehydrated by app/page.js, actually PRODUCES that
// field. That last hop -- loadApplications selecting docx_path, and the
// rehydration effect threading it onto the entry -- lives inside a ~4k-line god
// component with no mountable seam. It is exactly the class of defect this repo
// keeps shipping: a complete correct mechanism behind a green suite with the
// wiring to the user missing. So it is pinned by a source census, the repo's
// accepted instrument for god-component threading (see
// lib/supabase/persistCoverDocx.callsite.census.test.js), with its own canaries
// proving each classifier fires against FABRICATED snippets before it is trusted
// against the real file.
//
// RED-ON-HEAD REASON: the cover select at app/page.js:1134-1136 is
// "id, content, content_lines" (no docx_path -- the resume select above it has
// it, the cover one does not), and the rehydration merged entry (app/page.js
// ~:1315-1327) threads `docxPath: gen?.docx_path` for the resume but nothing
// named coverLetterDocxPath for the cover.
//
// WHAT THIS CANNOT CATCH (stated per rule): a source census sees which fields are
// NAMED and what they read from, never the runtime value. A select that names
// docx_path but against the wrong table, or a threading that reads the wrong
// object, would still need the behavioural + reference-build coverage to expose.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "app", "page.js");
// N132 step 1 extracted the rehydrated-entry builder out of app/page.js into this
// helper. The coverLetterDocxPath literal now lives ONLY here; page.js reaches it
// through rehydratedEntryFromApp (asserted separately below).
const ENTRY_HELPER = path.join(ROOT, "lib", "tracking", "applicationPreviewEntry.js");

// --- classifiers ----------------------------------------------------------

// The `.select("...")` string argument of the FIRST `.from("generated_cover_letters")`
// chain in the source (loadApplications). Returns the select literal, or "" if
// no such select is found.
function coverSelectArg(code) {
  const from = /\.from\(\s*["'`]generated_cover_letters["'`]\s*\)/.exec(code);
  if (!from) return "";
  const after = code.slice(from.index);
  const sel = /\.select\(\s*(["'`])([^"'`]*)\1\s*\)/.exec(after);
  return sel ? sel[2] : "";
}

function coverSelectNamesDocxPath(code) {
  return /\bdocx_path\b/.test(coverSelectArg(code));
}

// Whether a merged/rehydrated entry threads coverLetterDocxPath from the cover
// row's docx_path. Captures the value expression up to the terminating comma or
// newline and checks it reads `cover?.docx_path` / `cover.docx_path` (the cover
// row object bound in lib/tracking/applicationPreviewEntry.js's storedCoverLines),
// not the resume's `gen`.
function coverPathThreadingValue(code) {
  const m = /(^|[^A-Za-z0-9_$])coverLetterDocxPath\s*:\s*([^\n]+)/.exec(code);
  return m ? m[2] : null;
}

function threadsCoverPath(code) {
  const value = coverPathThreadingValue(code);
  if (value === null) return false;
  return /\bcover\s*\??\.\s*docx_path\b/.test(value);
}

// Whether the source CALLS rehydratedEntryFromApp (an actual invocation, not the
// import binding and not a mention in a comment). Once the literal moved into the
// helper, this call is the only thing keeping page.js's rehydration effect
// connected to the cover-path threading.
function callsRehydratedEntryHelper(code) {
  return /(^|[^A-Za-z0-9_$])rehydratedEntryFromApp\s*\(/.test(code);
}

// --- canary FIRST ---------------------------------------------------------

describe("the read-path census discriminates (canary)", () => {
  it("classifies a cover select WITH docx_path as naming it, WITHOUT as not", () => {
    const withCol = stripComments(`
      const x = await supabase.from("generated_cover_letters")
        .select("id, content, content_lines, docx_path").in("id", ids);
    `);
    const without = stripComments(`
      const x = await supabase.from("generated_cover_letters")
        .select("id, content, content_lines").in("id", ids);
    `);
    expect(coverSelectNamesDocxPath(withCol)).toBe(true);
    expect(coverSelectNamesDocxPath(without)).toBe(false);
  });

  it("does not mistake the resume select's docx_path for the cover's", () => {
    // The resume select DOES carry docx_path; the classifier must key off the
    // generated_cover_letters `.from`, not any docx_path anywhere in the file.
    const resumeOnly = stripComments(`
      const r = await supabase.from("generated_resumes")
        .select("id, content, content_lines, docx_path").in("id", rids);
      const c = await supabase.from("generated_cover_letters")
        .select("id, content, content_lines").in("id", cids);
    `);
    expect(coverSelectNamesDocxPath(resumeOnly)).toBe(false);
  });

  it("classifies a rehydration threading coverLetterDocxPath from cover?.docx_path as threaded", () => {
    const threaded = stripComments(`
      next[job.id] = {
        coverLetterResultLines: coverLines,
        docxPath: typeof gen?.docx_path === "string" ? gen.docx_path : "",
        coverLetterDocxPath: typeof cover?.docx_path === "string" ? cover.docx_path : "",
      };
    `);
    expect(threadsCoverPath(threaded)).toBe(true);
  });

  it("classifies a rehydration that threads only the resume path as NOT cover-threaded (the RED shape)", () => {
    const resumeOnly = stripComments(`
      next[job.id] = {
        coverLetterResultLines: coverLines,
        docxPath: typeof gen?.docx_path === "string" ? gen.docx_path : "",
      };
    `);
    expect(threadsCoverPath(resumeOnly)).toBe(false);
  });

  it("does not count a coverLetterDocxPath that reads from the wrong object", () => {
    // A threading that copies the resume's `gen` path into the cover field would
    // silently serve the resume doc as the cover letter -- not threaded.
    const wrongSource = stripComments(`coverLetterDocxPath: gen?.docx_path || "",`);
    expect(threadsCoverPath(wrongSource)).toBe(false);
  });

  it("does not count a mention inside a comment", () => {
    const commented = stripComments(`// coverLetterDocxPath: cover?.docx_path\nconst y = 1;`);
    expect(threadsCoverPath(commented)).toBe(false);
  });

  it("classifies a real call of rehydratedEntryFromApp as a call, an import or comment as not", () => {
    const called = stripComments(
      `const entry = rehydratedEntryFromApp(app, { existing, fallbackTitle: job.title });`
    );
    const importOnly = stripComments(
      `import { rehydratedEntryFromApp } from "../lib/tracking/applicationPreviewEntry";`
    );
    const commented = stripComments(`// rehydratedEntryFromApp(app)\nconst y = 1;`);
    expect(callsRehydratedEntryHelper(called)).toBe(true);
    expect(callsRehydratedEntryHelper(importOnly)).toBe(false);
    expect(callsRehydratedEntryHelper(commented)).toBe(false);
  });
});

// --- the census against the real file -------------------------------------

describe("app/page.js wires the cover letter's docx_path from load to entry (AC-1/AC-4)", () => {
  const source = () => stripComments(readFileSync(PAGE, "utf8"));

  it("precondition: page.js is present and holds the loadApplications cover fetch", () => {
    // A rename or a move must not silently empty this census (the false-absence
    // trap). If this fails, the two assertions below are void, not passing.
    const code = source();
    expect(/\.from\(\s*["'`]generated_cover_letters["'`]\s*\)/.test(code)).toBe(true);
    expect(coverSelectArg(code)).toContain("content_lines");
  });

  it("the loadApplications cover select fetches docx_path", () => {
    // RED on HEAD: the cover select is "id, content, content_lines".
    expect(coverSelectNamesDocxPath(source())).toBe(true);
  });

  // N132 step 1 retarget: the merged-entry construction (and with it the
  // `coverLetterDocxPath: ...cover?.docx_path` literal) moved out of page.js into
  // lib/tracking/applicationPreviewEntry.js's rehydratedEntryFromApp. The N59
  // intent is unchanged -- the entry carries the COVER letter's own stored docx
  // path, never the resume's -- so the literal grep follows it to the helper, and
  // page.js is asserted to still go through that helper.
  const helperSource = () => stripComments(readFileSync(ENTRY_HELPER, "utf8"));

  it("precondition: the entry helper is present and builds the rehydrated entry", () => {
    // A rename or move of the helper must not silently empty the threading
    // assertion below (false-absence trap): the file must exist and still be the
    // place that threads the resume's docxPath, the sibling field.
    const code = helperSource();
    expect(/\bdocxPath\s*:/.test(code)).toBe(true);
    expect(/export\s+function\s+rehydratedEntryFromApp\b/.test(code)).toBe(true);
  });

  it("the rehydration threads coverLetterDocxPath from the cover row", () => {
    // RED on HEAD (pre-N132-step-1: page.js; now: the helper): no
    // coverLetterDocxPath is written onto the merged entry.
    expect(threadsCoverPath(helperSource())).toBe(true);
  });

  it("app/page.js builds the rehydrated entry through the helper", () => {
    // Without this call the helper's cover-path threading never reaches the
    // tailoringMap, and the assertion above would pass against dead code.
    expect(callsRehydratedEntryHelper(source())).toBe(true);
  });
});
