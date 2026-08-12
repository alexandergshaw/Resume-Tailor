"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import { parseMarkdown } from "../../../lib/experience/markdown.js";

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

function renderInline(children, keyPrefix) {
  return (children || []).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "text":
        return token.value;
      case "strong":
        return <strong key={key}>{renderInline(token.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(token.children, key)}</em>;
      case "code":
        return <code key={key}>{token.value}</code>;
      case "link": {
        const external = !!token.external;
        return (
          <Box
            key={key}
            component="a"
            href={token.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            sx={{ color: "var(--accent, #1976d2)" }}
          >
            {renderInline(token.children, key)}
          </Box>
        );
      }
      default:
        return null;
    }
  });
}

function renderList(token, key) {
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
            {renderBlocks(item.children, itemKey)}
          </Box>
        );
      })}
    </Box>
  );
}

function renderBlock(token, key) {
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
          {renderInline(token.children, key)}
        </Box>
      );
    }
    case "paragraph":
      return (
        <Box key={key} component="p" sx={{ my: 1, whiteSpace: "pre-wrap" }}>
          {renderInline(token.children, key)}
        </Box>
      );
    case "list":
      return renderList(token, key);
    case "code":
      return (
        <Box
          key={key}
          component="pre"
          sx={{
            my: 1,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "rgba(0,0,0,0.06)",
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
            borderLeft: "3px solid rgba(0,0,0,0.2)",
            color: "text.secondary",
          }}
        >
          {renderBlocks(token.children, key)}
        </Box>
      );
    case "hr":
      return <Box key={key} component="hr" sx={{ my: 2, border: 0, borderTop: "1px solid rgba(0,0,0,0.12)" }} />;
    default:
      return null;
  }
}

function renderBlocks(tokens, keyPrefix) {
  return (tokens || []).map((token, index) => renderBlock(token, `${keyPrefix}-${index}`));
}

// <MarkdownPreview markdown={body} /> - the only prop this component needs.
// It parses internally so callers (PageEditor's preview mode) never touch
// the token tree directly.
export default function MarkdownPreview({ markdown }) {
  const tokens = parseMarkdown(markdown);
  if (tokens.length === 0) {
    return (
      <Box sx={{ color: "text.secondary", fontStyle: "italic" }}>Nothing to preview yet.</Box>
    );
  }
  return <Box sx={{ fontSize: 14, lineHeight: 1.7 }}>{renderBlocks(tokens, "b")}</Box>;
}
