// N105 Step 6 - the pure delivery rules for an Ideal result, plus the
// dark-launch gate. No I/O, no storage, no environment.
//
// An Ideal run produces two documents and a review that exists only in the
// preview. So an Ideal result is never saved to disk on the user's behalf and
// never displaces what they are looking at: this helper decides whether the
// preview should open, and nothing here ever starts a file save. The
// never-auto-save barrier is structural: this module has no save call to
// misuse.

// The dark-launch gate (K14). Slice 1 builds the whole Ideal path, but the
// review a user would see is only ever the honest "no review ran" state, so the
// Ideal stop must stay unreachable until the live reviewer is wired (Step 9)
// and N106 has landed. This is the single flip-point: Step 9 changes this value
// and retires the matching OFF-by-default test in the same change. Every
// surface that exposes the stop (the slider, a batch dialog, a later auto-tailor
// path) asks this predicate rather than deciding for itself.
const IDEAL_LEVEL_ENABLED = false;

export function idealLevelEnabled() {
  return IDEAL_LEVEL_ENABLED;
}

// Whether a finished Ideal run should open the preview on its own.
//   isOpen  a preview is already open (read from a ref, not a stale closure)
//   opts    the run's options; `skipDownload` marks runs whose caller owns
//           delivery (batch tailor-only, screenshots, library re-tailor)
//
// A single user-initiated run with nothing open opens the preview (D2). A run
// that finishes while a preview is open does not replace it, since swapping the
// document under a user mid-review would lose their place (D3). A run that
// skips delivery neither opens nor saves anything (D4).
export function shouldAutoOpenIdealPreview({ isOpen, opts } = {}) {
  if (isOpen) return false;
  if (opts && opts.skipDownload) return false;
  return true;
}
