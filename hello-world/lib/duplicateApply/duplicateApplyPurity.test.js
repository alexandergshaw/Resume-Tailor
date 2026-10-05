import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolvedImports } from "../../test/helpers/resolveImports.js";

// ---------------------------------------------------------------------------
// AC-duplicate-apply-r4.md C-8a + 1g SEC-3 + 1g SEC-2 (source half). A
// source-text sweep over this chunk's OWN directory, not a lint rule (C-8a's
// own reasoning: eslint.config.mjs is in another chunk's lane, and
// no-restricted-imports only catches an IMPORT while C-8's stated risk is
// "reused, imported, or COPIED" -- a copied regex has no import specifier).
//
// Precedent for this exact discipline -- a directory walker, comment
// stripping, and a PLANTED POSITIVE CONTROL so a broken scanner cannot look
// identical to a clean codebase -- is
// lib/applications/statusVocabularySweep.test.js and this directory's own
// companyIdentity.test.js self-check.
//
// Comment-stripping is NOT optional here: postingIdentity.js and
// companyIdentity.js are shipped, off-limits files whose own header
// comments NAME "atsLookup" and QUOTE the incumbent's forbidden regex in
// prose explaining what not to do. Without stripping comments first, this
// sweep would immediately self-flag on code this wave is not allowed to
// edit -- the same trap statusVocabularySweep.test.js's own header notes
// ("documentation ... isn't itself flagged as a violation").
// ---------------------------------------------------------------------------

const DIR = fileURLToPath(new URL("./", import.meta.url));
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

// Identical algorithm to lib/applications/statusVocabularySweep.test.js and
// companyIdentity.test.js's own C-8 self-check: strip block comments, then
// strip a `//` to end-of-line unless inside a string (naive quote tracking,
// sufficient for this corpus).
function stripComments(src) {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      let inString = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
          if (ch === "\\") {
            i += 1;
            continue;
          }
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
          continue;
        }
        if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

let SOURCE_CACHE = null;

function sourceFiles() {
  if (SOURCE_CACHE) return SOURCE_CACHE;
  const found = [];
  for (const name of readdirSync(DIR)) {
    const full = path.join(DIR, name);
    if (statSync(full).isDirectory()) continue; // lib/duplicateApply/ has no subdirectories today
    if (!full.endsWith(".js")) continue;
    if (full.endsWith(".test.js")) continue; // test files are not shipped source
    if (path.resolve(full) === SELF_PATH) continue;
    found.push([name, readFileSync(full, "utf8")]);
  }
  SOURCE_CACHE = found;
  return found;
}

// C-8's exact forbidden regex, transcribed verbatim (never imported from the
// incumbent -- that would be the exact violation this test forbids).
const INCUMBENT_SUFFIX_REGEX_LITERAL = "\\b(inc|llc|ltd|corp|co|company|technologies|labs|the)\\b";
const ATSLOOKUP_OR_SCRAPE_RE = /(atsLookup|lib\/scrape)/;
const GENAI_RE = /@google\/genai/;
const LLM_DIR_RE = /lib\/llm/;
const SUPABASE_RE = /supabase/i;
const FETCH_CALL_RE = /\bfetch\s*\(/;

describe("[purity] lib/duplicateApply/ -- C-8a source sweep, with a positive control", () => {
  it("[control] the sweep walks a populated, real directory and excludes only itself", () => {
    const files = sourceFiles().map(([name]) => name);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toContain("postingIdentity.js");
    expect(files).toContain("companyIdentity.js");
    expect(files).toContain("duplicateApplyVerdict.js");
    expect(files).not.toContain("duplicateApplyPurity.test.js");
    expect(files).not.toContain("duplicateApplyVerdict.test.js");
  });

  it("[canary] stripComments removes // and /* */ comments but keeps real code, and does not eat a string literal containing '//'", () => {
    const src = [
      'const a = "atsLookup"; /* also mentions "atsLookup" here */',
      "// a whole-line comment naming atsLookup and lib/scrape",
      'const url = "https://example.com/x"; // trailing comment naming atsLookup',
    ].join("\n");
    const stripped = stripComments(src);
    expect(stripped).toContain('"atsLookup"'); // real code line 1 is kept
    expect(stripped).not.toMatch(/\/\/ a whole-line/);
    expect(stripped).toContain('"https://example.com/x"'); // the // inside the string survives
    expect(stripped).not.toMatch(/trailing comment/);
  });

  it("no shipped source file references atsLookup or lib/scrape in CODE (outside comments) -- C-8", () => {
    for (const [name, src] of sourceFiles()) {
      const code = stripComments(src);
      expect(code, `${name} must not reference atsLookup/lib/scrape outside a comment`).not.toMatch(ATSLOOKUP_OR_SCRAPE_RE);
    }
  });

  it("[false-positive control] the raw (unstripped) source of the shipped modules DOES mention atsLookup -- in a comment -- so the check above is exercising the stripper, not vacuously passing", () => {
    const hits = sourceFiles().filter(([, src]) => ATSLOOKUP_OR_SCRAPE_RE.test(src));
    expect(hits.length).toBeGreaterThan(0);
    for (const [name, src] of hits) {
      // The raw source matches, but the STRIPPED source (checked above) does
      // not -- proving the mention is comment-only documentation, not a
      // live import or a copied rule.
      expect(stripComments(src), `${name} was expected to be comment-only`).not.toMatch(ATSLOOKUP_OR_SCRAPE_RE);
    }
  });

  it("no shipped source file contains the incumbent's unanchored suffix-strip regex literal, outside comments -- C-8", () => {
    for (const [name, src] of sourceFiles()) {
      const code = stripComments(src);
      expect(code, `${name} must not copy the incumbent's regex literal`).not.toContain(INCUMBENT_SUFFIX_REGEX_LITERAL);
    }
  });

  it("[SEC-3] no shipped source file makes a network call, imports an LLM client, or imports Supabase, outside comments -- the core reads nothing and writes nothing", () => {
    for (const [name, src] of sourceFiles()) {
      const code = stripComments(src);
      expect(code, `${name} must not import @google/genai`).not.toMatch(GENAI_RE);
      expect(code, `${name} must not import lib/llm`).not.toMatch(LLM_DIR_RE);
      expect(code, `${name} must not import a Supabase client`).not.toMatch(SUPABASE_RE);
      expect(code, `${name} must not call fetch(...)`).not.toMatch(FETCH_CALL_RE);
    }
  });

  it("[positive control] the sweep CAN fire -- a planted violation of each forbidden pattern is detected by the exact stripped-source check used above", () => {
    const plantedAtsLookup = 'import { normalizeCompanyKey } from "@/lib/scrape/atsLookup.js";';
    const plantedRegex = `const bad = "${INCUMBENT_SUFFIX_REGEX_LITERAL}";`;
    const plantedGenai = 'import { GoogleGenAI } from "@google/genai";';
    const plantedLlm = 'import { runPrompt } from "@/lib/llm/gemini.js";';
    const plantedSupabase = 'import { createClient } from "@supabase/supabase-js";';
    const plantedFetch = 'async function bad() { return fetch("https://example.com"); }';

    expect(stripComments(plantedAtsLookup)).toMatch(ATSLOOKUP_OR_SCRAPE_RE);
    expect(stripComments(plantedRegex)).toContain(INCUMBENT_SUFFIX_REGEX_LITERAL);
    expect(stripComments(plantedGenai)).toMatch(GENAI_RE);
    expect(stripComments(plantedLlm)).toMatch(LLM_DIR_RE);
    expect(stripComments(plantedSupabase)).toMatch(SUPABASE_RE);
    expect(stripComments(plantedFetch)).toMatch(FETCH_CALL_RE);
  });

  // The forbidden-pattern regexes above are TEXT matches, and LLM_DIR_RE /
  // ATSLOOKUP_OR_SCRAPE_RE name `lib/llm` and `lib/scrape` in the aliased
  // spelling only: a relative `../llm/gemini.js` or `../scrape/fetchJobs.js` (live
  // convention in this repo) contains neither string and passes them. The check
  // below applies the SAME regexes to the RESOLVED repo-relative target of every
  // import (static, dynamic, re-export), so every spelling of one module is one
  // thing. See test/helpers/resolveImports.js; the allowlist-shaped complement
  // is duplicateApplyImportAllowlist.sweep.test.js.
  const FORBIDDEN_TARGET_RES = [ATSLOOKUP_OR_SCRAPE_RE, GENAI_RE, LLM_DIR_RE, SUPABASE_RE];
  const forbiddenImportsIn = (src, name) =>
    resolvedImports(src, `lib/duplicateApply/${name}`).filter((edge) => FORBIDDEN_TARGET_RES.some((re) => re.test(edge.target)));

  it("[SEC-3, resolved] no shipped source file imports atsLookup, lib/scrape, lib/llm, a Supabase module or @google/genai -- relative, aliased, dynamic or re-exported", () => {
    for (const [name, src] of sourceFiles()) {
      const hits = forbiddenImportsIn(src, name).map((edge) => `${edge.spec} -> ${edge.target}`);
      expect(hits, `${name} must not import a forbidden module`).toEqual([]);
    }
    // Non-vacuity: the sweep parsed real import edges and resolved them, so an
    // empty verdict is not "parsed nothing".
    const resolved = sourceFiles().flatMap(([name, src]) => resolvedImports(src, `lib/duplicateApply/${name}`).map((e) => e.target));
    expect(resolved).toEqual(expect.arrayContaining(["lib/tracking/stages.js", "lib/duplicateApply/postingIdentity.js"]));
  });

  it("[positive control, resolved] the resolved check fires on the relative spellings the text matches above pass", () => {
    const relativeLlm = 'import { runPrompt } from "../llm/gemini.js";\nexport const x = runPrompt;\n';
    const relativeScrape = 'import { fetchJobs } from "../scrape/fetchJobs.js";\nexport const x = fetchJobs;\n';
    // The old matchers are blind to both -- that is the gap being closed.
    expect(stripComments(relativeLlm)).not.toMatch(LLM_DIR_RE);
    expect(stripComments(relativeScrape)).not.toMatch(ATSLOOKUP_OR_SCRAPE_RE);
    expect(forbiddenImportsIn(relativeLlm, "planted.js").map((e) => e.target)).toEqual(["lib/llm/gemini.js"]);
    expect(forbiddenImportsIn(relativeScrape, "planted.js").map((e) => e.target)).toEqual(["lib/scrape/fetchJobs.js"]);
  });

  it("[positive control, resolved] it still fires on the aliased spelling, a dynamic import, a re-export, the SDK and a Supabase client", () => {
    expect(forbiddenImportsIn('import { runPrompt } from "@/lib/llm/gemini.js";\n', "planted.js")).toHaveLength(1);
    expect(forbiddenImportsIn('import { n } from "@/lib/scrape/atsLookup.js";\n', "planted.js")).toHaveLength(1);
    expect(forbiddenImportsIn('export async function bad() { return import("../llm/gemini.js"); }\n', "planted.js")).toHaveLength(1);
    expect(forbiddenImportsIn('export { runPrompt } from "../llm/gemini.js";\n', "planted.js")).toHaveLength(1);
    expect(forbiddenImportsIn('import { GoogleGenAI } from "@google/genai";\n', "planted.js")).toHaveLength(1);
    expect(forbiddenImportsIn('import { createClient } from "@supabase/supabase-js";\n', "planted.js")).toHaveLength(1);
    expect(forbiddenImportsIn('import { createClient } from "../supabase/client.js";\n', "planted.js")).toHaveLength(1);
  });

  it("[positive control, resolved] a relative import of a PERMITTED sibling, and a comment naming a forbidden one, are not flagged", () => {
    expect(forbiddenImportsIn('import { x } from "./postingIdentity.js";\nimport { y } from "../tracking/stages.js";\n', "planted.js")).toEqual([]);
    expect(forbiddenImportsIn('// import { runPrompt } from "../llm/gemini.js";\n/* import "../scrape/atsLookup.js"; */\nexport const x = 1;\n', "planted.js")).toEqual([]);
  });

  it("[positive control, comment-only] the SAME planted violations, written as comments instead of code, are correctly NOT flagged -- proves the sweep discriminates code from documentation rather than being blind to the pattern entirely", () => {
    const commentedOut = [
      "// import { normalizeCompanyKey } from '@/lib/scrape/atsLookup.js';",
      `// const bad = "${INCUMBENT_SUFFIX_REGEX_LITERAL}";`,
      "// import { GoogleGenAI } from '@google/genai';",
      "// import { runPrompt } from '@/lib/llm/gemini.js';",
      "// import { createClient } from '@supabase/supabase-js';",
      '// async function bad() { return fetch("https://example.com"); }',
    ].join("\n");
    const stripped = stripComments(commentedOut);
    expect(stripped).not.toMatch(ATSLOOKUP_OR_SCRAPE_RE);
    expect(stripped).not.toContain(INCUMBENT_SUFFIX_REGEX_LITERAL);
    expect(stripped).not.toMatch(GENAI_RE);
    expect(stripped).not.toMatch(LLM_DIR_RE);
    expect(stripped).not.toMatch(SUPABASE_RE);
    expect(stripped).not.toMatch(FETCH_CALL_RE);
  });
});
