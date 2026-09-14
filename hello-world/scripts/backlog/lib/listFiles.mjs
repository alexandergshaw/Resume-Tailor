import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DEFAULT_EXCLUDE = new Set(["node_modules", ".git", ".next", "coverage"]);

/**
 * Recursively lists every file under `root`, returned as POSIX-style paths relative to `root`
 * (forward slashes even on Windows, so glob patterns written with "/" work on every platform).
 * Excludes the directories in `excludeDirs` (default: build/dependency noise no `owns` pattern
 * should ever need to match).
 */
export function listAllFiles(root, { excludeDirs = DEFAULT_EXCLUDE } = {}) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile()) {
        const rel = relative(root, join(dir, entry.name)).split(sep).join("/");
        out.push(rel);
      }
    }
  }
  walk(root);
  return out;
}
