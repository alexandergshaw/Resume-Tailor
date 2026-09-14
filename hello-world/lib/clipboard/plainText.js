// The single write path for "copy the document text" (AC-C9). NOTHING else
// lives in this file.
//
// A UNION of three mechanisms, tried in order, because no single one works
// everywhere: the async Clipboard API is spec'd but requires a secure context
// and can reject when the document isn't focused; `execCommand("copy")` inside
// a `copy` listener is spec'd (W3C Clipboard API section 8.1) and works on
// Chrome/Edge/Firefox and Safari >= 18.4, but on older Safari/WKWebView
// `execCommand("copy")` required an EXISTING selection and could return `true`
// while the listener never ran (WebKit bug 156529, fixed Jan 2025); an
// off-screen textarea works there precisely because `.select()` creates that
// selection. The textarea path is fenced to view mode only -- `.select()`
// TAKES FOCUS, and in edit mode that focus loss runs the contentEditable's
// onBlur -> commitDraft -> onSave -> saveDocumentPreview, which flips `edited`
// with no dirty check. That is AC-C4's harm arriving through AC-C9's own door.
//
// The exact six-row return union (frozen, plan section 3.1's "FROZEN VOCABULARY"):
//
//   {ok:true,  via:"async"}
//   {ok:true,  via:"copyEvent"}
//   {ok:true,  via:"textarea"}
//   {ok:false, via:"copyEvent", reason:"unavailable"}
//   {ok:false, via:"textarea",  reason:"unavailable"}
//   {ok:false, via:"textarea",  reason:"refused"}
//   {ok:false, via:"textarea",  reason:"editModeRefused"}
//
// FOUR `reason` literals, never five: "unavailable" | "refused" |
// "editModeRefused". A fifth, "inert" (execCommand returned `true` but the
// `copy` listener never ran), is internal to step 2's branch table below and
// is NEVER returned -- it falls through to step 3, whose own reason the
// caller sees instead. Exporting it would invite a consumer to branch on a
// value nothing ever produces.
//
// HTML flavour (AC-C7 amendment): an optional `html` string adds a
// `text/html` flavour alongside `text/plain`, so pasting into Word or Google
// Docs keeps the document's formatting while every plain-text target
// (including an ATS form) still receives the identical flattened string.
// `navigator.clipboard.write` (the ClipboardItem API) is STILL NEVER used --
// that half of AC-C7 is unchanged. The rich flavour rides the SAME
// `copy`-event `DataTransfer` the plain flavour already writes to, via a
// second `setData` call.
//
// ORDERING, load-bearing: step 1 (the async clipboard) is plain-only and,
// where it works, wins the race before the `copy` event ever fires -- so
// appending `text/html` to step 2 without reordering would ship an `html`
// argument no browser ever sees. So: when `html` is supplied, step 2 is
// attempted FIRST, with step 1 kept as a plain-only fallback and step 3 as
// the final one. No `html` supplied (omitted, or an empty string) takes the
// ORIGINAL order -- step 1, then step 2, then step 3 -- byte-for-byte
// unchanged, which is what keeps every branch test written against that
// order valid without modification.
//
// The vocabulary above carries NO new member for "html did not make it": the
// existing `via` already answers that question, because `via:"copyEvent"` is
// the only channel that can ever carry `text/html` at all. A caller that
// asked for `html` and got `via:"async"` or `via:"textarea"` back knows the
// rich flavour did not land -- the plain flavour did, from the identical
// string, byte for byte, because `text` is written on every path regardless
// of `html`. A fourth success shape (an `{ok:true, via:"copyEvent",
// html:false}` sort of thing) would let a consumer branch on a fact the
// existing shape already encodes, for no reduction in ambiguity.
//
// Never throws, never rejects -- proved by SHAPE, not by a comment: step 3
// repeats step 2's guard as its own first statement (M3), so the "never
// throws" contract holds independently of how step 2's one `return` (among
// otherwise-uniform fall-throughs) is read, and the whole of step 3's body is
// wrapped in try/catch/finally.
//
// The default parameters (`navigator = globalThis.navigator`,
// `document = globalThis.document`) are LOAD-BEARING: the acceptance suites
// install stubs on these real globals rather than injecting a `deps` prop,
// because an 8th prop the shipped control never receives would leave this
// exact line -- the one that decides whether the app can reach a clipboard at
// all -- covered only by this file's own node-environment fakes.
export async function writePlainText(text, { navigator = globalThis.navigator, document = globalThis.document, mode = "view", html } = {}) {
  const str = String(text ?? "");
  const richHtml = typeof html === "string" && html.length > 0 ? html : null;

  if (richHtml) {
    // The reordered union: copy-event first (the only channel that can carry
    // `richHtml`), then the two plain-only fallbacks in their usual order.
    const viaCopyEvent = attemptCopyEvent(document, str, richHtml);
    if (viaCopyEvent?.ok) return viaCopyEvent;
    const viaAsync = await attemptAsync(navigator, str);
    if (viaAsync) return viaAsync;
    return attemptTextarea(document, str, mode);
  }

  // The original union, untouched: async, then copy-event, then textarea.
  const viaAsync = await attemptAsync(navigator, str);
  if (viaAsync) return viaAsync;

  const viaCopyEvent = attemptCopyEvent(document, str, null);
  if (viaCopyEvent) return viaCopyEvent;

  return attemptTextarea(document, str, mode);
}

// 1 -- async clipboard, plain-only always (there is no ClipboardItem path
// here -- AC-C7). On rejection we fall through (return undefined): a rejected
// writeText copied nothing, so there is no double-write risk, and the
// commonest rejection ("document is not focused") is exactly where a
// user-gesture path -- the copy-event/textarea union below -- still works.
async function attemptAsync(navigator, str) {
  if (typeof navigator?.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(str);
      return { ok: true, via: "async" };
    } catch {
      /* fall through to the copy-event / textarea union */
    }
  }
  return undefined;
}

// 2 -- copy-event. THE ONLY branch in this whole function that returns a
// DEFINITE ok:false instead of falling through (return undefined) --
// everything else here does. `html`, when supplied, is set FIRST as its own
// nested attempt so a rich-flavour failure (an unsupported or rejected
// text/html write) can never cost the plain flavour or the preventDefault()
// that follows it.
function attemptCopyEvent(document, str, html) {
  if (typeof document?.execCommand !== "function") {
    return { ok: false, via: "copyEvent", reason: "unavailable" };
  }

  let ran = false;
  let setOk = false;
  const onCopy = (e) => {
    ran = true;
    try {
      // clipboardData can be null on some platforms -- caught below, setOk
      // stays false and the branch is reported as a failure.
      e.clipboardData.setData("text/plain", str);
      if (html) {
        try {
          e.clipboardData.setData("text/html", html);
        } catch {
          /* the plain flavour above already landed; only the rich one is lost */
        }
      }
      // LOAD-BEARING: omit this and the spec copies the current SELECTION
      // instead of the data just set -- and in this dialog the selection can
      // include DriveResultRegion's two visuallyHidden (clip-rect, so still
      // selectable) regions, landing "Saved 2 documents to Drive" in an ATS
      // resume field.
      e.preventDefault();
      setOk = true;
    } catch {
      /* setOk stays false */
    }
  };
  try {
    document.addEventListener("copy", onCopy);
    const returned = document.execCommand("copy");
    // Success is VERIFIED, never inferred: `returned === true` AND the
    // listener ran AND setData did not throw. Every other outcome here --
    // `returned` false, or the listener never ran at all ("inert": the
    // WebKit-< 18.4 case above) -- falls through (returns undefined), and the
    // caller decides what runs next.
    if (returned === true && ran && setOk) return { ok: true, via: "copyEvent" };
  } catch {
    /* falls through */
  } finally {
    // ALWAYS -- NEVER {once:true}. With {once:true} and the inert branch the
    // listener stays attached to `document` for the rest of the session; the
    // user's next real Ctrl+C -- on a phrase they deliberately selected in the
    // preview -- hits it, calls preventDefault(), and writes the WHOLE
    // DOCUMENT to their clipboard instead of what they selected.
    document.removeEventListener("copy", onCopy);
  }
  return undefined;
}

// 3 -- textarea, VIEW MODE ONLY, plain-only always. Hardened over
// ChatPanel.js's copy-message fallback, the only prior art for this branch in
// the repo: that version has no `finally` (a throwing execCommand leaves the
// node in the DOM forever), appends visibly at the end of <body> (so
// `.select()` scrolls the page), carries no `readOnly` (pops the keyboard on
// iOS), has no selection/focus save-restore, and infers success from a
// discarded execCommand return. All five are fixed here.
//
// M3: this repeats step 2's guard as its OWN first statement -- redundant
// against a correct step 2, and that redundancy is the point: the
// "never throws" contract then holds by SHAPE (nothing below can ever call
// `undefined(...)`), not by how step 2's lone `return` happens to be read.
function attemptTextarea(document, str, mode) {
  if (typeof document?.execCommand !== "function") {
    return { ok: false, via: "textarea", reason: "unavailable" };
  }
  // AC-C4/AC-C9.1: never in edit mode. `.select()` TAKES FOCUS, and the
  // contentEditable's onBlur runs commitDraft -> onSave -> saveDocumentPreview,
  // which flips `edited` with no dirty check -- AC-C4's harm arriving through
  // AC-C9's own door. This fence lives HERE, inside step 3, and never before
  // step 2: hoisting it above step 2 would silently disable the copy-event
  // path (which touches neither focus nor selection) in edit mode too, on
  // every insecure-context origin and every pre-18.4 Safari. It also never
  // depends on whether an `html` argument was supplied to step 2 -- a rich
  // copy in edit mode is exactly as fenced as a plain one.
  if (mode === "edit") {
    return { ok: false, via: "textarea", reason: "editModeRefused" };
  }

  let node = null;
  // M4: neither hardening captured here has a failable row in jsdom (measured
  // -- `.select()` there never moves `document.activeElement` off <body> and
  // never touches the document selection), so this is correct-in-a-real-
  // browser, code-review-only, and MC-2b (a manual check) is the one place a
  // human can observe it at all. Captured defensively so a throwing
  // `getSelection`/`activeElement` read can never escape this function.
  let priorActiveElement = null;
  let selection = null;
  let priorRange = null;
  try {
    priorActiveElement = document.activeElement || null;
    selection = typeof document.getSelection === "function" ? document.getSelection() : document.defaultView?.getSelection?.();
    priorRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  } catch {
    /* best-effort snapshot only */
  }

  try {
    node = document.createElement("textarea");
    node.value = str;
    node.readOnly = true; // never a virtual keyboard for a node the user can't see
    // Off-screen, never display:none/visibility:hidden -- both make the text
    // UNSELECTABLE, so execCommand would copy nothing. Never visible at the
    // end of <body> either (ChatPanel's version does that, and `.select()`
    // scrolls the page to it).
    node.style.position = "fixed";
    node.style.left = "-9999px";
    node.style.top = "0";
    document.body.appendChild(node);
    node.select();
    const returned = document.execCommand("copy");
    if (returned === true) return { ok: true, via: "textarea" };
    return { ok: false, via: "textarea", reason: "refused" };
  } catch {
    return { ok: false, via: "textarea", reason: "refused" };
  } finally {
    // The node is removed even when execCommand throws -- a `finally` alone
    // does not stop the throw, it only guarantees this cleanup runs on the
    // way out.
    node?.remove();
    try {
      if (selection && priorRange) {
        selection.removeAllRanges();
        selection.addRange(priorRange);
      }
      if (priorActiveElement && typeof priorActiveElement.focus === "function" && document.activeElement !== priorActiveElement) {
        priorActiveElement.focus();
      }
    } catch {
      /* best-effort restoration only -- see the M4 note above */
    }
  }
}
