import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAllFiles } from "./listFiles.mjs";

describe("listAllFiles", () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("walks a real directory tree and returns POSIX-style relative paths", () => {
    dir = mkdtempSync(join(tmpdir(), "backlog-listfiles-"));
    mkdirSync(join(dir, "lib", "sub"), { recursive: true });
    writeFileSync(join(dir, "a.js"), "");
    writeFileSync(join(dir, "lib", "b.js"), "");
    writeFileSync(join(dir, "lib", "sub", "c.js"), "");

    const files = listAllFiles(dir).sort();
    expect(files).toEqual(["a.js", "lib/b.js", "lib/sub/c.js"]);
  });

  it("excludes node_modules — kills a mutant that removes the exclude-list check", () => {
    dir = mkdtempSync(join(tmpdir(), "backlog-listfiles-"));
    mkdirSync(join(dir, "node_modules", "somepkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "somepkg", "index.js"), "");
    writeFileSync(join(dir, "real.js"), "");

    const files = listAllFiles(dir);
    expect(files).toEqual(["real.js"]);
  });

  it("does not crash on a missing/unreadable directory", () => {
    expect(() => listAllFiles(join(tmpdir(), "backlog-listfiles-does-not-exist"))).not.toThrow();
    expect(listAllFiles(join(tmpdir(), "backlog-listfiles-does-not-exist"))).toEqual([]);
  });
});
