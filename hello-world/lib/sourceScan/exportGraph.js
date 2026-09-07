/**
 * A module graph over this repo's own source text, built to answer ONE
 * question: "is this exported symbol reachable from anything that ships?"
 *
 * WHY THIS EXISTS
 *
 * Three defects found by hand in one session, none of which any gate in this
 * repo could see:
 *
 *   1. lib/duplicateApply/duplicateApplyLog.js -- a whole module, a careful
 *      header, a green test suite, and NOTHING imported it. The standing
 *      "every feature that can carry a log gets one, plus a visible download
 *      button" rule was satisfied on paper and not at all for a user.
 *   2. lib/tracking/applicationDigest.js's `parseDigestAnswer` -- exported,
 *      tested, no production caller; the live route uses `buildCitedDigest`.
 *   3. app/hooks/useKnowledgeScope.js's `summaryViewFor` -- `export`ed with
 *      no importer at all, pinned only indirectly through jsdom mounts.
 *
 * All three had GREEN TESTS. That is the whole point of this module: a
 * `.test.js` file is not a caller. Reachability here is measured from the
 * things Next.js actually loads -- `app/**\/page.js`, `app/**\/layout.js`,
 * `app/**\/route.js` and `middleware.js` -- and from nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RESOLVER UNDERSTANDS
 * ---------------------------------------------------------------------------
 *
 *   * `import X from "s"`, `import { a, b as c } from "s"`,
 *     `import * as ns from "s"`, `import X, { a } from "s"`,
 *     `import X, * as ns from "s"`, and the bare side-effect `import "s"`.
 *     Import clauses spanning multiple lines are handled (the clause is read
 *     up to the ` from ` keyword, not to the end of the line).
 *   * `export function f`, `export async function f`, `export function* f`,
 *     `export class C`, `export const/let/var NAME`, `export default ...`
 *     (recorded under the name `default`, which is what an importer writes).
 *   * `export { a, b as c }` and `export { a, b as c } from "s"`, including
 *     the multi-line list form (lib/chat/chatbot.js:42 is one).
 *   * `export * from "s"` and `export * as ns from "s"`.
 *   * Dynamic `import("s")` / `await import("s")` with a STATIC string
 *     literal. When the call site destructures the result immediately
 *     (`const { a, b } = await import("s")` -- app/page.js:943 and
 *     lib/supabase/upsertPosition.js:56 are the two in this tree), those
 *     names are counted as named imports; otherwise the whole module's
 *     export surface is conservatively marked used.
 *   * Specifier resolution for relative (`./`, `../`) and `@/`-aliased paths
 *     (the alias jsconfig.json and vitest.config.js both map to the app
 *     root), trying `spec`, `spec.js`, `spec.mjs` and `spec/index.js`.
 *   * Non-JS specifiers (`.css`, `.json`, `.svg`, ...) are classified as
 *     assets and carry no symbol edges, but DO keep the importer honest --
 *     they are not silently counted as unresolved.
 *   * Comments and string/template contents cannot masquerade as an import
 *     or an export: every keyword hit is confirmed against
 *     tokenizeSource()'s `codeMask` view (real code only) before the
 *     specifier is read off the byte-aligned `readable` view (strings kept,
 *     because a module specifier IS a string).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RESOLVER DOES **NOT** UNDERSTAND -- read this before trusting it
 * ---------------------------------------------------------------------------
 *
 *   * NON-STATIC SPECIFIERS. `import(`./${name}.js`)` or any computed
 *     specifier resolves to nothing. There is no such site in this tree
 *     today, and the sweep's "leaves no local specifier unresolved" test is
 *     what makes that a checked fact rather than a hope -- but a future one
 *     would go unseen, and the modules it reaches would look dead.
 *   * NAMESPACE MEMBER ACCESS. `import * as ns from "m"` marks EVERY export
 *     of `m` used; this resolver never inspects `ns.foo`. That direction is
 *     deliberate: it can hide a dead export (under-report), never invent one
 *     (no false alarm). app/copilot/useDraftAnswer.js is the one production
 *     site, and `export * from` / `export * as ns from` behave the same way.
 *   * WHETHER AN IMPORTED BINDING IS ACTUALLY USED. `import { foo } from "m"`
 *     marks `foo` used even if the importing file never mentions `foo`
 *     again. That is ESLint's `no-unused-vars` job, and it runs on this repo.
 *   * `require()` and CommonJS. There is none in this tree's app/ or lib/.
 *   * RUNTIME REGISTRATION. A symbol reached only by string key, by a
 *     registry populated at runtime, or by a global side effect is invisible
 *     here. Registry-shaped modules that ARE reached by a normal import are
 *     fine; it is the string-keyed lookup INSIDE them this cannot follow.
 *   * TYPE-ONLY anything. This repo has no TypeScript.
 *   * `export { a } from "s"` chains are followed one hop at a time: the
 *     source symbol is marked used, and the RE-EXPORTED name becomes an
 *     export of the re-exporting module that needs its own consumer. A
 *     barrel nobody imports therefore reports its own re-exports as dead,
 *     which is the honest answer.
 *   * FILES OUTSIDE `app/` + `lib/` + `middleware.js`. `test/`, `scripts/`,
 *     `public/` and the root config files are not part of the universe: they
 *     are neither shipping code nor candidates for a dead export. A
 *     production module imported ONLY by something under `test/` is
 *     therefore correctly reported as unreachable.
 */

import path from "node:path";
import { tokenizeSource } from "./tokenizeSource.js";

/** Extensions that resolve to a JS module. */
const JS_EXTENSIONS = [".js", ".mjs"];

/** Non-JS things a module may legitimately import. Not symbol edges. */
const ASSET_EXTENSIONS = [".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".md", ".wasm"];

/**
 * Exports that a framework -- not another module in this repo -- consumes.
 * Keyed by the entry-file kind. Never reported as dead.
 */
export const FRAMEWORK_EXPORTS = {
  // Route Segment Config, shared by page/layout/route.
  segment: [
    "dynamic",
    "dynamicParams",
    "revalidate",
    "fetchCache",
    "runtime",
    "preferredRegion",
    "maxDuration",
    "experimental_ppr",
  ],
  page: ["default", "metadata", "generateMetadata", "viewport", "generateViewport", "generateStaticParams"],
  layout: ["default", "metadata", "generateMetadata", "viewport", "generateViewport", "generateStaticParams"],
  route: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "generateStaticParams"],
  middleware: ["middleware", "config", "default"],
};

/**
 * Which framework contract, if any, a file satisfies. `null` for an ordinary
 * module. Paths are POSIX-relative to the app root.
 *
 * @param {string} rel
 * @returns {"page"|"layout"|"route"|"middleware"|null}
 */
export function entryKindOf(rel) {
  if (rel === "middleware.js") return "middleware";
  if (!rel.startsWith("app/")) return null;
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  if (base === "page.js") return "page";
  if (base === "layout.js") return "layout";
  if (base === "route.js") return "route";
  return null;
}

/** The names a framework consumes from an entry file of this kind. */
export function frameworkExportsFor(kind) {
  if (!kind) return new Set();
  return new Set([...FRAMEWORK_EXPORTS.segment, ...(FRAMEWORK_EXPORTS[kind] || [])]);
}

/** Parse `a, b as c` (an import or export clause list) into pairs. */
function parseSpecifierList(text) {
  return text
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const m = /^(\S+)(?:\s+as\s+(\S+))?$/.exec(piece.replace(/\s+/g, " "));
      if (!m) return null;
      return { source: m[1], local: m[2] || m[1] };
    })
    .filter(Boolean);
}

/**
 * Every import edge and every exported name in one source file.
 *
 * Both views come from the SHARED lib/sourceScan/tokenizeSource.js -- the one
 * regex-literal-aware stripper the shipped sweeps use. A fourth private copy
 * is exactly what this repo already got burned by: an earlier fork was never
 * taught about regex literals, and a `"` inside one desynced its quote
 * tracker for the rest of the file, silently blanking a real site.
 *
 * @param {string} rawSrc
 * @returns {{ imports: Array, exports: Array }}
 */
export function parseModuleSource(rawSrc) {
  const { readable, codeMask } = tokenizeSource(rawSrc);
  const imports = [];
  const exports = [];
  const lineAt = (offset) => readable.slice(0, offset).split("\n").length;

  // --- static `import` / `export` statements, anchored at a line start -----
  // `[^\S\n]*` rather than `[ \t]*` so that a leading BOM cannot hide a
  // statement: lib/experience/untrustedText.js is checked in with one, and a
  // BOM-prefixed `import` on line 1 would otherwise be invisible. U+FEFF is
  // whitespace to JavaScript, and the class excludes only the newline.
  const stmt = /(^|\n)([^\S\n]*)(import|export)\b/g;
  let m;
  while ((m = stmt.exec(readable)) !== null) {
    const at = m.index + m[1].length + m[2].length;
    const keyword = m[3];
    // The keyword must be REAL CODE. `codeMask` blanks comments, regex
    // literals and string/template contents, so a line inside a block comment
    // that happens to read `export function foo()` can never register.
    if (codeMask.slice(at, at + keyword.length) !== keyword) continue;
    const chunk = readable.slice(at, at + 4000);
    const line = lineAt(at);

    if (keyword === "import") {
      // `import(` at a line start is a dynamic import; the pass below owns it.
      if (/^import\s*\(/.test(chunk)) continue;
      // The clause is bounded to characters an import clause may legally
      // contain: no quote, no backtick, no `;`. Without that bound the lazy
      // `[\s\S]*?` runs past a side-effect import's own specifier
      // (`import "./globals.css";` -- app/layout.js:1) and latches onto the
      // ` from ` of the NEXT statement, mis-attributing one import's clause
      // to another module.
      const im = /^import\s+(?:([^'"`;]*?)\s+from\s*)?(['"])([^'"]+)\2/.exec(chunk);
      if (!im) continue;
      const clause = (im[1] || "").trim();
      const spec = im[3];
      const edge = { spec, line, names: [], namespace: false, sideEffect: false, dynamic: false };
      if (!clause) {
        edge.sideEffect = true;
      } else {
        if (/(^|,)\s*\*\s+as\s+/.test(clause)) edge.namespace = true;
        const braces = /\{([\s\S]*?)\}/.exec(clause);
        if (braces) edge.names.push(...parseSpecifierList(braces[1]).map((p) => p.source));
        const head = clause.split(/[,{]/)[0].trim();
        if (head && head !== "*" && /^[A-Za-z_$][\w$]*$/.test(head)) edge.names.push("default");
      }
      imports.push(edge);
      continue;
    }

    // --- export ---------------------------------------------------------
    if (/^export\s+default\b/.test(chunk)) {
      exports.push({ name: "default", line, kind: "default" });
      continue;
    }
    const star = /^export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*(['"])([^'"]+)\2/.exec(chunk);
    if (star) {
      imports.push({
        spec: star[3],
        line,
        names: [],
        namespace: true,
        sideEffect: false,
        dynamic: false,
        reexportStar: true,
      });
      if (star[1]) exports.push({ name: star[1], line, kind: "reexport-star-as" });
      else exports.push({ name: "*", line, kind: "reexport-star" });
      continue;
    }
    const list = /^export\s*\{([\s\S]*?)\}\s*(?:from\s*(['"])([^'"]+)\2)?/.exec(chunk);
    if (list) {
      const pairs = parseSpecifierList(list[1]);
      if (list[3]) {
        imports.push({
          spec: list[3],
          line,
          names: pairs.map((p) => p.source),
          namespace: false,
          sideEffect: false,
          dynamic: false,
          reexport: true,
        });
      }
      for (const p of pairs) exports.push({ name: p.local, line, kind: list[3] ? "reexport" : "named" });
      continue;
    }
    const decl = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+\*?\s*([A-Za-z_$][\w$]*)/.exec(chunk);
    if (decl) {
      exports.push({ name: decl[1], line, kind: "declaration" });
      continue;
    }
  }

  // --- dynamic `import("...")`, anywhere in the file ----------------------
  const dyn = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((m = dyn.exec(readable)) !== null) {
    if (codeMask.slice(m.index, m.index + 6) !== "import") continue;
    const before = readable.slice(Math.max(0, m.index - 240), m.index);
    const destructured = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*(?:await\s+)?$/.exec(before);
    imports.push({
      spec: m[2],
      line: lineAt(m.index),
      names: destructured ? parseSpecifierList(destructured[1]).map((p) => p.source) : [],
      // No destructuring pattern we can read => assume the whole surface is
      // used. Under-reports rather than crying wolf.
      namespace: !destructured,
      sideEffect: false,
      dynamic: true,
    });
  }

  return { imports, exports };
}

/** POSIX-normalise a path built by joining, so keys always match. */
function norm(p) {
  return path.posix.normalize(p).replace(/^\.\//, "");
}

/**
 * Resolve one module specifier against the virtual file set.
 *
 * @param {string} spec        the specifier as written
 * @param {string} fromRel     POSIX-relative path of the importing file
 * @param {Set<string>} fileSet every POSIX-relative path in the universe
 * @returns {{kind:"module",file:string}|{kind:"external"}|{kind:"asset"}|{kind:"unresolved"}}
 */
export function resolveSpecifier(spec, fromRel, fileSet) {
  const isRelative = spec.startsWith("./") || spec.startsWith("../");
  const isAliased = spec.startsWith("@/");
  if (!isRelative && !isAliased) return { kind: "external" };

  const base = isAliased ? norm(spec.slice(2)) : norm(path.posix.join(path.posix.dirname(fromRel), spec));

  const ext = path.posix.extname(base);
  if (ext && ASSET_EXTENSIONS.includes(ext)) return { kind: "asset" };

  const candidates = [
    ...(JS_EXTENSIONS.includes(ext) ? [base] : []),
    ...JS_EXTENSIONS.map((e) => base + e),
    ...JS_EXTENSIONS.map((e) => path.posix.join(base, "index" + e)),
  ];
  for (const c of candidates) if (fileSet.has(c)) return { kind: "module", file: c };
  return { kind: "unresolved" };
}

const ALL = Symbol("every export used");

/**
 * Build the reachability answer.
 *
 * @param {object} args
 * @param {Map<string,string>} args.files POSIX-relative path -> source text
 * @param {(rel:string)=>("page"|"layout"|"route"|"middleware"|null)} [args.entryKind]
 * @param {(src:string)=>{imports:Array,exports:Array}} [args.parse]
 *        Injectable so the sweep can MUTATE the scanner to return nothing and
 *        prove every positive control goes red.
 * @returns {{
 *   entries: string[],
 *   shipping: Set<string>,
 *   unreachableModules: string[],
 *   deadExports: Array<{file:string,name:string,line:number,kind:string,reason:string}>,
 *   unresolved: Array<{file:string,spec:string,line:number}>,
 *   exportsByFile: Map<string,Array>,
 * }}
 */
export function buildExportGraph({ files, entryKind = entryKindOf, parse = parseModuleSource }) {
  const fileSet = new Set(files.keys());
  const parsed = new Map();
  for (const [rel, src] of files) parsed.set(rel, parse(src));

  const entries = [...fileSet].filter((rel) => entryKind(rel) !== null).sort();

  // --- reachability from the entry points ---------------------------------
  const shipping = new Set();
  const unresolved = [];
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.pop();
    if (shipping.has(rel)) continue;
    shipping.add(rel);
    for (const edge of parsed.get(rel).imports) {
      const r = resolveSpecifier(edge.spec, rel, fileSet);
      if (r.kind === "module") {
        if (!shipping.has(r.file)) queue.push(r.file);
      } else if (r.kind === "unresolved") {
        unresolved.push({ file: rel, spec: edge.spec, line: edge.line });
      }
    }
  }

  // Unresolved specifiers in NON-shipping files still matter: a resolver that
  // silently drops an edge is how this whole sweep would lie.
  for (const [rel, mod] of parsed) {
    if (shipping.has(rel)) continue;
    for (const edge of mod.imports) {
      const r = resolveSpecifier(edge.spec, rel, fileSet);
      if (r.kind === "unresolved") unresolved.push({ file: rel, spec: edge.spec, line: edge.line });
    }
  }

  // --- which exported names any SHIPPING module actually asks for ----------
  const used = new Map(); // file -> Set<string> | ALL
  const markAll = (file) => used.set(file, ALL);
  const mark = (file, name) => {
    const cur = used.get(file);
    if (cur === ALL) return;
    if (!cur) used.set(file, new Set([name]));
    else cur.add(name);
  };

  for (const rel of shipping) {
    for (const edge of parsed.get(rel).imports) {
      const r = resolveSpecifier(edge.spec, rel, fileSet);
      if (r.kind !== "module") continue;
      if (edge.namespace) markAll(r.file);
      for (const name of edge.names) mark(r.file, name);
    }
  }

  // --- the verdict ---------------------------------------------------------
  const exportsByFile = new Map();
  for (const [rel, mod] of parsed) exportsByFile.set(rel, mod.exports);

  const deadExports = [];
  for (const rel of [...fileSet].sort()) {
    const kind = entryKind(rel);
    const framework = frameworkExportsFor(kind);
    const reachable = shipping.has(rel);
    const u = used.get(rel);
    for (const e of parsed.get(rel).exports) {
      if (framework.has(e.name)) continue;
      if (e.name === "*") continue; // a bare `export *` has no name of its own
      if (reachable && (u === ALL || (u && u.has(e.name)))) continue;
      deadExports.push({
        file: rel,
        name: e.name,
        line: e.line,
        kind: e.kind,
        reason: reachable ? "unused-export" : "unreachable-module",
      });
    }
  }

  const unreachableModules = [...fileSet].filter((rel) => !shipping.has(rel)).sort();

  return { entries, shipping, unreachableModules, deadExports, unresolved, exportsByFile };
}

export { ALL as USED_ALL };
