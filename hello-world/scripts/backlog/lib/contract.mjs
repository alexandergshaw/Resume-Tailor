import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HELLO_WORLD_ROOT, REPO_ROOT } from "./loadBacklog.mjs";

const VALID_STATES = new Set(["actionable", "owner", "verification"]);
const ID_SHAPE = /^[A-Za-z]+\d+$/;

// Matches a vitest `-t`/`--testNamePattern` filter as its own CLI token. This is the exact shape
// measured to defeat a naive verify gate: `npx vitest run x.test.js -t "zzNoSuchTestzz"` exits 0
// with "Tests N skipped (N)" and no "failed" anywhere in the summary — a command that structurally
// cannot fail, and a routine test-title rename later makes ANY `-t` filter go dead silently even
// when it once discriminated correctly. Rejected outright rather than merely flagged, because the
// hash-pin in verify_proof.command_sha256 is blind to what a filter selects, only to the string.
const DEAD_FILTER_SHAPE = /(^|\s)(-t|--testNamePattern)(\s|=|$)/;

// A WHOLE whitespace-delimited token that is unmistakably a repo-relative file: at least one `/`,
// only path-safe characters (so URLs, globs, `$VAR`, `--flag=value`, absolute paths and code inside
// a quoted string never match), and a known file extension at the end. Deliberately narrow — a token
// that is merely file-ish (a bare `x.test.js`, which vitest reads as a filter that matches anywhere,
// or a bare directory) is NOT a cited path, so prose in a verify string cannot false-positive.
const CITED_PATH_SHAPE =
  /^(?:[\w.[\]()-]+\/)+[\w.[\]()-]+\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|json|md|yml|yaml|sql|sh|css|html)$/i;
// Shell quoting and statement punctuation that can wrap a path token without being part of it.
const WRAPPER_START = /^["'`(]+/;
const WRAPPER_END = /["'`),;]+$/;

// Verify commands run from hello-world/ (`npx vitest run lib/...`) or from the repo root
// (`node hello-world/scripts/...`, `docs/...`); a cited path is real if it resolves under either.
const PATH_ROOTS = [HELLO_WORLD_ROOT, REPO_ROOT];

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Every distinct file path the `verify` command cites that exists under neither root. Vitest treats
 * each positional as a substring FILTER, so `vitest run <real> <missing>` exits 0 with "1 passed" and
 * the missing path is silently absorbed — a typo'd or invented path reads as a satisfied verify
 * (measured on vitest 4.1.8, N21). Nothing downstream executes a verify string, so this is the only
 * place a wrong path can be caught.
 */
function missingCitedPaths(verify) {
  const missing = [];
  for (const raw of verify.split(/\s+/)) {
    if (raw.startsWith("-")) continue; // a flag, never a positional path
    const token = raw.replace(WRAPPER_START, "").replace(WRAPPER_END, "");
    if (!CITED_PATH_SHAPE.test(token) || missing.includes(token)) continue;
    if (!PATH_ROOTS.some((root) => existsSync(join(root, token)))) missing.push(token);
  }
  return missing;
}

/**
 * The four-part authoring proof required before a `verify` command is trusted: it must have failed
 * on HEAD (before any fix), passed once a real fix landed, gone red again when that fix was
 * reverted or mutated (the KILL control — B4's fix; without it a `verify` whose green is
 * independent of the actual work still certifies the item), and survived a no-op edit (the
 * standard mutation-testing no-op control). Exit codes here are the CHECKER's own recorded
 * verdict after reading vitest's own `Tests …` line by hand — never the raw process exit code,
 * which a dead filter or a spawn failure can both report as 0/success.
 */
function verifyProofViolations(item) {
  const violations = [];
  const proof = item.verify_proof;
  if (proof == null || typeof proof !== "object") {
    violations.push(`${item.id}: verify is set but verify_proof is not populated`);
    return violations;
  }
  const required = [
    "command_sha256",
    "fails_on_head_exit",
    "passes_on_fix_exit",
    "kills_on_revert_exit",
    "survives_noop_exit",
    "proved_at",
    "proved_by",
  ];
  for (const key of required) {
    if (proof[key] == null) violations.push(`${item.id}: verify_proof.${key} is missing`);
  }
  if (proof.command_sha256 != null && proof.command_sha256 !== sha256(item.verify)) {
    violations.push(`${item.id}: verify_proof.command_sha256 does not match the live verify string (stale proof — re-run the gate)`);
  }
  if (proof.fails_on_head_exit != null && proof.fails_on_head_exit === 0) {
    violations.push(`${item.id}: verify_proof.fails_on_head_exit is 0 — verify must fail on HEAD before any fix`);
  }
  if (proof.passes_on_fix_exit != null && proof.passes_on_fix_exit !== 0) {
    violations.push(`${item.id}: verify_proof.passes_on_fix_exit is nonzero — verify must pass once the fix lands`);
  }
  if (proof.kills_on_revert_exit != null && proof.kills_on_revert_exit === 0) {
    violations.push(`${item.id}: verify_proof.kills_on_revert_exit is 0 — reverting the fix must turn verify red again (the kill control)`);
  }
  if (proof.survives_noop_exit != null && proof.survives_noop_exit !== 0) {
    violations.push(`${item.id}: verify_proof.survives_noop_exit is nonzero — a semantically-inert edit must not break verify`);
  }
  return violations;
}

/**
 * Structural validation of parsed backlog.yml items. Enforces non-null owns/verify NOWHERE here —
 * that is enforced at the READ site (pick.mjs), per this file's "record at disposal" rule: an item
 * may honestly sit unscoped for many rounds. What this DOES enforce, always:
 *   - every id is namespaced (B3 shape) and globally unique (B3 fix)
 *   - state is one of the three known values, with its state-specific required text present
 *   - a non-null `verify` never uses a dead `-t`/`--testNamePattern` filter (B4)
 *   - a non-null `verify` only cites file paths that exist under hello-world/ or the repo root (N21)
 *   - a non-null `verify` carries a complete, internally-consistent, hash-pinned verify_proof (B4)
 * Returns { ok, violations } — never throws, so a caller can report every violation at once.
 */
export function validateContract(items) {
  const violations = [];

  const seenIds = new Map();
  for (const item of items) {
    if (typeof item.id !== "string" || !ID_SHAPE.test(item.id)) {
      violations.push(`(unknown id) has a non-namespaced id: ${JSON.stringify(item.id)}`);
      continue;
    }
    if (seenIds.has(item.id)) {
      violations.push(`duplicate id "${item.id}" (also used by an earlier item in this file)`);
    }
    seenIds.set(item.id, (seenIds.get(item.id) ?? 0) + 1);
  }

  for (const item of items) {
    if (!VALID_STATES.has(item.state)) {
      violations.push(`${item.id}: unknown state ${JSON.stringify(item.state)}`);
      continue;
    }
    if (item.state === "actionable") {
      if (!item.title) violations.push(`${item.id}: actionable item has no title`);
      if (!item.owed_by) violations.push(`${item.id}: actionable item has no owed_by`);
    }
    if (item.state === "owner") {
      if (!item.title) violations.push(`${item.id}: owner item has no title (question)`);
      if (!item.blocked_reason) violations.push(`${item.id}: owner item has no blocked_reason`);
    }
    if (item.state === "verification") {
      if (!item.title) violations.push(`${item.id}: verification item has no title`);
      if (!item.instrument) violations.push(`${item.id}: verification item has no instrument`);
    }

    if (item.verify != null) {
      if (DEAD_FILTER_SHAPE.test(item.verify)) {
        violations.push(`${item.id}: verify uses a "-t"/"--testNamePattern" filter, which can go dead silently — name the filter's title, not the command`);
      }
      for (const path of missingCitedPaths(item.verify)) {
        violations.push(`${item.id}: verify cites a path that does not exist: "${path}" (checked under hello-world/ and the repo root) — vitest absorbs a missing positional beside a real one and still exits 0, so a typo'd path would read as a satisfied verify`);
      }
      violations.push(...verifyProofViolations(item));
    }
  }

  return { ok: violations.length === 0, violations };
}
