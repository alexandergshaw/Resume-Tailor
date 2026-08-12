"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import MarkdownPreview from "./MarkdownPreview";

const AUTOSAVE_DELAY_MS = 800;

// Sends a still-pending (scheduled but never sent) debounced save through
// the onChange it was scheduled against, then clears the pending markers.
// This exists so a page switch or an unmount does not silently discard up
// to AUTOSAVE_DELAY_MS of typed text that was only ever scheduled, never
// sent - the effects below call this before they reset state or tear down.
// Refs are passed in explicitly (rather than closing over component-scoped
// values) because this function is called from render closures that may be
// stale (an unmount cleanup captured at mount time, for instance) - reading
// through refs at call time, not at closure-creation time, is what makes
// that safe. `pendingFlushRef` was populated by scheduleSave with the
// onChange the pending text actually belongs to (the page being edited when
// the user last typed), which matters because by the time this runs after a
// page switch, the component's current `onChange` prop already points at
// the NEW page - using it here would silently misfile the old page's text
// under the new page's id instead of just losing it.
function flushPendingSave(pendingFlushRef, timerRef, latestRef) {
  const pending = pendingFlushRef.current;
  if (!pending) return;
  pendingFlushRef.current = null;
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  const result = pending.onChange({ ...latestRef.current });
  // The flushed save has nowhere left to report a failure to (this
  // component may already be unmounted, or showing a different page's
  // editor) - swallow a rejection rather than let it surface as an
  // unhandled promise rejection. A guard first: onChange "may return a
  // promise", not must.
  if (result && typeof result.catch === "function") result.catch(() => {});
}

// <PageEditor page={row} onChange={fn} onAskAi={fn} /> - the fixed contract
// from chunk 1, extended (see this feature's own header) with `onAskAi`:
// called with the CURRENT on-screen { title, body } - not the possibly-stale
// `page` prop - so a press of Ask AI always pins exactly what the user sees,
// including an edit still sitting in the 800ms autosave debounce window.
// `row` is an experience_pages row ({ id, title, body, ... }); `onChange`
// takes a partial { title?, body? } and may return a promise.
//
// `onAskAi` is called directly, never `onAskAi?.(...)`: this app has shipped
// a callback prop that was never threaded from its owner before, twice, and
// both times an optional-chained call was what let it stay silently inert.
// A caller that renders this component without wiring `onAskAi` gets a loud
// failure the moment Ask AI is pressed, not a button that quietly does
// nothing.
export default function PageEditor({ page, onChange, onAskAi }) {
  const pageId = page?.id ?? null;

  const [mode, setMode] = useState("edit");
  const [title, setTitle] = useState(page?.title || "");
  const [body, setBody] = useState(page?.body || "");
  const [error, setError] = useState(null);
  // { text, seq } rather than just `text`: `seq` guarantees the state
  // object is always a fresh reference, which is cheap and harmless even
  // though nothing currently depends on it for correctness - see
  // performSave below for why two consecutive announcements can no longer
  // carry the same text at all, which is what makes that guarantee enough
  // on its own without also needing to force the rendered STRING to differ.
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });

  const timerRef = useRef(null);
  const latestRef = useRef({ title: page?.title || "", body: page?.body || "" });
  const pendingRef = useRef(null);
  // { pageId, onChange } for a save that scheduleSave has debounced but that
  // has not fired yet - set at schedule time (so it captures the onChange
  // the text was actually typed against) and read by flushPendingSave. null
  // whenever nothing is currently scheduled.
  const pendingFlushRef = useRef(null);

  // Loading a different page replaces local editing state outright. Keyed on
  // pageId alone (not on page.title/page.body) on purpose: onChange's own
  // updates can flow back into `page` from the parent, and keying on the
  // row's content as well would re-run this reset after our own save and
  // could stomp an in-flight edit. This also clears refs (timerRef,
  // latestRef), which rules out the render-time "adjust state" pattern -
  // this codebase's react-hooks/refs rule forbids touching a ref's .current
  // during render, so the reset has to live in an effect.
  //
  // Flushing happens FIRST, before any of that reset: a save scheduled
  // against the page we are leaving must go out under that page's own id,
  // using the text as it stood the instant before this effect starts
  // overwriting latestRef with the NEW page's content.
  useEffect(() => {
    flushPendingSave(pendingFlushRef, timerRef, latestRef);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(page?.title || "");
    setBody(page?.body || "");
    latestRef.current = { title: page?.title || "", body: page?.body || "" };
    setError(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // Flush any pending debounced save if the component unmounts mid-wait,
  // rather than just cancelling it - app/page.js mounts this whole tab
  // conditionally, so switching main tabs unmounts PageEditor outright, and
  // a cancel-only cleanup here would drop the same typed text a page-switch
  // would.
  useEffect(() => {
    return () => {
      flushPendingSave(pendingFlushRef, timerRef, latestRef);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function announce(text) {
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));
  }

  async function performSave(payload) {
    pendingRef.current = payload;
    // flushSync forces the "Saving" announcement to commit to the DOM on its
    // own, right now, before we await onChange. Without this, a save that
    // resolves inside the same microtask window has its "Saving" and
    // "Saved" state updates coalesced into a single React commit - only the
    // final value is ever painted. On the second of two clean, back-to-back
    // saves that final value is "Saved" twice in a row with the SAME text,
    // so React's reconciler bails and nothing reaches the DOM at all: a
    // screen reader hears nothing for that save. Flushing "Saving"
    // synchronously guarantees a real, distinct mutation happens first,
    // and it also means a genuinely slow save shows "Saving" instead of
    // jumping straight to the result.
    flushSync(() => {
      setError(null);
      announce("Saving");
    });
    try {
      await onChange(payload);
      pendingRef.current = null;
      announce("Saved");
    } catch (err) {
      // The save failed; the user's text is untouched (local state was never
      // reverted), and the error persists until Retry succeeds. The status
      // region must not go on claiming a save is still in flight once it
      // has definitively failed - "Saving" left standing forever actively
      // asserts something false, which is worse than announcing nothing.
      setError((err && err.message) || "Could not save your changes.");
      announce("Save failed");
    }
  }

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingFlushRef.current = { pageId, onChange };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingFlushRef.current = null;
      performSave({ ...latestRef.current });
    }, AUTOSAVE_DELAY_MS);
  }

  function handleTitleChange(event) {
    const next = event.target.value;
    setTitle(next);
    latestRef.current = { ...latestRef.current, title: next };
    scheduleSave();
  }

  function handleBodyChange(event) {
    const next = event.target.value;
    setBody(next);
    latestRef.current = { ...latestRef.current, body: next };
    scheduleSave();
  }

  function handleRetry() {
    if (pendingRef.current) performSave(pendingRef.current);
  }

  // The whole point of "Ask AI": one press, no dialog, no confirmation -
  // pins the CURRENT title/body (local state, which may be ahead of the
  // last-saved `page` prop by up to the debounce window) and lets the
  // caller do the rest (breadcrumb, child pages, attachments - none of
  // which this component owns). See this file's own header for why this is
  // a hard call rather than `onAskAi?.(...)`.
  function handleAskAi() {
    onAskAi({ title, body });
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: 1 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
        <Button
          aria-pressed={mode === "edit"}
          variant={mode === "edit" ? "contained" : "outlined"}
          size="small"
          disableElevation
          onClick={() => setMode("edit")}
          sx={{ textTransform: "none", borderRadius: 1.5 }}
        >
          Edit
        </Button>
        <Button
          aria-pressed={mode === "preview"}
          variant={mode === "preview" ? "contained" : "outlined"}
          size="small"
          disableElevation
          onClick={() => setMode("preview")}
          sx={{ textTransform: "none", borderRadius: 1.5 }}
        >
          Preview
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          size="small"
          disableElevation
          onClick={handleAskAi}
          sx={{ textTransform: "none", borderRadius: 1.5 }}
        >
          Ask AI
        </Button>
        <Box
          component="span"
          role="status"
          aria-live="polite"
          sx={{ fontSize: 12.5, color: "text.secondary", minWidth: 48, textAlign: "right" }}
        >
          {/* No distinctness trick needed here (an earlier version appended
              an invisible toggle character to force consecutive identical
              announcements to differ - see PageEditor.test.js's history).
              The invariant that makes it unnecessary: performSave ALWAYS
              announces "Saving" first, via flushSync, then either "Saved"
              or "Save failed" - so every announcement is preceded by a
              DIFFERENT one, and two consecutive identical values can never
              occur through any production path. If a future change breaks
              that alternation (e.g. a retry path that announces "Saving"
              twice in a row with nothing in between), the test in
              PageEditor.test.js asserting this invariant will fail. */}
          {announcement.text}
        </Box>
      </Stack>

      {error ? (
        <Alert
          severity="error"
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={handleRetry} sx={{ textTransform: "none" }}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      <TextField label="Title" value={title} onChange={handleTitleChange} fullWidth size="small" sx={{ mb: 1.5 }} />

      {mode === "edit" ? (
        <TextField
          label="Body"
          value={body}
          onChange={handleBodyChange}
          multiline
          minRows={12}
          fullWidth
          helperText="Markdown: headings with #, lists with - or 1., **bold**, *italic*, `code`, > quotes, [links](https://…)"
          // No onKeyDown here, deliberately: the native <textarea> already
          // moves focus on Tab. Intercepting it to insert a tab character
          // would trap keyboard users inside the field.
        />
      ) : (
        // Switching modes swaps the ENTIRE content area for this, while
        // focus stays on the Preview button - aria-pressed there only
        // partially covers that. role="region" plus a name distinct from
        // the button's own "Preview" label lets assistive tech announce
        // that the content underneath just changed, and to what.
        <Box
          role="region"
          aria-label="Markdown preview"
          sx={{ p: 2, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 1, flexGrow: 1, overflowY: "auto" }}
        >
          <MarkdownPreview markdown={body} />
        </Box>
      )}
    </Box>
  );
}
