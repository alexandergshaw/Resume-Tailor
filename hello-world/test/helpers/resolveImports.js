import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseModuleSource, resolveSpecifier } from "../../lib/sourceScan/exportGraph.js";

// Shared import RESOLVER for source-text purity guards -- tests that assert
// "this module must not import X" where X is a directory or a module.
//
// WHY THIS EXISTS. Several landed guards matched a forbidden module with a
// regex over the RAW SOURCE TEXT written in the aliased spelling
// (`/lib\/llm/`, `/@\/lib\/supabase\//`, `from "@/lib/url/safeExternalHref"`).
// That sees only the spelling the author happened to use. This repo uses BOTH
// spellings live -- app/page.js imports `../lib/supabase/client`,
// lib/meeting/referenceContract.js imports `../llm/...` -- so a reintroduction
// written `../llm/geminiClient.js` (or with a `.js` extension the regex did not
// anticipate, or as a dynamic `import()`) passed every one of them.
//
// WHAT IT DOES. It parses a source file with the same comment/string-aware
// parser the reachability sweep uses (lib/sourceScan/exportGraph.js, via the
// shared tokenizer), then resolves each specifier against the file that wrote
// it, so `../llm/x.js`, `@/lib/llm/x.js` and `import("../llm/x")` all come out
// as ONE repo-relative target, `lib/llm/x.js`. A guard then matches its
// forbidden target against that resolved path instead of against text. The
// shape is the one lib/duplicateApply/duplicateApplyImportAllowlist.sweep.test.js
// already proves for its own directory.
//
// TARGET RULES, chosen so a guard cannot be dodged by naming a file that does
// not exist yet or by a spelling the resolver does not model:
//   * a relative or `@/` specifier that resolves to a real module reports that
//     module's repo-relative path (so `../llm` reports `lib/llm/index.js` when
//     one exists, not the bare directory);
//   * one that resolves to an asset, or to nothing, reports its NORMALISED path
//     anyway -- a forbidden import of a missing file is still a forbidden
//     import, and the resolver's `unresolved` verdict never hides it;
//   * a bare specifier (`@google/genai`, `node:https`, `react`) reports itself.
//
// INSTRUMENT LIMIT: static specifiers only. A computed `import(name)` has no
// text to resolve and yields no edge; a guard that must rule that shape out
// counts the `import` keyword in real code itself (as the duplicateApply
// allowlist sweep does). Comments, regex literals and string contents cannot
// register as an import -- the parser confirms every keyword against the
// tokenizer's code-only view.

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The set of real files under the app root, in the one shape resolveSpecifier
 * needs (it only ever calls `.has`).
 *
 * @param {string} [appRoot]
 * @returns {{ has: (rel: string) => boolean }}
 */
export function diskFileSet(appRoot = APP_ROOT) {
  return {
    has: (rel) => statSync(path.join(appRoot, rel), { throwIfNoEntry: false })?.isFile() === true,
  };
}

/** A virtual file set, so a control can plant imports against modules that need not exist. */
export function virtualFileSet(rels) {
  const set = new Set(rels);
  return { has: (rel) => set.has(rel) };
}

function normalisedTarget(spec, fromRel) {
  return spec.startsWith("@/")
    ? path.posix.normalize(spec.slice(2))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
}

/**
 * Every import edge in `src` (static, dynamic, and `export ... from`
 * re-exports), each with the repo-relative target it resolves to.
 *
 * @param {string} src     the module's source text
 * @param {string} fromRel POSIX path of the module relative to the app root
 *                         (e.g. "lib/copilot/glossaryMatch.js") -- a relative
 *                         specifier means nothing without it
 * @param {{ has: (rel: string) => boolean }} [fileSet] defaults to the real tree
 * @returns {Array<{ spec: string, line: number, dynamic: boolean, kind: string, target: string }>}
 */
export function resolvedImports(src, fromRel, fileSet = diskFileSet()) {
  return parseModuleSource(src).imports.map((edge) => {
    const r = resolveSpecifier(edge.spec, fromRel, fileSet);
    let target;
    if (r.kind === "module") target = r.file;
    else if (r.kind === "external") target = edge.spec;
    else target = normalisedTarget(edge.spec, fromRel);
    return { spec: edge.spec, line: edge.line, dynamic: edge.dynamic === true, kind: r.kind, target };
  });
}

/**
 * The import edges of `src` whose RESOLVED target matches `targetRe`. An empty
 * array is the clean verdict.
 *
 * @param {string} src
 * @param {string} fromRel
 * @param {RegExp} targetRe matched against the resolved repo-relative target
 * @param {{ has: (rel: string) => boolean }} [fileSet]
 */
export function importsMatching(src, fromRel, targetRe, fileSet = diskFileSet()) {
  return resolvedImports(src, fromRel, fileSet).filter((edge) => targetRe.test(edge.target));
}
