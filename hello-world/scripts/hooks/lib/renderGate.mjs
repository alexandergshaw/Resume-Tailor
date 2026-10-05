// N119: PreToolUse render-currency gate. A stale docs/BACKLOG.md shipped twice (c21547e, 493868a) and
// misleads the next session's step 0; this blocks a `git commit` / `git push` when BACKLOG.md no
// longer equals a fresh render of docs/backlog.yml, so the check no longer depends on remembering it.
//
// The blocking rule is deliberately narrow: exit 2 ONLY on a CONFIRMED drift. Every other outcome -
// a non-git command, a current file, unusable hook input, a missing/unparseable backlog.yml, any
// thrown error - exits 0. A gate that blocks on its own malfunction would brick every commit.
import { readFileSync } from "node:fs";
import { loadBacklogItems, BACKLOG_MD_PATH } from "../../backlog/lib/loadBacklog.mjs";
import { renderMarkdown } from "../../backlog/lib/renderMarkdown.mjs";
import { normalizeLineEndings } from "../../backlog/lib/normalizeLineEndings.mjs";
import { isGitCommitOrPush } from "./gitCommand.mjs";

const ALLOW = { exitCode: 0, stderr: "" };

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

const describeError = (err) => (err && err.message ? err.message : String(err));

/** The real inputs: a render of docs/backlog.yml and the on-disk docs/BACKLOG.md. */
export const defaultDeps = {
  renderBacklog: () => renderMarkdown(loadBacklogItems()),
  readBacklogMd: () => readFileSync(BACKLOG_MD_PATH, "utf8"),
};

/**
 * Hook stdin text -> { exitCode, stderr }. Never throws. exitCode is 2 only for a confirmed drift on
 * a git commit/push; everything else is 0 (with a stderr warning when the gate could not decide).
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

  try {
    const decision = decideRenderGate({ renderedText: deps.renderBacklog(), onDiskText: deps.readBacklogMd() });
    if (decision.action === "allow") return ALLOW;
    return { exitCode: 2, stderr: blockMessage(decision.line) };
  } catch (err) {
    return {
      exitCode: 0,
      stderr: `render-currency gate: could not verify docs/BACKLOG.md (${describeError(err)}); allowing. Run "npm run backlog:check" in hello-world to check it by hand.\n`,
    };
  }
}
