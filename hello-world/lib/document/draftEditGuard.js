// The "nothing to commit" guard DocumentPreviewDialog's commitDraft uses
// (N35 fix round, B2/B3 in verify.r1.md). Extracted out of that file rather
// than inlined -- DocumentPreviewDialog.js has ~1 line of headroom under its
// own 980-line ratchet, and this guard needs its own explanation.
//
// A draft is a no-op only when the editor's CURRENT text AND html both equal
// what the editor was last SEEDED with. Comparing text alone (the old guard)
// missed two real cases:
//
//   B2 -- the old guard compared against the STORED scope text
//   (`coverLetterResultLines.join("\n")`), not against what the editor
//   actually rendered. A freshly parsed engine .docx inserts blank
//   paragraphs the stored line array never had, so a real cover letter's
//   `innerText` and its stored text differ even with nothing typed --
//   measured at 15 rendered lines against 8 stored. Comparing the editor's
//   CURRENT value against its OWN seed (captured right after `innerHTML`
//   was assigned, so both sides went through the same browser
//   normalisation) is self-consistent no matter what produced the seed.
//
//   B3 -- Bold/italic/underline/align/font-size all change `innerHTML` and
//   leave `innerText` unchanged, so a text-only comparison silently drops
//   every formatting-only edit. Requiring BOTH to match before calling the
//   draft unchanged means a format-only edit (same text, different html) is
//   still committed.
//
// `seeds` is a plain `{ [scope]: {text, html} }` map (DocumentPreviewDialog's
// own `seedRef.current`), mutated here on every call so the seed always
// tracks the LAST COMMIT, not just the state the editor was first seeded
// with -- without that, typing (which auto-saves after 600ms) followed by a
// blur with nothing further typed would compare against the stale pre-edit
// seed and fire a second, redundant `onSave` for content that was already
// saved. `seeds[scope]` is undefined only before the editor has ever been
// seeded for that scope (defensive -- the seeding effect sets it in the same
// tick it sets `innerHTML`); treated as "changed" rather than risk silently
// dropping a real edit.
export function commitDraftSeed(seeds, scope, text, html) {
  const seed = seeds[scope];
  const unchanged = !!seed && seed.text === text && seed.html === html;
  seeds[scope] = { text, html };
  return unchanged;
}
