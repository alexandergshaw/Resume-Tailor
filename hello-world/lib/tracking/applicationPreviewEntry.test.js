// N132 AC-9 (helper fidelity / anti-drift), plus the show/hide predicate and
// the on-demand population shape that AC-5/AC-7 rely on.
//
// WHY THIS FILE EXISTS. `rehydratedEntryFromApp` is extracted (plan Step 1)
// from the inline literal the rehydration effect builds at page.js:1301-1333,
// and is to become the SINGLE source for a tracking row's tailoringMap entry
// -- used by BOTH that effect and the new on-demand open handler
// (openApplicationPreview). The silent failure this guards (plan R-2): the
// two builders drift, so a row rehydrated by the effect and the same row
// opened on demand disagree, each "works", neither throws. The only thing
// that catches it is an exact deep-equality against a frozen copy of the
// effect's literal. That frozen copy -- `effectEntry` below -- is the oracle.
//
// RED REASON (on HEAD): the module `./applicationPreviewEntry.js` does not
// exist yet, so the import throws and every case in this file errors. After
// plan Step 1 lands the module, each case must go green.
//
// This is a PURE module (no React, no I/O), so this file runs in vitest's
// default node environment -- no jsdom docblock.

import { describe, it, expect } from "vitest";

import {
  rehydratedEntryFromApp,
  hasPreviewableDocs,
} from "./applicationPreviewEntry.js";

// ---------------------------------------------------------------------------
// The ORACLE: a byte-for-byte copy of the derivations (page.js:1301-1315) and
// the entry literal (page.js:1317-1333) as they stand on HEAD, re-expressed as
// a pure function of the same inputs the helper takes. After plan Step 1 the
// effect no longer holds this literal (it calls the helper), so THIS copy is
// the spec of record: the helper must reproduce exactly what the effect used
// to build. If a future field is added to the entry it must be added in BOTH
// the helper and here, in lockstep -- that lockstep is the whole point.
// ---------------------------------------------------------------------------
function effectEntry(app, { existing = null, fallbackTitle = "" } = {}) {
  const gen = app.generated_resumes;
  const cover = app.generated_cover_letters;
  const resumeText = typeof gen?.content === "string" ? gen.content : "";
  const resumeLines =
    Array.isArray(gen?.content_lines) && gen.content_lines.length > 0
      ? gen.content_lines
      : resumeText
        ? resumeText.split("\n")
        : [];
  const coverLines =
    Array.isArray(cover?.content_lines) && cover.content_lines.length > 0
      ? cover.content_lines
      : typeof cover?.content === "string" && cover.content
        ? cover.content.split("\n")
        : [];
  if (!resumeText && coverLines.length === 0) return null;
  return {
    ...(existing || {}),
    status: "done",
    downloaded: true,
    generatedJobTitle:
      existing?.generatedJobTitle || app.positions?.title || fallbackTitle || "",
    result: resumeText,
    resultLines: resumeLines,
    coverLetterResultLines: coverLines,
    docxPath: typeof gen?.docx_path === "string" ? gen.docx_path : "",
    coverLetterDocxPath: typeof cover?.docx_path === "string" ? cover.docx_path : "",
    error: "",
  };
}

// ------------------------------------------------------------------ fixtures

const RESUME = {
  content: "Alex Shaw\nStaff Engineer\nBuilt payment surfaces.",
  content_lines: ["Alex Shaw", "Staff Engineer", "Built payment surfaces."],
  docx_path: "resumes/app-1.docx",
};
const COVER = {
  content: "Dear Hiring Manager,\nI would love to join.",
  content_lines: ["Dear Hiring Manager,", "I would love to join."],
  docx_path: "covers/app-1.docx",
};
const POSITIONS = {
  id: "pos-1",
  external_id: "job-ext-1",
  title: "Staff Engineer",
  company: "Acme",
  description: "Build things.",
  url: "https://acme.example.com/job",
};

const appBoth = () => ({
  id: "app-uuid-1",
  application_url: "https://jobs.example.com/apply/1",
  positions: { ...POSITIONS },
  generated_resumes: { ...RESUME },
  generated_cover_letters: { ...COVER },
});
const appResumeOnly = () => ({ ...appBoth(), generated_cover_letters: null });
const appCoverOnly = () => ({ ...appBoth(), generated_resumes: null });
const appNeither = () => ({ ...appBoth(), generated_resumes: null, generated_cover_letters: null });

// ===========================================================================
// AC-9 -- the helper reproduces the effect's entry EXACTLY (anti-drift).
// Each case asserts full structural equality against the oracle, not a subset.
// ===========================================================================

describe("AC-9 rehydratedEntryFromApp deep-equals the effect's literal", () => {
  const CASES = [
    ["resume + cover, no existing", appBoth, { fallbackTitle: "ignored" }],
    ["resume only, no existing", appResumeOnly, { fallbackTitle: "ignored" }],
    ["cover only, no existing", appCoverOnly, { fallbackTitle: "ignored" }],
    [
      "with an existing entry carrying extra fields (spread UNDER rebuild)",
      appBoth,
      {
        existing: {
          jobDescription: "KEEP ME",
          emailResultLines: ["keep", "me"],
          generatedJobTitle: "Existing Title Wins",
          result: "STALE should be overwritten",
        },
        fallbackTitle: "ignored",
      },
    ],
  ];

  for (const [label, makeApp, opts] of CASES) {
    it(`matches the oracle: ${label}`, () => {
      const app = makeApp();
      expect(rehydratedEntryFromApp(app, opts)).toEqual(effectEntry(app, opts));
    });
  }

  it("the no-existing entry has EXACTLY the nine effect keys -- no more, no fewer", () => {
    // A subset assertion would pass against a helper that dropped a field or
    // added a stray one; pin the exact key set.
    const entry = rehydratedEntryFromApp(appBoth(), { fallbackTitle: "x" });
    expect(Object.keys(entry).sort()).toEqual(
      [
        "coverLetterDocxPath",
        "coverLetterResultLines",
        "docxPath",
        "downloaded",
        "error",
        "generatedJobTitle",
        "result",
        "resultLines",
        "status",
      ].sort(),
    );
  });
});

// ===========================================================================
// Precedence lives in the CALLER, not the helper (plan R-2 / design 3b).
// The helper spreads `...(existing||{})` UNDER the rebuilt fields, so every
// field except generatedJobTitle (and caller-only extras) is OVERWRITTEN by
// the stored doc. "In-session wins" is enforced by the caller's skip guard
// (effect page.js:1298 / handler keepExisting), NOT here. Pinning this stops
// an implementer "fixing" the helper to preserve existing.result -- which
// would make the helper diverge from the effect and break AC-9.
// ===========================================================================

describe("helper spread semantics (so the caller owns precedence)", () => {
  it("rebuilt result OVERRIDES a stale existing.result", () => {
    const entry = rehydratedEntryFromApp(appResumeOnly(), {
      existing: { result: "STALE", resultLines: ["STALE"] },
    });
    expect(entry.result).toBe(RESUME.content);
  });

  it("generatedJobTitle PREFERS existing, then positions.title, then fallback", () => {
    expect(
      rehydratedEntryFromApp(appResumeOnly(), { existing: { generatedJobTitle: "FromExisting" } })
        .generatedJobTitle,
    ).toBe("FromExisting");
    expect(rehydratedEntryFromApp(appResumeOnly(), {}).generatedJobTitle).toBe("Staff Engineer");
    const noTitle = appResumeOnly();
    noTitle.positions = { ...noTitle.positions, title: "" };
    expect(rehydratedEntryFromApp(noTitle, { fallbackTitle: "FromFallback" }).generatedJobTitle).toBe(
      "FromFallback",
    );
  });

  it("extra fields on existing survive the rebuild (spread under)", () => {
    const entry = rehydratedEntryFromApp(appBoth(), {
      existing: { jobDescription: "KEEP", emailResultLines: ["a"] },
    });
    expect(entry.jobDescription).toBe("KEEP");
    expect(entry.emailResultLines).toEqual(["a"]);
  });
});

// ===========================================================================
// AC-5 / AC-7 -- the on-demand entry is POPULATED from the stored docs, so the
// modal is never empty. (The open HANDLER's end-to-end version is in
// app/applicationPreviewOpenPath.test.js; this pins the builder's output.)
// ===========================================================================

describe("AC-5/AC-7 the built entry carries the stored content", () => {
  it("resume app: result + resultLines are the stored resume", () => {
    const entry = rehydratedEntryFromApp(appResumeOnly(), {});
    expect(entry.result).toBe(RESUME.content);
    expect(entry.resultLines).toEqual(RESUME.content_lines);
    expect(entry.docxPath).toBe(RESUME.docx_path);
  });

  it("cover app: coverLetterResultLines is non-empty and result is empty string", () => {
    const entry = rehydratedEntryFromApp(appCoverOnly(), {});
    expect(entry.coverLetterResultLines.length).toBeGreaterThan(0);
    expect(entry.coverLetterResultLines).toEqual(COVER.content_lines);
    expect(entry.coverLetterDocxPath).toBe(COVER.docx_path);
    expect(entry.result).toBe("");
  });

  it("derives resultLines by splitting content when content_lines is absent", () => {
    const app = appResumeOnly();
    app.generated_resumes = { content: "L1\nL2\nL3", docx_path: "" };
    expect(rehydratedEntryFromApp(app, {}).resultLines).toEqual(["L1", "L2", "L3"]);
  });
});

// ===========================================================================
// AC-9 null + hasPreviewableDocs matrix (the show/hide predicate).
// ===========================================================================

describe("AC-9 / hasPreviewableDocs the presence predicate", () => {
  it("returns null and reports false for an app with neither resume nor cover", () => {
    expect(rehydratedEntryFromApp(appNeither(), {})).toBeNull();
    expect(hasPreviewableDocs(appNeither())).toBe(false);
  });

  it("hasPreviewableDocs matches 'the helper would build an entry' across the matrix", () => {
    const matrix = [
      ["both", appBoth, true],
      ["resume only", appResumeOnly, true],
      ["cover only", appCoverOnly, true],
      ["neither", appNeither, false],
    ];
    for (const [label, makeApp, expected] of matrix) {
      const app = makeApp();
      expect(hasPreviewableDocs(app), label).toBe(expected);
      // The invariant the control depends on: shown exactly when an entry exists.
      expect(hasPreviewableDocs(app), `${label} parity with builder`).toBe(
        rehydratedEntryFromApp(app, {}) !== null,
      );
    }
  });

  it("an empty-string resume with no cover is NOT previewable (mirrors the effect's !resumeText guard)", () => {
    const app = appCoverOnly();
    app.generated_resumes = { content: "", content_lines: [] };
    app.generated_cover_letters = null;
    expect(hasPreviewableDocs(app)).toBe(false);
    expect(rehydratedEntryFromApp(app, {})).toBeNull();
  });
});
