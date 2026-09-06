import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// The point of this whole change is that `positions_insert_authenticated` /
// `positions_update_authenticated` (both `auth.role() = 'authenticated'`) can
// be DROPPED and replaced with a service-role-only policy. That is only safe
// while no client bundle writes to `positions` directly — one leftover browser
// write and the tightened policy denies it at runtime, with no compile-time
// signal anywhere.
//
// A grep is the only instrument that can answer "is there another one?"
// exhaustively, so it lives here as a test rather than in a commit message.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

// Matched on the directory's own name, so anything listed here is skipped
// WHEREVER it appears. Keep it to names that can only ever mean the thing
// intended: "supabase" would also have excluded lib/supabase/ — the directory
// holding the writer this test exists to find — and the scan would have passed
// while seeing none of it.
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

const SOURCE_FILES = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))];

// A write chain is `from("positions")` with a write verb chained onto it. The
// chain is routinely broken across lines by the formatter, so match on the
// text that follows rather than on a single line.
const WRITE_VERB = /\.\s*(insert|update|upsert|delete)\s*\(/;

function writesPositions(text) {
  const hits = [];
  const re = /from\(\s*["']positions["']\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Everything up to the end of the statement — a `;` at the start of a
    // line, or 400 characters, whichever comes first.
    const tail = text.slice(m.index, m.index + 400);
    const verb = tail.match(WRITE_VERB);
    if (verb) hits.push(verb[1]);
  }
  return hits;
}

// The one module allowed to write, plus the pre-existing diagnostic route
// whose two `.delete()` calls clean up its own fixture rows under the
// service-role client and never run in a browser.
const ALLOWED_WRITERS = new Set([
  "lib/supabase/writePosition.js",
  "app/api/test-positions/route.js",
]);

describe("the browser-reachable write surface of `positions`", () => {
  it("has exactly one writer outside app/api/", () => {
    const writers = SOURCE_FILES.map(rel).filter((f) => writesPositions(readFileSync(path.join(ROOT, f), "utf8")).length > 0);
    expect(writers.sort()).toEqual([...ALLOWED_WRITERS].sort());
  });

  it("leaves no write chain in app/page.js, app/hooks/ or app/components/", () => {
    const offenders = SOURCE_FILES
      .map(rel)
      .filter((f) => f === "app/page.js" || f.startsWith("app/hooks/") || f.startsWith("app/components/"))
      .filter((f) => writesPositions(readFileSync(path.join(ROOT, f), "utf8")).length > 0);
    expect(offenders).toEqual([]);
  });

  it("keeps `lib/supabase/upsertPosition.js` free of any positions query at all", () => {
    // It ships in the client bundle (app/page.js:81 imports it), so it must
    // reach the table only through the route.
    const text = readFileSync(path.join(ROOT, "lib/supabase/upsertPosition.js"), "utf8");
    expect(text).not.toMatch(/from\(\s*["']positions["']\s*\)/);
    expect(text).toContain("/api/positions");
  });

  it("confines the server-side writer to server-only importers", () => {
    // NOTE ON THIS ASSERTION'S SHAPE. It was first written as "only app/api/
    // and lib/feed/tailorAndQueue.js may mention writePosition at all". That
    // is not achievable while `upsertPosition` stays isomorphic — and it must,
    // because eight call sites across app/page.js, app/hooks/ and app/api/
    // share it. It reaches the writer through a DYNAMIC `import()` inside its
    // server branch, which is what actually keeps the module out of the client
    // bundle, so that is what is checked. A STATIC import from a
    // browser-reachable module is still a failure. (This shape change was made
    // while the assertion was red for a structural reason only — the writer
    // did not exist yet — never to get past a behavioural red.)
    const mentions = SOURCE_FILES
      .map(rel)
      .filter((f) => f !== "lib/supabase/writePosition.js")
      .filter((f) => /writePosition/.test(readFileSync(path.join(ROOT, f), "utf8")));

    const STATIC_IMPORT = /import\s+[^;]*from\s+["'][^"']*writePosition(\.js)?["']/;

    for (const f of mentions) {
      const text = readFileSync(path.join(ROOT, f), "utf8");
      const serverOnly = f.startsWith("app/api/") || f === "lib/feed/tailorAndQueue.js";
      if (serverOnly) continue;
      expect(STATIC_IMPORT.test(text), `${f} statically imports the service-role position writer`).toBe(false);
      expect(text, `${f} mentions writePosition without a dynamic import`).toMatch(
        /import\(\s*["'][^"']*writePosition(\.js)?["']\s*\)/,
      );
    }

    // And it is actually reached — an empty list would pass the loop above
    // while meaning the writer is dead code.
    expect(mentions.length).toBeGreaterThan(0);
    expect(mentions).toContain("lib/feed/tailorAndQueue.js");
    expect(mentions).toContain("app/api/positions/route.js");
  });

  it("routes the Edit Application dialog's position write through the API", () => {
    const text = readFileSync(path.join(ROOT, "app/hooks/useApplicationDialogs.js"), "utf8");
    expect(text).toContain("editPositionFieldsViaApi");
  });
});
