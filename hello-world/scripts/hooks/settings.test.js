import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Wiring of N119 + N120 in .claude/settings.json: a hook that is written, tested and never registered
// (or registered against a path that does not exist, or under the wrong event) protects nothing.

const HERE = dirname(fileURLToPath(import.meta.url)); // .../hello-world/scripts/hooks
const REPO_ROOT = join(HERE, "..", "..", "..");
const SETTINGS_PATH = join(REPO_ROOT, ".claude", "settings.json");
const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));

const commandsFor = (event) => (settings.hooks?.[event] ?? []).flatMap((group) => (group.hooks ?? []).map((h) => ({ matcher: group.matcher, command: h.command, type: h.type })));
// "${CLAUDE_PROJECT_DIR}/hello-world/scripts/hooks/x.mjs" -> repo-relative path
const scriptOf = (command) => /\$\{CLAUDE_PROJECT_DIR\}\/(hello-world\/scripts\/hooks\/[A-Za-z]+\.mjs)/.exec(command)?.[1] ?? null;

describe(".claude/settings.json hook wiring", () => {
  it("is valid JSON and keeps the SessionStart hook", () => {
    expect(commandsFor("SessionStart").some((h) => h.command.includes("backlog/next.mjs") && h.command.includes("--session-start"))).toBe(true);
  });

  it("registers the render-currency gate on PreToolUse, matched to the shell tools only", () => {
    const entries = commandsFor("PreToolUse").filter((h) => scriptOf(h.command) === "hello-world/scripts/hooks/renderGate.mjs");
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("command");
    const matchers = entries[0].matcher.split("|").map((m) => m.trim());
    expect(matchers).toContain("Bash");
    // an exact tool-name list: nothing like ".*" or "" that would fire the gate on every tool call
    expect(matchers.every((m) => /^[A-Za-z]+$/.test(m))).toBe(true);
    expect(matchers.sort()).toEqual(["Bash", "PowerShell"]);
  });

  it("registers the never-stop reminder on Stop", () => {
    const entries = commandsFor("Stop").filter((h) => scriptOf(h.command) === "hello-world/scripts/hooks/stopReminder.mjs");
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("command");
  });

  it("does NOT register the render gate on Stop or the reminder on PreToolUse (no event mix-up)", () => {
    expect(commandsFor("Stop").some((h) => (h.command ?? "").includes("renderGate"))).toBe(false);
    expect(commandsFor("PreToolUse").some((h) => (h.command ?? "").includes("stopReminder"))).toBe(false);
  });

  it("invokes each script with node and ${CLAUDE_PROJECT_DIR}, like the SessionStart entry, and every script exists", () => {
    for (const event of ["PreToolUse", "Stop"]) {
      expect(commandsFor(event).length).toBeGreaterThan(0); // not vacuous: the event must have an entry to check
      for (const h of commandsFor(event)) {
        expect(h.command).toMatch(/^node "\$\{CLAUDE_PROJECT_DIR\}\/hello-world\/scripts\/hooks\/[A-Za-z]+\.mjs"$/);
        const rel = scriptOf(h.command);
        expect(rel).not.toBeNull();
        expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
      }
    }
  });
});
