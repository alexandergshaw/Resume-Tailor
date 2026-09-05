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
export async function writePlainText(text, { navigator = globalThis.navigator, document = globalThis.document, mode = "view" } = {}) {
  const str = String(text ?? "");

  // 1 -- async clipboard. On rejection we fall through: a rejected writeText
  // copied nothing, so there is no double-write risk, and the commonest
  // rejection ("document is not focused") is exactly where a user-gesture
  // path -- the copy-event/textarea union below -- still works.
  if (typeof navigator?.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(str);
      return { ok: true, via: "async" };
    } catch {
      /* fall through to the copy-event / textarea union */
    }
  }

  // 2 -- copy-event. THE ONLY branch in this whole function that returns
  // instead of falling through to step 3 -- everything else here does.
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
    // WebKit-< 18.4 case above) -- falls through to step 3, which decides its
    // own final reason independently of why step 2 failed.
    if (returned === true && ran && setOk) return { ok: true, via: "copyEvent" };
  } catch {
    /* falls through to step 3 */
  } finally {
    // ALWAYS -- NEVER {once:true}. With {once:true} and the inert branch the
    // listener stays attached to `document` for the rest of the session; the
    // user's next real Ctrl+C -- on a phrase they deliberately selected in the
    // preview -- hits it, calls preventDefault(), and writes the WHOLE
    // DOCUMENT to their clipboard instead of what they selected.
    document.removeEventListener("copy", onCopy);
  }

  // 3 -- textarea, VIEW MODE ONLY. Hardened over ChatPanel.js's copy-message
  // fallback, the only prior art for this branch in the repo: that version
  // has no `finally` (a throwing execCommand leaves the node in the DOM
  // forever), appends visibly at the end of <body> (so `.select()` scrolls
  // the page), carries no `readOnly` (pops the keyboard on iOS), has no
  // selection/focus save-restore, and infers success from a discarded
  // execCommand return. All five are fixed here.
  //
  // M3: this repeats step 2's guard as its OWN first statement -- redundant
  // against a correct step 2, and that redundancy is the point: the
  // "never throws" contract then holds by SHAPE (nothing below can ever call
  // `undefined(...)`), not by how step 2's lone `return` happens to be read.
  if (typeof document?.execCommand !== "function") {
    return { ok: false, via: "textarea", reason: "unavailable" };
  }
  // AC-C4/AC-C9.1: never in edit mode. `.select()` TAKES FOCUS, and the
  // contentEditable's onBlur runs commitDraft -> onSave -> saveDocumentPreview,
  // which flips `edited` with no dirty check -- AC-C4's harm arriving through
  // AC-C9's own door. This fence lives HERE, inside step 3, and never before
  // step 2: hoisting it above step 2 would silently disable the copy-event
  // path (which touches neither focus nor selection) in edit mode too, on
  // every insecure-context origin and every pre-18.4 Safari.
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
