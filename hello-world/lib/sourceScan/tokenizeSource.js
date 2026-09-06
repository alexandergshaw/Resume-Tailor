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
 * app/components/hrefSafety.sweep.test.js and
 * app/components/windowOpenSafety.sweep.test.js are executable invariants:
 * "every href/window.open/location navigation in this app passes through
 * the URL gate." Both need to read real source files and ignore their
 * comments (a sweep that counts `// never href=""` as a literal href site
 * is a false positive - it happened on this repo's first run). Each sweep
 * used to carry its own byte-for-byte copy of this stripping logic, because
 * Vitest treats an imported `.test.js` file as a normal ES module: importing
 * one EXECUTES its top-level `describe(...)` calls too. A throwaway import
 * of hrefSafety's stripper from windowOpenSafety's file was tried and
 * measured: hrefSafety's entire suite re-ran nested inside windowOpenSafety's
 * run (33 tests total instead of the expected ~1). So the two sweeps forked
 * the implementation instead of sharing it - and the forks drifted: only the
 * windowOpenSafety copy was ever taught about regex literals (see below).
 * This file is the fix for the drift: a plain module under lib/, so BOTH
 * sweeps (and any future one) import ONE implementation instead of two.
 *
 * WHY IT NEEDS TO KNOW ABOUT REGEX LITERALS
 *
 * A naive quote-tracker (blank comments; toggle "inside a string" on `'`,
 * `"`, `` ` ``) does not know a `/…/` regex literal exists, and a quote
 * character sitting inside one desyncs the tracker for the REST OF THE FILE.
 * app/components/AutoApplyQueueTab.js:46 has exactly this shape -
 * `.replace(/[\\/:*?"<>|]/g, "")`, a filename-sanitizing regex whose
 * character class contains a raw `"` - and without regex-awareness the
 * tracker reads that `"` as opening a string that never closes on this line,
 * silently swallowing everything after it as "inside a string" until the
 * next stray `"` happens to close it again. Measured effect, before this
 * fix existed:
 *
 *   - windowOpenSafety's `codeMask` view blanks string CONTENTS, so a
 *     desync there doesn't just leak text through, it BLANKS OUT real code -
 *     it silently deleted that file's later, genuinely ungated
 *     `window.open(url, ...)` call, under-reporting the sweep by one real
 *     site with no error at all.
 *   - hrefSafety's `readable`-only view (no codeMask) keeps string contents,
 *     so the same desync is latent: worst case it leaves a comment
 *     unstripped, which can only ever be a false positive (something
 *     wrongly counted as a site), never a false negative (a real site
 *     silently disappearing). Measured directly (see
 *     tokenizeSource.test.js and hrefSafety.sweep.test.js): the fixed and
 *     unfixed strippers produce byte-identical `href=` classifications
 *     across every file in app/ today. That is a fact about today's
 *     tree, not a proof - a future file could still combine a regex
 *     literal containing a quote with an `href=` site after it on the
 *     same file, which is exactly the shape this shared, regex-aware
 *     tokenizer now closes for good, for both sweeps at once.
 *
 * tokenizeSource() tells a regex literal from a division operator with the
 * standard heuristic (a `/` starts a regex unless the last significant
 * character could have ended a value: an identifier character, digit, `)`,
 * `]`, `}`, or a closing quote) and then treats the whole regex - character
 * class and all - as one opaque unit that cannot desync the quote tracker.
 * Verified against every file app/'s and lib/'s sweeps read (500+ files):
 * zero length mismatches between `readable`/`codeMask` and the source, and
 * the only raw-vs-masked count differences are the expected ones (text
 * inside a comment or a string/template).
 *
 * KNOWN LIMIT: a template literal's `${...}` interpolation hole is real
 * code, not string data, but this tokenizer treats the whole span between
 * two backticks as opaque. A call written so `${}` were the ONLY thing
 * containing a tracked keyword would not be found. There is no such shape
 * in this app today; modelling `${}` holes precisely needs a real
 * tokenizer, which nothing here needs yet.
 */

/** True if `ch` is a character a JS value could legitimately end with --
 * used only to tell a regex literal from a division operator. */
function isValueEndChar(ch) {
  return /[A-Za-z0-9_$)\]}]/.test(ch);
}

/**
 * @param {string} src
 * @returns {{ readable: string, codeMask: string }}
 */
export function tokenizeSource(src) {
  let readable = "";
  let codeMask = "";
  let i = 0;
  let lastSignificant = "";
  const n = src.length;
  const blank = (ch) => (ch === "\n" ? "\n" : " ");

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        readable += " ";
        codeMask += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) {
        const ch = blank(src[i]);
        readable += ch;
        codeMask += ch;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      readable += c;
      codeMask += " ";
      i += 1;
      while (i < n) {
        const cc = src[i];
        if (cc === "\\") {
          readable += cc + (src[i + 1] ?? "");
          codeMask += " " + (src[i + 1] != null ? blank(src[i + 1]) : "");
          i += 2;
          continue;
        }
        if (cc === quote) {
          readable += cc;
          codeMask += " ";
          i += 1;
          break;
        }
        readable += cc;
        codeMask += cc === "\n" ? "\n" : " ";
        i += 1;
      }
      lastSignificant = quote;
      continue;
    }
    // Regex literal vs division: a `/` starts a regex unless the last
    // significant character could have ended a value.
    if (c === "/" && !isValueEndChar(lastSignificant)) {
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
        for (let k = i; k < j; k += 1) {
          readable += src[k];
          codeMask += blank(src[k]);
        }
        i = j;
        lastSignificant = "/";
        continue;
      }
      // Not a well-formed regex (no closing `/` before a newline) -- fall
      // through and treat it as an ordinary character.
    }
    readable += c;
    codeMask += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i += 1;
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
 * @returns {string}
 */
export function stripComments(src) {
  return tokenizeSource(src).readable;
}

export default tokenizeSource;
