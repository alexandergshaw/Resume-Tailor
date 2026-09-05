// AC-3b, STATIC HALF — "every statement that writes applications.status
// carries the guard on that same statement" starts from knowing the
// complete set of statements that write to `applications` at all. This file
// is that census: every production file with an `.insert(`/`.update(`/
// `.upsert(` chained off `.from("applications")` (or the module's own
// `.from(APPLICATIONS_TABLE)` form), asserted with `toEqual` so a SEVENTH
// file added later fails at the moment it is added, not silently.
//
// NOTE ON PLACEMENT: 3-plan-dataloss.md's PART 2 names this sweep
// `lib/supabase/applicationStatusCensus.test.js`. It lives here, under
// `lib/applications/`, instead — this wave's own file grant permits new
// sweep test files only under `lib/applications/` or `test/`, and
// `lib/supabase/` already carries in-flight work (applicationStatusWriter.js
// and its own tests) from a different wave this file must not collide with.
// Reported in the final wave-4 report, not silently relocated.
//
// WHY THIS IS A COARSER CENSUS THAN AC-3b'S ORIGINAL "SIX STATEMENTS" TABLE.
// After the writer landed, most call sites no longer issue their OWN
// `applications` write statement at all — they call `upsertApplication` /
// `writeApplicationStatus` / `setApplicationStatusByUser`, which is a
// function call, not a `.from("applications")` chain in the CALLER's own
// source text. The real statements collapsed from many files into
// (essentially) one: `lib/supabase/applicationStatusWriter.js`. Detecting
// whether an arbitrary `.update(`/`.upsert(` payload's KEY SET includes
// `status` is unreliable by regex alone when the payload is a variable
// reference (exactly the writer's own C3 upsert: `.upsert(payload, {...})`)
// rather than an inline literal — so this census operates at the courser,
// but MECHANICALLY RELIABLE, granularity of "which files write to
// `applications` AT ALL", and each file's status-touching disposition is
// recorded in a comment, hand-verified by reading the statement (never
// assumed from a name), rather than machine-inferred from the payload shape.
// AC-3b's PART 6a behavioural walk (lib/supabase/applicationStatusGuardWalk.
// test.js) is the instrument that actually inspects payload+filter
// co-occurrence at runtime — this file's job is only to close the SET of
// files a human (or that walk) needs to look at.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const LIB_DIR = path.join(ROOT, "lib");
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

const FROM_APPLICATIONS_RE = /\.from\(\s*(?:"applications"|APPLICATIONS_TABLE)\s*\)/g;
const WRITE_VERB_RE = /\.(insert|update|upsert)\s*\(/;

// Depth-aware: returns the statement text starting at `fromIdx` up to (but
// excluding) the first top-level `;` — "top-level" meaning every paren/
// brace/bracket opened after `fromIdx` has already closed. This is what lets
// a `.from("applications").update({...}).eq(...).select(...)` chain be read
// as ONE statement regardless of how many calls it chains, without a full
// JS parser.
function extractStatementAfter(src, fromIdx) {
  let depth = 0;
  let inString = null;
  for (let i = fromIdx; i < src.length; i++) {
    const ch = src[i];
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
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === ";" && depth <= 0) return src.slice(fromIdx, i);
  }
  return src.slice(fromIdx);
}

// A file is flagged if ANY `.from("applications")` statement in it contains
// a write verb (insert/update/upsert) — reads (select/delete/eq-only
// chains) are not this census's concern; AC-3b is about WRITES.
function writesApplications(src) {
  const re = new RegExp(FROM_APPLICATIONS_RE.source, "g");
  let match;
  while ((match = re.exec(src))) {
    const statement = extractStatementAfter(src, match.index);
    if (WRITE_VERB_RE.test(statement)) return true;
  }
  return false;
}

let SOURCE_CACHE = null;
function sourceFiles() {
  if (SOURCE_CACHE) return SOURCE_CACHE;
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".js")) continue;
      if (full.endsWith(".test.js")) continue;
      if (path.resolve(full) === SELF_PATH) continue;
      found.push(full);
    }
  };
  walk(APP_DIR);
  walk(LIB_DIR);
  SOURCE_CACHE = found.map((f) => [path.relative(ROOT, f).split(path.sep).join("/"), readFileSync(f, "utf8")]);
  return SOURCE_CACHE;
}

beforeAll(() => {
  sourceFiles();
}, 60_000);

// The measured, hand-verified census. Each entry's disposition was read from
// the actual statement, not inferred from the file name — see the citation.
//
//   guarded  — the write's payload DOES include `status`, and the guard
//              (an allow-list filter, or write-once WHERE) is on the SAME
//              statement. Currently only the sanctioned writer module.
//   insert   — a plain INSERT naming `status`. AC-1a clause 1: no row exists
//              yet, so there is nothing to demote — exempt by construction,
//              not by omission.
//   no-status — the write never names `status` in its payload at all, so
//               AC-3b (which is about status writes specifically) does not
//               apply to it. Read in full above, in "the census" comments.
const CENSUS = {
  // C1 (`.update({ status })`, allow-listed), C4 (`.update({ applied_at })`,
  // write-once by WHERE) and C3 (`.upsert(payload, {...})`, `payload` names
  // `status` — see applicationStatusWriter.js:178-190) all live here. This
  // is the ONE sanctioned home AC-3a's "one home" and AC-3b's "the guard is
  // never a separate statement" both describe.
  "lib/supabase/applicationStatusWriter.js": "guarded",
  // `handleSaveAddApplication`'s `.insert({ ..., status: addAppDialog.status,
  // ... })` — a brand-new row (positionId is freshly minted the same call),
  // so AC-1a clause 1 applies with no guard needed.
  "app/hooks/useApplicationDialogs.js": "insert",
  // The SAME file also carries two narrow `.update()`s with no status key
  // (resume_used_id linking, application_url) — `insert` above already
  // accounts for the file being in this census; those two updates are why
  // the file is not ALSO independently flagged as "guarded".
  //
  // `tailorAndQueueOne`'s metadata update names resume_used_id/
  // cover_letter_id/auto_search_id/auto_saved_at — never status (F-7 splits
  // this from the status claim specifically so it never carries one).
  "lib/feed/tailorAndQueue.js": "no-status",
  // `pointApplicationAtVersion` updates resume_used_id OR cover_letter_id —
  // never status.
  "lib/supabase/documentVersions.js": "no-status",
  // `persistGeneratedDocuments` builds its update conditionally
  // (`if (outcome.resumeId) updates.resume_used_id = ...`) and never adds a
  // status key — R4's cited precedent for AC-1d.
  "lib/supabase/persistGeneration.js": "no-status",
  // Updates only `auto_apply_opened_at` — deliberately leaves status
  // untouched (AC-1d's other in-repo precedent).
  "app/api/auto-apply-queue/[id]/apply/route.js": "no-status",
};

describe("[src] applications write-statement census — AC-3b static half", () => {
  it("[control] the sweep walks a populated tree", () => {
    const swept = sourceFiles().map(([rel]) => rel);
    expect(swept.length).toBeGreaterThan(100);
    expect(swept).toContain("lib/supabase/applicationStatusWriter.js");
  });

  describe("extractStatementAfter", () => {
    it("[canary] stops at the top-level semicolon, not one nested inside the chain", () => {
      const src = 'foo(); bar.from("applications").update({ x: "a;b" }).eq(y, 1); baz();';
      const fromIdx = src.indexOf(".from(");
      const statement = extractStatementAfter(src, fromIdx);
      expect(statement).toContain(".update(");
      expect(statement).not.toContain("baz()");
    });

    it("[canary] a semicolon INSIDE a string does not end the statement early", () => {
      const src = '.from("applications").update({ note: "a; b" }).eq(x, 1);';
      const statement = extractStatementAfter(src, 0);
      expect(statement).toContain(".eq(x, 1)");
    });
  });

  describe("writesApplications", () => {
    it("[canary] true for a synthetic insert/update/upsert on applications", () => {
      expect(writesApplications('supabase.from("applications").insert({ status: "x" });')).toBe(true);
      expect(writesApplications('supabase.from("applications").update({ status: "x" }).eq("id", 1);')).toBe(true);
      expect(writesApplications('supabase.from("applications").upsert(payload, {});')).toBe(true);
      expect(writesApplications('supabase.from(APPLICATIONS_TABLE).update({ status }).eq("id", 1);')).toBe(true);
    });

    it("[canary] false for a read-only chain on applications", () => {
      expect(writesApplications('supabase.from("applications").select("id").eq("status", "applied");')).toBe(false);
      expect(writesApplications('supabase.from("applications").delete().eq("id", 1);')).toBe(false);
    });

    it("[control] false-positive proof — a real, unrelated applications SELECT is not flagged", () => {
      // lib/copilot/postings.js reads applications via a join filter but
      // never writes to the table at all.
      const [, src] = sourceFiles().find(([rel]) => rel === "lib/copilot/postings.js");
      expect(src).toContain('from("applications")');
      expect(writesApplications(src)).toBe(false);
    });
  });

  it("[control] the census can fail — a stray write in an uncensused file would be caught", () => {
    const planted = 'export function x() { db.from("applications").update({ status: "tailored" }).eq("id", 1); }';
    expect(writesApplications(planted)).toBe(true);
  });

  it("every CENSUS entry's file actually exists in the swept corpus", () => {
    const swept = new Set(sourceFiles().map(([rel]) => rel));
    for (const rel of Object.keys(CENSUS)) {
      expect(swept.has(rel), `${rel} was not found under app/ or lib/`).toBe(true);
    }
  });

  it("the set of files writing to applications is EXACTLY the census — toEqual, not toContain", () => {
    const flagged = sourceFiles()
      .filter(([, src]) => writesApplications(src))
      .map(([rel]) => rel)
      .sort();
    expect(flagged).toEqual(Object.keys(CENSUS).sort());
  });

  it("exactly one file is the sanctioned 'guarded' home, and exactly one carries the AC-1a insert exemption", () => {
    const byDisposition = (wanted) => Object.entries(CENSUS).filter(([, d]) => d === wanted).map(([f]) => f);
    expect(byDisposition("guarded")).toEqual(["lib/supabase/applicationStatusWriter.js"]);
    expect(byDisposition("insert")).toEqual(["app/hooks/useApplicationDialogs.js"]);
    expect(byDisposition("no-status").sort()).toEqual(
      [
        "app/api/auto-apply-queue/[id]/apply/route.js",
        "lib/feed/tailorAndQueue.js",
        "lib/supabase/documentVersions.js",
        "lib/supabase/persistGeneration.js",
      ].sort(),
    );
  });
});
