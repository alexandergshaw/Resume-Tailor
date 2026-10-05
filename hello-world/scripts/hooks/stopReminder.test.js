import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStopReminder, countActionable, evaluateStop } from "./lib/stopReminder.mjs";
import { loadBacklogItems } from "../backlog/lib/loadBacklog.mjs";

// N120: the Stop hook is a NON-BLOCKING reminder. It must never refuse a stop: no exit 2, no
// decision:"block", no continue:false. The reviewer ruled the blocking form the riskiest change in
// the retro set (it mis-fires on legitimate yields), so "can never block" is the headline property and
// is asserted over the whole output space, with a control proving the predicate can actually fail.

const HERE = dirname(fileURLToPath(import.meta.url));
const item = (id, state = "actionable", blocked_by = []) => ({ id, state, blocked_by });

/** True iff (exitCode, stdout) would stop Claude Code from stopping or force it to continue. */
function blocksTheStop({ exitCode, stdout }) {
  if (exitCode === 2) return true; // Stop hook exit 2 refuses the stop
  if (!stdout || !stdout.trim()) return false;
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return false; // plain text on exit 0 is just text
  }
  if (parsed === null || typeof parsed !== "object") return false;
  return parsed.decision === "block" || parsed.continue === false || "stopReason" in parsed;
}

describe("buildStopReminder (count -> one-line text or empty)", () => {
  it("is empty (says nothing) when the backlog has no actionable items", () => {
    expect(buildStopReminder(0)).toBe("");
  });

  it.each([[-1], [NaN], [undefined], [null], ["3"], [1.5], [Infinity]])("is empty for the non-count value %s", (bad) => {
    expect(buildStopReminder(bad)).toBe("");
  });

  it("states the count and the never-stop expectation as exactly one line, with the legitimate-yield exceptions", () => {
    expect(buildStopReminder(3)).toBe(
      "Never-stop reminder: docs/backlog.yml has 3 actionable item(s) remaining - unless you are waiting on in-flight background agents or an owner ruling, the next action should be an Agent dispatch (node hello-world/scripts/backlog/next.mjs picks it)."
    );
  });

  it("is a single line and the count appears verbatim", () => {
    for (const n of [1, 2, 17, 120]) {
      const t = buildStopReminder(n);
      expect(t.includes("\n")).toBe(false);
      expect(t).toContain(`${n} actionable item(s)`);
    }
  });
});

describe("countActionable", () => {
  it("counts only unblocked items in the actionable state", () => {
    const items = [
      item("N1"),
      item("N2", "actionable", ["N1"]), // blocked: not dispatchable, not counted
      item("N3"),
      item("D1", "owner"),
      item("V1", "verification"),
    ];
    expect(countActionable(items)).toBe(2);
  });

  it("is 0 for an empty backlog and for one holding only owner/verification items", () => {
    expect(countActionable([])).toBe(0);
    expect(countActionable([item("D1", "owner"), item("V1", "verification")])).toBe(0);
  });
});

describe("evaluateStop (never blocks)", () => {
  const backlog = (n) => ({ loadItems: () => Array.from({ length: n }, (_, i) => item(`N${i + 1}`)) });

  it("non-empty backlog: exit 0 and a systemMessage reminder carrying the count", () => {
    const r = evaluateStop(backlog(3));
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ systemMessage: buildStopReminder(3) });
  });

  it("empty backlog: exit 0 and says nothing at all", () => {
    expect(evaluateStop(backlog(0))).toEqual({ exitCode: 0, stdout: "" });
  });

  it("a backlog that cannot be read: exit 0 and silent (never an error that could wedge a stop)", () => {
    const r = evaluateStop({ loadItems: () => { throw new Error("ENOENT backlog.yml"); } });
    expect(r).toEqual({ exitCode: 0, stdout: "" });
  });

  it("a loader returning garbage: exit 0 and silent", () => {
    for (const garbage of [undefined, null, "x", 7, {}]) {
      expect(evaluateStop({ loadItems: () => garbage })).toEqual({ exitCode: 0, stdout: "" });
    }
  });

  it("CAN NEVER BLOCK: across empty, small, huge, throwing and garbage backlogs the stop is always allowed", () => {
    const cases = [
      backlog(0),
      backlog(1),
      backlog(500),
      { loadItems: () => { throw new Error("x"); } },
      { loadItems: () => { throw "string thrown"; } },
      { loadItems: () => undefined },
      { loadItems: () => [item("N1", "actionable", ["N0"])] },
    ];
    for (const deps of cases) {
      const r = evaluateStop(deps);
      expect(r.exitCode).toBe(0);
      expect(blocksTheStop(r)).toBe(false);
      if (r.stdout) {
        const keys = Object.keys(JSON.parse(r.stdout));
        expect(keys).toEqual(["systemMessage"]);
      }
    }
  });

  it("control: the blocking-shape predicate is not vacuous - it flags every blocking form", () => {
    expect(blocksTheStop({ exitCode: 2, stdout: "" })).toBe(true);
    expect(blocksTheStop({ exitCode: 0, stdout: JSON.stringify({ decision: "block", reason: "keep going" }) })).toBe(true);
    expect(blocksTheStop({ exitCode: 0, stdout: JSON.stringify({ continue: false, stopReason: "x" }) })).toBe(true);
    expect(blocksTheStop({ exitCode: 0, stdout: JSON.stringify({ systemMessage: "hi" }) })).toBe(false);
    expect(blocksTheStop({ exitCode: 0, stdout: "" })).toBe(false);
  });
});

describe("stopReminder.mjs as a real process", () => {
  const entry = join(HERE, "stopReminder.mjs");
  const run = (stdin) => spawnSync(process.execPath, [entry], { input: stdin, encoding: "utf8", timeout: 20000, windowsHide: true });

  it("exits 0 and emits exactly the reminder this repo's live backlog calls for (or nothing when it is empty)", () => {
    let count = 0;
    try {
      count = countActionable(loadBacklogItems());
    } catch {
      count = 0;
    }
    const r = run(JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false }));
    expect(r.status).toBe(0);
    expect(blocksTheStop({ exitCode: r.status, stdout: r.stdout })).toBe(false);
    if (count > 0) expect(JSON.parse(r.stdout)).toEqual({ systemMessage: buildStopReminder(count) });
    else expect(r.stdout).toBe("");
  });

  it("exits 0 and never blocks on garbage or empty stdin, and when a stop hook is re-entered", () => {
    for (const stdin of ["", "{ nope", "null", JSON.stringify({ stop_hook_active: true })]) {
      const r = run(stdin);
      expect(r.status).toBe(0);
      expect(blocksTheStop({ exitCode: r.status, stdout: r.stdout })).toBe(false);
    }
  });
});
