import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./markdown.js";

// The markdown parser for project pages. Hand-rolled and pure: it produces a
// block token tree that MarkdownPreview turns into React elements. Nothing here
// ever becomes HTML.
//
// Revision 2, after an audit ran 36 mutants and two full alternate
// implementations against the first draft. Sixteen mutants survived and both
// alternates passed while carrying live XSS. Four things changed:
//
//  1. URLs are now checked STRUCTURALLY, by walking the tree for any href-like
//     property, not by looking for the substring "link" in JSON. A parser
//     emitting {type:"unsafe-link", href:"javascript:..."} passed the draft,
//     because JSON.stringify of that token does not contain the characters
//     `"link"` - the preceding character is a hyphen.
//  2. Every dangerous scheme is tried in EVERY block context. All six of the
//     draft's safety fixtures were `[x](scheme)` alone on a line, so a
//     parse-then-sanitize implementation that only visited paragraph blocks
//     passed with live javascript: links in headings, list items, task items
//     and blockquotes.
//  3. An ALLOWLIST, not a denylist. The audit produced live links for file:,
//     blob:, about:, view-source:, intent:, filesystem: and protocol-relative
//     //evil.com, none of which a denylist written to the draft's fixtures
//     would have blocked.
//  4. Losing the user's text is now a failure. A mutant that deleted any
//     paragraph containing a bracket or a pipe passed, because the malformed
//     -input test asserted only "did not throw" and "is an array" - and `[]`
//     satisfies both. This is a knowledge base; a body that silently eats a
//     sentence is worse than one that renders it plainly.

const text = (value) => ({ type: "text", value });

const TAB = String.fromCodePoint(0x09);
const LF = String.fromCodePoint(0x0a);
const CR = String.fromCodePoint(0x0d);
const C0 = String.fromCodePoint(0x01); // browsers strip leading C0 before the scheme
const ZWSP = String.fromCodePoint(0x200b);

// Every string that could become a navigable target, anywhere in the tree,
// whatever the token is called. Rename-proof by construction.
function allUrls(tokens) {
  const found = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string" && /^(href|src|url|link|target)$/i.test(key)) found.push(v);
      else visit(v);
    }
  };
  visit(tokens);
  return found;
}

// Everything the reader would actually see, so "the parser silently dropped
// what I typed" is a detectable failure rather than an empty array.
function plainText(tokens) {
  let out = "";
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.value === "string") out += value.value;
    if (typeof value.text === "string") out += value.text;
    for (const v of Object.values(value)) if (typeof v === "object") visit(v);
  };
  visit(tokens);
  return out;
}

describe("blocks", () => {
  it("parses ATX headings up to level three", () => {
    expect(parseMarkdown("# One\n\n## Two\n\n### Three")).toEqual([
      { type: "heading", level: 1, children: [text("One")] },
      { type: "heading", level: 2, children: [text("Two")] },
      { type: "heading", level: 3, children: [text("Three")] },
    ]);
  });

  it("treats a fourth-level hash as ordinary text rather than inventing an h4", () => {
    expect(parseMarkdown("#### Four")).toEqual([
      { type: "paragraph", children: [text("#### Four")] },
    ]);
  });

  it("separates paragraphs on a blank line and keeps a single newline as a break", () => {
    expect(parseMarkdown("first\nsecond\n\nthird")).toEqual([
      { type: "paragraph", children: [text("first\nsecond")] },
      { type: "paragraph", children: [text("third")] },
    ]);
  });

  it("handles Windows line endings identically to Unix ones", () => {
    // In JS, "." does not match "\r", so a heading or fence regex anchored with
    // (.*)$ silently fails on every CRLF line. The audit's own reference had
    // this defect and the draft could not see it: a fenced block pasted from
    // Word lost its entire contents while the suite stayed green. Every fixture
    // in the draft used "\n".
    expect(parseMarkdown("# One\r\n\r\n## Two")).toEqual(parseMarkdown("# One\n\n## Two"));
    expect(parseMarkdown("```js\r\nconst a = 1;\r\n```")).toEqual(
      parseMarkdown("```js\nconst a = 1;\n```"),
    );
    expect(parseMarkdown("- one\r\n- two")).toEqual(parseMarkdown("- one\n- two"));
    expect(parseMarkdown("a\rb")).toEqual(parseMarkdown("a\nb"));
  });

  it("parses unordered and ordered lists", () => {
    expect(parseMarkdown("- one\n- two")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          { checked: null, children: [{ type: "paragraph", children: [text("one")] }] },
          { checked: null, children: [{ type: "paragraph", children: [text("two")] }] },
        ],
      },
    ]);
    expect(parseMarkdown("1. one\n2. two")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          { checked: null, children: [{ type: "paragraph", children: [text("one")] }] },
          { checked: null, children: [{ type: "paragraph", children: [text("two")] }] },
        ],
      },
    ]);
  });

  it("accepts more than one space after a list marker", () => {
    expect(parseMarkdown("-   spaced")[0].type).toBe("list");
    expect(parseMarkdown("*  starred")[0].type).toBe("list");
  });

  it("nests a list one level deep", () => {
    const [list] = parseMarkdown("- outer\n  - inner");
    expect(list.items).toHaveLength(1);
    expect(list.items[0].children).toEqual([
      { type: "paragraph", children: [text("outer")] },
      {
        type: "list",
        ordered: false,
        items: [{ checked: null, children: [{ type: "paragraph", children: [text("inner")] }] }],
      },
    ]);
  });

  it("gives a nested list its own marker type rather than the parent's", () => {
    const [list] = parseMarkdown("- outer\n  1. inner");
    expect(list.ordered).toBe(false);
    expect(list.items[0].children[1].ordered).toBe(true);
  });

  it("parses task list items in either case", () => {
    const [list] = parseMarkdown("- [ ] todo\n- [x] done\n- [X] also done");
    expect(list.items.map((i) => i.checked)).toEqual([false, true, true]);
    // An unchecked task is `false`; `null` means "not a task at all", and
    // collapsing the two renders every plain bullet as a checkbox.
    expect(parseMarkdown("- plain")[0].items[0].checked).toBeNull();
  });

  it("keeps a fenced code block verbatim, including its markdown characters", () => {
    const src = "```js\nconst a = **not bold**;\n# not a heading\n```";
    expect(parseMarkdown(src)).toEqual([
      { type: "code", lang: "js", text: "const a = **not bold**;\n# not a heading" },
    ]);
  });

  it("defaults a fence with no language to an empty lang", () => {
    expect(parseMarkdown("```\nplain\n```")).toEqual([{ type: "code", lang: "", text: "plain" }]);
  });

  it("parses blockquotes with or without a space after the marker", () => {
    const expected = [{ type: "quote", children: [{ type: "paragraph", children: [text("quoted")] }] }];
    expect(parseMarkdown("> quoted")).toEqual(expected);
    expect(parseMarkdown(">quoted")).toEqual(expected);
  });

  it("parses all three horizontal rule forms", () => {
    expect(parseMarkdown("---")).toEqual([{ type: "hr" }]);
    expect(parseMarkdown("***")).toEqual([{ type: "hr" }]);
    expect(parseMarkdown("___")).toEqual([{ type: "hr" }]);
  });
});

describe("inline", () => {
  it("parses bold, italic and inline code", () => {
    expect(parseMarkdown("a **b** c *d* e `f`")).toEqual([
      {
        type: "paragraph",
        children: [
          text("a "),
          { type: "strong", children: [text("b")] },
          text(" c "),
          { type: "em", children: [text("d")] },
          text(" e "),
          { type: "code", value: "f" },
        ],
      },
    ]);
  });

  it("leaves underscores alone", () => {
    // Deliberate divergence from CommonMark: this is an engineering notebook,
    // where snake_case identifiers are far more common than underscore
    // emphasis. Asserted so it is a decision rather than an accident.
    expect(parseMarkdown("run some_function_name now")).toEqual([
      { type: "paragraph", children: [text("run some_function_name now")] },
    ]);
    expect(plainText(parseMarkdown("__not strong__"))).toBe("__not strong__");
  });

  it("does not parse markdown inside inline code", () => {
    expect(parseMarkdown("`**literal**`")).toEqual([
      { type: "paragraph", children: [{ type: "code", value: "**literal**" }] },
    ]);
  });

  it("parses a link and marks whether it leaves the app", () => {
    // `external` is what lets the renderer attach rel="noopener noreferrer".
    // Without it on the token there is no way for any external link in this
    // feature to carry it.
    expect(parseMarkdown("see [docs](https://example.com/x)")).toEqual([
      {
        type: "paragraph",
        children: [
          text("see "),
          { type: "link", href: "https://example.com/x", external: true, children: [text("docs")] },
        ],
      },
    ]);
    expect(parseMarkdown("[here](/settings)")[0].children[0]).toMatchObject({ external: false });
  });

  it("parses markdown inside a link label", () => {
    const [para] = parseMarkdown("[**bold** label](https://example.com)");
    expect(para.children[0].children).toEqual([
      { type: "strong", children: [text("bold")] },
      text(" label"),
    ]);
  });

  it("preserves the href exactly, without lowercasing it", () => {
    // Signed URLs and case-sensitive paths break if the href is normalized.
    const href = "https://example.com/Reports/Q3-FINAL.pdf?token=AbC123";
    expect(allUrls(parseMarkdown(`[x](${href})`))).toEqual([href]);
  });
});

describe("safety", () => {
  const DANGEROUS = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    `java${TAB}script:alert(1)`,
    `java${CR}script:alert(1)`,
    // Browsers strip leading C0 controls before parsing the scheme, so .trim()
    // alone is not enough. These were proven browser-live against a reference
    // that passed the draft.
    `${C0}javascript:alert(1)`,
    `${C0}data:text/html;base64,PHNjcmlwdD4=`,
    `java${ZWSP}script:alert(1)`,
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox",
    // None of these are on any denylist written from the draft's fixtures, and
    // all of them navigate.
    "file:///C:/Windows/win.ini",
    "blob:https://app.example/9f2",
    "about:blank",
    "view-source:https://evil.com",
    "intent://evil#Intent;scheme=http;end",
    "filesystem:https://evil.com/temporary/x",
    // Protocol-relative: the positive control's "/relative" fixture actively
    // teaches that a leading slash is safe. Some leading slashes are not.
    "//evil.com/phish",
    // A backslash is equivalent to a slash in the WHATWG URL parser for
    // special schemes, so these are protocol-relative too - they start with a
    // single slash and pass any check written as "reject //". Worse than a
    // plain external link: a same-origin verdict also means no
    // rel="noopener noreferrer".
    "/\\evil.com",
    "/\\/evil.com",
    "/\\\\evil.com",
    // D1: the WHATWG URL parser strips EVERY ASCII tab, CR and LF from a
    // url before resolving it, not just leading ones. A check that only
    // inspects the single character immediately after the leading slash
    // sees "/\t/evil.com" as a harmless same-origin path, but a browser
    // strips the tab and navigates to "//evil.com" - and marks it
    // external:false on the way, which is what strips it of
    // rel="noopener noreferrer" too. Proven live against the shipped code.
    `/${TAB}/evil.com`,
    `/${LF}/evil.com`,
    `/${TAB}\\evil.com`,
    // Padding proves the fix strips unboundedly rather than widening a
    // fixed-width window - a wider fixed window is just as walkable-past
    // with enough characters.
    `/${TAB}${TAB}${TAB}/evil.com`,
  ];

  // The same link in every block context. A parse-then-sanitize implementation
  // that walked only paragraphs passed the entire first draft while leaving
  // live links in all of these.
  const CONTEXTS = {
    paragraph: (link) => link,
    heading: (link) => `# ${link}`,
    "list item": (link) => `- ${link}`,
    "task item": (link) => `- [ ] ${link}`,
    "ordered item": (link) => `1. ${link}`,
    blockquote: (link) => `> ${link}`,
    "inside bold": (link) => `**${link}**`,
    "nested list item": (link) => `- outer\n  - ${link}`,
  };

  it("emits no navigable url for a dangerous scheme, in any block context", () => {
    for (const scheme of DANGEROUS) {
      for (const [where, wrap] of Object.entries(CONTEXTS)) {
        const src = wrap(`[x](${scheme})`);
        expect(allUrls(parseMarkdown(src)), `${where}: ${JSON.stringify(scheme)}`).toEqual([]);
      }
    }
  });

  it("still produces real links for safe schemes, in every one of those contexts", () => {
    // The positive control. A parser that rejected every link, or one that
    // dropped whole blocks, would pass the test above and destroy the feature.
    for (const [where, wrap] of Object.entries(CONTEXTS)) {
      const src = wrap("[x](https://example.com/ok)");
      expect(allUrls(parseMarkdown(src)), where).toEqual(["https://example.com/ok"]);
    }
  });

  it("allows only the schemes on the allowlist", () => {
    for (const href of ["https://example.com", "http://example.com", "mailto:a@b.co", "/relative"]) {
      expect(allUrls(parseMarkdown(`[x](${href})`))).toEqual([href]);
    }
  });

  it("still links a safe url written in a non-canonical form", () => {
    // These are why the scheme is lowercased, why leading C0 controls are
    // stripped rather than trimmed, and why tab/CR/LF are removed from inside
    // the scheme. Under an ALLOWLIST none of those three defences is visible to
    // a dangerous-scheme fixture - an unknown scheme is rejected either way -
    // so mutating any of them away left the suite green while silently turning
    // a pasted link into plain text. Found by mutating the shipped parser.
    const messy = [
      "HTTPS://example.com/x",
      "  https://example.com/x",
      `${C0}https://example.com/x`,
      `ht${TAB}tps://example.com/x`,
      "MAILTO:a@b.co",
    ];
    for (const href of messy) {
      expect(allUrls(parseMarkdown(`[x](${href})`)), JSON.stringify(href)).toHaveLength(1);
    }
  });

  it("keeps a blocked link's text as inert text instead of deleting it", () => {
    // The draft's test was named "renders as plain text" but asserted only the
    // absence of a link token, so silently dropping the whole thing passed.
    const out = parseMarkdown("[click me](javascript:alert(1)) and more");
    expect(plainText(out)).toContain("click me");
    expect(plainText(out)).toContain("and more");
    expect(allUrls(out)).toEqual([]);
  });

  it("never interprets raw HTML in the source", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([
      { type: "paragraph", children: [text("<script>alert(1)</script>")] },
    ]);
    expect(allUrls(parseMarkdown('<img src="x" onerror="alert(1)">'))).toEqual([]);
    expect(allUrls(parseMarkdown("<a href=\"javascript:alert(1)\">x</a>"))).toEqual([]);
  });

  it("does not support autolinks, images or reference links as url-bearing tokens", () => {
    // Each of these is a natural addition that would be written in a separate
    // branch from [text](href), and each produced a live url against an
    // implementation that passed the draft. Attachments cover images here, so
    // none of these syntaxes carry a url at all.
    const sneaky = [
      "<javascript:alert(1)>",
      "<https://example.com>",
      "![alt](javascript:alert(1))",
      '![alt](x" onerror="alert(1))',
      "[x][ref]\n\n[ref]: javascript:alert(1)",
    ];
    for (const src of sneaky) {
      const urls = allUrls(parseMarkdown(src));
      expect(urls.filter((u) => !/^https?:/.test(u)), JSON.stringify(src)).toEqual([]);
    }
  });

  it("carries no state between documents", () => {
    // A parser holding link definitions in module scope would leak one page's
    // definitions into the next - cross-page injection inside one session.
    const a = "[x][ref] plain";
    const poison = "[ref]: javascript:alert(1)";
    const first = parseMarkdown(a);
    parseMarkdown(poison);
    expect(parseMarkdown(a)).toEqual(first);
    expect(allUrls(parseMarkdown(a))).toEqual([]);
  });
});

describe("malformed input keeps the user's text", () => {
  it("never loses characters the user typed", () => {
    // The draft asserted only not.toThrow() and Array.isArray(), both of which
    // an empty array satisfies, so a mutant that deleted every paragraph
    // containing a bracket or a pipe passed.
    const cases = [
      ["a stray ] bracket", ["stray", "]", "bracket"]],
      ["[link with no href]", ["link with no href"]],
      ["see my [notes] from Q3", ["see my", "notes", "from Q3"]],
      ["|table|like|", ["table", "like"]],
      ["**unclosed bold", ["unclosed bold"]],
      ["*half italic", ["half italic"]],
      ["```js\nhalf written", ["half written"]],
      ["\\*not italic\\*", ["not italic"]],
      ["## heading ##", ["heading"]],
      ["***bold italic***", ["bold italic"]],
    ];
    for (const [src, fragments] of cases) {
      const out = parseMarkdown(src);
      expect(() => parseMarkdown(src)).not.toThrow();
      const rendered = plainText(out);
      for (const fragment of fragments) {
        expect(rendered, JSON.stringify(src)).toContain(fragment);
      }
    }
  });

  it("returns an empty list for empty or non-string input", () => {
    for (const input of ["", null, undefined, 123, {}, [], true]) {
      expect(parseMarkdown(input), JSON.stringify(input)).toEqual([]);
    }
  });

  it("survives degenerate input without hanging", () => {
    for (const src of ["[".repeat(20000), "`".repeat(20000), "#".repeat(5000), "\n".repeat(5000)]) {
      expect(() => parseMarkdown(src)).not.toThrow();
    }
  });
});
