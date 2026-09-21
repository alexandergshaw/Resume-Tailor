// @vitest-environment jsdom
//
// N40 (design.r2.md §5C) -- THE CLASS GUARD for "an edited-document rebuild
// drops run-level soft line breaks". rebuildBreaks.hooks.test.js and
// app/components/rebuildBreaks.components.test.js pin the instances, one per
// resolveDocumentBlob call site, driven from the real controls. This file
// guards the CLASS, so the next rebuild path cannot quietly reintroduce it:
//
//   1. CALL-SITE CENSUS. Every non-test call of resolveDocumentBlob under app/
//      and lib/ is listed in CALL_SITES with the test that drives it. A sixth
//      call site turns this red until it is registered -- and registering it
//      means naming an entry-point test that measures its breaks.
//   2. REBUILD-MACHINERY CENSUS. buildDocxFromUploadedTemplate and
//      setParagraphText (the two functions that write edited lines into an
//      existing document) may be called only from lib/document/docx.js, and
//      buildDocxFromUploadedTemplate exactly three times: resolveDocumentBlob's
//      three rebuild branches, each measured by (3) below.
//   3. DOCX-WRITER CENSUS. Every non-test module that serializes a .docx
//      (JSZip generateAsync + word/document.xml) is registered with what it
//      writes. A new writer -- a rebuild path that bypasses all of the above
//      -- turns this red until someone states what it is.
//   4. PRODUCER INVARIANT. Over EVERY rebuild branch of resolveDocumentBlob
//      (3 in-session engine doc, 4 stored doc, 5 uploaded template) and EVERY
//      break-bearing fixture (four embedded cover variants and a Word résumé,
//      each with <w:br/> and with <w:cr/>), rebuilding the document's own
//      lines alters 0 paragraphs, and an edit alters only the edited one.
//
// WHAT THIS CANNOT CATCH, stated plainly: a rebuild path that uses none of the
// censused symbols AND writes no .docx itself (for example, one that sends
// lines to a server route which builds the file). The censuses see source
// text, not behaviour; the invariant sees only the branches it calls. It also
// cannot tell a WRONG break from a missing one beyond its kind token ([br] vs
// [cr] vs [br:page]).
//
// Each census has its own canary against a known positive and a known
// negative, so a scanner that silently matches nothing cannot pass.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { stripCommentLines } from "../../test/helpers/stripComments.js";
import {
  EMBEDDED_VARIANTS,
  COVER_SHAPES,
  RESUME_SHAPES,
  DOCX_MIME,
  embeddedCover,
  embeddedResume,
  breakResumeDocx,
  asDocxFile,
  paragraphRecords,
  rebuildProblems,
  findParagraph,
  asEditorText,
} from "../../test/helpers/rebuildBreaks.js";

const h = vi.hoisted(() => ({ storage: {} }));

vi.mock("../supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        download: async (p) => (h.storage[p] ? { data: h.storage[p], error: null } : { data: null, error: { message: "404" } }),
      }),
    },
  }),
}));

import { resolveDocumentBlob } from "./docx.js";

// The suite runs from hello-world/ (as the repo's other sweeps assume); in a
// jsdom file import.meta.url is not a file: URL. Guarded below by the canary
// that the scan found docx.js.
const ROOT = process.cwd();

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const SOURCES = new Map(
  ["app", "lib"].flatMap((d) => walk(path.join(ROOT, d))).map((full) => [
    path.relative(ROOT, full).split(path.sep).join("/"),
    stripCommentLines(readFileSync(full, "utf8")),
  ]),
);

function countCalls(src, name) {
  const calls = src.match(new RegExp(`\\b${name}\\s*\\(`, "g")) || [];
  const defs = src.match(new RegExp(`\\bfunction\\s+${name}\\s*\\(`, "g")) || [];
  return calls.length - defs.length;
}

function callSites(name) {
  const out = {};
  for (const [file, src] of SOURCES) {
    const n = countCalls(src, name);
    if (n > 0) out[file] = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1-3. Censuses
// ---------------------------------------------------------------------------

// Each call site of resolveDocumentBlob, the user action that reaches it, and
// the test that drives that action and measures the breaks in its output.
const CALL_SITES = {
  "lib/document/previewBlob.js": {
    count: 1,
    reachedBy: "preview render and the Drive save (buildPreviewBlob)",
    tests: [["lib/document/rebuildBreaks.hooks.test.js", "Drive save of an edited embedded cover letter"]],
  },
  "lib/document/docx.js": {
    count: 2,
    reachedBy: "downloadDocxFiles: résumé and cover (preview download, chip download, tracking row download)",
    tests: [
      ["lib/document/rebuildBreaks.hooks.test.js", "preview download of an edited embedded cover letter"],
      ["app/components/rebuildBreaks.components.test.js", "status bar 'Download résumé + cover letter'"],
      ["app/components/rebuildBreaks.components.test.js", "tracking row drag and download"],
    ],
  },
  "app/components/StatusBar.js": {
    count: 1,
    reachedBy: "dragging the tailored résumé off a status-bar chip",
    tests: [["app/components/rebuildBreaks.components.test.js", "status bar chip drag"]],
  },
  "app/components/TrackingTab.js": {
    count: 1,
    reachedBy: "dragging a saved résumé off a tracking row",
    tests: [["app/components/rebuildBreaks.components.test.js", "tracking row drag and download"]],
  },
};

// Every non-test module that serializes a .docx, and what it writes.
const DOCX_WRITERS = {
  "lib/document/docx.js": "the edited-lines rebuild (guarded here) and buildMinimalistDocx (a fresh document, no template)",
  "lib/document/combineDocuments.js": "one new document from parsed preview models, page-broken; no line rebuild",
  "lib/llm/engines/tailor-lite/docxModel.js": "server engine: serializes a filled template",
  "lib/llm/engines/tailor-lite/defaultTemplate.js": "server engine: the bundled résumé template",
  "lib/llm/engines/tailor-lite/coverLetterTemplate.js": "server engine: the bundled cover-letter templates",
};

function docxWriters() {
  return Object.keys(Object.fromEntries(SOURCES))
    .filter((f) => /\bgenerateAsync\s*\(/.test(SOURCES.get(f)) && /word\/document\.xml/.test(SOURCES.get(f)))
    .sort();
}

describe("census canaries: each scanner finds a known positive and ignores a known negative", () => {
  it("counts a call, not a definition or a comment", () => {
    expect(countCalls("const b = await resolveDocumentBlob({ text });", "resolveDocumentBlob")).toBe(1);
    expect(countCalls("export async function resolveDocumentBlob({", "resolveDocumentBlob")).toBe(0);
    expect(countCalls(stripCommentLines("  // resolveDocumentBlob(args)\nx();"), "resolveDocumentBlob")).toBe(0);
    expect(countCalls("resolveDocumentBlobs(x)", "resolveDocumentBlob")).toBe(0);
  });

  it("the tree scan reaches the files it must (a scan of nothing would pass every census)", () => {
    expect(SOURCES.size).toBeGreaterThan(200);
    expect(SOURCES.has("lib/document/docx.js")).toBe(true);
    expect(SOURCES.has("app/components/StatusBar.js")).toBe(true);
    expect([...SOURCES.keys()].some((f) => f.endsWith(".test.js"))).toBe(false);
  });
});

describe("1. every resolveDocumentBlob call site is registered with a test that measures its breaks", () => {
  it("the call sites are exactly the registered ones", () => {
    const want = Object.fromEntries(Object.entries(CALL_SITES).map(([f, v]) => [f, v.count]));
    expect(callSites("resolveDocumentBlob")).toEqual(want);
  });

  it("every registered covering test exists and still carries the describe it is registered under", () => {
    for (const [site, { tests }] of Object.entries(CALL_SITES)) {
      for (const [file, title] of tests) {
        const full = path.join(ROOT, file);
        expect(existsSync(full), `${site}: ${file} is missing`).toBe(true);
        expect(readFileSync(full, "utf8").includes(title), `${site}: "${title}" is not in ${file}`).toBe(true);
      }
    }
  });
});

describe("2. the line-rebuild machinery has no caller outside resolveDocumentBlob", () => {
  it("buildDocxFromUploadedTemplate: three calls, all in docx.js (branches 3, 4 and 5)", () => {
    expect(callSites("buildDocxFromUploadedTemplate")).toEqual({ "lib/document/docx.js": 3 });
  });

  it("setParagraphText: called only from docx.js", () => {
    expect(Object.keys(callSites("setParagraphText"))).toEqual(["lib/document/docx.js"]);
  });
});

describe("3. every module that writes a .docx is registered", () => {
  it("the writers are exactly the registered ones", () => {
    expect(docxWriters()).toEqual(Object.keys(DOCX_WRITERS).sort());
  });
});

// ---------------------------------------------------------------------------
// 4. Producer invariant
// ---------------------------------------------------------------------------

const STORED = "user-1/generated/n40-class.docx";

// Branch 3 (in-session engine bytes), 4 (stored bytes), 5 (uploaded template).
const BRANCHES = {
  "3 in-session engine doc": (fx, text, lines) =>
    resolveDocumentBlob({ engineDocxB64: fx.b64, edited: true, text, lines }),
  "4 stored doc": (fx, text, lines) => {
    h.storage[STORED] = new Blob([fx.buf], { type: DOCX_MIME });
    return resolveDocumentBlob({ docxPath: STORED, edited: true, text, lines });
  },
  "5 uploaded template": (fx, text, lines) =>
    resolveDocumentBlob({ edited: true, text, lines, uploadedTemplate: asDocxFile(fx.buf, "template.docx") }),
};

const FIXTURES = {};
beforeAll(async () => {
  const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  for (const v of EMBEDDED_VARIANTS) {
    for (const breakKind of ["br", "cr"]) {
      const c = await embeddedCover(v, { breakKind });
      FIXTURES[`cover ${v} (${breakKind})`] = {
        kind: "cover",
        lines: c.lines,
        b64: c.docxB64,
        buf: b64ToBuf(c.docxB64),
        before: await paragraphRecords(c.docxB64),
      };
    }
  }
  for (const breakKind of ["br", "cr"]) {
    const r = await breakResumeDocx({ breakKind });
    FIXTURES[`Word résumé (${breakKind})`] = { kind: "resume", lines: r.lines, b64: r.b64, buf: r.buf, before: await paragraphRecords(r.b64) };
  }
}, 60000);

describe("4. every rebuild branch preserves soft line breaks over every break-bearing fixture", () => {
  it("fixture guard: every fixture really carries soft breaks, of the kind it is named for", () => {
    for (const [name, fx] of Object.entries(FIXTURES)) {
      const kind = name.includes("(cr)") ? "[cr]" : "[br]";
      expect(fx.before.some((r) => r.breaks > 0 && r.sig.includes(kind)), name).toBe(true);
    }
  });

  for (const branch of Object.keys(BRANCHES)) {
    it(`branch ${branch}: unchanged lines alter 0 paragraphs, for every fixture`, async () => {
      const failures = {};
      for (const [name, fx] of Object.entries(FIXTURES)) {
        const blob = await BRANCHES[branch](fx, asEditorText(fx.lines), fx.lines);
        const problems = rebuildProblems(fx.before, await paragraphRecords(blob), {});
        if (problems.length) failures[name] = problems;
      }
      expect(failures).toEqual({});
    });

    it(`branch ${branch}: one edited line alters only its own paragraph, for every fixture`, async () => {
      const failures = {};
      for (const [name, fx] of Object.entries(FIXTURES)) {
        const shape = (fx.kind === "cover" ? COVER_SHAPES : RESUME_SHAPES).bodyEdit(fx);
        const blob = await BRANCHES[branch](fx, asEditorText(shape.lines), shape.lines);
        const problems = rebuildProblems(fx.before, await paragraphRecords(blob), shape.changed);
        if (problems.length) failures[name] = problems;
      }
      expect(failures).toEqual({});
    });
  }
});

describe("no-regression control (passes on HEAD): a document with no soft breaks rebuilds exactly as before", () => {
  // The engine's bundled résumé has no w:br/w:cr at all (design.r2.md §5B),
  // so none of the fix's segment logic may engage. A fix that re-slots every
  // paragraph, or flattens something it should not, fails here.
  it("bundled résumé, branch 3: unchanged lines alter 0 paragraphs; one edit alters one", async () => {
    const r = await embeddedResume();
    const before = await paragraphRecords(r.docxB64);
    expect(before.every((p) => p.breaks === 0), "fixture guard: the bundled résumé gained a soft break").toBe(true);

    // ignoreTrailingSpace: the engine's résumé paragraphs end in a space its
    // own lines trim away, a pre-existing whitespace-only difference every
    // rebuild makes (measured on HEAD); see rebuildProblems.
    const ts = { ignoreTrailingSpace: true };
    const same = await resolveDocumentBlob({ engineDocxB64: r.docxB64, edited: true, text: asEditorText(r.lines), lines: r.lines });
    expect(rebuildProblems(before, await paragraphRecords(same), {}, ts)).toEqual([]);

    const at = r.lines.findIndex((l) => l.trim().length > 60);
    const edited = `${r.lines[at].trimEnd()} Cut p95 latency by 30%.`;
    const lines = r.lines.map((l, i) => (i === at ? edited : l));
    const para = findParagraph(before, (s) => s === r.lines[at], "the edited résumé line");
    const out = await resolveDocumentBlob({ engineDocxB64: r.docxB64, edited: true, text: asEditorText(lines), lines });
    expect(rebuildProblems(before, await paragraphRecords(out), { [para]: edited }, ts)).toEqual([]);
  });
});
