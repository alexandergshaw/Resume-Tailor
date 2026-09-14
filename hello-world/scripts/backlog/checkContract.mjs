#!/usr/bin/env node
// backlog:check (part 2) — structural validation of docs/backlog.yml: namespaced/unique ids,
// state-specific required fields, and the verify-gate kill control (rejects a dead `-t`/
// `--testNamePattern` filter and requires a complete, hash-pinned, internally-consistent
// verify_proof before a non-null `verify` is trusted).
import { loadBacklogItems } from "./lib/loadBacklog.mjs";
import { validateContract } from "./lib/contract.mjs";

function main() {
  const items = loadBacklogItems();
  const { ok, violations } = validateContract(items);

  if (ok) {
    console.log(`backlog:contract — ${items.length} item(s), 0 violations.`);
    process.exit(0);
  }

  console.error(`backlog:contract — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

main();
