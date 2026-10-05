import { describe, it, expect } from "vitest";
import { isGitCommitOrPush, tokenizeCommand } from "./lib/gitCommand.mjs";

// Truth table for the PreToolUse render-currency gate's "is this a commit/push?" predicate (N119).
// A false NEGATIVE only means the gate does not run (the old behaviour); a false POSITIVE makes the
// gate run on a command it should ignore, which is harmless unless BACKLOG.md is stale. Both
// directions are pinned below, because a predicate that is always true (or always false) would pass
// half of this table by accident.

const HEREDOC_MESSAGE = ["git commit -m \"$(cat <<'EOF'", "feat: a change", "", "git push is not run here", "EOF", ")\""].join("\n");

const SHOULD_FIRE = [
  ["a plain commit", 'git commit -m "msg"'],
  ["a commit reading its message from stdin", "git commit -F -"],
  ["an amend", "git commit --amend --no-edit"],
  ["a bare push", "git push"],
  ["a push with a remote and branch", "git push origin main"],
  ["a force-with-lease push", "git push --force-with-lease origin main"],
  ["git -C <path> commit", "git -C /path/to/repo commit -m x"],
  ["git -C <windows path> push", 'git -C "C:\\Users\\a b\\repo" push'],
  ["git with two -c overrides", "git -c user.name=x -c user.email=y commit -m z"],
  ["git --no-pager push", "git --no-pager push"],
  ["git --git-dir=<path> commit", "git --git-dir=.git commit -m x"],
  ["add && commit", 'git add -A && git commit -m "x"'],
  ["add ; commit", "git add . ; git commit -m x"],
  ["cd && push", "cd hello-world && git push"],
  ["commit then push in one line", 'git commit -m "x" && git push'],
  ["an env-var prefix", "GIT_AUTHOR_NAME=x git commit -m y"],
  ["a piped message", "echo hi | git commit -F -"],
  ["a newline separator", "git add -A\ngit commit -m x"],
  ["a multi-line heredoc message inside double quotes", HEREDOC_MESSAGE],
  ["a heredoc fed to commit -F -", "git commit -F - <<'EOF'\nmessage body\nEOF"],
  ["an absolute POSIX git path", "/usr/bin/git push"],
  ["a quoted Windows git.exe path (PowerShell call operator)", '& "C:\\Program Files\\Git\\cmd\\git.exe" push'],
  ["a subshell", "(git commit -m x)"],
  ["a command substitution", "echo $(git commit -m x)"],
  ["a for-loop body", "for r in a b; do git push $r; done"],
  ["an if-body", "if true; then git commit -m x; fi"],
  ["command git push", "command git push"],
  ["a backslash line continuation", "git commit \\\n  -m x"],
  ["a CRLF newline separator", "git add -A\r\ngit commit -m x"],
  ["an upper-case GIT.EXE", "GIT.EXE push"],
  ["a PowerShell here-string message", "git commit -m @'\nfix: thing\n'@"],
  ["a PowerShell here-string message containing an apostrophe", "git commit -m @'\ndon't break\n'@"],
  ["a push with stderr redirected and piped (PowerShell)", "git push origin main 2>&1 | Select-Object -Last 5"],
  ["a commit chained after a failing-safe add on a new line", "git add -A; if ($?) { git commit -m x }"],
];

const SHOULD_NOT_FIRE = [
  ["git status", "git status"],
  ["git log", "git log --oneline -5"],
  ["git diff", "git diff --stat"],
  ["git add alone", "git add -A"],
  ["git log --grep commit (commit is an argument, not the subcommand)", "git log --grep commit"],
  ["git branch named push", "git branch push"],
  ["git checkout a branch named commit", "git checkout commit"],
  ["git show with push as an argument", "git show HEAD push"],
  ["git stash push (subcommand is stash)", "git stash push"],
  ["git commit-tree (a different subcommand)", "git commit-tree HEAD^{tree}"],
  ["git commit-graph (a different subcommand)", "git commit-graph write"],
  ["git config setting an alias named push", "git config alias.push foo"],
  ["git remote add", "git remote add push https://example.com/x.git"],
  ["npm commit-ish", "npm commit-ish"],
  ["npm run commit", "npm run commit"],
  ["npm run push", "npm run push"],
  ["echo git push (git is an argument to echo)", "echo git push"],
  ["echo of a quoted git commit", 'echo "git commit -m x"'],
  ["printf of git push", "printf 'git push\\n'"],
  ["grep for git commit", 'grep -r "git commit" docs'],
  ["a heredoc BODY that mentions git push", "cat > notes.txt <<'EOF'\ngit push origin main\nEOF"],
  ["a quoted newline followed by git push", 'echo "line one\ngit push"'],
  ["gh pr create", "gh pr create --title x"],
  ["a binary merely ending in git (digit)", "digit commit"],
  ["a binary merely ending in git (legit)", "legit push"],
  ["gitk", "gitk commit"],
  ["the backlog render", "node hello-world/scripts/backlog/render.mjs"],
  ["ls", "ls -la"],
  ["an empty string", ""],
  ["whitespace only", "   \n  "],
  ["a comment mentioning git push", "ls # git push later"],
];

describe("isGitCommitOrPush truth table", () => {
  it.each(SHOULD_FIRE)("fires on %s", (_label, command) => {
    expect(isGitCommitOrPush(command)).toBe(true);
  });

  it.each(SHOULD_NOT_FIRE)("does not fire on %s", (_label, command) => {
    expect(isGitCommitOrPush(command)).toBe(false);
  });

  it("returns false (never throws) for non-string input", () => {
    for (const bad of [undefined, null, 0, 42, {}, [], true]) {
      expect(isGitCommitOrPush(bad)).toBe(false);
    }
  });

  it("control: the table is not vacuous - it contains both outcomes and the predicate separates them", () => {
    expect(SHOULD_FIRE.length).toBeGreaterThan(20);
    expect(SHOULD_NOT_FIRE.length).toBeGreaterThan(20);
    const fired = SHOULD_FIRE.filter(([, c]) => isGitCommitOrPush(c)).length;
    const quiet = SHOULD_NOT_FIRE.filter(([, c]) => !isGitCommitOrPush(c)).length;
    expect(fired).toBe(SHOULD_FIRE.length);
    expect(quiet).toBe(SHOULD_NOT_FIRE.length);
    // The same subcommand word flips the answer with only the command word changed.
    expect(isGitCommitOrPush("git push")).toBe(true);
    expect(isGitCommitOrPush("echo push")).toBe(false);
  });
});

describe("tokenizeCommand", () => {
  it("splits on unquoted separators into per-command token lists", () => {
    expect(tokenizeCommand("git add -A && git commit -m x; ls | wc")).toEqual([
      ["git", "add", "-A"],
      ["git", "commit", "-m", "x"],
      ["ls"],
      ["wc"],
    ]);
  });

  it("keeps a quoted run (spaces, separators and newlines included) as ONE token", () => {
    expect(tokenizeCommand('git commit -m "a && b; c\nd"')).toEqual([["git", "commit", "-m", "a && b; c\nd"]]);
    expect(tokenizeCommand("echo 'x | y'")).toEqual([["echo", "x | y"]]);
  });

  it("keeps an empty quoted argument as an (empty) token", () => {
    expect(tokenizeCommand('git commit -m ""')).toEqual([["git", "commit", "-m", ""]]);
  });

  it("drops a heredoc body but keeps the commands before and after it", () => {
    expect(tokenizeCommand("cat <<'EOF'\ngit push\nEOF\nls")).toEqual([["cat"], ["ls"]]);
  });

  it("does not let an unterminated heredoc throw", () => {
    expect(() => tokenizeCommand("cat <<EOF\nnever closed")).not.toThrow();
  });

  it("does not treat arithmetic shift as a heredoc, so later commands are still seen", () => {
    expect(isGitCommitOrPush("echo $((1<<3))\ngit commit -m x")).toBe(true);
  });
});
