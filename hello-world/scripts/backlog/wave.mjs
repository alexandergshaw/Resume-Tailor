#!/usr/bin/env node
// backlog:wave — the next 2-3 actionable, scoped items whose `owns` globs do not intersect,
// computed mechanically against a real listing of hello-world/. Items without owns/verify (see
// backlog:next --unscoped) are never wave candidates.
// Usage: node scripts/backlog/wave.mjs [--json]
import { loadBacklogItems, HELLO_WORLD_ROOT } from "./lib/loadBacklog.mjs";
import { listAllFiles } from "./lib/listFiles.mjs";
import { computeWave } from "./lib/wave.mjs";

function main() {
  const json = process.argv.includes("--json");
  const items = loadBacklogItems();
  const allFiles = listAllFiles(HELLO_WORLD_ROOT);
  const result = computeWave(items, allFiles);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.accepted.length === 0) {
    console.log("backlog:wave — no scoped, unblocked actionable items to wave (none have both owns and verify set yet).");
  } else {
    console.log(`backlog:wave — ${result.accepted.length} item(s): ${result.accepted.map((a) => a.id).join(", ")}`);
  }
  for (const s of result.skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
  console.log(result.note);
}

main();
