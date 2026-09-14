#!/usr/bin/env node
// backlog:check (part 1) — fails if the committed docs/BACKLOG.md differs from a fresh render of
// docs/backlog.yml (hand-edit detection). Both sides are CRLF-normalized before comparing: this
// repo has core.autocrlf=true, which smudges LF to CRLF on checkout for files no .gitattributes
// rule exempts, and skipping the normalization would make this check fail on every clean clone.
import { readFileSync } from "node:fs";
import { loadBacklogItems, BACKLOG_MD_PATH } from "./lib/loadBacklog.mjs";
import { renderMarkdown } from "./lib/renderMarkdown.mjs";
import { normalizeLineEndings } from "./lib/normalizeLineEndings.mjs";

function main() {
  const items = loadBacklogItems();
  const fresh = normalizeLineEndings(renderMarkdown(items));
  const committed = normalizeLineEndings(readFileSync(BACKLOG_MD_PATH, "utf8"));

  if (fresh === committed) {
    console.log("backlog:check — docs/BACKLOG.md matches a fresh render of docs/backlog.yml.");
    process.exit(0);
  }

  console.error("backlog:check — docs/BACKLOG.md is STALE (does not match a fresh render of docs/backlog.yml).");
  const freshLines = fresh.split("\n");
  const committedLines = committed.split("\n");
  const max = Math.max(freshLines.length, committedLines.length);
  for (let i = 0; i < max; i += 1) {
    if (freshLines[i] !== committedLines[i]) {
      console.error(`  first difference at line ${i + 1}:`);
      console.error(`    committed: ${JSON.stringify(committedLines[i] ?? "<EOF>")}`);
      console.error(`    fresh:     ${JSON.stringify(freshLines[i] ?? "<EOF>")}`);
      break;
    }
  }
  process.exit(1);
}

main();
