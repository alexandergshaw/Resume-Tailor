// Turns "Professional Experience" project pages into candidate resume
// material (see tailorSources.test.js for the full contract this file must
// satisfy). Pure: parseMarkdown (./markdown.js) already gives a safe token
// tree, so this module only walks it - it never re-parses markdown itself.
//
// The rule that matters most is EXCLUSION. A page with any `generated_kind`
// set was written by a model that searched the web (the research migration
// is the first such generator; later ones will add other values) - its
// claims are about the industry, not about what the user did. Letting that
// material become resume bullets would put sentences on a resume the user
// cannot defend in an interview and did not write. The check below matches
// on the COLUMN BEING SET, never on a specific string, so a future generator
// is excluded automatically rather than leaking through until someone
// remembers to add its name to a list.
//
// Only list items are mined - a heading is a label, code is not prose, and a
// blockquote is usually someone else's words, so none of the three are
// walked even when they sit right next to a list this function does mine.
// Only an item's OWN first line becomes a fragment; a wrapped continuation
// line (a second paragraph nested under the same item) is prose attached to
// the bullet, not a second bullet, so it is deliberately left alone. A
// nested list under an item IS still walked, one level deep, matching what
// markdown.js itself supports.

import { parseMarkdown } from "./markdown.js";

// Below this many characters, a "bullet" is almost always a placeholder
// ("ok", "TODO", "-") rather than a sentence someone could put on a resume.
const MIN_FRAGMENT_LENGTH = 10;

function isGeneratedPage(page) {
  const kind = page?.generated_kind;
  return kind !== null && kind !== undefined && String(kind).trim() !== "";
}

// Concatenates an inline token tree back into plain text: text/code tokens
// contribute their value, strong/em/link tokens contribute their children's
// text recursively. Markdown syntax (the `**`, the href) is dropped - a
// resume line should read as prose, not as source.
function flattenInline(tokens) {
  if (!Array.isArray(tokens)) return "";
  let out = "";
  for (const token of tokens) {
    if (!token) continue;
    if (token.type === "text" || token.type === "code") {
      out += token.value || "";
    } else if (Array.isArray(token.children)) {
      out += flattenInline(token.children);
    }
  }
  return out;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

// A list item's own first line (markdown.js always builds this as
// item.children[0]). Never a nested continuation paragraph - see this file's
// header comment.
function itemOwnText(item) {
  const firstChild = Array.isArray(item?.children) ? item.children[0] : null;
  if (!firstChild || firstChild.type !== "paragraph") return "";
  return normalizeWhitespace(flattenInline(firstChild.children));
}

// Walks `blocks` for "list" tokens only, pushing one candidate line per item
// into `out` (in document order) and recursing into any nested list living
// alongside that item's own paragraph. Headings, code, quotes and bare
// paragraphs are never descended into - see this file's header comment.
function mineListItems(blocks, out) {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block || block.type !== "list") continue;
    for (const item of block.items || []) {
      const text = itemOwnText(item);
      if (text) out.push(text);
      mineListItems(item.children, out);
    }
  }
}

function looksLikeResumeLine(text) {
  return typeof text === "string" && text.length >= MIN_FRAGMENT_LENGTH;
}

// pages -> [{ text, sourcePageId, sourceTitle }], deduplicated (case-
// insensitively) across every page passed in, in document order. Never
// throws: a missing/malformed page, or a missing/non-string body, is simply
// skipped rather than crashing the caller.
export function fragmentsFromPages(pages) {
  const out = [];
  if (!Array.isArray(pages)) return out;

  const seen = new Set();
  for (const page of pages) {
    if (!page) continue;
    if (isGeneratedPage(page)) continue; // NEVER mine a generated page.

    const blocks = parseMarkdown(typeof page.body === "string" ? page.body : "");
    const lines = [];
    mineListItems(blocks, lines);

    for (const text of lines) {
      if (!looksLikeResumeLine(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text,
        sourcePageId: page.id ?? null,
        sourceTitle: typeof page.title === "string" ? page.title : "",
      });
    }
  }
  return out;
}
