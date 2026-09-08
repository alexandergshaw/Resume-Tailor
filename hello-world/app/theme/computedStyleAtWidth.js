// The computed-cascade harness, extracted from
// `app/copilot/InterviewTypePicker.test.js` (where it was first built and
// proved) so a second test does not have to re-derive -- or worse, re-invent
// -- the trap it closes. See that file's own history for how it was found:
// the harness's own comment there called the cache bust "the trap this
// harness has to close for whoever copies it next", so copying it verbatim
// into a second file would have been self-refuting. This module exists
// instead.
//
// jsdom 29's `getComputedStyle` runs a REAL cascade: it parses every
// stylesheet in the document (emotion's included), matches selectors, computes
// specificity with `@bramus/specificity`, and resolves a tie in favour of the
// LATER rule — which is exactly the browser behaviour this measurement is
// about (`node_modules/jsdom/lib/jsdom/living/css/helpers/computed-style.js`,
// `handleProperty`).
//
// The one thing it does NOT do is evaluate media FEATURES: `evaluateMediaList`
// (`living/css/MediaList-impl.js`) returns true only for an empty list or the
// bare media types `all`/`screen`, so EVERY `@media (min-width:Npx)` block is
// skipped. That matters more than it sounds, because MUI wraps BOTH halves of
// a responsive `sx` value in one — the `xs` branch goes inside
// `@media (min-width:0px)`, not at the top level. Measure without accounting
// for that and no `sx` rule applies at all, at any width.
//
// So a width is emulated by rewriting the condition of every `min-width`
// media rule that WOULD match at that width to `all`, and leaving every
// other rule untouched. Nothing is moved or re-inserted: each rule keeps its
// position in its sheet and its selector keeps its specificity, so the
// insertion order the tie turns on stays the page's own. The rewrite is
// reverted afterwards, so these cases do not depend on each other's order.
//
// THE LIMIT, STATED ACCURATELY: `atWidth`'s regex below matches only
// `^\(min-width:\s*(\d+…)px\)$` (see the `min` line in `atWidth`). A
// `max-width` rule is left exactly as jsdom already evaluates it -- which is
// always FALSE, per `evaluateMediaList` above, whether or not it SHOULD
// match at the emulated width. That is not "evaluating as it should"; it is
// this harness having nothing to say about that rule at all. It happens not
// to matter for MUI's responsive `sx` values, because `@mui/system`'s
// `breakpoints.js` compiles every one of them through `breakpoints.up()` --
// there is no `breakpoints.down()` in that file -- so no `sx`-driven
// stylesheet rule is ever a `max-width` rule. It DOES matter for anything
// that reaches a `max-width` media query by another route: MUI's *styled*
// Dialog component emits real `max-width` rules of its own
// (`Dialog.js`'s `scroll: "body"` variants), and `useMediaQuery`-driven
// breakpoints like `down("sm")` never touch a stylesheet at all -- they are
// answered by `window.matchMedia` directly, which this harness does not
// stub. A caller measuring either of those through `atWidth` would silently
// read the pre-rewrite (always-false) value as the emulated one.
//
// THE CACHE BUST IS NOT OPTIONAL, and leaving it out is the trap this
// harness has to close for whoever copies it next. jsdom memoises one
// computed style per element (`Document-impl.js:208`'s `_styleCache`) and
// invalidates it on `insertRule`/`deleteRule`/`replace` (`CSSStyleSheet-impl.js:41`,
// `:50`, `:88`, `:115`), on a style element being parsed or removed
// (`helpers/stylesheets.js:56`, `:114`) and on node insertion
// (`Node-impl.js:243`, `:249`) — and on NOTHING ELSE. A `media.mediaText`
// write goes through `MediaList-impl.js`, which touches no cache at all, so
// the rewrite above is invisible to any element whose style has already been
// read once. That is not hypothetical: run this harness against a component
// that reads its own computed style (`TranscriptView.js:111` does) and it
// reports the pre-rewrite value as if it were the measurement — a fabricated
// failure, which is worse than no harness at all, because it costs the next
// reader a day and then their trust in the harness on the day it is right.
//
// An inserted-and-immediately-deleted empty rule is the cheap invalidation:
// two calls, no rule survives, nothing in the cascade moves. It runs after
// the rewrite AND after the restore, so no call can leave a stale entry
// behind for the next one. This module has no test file of its own -- it is
// proved indirectly, by its two consumers (`app/theme/mobileSx.test.js`,
// `app/components/FormDialog.mobile.test.js`) reading back the correct,
// post-rewrite computed value at every width they exercise.
export function bustStyleCache() {
  // Any sheet with an owner node will do — the clear is document-wide.
  // Emotion's are all `<style>` elements, so they qualify.
  const sheet = document.styleSheets[0];
  sheet.insertRule(".jsdom-cache-bust{}", sheet.cssRules.length);
  sheet.deleteRule(sheet.cssRules.length - 1);
}

// Emulates `width` for the duration of `read()`: rewrites every
// `@media (min-width:Npx)` rule whose N is <= width to `all`, busts the
// style cache, calls `read()`, then restores every rewritten rule's original
// media text and busts the cache again -- all in a `finally`, so a throwing
// `read()` still leaves the document's stylesheets exactly as it found them.
export function atWidth(width, read) {
  const restore = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // a cross-origin sheet has no cssRules; there are none here
    }
    for (const rule of rules) {
      if (rule.constructor.name !== "CSSMediaRule") continue;
      const min = /^\(min-width:\s*(\d+(?:\.\d+)?)px\)$/.exec((rule.conditionText || "").trim());
      if (!min || Number(min[1]) > width) continue;
      restore.push([rule, rule.media.mediaText]);
      rule.media.mediaText = "all";
    }
  }
  bustStyleCache();
  try {
    return read();
  } finally {
    for (const [rule, mediaText] of restore) rule.media.mediaText = mediaText;
    bustStyleCache();
  }
}
