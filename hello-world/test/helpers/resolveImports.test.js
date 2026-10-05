import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { diskFileSet, importsMatching, resolvedImports, virtualFileSet } from "./resolveImports.js";

// The shared import resolver behind the purity guards (see its own header).
// What matters here is the property every guard leans on: DIFFERENT SPELLINGS
// OF ONE IMPORT COME OUT AS ONE TARGET, and a comment cannot pose as an import.

const WORLD = virtualFileSet([
  "lib/llm/geminiClient.js",
  "lib/llm/index.js",
  "lib/supabase/client.js",
  "lib/url/safeExternalHref.js",
]);

const targetsOf = (src, fromRel = "lib/copilot/x.js") => resolvedImports(src, fromRel, WORLD).map((e) => e.target);

describe("resolvedImports -- one target, however it is spelled", () => {
  it("collapses the relative, aliased and dynamic spellings of one module to the same repo-relative path", () => {
    const relative = targetsOf('import { a } from "../llm/geminiClient.js";');
    const aliased = targetsOf('import { a } from "@/lib/llm/geminiClient.js";');
    const aliasedBare = targetsOf('import { a } from "@/lib/llm/geminiClient";');
    const dynamicRel = targetsOf('export async function f() { return import("../llm/geminiClient.js"); }');
    const dynamicAlias = targetsOf('export async function f() { return import("@/lib/llm/geminiClient"); }');
    for (const t of [relative, aliased, aliasedBare, dynamicRel, dynamicAlias]) expect(t).toEqual(["lib/llm/geminiClient.js"]);
  });

  it("resolves from the IMPORTING file's own directory (the same specifier means different things from different files)", () => {
    expect(targetsOf('import { a } from "../llm/geminiClient.js";', "lib/copilot/x.js")).toEqual(["lib/llm/geminiClient.js"]);
    expect(targetsOf('import { a } from "../../lib/llm/geminiClient.js";', "app/hooks/y.js")).toEqual(["lib/llm/geminiClient.js"]);
    expect(targetsOf('import { a } from "../../lib/supabase/client";', "app/login/page.js")).toEqual(["lib/supabase/client.js"]);
  });

  it("normalises a path that wanders, so a text match on the directory spelling cannot be dodged", () => {
    expect(targetsOf('import { a } from "../lib/supabase/../supabase/./client.js";', "app/page.js")).toEqual(["lib/supabase/client.js"]);
  });

  it("resolves a directory import to its index module", () => {
    expect(targetsOf('import { a } from "../llm";')).toEqual(["lib/llm/index.js"]);
  });

  it("still reports the normalised path of an import that resolves to nothing (a missing file is no hiding place)", () => {
    const [edge] = resolvedImports('import { a } from "../llm/notYetWritten.js";', "lib/copilot/x.js", WORLD);
    expect(edge.kind).toBe("unresolved");
    expect(edge.target).toBe("lib/llm/notYetWritten.js");
  });

  it("reports a bare specifier as itself and an asset by its normalised path", () => {
    expect(targetsOf('import { GoogleGenAI } from "@google/genai";\nimport https from "node:https";')).toEqual(["@google/genai", "node:https"]);
    const [asset] = resolvedImports('import data from "../llm/table.json";', "lib/copilot/x.js", WORLD);
    expect(asset.kind).toBe("asset");
    expect(asset.target).toBe("lib/llm/table.json");
  });

  it("sees a re-export `from` as an import edge, with the dynamic flag only on import()", () => {
    const edges = resolvedImports(
      'export { a } from "../llm/geminiClient.js";\nexport * from "../supabase/client.js";\nexport const lazy = () => import("../llm/index.js");',
      "lib/copilot/x.js",
      WORLD,
    );
    expect(edges.map((e) => e.target)).toEqual(["lib/llm/geminiClient.js", "lib/supabase/client.js", "lib/llm/index.js"]);
    expect(edges.map((e) => e.dynamic)).toEqual([false, false, true]);
  });
});

describe("resolvedImports -- documentation is not code", () => {
  it("a comment, a block comment, a string and a template literal that NAME an import are not edges", () => {
    const src = [
      '// import { a } from "../llm/geminiClient.js";',
      '/* import { b } from "@/lib/supabase/client.js"; */',
      'export const doc = "import { c } from \\"../llm/geminiClient.js\\"";',
      "export const note = `import(\"../llm/geminiClient.js\")`;",
    ].join("\n");
    expect(resolvedImports(src, "lib/copilot/x.js", WORLD)).toEqual([]);
  });

  it("[control] the same lines uncommented ARE edges -- the discrimination is the parser's, not blindness", () => {
    const live = 'import { a } from "../llm/geminiClient.js";\nexport const x = a;';
    expect(resolvedImports(live, "lib/copilot/x.js", WORLD)).toHaveLength(1);
    expect(resolvedImports(`// ${live.split("\n")[0]}\nexport const x = 1;`, "lib/copilot/x.js", WORLD)).toEqual([]);
  });
});

describe("importsMatching", () => {
  it("returns only the edges whose resolved target matches, and an empty array for a clean file", () => {
    const src = 'import { a } from "../llm/geminiClient.js";\nimport { b } from "./sibling.js";';
    const hits = importsMatching(src, "lib/copilot/x.js", /^lib\/llm\//, WORLD);
    expect(hits.map((e) => e.target)).toEqual(["lib/llm/geminiClient.js"]);
    expect(importsMatching('import { b } from "./sibling.js";', "lib/copilot/x.js", /^lib\/llm\//, WORLD)).toEqual([]);
  });
});

describe("against the REAL tree (so a virtual-world green cannot hide a resolver that fails on disk)", () => {
  it("diskFileSet sees a real file, and denies a missing one and a bare directory", () => {
    const disk = diskFileSet();
    expect(disk.has("lib/sourceScan/exportGraph.js")).toBe(true);
    expect(disk.has("lib/sourceScan/doesNotExist.js")).toBe(false);
    expect(disk.has("lib/sourceScan")).toBe(false);
  });

  it("resolves the relative imports of a real module to real files", () => {
    // app/hooks/useMaterialsLocker.js writes `../../lib/supabase/client`.
    const rel = "app/hooks/useMaterialsLocker.js";
    const src = readFileSync(fileURLToPath(new URL("../../app/hooks/useMaterialsLocker.js", import.meta.url)), "utf8");
    const edges = resolvedImports(src, rel);
    const client = edges.find((e) => e.spec === "../../lib/supabase/client");
    expect(client, "the module no longer imports ../../lib/supabase/client").toBeTruthy();
    expect(client.kind).toBe("module");
    expect(client.target).toBe("lib/supabase/client.js");
    expect(importsMatching(src, rel, /^lib\/supabase\//)).not.toEqual([]);
  });
});
