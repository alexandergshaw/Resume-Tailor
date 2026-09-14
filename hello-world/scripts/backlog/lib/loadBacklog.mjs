import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseBacklogYaml } from "./yamlLite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // .../hello-world/scripts/backlog/lib
export const REPO_ROOT = join(HERE, "..", "..", "..", ".."); // up from lib -> backlog -> scripts -> hello-world -> repo root
export const HELLO_WORLD_ROOT = join(HERE, "..", "..", ".."); // up from lib -> backlog -> scripts -> hello-world
export const BACKLOG_YML_PATH = join(REPO_ROOT, "docs", "backlog.yml");
export const BACKLOG_MD_PATH = join(REPO_ROOT, "docs", "BACKLOG.md");

/** Reads and parses docs/backlog.yml from its real repo location. */
export function loadBacklogItems(path = BACKLOG_YML_PATH) {
  const text = readFileSync(path, "utf8");
  return parseBacklogYaml(text);
}
