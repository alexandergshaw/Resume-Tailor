// Pure: does a shell command line invoke `git commit` or `git push`? Used by the PreToolUse
// render-currency gate (N119) to decide whether to run at all, so it is deliberately a small
// tokenizer rather than a substring match: `echo git push`, `git log --grep commit` and `npm run
// commit` must NOT fire it, while `git -C repo commit`, `a && git push` and a heredoc commit message
// must. A wrong answer in either direction is cheap (a missed gate is the pre-hook status quo; a
// spurious one only matters if BACKLOG.md is stale), but both are pinned by gitCommand.test.js.

// Unquoted characters that end a simple command. `&` also covers `&&` and `2>&1` (harmless there).
const SEPARATORS = new Set([";", "&", "|", "(", ")", "`"]);

// A leading word that is not the command itself: shell keywords and wrappers that run what follows.
const PREFIX_WORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{", "time", "command", "exec", "env", "nohup", "sudo"]);

// git global options whose value is the NEXT token (`-C <path>`, `-c <k=v>`); other leading dashes are flags.
const GLOBAL_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--attr-source"]);

const GATED_SUBCOMMANDS = new Set(["commit", "push"]);
const HEREDOC_START = /^<<-?\s*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|([A-Za-z_]\w*))/;

/** Index just past the heredoc terminator line (or the end of the text if it never closes). */
function skipHeredocBody(command, start, delimiter) {
  let pos = start;
  while (pos < command.length) {
    const newline = command.indexOf("\n", pos);
    const end = newline === -1 ? command.length : newline;
    const line = command.slice(pos, end).trim();
    pos = end + 1;
    if (line === delimiter) break;
  }
  return pos;
}

/**
 * Splits a command line into simple commands, each a list of unquoted-and-unescaped word tokens.
 * Quotes group (a quoted run is ONE token, separators and newlines inside it do not split), heredoc
 * bodies are dropped, and everything is lenient: an unterminated quote or heredoc never throws.
 */
export function tokenizeCommand(command) {
  const segments = [];
  let tokens = [];
  let current = "";
  let hasToken = false; // true for an empty quoted token too, so `""` is a token and nothing is not
  let quote = null;
  let heredoc = null; // delimiter waiting for the next newline

  const endToken = () => {
    if (hasToken) tokens.push(current);
    current = "";
    hasToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === "\\" && next !== undefined && '"\\$`'.includes(next)) {
        current += next; // POSIX: inside "..." a backslash only escapes these four
        i += 1;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === "\\" && next !== undefined) {
      if (next === "\n" || (next === "\r" && command[i + 2] === "\n")) {
        // line continuation: the pair vanishes and acts as whitespace
        endToken();
        i += next === "\n" ? 1 : 2;
      } else if (next === " " || next === "\t" || next === '"' || next === "'" || next === "\\") {
        current += next;
        hasToken = true;
        i += 1;
      } else {
        current += ch; // a lone backslash (Windows path) stays literal
        hasToken = true;
      }
      continue;
    }
    if (ch === "<" && next === "<" && command[i + 2] !== "<") {
      const m = HEREDOC_START.exec(command.slice(i));
      if (m) {
        heredoc = m[1] ?? m[2] ?? m[3];
        i += m[0].length - 1;
        endToken();
        continue;
      }
    }
    if (ch === "\n") {
      endSegment();
      if (heredoc !== null) {
        i = skipHeredocBody(command, i + 1, heredoc) - 1;
        heredoc = null;
      }
      continue;
    }
    if (SEPARATORS.has(ch)) {
      endSegment();
      continue;
    }
    if (/\s/.test(ch)) {
      endToken();
      continue;
    }
    current += ch;
    hasToken = true;
  }
  endSegment();
  return segments;
}

const commandName = (token) => token.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, "");

/** The git subcommand of one simple command's tokens, or null if it is not a git invocation. */
function gitSubcommand(tokens) {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || PREFIX_WORDS.has(tokens[i]) || tokens[i].startsWith("-"))) i += 1;
  if (i >= tokens.length || commandName(tokens[i]) !== "git") return null;
  for (let j = i + 1; j < tokens.length; j += 1) {
    const t = tokens[j];
    if (GLOBAL_OPTIONS_WITH_VALUE.has(t)) {
      j += 1;
    } else if (!t.startsWith("-")) {
      return t;
    }
  }
  return null;
}

/** True iff any simple command in `command` is `git [global options] commit|push ...`. */
export function isGitCommitOrPush(command) {
  if (typeof command !== "string" || command === "") return false;
  return tokenizeCommand(command).some((tokens) => GATED_SUBCOMMANDS.has(gitSubcommand(tokens)));
}
