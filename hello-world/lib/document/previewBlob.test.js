// Wave 1A -- the PURE half of the buildPreviewBlob extraction
// (lib/document/previewBlob.js). This is the byte seam the whole Drive
// feature rests on (AC-S6), and it had no test of any kind before this file:
// buildPreviewBlob was a private function inside a 963-line hook, and no test
// anywhere imported that hook.
//
// environment: node, deliberately. Everything asserted here is a pure
// derivation -- no Blob, no JSZip, no DOM, no Supabase. The IO half
// (buildPreviewBlob itself) is exercised through the REAL byte pipeline in
// app/hooks/useDocumentPreview.wiring.test.js, where an argument-shape
// assertion would not have been good enough.
//
// This file deliberately does NOT mock lib/document/docx. previewBlob.js
// imports resolveDocumentBlob from it, and app/hooks/useManualTailor.test.js:22-24
// mocks that module with a factory providing ONLY buildTemplateLinesForUpload
// -- so any test that mocks lib/document/docx AND transitively loads this
// module gets `undefined` at CALL time rather than a failure at import time
// (ARCH.md 4.5). Only lib/supabase/client is stubbed, and only so that
// importing docx.js in a `node` environment does not drag in the browser
// Supabase client.

import { describe, it, expect, vi } from "vitest";

vi.mock("../supabase/client", () => ({
  // Not a vi.fn: nothing here asserts on it, and a bare function cannot go
  // stale between tests the way a factory-created vi.fn does (this config
  // sets neither clearMocks nor restoreMocks).
  createClient: () => ({}),
}));

import { normalizeResultLines } from "./docx.js";

import {
  editedForScope,
  withEditedScope,
  scopeText,
  previewBlobArgs,
} from "./previewBlob.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Sentinels, not real Files: previewBlobArgs must pass the template through by
// identity and must never inspect it. `toBe`-style identity falls out of
// toEqual on these because they are the same object reference.
const RESUME_FILE = { __template: "resume" };
const COVER_FILE = { __template: "cover" };
const OPTS = { resumeFile: RESUME_FILE, coverLetterFile: COVER_FILE };

const RESUME_LINES = ["Staff Engineer", "Shipped the thing"];
const RESUME_TEXT = RESUME_LINES.join("\n");
const COVER_LINES = ["Dear hiring team", "Regards, A"];
const COVER_TEXT = COVER_LINES.join("\n");

const RESUME_B64 = "UkVTVU1FLURPQ1g=";
const COVER_B64 = "Q09WRVItRE9DWA==";
const DOCX_PATH = "user-1/generated/v2.docx";

// A text the user has typed over the stored one -- the "text changed" axis.
const CHANGED_TEXT = "Staff Engineer\nShipped the thing, twice";

function entryFor({ scope, hasB64, hasPath, edited }) {
  return {
    result: RESUME_TEXT,
    resultLines: RESUME_LINES,
    coverLetterResultLines: COVER_LINES,
    docxB64: hasB64 ? RESUME_B64 : "",
    coverLetterDocxB64: hasB64 ? COVER_B64 : "",
    docxPath: hasPath ? DOCX_PATH : "",
    // edited is a PER-SCOPE OBJECT and an object is ALWAYS truthy -- the
    // reason editedForScope exists at all.
    edited: { resume: false, cover: false, [scope]: edited },
    status: "done",
  };
}

// The contract, re-derived independently from ARCH.md 1(c) rather than by
// calling the module under test:
//
//   text omitted  -> text = scopeText(entry, scope)
//                    edited = editedForScope(entry, scope)
//   text supplied -> text = the supplied text
//                    edited = editedForScope(entry, scope) || text !== scopeText(entry, scope)
//
// and the cover scope NEVER carries docxPath: generated_cover_letters has no
// docx_path column, so entry.docxPath belongs to the RESUME. Handing it to the
// cover branch would serve the resume's stored .docx as the cover letter.
//
// `lines` is pinned to the stored array (COVER_LINES/RESUME_LINES) ONLY for
// "text omitted" and "text supplied unchanged" -- the NARROWED half of the
// original pin. It no longer holds for "text supplied changed": a text that
// actually diverges from what's stored is draft content the entry's own
// resultLines/coverLetterResultLines have not caught up to yet (see the
// comment on previewBlobArgs), so `lines` is re-derived from that text via
// normalizeResultLines instead of the stale stored array. This is the fix
// for the staleness bug the join test below exercises end to end.
function expectedArgs({ scope, hasB64, hasPath, edited, text }) {
  const stored = scope === "cover" ? COVER_TEXT : RESUME_TEXT;
  const storedLines = scope === "cover" ? COVER_LINES : RESUME_LINES;
  const textChanged = text !== undefined && text !== stored;
  return {
    engineDocxB64: hasB64 ? (scope === "cover" ? COVER_B64 : RESUME_B64) : "",
    docxPath: scope === "cover" ? "" : hasPath ? DOCX_PATH : "",
    edited: text === undefined ? edited : edited || textChanged,
    text: text === undefined ? stored : text,
    lines: textChanged ? normalizeResultLines(text) : storedLines,
    uploadedTemplate: scope === "cover" ? COVER_FILE : RESUME_FILE,
  };
}

const ARG_KEYS = [
  "engineDocxB64",
  "docxPath",
  "edited",
  "text",
  "lines",
  "uploadedTemplate",
];

// resolveDocumentBlob defaults engineDocxB64/docxPath to "" and
// uploadedTemplate to null, so an omitted key and an empty one are the same
// call. Normalising here keeps the table from pinning a distinction that does
// not exist, while still pinning every value that changes which branch of
// resolveDocumentBlob is taken.
function normalize(args) {
  return {
    engineDocxB64: args.engineDocxB64 || "",
    docxPath: args.docxPath || "",
    edited: args.edited,
    text: args.text,
    lines: args.lines,
    uploadedTemplate: args.uploadedTemplate ?? null,
  };
}

const TEXT_MODES = [
  { label: "text omitted", text: undefined },
  { label: "text supplied unchanged", text: null }, // filled in per scope below
  { label: "text supplied changed", text: CHANGED_TEXT },
];

const TABLE = [];
for (const scope of ["resume", "cover"]) {
  for (const hasB64 of [true, false]) {
    for (const hasPath of [true, false]) {
      for (const edited of [true, false]) {
        for (const mode of TEXT_MODES) {
          const stored = scope === "cover" ? COVER_TEXT : RESUME_TEXT;
          const text = mode.text === null ? stored : mode.text;
          TABLE.push({
            name:
              `${scope} / docxB64=${hasB64} / docxPath=${hasPath} / ` +
              `handEdited=${edited} / ${mode.label}`,
            scope,
            hasB64,
            hasPath,
            edited,
            text,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AC-S6 -- the argument table
// ---------------------------------------------------------------------------

describe("previewBlobArgs derives the exact resolveDocumentBlob call (AC-S6)", () => {
  it.each(TABLE)("$name", (row) => {
    const entry = entryFor(row);
    const args = previewBlobArgs(entry, row.scope, {
      ...OPTS,
      ...(row.text === undefined ? {} : { text: row.text }),
    });
    expect(args).not.toBeNull();
    expect(normalize(args)).toEqual(expectedArgs(row));
  });

  it("returns no keys resolveDocumentBlob does not accept", () => {
    // An extra key is not harmless: resolveDocumentBlob destructures a fixed
    // set, so a stray `docxB64` (rather than `engineDocxB64`) would be
    // silently dropped and every document would fall to the uploaded
    // template.
    for (const row of TABLE) {
      const args = previewBlobArgs(entryFor(row), row.scope, OPTS);
      expect(ARG_KEYS).toEqual(expect.arrayContaining(Object.keys(args)));
    }
  });

  it("keeps enough rows where the supplied text alone must flip `edited`", () => {
    // AC-S6's positive control, made structural: mutating the edited
    // derivation to a plain editedForScope(entry, scope) must fail at least
    // three rows. This asserts the TABLE still contains at least three such
    // rows, so a later edit that trims the table cannot quietly remove the
    // discrimination the criterion is buying.
    const discriminating = TABLE.filter(
      (row) =>
        row.edited === false &&
        row.text !== undefined &&
        row.text !== (row.scope === "cover" ? COVER_TEXT : RESUME_TEXT),
    );
    expect(discriminating.length).toBeGreaterThanOrEqual(3);
    for (const row of discriminating) {
      const args = previewBlobArgs(entryFor(row), row.scope, {
        ...OPTS,
        text: row.text,
      });
      expect(args.edited).toBe(true);
    }
  });

  it("does not flip `edited` when the supplied text equals what is stored", () => {
    // The other half of the same control: an implementation that returns
    // `edited: true` whenever a text argument is present passes the test
    // above and fails this one. Without it, "text was supplied" and "text
    // changed" are indistinguishable, and every unedited document would be
    // rebuilt instead of served verbatim.
    const entry = entryFor({ scope: "resume", hasB64: true, hasPath: false, edited: false });
    expect(previewBlobArgs(entry, "resume", { ...OPTS, text: RESUME_TEXT }).edited).toBe(false);
  });
});

describe("previewBlobArgs and the scopes that have no .docx", () => {
  it("returns null for the hiring email, whatever the entry holds", () => {
    // The email is plain text pasted into a mail client, never a docx-backed
    // document (useDocumentPreview.js:394-397). Returning args here would
    // send the resume's bytes to Drive under the email scope.
    for (const hasB64 of [true, false]) {
      const entry = entryFor({ scope: "resume", hasB64, hasPath: true, edited: false });
      entry.emailResultLines = ["Hi there", "Attached is my resume"];
      expect(previewBlobArgs(entry, "email", OPTS)).toBeNull();
    }
  });

  it("positive control: the same entry yields args for the resume scope", () => {
    // Pairs with the absence assertion above -- without it, a
    // previewBlobArgs that returned null for EVERY scope would pass.
    const entry = entryFor({ scope: "resume", hasB64: true, hasPath: true, edited: false });
    entry.emailResultLines = ["Hi there"];
    expect(previewBlobArgs(entry, "resume", OPTS)).not.toBeNull();
  });
});

describe("previewBlobArgs tolerates the entry shapes the map really holds", () => {
  it("handles an empty entry without throwing", () => {
    // tailoringMap[jobId] || {} -- the caller can and does pass {}.
    expect(normalize(previewBlobArgs({}, "resume", OPTS))).toEqual({
      engineDocxB64: "",
      docxPath: "",
      edited: false,
      text: "",
      lines: [],
      uploadedTemplate: RESUME_FILE,
    });
  });

  it("coerces a non-array resultLines to an empty array", () => {
    // alignLinesToSlots iterates `lines`; a string would iterate per
    // character and produce a document of single letters.
    const args = previewBlobArgs(
      { result: "x", resultLines: "not an array" },
      "resume",
      OPTS,
    );
    expect(args.lines).toEqual([]);
  });

  it("coerces a non-string docxB64/docxPath to an empty string", () => {
    const args = previewBlobArgs(
      { result: "x", resultLines: ["x"], docxB64: 12, docxPath: {} },
      "resume",
      OPTS,
    );
    expect(args.engineDocxB64).toBe("");
    expect(args.docxPath).toBe("");
  });

  it("falls back to the joined lines when `result` is empty", () => {
    // Today's buildPreviewBlob is `text: entry.result || lines.join("\n")`
    // (useDocumentPreview.js:414), NOT scopeText, which returns "" here.
    // The difference is not cosmetic: an empty text makes
    // resolveDocumentBlob's `hasText` false, which serves the engine doc
    // verbatim instead of rebuilding the edited text onto it. The extraction
    // must preserve behaviour.
    const args = previewBlobArgs(
      { result: "", resultLines: RESUME_LINES, edited: { resume: true, cover: false } },
      "resume",
      OPTS,
    );
    expect(args.text).toBe(RESUME_TEXT);
  });

  it("reads a legacy plain-boolean `edited` on both scopes", () => {
    // A `true` from before the per-scope migration must read as edited on
    // BOTH scopes -- the safe direction, since it forces a rebuild rather
    // than risking a stale verbatim serve.
    const legacy = {
      result: RESUME_TEXT,
      resultLines: RESUME_LINES,
      coverLetterResultLines: COVER_LINES,
      edited: true,
    };
    expect(previewBlobArgs(legacy, "resume", OPTS).edited).toBe(true);
    expect(previewBlobArgs(legacy, "cover", OPTS).edited).toBe(true);
    expect(previewBlobArgs({ ...legacy, edited: false }, "resume", OPTS).edited).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The three helpers that move with it
// ---------------------------------------------------------------------------

describe("editedForScope", () => {
  it("reads the per-scope object independently", () => {
    const entry = { edited: { resume: true, cover: false } };
    expect(editedForScope(entry, "resume")).toBe(true);
    expect(editedForScope(entry, "cover")).toBe(false);
  });

  it("never reports edited just because the object is truthy", () => {
    // The defect this helper exists to prevent: `if (entry.edited)` is true
    // for { resume: false, cover: false }.
    expect(editedForScope({ edited: { resume: false, cover: false } }, "resume")).toBe(false);
  });

  it("treats a missing flag as not edited, and a legacy boolean on both scopes", () => {
    expect(editedForScope({}, "resume")).toBe(false);
    expect(editedForScope(undefined, "resume")).toBe(false);
    expect(editedForScope({ edited: true }, "cover")).toBe(true);
    expect(editedForScope({ edited: false }, "cover")).toBe(false);
  });
});

describe("withEditedScope", () => {
  it("sets one scope and leaves the other alone", () => {
    expect(withEditedScope({ edited: { resume: true, cover: true } }, "resume", false)).toEqual({
      resume: false,
      cover: true,
    });
  });

  it("does not mutate the entry's existing flag object", () => {
    const edited = { resume: true, cover: true };
    withEditedScope({ edited }, "resume", false);
    expect(edited).toEqual({ resume: true, cover: true });
  });

  it("widens a legacy boolean before setting the scope", () => {
    expect(withEditedScope({ edited: true }, "cover", false)).toEqual({
      resume: true,
      cover: false,
    });
    expect(withEditedScope({}, "cover", true)).toEqual({ resume: false, cover: true });
  });
});

describe("scopeText", () => {
  it("returns the resume's stored text and the cover letter's joined lines", () => {
    const entry = { result: RESUME_TEXT, coverLetterResultLines: COVER_LINES };
    expect(scopeText(entry, "resume")).toBe(RESUME_TEXT);
    expect(scopeText(entry, "cover")).toBe(COVER_TEXT);
  });

  it("returns an empty string rather than throwing on a missing entry", () => {
    expect(scopeText(undefined, "resume")).toBe("");
    expect(scopeText({}, "cover")).toBe("");
  });
});
