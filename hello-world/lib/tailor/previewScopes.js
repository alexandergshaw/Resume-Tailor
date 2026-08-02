// Pure rules behind the preview modal's per-document concurrency. Extracted
// out of the React hook/component that use them so the invariants they
// encode — which scopes an operation locks, how per-scope flags merge, and
// which scopes actually changed content — can be unit-tested directly,
// without mounting React. No React imports, no side effects.

// Which scope(s) an operation touches. A focus change re-tailors with a
// pinned library focus area, and that regenerates BOTH documents (they share
// the wrong focus); any other revise only touches the one document being
// revised. This drives both the re-entrancy guard (AC-5) and the
// busy/notice/error scoping in useDocumentPreview — get it wrong and either
// an unrelated document's controls lock up, or a concurrent write to the
// other document goes unguarded.
export function lockScopesFor(scope, focusChange) {
  const applyCover = scope === "cover" && !focusChange;
  return focusChange ? ["resume", "cover"] : [applyCover ? "cover" : "resume"];
}

// Pure reducer behind setScopeFlags: merges a busy/notice/error patch into
// the per-scope ({ resume, cover }) flag maps on the resumePreview state,
// touching only the listed scopes. This is what lets two overlapping
// operations finishing out of order each update only their own scope's
// flags — the first to finish must never re-enable or clear the other
// scope's controls (AC-4). Always returns a new object and never mutates
// `prev` or its nested per-key objects, so it's safe to use as a React state
// updater.
export function applyScopeFlags(prev, scopes, patch) {
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const next = { ...prev };
  for (const key of ["busy", "notice", "error"]) {
    if (!(key in patch)) continue;
    const scopeValues = { ...prev[key] };
    for (const scope of list) scopeValues[scope] = patch[key];
    next[key] = scopeValues;
  }
  return next;
}

// Which scopes' content signature actually changed between two snapshots.
// The dialog uses this on a reloadKey bump (from a revise, focus change, or
// research weave) to tell WHICH scope(s) got new content — the shared
// counter alone doesn't carry that. Only a scope whose signature really
// differs should have its cached render/draft dropped; a revise on the
// other document must leave this one's cache, draft, and edit mode
// untouched (AC-2).
export function changedScopes(prevSigs, nextSigs, scopes) {
  return scopes.filter((scope) => nextSigs[scope] !== prevSigs[scope]);
}
