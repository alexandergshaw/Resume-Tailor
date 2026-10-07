// N119: PreToolUse render-currency gate. A stale docs/BACKLOG.md shipped twice (c21547e, 493868a) and
// misleads the next session's step 0; this blocks a `git commit` / `git push` when BACKLOG.md no
// longer equals a fresh render of docs/backlog.yml, so the check no longer depends on remembering it.
//
// N136: the same hook also runs the backlog CONTRACT (validateContract, the check behind `npm run
// backlog:check`) on the same trigger. The render check cannot see a schema defect: an item whose
// state is not one of the three known values is silently dropped by renderMarkdown, and BACKLOG.md is
// "current" against that render. That is how an N-id set to state "shipped" and an N-id set to a
// valid-but-wrong state reached main red; they were caught only by scripts/backlog tests, after the push.
//
// The blocking rule is deliberately narrow: exit 2 ONLY on a CONFIRMED drift or a CONFIRMED contract
// violation. Every other outcome - a non-git command, a current and valid file, unusable hook input,
// a missing/unparseable backlog.yml, any thrown error - exits 0. A gate that blocks on its own
// malfunction would brick every commit. The two checks fail open INDEPENDENTLY: one that throws never
// suppresses a confirmed block from the other.
import { readFileSync } from "node:fs";
import { loadBacklogItems, BACKLOG_MD_PATH } from "../../backlog/lib/loadBacklog.mjs";
import { validateContract } from "../../backlog/lib/contract.mjs";
import { renderMarkdown } from "../../backlog/lib/renderMarkdown.mjs";
import { normalizeLineEndings } from "../../backlog/lib/normalizeLineEndings.mjs";
import { isGitCommitOrPush } from "./gitCommand.mjs";

const ALLOW = { exitCode: 0, stderr: "" };
const MAX_LISTED_VIOLATIONS = 10;

/** 1-based number of the first line where two texts differ (past the shorter one if it is a prefix). */
export function firstDifferenceLine(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    if (left[i] !== right[i]) return i + 1;
  }
  return max;
}

/**
 * Pure: a fresh render vs the on-disk BACKLOG.md -> allow | block. Both sides are CRLF-normalized
 * exactly as `npm run backlog:check` (checkGenerated.mjs) does, so this blocks iff that check would
 * fail: this repo has core.autocrlf=true, and comparing raw bytes would block every clean checkout.
 * Throws if either side is not a string - the caller turns that into a fail-open warning.
 */
export function decideRenderGate({ renderedText, onDiskText }) {
  const fresh = normalizeLineEndings(renderedText);
  const committed = normalizeLineEndings(onDiskText);
  if (fresh === committed) return { action: "allow" };
  return { action: "block", line: firstDifferenceLine(fresh, committed) };
}

/**
 * Pure: a validateContract result -> allow | block. Decides on the NAMED violations alone, so a
 * result that claims `ok: false` without naming one is not a confirmed violation and allows. Throws
 * if the result is not `{ violations: string[] }` - the caller turns that into a fail-open warning.
 */
export function decideContractGate(result) {
  const violations = result?.violations;
  if (!Array.isArray(violations) || !violations.every((v) => typeof v === "string")) {
    throw new TypeError("the contract check did not return a { violations: string[] } result");
  }
  if (violations.length === 0) return { action: "allow" };
  return { action: "block", violations };
}

function blockMessage(line) {
  return [
    `BLOCKED by the render-currency gate: docs/BACKLOG.md is STALE - it does not match a fresh render of docs/backlog.yml (first difference at line ${line}).`,
    "Re-render and re-stage it before committing or pushing:",
    "  node hello-world/scripts/backlog/render.mjs",
    "  git add docs/BACKLOG.md",
    "Then retry this command. (Never hand-edit BACKLOG.md; edit docs/backlog.yml and re-render.)",
    "",
  ].join("\n");
}

function contractBlockMessage(violations) {
  const listed = violations.slice(0, MAX_LISTED_VIOLATIONS).map((v) => `  - ${v}`);
  const hidden = violations.length - listed.length;
  return [
    `BLOCKED by the backlog-contract gate: docs/backlog.yml violates the backlog contract (${violations.length} violation(s)) - the check "npm run backlog:check" runs would fail on it.`,
    ...listed,
    ...(hidden > 0 ? [`  ...and ${hidden} more (run "npm run backlog:check" in hello-world to list them all)`] : []),
    "Fix docs/backlog.yml (an N id is state \"actionable\", a D id \"owner\", a V id \"verification\"; a closed item is deleted, never given a new state), re-render with node hello-world/scripts/backlog/render.mjs, then retry this command.",
    "",
  ].join("\n");
}

const describeError = (err) => (err && err.message ? err.message : String(err));

/** The real inputs: a render of docs/backlog.yml, the on-disk docs/BACKLOG.md, and the contract check. */
export const defaultDeps = {
  renderBacklog: () => renderMarkdown(loadBacklogItems()),
  readBacklogMd: () => readFileSync(BACKLOG_MD_PATH, "utf8"),
  validateBacklog: () => validateContract(loadBacklogItems()),
};

/** One check -> { block } (confirmed defect) | { warning } (could not decide, fail open) | {} (clean). */
function checkRenderCurrency(deps) {
  try {
    const decision = decideRenderGate({ renderedText: deps.renderBacklog(), onDiskText: deps.readBacklogMd() });
    return decision.action === "allow" ? {} : { block: blockMessage(decision.line) };
  } catch (err) {
    return {
      warning: `render-currency gate: could not verify docs/BACKLOG.md (${describeError(err)}); allowing. Run "npm run backlog:check" in hello-world to check it by hand.\n`,
    };
  }
}

function checkBacklogContract(deps) {
  try {
    const decision = decideContractGate(deps.validateBacklog());
    return decision.action === "allow" ? {} : { block: contractBlockMessage(decision.violations) };
  } catch (err) {
    return {
      warning: `backlog-contract gate: could not validate docs/backlog.yml (${describeError(err)}); allowing. Run "npm run backlog:check" in hello-world to check it by hand.\n`,
    };
  }
}

/**
 * Hook stdin text -> { exitCode, stderr }. Never throws. exitCode is 2 only for a confirmed render
 * drift or a confirmed contract violation on a git commit/push; everything else is 0 (with a stderr
 * warning when a check could not decide).
 */
export function evaluateRenderGate(stdinText, deps = defaultDeps) {
  let command;
  try {
    // A UTF-8 BOM is an encoding artifact (Windows PowerShell adds one to piped text), not content.
    const hasBom = typeof stdinText === "string" && stdinText.charCodeAt(0) === 0xfeff;
    const text = hasBom ? stdinText.slice(1) : stdinText;
    command = JSON.parse(text)?.tool_input?.command;
  } catch (err) {
    return { exitCode: 0, stderr: `render-currency gate: could not parse the hook input (${describeError(err)}); allowing.\n` };
  }
  if (!isGitCommitOrPush(command)) return ALLOW;

  const outcomes = [checkRenderCurrency(deps), checkBacklogContract(deps)];
  const blocks = outcomes.map((o) => o.block).filter(Boolean);
  const warnings = outcomes.map((o) => o.warning).filter(Boolean);
  if (blocks.length > 0) return { exitCode: 2, stderr: [...blocks, ...warnings].join("") };
  if (warnings.length > 0) return { exitCode: 0, stderr: warnings.join("") };
  return ALLOW;
}
