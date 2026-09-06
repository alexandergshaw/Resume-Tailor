// The census for the OTHER way a string becomes a browser navigation, as an
// executable invariant -- the window.open / location counterpart to
// hrefSafety.sweep.test.js.
//
// WHY THIS EXISTS, and why it nearly didn't catch anything:
//
// lib/window/openPostingBeside.js is the sanctioned control: every url it is
// handed goes through safeExternalHref before it can reach window.open or a
// popup's `location.href`. But that control only helps the sites that call
// it. app/components/StatusBar.js called `window.open(menuJob.url, ...)`
// directly, skipped the helper entirely, and survived a hardening pass that
// closed every other call site -- a human sweep found it. This file is the
// test that finds the next one: a new ungated `window.open(`, bare `.open(`,
// `location.href = `, `location.assign(`, or `location.replace(` added
// anywhere in app/ or lib/ next year fails this file on the day it is
// written.
//
// THE SCANNER, and why it needs one more step than hrefSafety's.
//
// hrefSafety scans for a JSX attribute (`href=`), which in practice never
// appears as plain text inside a string -- so its stripComments() only needs
// to blank comments, and can leave string contents alone (string contents
// are read for the mailto:/token.href allow-list check).
//
// This file scans for JS CALL SYNTAX (`window.open(`, `location.assign(`,
// ...), and that exact text can and does appear as plain characters inside a
// string. app/api/drive/oauth2callback/route.js:64 has a REAL example: its
// callbackHtml() returns a template literal containing a `<script>` block
// whose text is `window.location.replace("/");` -- that is a navigation
// that will run in the BROWSER once the HTML is served, but from the
// perspective of THIS file's own executable JS it is inert string data (and
// the literal is a hard-coded "/" regardless, so there is no url to gate
// either way). A scanner that only strips comments would miscount it as a
// site in route.js's own code.
//
// So tokenize() (below) produces TWO parallel views of the source in one
// pass: `readable` (comments blanked, strings/regexes preserved) and
// `codeMask` (comments, regexes AND string/template contents ALL blanked).
// Only positions that survive `codeMask` count as a site. `readable` is kept
// alongside for reading the actual argument/RHS text once a real site is
// found -- most literal arguments (e.g. "/login") ARE quoted strings, so the
// argument-reading step must not itself be blind to string contents.
//
// KNOWN LIMIT: a template literal's `${...}` interpolation hole is real
// code, not string data, but this scanner treats the whole span between two
// backticks as opaque (see tokenize's string branch). A hypothetical
// `window.open(\`${base}/x\`)` would still be found correctly (the
// `window.open(` text itself sits outside any backtick), but a call written
// so that `${}` were the ONLY thing containing it -- there is no such shape
// in app/ or lib/ today -- would not be. Modelling `${}` holes precisely
// needs a real tokenizer; nothing here needs that yet.
//
// The classifier is exercised against planted fixtures at the bottom, so a
// sweep that silently matched nothing cannot pass -- see "the classifier
// itself" below for the positive, false-negative and false-positive
// controls.
//
// ON stripComments(): hrefSafety.sweep.test.js already exports a
// byte-for-byte version of the comment stripper this file also needs.
// Importing it was tried and rejected: Vitest treats an imported `.test.js`
// module as a normal ES module, which means importing it here EXECUTES its
// top-level `describe(...)` calls too -- verified by a throwaway import that
// made hrefSafety's entire 21-test suite re-run nested inside this file's
// run (33 tests total instead of the expected ~1 for a one-line check).
// That is drift waiting to happen the moment either file's harness changes.
// So the tokenizer below is a deliberate duplicate of hrefSafety's
// comment-stripping algorithm, not a second implementation invented
// independently -- if a third caller ever needs it, that is the point at
// which it belongs in a real (non-test) module both files import, the same
// call this codebase already made for citationHref (see
// lib/url/safeExternalHref.js's header).
//
// ONE MORE BUG, FOUND BY RUNNING THIS AGAINST THE REAL TREE: a naive
// quote-tracker (hrefSafety's stripComments included) does not know about
// regex literals, and a `"` or `'` sitting inside one desyncs it for the
// REST OF THE FILE. app/components/AutoApplyQueueTab.js:46 has exactly this
// -- `.replace(/[\\/:*?"<>|]/g, "")`, a filename-sanitizing regex whose
// character class contains a raw `"` -- and without regex-awareness this
// scanner silently blanked out that file's real, later `window.open(url,
// ...)` call entirely, UNDER-reporting the sweep by one real site with no
// error at all. (hrefSafety's own stripComments has the same latent gap; it
// doesn't produce a wrong result for THAT sweep today because a desynced quote
// state there can only leak an unstripped comment's text through, never
// blank out real code the way this file's stricter codeMask does -- but
// it is the same class of bug.) tokenize() below tells a regex literal from
// division with the standard heuristic (a `/` starts a regex unless the
// last significant character could have ended a value: an identifier
// character, digit, `)`, `]`, `}`, or a closing quote) and then treats the
// whole regex, character class and all, as one opaque unit that cannot
// desync the quote tracker. Verified against every file this sweep reads
// (533 files): zero length mismatches, and the only raw-vs-masked count
// differences left are the expected ones -- text inside a comment or a
// template-literal string, both covered by the false-positive controls
// below.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib"];
const GATE = "safeExternalHref";

// The module IS the control: every url it is handed is checked with
// safeExternalHref before it reaches window.open or a popup's location, so
// its own internal calls are exempt from the generic sweep by construction
// rather than by allow-listing. Pinned separately below so a regression in
// ITS gate still fails something.
const CONTROL_FILE = "lib/window/openPostingBeside.js";

/**
 * Sites deliberately NOT gated because they are a hard-coded literal
 * same-origin app path -- never attacker-influenced, so there is nothing for
 * safeExternalHref to check. Unlike hrefSafety's literal hrefs (which get a
 * blanket "starts with /" pass), a literal window.open/location argument
 * must be named here explicitly: an exact-membership allow-list, asserted
 * by identity, so a new one cannot slip in under a pattern.
 */
const ALLOWED_UNGATED = [
  {
    file: "app/hooks/useDriveDocuments.js",
    expression: '"/api/drive/connect"',
    // The Drive "connect" consent popup. Hard-coded, same-origin, no part of
    // it is derived from positions.url or any other user- or
    // cross-account-writable data.
    why: "hard-coded same-origin popup target for Drive's own OAuth consent flow; no external input reaches it",
  },
  {
    file: "app/components/AccountSection.js",
    expression: '"/login"',
    // Post sign-out redirect. Hard-coded, same-origin.
    why: "hard-coded same-origin sign-out redirect; no external input reaches this literal",
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

/** True if `ch` is a character a JS value could legitimately end with --
 * used only to tell a regex literal from a division operator. */
function isValueEndChar(ch) {
  return /[A-Za-z0-9_$)\]}]/.test(ch);
}

/**
 * Single-pass tokenizer producing two parallel, SAME-LENGTH strings so
 * offsets keep lining up with the original file:
 *
 *   readable  comments and regex literals blanked to spaces (newlines kept);
 *             string/template CONTENTS preserved verbatim, so a literal
 *             argument like "/login" is still readable.
 *   codeMask  comments, regex literals AND string/template contents ALL
 *             blanked -- used only to locate real "site" keyword text, so
 *             text sitting inside a comment, a regex, or a string can never
 *             register as a site (`window.open(` typed in a comment, or
 *             sitting inside a template-literal HTML blob, both blank out).
 *
 * Regex literals get their own branch for two reasons: a bare `/` cannot be
 * told apart from division without one, and a regex character class can
 * contain an unescaped quote character -- see the file header for the real
 * file (AutoApplyQueueTab.js:46) this broke before regex-awareness was
 * added, and why the resulting bug was a silent under-count rather than a
 * crash.
 *
 * Deliberately duplicated from hrefSafety.sweep.test.js's stripComments
 * (see the file header for why importing it instead was rejected), and
 * then extended with regex-literal handling that file does not have.
 */
export function tokenize(src) {
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the balanced `(...)` starting at `openIdx` (src[openIdx] === "("). */
function balancedParen(src, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1);
}

/** Split call-argument text on TOP-LEVEL commas only. */
function splitTopLevelArgs(text) {
  const args = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === "\\") {
        cur += text[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth += 1;
      cur += c;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      cur += c;
      continue;
    }
    if (c === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/** RHS of an assignment starting right after the `=` at `eqIdx`. */
function assignmentRhs(src, eqIdx) {
  let out = "";
  let depth = 0;
  let quote = null;
  for (let i = eqIdx + 1; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth += 1;
      out += c;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      out += c;
      continue;
    }
    if ((c === ";" || c === "\n") && depth === 0) break;
    out += c;
  }
  return out.trim();
}

/**
 * Every window.open/.open(/location.href=/location.assign(/location.replace(
 * site in one already-read source, classified with enough context (its own
 * source line, for the fallback-guard rule below) to gate later.
 */
export function findSites(rawSrc) {
  const { readable, codeMask } = tokenize(rawSrc);
  const lines = rawSrc.split("\n");
  const sites = [];

  function push(idx, kind, expression) {
    const line = rawSrc.slice(0, idx).split("\n").length;
    sites.push({
      line,
      kind,
      expression,
      isLiteral: /^["'`]/.test(expression),
      lineText: lines[line - 1] || "",
    });
  }

  // window.open( / self.open( / top.open( / parent.open( / an aliased
  // reference assigned from `window` earlier in the same file.
  const aliasRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*window\b/g;
  const aliases = [];
  let am;
  while ((am = aliasRe.exec(codeMask)) !== null) aliases.push(am[1]);
  const receivers = ["window", "self", "top", "parent", ...aliases];
  for (const recv of receivers) {
    const re = new RegExp(`\\b${escapeRegExp(recv)}\\.open\\(`, "g");
    let m;
    while ((m = re.exec(codeMask)) !== null) {
      const parenIdx = m.index + m[0].length - 1;
      const [firstArg = ""] = splitTopLevelArgs(balancedParen(readable, parenIdx));
      push(m.index, "open", firstArg);
    }
  }

  // location.assign( and location.replace( -- matches both `window.location.
  // assign(`/`popup.location.assign(` and a bare `location.assign(`.
  for (const method of ["assign", "replace"]) {
    const re = new RegExp(`location\\.${method}\\(`, "g");
    let m;
    while ((m = re.exec(codeMask)) !== null) {
      const parenIdx = m.index + m[0].length - 1;
      const [firstArg = ""] = splitTopLevelArgs(balancedParen(readable, parenIdx));
      push(m.index, method, firstArg);
    }
  }

  // location.href = ... (window.location.href=, popup.location.href=, bare
  // location.href=). The negative lookahead excludes `==`/`===` comparisons.
  {
    const re = /location\.href\s*=(?!=)/g;
    let m;
    while ((m = re.exec(codeMask)) !== null) {
      const eqIdx = m.index + m[0].lastIndexOf("=");
      push(m.index, "href-assign", assignmentRhs(readable, eqIdx));
    }
  }

  return sites;
}

/**
 * Is the url this site passes produced by the gate, directly or through the
 * sanctioned helper?
 *
 * Three accepted shapes:
 *
 *   window.open(safeExternalHref(u))                                inline
 *   const h = safeExternalHref(u); ...; window.open(h)               bound
 *   const opened = openPostingBeside(u);
 *   if (!opened) window.open(u, ...)              fallback-after-helper-call
 *
 * The third shape is the one every real caller of openPostingBeside uses
 * (app/page.js, AutoApplyQueueTab.js, LiveFeedTab.js): `openPostingBeside`
 * itself calls safeExternalHref on the SAME url and returns a TRUTHY
 * sentinel on refusal (see openPostingBeside.js's REFUSED banner), so the
 * `if (!opened)` fallback can only ever run for a url that already passed
 * the gate a moment earlier. Recognising this requires the guard variable
 * (`opened`) and the fallback's own url expression to match a prior
 * `guard = openPostingBeside(url)` / `navigateBeside(popup, url)` call using
 * that EXACT same expression -- not just "some earlier call exists".
 */
export function isGated(site, fileReadable) {
  if (site.expression.includes(GATE)) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(site.expression)) {
    const boundRe = new RegExp(`\\b${escapeRegExp(site.expression)}\\s*=\\s*${GATE}\\s*\\(`);
    if (boundRe.test(fileReadable)) return true;
  }
  if (site.kind === "open") {
    const guardMatch = /if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\s*\)\s*(?:window|self|top|parent|[A-Za-z_$][\w$]*)\.open\(/.exec(
      site.lineText,
    );
    if (guardMatch) {
      const guardVar = guardMatch[1];
      const assignRe = new RegExp(
        `\\b${escapeRegExp(guardVar)}\\s*=\\s*(?:openPostingBeside|navigateBeside)\\(([^;]*)\\)`,
      );
      const assignMatch = assignRe.exec(fileReadable);
      if (assignMatch && assignMatch[1].includes(site.expression)) return true;
    }
  }
  return false;
}

function isAllowed(file, site) {
  return ALLOWED_UNGATED.some((a) => a.file === file && a.expression === site.expression);
}

const FILES = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

const ALL_SITES = FILES.flatMap((file) => {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const raw = readFileSync(file, "utf8");
  const { readable } = tokenize(raw);
  return findSites(raw).map((s) => ({ ...s, file: rel, readable }));
});

// The module IS the control (see CONTROL_FILE above) -- excluded from the
// generic sweep, pinned separately.
const SITES = ALL_SITES.filter((s) => s.file !== CONTROL_FILE);
const CONTROL_SITES = ALL_SITES.filter((s) => s.file === CONTROL_FILE);

describe("every direct window/location navigation in app/ and lib/ passes through the URL gate", () => {
  it("finds the sites at all, so an empty sweep cannot pass", () => {
    // Enumerated by hand at the time of writing: 3 gated (app/page.js,
    // AutoApplyQueueTab.js, LiveFeedTab.js, all the openPostingBeside
    // fallback-after-helper-call shape), 2 allow-listed literal exceptions
    // (useDriveDocuments.js, AccountSection.js), and one open finding
    // (app/login/page.js -- see the dedicated test below). Total: 6, plus
    // the 3 control-module sites excluded above.
    expect(SITES.length).toBeGreaterThanOrEqual(6);
  });

  for (const site of SITES) {
    const label = `${site.file}:${site.line} ${site.kind}(${site.expression.replace(/\s+/g, " ").slice(0, 60)})`;
    it(`gates ${label}`, () => {
      if (isAllowed(site.file, site)) {
        expect(ALLOWED_UNGATED.find((a) => a.file === site.file).expression).toBe(site.expression);
        return;
      }
      expect(
        isGated(site, site.readable),
        `${site.kind}(${site.expression}) in ${site.file}:${site.line} is not produced by ${GATE} ` +
          `(directly, via a same-file binding, or via the openPostingBeside/navigateBeside fallback shape) ` +
          `and is not a reviewed literal exception`,
      ).toBe(true);
    });
  }

  // KNOWN, LIVE FINDING -- see the assertion above for app/login/page.js:42.
  //
  // `const goToApp = () => window.location.assign(redirectTo)`, where
  // `redirectTo = searchParams?.get("redirect") || "/"` -- an EXPRESSION
  // (not a hard-coded literal) that is neither gated nor allow-listed, so
  // its "gates app/login/page.js:42 assign(redirectTo)" test above FAILS.
  //
  // This is a real gap, not a scanner bug: the sibling OAuth path
  // (app/auth/callback/route.js:9) validates the SAME query param --
  // `const next = requested.startsWith("/") ? requested : "/";` -- before
  // ever redirecting, but the direct email/password sign-in path in
  // app/login/page.js's goToApp() has no such check, so
  // `/login?redirect=https://evil.example` sends a signed-in user straight
  // to an attacker's origin after they authenticate.
  //
  // app/login/page.js is outside this task's file scope (read-only), so
  // this is reported rather than fixed or allow-listed -- allow-listing an
  // expression that is not a hard-coded literal would be exactly the kind
  // of quiet exemption this sweep exists to make impossible.

  it("keeps the ungated allow-list to exactly the reviewed exceptions", () => {
    // Growing this list is how the sweep gets defeated: it takes a code
    // review to grow it, and every entry must carry a stated reason.
    expect(ALLOWED_UNGATED.map((a) => `${a.file}:${a.expression}`)).toEqual([
      'app/hooks/useDriveDocuments.js:"/api/drive/connect"',
      'app/components/AccountSection.js:"/login"',
    ]);
    for (const entry of ALLOWED_UNGATED) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it("keeps lib/window/openPostingBeside.js's own navigations behind its safeExternalHref check", () => {
    // The module IS the control (CONTROL_FILE), so its sites are excluded
    // from the generic loop above -- pin its shape directly instead, so a
    // regression here still fails something.
    expect(CONTROL_SITES.length).toBeGreaterThanOrEqual(3);
    const src = readFileSync(path.join(ROOT, CONTROL_FILE), "utf8");
    expect(src).toMatch(/if \(safeExternalHref\(url\) === null\) return refuseUnsafeUrl\(\);/);
    expect(src).toMatch(/if \(safeExternalHref\(url\) === null\) \{/);
    expect(src).toMatch(/popup\.location\.href = url;/);
  });

  it("positive control: a real gated site (AutoApplyQueueTab.js's fallback window.open) reports gated", () => {
    // Named per the brief: point the classifier at a KNOWN-gated real site
    // and confirm it reports gated -- otherwise "zero violations" in the
    // loop above could mean the scanner matched nothing at all, not that
    // everything is actually safe.
    const site = SITES.find((s) => s.file === "app/components/AutoApplyQueueTab.js" && s.kind === "open");
    expect(site).toBeTruthy();
    expect(site.expression).toBe("url");
    expect(isGated(site, site.readable)).toBe(true);
  });
});

describe("the classifier itself", () => {
  it("finds a window.open( site and reads its first argument", () => {
    const [site] = findSites('window.open(job.url, "_blank", "noopener,noreferrer");');
    expect(site.kind).toBe("open");
    expect(site.expression).toBe("job.url");
  });

  it("finds a bare location.assign( site", () => {
    const [site] = findSites("if (x) location.assign(redirectTo);");
    expect(site.kind).toBe("assign");
    expect(site.expression).toBe("redirectTo");
  });

  it("finds a location.replace( site", () => {
    const [site] = findSites('window.location.replace("/");');
    expect(site.kind).toBe("replace");
    expect(site.expression).toBe('"/"');
    expect(site.isLiteral).toBe(true);
  });

  it("finds a location.href = assignment and stops at the statement boundary", () => {
    const [site] = findSites("popup.location.href = url;\nconst x = 1;");
    expect(site.kind).toBe("href-assign");
    expect(site.expression).toBe("url");
  });

  it("does not mistake a comparison for an assignment", () => {
    const sites = findSites('if (window.location.href === "/x") {}');
    expect(sites).toHaveLength(0);
  });

  it("detects self.open( directly, without needing an alias", () => {
    const [site] = findSites("self.open(job.url);");
    expect(site.kind).toBe("open");
    expect(site.expression).toBe("job.url");
  });

  it("detects an aliased window reference (`const w = window; w.open(...)`)", () => {
    // The brief calls this out by name: "an aliased reference" is one of
    // the two example window-ish receivers, alongside self.open.
    const [site] = findSites("const w = window;\nw.open(job.url);");
    expect(site.kind).toBe("open");
    expect(site.expression).toBe("job.url");
  });

  it("positive control (fixture): the inline safeExternalHref shape is gated", () => {
    const src = "window.open(safeExternalHref(u));";
    const [site] = findSites(src);
    expect(isGated(site, src)).toBe(true);
  });

  it("positive control (fixture): the openPostingBeside fallback-after-helper-call shape is gated", () => {
    // The exact shape app/page.js, AutoApplyQueueTab.js and LiveFeedTab.js
    // all use.
    const src =
      'const opened = openPostingBeside(url);\nif (!opened) window.open(url, "_blank", "noopener,noreferrer");';
    const [site] = findSites(src);
    expect(site.kind).toBe("open");
    expect(isGated(site, src)).toBe(true);
  });

  it("accepts a local binding initialised from the gate", () => {
    const src = "const postingHref = safeExternalHref(posting.url);\nwindow.open(postingHref);";
    const [site] = findSites(src);
    expect(isGated(site, src)).toBe(true);
  });

  it("false-negative control: a real ungated shape is detected, not waved through", () => {
    // Built from a fixture string, per the brief -- not by breaking a real
    // source file. This is the exact shape a new call site would have
    // BEFORE anyone wired it through the gate.
    const src = 'window.open(job.url, "_blank");';
    const sites = findSites(src);
    expect(sites).toHaveLength(1);
    expect(isGated(sites[0], src)).toBe(false);
  });

  it("false-negative control: an ungated fallback whose guard var was never assigned from a helper", () => {
    // The hole the fallback-shape rule could have left: an `if (!opened)`
    // guard that looks like the sanctioned shape but whose `opened` never
    // actually came from openPostingBeside/navigateBeside.
    const src = 'const opened = somethingElse(url);\nif (!opened) window.open(url, "_blank");';
    const [site] = findSites(src);
    expect(isGated(site, src)).toBe(false);
  });

  it("false-negative control: a fallback guarding a DIFFERENT url than the one it validated", () => {
    // `openPostingBeside(a)` validates `a`; falling back to `window.open(b)`
    // on the same falsy guard would open a url that was never checked.
    const src = 'const opened = openPostingBeside(a);\nif (!opened) window.open(b, "_blank");';
    const [site] = findSites(src);
    expect(isGated(site, src)).toBe(false);
  });

  it("false-positive control: window.open inside a comment is not counted", () => {
    // The exact false positive hrefSafety hit on its own first run, adapted
    // to this file's target syntax: prose mentioning the dangerous shape
    // must not itself be counted as the shape.
    const src = '// never call window.open(evil) directly\nwindow.open(safeExternalHref(u));';
    const sites = findSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].expression).toContain(GATE);
  });

  it("false-positive control: window.open inside a string literal is not counted", () => {
    const src = 'const msg = "never call window.open(x) directly";\nwindow.open(safeExternalHref(u));';
    const sites = findSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].expression).toContain(GATE);
  });

  it("false-positive control: a template-literal HTML/script blob is not counted (the real route.js shape)", () => {
    // app/api/drive/oauth2callback/route.js:64's actual shape: a multi-line
    // backtick template returned as an HTTP response body, containing a
    // real `window.location.replace("/")` that only ever runs in the
    // browser once served -- not this file's own executable JS.
    const src = [
      "function html() {",
      "  return `<!doctype html><script>",
      '  window.location.replace("/");',
      "  </script>`;",
      "}",
      "window.open(safeExternalHref(u));",
    ].join("\n");
    const sites = findSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].expression).toContain(GATE);
  });

  it("does not mistake a URL's // inside a string for a comment", () => {
    const src = 'const u = "https://acme.com/x";\nwindow.open(safeExternalHref(u));';
    expect(findSites(src)).toHaveLength(1);
  });

  it("survives nested parens/brackets in the argument", () => {
    const src = "window.open(f({ a: 1 }) || g(x));";
    const [site] = findSites(src);
    expect(site.expression).toBe("f({ a: 1 }) || g(x)");
  });
});
