// N59 step 4 (4b) -- previewBlobArgs must carry the cover letter's own stored
// docx path into resolveDocumentBlob, so a rehydrated letter with no in-session
// bytes resolves branch 2 (fetch the stored engine doc) instead of branch 5
// (rebuild onto the generic uploaded template). AC-1.
//
// This is the PURE half (node, no Blob/JSZip/DOM/Supabase). The IO half -- that
// the path actually reaches storage.download and serves those bytes -- is
// exercised in app/hooks/coverDocxPathReadPath.rc.test.js through the real
// resolveDocumentBlob. An argument-shape assertion here plus the byte assertion
// there is the same split previewBlob.test.js already uses.
//
// RED-ON-HEAD REASON: the cover branch hardcodes `docxPath: ""`
// (lib/document/previewBlob.js:103-105, the F-11 dead-end comment), so a cover
// entry carrying `coverLetterDocxPath` still hands resolveDocumentBlob an empty
// path. The K6 non-regression control below (no field -> "") stays green on
// HEAD and after the fix, so a fix that DROPS the `|| ""` fallback -- changing
// the bytes of every entry that has no path -- is caught here, not downstream.

import { describe, it, expect, vi } from "vitest";

// docx.js drags in the browser Supabase client transitively; stub it so a node
// import does not. Mirrors previewBlob.test.js:24-29 exactly -- not a vi.fn,
// nothing here asserts on it.
vi.mock("../supabase/client", () => ({
  createClient: () => ({}),
}));

import { previewBlobArgs } from "./previewBlob.js";

const COVER_LINES = ["Dear Hiring Manager,", "I would be glad to contribute."];
const COVER_PATH = "user-1/generated/cover-abc123.docx";
const COVER_B64 = "Y292ZXItYnl0ZXM="; // opaque; previewBlobArgs never decodes it
const RESUME_PATH = "user-1/generated/r2.docx";

function coverEntry(over = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: RESUME_PATH, // belongs to the RESUME scope -- must never leak to cover
    coverLetterResultLines: [...COVER_LINES],
    coverLetterDocxB64: "",
    ...over,
  };
}

describe("previewBlobArgs threads the cover letter's own docx_path (AC-1)", () => {
  it("passes coverLetterDocxPath through as docxPath for the cover scope", () => {
    // RED on HEAD: the cover branch returns a hardcoded "" here.
    const args = previewBlobArgs(coverEntry({ coverLetterDocxPath: COVER_PATH }), "cover", {
      coverLetterFile: null,
    });
    expect(args.docxPath).toBe(COVER_PATH);
  });

  it("does NOT borrow the resume scope's docxPath for the cover", () => {
    // The entry's `docxPath` is the resume's stored path; a cover with no path
    // of its own must resolve to "", never the resume's -- serving the resume's
    // engine doc as the cover letter would be a silent cross-scope leak.
    const args = previewBlobArgs(coverEntry({ coverLetterDocxPath: "" }), "cover", {
      coverLetterFile: null,
    });
    expect(args.docxPath).toBe("");
    expect(args.docxPath).not.toBe(RESUME_PATH);
  });

  it("K6 CONTROL: an entry with no coverLetterDocxPath field is byte-identical to today ('')", () => {
    // GREEN on HEAD and after the fix. A fix that drops the `|| ""` fallback and
    // passes `undefined` changes resolveDocumentBlob's input for every existing
    // entry -- this control fails on that regression while the RED test above
    // still passes, so the two together pin BOTH directions.
    const e = coverEntry();
    delete e.coverLetterDocxPath;
    const args = previewBlobArgs(e, "cover", { coverLetterFile: null });
    expect(args.docxPath).toBe("");
    expect(typeof args.docxPath).toBe("string");
  });

  it("coerces a non-string coverLetterDocxPath to ''", () => {
    // A malformed row must not put an object/number into resolveDocumentBlob's
    // path branch (which would then call storage.download on garbage).
    const args = previewBlobArgs(coverEntry({ coverLetterDocxPath: { oops: 1 } }), "cover", {
      coverLetterFile: null,
    });
    expect(args.docxPath).toBe("");
  });

  it("still surfaces in-session cover bytes when present (non-regression)", () => {
    // The path is the RELOAD fallback; when the session still has the engine
    // bytes, those remain the primary source (branch 1). The path threading
    // must not disturb engineDocxB64.
    const args = previewBlobArgs(
      coverEntry({ coverLetterDocxB64: COVER_B64, coverLetterDocxPath: COVER_PATH }),
      "cover",
      { coverLetterFile: null },
    );
    expect(args.engineDocxB64).toBe(COVER_B64);
    expect(args.docxPath).toBe(COVER_PATH);
  });

  it("does not disturb the resume scope's own docxPath threading", () => {
    // Over-broad-fix control: the resume branch must keep reading e.docxPath,
    // not switch to coverLetterDocxPath.
    const e = coverEntry({ result: "R", resultLines: ["R"], coverLetterDocxPath: COVER_PATH });
    const args = previewBlobArgs(e, "resume", { resumeFile: null });
    expect(args.docxPath).toBe(RESUME_PATH);
  });
});
