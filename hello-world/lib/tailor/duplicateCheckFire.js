// Safely invokes an opaque duplicate-application-check callback that a hook
// receives as a PROP it did not author, so a throwing implementation can
// never turn a successful (already in-flight, sometimes already paid-for)
// tailoring call into a reported failure. This is the exact guarantee
// app/hooks/useManualTailor.js's own inline try/catch gives its E4/E6 fire
// point (3-plan-dupapply.md §2.9, §4 A-1) for the same reason: unlike
// app/page.js's three direct handlers -- which call dupeApply.runDuplicateCheck
// itself and trust its own internal guard -- a hook file receiving this as a
// prop cannot know the caller's implementation never throws.
//
// Pulled out into its own file, rather than inlined a second time in
// app/hooks/useDocumentPreview.js the way useManualTailor.js inlines it, only
// because that hook has no line budget left (lib/drive/lineCeiling.test.js
// pins it under 935 lines with a single line of margin) -- not because the
// shape differs.
export function fireDuplicateCheckSafely(onCheckDuplicate, candidate, ctx) {
  if (typeof onCheckDuplicate !== "function") return;
  try {
    onCheckDuplicate(candidate, ctx);
  } catch {
    // Defense in depth only -- see the comment above.
  }
}
