#!/usr/bin/env node
// backlog:render — regenerates docs/BACKLOG.md from docs/backlog.yml.
// Usage: node scripts/backlog/render.mjs [--stdout]   (default: writes docs/BACKLOG.md)
import { writeFileSync } from "node:fs";
import { loadBacklogItems, BACKLOG_MD_PATH } from "./lib/loadBacklog.mjs";
import { renderMarkdown } from "./lib/renderMarkdown.mjs";

function main() {
  const items = loadBacklogItems();
  const markdown = renderMarkdown(items);

  if (process.argv.includes("--stdout")) {
    process.stdout.write(markdown);
    return;
  }

  writeFileSync(BACKLOG_MD_PATH, markdown, "utf8");
  console.log(`backlog:render — wrote ${BACKLOG_MD_PATH}`);
}

main();
