// AC-S2 -- the SECOND WITNESS for the unattended (cron) pipeline's spend limits.
//
// Every ceiling that governs unattended paid work is named here with the VALUE
// it declares and the SCOPE it actually enforces (per run vs per UTC day). The
// test resolves each identifier to the number it declares -- the resolveBound
// idiom from lib/rateLimit/adoption.test.js -- so a value changed anywhere in
// the tree without a reviewer editing this table is a red test, which is exactly
// the review moment a spend ceiling deserves.
//
// It ALSO fails while a name asserts a scope it does not enforce. The concrete
// case AC-S2 was written against: app/api/cron/tailor/route.js shipped
// `const ABSOLUTE_USER_CAP = 100` -- a name claiming an absolute ceiling that
// enforces NOTHING, because it is only ever `Math.min(ABSOLUTE_USER_CAP, <a
// column sanitizeCap has already clamped>)`. The honest edit is to delete it, and
// this file stays red until it is gone.
//
// WHY A SOURCE READ, NOT AN IMPORT. Resolving `const NAME = <n>` from the source
// text (comment-stripped) pins the number wherever it lives -- module-private or
// exported -- WITHOUT this test importing the module. That matters: importing a
// constant that has no production consumer yet (the per-UTC-day and mail ceilings
// are consumed at S4, not S3) would make it a test-only export and move the two
// pinned integers in exportReachability.sweep.test.js (363 / 435). A source read
// creates no import edge, so the implementer may keep a not-yet-consumed ceiling
// module-private (used internally by its own predicate) and neither ESLint nor
// the export sweep is disturbed. See the report's note on DEFAULT_MAX_QUERIES.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

let JS_FILES = null;
function walkJs(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkJs(full, found);
    else if (full.endsWith(".js")) found.push(full);
  }
  return found;
}
function allJsFiles() {
  if (!JS_FILES) {
    JS_FILES = [...walkJs(path.join(ROOT, "lib")), ...walkJs(path.join(ROOT, "app"))];
  }
  return JS_FILES;
}

// Comment-stripped source, so a rule ABOUT an identifier in a comment (e.g. a
// migration note explaining why ABSOLUTE_USER_CAP was removed) is never read as a
// declaration of it. Block comments and whole-line `//` only, matching the
// conservative stripper adoption.test.js uses.
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// Every `const NAME = <number>` declaration of `token` across lib/ + app/,
// comment-stripped. Returns one {file, value} per declaring file. `\bconst`
// matches `export const` too, so export vs module-private is invisible here on
// purpose. More than one is itself a finding: two copies of a bound are how a
// number drifts.
function declarations(token) {
  const decl = new RegExp(`\\bconst ${token}\\s*=\\s*([\\d_]+)\\b`);
  const found = [];
  for (const abs of allJsFiles()) {
    const m = decl.exec(codeOf(readFileSync(abs, "utf8")));
    if (m) found.push({ file: rel(abs), value: Number(m[1].replace(/_/g, "")) });
  }
  return found;
}

// The scope a constant's NAME asserts, derived purely from the name. A name that
// ends _PER_RUN claims per-run; _PER_UTC_DAY claims per UTC day; _MAX_QUERIES is
// the per-ingest-run query lever. If a future constant's name does not encode one
// of these, this returns null and the consistency test fails, forcing the author
// to name the scope into the identifier rather than only into a comment.
function scopeFromName(name) {
  if (/_PER_UTC_DAY$/.test(name)) return "per-utc-day";
  if (/_PER_RUN$/.test(name)) return "per-run";
  if (/_MAX_QUERIES$/.test(name)) return "per-ingest-run";
  return null;
}

// The table. `redOnHead` documents, for the hand-off, which rows are the RED
// (a ceiling that does not exist yet) and which are non-regression guards that
// pin an existing value against silent drift.
const SPEND_CONSTANTS = [
  {
    name: "MAX_TAILORS_PER_USER_PER_RUN",
    value: 5,
    scope: "per-run",
    why: "the per-invocation ceiling on unattended tailors; enforced by the break at cron/tailor when queued.length reaches it",
    redOnHead: false, // guard: exists today as a route-local const = 5
  },
  {
    name: "MAX_TAILORS_PER_USER_PER_UTC_DAY",
    value: 20,
    scope: "per-utc-day",
    why: "owner ruling 2: the durable per-UTC-day ceiling the S4 counter enforces; replaces the misnamed per-run auto_tailor_daily_cap as the real day bound",
    redOnHead: true, // does not exist at HEAD
  },
  {
    name: "MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY",
    value: 4,
    scope: "per-utc-day",
    why: "alert-digest ceiling per recipient address per UTC day (AC-E2)",
    redOnHead: true, // does not exist at HEAD
  },
  {
    name: "MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY",
    value: 10,
    scope: "per-utc-day",
    why: "alert-digest ceiling per account across all addresses per UTC day (AC-E2)",
    redOnHead: true, // does not exist at HEAD
  },
  {
    name: "DEFAULT_MAX_QUERIES",
    value: 3,
    scope: "per-ingest-run",
    why: "the feed-ingest grounded-search cost lever (AC-S8); pinned unchanged. Kept module-private in llmSearchQueries.js -- exporting it purely for this test would move exportReachability's 363/435",
    redOnHead: false, // guard: exists today = 3
  },
];

describe("N60 unattended-pipeline spend constants: the second witness (AC-S2)", () => {
  it.each(SPEND_CONSTANTS)("$name is declared exactly once and equals $value", ({ name, value }) => {
    const decls = declarations(name);
    expect(
      decls.length,
      `${name} must be declared exactly once (found: ${decls.map((d) => `${d.file}=${d.value}`).join(", ") || "none"})`,
    ).toBe(1);
    expect(decls[0].value, `${name} declared value`).toBe(value);
  });

  it.each(SPEND_CONSTANTS)("$name's identifier asserts the scope it is tabled with ($scope)", ({ name, scope }) => {
    // The teeth of "no name may assert a scope it does not enforce": the scope in
    // the table must be readable straight out of the identifier. A per-run bound
    // named ..._PER_UTC_DAY, or vice versa, fails here.
    expect(scopeFromName(name), `${name}: scope read from its name`).toBe(scope);
  });

  it.each(SPEND_CONSTANTS)("$name states a non-trivial reason", ({ why }) => {
    expect(why.length).toBeGreaterThan(20);
  });

  it("ABSOLUTE_USER_CAP is gone -- a name that claimed an absolute ceiling but enforced nothing", () => {
    // Used only as Math.min(ABSOLUTE_USER_CAP, <column already clamped to <= cap>)
    // at cron/tailor/route.js, so it never bound anything. AC-S2 forbids a name
    // asserting a scope it does not enforce; deletion is the honest edit. RED
    // until it is deleted anywhere in the tree.
    expect(declarations("ABSOLUTE_USER_CAP")).toEqual([]);
  });

  it("the per-run tailor ceiling is actually referenced at its enforcement site", () => {
    // The value pin proves the number; this proves the number is USED where it is
    // claimed to bind, so a constant that exists but enforces nothing (the
    // ABSOLUTE_USER_CAP shape) cannot pass by declaration alone. The per-UTC-day
    // and mail ceilings' behavioural enforcement is proven by S4's AC-S1/AC-E2
    // boundary suites, not here -- this table's job is the value+scope witness.
    const route = codeOf(
      readFileSync(path.join(ROOT, "app", "api", "cron", "tailor", "route.js"), "utf8"),
    );
    expect(route).toMatch(/\bMAX_TAILORS_PER_USER_PER_RUN\b/);
  });
});
