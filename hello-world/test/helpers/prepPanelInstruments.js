// N50: the DOM instruments every N50 test reads the prep panel with, in ONE
// place, canaried once in ./prepPanelInstruments.test.js.
//
// Provenance, so nobody mistakes these for new definitions: each is a copy of
// a helper a landed, canaried prep test already uses -- never a re-invention:
//   visibleText, collapsedBehindAControl, norm
//       PrepPackPanel.recommendedAnswer.test.js (AC-N50 common notes name
//       these two as THE first-paint visibility definition)
//   headingElements, headingLevel, accessibleName
//       PrepPackPanel.sectionHeaders.test.js
//   controlName
//       AppViewDialog.prepRestore.reachability.test.js / sectionActions
//       (named `accessibleName` there)
//   verticalMargins, isDeclaredLength, unpinnedVerticalMargins
//       PrepPackPanel.sectionHeaders.test.js (AC-N44.9's class guard)
// A .test.js file cannot be imported (it would re-run that whole suite), so
// the landed files keep their private copies; this module exists so the N50
// files do not add four MORE copies each. AC-N50's "do not fork a third
// definition" is honoured as far as an import allows.
//
// Plain ES, no vitest import. Every function reads the DOM it is handed and
// nothing else.

export function norm(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

/** Text a sighted reader sees: drops [hidden], aria-hidden, display:none and
 *  visibility:hidden subtrees. NOTE (measured, plan-probe F1): jsdom does NOT
 *  hide the children of a closed <details> on its own -- only an authored
 *  rule does -- so this helper alone sees closed-details content unless the
 *  component states that rule. That is exactly why H-5 asks BOTH helpers. */
export function visibleText(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";
  if (node.hasAttribute("hidden")) return "";
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return "";
  let out = "";
  for (const child of node.childNodes) out += visibleText(child);
  return out;
}

/** Is `node` hidden by ITSELF OR ANY ANCESTOR up to `stop` (display:none,
 *  visibility:hidden, [hidden], aria-hidden)? `visibleText(node)` cannot
 *  answer this: it only walks DOWN from the node it is given, so a control
 *  whose wrapper is display:none still reads its own text back. Measured
 *  the hard way by the N50 4b seat: an H-8 build that hid the rows even
 *  after the disclosure opened passed a visibleText(control) check. */
export function hiddenByAncestry(node, stop) {
  let cursor = node;
  while (cursor && cursor !== stop) {
    if (cursor.getAttribute("aria-hidden") === "true" || cursor.hasAttribute("hidden")) return true;
    const style = cursor.ownerDocument.defaultView.getComputedStyle(cursor);
    if (style.display === "none" || style.visibility === "hidden") return true;
    cursor = cursor.parentElement;
  }
  return false;
}

/** Is `node` hidden behind a collapsed control between itself and `stop`: a
 *  closed <details> (its <summary> excepted -- the summary IS the control) or
 *  an aria-expanded="false" ancestor. */
export function collapsedBehindAControl(node, stop) {
  let cursor = node;
  while (cursor && cursor !== stop) {
    const tag = cursor.tagName.toLowerCase();
    if (tag === "details" && !cursor.hasAttribute("open")) return true;
    if (cursor.getAttribute("aria-expanded") === "false") return true;
    cursor = cursor.parentElement;
  }
  return false;
}

/** A heading's or group's accessible name: aria-labelledby, then aria-label,
 *  then VISIBLE content. */
export function accessibleName(el) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby && labelledby.trim()) {
    return norm(
      labelledby
        .trim()
        .split(/\s+/)
        .map((id) => {
          const target = el.ownerDocument.getElementById(id);
          return target ? visibleText(target) : "";
        })
        .join(" "),
    );
  }
  const label = el.getAttribute("aria-label");
  if (label != null && label.trim()) return label.trim();
  return norm(visibleText(el));
}

/** A CONTROL's name, independent of paint visibility: aria-labelledby, then
 *  aria-label, then textContent with aria-hidden subtrees removed. Used to
 *  FIND controls (a restore button inside a closed disclosure still has a
 *  name); never used to decide whether something is visible. */
export function controlName(node) {
  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => node.ownerDocument.getElementById(id))
      .filter(Boolean)
      .map((el) => el.textContent || "");
    if (parts.length) return norm(parts.join(" "));
  }
  const label = node.getAttribute("aria-label");
  if (label) return norm(label);
  const clone = node.cloneNode(true);
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return norm(clone.textContent);
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/** Elements exposing the heading ROLE, in DOM order. */
export function headingElements(el) {
  return [...el.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter((node) => {
    if (node.getAttribute("aria-hidden") === "true") return false;
    const role = (node.getAttribute("role") || "").trim();
    if (role) return role.split(/\s+/)[0] === "heading";
    return HEADING_TAGS.includes(node.tagName.toLowerCase());
  });
}

export function headingLevel(node) {
  const explicit = (node.getAttribute("aria-level") || "").trim();
  if (/^[1-9]\d*$/.test(explicit)) return Number(explicit);
  const match = /^h([1-6])$/.exec(node.tagName.toLowerCase());
  if (match) return Number(match[1]);
  return 2;
}

/** AC-N50.1's own interactive selector, plus `summary` -- a native <summary>
 *  is focusable and activatable, and it is the control N50 adds. */
export const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [role=button], [tabindex]:not([tabindex="-1"]), summary';

/** True when `b` comes after `a` in document order. */
export function follows(a, b) {
  return !!(a.compareDocumentPosition(b) & a.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Every interactive element in `root` that precedes `target` in DOM order. */
export function interactiveBefore(root, target) {
  return [...root.querySelectorAll(INTERACTIVE_SELECTOR)].filter((node) => node !== target && follows(node, target));
}

const UA_VERTICAL_MARGIN_TAGS = ["p", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figure", "pre", "dl", "dd", "menu"];
const DECLARED_LENGTH = /^-?\d*\.?\d+(px|em|rem|%|vh|vw|pt|ex|ch)$/;

export function verticalMargins(node) {
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  return { marginTop: style.marginTop, marginBottom: style.marginBottom };
}

export function isDeclaredLength(value) {
  return typeof value === "string" && DECLARED_LENGTH.test(value.trim());
}

/** Every element whose tag has a non-zero UA default vertical margin but that
 *  declares no explicit one. An empty array is the passing state. It proves a
 *  declaration EXISTS, never that the value is right. */
export function unpinnedVerticalMargins(el) {
  return [...el.querySelectorAll(UA_VERTICAL_MARGIN_TAGS.join(","))]
    .map((node) => ({ tag: node.tagName.toLowerCase(), text: (node.textContent || "").slice(0, 40), ...verticalMargins(node) }))
    .filter((row) => !isDeclaredLength(row.marginTop) || !isDeclaredLength(row.marginBottom));
}

/** The `role="group"` a node belongs to, and that group's name ("" if none). */
export function groupNameOf(node) {
  const group = node.closest('[role="group"]');
  return group ? accessibleName(group) : "";
}
