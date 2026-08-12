// Hand-rolled markdown parser for "Professional Experience" project pages.
// Pure and dependency-free: no npm markdown package, no module-scope state,
// no HTML string ever produced (MarkdownPreview turns the token tree this
// module returns into React elements directly).
//
// Supported: ATX headings (#-###), paragraphs with hard line breaks, one
// level of nested unordered/ordered lists (with task-list items), fenced
// code blocks, blockquotes, horizontal rules, and inline code/bold/italic/
// links. Underscores are always literal - this is an engineering notebook,
// where `some_function_name` is far more common than underscore emphasis.
//
// Safety is the reason this file exists in this shape rather than a simpler
// one. See markdown.test.js for the full contract; the short version:
//
//  - Every link, in every block context, is constructed through the SAME
//    branch of parseInline (the single `[` handler below). There is no
//    separate "walk the tree and sanitize afterwards" pass, because that
//    shape is exactly what let a javascript: link survive inside a heading
//    or list item in an earlier draft while a paragraph-only sanitizer
//    looked the other way.
//  - sanitizeUrl is an ALLOWLIST (http, https, mailto, and a same-origin
//    path starting with exactly one slash) rather than a denylist, because a
//    denylist only ever blocks the schemes someone thought to write down.
//  - Malformed input never deletes what the user typed. An unterminated
//    fence, an unclosed `**`, a stray `]` - all fall back to literal text
//    instead of vanishing.

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);

// CommonMark's escapable ASCII punctuation. A backslash before any of these
// yields the literal character rather than the character's markdown meaning.
const ESCAPABLE = new Set([
  "!", '"', "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
  ":", ";", "<", "=", ">", "?", "@", "[", "\\", "]", "^", "_", "`", "{", "|", "}", "~",
]);

const FENCE_OPEN_RE = /^ {0,3}```(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}```\s*$/;
const HR_RE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const HEADING_RE = /^ {0,3}(#{1,3}) +(.*)$/;
const QUOTE_RE = /^ {0,3}> ?/;
const BULLET_RE = /^( *)[-*] +(.*)$/;
const ORDERED_RE = /^( *)\d+\. +(.*)$/;
const TASK_RE = /^\[( |x|X)\] +(.*)$/;

function isBlockStart(line) {
  if (FENCE_OPEN_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (QUOTE_RE.test(line)) return true;
  if (BULLET_RE.test(line)) return true;
  if (ORDERED_RE.test(line)) return true;
  return false;
}

function leadingSpaces(line) {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

// The single path a URL can travel to become a link token. Allowlist, not
// denylist: only http:, https:, mailto:, and a same-origin path beginning
// with exactly one slash (protocol-relative "//" is rejected, not allowed).
function sanitizeUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;

  // Browsers strip leading C0 controls (and whitespace) before parsing a
  // scheme, so a plain .trim() is not enough - javascript:... prefixed with
  // a control character still navigates. Strip everything <= U+0020 (C0
  // controls plus space, tab, CR, LF) from the front before deciding.
  let i = 0;
  while (i < rawUrl.length && rawUrl.charCodeAt(i) <= 0x20) i++;
  const s = rawUrl.slice(i);
  if (s.length === 0) return null;

  // The WHATWG URL parser strips EVERY ASCII tab, CR and LF from the whole
  // url before resolving it, not just leading ones - a check that only
  // looks at the single character after the leading slash sees
  // "/\t/evil.com" as a harmless same-origin path, but a browser strips the
  // tab and navigates to "//evil.com" exactly as if it had been typed that
  // way. Compute the accept/reject decision on a copy with all three
  // characters removed, everywhere in the string, so the protocol-relative
  // check and the scheme check below see what the browser will actually
  // parse. This has to be an unbounded strip rather than a wider fixed-width
  // check - "/\t\t\t/evil.com" style padding would just walk past a wider
  // window the same way it walks past a one-character one. The href kept
  // for the token is still the raw, unstripped rawUrl: browsers do this
  // stripping themselves at navigation time, so there is nothing to correct
  // in what gets stored, only in what gets decided.
  const decision = s.replace(/[\t\r\n]/g, "");

  // Protocol-relative is checked before scheme extraction: it has no colon
  // at all, and it is not the same-origin path the single-slash rule is
  // meant to allow. This covers both "//evil.com" AND "/\evil.com" - in the
  // WHATWG URL parser a backslash is equivalent to a forward slash for
  // special schemes, so "/\evil.com" resolves exactly like "//evil.com" and
  // the browser navigates cross-origin. Only the character immediately
  // after the leading slash matters here; a backslash later in a path is a
  // harmless, legitimate character in a pasted Windows-looking path.
  if (decision.startsWith("/") && /^[/\\]/.test(decision.slice(1))) return null;
  if (decision.startsWith("/")) {
    return { href: rawUrl, external: false };
  }

  const colonIdx = decision.indexOf(":");
  if (colonIdx === -1) return null;
  const scheme = decision.slice(0, colonIdx).toLowerCase();
  if (ALLOWED_SCHEMES.has(scheme)) {
    return { href: rawUrl, external: true };
  }
  return null;
}

function isEscapable(ch) {
  return ESCAPABLE.has(ch);
}

// Inline scan: backslash escapes, inline code, strong, emphasis, images
// (inert - this feature covers images via attachments, not markdown syntax)
// and links. Every branch that fails to find its closing delimiter falls
// back to literal text instead of throwing or dropping characters.
function parseInline(str) {
  const tokens = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  let i = 0;
  const n = str.length;
  while (i < n) {
    const ch = str[i];

    if (ch === "\\" && i + 1 < n && isEscapable(str[i + 1])) {
      buffer += str[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const close = str.indexOf("`", i + 1);
      if (close !== -1) {
        flush();
        tokens.push({ type: "code", value: str.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === "*" && str[i + 1] === "*") {
      const close = str.indexOf("**", i + 2);
      if (close !== -1) {
        flush();
        tokens.push({ type: "strong", children: parseInline(str.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
      buffer += "**";
      i += 2;
      continue;
    }

    if (ch === "*") {
      const close = str.indexOf("*", i + 1);
      if (close !== -1) {
        flush();
        tokens.push({ type: "em", children: parseInline(str.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    // Image syntax: ![alt](url). Attachments cover images in this feature,
    // so this never carries a url - only the alt text survives, inert.
    if (ch === "!" && str[i + 1] === "[") {
      const closeBracket = str.indexOf("]", i + 2);
      if (closeBracket !== -1 && str[closeBracket + 1] === "(") {
        const closeParen = str.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const alt = str.slice(i + 2, closeBracket);
          flush();
          tokens.push(...parseInline(alt));
          i = closeParen + 1;
          continue;
        }
      }
      buffer += ch;
      i += 1;
      continue;
    }

    // Link syntax: [label](url). This is the ONLY place a link token is
    // constructed anywhere in this module - headings, list items, task
    // items, blockquotes and nested emphasis all reach it through recursion
    // into this same function, so there is no separate path to route around.
    if (ch === "[") {
      const closeBracket = str.indexOf("]", i + 1);
      if (closeBracket !== -1 && str[closeBracket + 1] === "(") {
        const closeParen = str.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const label = str.slice(i + 1, closeBracket);
          const rawUrl = str.slice(closeBracket + 2, closeParen);
          const safe = sanitizeUrl(rawUrl);
          flush();
          const labelChildren = parseInline(label);
          if (safe) {
            tokens.push({ type: "link", href: safe.href, external: safe.external, children: labelChildren });
          } else {
            // A blocked link keeps its label as inert text instead of
            // deleting the whole construct.
            tokens.push(...labelChildren);
          }
          i = closeParen + 1;
          continue;
        }
      }
      buffer += ch;
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return tokens;
}

function parseTaskPrefix(content) {
  const m = TASK_RE.exec(content);
  if (!m) return { checked: null, content };
  return { checked: m[1].toLowerCase() === "x", content: m[2] };
}

function parseList(lines, start, baseIndent, ordered) {
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length) {
        i = j;
        break;
      }
      if (leadingSpaces(lines[j]) < baseIndent) break;
      i = j;
      continue;
    }

    const indent = leadingSpaces(line);
    if (indent !== baseIndent) break;

    const bm = BULLET_RE.exec(line);
    const om = ORDERED_RE.exec(line);
    const match = bm || om;
    if (!match) break;
    const thisOrdered = !!om;
    if (thisOrdered !== ordered) break;

    let content = match[2];
    i += 1;

    const task = parseTaskPrefix(content);
    content = task.content;

    const itemChildren = [{ type: "paragraph", children: parseInline(content) }];

    // Nested content: lines indented deeper than this item's marker. Only
    // one level of nesting is a supported feature, but the recursive call
    // below costs nothing extra and does not mis-render deeper input either.
    const nestedRaw = [];
    while (i < lines.length) {
      if (lines[i].trim() === "") {
        let j = i;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && leadingSpaces(lines[j]) > baseIndent) {
          while (i < j) {
            nestedRaw.push("");
            i += 1;
          }
          continue;
        }
        break;
      }
      if (leadingSpaces(lines[i]) > baseIndent) {
        nestedRaw.push(lines[i]);
        i += 1;
        continue;
      }
      break;
    }
    while (nestedRaw.length && nestedRaw[nestedRaw.length - 1].trim() === "") nestedRaw.pop();
    if (nestedRaw.length > 0) {
      let minIndent = Infinity;
      for (const l of nestedRaw) {
        if (l.trim() === "") continue;
        minIndent = Math.min(minIndent, leadingSpaces(l));
      }
      if (!Number.isFinite(minIndent)) minIndent = 0;
      const dedented = nestedRaw.map((l) => (l.trim() === "" ? "" : l.slice(minIndent)));
      itemChildren.push(...parseBlocks(dedented));
    }

    items.push({ checked: task.checked, children: itemChildren });
  }

  return { list: { type: "list", ordered, items }, next: i };
}

function parseBlocks(lines) {
  const tokens = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fenceOpen = FENCE_OPEN_RE.exec(line);
    if (fenceOpen) {
      const lang = fenceOpen[1].trim();
      i += 1;
      const body = [];
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume the closing fence, if any
      tokens.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }

    if (HR_RE.test(line)) {
      tokens.push({ type: "hr" });
      i += 1;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      tokens.push({ type: "heading", level: headingMatch[1].length, children: parseInline(headingMatch[2]) });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE_RE, ""));
        i += 1;
      }
      tokens.push({ type: "quote", children: parseBlocks(body) });
      continue;
    }

    const bm = BULLET_RE.exec(line);
    const om = ORDERED_RE.exec(line);
    if (bm || om) {
      const ordered = !!om;
      const baseIndent = (bm || om)[1].length;
      const { list, next } = parseList(lines, i, baseIndent, ordered);
      tokens.push(list);
      i = next;
      continue;
    }

    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    tokens.push({ type: "paragraph", children: parseInline(paraLines.join("\n")) });
  }

  return tokens;
}

export function parseMarkdown(src) {
  if (typeof src !== "string" || src.length === 0) return [];
  // Normalize CRLF and lone CR to LF at entry. In JavaScript "." does not
  // match "\r", so a regex anchored (.*)$ silently fails on every line of a
  // document pasted from Word or Outlook - this is a Windows machine, so
  // that paste is the common case, not the edge case.
  const normalized = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  return parseBlocks(lines);
}
