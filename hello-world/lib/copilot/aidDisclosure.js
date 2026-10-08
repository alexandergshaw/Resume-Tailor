// The two PURE rules behind the answer-area disclosure (N144a): which stored
// values count as a choice, and whether a section is open once the viewport is
// known. React-free, like the rest of lib/copilot/, so they run in the repo's
// default node environment; the component that applies them is
// app/copilot/CollapsibleAid.js, and the store they read is the
// lib/copilot/choiceStore.js factory (the same normalize / store split as
// codeLanguages.js and useCodeLanguage.js).
//
// A section's remembered choice is `"open"`, `"closed"` or `null`. `null` is
// ABSENCE ("the person has not chosen"), never a third visible state, and
// nothing in the app writes it back: a mount stores nothing, a tap stores the
// opposite of what is on screen. That is what lets a later release change the
// phone default without migrating anything already stored.

// The store's `normalize`, hoisted so every section's store agrees on what a
// stored value is. Anything but the two literal strings (a retired, cased,
// hand-edited or wrong-typed value) reads as "not chosen".
export function normalizeAidChoice(value) {
  return value === "open" || value === "closed" ? value : null;
}

// Whether a section is open. A stored choice always wins. With none stored the
// breakpoint decides: from 600px up (`isMobile` false) every section is open,
// below it a section follows `defaultOpenOnMobile`.
//
// ONE object parameter on purpose. `isMobile` and `defaultOpenOnMobile` are
// both booleans, and a positional signature lets a swapped call type-check
// while silently inverting the rule on exactly the phone breakpoint. Do not add
// a default for the parameter: it would also change `.length`, which a test pins.
export function resolveAidOpen({ choice, isMobile, defaultOpenOnMobile }) {
  if (choice === "open") return true;
  if (choice === "closed") return false;
  return isMobile ? Boolean(defaultOpenOnMobile) : true;
}
