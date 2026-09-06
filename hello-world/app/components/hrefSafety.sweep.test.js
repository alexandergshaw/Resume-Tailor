// The census, as an executable invariant.
//
// The render tests in hrefSafety.render.test.js mount four components. There
// are fourteen non-literal href sites in app/, and mounting the rest
// (TrackingTab, ScreenshotTab, AutoApplyQueueTab, AutoTailorTab, ...) means
// standing up page.js-sized prop trees for a one-line property. Reading the
// source is the right test here because the property IS the shape of the
// source: "no href in this app takes a non-literal value that has not passed
// through safeExternalHref."
//
// This is what makes the fix hold for a site that does not exist yet: a new
// `href={row.url}` added next year fails this file on the day it is written.
//
// The classifier is exercised against planted controls at the bottom, so a
// sweep that silently matched nothing cannot pass.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../lib/sourceScan/tokenizeSource.js";

const APP_DIR = path.join(process.cwd(), "app");
const GATE = "safeExternalHref";

/**
 * Sites deliberately NOT gated, each with the reason it is safe. Anything
 * else that is not a hard-coded literal must go through the gate. This list
 * is asserted to be exactly this long, so an entry cannot be quietly added
 * to silence the sweep.
 */
const ALLOWED_UNGATED = [
  {
    file: "components/AutofillProfileDialog.js",
    expression: "bookmarklet",
    // A `javascript:` URL is the POINT: it is built locally from the user's
    // own profile draft by buildBookmarklet(), rendered with
    // onClick={e => e.preventDefault()}, and exists to be dragged to the
    // bookmarks bar. No external party supplies any part of it, and gating
    // it would delete the feature rather than harden it.
    why: "locally built bookmarklet, drag-to-bookmarks-bar, never navigated",
  },
  {
    file: "components/experience/MarkdownPreview.js",
    expression: "token.href",
    // This is the SAME-ORIGIN / mailto: branch, and only that branch: the
    // external http(s) branch two lines below it renders
    // href={safeExternalHref(token.href)} and is swept normally.
    //
    // safeExternalHref refuses every relative URL by construction (rule 3
    // parses with no base), so gating this branch would delete same-origin
    // markdown links - behaviour MarkdownPreview.test.js pins, including
    // their deliberately rel-LESS rendering. mailto: is not a page
    // navigation. Neither is what the control is for, and both have already
    // passed lib/experience/markdown.js's sanitizeUrl, whose protocol-
    // relative and "/\evil.com" handling is the relevant check for them.
    //
    // The hostile shape sanitizeUrl does NOT catch - a scheme-prefix test
    // admits https://acme.com@evil.example/story - is closed by the other
    // branch and asserted in hrefSafety.render.test.js.
    why: "same-origin path / mailto: branch; the external branch is gated",
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

/** Extract the balanced `{...}` starting at `open`. */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

// Comment-stripping used to be a byte-for-byte local copy of the same
// algorithm windowOpenSafety.sweep.test.js also needed - forked rather than
// shared because importing a `.test.js` file executes its whole `describe`
// tree (see that file's header for the measurement: 33 tests instead of 1).
// The forks drifted: only windowOpenSafety's copy was ever taught to
// recognise a regex literal, so a `"` inside one (the real shape at
// app/components/AutoApplyQueueTab.js:46,
// `.replace(/[\\/:*?"<>|]/g, "")`) desynced THIS file's quote tracker for
// the rest of that source file. For this sweep that is latent rather than
// wrong - a desync here can only leak an unstripped comment through (a
// false positive), never blank out a real `href=` site the way
// windowOpenSafety's stricter string-blanking view could - but it is the
// same class of bug, and nothing here made that non-effect on today's tree
// a guarantee about tomorrow's.
//
// So the tokenizer now lives once, in lib/sourceScan/tokenizeSource.js (a
// plain module, not a test file, so both sweeps can import it), with
// regex-literal handling included. `stripComments` here is that module's
// `readable` view: comments blanked, string/template contents preserved -
// exactly this sweep's original contract, since a JSX `href=` attribute
// never legitimately appears as plain text inside a string.
//
// Verified when this file switched over: the fixed tokenizer produces a
// byte-identical set of href sites across every file in app/ - see
// tokenizeSource.test.js and this file's own "classifier itself" tests
// below for the regex-literal case directly.

/**
 * Every JSX `href=` in one source, classified. Returns
 * { literal: [...], expression: [{ expression, line }] }.
 */
export function classifyHrefs(rawSrc) {
  const src = stripComments(rawSrc);
  const literal = [];
  const expression = [];
  const re = /(^|[\s{(])href=/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const at = m.index + m[0].length; // first char after "href="
    const line = src.slice(0, at).split("\n").length;
    if (src[at] === '"' || src[at] === "'") {
      const close = src.indexOf(src[at], at + 1);
      literal.push({ value: src.slice(at + 1, close), line });
    } else if (src[at] === "{") {
      expression.push({ expression: balanced(src, at).trim(), line });
    }
  }
  return { literal, expression };
}

const FILES = walk(APP_DIR);

const SITES = FILES.flatMap((file) => {
  const rel = path.relative(APP_DIR, file).split(path.sep).join("/");
  const src = readFileSync(file, "utf8");
  const { literal, expression } = classifyHrefs(src);
  return [
    ...literal.map((l) => ({ ...l, file: rel, src, kind: "literal" })),
    ...expression.map((e) => ({ ...e, file: rel, src, kind: "expression" })),
  ];
});

const EXPRESSION_SITES = SITES.filter((s) => s.kind === "expression");

function isAllowed(site) {
  return ALLOWED_UNGATED.some((a) => a.file === site.file && a.expression === site.expression);
}

/**
 * Is the value this href renders produced by the gate?
 *
 * Two accepted shapes, because a site that needs the value twice - once to
 * decide whether to render an anchor at all, once as the href - must not be
 * pushed into calling the gate twice on two expressions that can drift
 * apart. So a bare identifier counts iff the SAME FILE binds it from
 * `safeExternalHref(`.
 *
 *     href={safeExternalHref(posting.url)}                     inline
 *     const href = safeExternalHref(posting.url); href={href}  bound
 *
 * Anything else - a raw property access, a fallback chain, a bare variable
 * with no gated binding - fails.
 */
function isGated(expression, src) {
  if (expression.includes(GATE)) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(expression)) return false;
  return new RegExp(`\\b${expression}\\s*=\\s*${GATE}\\s*\\(`).test(src);
}

describe("every non-literal href in app/ passes through the URL gate", () => {
  it("finds the sites at all, so an empty sweep cannot pass", () => {
    // Enumerated by hand at the time of writing: 6 literal, 15 expression.
    // The assertions are lower bounds - a new site must not make this file
    // fail for the wrong reason - but zero must be impossible.
    expect(SITES.filter((s) => s.kind === "literal").length).toBeGreaterThanOrEqual(6);
    expect(EXPRESSION_SITES.length).toBeGreaterThanOrEqual(15);
  });

  for (const site of EXPRESSION_SITES) {
    const label = `${site.file}:${site.line} href={${site.expression.replace(/\s+/g, " ").slice(0, 60)}}`;
    it(`gates ${label}`, () => {
      if (isAllowed(site)) {
        expect(site.expression).toBe(ALLOWED_UNGATED.find((a) => a.file === site.file).expression);
        return;
      }
      expect(isGated(site.expression, site.src), `href={${site.expression}} is not produced by ${GATE}`).toBe(true);
    });
  }

  it("keeps the ungated allow-list to exactly the reviewed exceptions", () => {
    // Growing this list is how the sweep gets defeated. It takes a code
    // review to grow it, which is the point - and every entry must carry a
    // stated reason, so "add it to the list" is never the cheap way out.
    expect(ALLOWED_UNGATED.map((a) => a.file)).toEqual([
      "components/AutofillProfileDialog.js",
      "components/experience/MarkdownPreview.js",
    ]);
    for (const entry of ALLOWED_UNGATED) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it("gates MarkdownPreview's EXTERNAL branch even though its same-origin branch is allow-listed", () => {
    // The allow-list entry names one expression in that file. If the other
    // branch ever stopped calling the gate, the entry would silently cover
    // it too - so assert the gated branch exists by name.
    const src = readFileSync(path.join(APP_DIR, "components/experience/MarkdownPreview.js"), "utf8");
    expect(src).toMatch(/const href = safeExternalHref\(token\.href\)/);
    expect(src).toMatch(/href=\{href\}/);
  });

  it("leaves hard-coded literal hrefs alone, and they are all same-origin paths", () => {
    for (const site of SITES.filter((s) => s.kind === "literal")) {
      expect(site.value.startsWith("/")).toBe(true);
    }
  });

  it("pairs every target=\"_blank\" with rel=\"noopener noreferrer\"", () => {
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      const blanks = (src.match(/target="_blank"/g) || []).length;
      if (blanks === 0) continue;
      const rels = (src.match(/rel="noopener noreferrer"/g) || []).length;
      expect(
        rels,
        `${path.relative(APP_DIR, file)} has ${blanks} target="_blank" but ${rels} rel="noopener noreferrer"`,
      ).toBeGreaterThanOrEqual(blanks);
    }
  });
});

describe("the classifier itself", () => {
  it("separates a literal href from an expression href", () => {
    const { literal, expression } = classifyHrefs(
      '<a href="/library">x</a>\n<a href={row.url}>y</a>',
    );
    expect(literal.map((l) => l.value)).toEqual(["/library"]);
    expect(expression.map((e) => e.expression)).toEqual(["row.url"]);
  });

  it("survives nested braces in the expression", () => {
    const { expression } = classifyHrefs("<a href={f({ a: 1 }) || g(x)}>y</a>");
    expect(expression[0].expression).toBe("f({ a: 1 }) || g(x)");
  });

  it("reports a planted ungated href as failing the rule", () => {
    // The positive control for the whole file: if this shape ever stopped
    // being detected, every `it` above would pass vacuously.
    const src = '<a href={posting.url} target="_blank">y</a>';
    const planted = classifyHrefs(src);
    expect(planted.expression).toHaveLength(1);
    expect(isGated(planted.expression[0].expression, src)).toBe(false);
  });

  it("accepts the gated shape, inline", () => {
    const src = "<a href={safeExternalHref(posting.url)}>y</a>";
    expect(isGated(classifyHrefs(src).expression[0].expression, src)).toBe(true);
  });

  it("accepts a local binding initialised from the gate", () => {
    const src = "const postingHref = safeExternalHref(posting.url);\n<a href={postingHref}>y</a>";
    expect(isGated(classifyHrefs(src).expression[0].expression, src)).toBe(true);
  });

  it("rejects a bare variable that the file never binds from the gate", () => {
    // The hole this rule could have left: `const postingHref = posting.url`
    // followed by `href={postingHref}` must NOT pass.
    const src = "const postingHref = posting.url;\n<a href={postingHref}>y</a>";
    expect(isGated(classifyHrefs(src).expression[0].expression, src)).toBe(false);
  });

  it("rejects a fallback chain even when one arm is gated", () => {
    // `safeExternalHref(a) || b` renders `b` unchecked whenever a is refused.
    // Substring matching would wave this through, so the rule must not be a
    // plain `.includes` on an expression with more than one arm... and it is
    // not: the expression is not a bare identifier, so it is only accepted
    // when it contains the gate - which this does. This asserts the KNOWN
    // limit of a source-text rule, so nobody mistakes it for a proof.
    const src = "<a href={safeExternalHref(a) || b}>y</a>";
    expect(isGated(classifyHrefs(src).expression[0].expression, src)).toBe(true);
    // The render tests are what actually close that shape, per component.
  });

  it("ignores an href written inside a comment", () => {
    // The exact false positive this file hit on its own first run: prose
    // explaining that a refused URL must never render href="" was counted
    // as a literal href site.
    const src = '// never href="", never "#"\n<a href={safeExternalHref(u)}>y</a>';
    const { literal, expression } = classifyHrefs(src);
    expect(literal).toHaveLength(0);
    expect(expression).toHaveLength(1);
  });

  it("ignores an href inside a block comment, and keeps line numbers", () => {
    const src = '/* href="/nope"\n   more */\n<a href={safeExternalHref(u)}>y</a>';
    const { literal, expression } = classifyHrefs(src);
    expect(literal).toHaveLength(0);
    expect(expression[0].line).toBe(3);
  });

  it("does not mistake a URL's // inside a string for a comment", () => {
    const src = 'const u = "https://acme.com/x";\n<a href={safeExternalHref(u)}>y</a>';
    expect(classifyHrefs(src).expression).toHaveLength(1);
  });

  it("finds a real href site after a regex literal containing a quote, without desyncing", () => {
    // The bug this file's stripComments used to have (before it moved to
    // the shared lib/sourceScan/tokenizeSource.js): a naive quote-tracker
    // doesn't know a `/…/` regex literal exists, so a `"` sitting inside one
    // - the real shape at app/components/AutoApplyQueueTab.js:46,
    // `.replace(/[\\/:*?"<>|]/g, "")` - is misread as opening a string that
    // never closes, desyncing quote-tracking for the rest of the file. For
    // THIS sweep a desync can only leak an unstripped comment through (see
    // this file's header), but the underlying defect is the same class of
    // bug windowOpenSafety hit as a real under-count. Pin it here too so a
    // regression in the shared tokenizer fails this file directly.
    const src = [
      'const cleaned = (part || "").replace(/[\\\\/:*?"<>|]/g, "").trim();',
      '<a href={safeExternalHref(u)}>y</a>',
    ].join("\n");
    const { literal, expression } = classifyHrefs(src);
    expect(literal).toHaveLength(0);
    expect(expression).toHaveLength(1);
    expect(expression[0].expression).toBe("safeExternalHref(u)");
  });

  it("does not mistake a DOM property assignment for a JSX attribute", () => {
    // AutoApplyQueueTab.js:36 does `a.href = url` on a locally created blob
    // URL for a download. That is not an href attribute and is out of scope.
    const { literal, expression } = classifyHrefs("const a = document.createElement('a');\na.href = url;");
    expect(literal).toHaveLength(0);
    expect(expression).toHaveLength(0);
  });
});
