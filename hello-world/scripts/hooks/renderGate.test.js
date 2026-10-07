import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideContractGate, decideRenderGate, evaluateRenderGate, firstDifferenceLine } from "./lib/renderGate.mjs";
import { parseBacklogYaml } from "../backlog/lib/yamlLite.mjs";
import { renderMarkdown } from "../backlog/lib/renderMarkdown.mjs";
import { loadBacklogItems, BACKLOG_MD_PATH } from "../backlog/lib/loadBacklog.mjs";
import { validateContract } from "../backlog/lib/contract.mjs";
import { normalizeLineEndings } from "../backlog/lib/normalizeLineEndings.mjs";

// N119: the PreToolUse render-currency gate. It blocks (exit 2) ONLY on a confirmed drift between
// docs/BACKLOG.md and a fresh render of docs/backlog.yml, and only for a git commit/push. Every other
// outcome - a non-git command, a current file, an unreadable input, any internal error - is exit 0.
// A gate that blocked by mistake would brick every commit, so the "allows" side is pinned as hard as
// the "blocks" side, including through a real node process against a planted repo layout.
//
// N136: the same gate also runs validateContract(docs/backlog.yml) and blocks on a confirmed
// violation (an N id set to the valid-but-wrong state "owner", or the unknown state "shipped" that
// red-ed main). The two checks fail open independently, so every N119 row above still holds.

const HERE = dirname(fileURLToPath(import.meta.url));
const FRESH = "# Backlog\n\n| 1 | a |\n";
const STALE = "# Backlog\n\n| 1 | b |\n";
const CLEAN = { ok: true, violations: [] };
const BAD_NAMESPACE =
  'N134: id namespace "N" requires state "actionable" but state is "owner" (N = actionable, D = owner decision, V = verification owed)';
const BAD = { ok: false, violations: [BAD_NAMESPACE] };

const hookInput = (command, extra = {}) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, ...extra });

function depsOf({ rendered = FRESH, onDisk = FRESH, contract = CLEAN } = {}) {
  return {
    renderBacklog: vi.fn(() => rendered),
    readBacklogMd: vi.fn(() => onDisk),
    validateBacklog: vi.fn(() => contract),
  };
}

describe("decideRenderGate (render vs on-disk -> allow | block)", () => {
  it("allows when the on-disk file equals the fresh render", () => {
    expect(decideRenderGate({ renderedText: FRESH, onDiskText: FRESH })).toEqual({ action: "allow" });
  });

  it("blocks when a single character differs, naming the first differing line", () => {
    const d = decideRenderGate({ renderedText: FRESH, onDiskText: STALE });
    expect(d.action).toBe("block");
    expect(d.line).toBe(3);
  });

  it("allows a CRLF on-disk copy of an otherwise identical render (core.autocrlf checkouts)", () => {
    expect(decideRenderGate({ renderedText: FRESH, onDiskText: FRESH.replace(/\n/g, "\r\n") })).toEqual({ action: "allow" });
  });

  it("allows when the RENDER side carries CRLF and the disk side LF", () => {
    expect(decideRenderGate({ renderedText: FRESH.replace(/\n/g, "\r\n"), onDiskText: FRESH })).toEqual({ action: "allow" });
  });

  it("blocks when the on-disk file has extra trailing lines the render lacks", () => {
    expect(decideRenderGate({ renderedText: FRESH, onDiskText: FRESH + "extra\n" }).action).toBe("block");
  });

  it("blocks an empty on-disk file against a non-empty render", () => {
    expect(decideRenderGate({ renderedText: FRESH, onDiskText: "" }).action).toBe("block");
  });

  it("throws (so the caller can fail open) when a side is not a string", () => {
    expect(() => decideRenderGate({ renderedText: undefined, onDiskText: FRESH })).toThrow();
    expect(() => decideRenderGate({ renderedText: FRESH, onDiskText: null })).toThrow();
  });
});

describe("decideContractGate (validateContract result -> allow | block)", () => {
  it("allows a result with no violations", () => {
    expect(decideContractGate(CLEAN)).toEqual({ action: "allow" });
  });

  it("blocks a result that names a violation, carrying the violations through", () => {
    expect(decideContractGate(BAD)).toEqual({ action: "block", violations: [BAD_NAMESPACE] });
  });

  it("decides on the NAMED violations: ok:false with none named is not a confirmed violation", () => {
    expect(decideContractGate({ ok: false, violations: [] })).toEqual({ action: "allow" });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "nope"],
    ["no violations field", { ok: false }],
    ["violations not an array", { ok: false, violations: "N1: bad" }],
    ["a non-string violation", { ok: false, violations: [42] }],
  ])("throws (so the caller can fail open) on a malformed result: %s", (_label, result) => {
    expect(() => decideContractGate(result)).toThrow();
  });
});

describe("firstDifferenceLine", () => {
  it("is 1-based and reports the first differing line", () => {
    expect(firstDifferenceLine("a\nb\nc", "a\nb\nX")).toBe(3);
    expect(firstDifferenceLine("a", "b")).toBe(1);
  });

  it("reports the line past the shorter side when one is a prefix of the other", () => {
    expect(firstDifferenceLine("a\nb", "a\nb\nc")).toBe(3);
  });
});

describe("evaluateRenderGate (hook stdin -> exit code + stderr)", () => {
  it("NON-git command: exits 0 silently and never even renders (cheap on the hot path)", () => {
    const deps = depsOf({ rendered: FRESH, onDisk: STALE }); // stale on purpose: still must allow
    const r = evaluateRenderGate(hookInput("git status"), deps);
    expect(r).toEqual({ exitCode: 0, stderr: "" });
    expect(deps.renderBacklog).not.toHaveBeenCalled();
    expect(deps.readBacklogMd).not.toHaveBeenCalled();
  });

  it("a git commit with a CURRENT BACKLOG.md: exits 0 silently", () => {
    const deps = depsOf();
    const r = evaluateRenderGate(hookInput('git commit -m "x"'), deps);
    expect(r).toEqual({ exitCode: 0, stderr: "" });
    expect(deps.renderBacklog).toHaveBeenCalledTimes(1);
  });

  it("a git push with a CURRENT BACKLOG.md: exits 0 silently", () => {
    expect(evaluateRenderGate(hookInput("git push origin main"), depsOf())).toEqual({ exitCode: 0, stderr: "" });
  });

  it("a git commit with a STALE BACKLOG.md: blocks with exit 2 and a remedy on stderr", () => {
    const r = evaluateRenderGate(hookInput('git commit -m "x"'), depsOf({ onDisk: STALE }));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("docs/BACKLOG.md");
    expect(r.stderr).toContain("STALE");
    expect(r.stderr).toContain("node hello-world/scripts/backlog/render.mjs");
    expect(r.stderr).toMatch(/git add docs\/BACKLOG\.md/);
    expect(r.stderr).toContain("line 3");
  });

  it("a git push with a STALE BACKLOG.md: blocks with exit 2", () => {
    expect(evaluateRenderGate(hookInput("git push"), depsOf({ onDisk: STALE })).exitCode).toBe(2);
  });

  it("tolerates a UTF-8 BOM before the JSON (Windows PowerShell pipes add one): still gates a stale commit, still allows a current one", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(evaluateRenderGate(bom + hookInput("git commit -m x"), depsOf({ onDisk: STALE })).exitCode).toBe(2);
    expect(evaluateRenderGate(bom + hookInput("git commit -m x"), depsOf())).toEqual({ exitCode: 0, stderr: "" });
    expect(evaluateRenderGate(bom + hookInput("git status"), depsOf({ onDisk: STALE }))).toEqual({ exitCode: 0, stderr: "" });
  });

  it("control: the SAME stale state is allowed for a non-git command and blocked for a git command", () => {
    const stale = { onDisk: STALE };
    expect(evaluateRenderGate(hookInput("npm run build"), depsOf(stale)).exitCode).toBe(0);
    expect(evaluateRenderGate(hookInput("git commit -m x"), depsOf(stale)).exitCode).toBe(2);
    // ...and the same git command is allowed once the file is current: only drift blocks.
    expect(evaluateRenderGate(hookInput("git commit -m x"), depsOf()).exitCode).toBe(0);
  });

  it("a PowerShell-tool payload carries the same tool_input.command shape and is gated the same way", () => {
    const ps = hookInput("git commit -m x", { tool_name: "PowerShell" });
    expect(evaluateRenderGate(ps, depsOf({ onDisk: STALE })).exitCode).toBe(2);
    expect(evaluateRenderGate(ps, depsOf()).exitCode).toBe(0);
  });

  describe("N136: the backlog-contract check (a confirmed violation blocks a git commit/push)", () => {
    const commit = hookInput('git commit -m "x"');

    it("a git commit with a CURRENT BACKLOG.md but a contract violation: blocks with exit 2, naming the violation and the remedy", () => {
      const r = evaluateRenderGate(commit, depsOf({ contract: BAD }));
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("backlog-contract gate");
      expect(r.stderr).toContain(BAD_NAMESPACE);
      expect(r.stderr).toContain("npm run backlog:check");
      expect(r.stderr).toContain("node hello-world/scripts/backlog/render.mjs");
      expect(r.stderr).not.toContain("render-currency gate: docs/BACKLOG.md is STALE");
    });

    it("a git push with a contract violation: blocks with exit 2", () => {
      expect(evaluateRenderGate(hookInput("git push origin main"), depsOf({ contract: BAD })).exitCode).toBe(2);
    });

    it("a PowerShell-tool payload is gated the same way", () => {
      const ps = hookInput("git commit -m x", { tool_name: "PowerShell" });
      expect(evaluateRenderGate(ps, depsOf({ contract: BAD })).exitCode).toBe(2);
    });

    it("control: the SAME violation is allowed for a non-git command (and the contract is never evaluated), blocked for git, allowed once clean", () => {
      const bad = depsOf({ contract: BAD });
      expect(evaluateRenderGate(hookInput("npm run build"), bad)).toEqual({ exitCode: 0, stderr: "" });
      expect(bad.validateBacklog).not.toHaveBeenCalled();
      expect(evaluateRenderGate(commit, depsOf({ contract: BAD })).exitCode).toBe(2);
      expect(evaluateRenderGate(commit, depsOf({ contract: CLEAN }))).toEqual({ exitCode: 0, stderr: "" });
    });

    it("a stale BACKLOG.md AND a contract violation: exit 2 with BOTH messages", () => {
      const r = evaluateRenderGate(commit, depsOf({ onDisk: STALE, contract: BAD }));
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("STALE");
      expect(r.stderr).toContain(BAD_NAMESPACE);
    });

    it("lists at most 10 violations and counts the rest", () => {
      const many = Array.from({ length: 13 }, (_, i) => `N${i}: bad ${i}`);
      const r = evaluateRenderGate(commit, depsOf({ contract: { ok: false, violations: many } }));
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("13 violation(s)");
      expect(r.stderr).toContain("N9: bad 9");
      expect(r.stderr).not.toContain("N10: bad 10");
      expect(r.stderr).toContain("...and 3 more");
    });

    it("fails OPEN when the contract check throws: exit 0 with a warning (and a current BACKLOG.md)", () => {
      const deps = { ...depsOf(), validateBacklog: () => { throw new Error("ENOENT: backlog.yml"); } };
      const r = evaluateRenderGate(commit, deps);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("ENOENT");
      expect(r.stderr).toMatch(/allowing/i);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["no violations field", { ok: false }],
      ["a non-array violations", { ok: false, violations: "N1: bad" }],
    ])("fails OPEN when the contract check returns a malformed result: %s", (_label, malformed) => {
      const r = evaluateRenderGate(commit, { ...depsOf(), validateBacklog: () => malformed });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toMatch(/allowing/i);
    });

    it("a thrown non-Error value from the contract check still fails open", () => {
      const r = evaluateRenderGate(commit, { ...depsOf(), validateBacklog: () => { throw "boom"; } });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("boom");
    });

    it("independence: a THROWING contract check never suppresses a confirmed render drift (exit 2 plus a warning)", () => {
      const deps = { ...depsOf({ onDisk: STALE }), validateBacklog: () => { throw new Error("contract blew up"); } };
      const r = evaluateRenderGate(commit, deps);
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("STALE");
      expect(r.stderr).toContain("contract blew up");
    });

    it("independence: a THROWING render check never suppresses a confirmed contract violation (exit 2 plus a warning)", () => {
      const deps = { ...depsOf({ contract: BAD }), renderBacklog: () => { throw new Error("render blew up"); } };
      const r = evaluateRenderGate(commit, deps);
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain(BAD_NAMESPACE);
      expect(r.stderr).toContain("render blew up");
    });
  });

  describe("fails OPEN on any internal error (warns on stderr, exits 0)", () => {
    const git = hookInput("git commit -m x");
    const contractOk = () => CLEAN;

    it("render throws (e.g. backlog.yml missing or unparseable)", () => {
      const deps = { renderBacklog: () => { throw new Error("ENOENT: no such file backlog.yml"); }, readBacklogMd: () => FRESH, validateBacklog: contractOk };
      const r = evaluateRenderGate(git, deps);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("ENOENT");
      expect(r.stderr).toMatch(/allowing/i);
    });

    it("reading BACKLOG.md throws", () => {
      const deps = { renderBacklog: () => FRESH, readBacklogMd: () => { throw new Error("EACCES"); }, validateBacklog: contractOk };
      const r = evaluateRenderGate(git, deps);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("EACCES");
    });

    it("render returns a non-string", () => {
      const r = evaluateRenderGate(git, { renderBacklog: () => undefined, readBacklogMd: () => FRESH, validateBacklog: contractOk });
      expect(r.exitCode).toBe(0);
      expect(r.stderr.length).toBeGreaterThan(0);
    });

    it("a thrown non-Error value", () => {
      const r = evaluateRenderGate(git, { renderBacklog: () => { throw "boom"; }, readBacklogMd: () => FRESH, validateBacklog: contractOk });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("boom");
    });

    it.each([
      ["empty stdin", ""],
      ["whitespace stdin", "  \n"],
      ["non-JSON stdin", "not json at all"],
      ["JSON null", "null"],
      ["JSON array", "[]"],
      ["JSON without tool_input", JSON.stringify({ tool_name: "Bash" })],
      ["tool_input without command", JSON.stringify({ tool_input: {} })],
      ["a non-string command", JSON.stringify({ tool_input: { command: 7 } })],
    ])("unusable hook input (%s) never blocks and never touches the repo", (_label, stdin) => {
      const deps = depsOf({ onDisk: STALE });
      const r = evaluateRenderGate(stdin, deps);
      expect(r.exitCode).toBe(0);
      expect(deps.renderBacklog).not.toHaveBeenCalled();
    });

    it("never returns any exit code other than 0 or 2 for any input shape", () => {
      const inputs = [undefined, null, "", "{", hookInput("git commit"), hookInput("ls"), "[]", "123"];
      for (const stdin of inputs) {
        for (const deps of [
          depsOf(),
          depsOf({ onDisk: STALE }),
          depsOf({ contract: BAD }),
          { renderBacklog: () => { throw new Error("x"); }, readBacklogMd: () => "", validateBacklog: contractOk },
          { renderBacklog: () => { throw new Error("x"); }, readBacklogMd: () => "", validateBacklog: () => { throw new Error("y"); } },
        ]) {
          expect([0, 2]).toContain(evaluateRenderGate(stdin, deps).exitCode);
        }
      }
    });
  });
});

// ---- Real-process rows: a planted repo layout, the real entry script, real stdin/exit code. ----------
// The entry resolves docs/ relative to its own location (hello-world/scripts/hooks -> repo root), so
// copying the hooks + backlog lib into a temp tree with the same relative layout exercises the REAL
// wiring (relative import depth, default deps, process exit code) without touching this repo's docs.

const FIXTURE_YML = [
  "# fixture backlog",
  '- id: "N1"',
  '  state: "actionable"',
  '  title: "Fixture item"',
  '  owed_by: "someone"',
  '  evidence: ["e1"]',
  "  blocked_reason: null",
  "  instrument: null",
  "  owns: null",
  "  verify: null",
  "  verify_proof: null",
  "  blocked_by: []",
  "",
].join("\n");
const FIXTURE_MD = renderMarkdown(parseBacklogYaml(FIXTURE_YML));
const FIXTURE_MD_STALE = FIXTURE_MD.replace("Fixture item", "Fixture item (edited)");

function copyMjs(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir)) {
    if (name.endsWith(".mjs")) copyFileSync(join(fromDir, name), join(toDir, name));
  }
}

describe("renderGate.mjs as a real process (planted repo layout)", () => {
  let root;
  let entry;
  const docs = () => join(root, "docs");

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rt-hook-gate-"));
    copyMjs(HERE, join(root, "hello-world", "scripts", "hooks"));
    copyMjs(join(HERE, "lib"), join(root, "hello-world", "scripts", "hooks", "lib"));
    copyMjs(join(HERE, "..", "backlog", "lib"), join(root, "hello-world", "scripts", "backlog", "lib"));
    mkdirSync(docs(), { recursive: true });
    entry = join(root, "hello-world", "scripts", "hooks", "renderGate.mjs");
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const plant = ({ yml = FIXTURE_YML, md = FIXTURE_MD } = {}) => {
    for (const f of ["backlog.yml", "BACKLOG.md"]) rmSync(join(docs(), f), { force: true });
    if (yml !== null) writeFileSync(join(docs(), "backlog.yml"), yml, "utf8");
    if (md !== null) writeFileSync(join(docs(), "BACKLOG.md"), md, "utf8");
  };
  const run = (command, stdinOverride) => {
    const r = spawnSync(process.execPath, [entry], {
      input: stdinOverride ?? hookInput(command),
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  it("the copied entry exists (planted layout is real)", () => {
    expect(existsSync(entry)).toBe(true);
  });

  it("NON-git Bash command with a STALE BACKLOG.md: exit 0, silent", () => {
    plant({ md: FIXTURE_MD_STALE });
    expect(run("git status")).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(run("npm run build")).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("git commit with a CURRENT BACKLOG.md: exit 0, silent", () => {
    plant();
    expect(run('git commit -m "x"')).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(run("git push")).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("git commit with a CURRENT but CRLF BACKLOG.md (autocrlf checkout): exit 0", () => {
    plant({ md: FIXTURE_MD.replace(/\n/g, "\r\n") });
    expect(run("git commit -m x").status).toBe(0);
  });

  it("git commit with a CRLF backlog.yml (the N114 shape) and a current BACKLOG.md: exit 0", () => {
    plant({ yml: FIXTURE_YML.replace(/\n/g, "\r\n") });
    expect(run("git commit -m x").status).toBe(0);
  });

  it("git commit with a STALE BACKLOG.md: exit 2 and the remedy on stderr", () => {
    plant({ md: FIXTURE_MD_STALE });
    const r = run('git commit -m "x"');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("node hello-world/scripts/backlog/render.mjs");
    expect(r.stderr).toContain("STALE");
  });

  it("git push with a STALE BACKLOG.md: exit 2", () => {
    plant({ md: FIXTURE_MD_STALE });
    expect(run("git push origin main").status).toBe(2);
  });

  // N136: the contract check, through the real entry script and a real planted backlog.yml. BACKLOG.md
  // is rendered FROM each bad yml, so the render check sees a current file and ONLY the contract can block.
  const N_ID_WRONG_STATE_YML = FIXTURE_YML.replace('state: "actionable"', 'state: "owner"').replace(
    "blocked_reason: null",
    'blocked_reason: "waiting on the owner"',
  );
  const SHIPPED_YML = FIXTURE_YML.replace('state: "actionable"', 'state: "shipped"');
  const plantCurrent = (yml) => plant({ yml, md: renderMarkdown(parseBacklogYaml(yml)) });

  it("git commit with a CURRENT BACKLOG.md but an N id set to the valid state \"owner\": exit 2, violation and remedy on stderr", () => {
    plantCurrent(N_ID_WRONG_STATE_YML);
    const r = run('git commit -m "x"');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("backlog-contract gate");
    expect(r.stderr).toContain('N1: id namespace "N" requires state "actionable" but state is "owner"');
    expect(r.stderr).toContain("npm run backlog:check");
    expect(r.stderr).not.toContain("STALE");
  });

  it("git push with the same N-id/owner file: exit 2", () => {
    plantCurrent(N_ID_WRONG_STATE_YML);
    expect(run("git push origin main").status).toBe(2);
  });

  it("the defect that red-ed main, literally: state \"shipped\" is invisible to the render (BACKLOG.md is current) yet the gate blocks it", () => {
    plantCurrent(SHIPPED_YML);
    // The blind spot being closed: renderMarkdown silently drops an unknown-state item, so the
    // on-disk BACKLOG.md equals a fresh render and the N119 render check alone would allow this.
    expect(readFileSync(join(docs(), "BACKLOG.md"), "utf8")).not.toContain("Fixture item");
    const r = run("git commit -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown state "shipped"');
  });

  it("control: the SAME bad file is allowed for a non-git command; the clean fixture is allowed for git", () => {
    plantCurrent(N_ID_WRONG_STATE_YML);
    expect(run("git status")).toEqual({ status: 0, stdout: "", stderr: "" });
    plantCurrent(FIXTURE_YML);
    expect(run("git commit -m x")).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("a contract violation AND a stale BACKLOG.md together: exit 2 naming both", () => {
    plant({ yml: N_ID_WRONG_STATE_YML, md: FIXTURE_MD_STALE });
    const r = run("git commit -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("STALE");
    expect(r.stderr).toContain("backlog-contract gate");
  });

  // `verify: []` parses (an empty flow array) but is not a string, so validateContract itself throws
  // (TypeError inside the verify-path check): a REAL internal error in the contract check.
  const CONTRACT_THROWS_YML = FIXTURE_YML.replace("verify: null", "verify: []");

  it("fails OPEN when validateContract itself throws on a parseable file: exit 0 with a contract warning", () => {
    plantCurrent(CONTRACT_THROWS_YML);
    const r = run("git commit -m x");
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("backlog-contract gate: could not validate docs/backlog.yml");
    expect(r.stderr).toMatch(/allowing/i);
  });

  it("...and that contract-check failure never hides a stale BACKLOG.md: exit 2", () => {
    plant({ yml: CONTRACT_THROWS_YML, md: FIXTURE_MD_STALE });
    expect(run("git commit -m x").status).toBe(2);
  });

  it("fails OPEN when backlog.yml is missing: exit 0 with a warning", () => {
    plant({ yml: null });
    const r = run("git commit -m x");
    expect(r.status).toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it("fails OPEN when backlog.yml is unparseable: exit 0 with a warning", () => {
    plant({ yml: "this is not the grammar\n" });
    const r = run("git commit -m x");
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/allowing/i);
  });

  it("fails OPEN when BACKLOG.md is missing: exit 0 with a warning", () => {
    plant({ md: null });
    const r = run("git commit -m x");
    expect(r.status).toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it("fails OPEN on garbage stdin: exit 0", () => {
    plant({ md: FIXTURE_MD_STALE });
    expect(run("", "{ not json").status).toBe(0);
    expect(run("", "").status).toBe(0);
  });
});

describe("renderGate.mjs against THIS repo's real files (wiring of the default deps)", () => {
  const entry = join(HERE, "renderGate.mjs");
  const run = (command) => spawnSync(process.execPath, [entry], { input: hookInput(command), encoding: "utf8", timeout: 20000, windowsHide: true });

  it("a non-git command is allowed silently whatever state BACKLOG.md is in", () => {
    const r = run("git status");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("a git commit gets exit 0 exactly when the live BACKLOG.md equals a fresh render AND the live backlog.yml has 0 contract violations, else exit 2 (never a crash)", () => {
    let drifted = false;
    try {
      const fresh = normalizeLineEndings(renderMarkdown(loadBacklogItems()));
      const onDisk = normalizeLineEndings(readFileSync(BACKLOG_MD_PATH, "utf8"));
      drifted = fresh !== onDisk;
    } catch {
      drifted = false; // the gate fails open when it cannot read or parse
    }
    let violated = false;
    try {
      violated = validateContract(loadBacklogItems()).violations.length > 0;
    } catch {
      violated = false;
    }
    expect(run("git commit -m x").status).toBe(drifted || violated ? 2 : 0);
  });
});
