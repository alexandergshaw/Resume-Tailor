#!/usr/bin/env node
// PreToolUse hook (N119, N136): blocks a `git commit` / `git push` when docs/BACKLOG.md is stale OR
// docs/backlog.yml violates the backlog contract (validateContract). Registered in
// .claude/settings.json (matcher "Bash|PowerShell"). Reads the hook JSON from stdin, exits 2 with the
// remedy on stderr ONLY on a confirmed drift or violation, and exits 0 for everything else -
// including any error of its own. All logic lives in lib/renderGate.mjs (unit-tested there).
import { evaluateRenderGate } from "./lib/renderGate.mjs";
import { readStdin } from "./lib/readStdin.mjs";

async function main() {
  const { exitCode, stderr } = evaluateRenderGate(await readStdin());
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}

main().catch((err) => {
  // Fail open: the gate's own malfunction must never block a commit.
  process.stderr.write(`render-currency gate: unexpected error (${err && err.message ? err.message : err}); allowing.\n`);
  process.exitCode = 0;
});
