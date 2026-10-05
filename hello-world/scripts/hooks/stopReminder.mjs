#!/usr/bin/env node
// Stop hook (N120): a NON-BLOCKING never-stop reminder. Registered in .claude/settings.json. It always
// exits 0 and never emits decision/continue/stopReason, so it cannot refuse a stop. All logic lives in
// lib/stopReminder.mjs (unit-tested there). stdin is drained and ignored: nothing in the payload can
// change the outcome, which keeps "can never block" a property of this file rather than of the input.
import { evaluateStop } from "./lib/stopReminder.mjs";
import { readStdin } from "./lib/readStdin.mjs";

async function main() {
  await readStdin();
  const { exitCode, stdout } = evaluateStop();
  if (stdout) process.stdout.write(stdout);
  process.exitCode = exitCode;
}

main().catch(() => {
  process.exitCode = 0;
});
