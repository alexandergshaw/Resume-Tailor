import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { tokenizeSource, stripComments, SourceTokenizeError } from "./tokenizeSource.js";

describe("tokenizeSource", () => {
  it("blanks a line comment but keeps the newline", () => {
    const { readable, codeMask } = tokenizeSource("const a = 1; // trailing note\nconst b = 2;");
    expect(readable).not.toContain("trailing note");
    expect(codeMask).not.toContain("trailing note");
    expect(readable.split("\n")).toHaveLength(2);
  });

  it("blanks a block comment, keeping embedded newlines so line numbers survive", () => {
    const src = "const a = 1;\n/* line one\n   line two */\nconst b = 2;";
    const { readable } = tokenizeSource(src);
    expect(readable).not.toContain("line one");
    expect(readable).not.toContain("line two");
    // Same number of lines as the original.
    expect(readable.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("does not treat a comment-like sequence inside a string as a comment", () => {
    const src = 'const u = "https://acme.com/x"; // real comment';
    const { readable, codeMask } = tokenizeSource(src);
    expect(readable).toContain("https://acme.com/x");
    expect(readable).not.toContain("real comment");
    expect(codeMask).not.toContain("https://acme.com/x");
    expect(codeMask).not.toContain("real comment");
  });

  it("preserves string and template contents in `readable` but blanks them in `codeMask`", () => {
    const src = 'const a = "hello world";\nconst b = `template ${1}`;';
    const { readable, codeMask } = tokenizeSource(src);
    expect(readable).toContain("hello world");
    expect(readable).toContain("template ${1}");
    expect(codeMask).not.toContain("hello");
    expect(codeMask).not.toContain("template");
  });

  it("keeps every output the same length as the input, for arbitrary mixed content", () => {
    const src = [
      "// comment with \"quotes\" and /slashes/",
      "/* block with 'quotes' */",
      'const s = "a \\"quoted\\" string with // and /* inside */ it";',
      "const r = /[\\\\/:*?\"<>|]/g;",
      "window.open(url);",
    ].join("\n");
    const { readable, codeMask } = tokenizeSource(src);
    expect(readable.length).toBe(src.length);
    expect(codeMask.length).toBe(src.length);
  });

  describe("regex-literal awareness -- the bug this module was extracted to fix", () => {
    it("does not let a quote inside a regex character class desync tracking for the rest of the file", () => {
      // The exact real shape: app/components/AutoApplyQueueTab.js:46 --
      // `.replace(/[\\/:*?"<>|]/g, "")` -- followed later by a genuine
      // `window.open(url, ...)` call. A naive quote-tracker reads the `"`
      // inside the character class as opening a string, and everything
      // after is misclassified until some LATER stray quote closes it
      // again -- which silently deletes real code from `codeMask` with no
      // error at all.
      const src = [
        'const cleaned = (part || "").replace(/[\\\\/:*?"<>|]/g, "").replace(/\\s+/g, " ").trim();',
        "window.open(url, \"_blank\", \"noopener,noreferrer\");",
      ].join("\n");
      const { codeMask } = tokenizeSource(src);
      // The real call site must survive as literal, matchable text in
      // codeMask -- not blanked out because a prior regex's `"` was
      // mistaken for a string delimiter.
      expect(codeMask).toMatch(/window\.open\(/);
    });

    it("tells a regex literal apart from a division expression", () => {
      const src = "const x = a / b / c;\nconst r = /abc/g;";
      const { readable, codeMask } = tokenizeSource(src);
      // Division: `a`, `/`, `b`, `/`, `c` all survive as ordinary code.
      expect(codeMask).toContain("a / b / c");
      // Regex literal: blanked out of codeMask, but its text (including
      // the `/` delimiters) is preserved in readable.
      expect(readable).toContain("/abc/g");
      expect(codeMask).not.toContain("abc");
    });

    it("treats an escaped slash inside a regex literal as part of the pattern, not a terminator", () => {
      const src = 'const r = /a\\/b/g;\nwindow.open(url);';
      const { codeMask } = tokenizeSource(src);
      expect(codeMask).toMatch(/window\.open\(/);
    });

    it("does not mistake a regex literal for the start of a comment", () => {
      // `/*` immediately inside what looks like it could be a regex should
      // not be swallowed as a block comment when it is genuinely a regex
      // (division-vs-regex heuristic decides `/` starts a regex here).
      const src = "const r = /* not a regex, a real comment */ 1;\nwindow.open(url);";
      const { codeMask } = tokenizeSource(src);
      expect(codeMask).not.toContain("not a regex");
      expect(codeMask).toMatch(/window\.open\(/);
    });

    it("falls back to an ordinary character for an unterminated regex-looking slash", () => {
      // No closing `/` before the newline -- not a well-formed regex, so it
      // must not consume the rest of the file looking for one.
      const src = "const x = 1 / \nconst y = 2;";
      const { readable } = tokenizeSource(src);
      expect(readable).toContain("const y = 2;");
    });
  });

  it("treats an escaped quote inside a string as part of the string, not a terminator", () => {
    const src = 'const s = "a \\"quoted\\" word"; window.open(url);';
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toMatch(/window\.open\(/);
  });
});

// ---------------------------------------------------------------------------
// NESTED TEMPLATE LITERALS -- the shape this module's header used to call
// impossible ("There is no such shape in this app today"). It was wrong: a
// tree-wide census found 55 of them across 44 files, and lib/document/docx.js
// :358 desynced the tokenizer badly enough to blank ~160 lines of real code
// out of `codeMask` -- three real `export`s among them -- with no error.
// ---------------------------------------------------------------------------
describe("template literal `${}` holes are real code, not string data", () => {
  it("keeps a `${}` hole's contents visible in codeMask", () => {
    const { readable, codeMask } = tokenizeSource("const a = `x ${ compute(y) } z`;");
    // The hole is CODE: the call must be findable by a sweep.
    expect(codeMask).toContain("compute(y)");
    // The surrounding template TEXT is still string data.
    expect(codeMask).not.toContain("x ");
    expect(codeMask).not.toContain(" z");
    // `readable` keeps the whole thing, as it always did.
    expect(readable).toContain("x ${ compute(y) } z");
  });

  it("does not let a template nested inside a `${}` hole invert backtick pairing", () => {
    // lib/document/docx.js:358, reduced: an inner template literal living
    // inside the outer template's `${}` hole. A tokenizer that treats the
    // span between two backticks as opaque pairs them 1-2 / 3-4 instead of
    // 1-4 with 2-3 nested, and everything after inverts.
    const src = [
      "const xml = `<p>${runProps ? `<rPr>${runProps}</rPr>` : \"\"}<t>${escape(v)}</t></p>`;",
      "window.open(afterTheNestedTemplate);",
    ].join("\n");
    const { codeMask } = tokenizeSource(src);
    // The line AFTER the nested template must still be code.
    expect(codeMask).toContain("window.open(afterTheNestedTemplate)");
    // Both holes' contents are code too.
    expect(codeMask).toContain("runProps");
    expect(codeMask).toContain("escape(v)");
    // The template TEXT around them is not.
    expect(codeMask).not.toContain("<rPr>");
    expect(codeMask).not.toContain("<p>");
  });

  it("handles three levels of template nesting", () => {
    const src = "const a = `l1 ${ `l2 ${ `l3 ${ deep(x) } l3` } l2` } l1`;\nconst after = 1;";
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("deep(x)");
    expect(codeMask).toContain("const after = 1;");
    expect(codeMask).not.toContain("l1");
    expect(codeMask).not.toContain("l3");
  });

  it("does not treat a `${` inside an ORDINARY string as an interpolation hole", () => {
    // A single/double-quoted string has no holes; `${` there is plain text.
    const src = 'const s = "literally ${not.a.hole()}";\nwindow.open(url);';
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).not.toContain("not.a.hole");
    expect(codeMask).toContain("window.open(url)");
  });

  it("treats an escaped backtick inside a template as text, not a terminator", () => {
    const src = "const s = `a \\` b ${ real(x) } c`;\nwindow.open(url);";
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("real(x)");
    expect(codeMask).toContain("window.open(url)");
    expect(codeMask).not.toContain("a ");
  });

  it("does not end a hole on a `}` that belongs to an object literal inside it", () => {
    const src = "const s = `v ${ fmt({ a: 1, b: { c: 2 } }) } w`;\nwindow.open(url);";
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("fmt({ a: 1, b: { c: 2 } })");
    expect(codeMask).toContain("window.open(url)");
    expect(codeMask).not.toContain("v ");
    expect(codeMask).not.toContain(" w");
  });

  it("does not end a hole on a `}` sitting inside a string inside that hole", () => {
    const src = 'const s = `v ${ pick("}") } w`;\nwindow.open(url);';
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("pick(");
    expect(codeMask).toContain("window.open(url)");
    expect(codeMask).not.toContain(" w");
  });

  it("blanks a regex literal that lives inside a `${}` hole", () => {
    const src = "const s = `v ${ str.replace(/[a-z\"]+/g, \"\") } w`;\nwindow.open(url);";
    const { codeMask } = tokenizeSource(src);
    // The regex is blanked (it is not code keywords)...
    expect(codeMask).not.toContain("a-z");
    // ...but it does not desync anything: the call around it and the next
    // line both survive.
    expect(codeMask).toContain("str.replace(");
    expect(codeMask).toContain("window.open(url)");
  });

  it("blanks a comment that lives inside a `${}` hole", () => {
    const src = "const s = `v ${ /* hidden note */ real(x) } w`;\nwindow.open(url);";
    const { readable, codeMask } = tokenizeSource(src);
    expect(codeMask).not.toContain("hidden note");
    expect(readable).not.toContain("hidden note");
    expect(codeMask).toContain("real(x)");
    expect(codeMask).toContain("window.open(url)");
  });

  it("keeps every output the same length as the input for nested templates", () => {
    const src = "const a = `x ${ `y ${ z({ q: \"}\" }) } y` } x`;\nconst b = 2;";
    const { readable, codeMask } = tokenizeSource(src);
    expect(readable.length).toBe(src.length);
    expect(codeMask.length).toBe(src.length);
  });
});

describe("the real lib/document/docx.js blind spot, and the proof it was one", () => {
  const ROOT = process.cwd();
  const DOCX = path.join(ROOT, "lib/document/docx.js");
  const NESTED_LINE = '<w:rPr>${runProps}</w:rPr>';

  it("still contains the nested-template shape this test is about", () => {
    // If docx.js is ever rewritten without the nesting, this test fails and
    // the two below stop meaning anything -- rewrite them then.
    expect(readFileSync(DOCX, "utf8")).toContain(NESTED_LINE);
  });

  it("sees a window.open( planted AFTER the nested template -- the security proof", () => {
    // THE POINT. windowOpenSafety.sweep.test.js is a security control that
    // reads exactly this `codeMask`. Before the `${}` fix, the nested
    // template at docx.js:358 blanked roughly lines 358-518, so a
    // navigation planted in that span was invisible to the sweep and the
    // sweep reported CLEAN. A safety instrument failing toward false
    // confidence is the worst direction there is.
    const lines = readFileSync(DOCX, "utf8").split("\n");
    const at = lines.findIndex((l) => l.includes(NESTED_LINE));
    expect(at).toBeGreaterThan(-1);
    // Two lines on: past the nested template's statement, inside the span
    // that used to be blanked.
    lines.splice(at + 2, 0, '  window.open(plantedUngatedUrl, "_blank");');
    const { codeMask } = tokenizeSource(lines.join("\n"));
    expect(
      codeMask,
      "a window.open( planted after docx.js's nested template is invisible to the sweep's codeMask",
    ).toContain("window.open(plantedUngatedUrl");
  });

  it("sees the three real exports the desync used to hide", () => {
    // These are the exact three entries exportReachability.sweep.test.js
    // carried on its DESYNCED_STATEMENTS ledger.
    const { codeMask } = tokenizeSource(readFileSync(DOCX, "utf8"));
    for (const name of ["buildMinimalistDocx", "downloadMinimalistDocx", "resolveDocumentBlob"]) {
      expect(codeMask, `export ${name} is still invisible to the scanner`).toContain(
        `export async function ${name}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// LOUD FAILURE. Silence is how the docx.js defect survived: the tokenizer
// returned a confidently blank region and every sweep reading it reported
// clean. Anything this tokenizer cannot read must now throw, so a sweep
// hard-fails instead of passing on a view it never actually parsed.
// ---------------------------------------------------------------------------
describe("refuses to guess: unreadable source throws instead of returning a blank region", () => {
  it("exports a named error type callers can recognise", () => {
    expect(typeof SourceTokenizeError).toBe("function");
  });

  it("throws on an unterminated template literal", () => {
    expect(() => tokenizeSource("const a = `never closed;\nconst b = 2;")).toThrow(SourceTokenizeError);
  });

  it("throws on an unterminated `${` interpolation", () => {
    expect(() => tokenizeSource("const a = `x ${ y ;\n")).toThrow(SourceTokenizeError);
  });

  it("throws on a single/double-quoted string left open at a newline", () => {
    // This is the ORIGINAL desync amplifier, from this module's own header:
    // a stray quote opens a string that silently swallows everything until
    // the next stray quote. A JS string cannot span a raw newline, so this
    // is always a sign the tokenizer lost its place.
    expect(() => tokenizeSource('const a = "never closed;\nconst b = 2;')).toThrow(SourceTokenizeError);
    expect(() => tokenizeSource("const a = 'never closed;\nconst b = 2;")).toThrow(SourceTokenizeError);
  });

  it("throws even when a LATER stray quote would have closed the swallow silently", () => {
    // The discriminating case, and the one that matters. Above, the input
    // also runs out of quotes, so an end-of-input check alone would fire and
    // the newline rule could be deleted without any test noticing (a
    // surviving mutant proved exactly that). Here a later quote DOES close
    // the string, so without the newline rule there is no error at all --
    // just a `window.open(` silently blanked out of codeMask, which is the
    // whole defect class this module exists to prevent.
    const src = [
      'const a = "never closed;',
      "window.open(swallowedByTheDesync);",
      'const b = "a later stray quote";',
    ].join("\n");
    let caught = null;
    try {
      tokenizeSource(src);
    } catch (e) {
      caught = e;
    }
    expect(caught, "a stray quote swallowed a real navigation site without any error").toBeInstanceOf(
      SourceTokenizeError,
    );
    expect(caught.at.line).toBe(1);
  });

  it("throws on an unterminated block comment", () => {
    expect(() => tokenizeSource("const a = 1;\n/* opened and never closed\nconst b = 2;")).toThrow(
      SourceTokenizeError,
    );
  });

  it("throws rather than recursing forever on absurd template nesting", () => {
    const deep = "`${".repeat(64) + "x" + "}`".repeat(64);
    expect(() => tokenizeSource(`const a = ${deep};`)).toThrow(SourceTokenizeError);
  });

  it("names a line and a column so the offending source can be found", () => {
    let caught = null;
    try {
      tokenizeSource("const ok = 1;\nconst a = `never closed;\n");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SourceTokenizeError);
    expect(caught.at.line).toBe(2);
    expect(typeof caught.at.col).toBe("number");
    expect(caught.message).toMatch(/line 2/);
  });

  it("puts the caller's label in the message, so a sweep can say WHICH file", () => {
    let caught = null;
    try {
      tokenizeSource("const a = `never closed;\n", { label: "lib/x/y.js" });
    } catch (e) {
      caught = e;
    }
    expect(caught.message).toContain("lib/x/y.js");
  });

  it("a line continuation does not count as an unterminated string", () => {
    // `"a \<newline>b"` is legal JS -- the backslash escapes the newline.
    const src = 'const a = "one \\\ntwo";\nwindow.open(url);';
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("window.open(url)");
  });
});

// ---------------------------------------------------------------------------
// The regex-vs-division heuristic. The header claimed a closing quote counts
// as "could have ended a value"; isValueEndChar never actually included one,
// so `<Icon size="small" />` read as a regex start and ate real JSX.
// ---------------------------------------------------------------------------
describe("regex-vs-division: the cases the documented heuristic missed", () => {
  it("treats the slash after a quoted JSX attribute as a tag close, not a regex", () => {
    const src = '<Icon fontSize="small" /><Button onClick={() => window.open(url)}>x</Button>';
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("window.open(url)");
    expect(codeMask).toContain("</Button>");
  });

  it("treats `</a></div>` closing tags as markup, not a regex spanning them", () => {
    const src = "<div><a>t</a></div>\nwindow.open(url);";
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("</a></div>");
    expect(codeMask).toContain("window.open(url)");
  });

  it("treats JSX text that starts with a slash as text, not a regex", () => {
    // app/components/FocusPickerDialog.js:567's real shape: `>/library</a>`.
    const src = '<a href="/library">/library</a>\nwindow.open(url);';
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).toContain("</a>");
    expect(codeMask).toContain("window.open(url)");
  });

  it("still recognises a regex literal directly after `return`", () => {
    // `return` ends in an identifier char, so the raw last-character rule
    // called this division and leaked the pattern into codeMask as code.
    const src = 'function f(m) { return /duplicate key|unique constraint/i.test(m); }';
    const { readable, codeMask } = tokenizeSource(src);
    expect(codeMask).not.toContain("duplicate key");
    expect(readable).toContain("duplicate key");
  });

  it("still recognises a regex literal after an arrow that wrapped onto the next line", () => {
    const src = "const f = [...xs].find((el) =>\n  /microphone/i.test(name(el)),\n);";
    const { codeMask } = tokenizeSource(src);
    expect(codeMask).not.toContain("microphone");
  });

  it("still treats a genuine division after a value as division", () => {
    const { codeMask } = tokenizeSource("const x = a / b / c;");
    expect(codeMask).toContain("a / b / c");
  });
});

// ---------------------------------------------------------------------------
// The claim this module's header used to make in prose, made executable. A
// sentence cannot fail; this can.
// ---------------------------------------------------------------------------
describe("the whole tree really is tokenisable -- the header's claim, as a gate", () => {
  const ROOT = process.cwd();

  function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith(".js")) out.push(full);
    }
    return out;
  }

  const FILES = ["app", "lib"].flatMap((d) => walk(path.join(ROOT, d)));

  it("reads a real tree, so an empty sweep cannot pass this", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(500);
  });

  it("tokenises every .js file in app/ and lib/ without refusing", () => {
    const refused = [];
    for (const file of FILES) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      try {
        tokenizeSource(readFileSync(file, "utf8"), { label: rel });
      } catch (e) {
        refused.push(`${rel}: ${e.message.slice(0, 160)}`);
      }
    }
    expect(refused, "tokenizeSource refused a real file -- teach it the shape or fix the file").toEqual([]);
  });

  it("keeps both views byte-aligned with the source for every file", () => {
    const bad = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      const { readable, codeMask } = tokenizeSource(src);
      if (readable.length !== src.length || codeMask.length !== src.length) {
        bad.push(path.relative(ROOT, file));
      }
    }
    expect(bad).toEqual([]);
  });

  it("leaves no file whose nested templates hide its own exports", () => {
    // The generalised form of the docx.js defect: for every PRODUCTION file,
    // every `export`/`import` that starts a line in the raw source must
    // still be visible as code. This is the invariant exportReachability's
    // DESYNCED_STATEMENTS ledger existed to excuse.
    //
    // Scoped to non-test files exactly as that sweep's own
    // rejectedStatements() is: several .test.js files carry PLANTED fixture
    // sources as template literals whose text contains `import`/`export`
    // lines (exportReachability.sweep.test.js:837 and
    // knowledgeSafety.sweep.test.js:283 are the two). Those are string data,
    // and blanking them is the tokenizer being RIGHT, not blind.
    const hidden = [];
    for (const file of FILES.filter((f) => !f.endsWith(".test.js"))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      const src = readFileSync(file, "utf8");
      const { codeMask } = tokenizeSource(src);
      const re = /(^|\n)([^\S\n]*)(import|export)\b/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const at = m.index + m[1].length + m[2].length;
        if (codeMask.slice(at, at + m[3].length) !== m[3]) {
          hidden.push(`${rel}:${src.slice(0, at).split("\n").length} ${m[3]}`);
        }
      }
    }
    expect(hidden, "a real import/export is invisible to the scanner").toEqual([]);
  });
});

describe("stripComments (convenience wrapper used by hrefSafety.sweep.test.js)", () => {
  it("blanks comments while keeping string contents readable", () => {
    const src = '// never href="", never "#"\n<a href={safeExternalHref(u)}>y</a>';
    const out = stripComments(src);
    expect(out).not.toContain("never href");
    expect(out).toContain("href={safeExternalHref(u)}");
  });

  it("does not mistake a URL's // inside a string for a comment", () => {
    const src = 'const u = "https://acme.com/x";\n<a href={safeExternalHref(u)}>y</a>';
    expect(stripComments(src)).toContain("https://acme.com/x");
  });

  it("is exactly tokenizeSource(src).readable", () => {
    const src = 'const a = "x"; // c\nconst r = /y/;';
    expect(stripComments(src)).toBe(tokenizeSource(src).readable);
  });
});
