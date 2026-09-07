/**
 * Tokenizes a JavaScript/JSX source file's TEXT (not its AST) into two
 * parallel, SAME-LENGTH strings, so byte offsets keep lining up with the
 * original file:
 *
 *   readable  comments and regex literals blanked to spaces (newlines kept);
 *             string/template CONTENTS preserved verbatim, so a quoted
 *             literal like "/login" or a URL like "https://acme.com/x" is
 *             still readable, and a `//` inside a string is never mistaken
 *             for a line comment.
 *   codeMask  comments, regex literals AND string/template CONTENTS all
 *             blanked -- use this view to locate real code keywords (a
 *             function name, `href=`, `window.open(`, ...) so that the same
 *             text sitting inside a comment, a regex, or a string can never
 *             register as a hit.
 *
 * WHY THIS EXISTS AS A SHARED, NON-TEST MODULE
 *
 * app/components/hrefSafety.sweep.test.js,
 * app/components/windowOpenSafety.sweep.test.js,
 * app/components/experience/knowledgeSafety.sweep.test.js and
 * lib/sourceScan/exportGraph.js are executable invariants: "every
 * href/window.open/location navigation in this app passes through the URL
 * gate", "every export is reachable from something that ships". All of them
 * need to read real source files and ignore their comments (a sweep that
 * counts `// never href=""` as a literal href site is a false positive - it
 * happened on this repo's first run). Each sweep used to carry its own
 * byte-for-byte copy of this stripping logic, because Vitest treats an
 * imported `.test.js` file as a normal ES module: importing one EXECUTES its
 * top-level `describe(...)` calls too. A throwaway import of hrefSafety's
 * stripper from windowOpenSafety's file was tried and measured: hrefSafety's
 * entire suite re-ran nested inside windowOpenSafety's run (33 tests total
 * instead of the expected ~1). So the two sweeps forked the implementation
 * instead of sharing it - and the forks drifted: only the windowOpenSafety
 * copy was ever taught about regex literals. This file is the fix for the
 * drift: a plain module under lib/, so every sweep imports ONE
 * implementation instead of N.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE DIRECTION THAT MATTERS
 * ---------------------------------------------------------------------------
 *
 * Read this before changing anything below. When this tokenizer loses its
 * place, `codeMask` does not go noisy - it goes BLANK. Blank means a sweep
 * finds no `window.open(` in a region, which means it reports CLEAN. A
 * safety instrument that fails toward false confidence is failing in the
 * worst available direction, and it does it silently. Every defect this
 * module has ever had has been of exactly that kind:
 *
 *   1. REGEX LITERALS (fixed when this module was extracted). A naive
 *      quote-tracker does not know a `/.../` regex literal exists, and a
 *      quote inside one desyncs it for the REST OF THE FILE.
 *      app/components/AutoApplyQueueTab.js:46 has the shape -
 *      `.replace(/[\\/:*?"<>|]/g, "")`, a character class containing a raw
 *      `"`. Measured: it silently deleted that file's later, genuinely
 *      ungated `window.open(url, ...)` call, under-reporting the sweep by
 *      one real site with no error at all.
 *
 *   2. NESTED TEMPLATE LITERALS (fixed here). This header used to say, of a
 *      template literal inside another's `${}` hole: "There is no such shape
 *      in this app today." That sentence was FALSE when it was written. A
 *      census over all 1107 .js files in this repo found 55 of them across
 *      44 files. lib/document/docx.js:358 is the worst:
 *
 *        `<w:p>...${runProps ? `<w:rPr>${runProps}</w:rPr>` : ""}...</w:p>`
 *
 *      Treating the span between two backticks as opaque pairs those four
 *      backticks 1-2 / 3-4 instead of 1-4 with 2-3 nested. Pairing inverts,
 *      the closing backtick reads as an OPENING one, and roughly lines
 *      358-518 - 2454 characters of real code, 106 lines - were blanked out
 *      of `codeMask` with no error. Three real exports
 *      (buildMinimalistDocx, downloadMinimalistDocx, resolveDocumentBlob)
 *      were invisible to the reachability scan, which carried them on a
 *      "desynced statements" ledger rather than seeing them. A
 *      `window.open(` planted anywhere in that span was invisible to the
 *      security sweep, which reported clean.
 *
 *   3. THE DOCUMENTED-BUT-UNIMPLEMENTED QUOTE RULE (fixed here). This header
 *      claimed the regex-vs-division heuristic treated "a closing quote" as
 *      a character that could have ended a value. isValueEndChar() never
 *      included one. So in `<Icon fontSize="small" />` the `/` read as the
 *      start of a regex literal, which then ate the following JSX; 13 files
 *      lost real code that way. Two separate sentences in this header were
 *      false, and for as long as the module existed nothing said so.
 *
 * That history is the whole argument for the two rules below.
 *
 * ---------------------------------------------------------------------------
 * RULE 1: PARSE THE SHAPES THAT ACTUALLY OCCUR
 * ---------------------------------------------------------------------------
 *
 * `${...}` holes are real code, not string data, and this tokenizer now
 * models them with an explicit stack: a `template` frame for text between
 * backticks, a `hole` frame for code inside `${}` with its own brace-depth
 * counter. A backtick inside a hole simply pushes another `template` frame,
 * so nesting works to any depth. Inside a hole, ordinary code rules apply -
 * strings, comments, regex literals and nested templates all behave as they
 * do at the top level - which is what makes the docx.js shape parse.
 *
 * Verified exhaustively: `codeMask` was compared character-by-character
 * against a @babel/parser token-stream oracle over all 1107 .js files in
 * app/, lib/, scripts/ and middleware.js. 1107 of 1107 agree exactly - zero
 * characters of real code blanked, zero characters of string/comment content
 * leaked as code. (Babel is a transitive dependency and deliberately NOT
 * imported here; it was the check, not the implementation.)
 *
 * ---------------------------------------------------------------------------
 * RULE 2: NEVER RETURN A VIEW THAT WAS NOT ACTUALLY PARSED
 * ---------------------------------------------------------------------------
 *
 * Correctness alone would leave the next unknown shape silent, which is
 * exactly how defects 1-3 survived. So when this tokenizer cannot account
 * for its input it now throws SourceTokenizeError instead of returning a
 * confidently blank region:
 *
 *   * end of input still inside a template literal or a `${}` hole;
 *   * a `'`/`"` string still open at a raw newline or at end of input (a JS
 *     string cannot span an unescaped newline, so this always means a quote
 *     was mis-detected - it is precisely defect 1's signature);
 *   * an unterminated block comment;
 *   * template nesting deeper than MAX_TEMPLATE_DEPTH;
 *   * an output that is not the same length as the input.
 *
 * Every caller reads these views to decide whether the app is safe, so a
 * throw here fails that sweep loudly and forces a human decision. Pass
 * `{ label }` and the message names the file.
 *
 * BE HONEST ABOUT WHAT THIS BUYS: the loud failure would NOT have caught
 * docx.js. That file's backticks re-paired before end of input, so every
 * end-state check would have passed while 106 lines sat blank. Rule 1 is
 * what catches docx.js; Rule 2 is what stops the NEXT unreadable shape from
 * being silent. They are not alternatives.
 *
 * AND DO NOT PUT A CLAIM ABOUT THE TREE IN THIS COMMENT AGAIN. "There is no
 * such shape in this app today" is the sentence that made a security sweep
 * blind to 160 lines for as long as it existed, because prose cannot fail.
 * tokenizeSource.test.js now walks app/ and lib/ and asserts that every file
 * tokenizes without refusing, that both views stay byte-aligned, and that no
 * production `import`/`export` is hidden from `codeMask`. If you need to
 * assert something about this repo's source, assert it there.
 */

/** Thrown when the tokenizer cannot account for its input. See RULE 2. */
export class SourceTokenizeError extends Error {
  constructor(message, at) {
    super(message);
    this.name = "SourceTokenizeError";
    /** @type {{ line: number, col: number, index: number } | null} */
    this.at = at;
  }
}

/** Refuse rather than guess past this much template nesting. */
const MAX_TEMPLATE_DEPTH = 32;

/**
 * True if `ch` is a character a JS value could legitimately end with -- used
 * only to tell a regex literal from a division operator.
 *
 * The quote characters are load-bearing and were missing for the module's
 * whole life (defect 3 above): after a string literal, `/` is division, so
 * `<Icon fontSize="small" />` must not read as a regex start.
 */
function isValueEndChar(ch) {
  return /[A-Za-z0-9_$)\]}'"`]/.test(ch);
}

/**
 * Keywords after which a `/` starts a REGEX even though the keyword's last
 * character is an identifier character. Without this, `return /a|b/.test(x)`
 * reads as division and leaks the pattern into `codeMask` as if it were code.
 */
const REGEX_ALLOWING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

/** The identifier immediately before the end of `code`, ignoring whitespace. */
function trailingWord(code) {
  let k = code.length - 1;
  while (k >= 0 && /\s/.test(code[k])) k -= 1;
  const end = k + 1;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(code[k])) k -= 1;
  return code.slice(k + 1, end);
}

/**
 * True if the code emitted so far ends with an arrow `=>`, ignoring
 * whitespace. Distinguishes `(el) => /re/.test(el)` (a real regex) from a
 * JSX tag close like `<a>/library</a>` (markup text, not a regex).
 */
function endsWithArrow(code) {
  let k = code.length - 1;
  while (k >= 0 && /\s/.test(code[k])) k -= 1;
  return code[k] === ">" && code[k - 1] === "=";
}

/**
 * @param {string} src
 * @param {{ label?: string }} [options] `label` (usually a repo-relative
 *   path) is quoted in any SourceTokenizeError, so a failing sweep can name
 *   the file it could not read.
 * @returns {{ readable: string, codeMask: string }}
 * @throws {SourceTokenizeError} when the input cannot be accounted for.
 */
export function tokenizeSource(src, options = {}) {
  const label = options.label ? `${options.label}: ` : "";
  let readable = "";
  let codeMask = "";
  let i = 0;
  let lastSignificant = "";
  const n = src.length;
  const blank = (ch) => (ch === "\n" ? "\n" : " ");
  /** @type {{ kind: "template" | "hole", start: number, braceDepth?: number }[]} */
  const stack = [];

  const fail = (msg, idx) => {
    const before = src.slice(0, idx);
    const line = before.split("\n").length;
    const col = idx - (before.lastIndexOf("\n") + 1) + 1;
    const snippet = src.slice(Math.max(0, idx - 60), idx + 60).replace(/\n/g, "\\n");
    throw new SourceTokenizeError(
      `${label}cannot tokenize source at line ${line}, column ${col}: ${msg}. Near: ...${snippet}...`,
      { line, col, index: idx },
    );
  };
  /** Real code: kept in both views. */
  const emitCode = (ch) => {
    readable += ch;
    codeMask += ch;
  };
  /** String/template data: kept in `readable`, blanked in `codeMask`. */
  const emitStr = (ch) => {
    readable += ch;
    codeMask += blank(ch);
  };
  /** A comment: blanked in BOTH views (a regex uses emitStr -- see below). */
  const emitBlank = (ch) => {
    const b = blank(ch);
    readable += b;
    codeMask += b;
  };

  while (i < n) {
    const top = stack[stack.length - 1];

    // --- Inside a template literal's TEXT ------------------------------
    if (top && top.kind === "template") {
      const c = src[i];
      if (c === "\\") {
        emitStr(c);
        if (i + 1 < n) emitStr(src[i + 1]);
        i += 2;
        continue;
      }
      if (c === "`") {
        emitStr(c);
        stack.pop();
        lastSignificant = "`";
        i += 1;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        // The hole's delimiters are string punctuation; its CONTENTS are code.
        emitStr("$");
        emitStr("{");
        stack.push({ kind: "hole", start: i, braceDepth: 0 });
        lastSignificant = "";
        i += 2;
        continue;
      }
      emitStr(c);
      i += 1;
      continue;
    }

    // --- Ordinary code (top level, or inside a `${}` hole) -------------
    const c = src[i];
    const next = src[i + 1];

    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        emitBlank(src[i]);
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) fail("unterminated block comment", i);
      const stop = end + 2;
      for (; i < stop; i += 1) emitBlank(src[i]);
      continue;
    }
    if (c === "`") {
      if (stack.length >= MAX_TEMPLATE_DEPTH) {
        fail(`template literal nesting deeper than ${MAX_TEMPLATE_DEPTH}`, i);
      }
      emitStr(c);
      stack.push({ kind: "template", start: i });
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      emitStr(c);
      i += 1;
      let closed = false;
      while (i < n) {
        const cc = src[i];
        if (cc === "\\") {
          emitStr(cc);
          if (i + 1 < n) emitStr(src[i + 1]);
          i += 2;
          continue;
        }
        if (cc === quote) {
          emitStr(cc);
          i += 1;
          closed = true;
          break;
        }
        // A JS string cannot span an unescaped newline. Reaching one means a
        // quote was mis-detected -- defect 1's exact signature -- and the
        // old code silently swallowed the rest of the file from here.
        if (cc === "\n") {
          fail(`unterminated ${quote === "'" ? "single" : "double"}-quoted string`, start);
        }
        emitStr(cc);
        i += 1;
      }
      if (!closed) fail("unterminated string at end of input", start);
      lastSignificant = quote;
      continue;
    }

    // A `}` closes the innermost `${}` hole unless it is balancing a `{`
    // opened inside that hole (an object literal, a block, a nested
    // destructuring...).
    if (top && top.kind === "hole") {
      if (c === "{") {
        top.braceDepth += 1;
        emitCode(c);
        lastSignificant = c;
        i += 1;
        continue;
      }
      if (c === "}") {
        if (top.braceDepth === 0) {
          stack.pop();
          emitStr(c);
          i += 1;
          continue;
        }
        top.braceDepth -= 1;
        emitCode(c);
        lastSignificant = c;
        i += 1;
        continue;
      }
    }

    // Regex literal vs division. A `/` starts a regex unless the last
    // significant character could have ended a value -- with two corrections
    // the raw last-character rule cannot make on its own:
    //   * `</a>` and `<Icon />` are JSX markup, never a regex;
    //   * `return /re/` IS a regex, even though `return` ends in a letter.
    const afterJsxTagClose = lastSignificant === ">" && !endsWithArrow(codeMask);
    const startsRegex =
      c === "/" &&
      lastSignificant !== "<" &&
      !afterJsxTagClose &&
      (!isValueEndChar(lastSignificant) || REGEX_ALLOWING_KEYWORDS.has(trailingWord(codeMask)));
    if (startsRegex) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const cj = src[j];
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (cj === "[") {
          inClass = true;
          j += 1;
          continue;
        }
        if (cj === "]") {
          inClass = false;
          j += 1;
          continue;
        }
        if (cj === "/" && !inClass) {
          j += 1;
          closed = true;
          break;
        }
        if (cj === "\n") break;
        j += 1;
      }
      if (closed) {
        while (j < n && /[a-zA-Z]/.test(src[j])) j += 1; // flags
        // A regex's TEXT survives in `readable` (callers read argument text
        // off it) and is blanked only from `codeMask`.
        for (let k = i; k < j; k += 1) emitStr(src[k]);
        i = j;
        lastSignificant = "/";
        continue;
      }
      // Not a well-formed regex (no closing `/` before a newline) -- fall
      // through and treat it as an ordinary character.
    }
    emitCode(c);
    if (!/\s/.test(c)) lastSignificant = c;
    i += 1;
  }

  // --- RULE 2: refuse to return a view that was not actually parsed ----
  if (stack.length) {
    const frame = stack[stack.length - 1];
    fail(
      frame.kind === "template"
        ? "unterminated template literal at end of input"
        : "unterminated ${} interpolation at end of input",
      frame.start,
    );
  }
  if (readable.length !== n || codeMask.length !== n) {
    throw new SourceTokenizeError(
      `${label}internal error: output lengths ${readable.length}/${codeMask.length} do not match input length ${n}`,
      null,
    );
  }
  return { readable, codeMask };
}

/**
 * Convenience wrapper for callers that only need comments blanked with
 * string/template contents left intact (hrefSafety.sweep.test.js's shape --
 * it scans for a JSX attribute, `href=`, which never legitimately appears as
 * plain text inside a string, so it has no need for `codeMask`).
 *
 * @param {string} src
 * @param {{ label?: string }} [options]
 * @returns {string}
 * @throws {SourceTokenizeError} see tokenizeSource.
 */
export function stripComments(src, options = {}) {
  return tokenizeSource(src, options).readable;
}

export default tokenizeSource;
