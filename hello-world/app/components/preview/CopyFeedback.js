"use client";

// AC-C11: the result of a copy is ANNOUNCED, and no outcome is ever silent.
// `useCopyFeedback` owns the {polite, alert, visible} state, a local counter
// used only as a React `key` (never rendered), the 3 s auto-dismiss timer, the
// persist rule, and the "clear on state change" trigger; `CopyFeedbackStrip`
// renders the two live regions plus the visible chip.
//
// UX.md rev 2 section 3 / DriveActions.js's header, quoted there verbatim: "No
// long string is ever a sibling of the buttons. Every sentence, count, caption
// and link is in the strip. The bar holds <= 2 short labels." So this strip is
// a SIBLING of DialogActions (never inside it), in the slot DriveResultRegion
// already occupies -- see the DOM-order invariant at its call site in
// DocumentPreviewDialog.js.
//
// Both regions mount UNCONDITIONALLY, for the dialog's whole open lifetime:
// answerStatus.js's header records that a live region which mounts already
// carrying its final text usually is NOT announced -- only a TEXT CHANGE on an
// already-mounted region reliably is.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { visuallyHidden } from "@/lib/copilot/answerStatus";

// Matches the shipped copyEmail timer this feature retires (1c section 7.3).
const CLEAR_DELAY_MS = 3000;

const EMPTY = { polite: "", alert: "", visible: "" };

export function useCopyFeedback(clearKey) {
  const [state, setState] = useState(EMPTY);
  const [seq, setSeq] = useState(0);
  const [prevClearKey, setPrevClearKey] = useState(clearKey);
  const timerRef = useRef(null);

  function clear() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState(EMPTY);
  }

  // AC-C11.4: a byte-identical repeat must STILL mutate the DOM, so `seq`
  // bumps on every call regardless of whether the message text changed --
  // that is what turns a second "Resume text copied." into a real childList
  // mutation (a new keyed <span>) rather than a no-op text diff a screen
  // reader may not re-announce.
  function announce(outcome) {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState({ polite: outcome.polite || "", alert: outcome.alert || "", visible: outcome.visible || "" });
    setSeq((n) => n + 1);
    // 1c section 7.3: a clipboard failure PERSISTS (it carries an instruction to
    // act on); a success or a refusal without one self-clears on the same
    // timer copyEmail used.
    if (!outcome.persist) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setState(EMPTY);
      }, CLEAR_DELAY_MS);
    }
  }

  // O-3: four clear triggers (tab, mode, reloadKey, the open-reseed) collapse
  // into ONE key change, so a stale "Resume text copied." can never outlive
  // the document it described. The STATE reset happens DURING RENDER -- the
  // same idiom DocumentPreviewDialog.js's own open/reloadKey reseeds already
  // use -- never inside an effect (react-hooks/set-state-in-effect flags a
  // synchronous setState there). Render phase may not touch a ref either
  // (react-hooks/refs), so the pending TIMER is stopped separately, by the
  // keyed effect below -- one concern each, since a leftover timeout is
  // harmless here (it would only re-set the already-empty state).
  if (clearKey !== prevClearKey) {
    setPrevClearKey(clearKey);
    setState(EMPTY);
  }

  // Stops whatever timer `announce()` may have started, whenever the SAME key
  // changes again (the cleanup for the PREVIOUS key's effect) or on unmount.
  // No `setState` call here -- only the ref-owning side effect, which is
  // exactly what an effect is for.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [clearKey]);

  return { announce, clear, regionProps: { ...state, seq } };
}

// AC-C11.5: an empty region renders `null`, NEVER `<span key={seq}>{""}</span>`
// -- an empty span still exists either way, and an empty text node is not an
// announcement; writing one would make the whole "every outcome is announced"
// property vacuous while a mutation-count assertion stayed green regardless.
//
// `data-copy-status` on each always-mounted region (not the inner keyed span,
// which comes and goes): this dialog already has a FIRST `[role="status"]` and
// `[role="alert"]` belonging to DriveResultRegion (mounted above this strip,
// by the DOM-order invariant), so `role`/`aria-live` alone cannot select these.
// Repo precedent for the attribute: `data-testid="scope-error"`/`"scope-notice"`
// in DocumentPreviewDialog.js, queried the same way by its drive suite.
export function CopyFeedbackStrip({ polite, alert, visible, seq }) {
  return (
    <>
      <Box component="span" role="status" aria-live="polite" data-copy-status="polite" sx={visuallyHidden}>
        {polite ? <span key={seq}>{polite}</span> : null}
      </Box>
      <Box component="span" role="alert" data-copy-status="alert" sx={visuallyHidden}>
        {alert ? <span key={seq}>{alert}</span> : null}
      </Box>
      <Box
        data-copy-status="chip"
        sx={{
          fontSize: "0.8rem",
          textAlign: "right",
          minHeight: "20px",
          color: alert ? "var(--danger)" : "var(--success)",
          opacity: visible ? 1 : 0,
          transition: "opacity 180ms",
        }}
      >
        {visible ? <span key={seq}>{visible}</span> : null}
      </Box>
    </>
  );
}
