// N59 step 3 (4b) -- K5 call-site census.
//
// The persistGeneration join test proves the SEAM works when a caller supplies
// docxB64. It says nothing about whether the five real callers actually thread
// it. K5 is exactly that silent hole: a persist call site that builds a cover
// object WITHOUT docxB64 stores no path, and a post-reload download degrades to
// the generic template with no error -- a green suite defending a broken
// feature. This census asserts the argument-shaped claim the join cannot: every
// persistGeneratedDocuments call site that builds a cover-letter object threads
// a non-empty docxB64 into it.
//
// A source-text sweep is only honest with its own canary. Every classification
// below is proven to discriminate against FABRICATED modules first (new members
// written for the purpose, not the real call sites), so the sweep is shown to
// fire rather than asserted to.
//
// WHAT THIS CANNOT CATCH: it sees which fields a call site NAMES and whether the
// value is a hard-coded empty literal -- never the run-time value. A site that
// passes engine bytes under some unrelated alias would read as threaded even if
// the alias holds "". That residual is covered by the per-site read the plan
// mandates and by the join test's real upload; this file guards the last hop
// (the field is present and non-empty at every site) that the join cannot see.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CALLEE = "persistGeneratedDocuments";

// --- parser ---------------------------------------------------------------

// Full argument text of every `persistGeneratedDocuments(` CALL (not its
// definition, not an import). Balances parens over comment-stripped source.
function callArgumentsOf(code) {
  const found = [];
  const needle = `${CALLEE}(`;
  let at = code.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? "" : code[at - 1];
    const preContext = code.slice(Math.max(0, at - 12), at);
    const isCall = !/[A-Za-z0-9_$]/.test(before) && !/function\s+$/.test(preContext);
    if (isCall) {
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

// The value expression of the `coverLetter:` key inside a call's args, captured
// up to the top-level comma that terminates the property (so a `? {..} : null`
// ternary is captured whole). Returns null if the call names no coverLetter.
function coverValueOf(args) {
  const m = /(^|[^A-Za-z0-9_$])coverLetter\s*:/.exec(args);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  const start = i;
  for (; i < args.length; i += 1) {
    const c = args[i];
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === "," && depth === 0) break;
  }
  return args.slice(start, i).trim();
}

// Balance a `{...}` starting at `open` in `code`; return its inner text.
function bracedFrom(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return "";
}

// The object text a coverLetter value ultimately points at. A `{...}` literal
// (possibly inside a ternary) is used directly; a bare identifier is resolved
// to its `<id> = { ... }` assignment in the same file.
function coverObjectText(coverValue, code) {
  const v = coverValue.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(v)) {
    const asn = new RegExp(`(^|[^A-Za-z0-9_$])${v}\\s*=\\s*\\{`).exec(code);
    if (!asn) return "";
    return bracedFrom(code, code.indexOf("{", asn.index));
  }
  // otherwise take the first braced object appearing in the expression
  const brace = v.indexOf("{");
  if (brace === -1) return "";
  return bracedFrom(v, brace);
}

// A coverLetter value is COVER-CAPABLE when it can carry a real object -- i.e.
// resolves to a `{...}`. A literal `null` (a resume-only call) is not.
function isCoverCapable(coverValue, code) {
  return coverObjectText(coverValue, code).includes("{");
}

// The object names a docx byte field with a value that is not an empty literal.
function hasDocxB64(objText) {
  const m = /docxB64\s*:\s*([^,}\n]+)/.exec(objText);
  if (!m) return false;
  const val = m[1].trim();
  return !["\"\"", "''", "``", "null", "undefined"].includes(val);
}

function censusOver(files) {
  const rows = [];
  for (const { rel, code } of files) {
    for (const args of callArgumentsOf(code)) {
      const coverValue = coverValueOf(args);
      if (coverValue === null) continue;
      if (!isCoverCapable(coverValue, code)) {
        rows.push({ rel, coverCapable: false, threaded: false });
        continue;
      }
      rows.push({
        rel,
        coverCapable: true,
        threaded: hasDocxB64(coverObjectText(coverValue, code)),
      });
    }
  }
  return rows;
}

function listJsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) listJsFiles(full, out);
    else if (name.endsWith(".js") && !name.includes(".test.")) out.push(full);
  }
  return out;
}

// Memoised: the whole-tree walk + comment strip is expensive, and calling it
// once per test is the exact quadruple-walk load-sensitivity backlog N58 flags
// (naming coverBytePaths.census.test.js). One walk for the whole file.
let _realFiles = null;
function realFiles() {
  if (_realFiles === null) {
    _realFiles = [...listJsFiles(path.join(ROOT, "app")), ...listJsFiles(path.join(ROOT, "lib"))].map((full) => ({
      rel: path.relative(ROOT, full).split(path.sep).join("/"),
      code: stripComments(readFileSync(full, "utf8")),
    }));
  }
  return _realFiles;
}

// --- canary FIRST ---------------------------------------------------------

describe("the persist-cover census discriminates (canary)", () => {
  it("classifies a NEW inline cover call WITH docxB64 as threaded", () => {
    const code = stripComments(`
      persistGeneratedDocuments(supabase, {
        userId: u,
        coverLetter: applyCover && lines.length > 0
          ? { content: c, contentLines: lines, docxB64: coverBytes }
          : null,
        sourceResumePath: \`\${u}/resume\`,
      });
    `);
    const rows = censusOver([{ rel: "app/Fab.js", code }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ coverCapable: true, threaded: true });
  });

  it("classifies a NEW inline cover call WITHOUT docxB64 as NOT threaded (the RED shape)", () => {
    const code = stripComments(`
      persistGeneratedDocuments(supabase, {
        userId: u,
        coverLetter: applyCover && lines.length > 0
          ? { content: c, contentLines: lines }
          : null,
        sourceResumePath: \`\${u}/resume\`,
      });
    `);
    const rows = censusOver([{ rel: "app/Fab.js", code }]);
    expect(rows[0]).toMatchObject({ coverCapable: true, threaded: false });
  });

  it("resolves an ALIASED cover object (coverLetter: persistCover) to its assignment", () => {
    const withBytes = stripComments(`
      let persistCover = null;
      persistCover = { content: c, contentLines: lines, docxB64: payload.coverLetterDocxB64 };
      persistGeneratedDocuments(sb, { userId: u, coverLetter: persistCover, sourceResumePath: p });
    `);
    const without = stripComments(`
      let persistCover = null;
      persistCover = { content: c, contentLines: lines };
      persistGeneratedDocuments(sb, { userId: u, coverLetter: persistCover, sourceResumePath: p });
    `);
    expect(censusOver([{ rel: "a.js", code: withBytes }])[0]).toMatchObject({ coverCapable: true, threaded: true });
    expect(censusOver([{ rel: "b.js", code: without }])[0]).toMatchObject({ coverCapable: true, threaded: false });
  });

  it("treats an empty-literal docxB64 as NOT threaded (the silent-fallback shape)", () => {
    const code = stripComments(`persistGeneratedDocuments(sb, { coverLetter: { content: c, contentLines: l, docxB64: "" }, sourceResumePath: p });`);
    expect(censusOver([{ rel: "c.js", code }])[0].threaded).toBe(false);
  });

  it("does not count a resume-only call whose coverLetter is literally null", () => {
    const code = stripComments(`persistGeneratedDocuments(sb, { resume: { content: r, docxB64: b }, coverLetter: null, sourceResumePath: p });`);
    const rows = censusOver([{ rel: "d.js", code }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].coverCapable).toBe(false);
  });

  it("does not count the function DEFINITION or an import as a call", () => {
    const def = stripComments(`export async function persistGeneratedDocuments(supabase, { coverLetter = null } = {}) { return coverLetter; }`);
    const imp = stripComments(`import { persistGeneratedDocuments } from "../../lib/supabase/persistGeneration";`);
    expect(censusOver([{ rel: "def.js", code: def }])).toHaveLength(0);
    expect(censusOver([{ rel: "imp.js", code: imp }])).toHaveLength(0);
  });

  it("does not count a mention inside a comment", () => {
    const rows = censusOver([
      { rel: "x.js", code: stripComments(`// persistGeneratedDocuments(sb, { coverLetter: { docxB64: x } })\nconst y = 1;`) },
    ]);
    expect(rows).toHaveLength(0);
  });

  // Explicit timeout: this is a whole-tree walk, the load-sensitive class N58
  // documents. 60s of headroom over the ~8-13s the walk measures.
  it("the sweep reaches the real tree at all", () => {
    const files = realFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.rel === "app/page.js")).toBe(true);
    expect(files.some((f) => f.rel === "app/hooks/useManualTailor.js")).toBe(true);
    expect(files.some((f) => f.rel === "app/hooks/useDocumentPreview.js")).toBe(true);
  }, 60000);
});

// --- the census -----------------------------------------------------------

describe("every persist call site threads a non-empty docxB64 into its cover object (K5)", () => {
  // Where the cover-capable persist calls live today. Precondition-checked so a
  // rename does not silently empty the census (the false-absence this repo
  // keeps getting bitten by).
  const EXPECTED_FILES = [
    "app/hooks/useDocumentPreview.js",
    "app/hooks/useManualTailor.js",
    "app/page.js",
  ];

  it("the cover-capable persist sites live in exactly the known files", () => {
    const rows = censusOver(realFiles());
    const coverFiles = [...new Set(rows.filter((r) => r.coverCapable).map((r) => r.rel))].sort();
    expect(coverFiles).toEqual([...EXPECTED_FILES].sort());
  }, 60000);

  it("is not vacuous: at least the five known cover-capable persist sites are found", () => {
    const rows = censusOver(realFiles());
    const coverRows = rows.filter((r) => r.coverCapable);
    expect(coverRows.length).toBeGreaterThanOrEqual(5);
  }, 60000);

  it("EVERY cover-capable persist site threads a non-empty docxB64", () => {
    const rows = censusOver(realFiles());
    const unthreaded = rows.filter((r) => r.coverCapable && !r.threaded).map((r) => r.rel);
    expect(unthreaded, `these persist sites build a cover object with no engine bytes: ${unthreaded.join(", ")}`).toEqual([]);
  }, 60000);
});
