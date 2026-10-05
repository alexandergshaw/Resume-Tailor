// N120: Stop hook - a NON-BLOCKING never-stop reminder. It can only ever surface a message: the exit
// code is always 0 and the output has no `decision`, `continue` or `stopReason`, so it can never
// refuse a stop or force a continuation. The blocking form was ruled the riskiest change in the retro
// set (it mis-fires on legitimate yields: in-flight background agents, round-2 terminating decisions
// awaiting an owner ruling, user-input pauses), so there is intentionally no code path that blocks.
import { loadBacklogItems } from "../../backlog/lib/loadBacklog.mjs";
import { isBlocked } from "../../backlog/lib/blocked.mjs";

/** Dispatchable work: items in the actionable state that are not blocked (unscoped ones count). */
export function countActionable(items) {
  return items.filter((it) => it.state === "actionable" && !isBlocked(it)).length;
}

/** One line for a positive integer count; "" (say nothing) for zero or anything that is not a count. */
export function buildStopReminder(count) {
  if (!Number.isInteger(count) || count < 1) return "";
  return `Never-stop reminder: docs/backlog.yml has ${count} actionable item(s) remaining - unless you are waiting on in-flight background agents or an owner ruling, the next action should be an Agent dispatch (node hello-world/scripts/backlog/next.mjs picks it).`;
}

export const defaultDeps = { loadItems: () => loadBacklogItems() };

/**
 * -> { exitCode: 0, stdout }. Never throws, never blocks. stdout is a `systemMessage` JSON object
 * (shown to the user as a warning) when there is something to remind about, else "". An unreadable
 * backlog is silence, not an error: a reminder hook must not make a stop noisy or fail.
 */
export function evaluateStop(deps = defaultDeps) {
  try {
    const items = deps.loadItems();
    const reminder = Array.isArray(items) ? buildStopReminder(countActionable(items)) : "";
    return { exitCode: 0, stdout: reminder ? `${JSON.stringify({ systemMessage: reminder })}\n` : "" };
  } catch {
    return { exitCode: 0, stdout: "" };
  }
}
