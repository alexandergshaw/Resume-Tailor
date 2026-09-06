import { describe, it, expect } from "vitest";
import { tokenizeSource, stripComments } from "./tokenizeSource.js";

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
