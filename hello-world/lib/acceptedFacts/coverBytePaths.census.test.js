// N35 / 4b -- PB1 from `chunks/N40/plan.check.r2.md`, paths 4 and 5.
//
// PB1 asks for all FIVE download and save paths. Three of them
// (preview download, the Drive/preview `buildPreviewBlob` seam, the chip
// download) are driven behaviourally in `app/hooks/acceptNoEngineBytes.test.js`.
// The other two are drag handlers -- `app/components/StatusBar.js:392` and
// `app/components/TrackingTab.js:280` -- and the plan's claim about them is
// not "they serve the right bytes" but "they cannot serve a COVER document at
// all". That is a claim about which arguments exist at a call site, and the
// honest instrument for it is a CALL-SITE CENSUS, not a behavioural drive of
// two components whose drag payloads never touch this chunk's code.
//
// plan r3 §5.1 ST-N26 already censuses `resolveDocumentBlob` CALL SITES. The
// plan checker's finding is that a call-site census is the WRONG instrument
// for an argument-shaped claim: it counts the sites and says nothing about
// what each one passes. This file censuses the ARGUMENTS, which is the claim.
//
// A source-text sweep needs its own canary or it is a prose assertion. Every
// classification below is proven to fire against a FABRICATED module written
// for the purpose (a new member, not the ones already in the table), so the
// sweep is shown to discriminate rather than asserted to.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Every function that can turn an entry into a .docx blob. `buildPreviewBlob`
// and `previewBlobArgs` are included because the Drive save reaches the bytes
// through them and not through `resolveDocumentBlob` directly.
const BYTE_BUILDERS = ["resolveDocumentBlob", "downloadDocxFiles", "buildPreviewBlob", "previewBlobArgs"];

// A call is COVER-CAPABLE when its argument text names a cover-letter field
// with a value that is not a hard-coded empty literal, or passes the literal
// scope "cover". `coverLetterResultLines: []` is what the two drag paths and
// the application card pass -- the field is NAMED but can never carry a
// letter -- so a classifier that only looked for the token would call three
// resume-only sites cover-capable and the census would say nothing.
const EMPTY_COVER_FIELD = /coverLetter[A-Za-z0-9_$]*\s*:\s*(\[\s*\]|""|''|``)/g;
const COVER_TOKENS = /coverLetter|"cover"|'cover'|`cover`/;

function isCoverCapable(args) {
  return COVER_TOKENS.test(args.replace(EMPTY_COVER_FIELD, " "));
}

function listJsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      listJsFiles(full, out);
    } else if (name.endsWith(".js") && !name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

// Pull out the full argument text of every `<name>(` call, by balancing
// parentheses over comment-stripped source. A regex that stops at the first
// `)` would truncate every multi-line object argument in this repo -- which is
// all of them -- and silently classify a cover call as resume-only.
function callArgumentsOf(code, name) {
  const found = [];
  const needle = `${name}(`;
  let at = code.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? "" : code[at - 1];
    // Skip `xDownloadDocxFiles(` and the like; allow `.`, `=`, whitespace, `(`.
    if (!/[A-Za-z0-9_$]/.test(before)) {
      let depth = 0;
      let i = at + needle.length - 1;
      for (; i < code.length; i += 1) {
        if (code[i] === "(") depth += 1;
        else if (code[i] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      found.push(code.slice(at + needle.length, i));
    }
    at = code.indexOf(needle, at + 1);
  }
  return found;
}

function censusOver(files) {
  const rows = [];
  for (const { rel, code } of files) {
    for (const builder of BYTE_BUILDERS) {
      for (const args of callArgumentsOf(code, builder)) {
        rows.push({ rel, builder, cover: isCoverCapable(args) });
      }
    }
  }
  return rows;
}

function realFiles() {
  return [...listJsFiles(path.join(ROOT, "app")), ...listJsFiles(path.join(ROOT, "lib"))].map((full) => ({
    rel: path.relative(ROOT, full).split(path.sep).join("/"),
    code: stripComments(readFileSync(full, "utf8")),
  }));
}

// ---------------------------------------------------------------------------
// Canary FIRST. If the classifier cannot see a fabricated cover call, nothing
// it says about the real tree means anything.
// ---------------------------------------------------------------------------

describe("the census instrument discriminates (canary)", () => {
  const FABRICATED_COVER = `
    // resolveDocumentBlob({ engineDocxB64: entry.coverLetterDocxB64 }) -- a COMMENT, must not count
    export async function dragCoverLetter(entry, file) {
      const blob = await resolveDocumentBlob({
        engineDocxB64: typeof entry.coverLetterDocxB64 === "string" ? entry.coverLetterDocxB64 : "",
        docxPath: "",
        edited: false,
        text: (entry.coverLetterResultLines || []).join("\\n"),
        lines: entry.coverLetterResultLines || [],
        uploadedTemplate: file,
      });
      return blob;
    }
  `;
  const FABRICATED_RESUME = `
    export async function dragResume(entry, file) {
      return resolveDocumentBlob({
        engineDocxB64: entry.docxB64 || "",
        docxPath: entry.docxPath || "",
        edited: false,
        text: entry.result,
        lines: entry.resultLines,
        uploadedTemplate: file,
      });
    }
  `;

  it("finds a NEW cover-capable call site that is not one of the ones already in the table", () => {
    const rows = censusOver([{ rel: "app/components/Fabricated.js", code: stripComments(FABRICATED_COVER) }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cover).toBe(true);
  });

  it("classifies a NEW resume-only call site as resume-only", () => {
    const rows = censusOver([{ rel: "app/components/Fabricated.js", code: stripComments(FABRICATED_RESUME) }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cover).toBe(false);
  });

  it("reads through a multi-line argument object rather than stopping at the first close paren", () => {
    // The specific defect this parser exists to avoid. `typeof x === "string" ? ... : ""`
    // contains no parens, but `(entry.coverLetterResultLines || []).join(...)` does.
    const [args] = callArgumentsOf(stripComments(FABRICATED_COVER), "resolveDocumentBlob");
    expect(args).toContain("uploadedTemplate");
    expect(args).toContain("coverLetterResultLines");
  });

  it("the empty-literal exemption is narrow: a NAMED cover field with a real value still counts", () => {
    // The exemption exists only for `coverLetterResultLines: []`. If it were
    // wider, the three resume-only rows below would be resume-only for the
    // wrong reason and the census would be measuring the exemption, not the
    // tree. Both directions are asserted on a fabricated pair.
    const live = `downloadDocxFiles({ result: "", coverLetterResultLines: lines, docxB64: "" });`;
    const dead = `downloadDocxFiles({ result: r, resultLines: l, coverLetterResultLines: [], docxPath: p });`;
    expect(censusOver([{ rel: "a.js", code: live }])[0].cover).toBe(true);
    expect(censusOver([{ rel: "b.js", code: dead }])[0].cover).toBe(false);
    // And an empty-string byte field is exempt the same way.
    const deadBytes = `downloadDocxFiles({ result: r, coverLetterDocxB64: "", resultLines: l });`;
    expect(censusOver([{ rel: "c.js", code: deadBytes }])[0].cover).toBe(false);
  });

  it("does not count a mention inside a comment", () => {
    const rows = censusOver([
      { rel: "x.js", code: stripComments(`// resolveDocumentBlob({ coverLetterDocxB64: x })\nconst y = 1;`) },
    ]);
    expect(rows).toHaveLength(0);
  });

  it("the sweep reaches the real tree at all", () => {
    const files = realFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.rel === "lib/document/docx.js")).toBe(true);
    expect(files.some((f) => f.rel === "app/components/StatusBar.js")).toBe(true);
    expect(files.some((f) => f.rel === "app/components/TrackingTab.js")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The census.
// ---------------------------------------------------------------------------

describe("every cover-capable byte path is one this chunk's tests actually drive (PB1, paths 4-5)", () => {
  // The five paths of plan.check.r2's table, plus the sixth cover-shaped
  // entry point it found. `cover: false` means the site cannot serve an
  // accepted cover fact at all, which is the whole claim about paths 4 and 5.
  const EXPECTED_COVER_CAPABLE = [
    "app/hooks/useDocumentPreview.js", // path 1, the preview download's args
    "app/hooks/useDriveDocuments.js", // path 2's caller (:157 and :591)
    "app/page.js", // path 3, the chip download (:2066, :2576)
    "lib/document/docx.js", // downloadDocxFiles' own cover branch (paths 1 and 3)
    "lib/document/previewBlob.js", // path 2, the Drive save / preview render seam
  ];
  const EXPECTED_RESUME_ONLY = [
    "app/components/StatusBar.js", // path 4, the status-bar drag
    "app/components/TrackingTab.js", // path 5, the tracking-row drag
    "app/components/tracking/ApplicationCard.js", // the sixth, found by the checker
  ];

  it("no module outside the known set builds cover bytes", () => {
    const rows = censusOver(realFiles());
    const coverFiles = [...new Set(rows.filter((r) => r.cover).map((r) => r.rel))].sort();
    expect(coverFiles).toEqual([...EXPECTED_COVER_CAPABLE].sort());
  });

  it("the two drag paths and the application card pass no cover field at all", () => {
    const rows = censusOver(realFiles());
    for (const rel of EXPECTED_RESUME_ONLY) {
      const mine = rows.filter((r) => r.rel === rel);
      // Precondition: the site exists. Without this the loop passes when a
      // file is renamed, which is exactly the false-absence this repo keeps
      // getting bitten by.
      expect(mine.length, `${rel} has no byte-builder call site any more`).toBeGreaterThan(0);
      expect(mine.every((r) => r.cover === false), `${rel} gained a cover-capable call`).toBe(true);
    }
  });

  it("the census is not vacuous: the real tree yields more than a handful of sites", () => {
    const rows = censusOver(realFiles());
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.some((r) => r.cover)).toBe(true);
    expect(rows.some((r) => !r.cover)).toBe(true);
  });
});

// WHAT THIS CANNOT CATCH. It is a source sweep: it sees which fields a call
// site NAMES, never what the values are at run time. A site that passes
// `coverLetterDocxB64` under a different local name -- `bytes`, say, aliased
// three frames up -- is invisible to it. That is why the three paths this
// chunk actually changes are driven behaviourally next door instead, and why
// this file is scoped to the two drag handlers whose payload objects are
// written out literally at the call site.
