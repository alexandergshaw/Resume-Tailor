#!/usr/bin/env node
// backlog:next — deterministic single-item selection over docs/backlog.yml.
// Usage: node scripts/backlog/next.mjs [--json] [--session-start]
import { loadBacklogItems } from "./lib/loadBacklog.mjs";
import { pick } from "./lib/pick.mjs";
import { formatDecision } from "./lib/sessionStartText.mjs";

function main() {
  const args = process.argv.slice(2);
  const sessionStart = args.includes("--session-start");
  const json = args.includes("--json");

  try {
    const items = loadBacklogItems();
    const decision = pick(items);
    if (json) {
      console.log(JSON.stringify(decision, null, 2));
    } else {
      console.log(formatDecision(decision));
    }
    process.exit(0);
  } catch (err) {
    // A SessionStart hook must never break a session: print a plain fallback line and still
    // exit 0. Any other caller (a human, checkGenerated) gets the real error and a nonzero exit.
    if (sessionStart) {
      console.log(`Step 0: could not read docs/backlog.yml (${err && err.message ? err.message : err}).`);
      process.exit(0);
    }
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
}

main();
