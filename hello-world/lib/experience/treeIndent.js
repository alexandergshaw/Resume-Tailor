// Depth-indent geometry for the two places this app draws the page hierarchy:
// PageTreeItem.js's tree rows and the destination lists in MovePageDialog.js /
// BulkActionsBar.js. Pure: no React, no DOM, no I/O - the same split
// lib/experience/treeNav.js already uses for the tree's keyboard decisions.
//
// THE PROBLEM THIS EXISTS FOR. The page tree is an UNBOUNDED drill-down:
// nothing in lib/experience/tree.js limits nesting, `moveTargets` walks to
// whatever depth exists, and PageTreeItem recurses on `depth + 1` forever. A
// fixed per-level indent therefore consumes the title column without limit.
// On a 375px phone the tree pane has roughly 253px of interior to spend
// (375 - 30 for the page/main padding chain - 32 for the tab's own `p: 2`
// - 18 for the pane's border and `p: 1`), and the row spends a further ~70px
// on the chevron, the 44px selection checkbox and their gaps. At the tree's
// own 12px-per-level step the title column is gone somewhere around depth 12
// - and app/globals.css's `html { overflow-x: hidden }` means the row is
// CLIPPED rather than scrollable, so the page title is deleted, not cramped.
//
// THE RULING. Indentation is a BOUNDED affordance, not the record of depth.
// Below `sm` it stops growing after PHONE_INDENT_MAX_DEPTH levels, which puts
// a hard floor of roughly 139px under the title column at EVERY depth. The
// depth information the flattened indent stops carrying moves onto an
// explicit `aria-level` on each treeitem (PageTreeItem.js sets it; the
// assertion lives in app/components/experience/experienceTree.mobile.test.js),
// so a screen-reader user still hears "level 7" where a sighted user now sees
// the same left edge as level 4.
//
// Above `sm` the indent is deliberately UNCAPPED and identical to what each
// call site shipped with. A 280px desktop sidebar driven by a mouse has the
// same arithmetic problem in principle, but it is not the surface this pass
// measured, and flattening it would move shipped rendering for no measured
// reason. That is a known, unchanged limitation rather than an oversight.

// Levels of indent a phone will draw before the indent stops growing. Three,
// not one or two: the first three levels are where nesting actually reads as
// nesting, and three levels of the tree's own 12px step costs 36px - about
// 14% of the pane, which the title column can afford.
//
// NOT exported, deliberately. Nothing that ships needs the number - callers
// want `indentAtDepth`, which already applies it - so exporting it would
// widen this module's surface for the benefit of a test alone, which is the
// bucket lib/sourceScan/exportReachability.sweep.test.js's RULE TR-1 exists
// to keep an eye on. The tests pin the cap through `indentAtDepth`'s own
// behaviour instead, which is the property that actually matters.
const PHONE_INDENT_MAX_DEPTH = 3;

// PageTreeItem.js's row: `pl: depth * 1.5 + 0.5` in theme spacing units
// (12px per level, 4px of base gutter).
export const TREE_INDENT = { base: 0.5, step: 1.5 };

// MovePageDialog.js's and BulkActionsBar.js's destination lists:
// `pl: 2 + depth * 2` (16px per level, 16px of base gutter). A different step
// from the tree's on purpose - these rows carry a full breadcrumb path as
// their label, not a bare title.
export const MOVE_INDENT = { base: 2, step: 2 };

/**
 * The `pl` value for a row at `depth`, as a responsive `sx` object.
 *
 * BOTH branches always carry a real number. `{ xs: A, sm: undefined }` does
 * not scope A to phones - it leaves `sm` inheriting `xs`, which is the exact
 * anti-pattern app/theme/mobileSx.js's header warns about - and a NaN reaching
 * `sx` is worse still: MUI serialises it, the declaration is dropped, and the
 * row silently loses its indent with nothing failing anywhere. Hence the
 * explicit coercion below rather than trusting the caller's `depth`.
 *
 * @param {number} depth 0-based nesting depth.
 * @param {{base: number, step: number}} geometry TREE_INDENT or MOVE_INDENT.
 * @returns {{xs: number, sm: number}} theme spacing units per breakpoint.
 */
export function indentAtDepth(depth, geometry) {
  const raw = Number(depth);
  const level = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  const { base, step } = geometry;
  return {
    xs: base + Math.min(level, PHONE_INDENT_MAX_DEPTH) * step,
    sm: base + level * step,
  };
}
