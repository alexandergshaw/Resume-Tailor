// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/JobDescriptionTab.test.js and
// app/components/experience/PageTree.test.js are the precedents for
// rendering a whole component here. lib/experience/markdown.js already has
// its own pure-function tests for the token tree; what this file proves is
// the WIRING between that token tree and real DOM output -- heading offset,
// rel on external links, disabled checkboxes, and (this is the reason the
// component never uses dangerouslySetInnerHTML) that hostile input never
// becomes a live script element or a javascript: href in the committed DOM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import MarkdownPreview from "./MarkdownPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(markdown) {
  await act(async () => {
    root.render(createElement(MarkdownPreview, { markdown }));
  });
}

describe("MarkdownPreview -- heading offset", () => {
  // The page's own title is the page's h1. A body `#` heading rendering as
  // h1 would duplicate the top of the outline; a body `###` heading
  // rendering as anything other than h4 would SKIP a level. Both are
  // accessibility-gate failures, so the offset (`#` -> h2, `##` -> h3) is
  // the load-bearing behaviour here, not a style choice.
  it("renders a `#` body heading as h2 and a `##` body heading as h3", async () => {
    await render("# Top\n\n## Sub");
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    expect(h2).not.toBeNull();
    expect(h2.textContent).toBe("Top");
    expect(h3).not.toBeNull();
    expect(h3.textContent).toBe("Sub");
  });
});

describe("MarkdownPreview -- link rel", () => {
  it("gives an external link rel containing both noopener and noreferrer", async () => {
    await render("[docs](https://example.com/docs)");
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    const rel = link.getAttribute("rel") || "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("does not add rel to a same-origin link (href starting with a single slash)", async () => {
    await render("[internal](/pages/other)");
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/pages/other");
    // The distinction is the entire reason the parser emits an `external`
    // flag in the first place -- a same-origin link must not carry it.
    expect(link.getAttribute("rel")).toBeNull();
    expect(link.getAttribute("target")).toBeNull();
  });
});

describe("MarkdownPreview -- block structure", () => {
  it("renders a bullet list as a real ul/li", async () => {
    await render("- one\n- two");
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders an ordered list as a real ol/li", async () => {
    await render("1. one\n2. two\n3. three");
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol.querySelectorAll("li")).toHaveLength(3);
  });

  it("renders a fenced code block as pre > code", async () => {
    await render("```\nconst x = 1;\n```");
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const code = pre.querySelector("code");
    expect(code).not.toBeNull();
    expect(code.textContent).toBe("const x = 1;");
  });

  it("renders a blockquote as a real blockquote", async () => {
    await render("> quoted text");
    const quote = container.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote.textContent).toContain("quoted text");
  });
});

describe("MarkdownPreview -- task list checkboxes", () => {
  it("renders a real, disabled checkbox reflecting the checked state", async () => {
    await render("- [x] done\n- [ ] not done");
    const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    // The preview is read-only: an editable checkbox here would let a user
    // "complete" a task from a view that can never persist the change.
    checkboxes.forEach((box) => expect(box.disabled).toBe(true));
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });
});

describe("MarkdownPreview -- hostile input", () => {
  it("shows a literal <script> tag as visible text and creates no script element", async () => {
    await render("Look: <script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    // The second half matters as much as the first: a renderer that simply
    // dropped the tag (rather than treating it as literal text) would also
    // produce no script element, but would also silently delete content the
    // user typed.
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("never lets a javascript: URL survive into a rendered href", async () => {
    await render("[click me](javascript:alert(1))");
    expect(container.innerHTML).not.toMatch(/href="javascript:/i);
    // A blocked link keeps its label as inert text rather than vanishing.
    expect(container.textContent).toContain("click me");
  });
});
