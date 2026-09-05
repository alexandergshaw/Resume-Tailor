// Resolves R-3 (plan section 3.2.4): the settled design stated the enable gate
// and the message table two different ways (a `canCopyDocument` boolean export
// vs. a five-valued `copyState` prop). One enum, one gate, one owner: the
// dialog's ONLY call site is `copyStateFor`, and `canCopyDocument` is not a
// separate export -- it reduces to `copyState === "ready"` inside the control.
//
// Pure. No React, no DOM -- so this file, and the four-conjunct gate and the
// message tables it owns, is testable without ever rendering a component.

// AC-C10.1: available && docEntry != null && !loading && !error. The `!= null`
// conjunct -- never `docState[tab] || {}` -- is what stops "always enabled
// over a blank surface" on the very first paint of every tab: `ensureLoaded`
// runs in a PASSIVE useEffect, so the first committed frame always has
// `docState[tab]` undefined while the render site may already be showing a
// hand-edited scope's saved html. The caller MUST pass `docState[tab]`
// directly (see DocumentPreviewDialog.js's own comment at the call site).
export function copyStateFor(available, docEntry) {
  if (!available) return "unavailable";
  if (docEntry == null) return "unloaded";
  if (docEntry.loading) return "loading";
  if (docEntry.error) return "errored";
  return "ready";
}

// FIVE keys, one per copyState value, no more and no fewer (the frozen
// vocabulary) -- a four-entry map plus a `?? ""` fallback at some call site is
// exactly the shape where a future sixth state announces NOTHING. "unloaded"
// and "loading" deliberately SHARE one sentence (1c's O5): to a user looking
// at a blank first-paint frame, "not yet loaded" and "loading" are the same
// situation, and not one they can name. "ready" is the empty string -- there
// is no reason to give -- so the map stays TOTAL over the enum rather than
// needing a fallback anywhere it is read.
//
// "{scope}" is a placeholder, substituted by whichever consumer reads this map
// (disabledOutcome, below) -- these values are per-STATE, never per-scope, so
// the map does not grow when a new scope is added.
export const DISABLED_REASON = {
  unavailable: "There's no {scope} for this posting yet.",
  unloaded: "The {scope} is still loading. Try again in a moment.",
  loading: "The {scope} is still loading. Try again in a moment.",
  errored: "The {scope} preview couldn't be rendered, so there's nothing to copy.",
  ready: "",
};

// The control's click-time refusal for a non-"ready" copyState (AC-C10.4). A
// SEPARATE named export from copyOutcome below -- not folded into its union --
// because this shape has no `ok` and no `via` at all: it never reaches
// writePlainText, and it is a DIFFERENT situation from that function's own
// "unavailable" reason (no clipboard surface in this browser vs. no document
// for this posting yet), so it must never share that function's wording.
export function disabledOutcome(copyState, scopeLabel) {
  const template = DISABLED_REASON[copyState] || "";
  const message = template.replace("{scope}", String(scopeLabel ?? "").toLowerCase());
  // O5/O6/O8 (1c section 7.3): none of these carries an instruction to act on,
  // so none of them persists -- unlike a real clipboard failure (copyOutcome,
  // below), which stays on screen until the user has read it.
  return { polite: "", alert: message, visible: message, persist: false };
}

// AC-C11.2: for every outcome writePlainText can produce, plus the control's
// own blank-text refusal (`{ok:false, reason:"empty"}`, no `via` -- the copy
// was never attempted), EXACTLY ONE of polite/alert is non-empty.
export function copyOutcome(result, scopeLabel) {
  const lower = String(scopeLabel ?? "").toLowerCase();

  if (result?.ok) {
    // O1.
    const message = `${scopeLabel} text copied.`;
    return { polite: message, alert: "", visible: message, persist: false };
  }

  if (result?.reason === "empty") {
    // O7. Auto-dismisses -- there is no instruction to read.
    const message = `The ${lower} is empty — there's nothing to copy.`;
    return { polite: "", alert: message, visible: message, persist: false };
  }

  // Every remaining shape is a genuine CLIPBOARD failure (unavailable /
  // refused / editModeRefused, via copyEvent or textarea). O2's wording ("The
  // document text is selected...") and its getSelection().isCollapsed
  // auto-select seam were DEFERRED (plan section 3.6, C-4) -- O3/O4's
  // unconditional "select it yourself" wording covers every remaining case,
  // in both view and edit mode.
  //
  // Deliberately DIFFERENT from disabledOutcome's wording above: "unavailable"
  // names two unrelated situations (a browser exposing no clipboard surface at
  // all, vs. a posting with no document generated yet), and only THIS message
  // carries a manual-copy instruction, because only this failure has one to
  // give -- answering a disabled-gate refusal with this sentence would point a
  // user at document text that does not exist.
  const message = `Couldn't copy the ${lower}. Select the document text and copy it manually.`;
  return { polite: "", alert: message, visible: message, persist: true };
}
