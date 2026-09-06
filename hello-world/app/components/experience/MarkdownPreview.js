"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import { parseMarkdown } from "../../../lib/experience/markdown.js";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// Renders the token tree from lib/experience/markdown.js as real React
// elements - never dangerouslySetInnerHTML, anywhere in this file. The page
// title is the page's own <h1>, so a level-1 heading in the body (`#`) must
// not also render as an <h1> - that would skip nothing, but a level-1 body
// heading rendering as <h1> alongside the page's own <h1> duplicates the
// top of the heading outline, and a level-3 body heading (`###`) rendering
// as anything other than <h4> would SKIP a level. Offsetting every body
// heading by one keeps the outline: `#` -> h2, `##` -> h3, `###` -> h4.
const HEADING_OFFSET = 1;
const MAX_HEADING_TAG = 6;

// Rough size step-down per rendered tag (h2 body heading down to h4 body
// heading, since the parser caps at level 3 and HEADING_OFFSET adds one).
const HEADING_FONT_SIZE = { h2: 20, h3: 17, h4: 15 };
const LINK_SX = { color: "var(--accent, #1976d2)" };
const MAILTO = /^mailto:/i;

function renderInline(children, keyPrefix, renderLink) {
  return (children || []).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "text":
        return token.value;
      case "strong":
        return <strong key={key}>{renderInline(token.children, key, renderLink)}</strong>;
      case "em":
        return <em key={key}>{renderInline(token.children, key, renderLink)}</em>;
      case "code":
        return <code key={key}>{token.value}</code>;
      case "link": {
        const external = !!token.external;
        // The optional seam. A caller that knows something this component
        // cannot - the digest panel, which knows a given href is a citation
        // marker and what number the renderer assigned it - returns its own
        // element here. Returning `undefined` (including from a caller that
        // recognises nothing) falls through to the rendering below, so with
        // no `renderLink` prop this file behaves byte-identically to before
        // and PageEditor's preview is unchanged.
        if (renderLink) {
          const custom = renderLink({
            href: token.href,
            external,
            key,
            children: renderInline(token.children, key, renderLink),
          });
          if (custom !== undefined) return custom;
        }
        // `token.href` has already passed lib/experience/markdown.js's
        // sanitizeUrl - but that is a scheme-PREFIX test, not a URL parse.
        // It admits `[acme.com](https://acme.com@evil.example/story)`, a
        // link labelled acme.com that navigates to evil.example, and admits
        // strings new URL() rejects outright. So an external http(s) link is
        // re-checked here against the shared control, and a refused one
        // renders as inert text with NO anchor at all - the same degradation
        // the javascript: case has always had.
        //
        // Two shapes deliberately keep sanitizeUrl's own verdict, and are
        // the reviewed exceptions recorded in hrefSafety.sweep.test.js:
        //   * a same-origin "/path" (external === false). Not an external
        //     navigation; its deliberately rel-LESS rendering is pinned by
        //     MarkdownPreview.test.js and safeExternalHref refuses every
        //     relative URL by construction (rule 3).
        //   * mailto:, which opens a mail client rather than a page.
        if (!external || MAILTO.test(token.href)) {
          return (
            <Box
              key={key}
              component="a"
              href={token.href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              sx={LINK_SX}
            >
              {renderInline(token.children, key, renderLink)}
            </Box>
          );
        }
        const href = safeExternalHref(token.href);
        if (!href) return <span key={key}>{renderInline(token.children, key, renderLink)}</span>;
        return (
          <Box key={key} component="a" href={href} target="_blank" rel="noopener noreferrer" sx={LINK_SX}>
            {renderInline(token.children, key, renderLink)}
          </Box>
        );
      }
      default:
        return null;
    }
  });
}

function renderList(token, key, renderLink) {
  const ListTag = token.ordered ? "ol" : "ul";
  return (
    <Box key={key} component={ListTag} sx={{ pl: 3, m: 0, my: 1 }}>
      {token.items.map((item, index) => {
        const itemKey = `${key}-${index}`;
        const isTask = item.checked !== null;
        return (
          <Box component="li" key={itemKey} sx={{ mb: 0.5, listStyleType: isTask ? "none" : undefined, ml: isTask ? -3 : 0 }}>
            {isTask ? (
              <Checkbox
                checked={!!item.checked}
                disabled
                size="small"
                sx={{ p: 0, mr: 0.5, verticalAlign: "middle" }}
                inputProps={{ "aria-label": item.checked ? "Completed task" : "Incomplete task" }}
              />
            ) : null}
            {renderBlocks(item.children, itemKey, renderLink)}
          </Box>
        );
      })}
    </Box>
  );
}

function renderBlock(token, key, renderLink) {
  switch (token.type) {
    case "heading": {
      const level = Math.min(token.level + HEADING_OFFSET, MAX_HEADING_TAG);
      const HeadingTag = `h${level}`;
      return (
        <Box
          key={key}
          component={HeadingTag}
          sx={{ mt: 2, mb: 1, fontWeight: 700, fontSize: HEADING_FONT_SIZE[HeadingTag] || 14 }}
        >
          {renderInline(token.children, key, renderLink)}
        </Box>
      );
    }
    case "paragraph":
      return (
        <Box
          key={key}
          component="p"
          // `pre-wrap` preserves the author's line breaks, but on its own it
          // only wraps at whitespace - an unbroken long token (a URL, a
          // base64 blob, a minified line) overflows the box instead. There
          // is no scrollbar to reach it: globals.css clips overflow-x at
          // <html>, so an overflowing token is not just off-screen, it is
          // unreachable. `overflowWrap: "anywhere"` lets the browser break
          // inside such a token so it wraps within this box instead.
          sx={{ my: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {renderInline(token.children, key, renderLink)}
        </Box>
      );
    case "list":
      return renderList(token, key, renderLink);
    case "code":
      return (
        <Box
          key={key}
          component="pre"
          sx={{
            my: 1,
            p: 1.5,
            borderRadius: 1,
            // Was a literal rgba(0,0,0,0.06) - a fixed black wash that
            // reads as a faint fill on a white/light-mode ground but is
            // indistinguishable from a near-black dark-mode ground (this
            // app switches theme via <html data-theme>, not a CSS media
            // query, so a literal never adapts). `--border` is one of the
            // tokens app/theme/tokens.js flips per mode, so this fill
            // switches with it instead of staying frozen.
            bgcolor: "var(--border)",
            overflowX: "auto",
          }}
        >
          <Box component="code" sx={{ fontFamily: "monospace", fontSize: 13 }}>
            {token.text}
          </Box>
        </Box>
      );
    case "quote":
      return (
        <Box
          key={key}
          component="blockquote"
          sx={{
            my: 1,
            ml: 0,
            pl: 2,
            // Was a literal rgba(0,0,0,0.2) - see the "code" case above for
            // why a literal here is invisible in dark mode. --border-strong
            // is the same family of token, one step more prominent, which
            // matches how it's already used for other emphasised dividers
            // (see ChatPanel.js, ApplyingControls.js).
            borderLeft: "3px solid var(--border-strong)",
            color: "text.secondary",
          }}
        >
          {renderBlocks(token.children, key, renderLink)}
        </Box>
      );
    case "hr":
      // Was a literal rgba(0,0,0,0.12) - see the "code" case above. Same
      // fix, same token as the code block's fill: --border.
      return <Box key={key} component="hr" sx={{ my: 2, border: 0, borderTop: "1px solid var(--border)" }} />;
    default:
      return null;
  }
}

function renderBlocks(tokens, keyPrefix, renderLink) {
  return (tokens || []).map((token, index) => renderBlock(token, `${keyPrefix}-${index}`, renderLink));
}

// <MarkdownPreview markdown={body} /> - the only prop most callers need. It
// parses internally so callers (PageEditor's preview mode) never touch the
// token tree directly.
//
// `renderLink` is optional and is the digest panel's seam: it is called for
// every link token with { href, external, key, children } and may return an
// element to render instead. Returning `undefined` - which includes every
// link a caller does not recognise - falls through to the rendering below, so
// omitting the prop leaves this component byte-identical to what it was.
// The seam exists because the marker's number, its accessible name and its
// affordance are decided by a citation record this component knows nothing
// about, and the alternative was a second markdown renderer.
export default function MarkdownPreview({ markdown, renderLink }) {
  const tokens = parseMarkdown(markdown);
  if (tokens.length === 0) {
    return (
      <Box sx={{ color: "text.secondary", fontStyle: "italic" }}>Nothing to preview yet.</Box>
    );
  }
  return <Box sx={{ fontSize: 14, lineHeight: 1.7 }}>{renderBlocks(tokens, "b", renderLink)}</Box>;
}
