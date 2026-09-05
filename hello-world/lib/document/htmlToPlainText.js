// AC-C1.3's seventeen-row plain-text derivation for the "copy the document
// text" feature (plan PART 2). Turns the preview surface's HTML (either the
// rendered document or a hand-edited contentEditable's live innerHTML) into
// exactly the string the user sees, so what lands on the clipboard is never a
// stale or fused version of the screen.
//
// Mechanism, mandatory: `new DOMParser().parseFromString(html, "text/html")`,
// walking `doc.body.childNodes` -- an INERT document, never
// `element.innerHTML = html` on a live one, which can start resource loads for
// a pasted `<img src>`. Requires jsdom/a browser; `DOMParser` is `undefined` in
// this repo's default node vitest environment, which is why the test file
// carries a `// @vitest-environment jsdom` docblock.
//
// The walk needs only three special cases -- BLOCK elements add one line
// terminator after their children (B1-B6); `<br>` adds one terminator UNLESS
// it is the last child of its immediate parent (BR1/BR2); everything else
// (containers like <ul>/<table>, and every inline element like <span>/<b>/<a>)
// simply recurses with no terminator of its own, which is what makes B7 and
// I1/I2 fall out of the SAME code path rather than needing their own branches.
const BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "TD", "TH",
  "BLOCKQUOTE", "PRE", "DT", "DD", "FIGCAPTION", "ADDRESS",
]);
const EXCLUDED_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

const NBSP = String.fromCharCode(0x00a0);
const SPACE = String.fromCharCode(0x0020);

function isHiddenElement(el) {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.style && el.style.display === "none") return true;
  return false;
}

export function htmlToPlainText(html) {
  // AC-C1.7: defensive on entry -- `editorRef.current.innerHTML` and a saved
  // scope's `.html` are always strings in practice, but a non-string here must
  // never throw inside an async click handler, where the rejection would be
  // unhandled and the user would see nothing at all.
  const src = String(html ?? "");
  if (src.length === 0) return "";

  const doc = new DOMParser().parseFromString(src, "text/html");

  let out = "";
  // F1: a DEPTH-INDEPENDENT flag, not `out.endsWith("\n")` (which would eat a
  // trailing bare text node's OWN newline, T1's verbatim rule) and not a
  // depth===0 check (which would keep a list's last <li>'s terminator, since
  // the body's last child there is the <ul> container, not a block). Set true
  // by every block terminator and every BR1 terminator, at any depth; set
  // false by every text-node emission (even one that itself ends in "\n").
  let lastWasTerminator = false;

  function walk(node, siblings, index) {
    if (node.nodeType === 3) {
      // T1: verbatim, no whitespace collapsing, no trimming -- every rendered
      // <p> carries white-space:pre-wrap, so runs of spaces and tabs really
      // are on screen.
      out += node.data;
      if (node.data.length > 0) lastWasTerminator = false;
      return;
    }
    if (node.nodeType !== 1) return; // comments etc. contribute nothing
    const tag = node.tagName;
    if (EXCLUDED_TAGS.has(tag)) return; // X1
    if (isHiddenElement(node)) return; // X2

    if (tag === "BR") {
      // BR2: a <br> that IS its block's last child contributes NOTHING --
      // Chrome's bogus trailing <br>, and renderModelToHtml's own blank-
      // paragraph markup. BR1: otherwise, one "\n" at that point.
      const isLastChild = index === siblings.length - 1;
      if (!isLastChild) {
        out += "\n";
        lastWasTerminator = true;
      }
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    const children = Array.from(node.childNodes);
    children.forEach((child, i) => walk(child, children, i));

    if (isBlock) {
      out += "\n";
      lastWasTerminator = true;
    }
    // Every other element -- B7's pure containers (ul/ol/table/tbody/thead/tr)
    // AND every inline element (I1's <span>, I2's b/i/u/em/strong/a/font/mark/
    // code/small/sub/sup) -- contributes nothing of its own here: it already
    // recursed into its children above, with no boundary and no terminator.
  }

  const bodyChildren = Array.from(doc.body.childNodes);
  bodyChildren.forEach((child, i) => walk(child, bodyChildren, i));

  // F1, exactly once, at the very end -- AFTER the walk, BEFORE the N1 pass.
  // Never `.trim()` (eats a leading blank line), never `.trimEnd()` and never
  // `.replace(/\n+$/,"")` (both eat a trailing blank line OR a run of them);
  // each is measurably wrong on a corpus this feature's own tests pin.
  if (lastWasTerminator) out = out.slice(0, -1);

  // N1: the ONE documented substitution, a single whole-string pass so an NBSP
  // straddling a text-node boundary is still caught. Chrome emits `&nbsp;` for
  // the second of two consecutively typed spaces, and that character pasted
  // into an ATS keyword matcher is a real cost.
  return out.split(NBSP).join(SPACE);
}
