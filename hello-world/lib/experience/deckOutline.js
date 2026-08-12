// The slide model for "generate a PowerPoint from these project pages".
//
// Pure transform from parsed markdown (lib/experience/markdown.js) to an
// abstract outline of slides, one layer above OOXML. It consumes the SAME
// token tree that the page editor renders, rather than re-parsing markdown
// itself: a second parser would drift from the hardened one. See
// deckOutline.test.js for the full contract this file exists to satisfy.
//
// Every slide is a plain, JSON-serializable object with a `kind`:
//   - "title"           - opens each project. { title }
//   - "content"         - a body section (the prose/list/code before the
//                          first heading, or everything under one heading).
//                          { title, bullets, blocks }. `bullets` is a flat,
//                          convenience list of every bullet-list item text
//                          on the slide (for the common case: a heading
//                          followed only by a list). `blocks` is the fuller,
//                          ordered record of what the section contained -
//                          paragraph/bullets/code/quote entries - so mixed
//                          content (prose next to a code sample, say) is
//                          never lost even though it does not fit the
//                          top-level `bullets` shortcut.
//   - "image"           - one attachment's own slide. { attachmentId, name,
//                          caption }. Never carries attachment bytes or a
//                          storage path - a renderer fetches the bytes by id
//                          when it actually builds the slide, and this
//                          outline may be logged/serialized before that.
//   - "videoPlaceholder" - stated in place of a video that cannot be
//                          meaningfully embedded in a generated deck.
//                          { attachmentId, name, notes, title }.
//
// Never throws: junk input (null pages, missing fields, non-array entries)
// degrades to skipping that item, not to an unhandled error part-way
// through a batch conversion.

import { parseMarkdown } from "./markdown.js";

const UNTITLED_PROJECT = "Untitled project";

// Flattens an inline token array (text/code/strong/em/link, link and
// emphasis nesting children recursively) down to plain text. Slide titles
// and bullets are plain strings - a generated deck has no rich-text markup
// for a MUI-rendered bold/link span to survive into, so this intentionally
// drops formatting rather than inventing a second representation for it.
function textFromInline(tokens) {
  if (!Array.isArray(tokens)) return "";
  let out = "";
  for (const token of tokens) {
    if (!token || typeof token !== "object") continue;
    if (token.type === "text" || token.type === "code") {
      out += typeof token.value === "string" ? token.value : "";
    } else if (Array.isArray(token.children)) {
      out += textFromInline(token.children);
    }
  }
  return out;
}

// A list item's `children` starts with the item's own paragraph, and may be
// followed by one nested list (see markdown.js's parseList). This reads
// just the item's own text, leaving nested items to the recursive walk in
// collectListItemTexts below.
function listItemOwnText(itemChildren) {
  const para = (itemChildren || []).find((c) => c && c.type === "paragraph");
  return para ? textFromInline(para.children).trim() : "";
}

// Flattens a list token (and any nested lists inside its items) into a
// single, document-ordered array of bullet strings. The outline has no
// concept of indentation levels - a renderer's bullet list is flat - so
// nesting is preserved as ORDER, not as a lost hierarchy.
function collectListItemTexts(listToken, out = []) {
  for (const item of (listToken && listToken.items) || []) {
    const text = listItemOwnText(item && item.children);
    if (text) out.push(text);
    for (const child of (item && item.children) || []) {
      if (child && child.type === "list") collectListItemTexts(child, out);
    }
  }
  return out;
}

// Flattens a blockquote's nested blocks into one block of text, paragraph
// by paragraph (and list item by list item), joined with newlines.
function quoteText(quoteToken) {
  const parts = [];
  const walk = (tokens) => {
    for (const token of tokens || []) {
      if (!token) continue;
      if (token.type === "paragraph") {
        const text = textFromInline(token.children).trim();
        if (text) parts.push(text);
      } else if (token.type === "quote") {
        walk(token.children);
      } else if (token.type === "list") {
        parts.push(...collectListItemTexts(token));
      }
    }
  };
  walk(quoteToken && quoteToken.children);
  return parts.join("\n");
}

// Splits a page's top-level token array into sections: one implicit
// "leading" section (title "") holding whatever comes before the first
// heading, then one section per heading. Every heading level markdown.js
// produces (#-###) starts a new section - a generated deck has no notion of
// sub-headings within one slide, so there is nothing finer to preserve.
function sectionsFromTokens(tokens) {
  const sections = [{ title: "", tokens: [] }];
  for (const token of tokens || []) {
    if (!token) continue;
    if (token.type === "heading") {
      sections.push({ title: textFromInline(token.children).trim(), tokens: [] });
    } else {
      sections[sections.length - 1].tokens.push(token);
    }
  }
  return sections;
}

// Turns one section's tokens into the slide's `blocks`: paragraphs and
// bullet lists carry the section's prose and lists; fenced code blocks
// carry through as their own block kind rather than being flattened into a
// bullet, so a renderer can lay them out in a monospace font. Horizontal
// rules carry no content and are dropped; empty paragraphs/lists (possible
// after markdown.js still emits an empty token for stray whitespace) are
// dropped rather than emitted as blank blocks.
function blocksFromSection(tokens) {
  const blocks = [];
  for (const token of tokens || []) {
    if (!token) continue;
    if (token.type === "paragraph") {
      const text = textFromInline(token.children).trim();
      if (text) blocks.push({ kind: "paragraph", text });
    } else if (token.type === "list") {
      const items = collectListItemTexts(token);
      if (items.length > 0) blocks.push({ kind: "bullets", items });
    } else if (token.type === "code") {
      blocks.push({ kind: "code", lang: token.lang || "", text: token.text || "" });
    } else if (token.type === "quote") {
      const text = quoteText(token);
      if (text) blocks.push({ kind: "quote", text });
    }
    // "hr" and anything else carry no slide content and are intentionally
    // skipped rather than represented as an empty block.
  }
  return blocks;
}

function contentSlideFromSection(section) {
  const blocks = blocksFromSection(section.tokens);
  const bullets = blocks
    .filter((b) => b.kind === "bullets")
    .flatMap((b) => b.items);
  return { kind: "content", title: section.title, bullets, blocks };
}

function slidesForAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return [];

  const id = attachment.id;
  const name = typeof attachment.name === "string" ? attachment.name : "";
  const notes = typeof attachment.notes === "string" ? attachment.notes.trim() : "";

  // Only id/name/notes/kind ever cross into the outline. dataB64,
  // storage_path, and anything else on the attachment record are never
  // read here - the outline may be logged or serialized, and bytes/paths
  // are fetched by id at render time, not smuggled through this layer.
  if (attachment.kind === "image") {
    return [{ kind: "image", attachmentId: id, name, caption: notes || name || "Image" }];
  }

  if (attachment.kind === "video") {
    // A generated deck cannot meaningfully embed video. Rather than
    // silently omitting it - which would leave the user presenting a deck
    // missing something they attached and believed was included - it
    // becomes a titled placeholder slide naming the file and carrying its
    // notes.
    return [
      {
        kind: "videoPlaceholder",
        attachmentId: id,
        name,
        notes,
        title: name ? `Video: ${name}` : "Video attachment",
      },
    ];
  }

  // Every other attachment kind (pdf, text, other) is not something this
  // deck can show at all, and unlike video there is no honest "placeholder"
  // slide for it either - it is simply not part of a PowerPoint's job.
  return [];
}

// outlineFromPages(entries) -> Slide[]
//
// entries: [{ page: { id, title, body }, attachments: Attachment[] }, ...]
//
// Each project opens with a title slide, then one slide per body section
// (the leading, pre-heading prose/code/list if any, then one per heading),
// then one slide per image/video attachment, in the order given. Projects
// are processed in the order given and never interleaved - the second
// project's title slide always comes after everything the first project
// produced.
export function outlineFromPages(entries) {
  if (!Array.isArray(entries)) return [];

  const slides = [];

  for (const entry of entries) {
    const page = entry && typeof entry === "object" ? entry.page : null;
    if (!page || typeof page !== "object") continue;

    const rawTitle = typeof page.title === "string" ? page.title.trim() : "";
    slides.push({ kind: "title", title: rawTitle || UNTITLED_PROJECT });

    const body = typeof page.body === "string" ? page.body : "";
    const sections = sectionsFromTokens(parseMarkdown(body));

    sections.forEach((section, index) => {
      const isLeading = index === 0 && section.title === "";
      const slide = contentSlideFromSection(section);
      // The leading section has no heading to justify a slide on its own -
      // only add it when it actually carries content, so a body that opens
      // straight into a heading (the common case) does not get a pointless
      // empty slide before it. Every heading-derived section becomes a
      // slide regardless of what follows it, because the heading itself is
      // content the user wrote.
      if (isLeading && slide.blocks.length === 0) return;
      slides.push(slide);
    });

    const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
    for (const attachment of attachments) {
      slides.push(...slidesForAttachment(attachment));
    }
  }

  return slides;
}
