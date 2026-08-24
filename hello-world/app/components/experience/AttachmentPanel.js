"use client";

// Chunk 4 — attachments on a project page: files, images and video. Lists
// what's already uploaded (with an inline thumbnail/player for image/video
// kinds, using the short-lived signed URL the GET route mints), a real file
// input to add another, and a per-attachment notes field the AI reads.
//
// Drag-and-drop is layered on TOP of the real <input type="file"> below, not
// instead of it — a drag-only upload zone is unreachable by keyboard.

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import TableChartIcon from "@mui/icons-material/TableChart";
import { classifyAttachment } from "../../../lib/experience/attachments";
import { createClient } from "../../../lib/supabase/client";
import { downloadAttachmentBlob } from "../../../lib/supabase/experienceAttachments";
import { triggerBlobDownload } from "../../../lib/document/docx";

const KIND_LABEL = {
  image: "Image",
  pdf: "PDF",
  video: "Video",
  text: "Text",
  slides: "Slides",
  sheet: "Spreadsheet",
  other: "File",
};

// How long a deletion stays reversible before its DELETE actually goes
// out - see scheduleDelete/finalizeDelete below. The product decision this
// implements (see this file's own header: drag-and-drop is layered ON TOP
// of a real control, never instead of it - this is the same "minimize
// clicks without losing the safety net" instinct applied to deletion) was
// explicitly NOT a confirmation dialog: a dialog taxes the common,
// correct, single-file case to guard a rarer slip. Exported so the test
// file can advance fake timers by the exact same value instead of a
// second, possibly-drifting copy of "5000".
export const UNDO_WINDOW_MS = 5000;

// Built explicitly rather than typed as a literal character in source, for
// the same reason PageEditor.js's own ANNOUNCE_TOGGLE is: an invisible
// unicode character embedded directly in a source file is easy to lose or
// mis-copy in an edit.
const ANNOUNCE_TOGGLE = String.fromCodePoint(0x200b);

// { text, seq } rather than a plain string — reusing PageEditor.js's own
// pattern for this exact problem rather than inventing a fourth variant of
// it (the save-status region and the move-failure alert already carry it).
// React bails out of a setState whose new value is Object.is-equal to what
// is already there, so the SAME rejection reason announced twice in a row —
// the expected shape of a retry, since onInputChange deliberately clears
// the file input so the identical file can be re-picked — would otherwise
// reach a screen reader only once. A fresh object every call defeats that
// bailout (a new object is never Object.is-equal to the last one); the
// toggled trailing character is what then makes the rendered TEXT itself
// differ between two consecutive identical messages, which is what an
// aria-live/role=alert region's listener actually has to observe to
// re-announce — an unchanged text node is left untouched by React's own
// reconciler even once the surrounding state object is new.
function bumpAnnouncement(prevSeq, text) {
  return { text, seq: (prevSeq ?? 0) + 1 };
}

function announcedText(entry) {
  if (!entry || !entry.text) return "";
  return entry.seq % 2 === 1 ? `${entry.text}${ANNOUNCE_TOGGLE}` : entry.text;
}

// notesErrors/deleteErrors are keyed maps, and both clear an id's entry
// outright (delete the key) at the start of a retry, before knowing whether
// the retry will fail again — unlike uploadError's single { text, seq }
// object, whose `seq` survives being reset to text: "" because the state
// object itself is never removed. Reading `prev[id]?.seq` the way
// uploadError reads `prev.seq` would therefore see undefined on every
// retry's failure (the entry was just deleted) and restart the count at 1
// every time, defeating the whole mechanism — two separate failures would
// both land on the same odd parity and render identically. The seq for a
// given id has to live somewhere that survives the entry being deleted; a
// ref, keyed the same way, is that somewhere.
function nextSeqFor(seqRef, id) {
  const next = (seqRef.current[id] ?? 0) + 1;
  seqRef.current[id] = next;
  return next;
}

// Reinserts `attachment` into `list` immediately before the entry whose id
// is `nextId` - the id of whichever attachment immediately followed it in
// the list at the moment it was removed (see scheduleDelete, which records
// it) - or at the end if `nextId` is null (it was last) or no longer
// present (its own neighbour has since been removed too, by an
// independent delete or because it hasn't been restored yet either).
// Deliberately never an unconditional `[...list, attachment]`: appending
// unconditionally IS the "jumps to the bottom of the list" bug an Undo
// must not have.
function insertAtAnchor(list, attachment, nextId) {
  const idx = nextId ? list.findIndex((a) => a.id === nextId) : -1;
  if (idx === -1) return [...list, attachment];
  const next = [...list];
  next.splice(idx, 0, attachment);
  return next;
}

// Records (or clears) one pending deletion in BOTH pendingDeletesRef and
// the `pendingDeletes` state it mirrors, in the same synchronous call -
// unlike pageIdRef elsewhere in this file, which mirrors a PROP in an
// effect because a ref genuinely cannot be written any other way when the
// value comes from a parent, `pendingDeletes` is this component's own
// state, changed only by functions this component calls directly, so
// there is no reason to let the ref lag behind state by even one effect
// pass. The ref half is what lets finalizeDelete (fired from a
// setTimeout created long before this specific entry existed) and the
// unmount/page-change flush effects (whose own closures may be even
// older) read the CURRENT map instead of whatever existed when their own
// useCallback/effect was first created - mirrors nextSeqFor and
// PageEditor.js's flushPendingSave, both in this same codebase, taking
// their ref as an explicit argument for the identical reason.
function setPendingDelete(pendingDeletesRef, setPendingDeletes, id, value) {
  pendingDeletesRef.current = { ...pendingDeletesRef.current, [id]: value };
  setPendingDeletes((prev) => ({ ...prev, [id]: value }));
}

function clearPendingDelete(pendingDeletesRef, pendingDeleteTimersRef, setPendingDeletes, id) {
  if (pendingDeleteTimersRef.current[id]) {
    clearTimeout(pendingDeleteTimersRef.current[id]);
    delete pendingDeleteTimersRef.current[id];
  }
  if (id in pendingDeletesRef.current) {
    const next = { ...pendingDeletesRef.current };
    delete next[id];
    pendingDeletesRef.current = next;
  }
  setPendingDeletes((prev) => {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });
}

// Fires every currently pending deletion's DELETE request right now,
// instead of waiting out the rest of its undo window - used when the
// window can no longer meaningfully run out from under the user (see the
// pageId-change and unmount effects below). Not finalizeDelete reused
// as-is: a fetch failure here has no page left to show deleteErrors
// against (the caller is either about to replace `attachments` with a
// different page's load, or the whole panel is unmounting), so - exactly
// like PageEditor.js's own flushPendingSave swallowing a flushed save's
// rejection - it is dropped rather than surfaced. This does not leave the
// object mysteriously undeletable either: the next time this same page is
// loaded, `load()` re-fetches from the server and will show the
// attachment again on its own if the delete genuinely didn't take, which
// is what actually reconciles the view with storage - not a local error
// message aimed at a page nobody is looking at any more.
function flushPendingDeletes(pendingDeletesRef, pendingDeleteTimersRef) {
  const ids = Object.keys(pendingDeletesRef.current);
  for (const id of ids) {
    const entry = pendingDeletesRef.current[id];
    if (pendingDeleteTimersRef.current[id]) {
      clearTimeout(pendingDeleteTimersRef.current[id]);
      delete pendingDeleteTimersRef.current[id];
    }
    delete pendingDeletesRef.current[id];
    fetch(`/api/experience/attachments/${entry.attachment.id}`, { method: "DELETE" }).catch(() => {});
  }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The one supported path (a secure context, which this feature already
// requires) always has crypto.randomUUID. The fallback exists only for
// defensiveness, but the id doubles as the row's primary key, so it must
// still emit a genuine v4 uuid — mirrors lib/supabase/practiceAnswers.js's
// genId.
function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export default function AttachmentPanel({ pageId }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // { text, seq } — see bumpAnnouncement/announcedText above.
  const [uploadError, setUploadError] = useState({ text: "", seq: 0 });
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // Keyed by attachment id. Absence of a key means "no error" — present
  // means the last save for that attachment failed and has not yet
  // succeeded on retry. See saveNotes: the field's typed text is never
  // rolled back when this is set, only ever cleared once a save actually
  // lands.
  const [notesErrors, setNotesErrors] = useState({});
  // Same shape as notesErrors, same reason to exist — keyed by attachment
  // id, present only while that attachment's last delete attempt has
  // failed and not yet succeeded on retry. See removeAttachment.
  const [deleteErrors, setDeleteErrors] = useState({});
  // Same shape again, for a failed download — see downloadAttachment.
  const [downloadErrors, setDownloadErrors] = useState({});
  // Per-id announcement sequence numbers for notesErrors/deleteErrors/
  // downloadErrors — see nextSeqFor's own comment for why these live
  // outside the state objects they announce.
  const notesErrorSeqRef = useRef({});
  const deleteErrorSeqRef = useRef({});
  const downloadErrorSeqRef = useRef({});
  // Attachment id -> true while that id's download is in flight. This is
  // the RE-ENTRY GUARD, and it has to be a ref, not the `downloading` state
  // just below it: a click handler reads and writes it synchronously,
  // before any `await`, so a second click landing in the SAME tick as the
  // first (a real double-tap, not two separately-flushed clicks) sees the
  // write the first click already made. A `useState` guard cannot do this
  // — a setState scheduled by the first click is not visible to the second
  // click's handler until React re-renders, which has not happened yet
  // when both clicks are handled back to back. `pendingDeleteTimersRef`
  // above guards scheduleDelete the identical way for the identical
  // reason. `downloading` state is not part of the guard at all; nothing
  // ever branches on it. It exists purely so the button below has
  // something to render (aria-busy, the spinner) — a ref write does not by
  // itself cause React to re-render anything.
  const downloadingRef = useRef({});
  const [downloading, setDownloading] = useState({});
  // Attachment id -> { attachment, nextId } for a deletion that has been
  // optimistically applied (removed from `attachments`) but whose DELETE
  // has not gone out yet — see scheduleDelete. `pendingDeletesRef` is the
  // ref half of this same data, written synchronously alongside the state
  // by setPendingDelete/clearPendingDelete above; see that pair's own
  // comment for why this one does NOT follow pageIdRef's effect-synced
  // pattern.
  const pendingDeletesRef = useRef({});
  const [pendingDeletes, setPendingDeletes] = useState({});
  // { [id]: timeoutHandle } — kept out of React state, like
  // notesErrorSeqRef/deleteErrorSeqRef just above, because a timer handle
  // is never itself rendered.
  const pendingDeleteTimersRef = useRef({});
  // The panel otherwise has no live region at all: a successful upload or
  // delete is silent to a screen reader even though both failure paths
  // (uploadError, deleteErrors) are announced. { text, seq } for the same
  // reason as everywhere else here.
  const [statusAnnouncement, setStatusAnnouncement] = useState({ text: "", seq: 0 });
  const inputRef = useRef(null);

  // The pageId an in-flight async operation (an upload, in practice) was
  // started under, kept current so that operation can tell — once it
  // resolves — whether the user has since moved on to a different page.
  // Synced in an effect rather than mutated directly during render:
  // react-hooks/refs (the React Compiler's purity rule, part of
  // eslint-plugin-react-hooks v7) flags a ref write in the render body
  // itself, even one like this that never affects what gets rendered.
  const pageIdRef = useRef(pageId);
  useEffect(() => {
    pageIdRef.current = pageId;
  }, [pageId]);

  // The underlying <textarea> DOM node for each attachment's notes field,
  // keyed by attachment id — mirrors JobDescriptionTab.js's own
  // `fieldRefs.current[entry.id] = el` pattern. Populated via each field's
  // own inputRef callback below; used only to move focus onto a specific
  // one once it exists (see focusNotesId's effect).
  const notesFieldRefs = useRef({});
  // New cards append to the END of the list, so without this a keyboard
  // user has to tab past every existing attachment to reach the one they
  // just added. Set right alongside the successful upload's own
  // setAttachments call (see uploadFile); the effect below moves focus once
  // that new card — and its ref — actually exist in the DOM. No reset to
  // null afterward: each upload's id is a fresh crypto.randomUUID(), so the
  // next upload's id is never Object.is-equal to this one and the effect
  // fires again regardless of whether this was ever cleared.
  const [focusNotesId, setFocusNotesId] = useState(null);
  useEffect(() => {
    if (!focusNotesId) return;
    const el = notesFieldRefs.current[focusNotesId];
    if (el) el.focus();
  }, [focusNotesId]);

  // All three error maps are keyed only by attachment id, and ids are not
  // scoped to a page anywhere the panel itself enforces — two different
  // pages can have an attachment with the same id. Left uncleared, an error
  // from one page's attachment would keep showing (against a DIFFERENT
  // attachment that happens to share its id, wrongly naming the file the
  // error was actually about) until it coincidentally got overwritten. Cleared
  // outright on every page switch instead. Deferred one tick, like load's
  // own effect above, so this is never a setState call landing
  // synchronously within the effect body itself (react-hooks/set-state-in-effect
  // flags that shape).
  //
  // A deletion still pending FOR THE PAGE BEING LEFT is flushed first
  // (synchronously, not deferred — flushPendingDeletes calls no state
  // setter itself, only fetch, so react-hooks/set-state-in-effect does not
  // apply to it) rather than silently cancelled or left ticking in the
  // background: `attachments` is about to be replaced outright by the new
  // page's own load, so a cancel-and-restore here would restore a row into
  // a list that's discarded before it could ever be seen, and doing
  // nothing would leave a timer bound to a page the user is no longer
  // looking at as the only thing standing between the object and actually
  // being deleted. See flushPendingDeletes' own comment for why a failure
  // here is swallowed rather than surfaced. pendingDeletes itself (the
  // render-facing copy) is cleared in the same deferred pass as the three
  // error maps, so a page switch never leaves a stale Undo row on screen
  // for an attachment that belongs to the page just left.
  useEffect(() => {
    flushPendingDeletes(pendingDeletesRef, pendingDeleteTimersRef);
    const handle = setTimeout(() => {
      setNotesErrors({});
      setDeleteErrors({});
      setDownloadErrors({});
      setPendingDeletes({});
    }, 0);
    return () => clearTimeout(handle);
  }, [pageId]);

  // Flushes any still-pending deletions if the panel unmounts mid-window,
  // rather than just cancelling their timers — app/page.js can unmount
  // this whole tab outright (mirrors PageEditor.js's own identically-
  // reasoned separate unmount effect, kept distinct from its pageId-reset
  // effect for the same reason this one is kept distinct from the effect
  // just above: a component can unmount without pageId ever changing). A
  // cancel-only cleanup here would leave the underlying object sitting in
  // storage with no UI left anywhere to ever show it as still there, for
  // the rest of an undo window nobody watching can act on — flushing is
  // what keeps "the row is gone from the screen" and "the object is gone
  // from storage" from drifting apart forever instead of just briefly.
  useEffect(() => {
    return () => {
      flushPendingDeletes(pendingDeletesRef, pendingDeleteTimersRef);
    };
  }, []);

  const load = useCallback(async () => {
    if (!pageId) {
      setAttachments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/experience/attachments?pageId=${encodeURIComponent(pageId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error || "Could not load attachments.");
        setAttachments([]);
        return;
      }
      setAttachments(Array.isArray(data.attachments) ? data.attachments : []);
    } catch (err) {
      setLoadError(err?.message || "Could not load attachments.");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    // Deferred one tick (mirrors AutoApplyQueueTab.js's own load effect) so
    // this is never a setState call landing synchronously within the effect
    // body itself — react-hooks/set-state-in-effect flags that shape even
    // though `load`'s early-return branch can otherwise resolve before any
    // `await`.
    const handle = setTimeout(() => load(), 0);
    return () => clearTimeout(handle);
  }, [load]);

  const uploadFile = useCallback(
    async (file) => {
      if (!file || !pageId) return;
      // Captured now, not read again after the await below — pageIdRef
      // (kept current every render) is what tells this, once the request
      // comes back, whether the user is still on the page it started for.
      const startedForPageId = pageId;

      const classification = classifyAttachment({ name: file.name, type: file.type, size: file.size });
      if (!classification.ok) {
        setUploadError((prev) => bumpAnnouncement(prev.seq, classification.reason));
        return;
      }

      setUploadError((prev) => bumpAnnouncement(prev.seq, ""));
      setUploading(true);
      try {
        const form = new FormData();
        form.set("pageId", startedForPageId);
        form.set("id", genId());
        form.set("file", file);
        const res = await fetch("/api/experience/attachments", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setUploadError((prev) => bumpAnnouncement(prev.seq, data?.error || "Could not upload this file."));
          return;
        }
        // The user may have switched to a different page while this was in
        // flight. Appending now would put this row on whatever page's list
        // happens to be on screen, not the one it was actually uploaded to.
        if (data.attachment && pageIdRef.current === startedForPageId) {
          setAttachments((prev) => [...prev, data.attachment]);
          setStatusAnnouncement((prev) => bumpAnnouncement(prev.seq, `Added "${data.attachment.name}"`));
          setFocusNotesId(data.attachment.id);
        }
      } catch (err) {
        setUploadError((prev) => bumpAnnouncement(prev.seq, err?.message || "Could not upload this file."));
      } finally {
        setUploading(false);
      }
    },
    [pageId],
  );

  const onInputChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be picked again later
    if (file) uploadFile(file);
  };

  const onDragOver = (event) => {
    event.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragActive(false);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  };

  const onNotesInput = (id, notes) => {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, notes } : a)));
  };

  // Mirrors PageEditor's failed-save shape rather than inventing a second
  // one: a visible error naming the attachment, the user's typed text left
  // exactly as they left it, and a Retry that re-issues the same PATCH.
  // Never rolled back to the last-saved server value on failure — that
  // would destroy what the user just wrote, and for a video the notes field
  // is the ONLY description of that file the AI ever gets (the video bytes
  // themselves are never sent as context), so losing it silently is a real
  // loss, not a cosmetic one.
  const saveNotes = useCallback(async (id, name, notes) => {
    setNotesErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/experience/attachments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setNotesErrors((prev) => ({
        ...prev,
        [id]: {
          text: `Could not save the note for "${name}". Your text has not been lost — try again.`,
          seq: nextSeqFor(notesErrorSeqRef, id),
        },
      }));
    }
  }, []);

  // The Retry action on a failed delete's own alert — see finalizeDelete
  // below, which is what puts an attachment into `deleteErrors` in the
  // first place now. Retrying is an explicit, deliberate second click
  // AFTER a real failure was already shown, not a fresh accidental one, so
  // it re-issues the DELETE immediately rather than reopening a whole new
  // undo window. Mirrors saveNotes' own shape exactly (clear any previous
  // error for this id before trying again; on failure, set one naming the
  // file) rather than inventing a second error pattern for the same kind
  // of failure.
  const removeAttachment = useCallback(async (attachment) => {
    setDeleteErrors((prev) => {
      if (!(attachment.id in prev)) return prev;
      const next = { ...prev };
      delete next[attachment.id];
      return next;
    });
    try {
      const res = await fetch(`/api/experience/attachments/${attachment.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      setStatusAnnouncement((prev) => bumpAnnouncement(prev.seq, `Removed "${attachment.name}"`));
    } catch {
      // Leave the row in place — the delete did not take — and now say so,
      // instead of leaving that absence of change as the only signal.
      setDeleteErrors((prev) => ({
        ...prev,
        [attachment.id]: {
          text: `Could not delete "${attachment.name}". Try again.`,
          seq: nextSeqFor(deleteErrorSeqRef, attachment.id),
        },
      }));
    }
  }, []);

  // The Download IconButton's own handler — pulls this attachment's bytes
  // back out of the private bucket and saves them under the file's
  // ORIGINAL name (never the storage key's sanitized basename). Mirrors
  // saveNotes/removeAttachment's own shape (clear any previous error for
  // this id before trying again; on failure, set one naming the file) with
  // one addition on top: the downloadingRef guard above, because unlike a
  // notes save or a delete, a slow download is exactly the kind of thing
  // that invites an impatient second click on the same control.
  //
  // Announced exactly ONCE per download, on success, and only on success.
  // There is deliberately no "Downloading…" announcement to go with it, and
  // the reason is the RECONCILER, not a setState bailout: bumpAnnouncement
  // returns a brand-new object every call (see above), so that bailout can
  // never fire here. A live region needs a changed TEXT NODE, which is what
  // announcedText's toggle produces — it flips on ODD sequence numbers, so
  // bumping once for "Downloading…" and again for "Downloaded" restores the
  // parity this region started from, and "Downloaded" then renders
  // byte-identical to what it already showed (e.g. a previous download of
  // this same file). React's reconciler leaves that text node untouched, and
  // with no DOM mutation nothing reaches a screen reader — silent from the
  // second download of any file onward, exactly the ordinary repeat case
  // this region exists for. In-flight has its own non-announced signal
  // already: aria-busy plus the spinner, set from `downloading` below.
  //
  // If the panel unmounts mid-download, nothing reports the failure and
  // nothing re-fetches to reconcile. Considered, left as-is: unlike a
  // flushed delete, a download has no server-side state a later load() could
  // re-read, so surfacing it needs an error store outliving this panel.
  const downloadAttachment = useCallback(async (attachment) => {
    const id = attachment.id;
    if (downloadingRef.current[id]) return;
    downloadingRef.current[id] = true;
    setDownloading((prev) => ({ ...prev, [id]: true }));
    // Captured now, exactly as uploadFile does it — this is the slowest async
    // operation here (100 MB of video is seconds of wall clock), and it
    // resolves AFTER the page-switch effect's deferred clear has run, so only
    // this guard covers it. The download ITSELF still happens either way: the
    // user asked for that file and it should still arrive. Only UI writes are
    // gated on still being on the page it was started from.
    const startedForPageId = pageId;

    setDownloadErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    // One place, one message, one shape: a thrown createClient() (public env
    // vars missing) or triggerBlobDownload (a torn-down document) is the same
    // event to the user as a storage error — no file. Without a catch, either
    // throw only rejected an onClick's promise: no file, no alert, nothing said.
    const reportFailure = () => {
      if (pageIdRef.current !== startedForPageId) return;
      const text = `Could not download "${attachment.name}". Try again.`;
      setDownloadErrors((prev) => ({ ...prev, [id]: { text, seq: nextSeqFor(downloadErrorSeqRef, id) } }));
    };

    try {
      const supabase = createClient();
      const { blob, error } = await downloadAttachmentBlob(supabase, attachment.storage_path);
      if (error || !blob) {
        reportFailure();
        return;
      }
      triggerBlobDownload(blob, attachment.name);
      if (pageIdRef.current === startedForPageId) {
        setStatusAnnouncement((prev) => bumpAnnouncement(prev.seq, `Downloaded "${attachment.name}"`));
      }
    } catch {
      reportFailure();
    } finally {
      delete downloadingRef.current[id];
      setDownloading((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, [pageId]);

  // Fires once scheduleDelete's undo window has actually run out (or once
  // a flush forces it early — see flushPendingDeletes, which bypasses this
  // function entirely and swallows its own failures instead of reaching
  // here). `entry` may already be gone — Undo clears it synchronously — in
  // which case the setTimeout that scheduled this call was already
  // cancelled and this is unreachable in practice; the guard is cheap
  // insurance against that, not something a normal user path can trigger.
  const finalizeDelete = useCallback(async (id) => {
    const entry = pendingDeletesRef.current[id];
    if (!entry) return;
    const { attachment, nextId } = entry;
    try {
      const res = await fetch(`/api/experience/attachments/${attachment.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      // Success: the row was already removed from `attachments` at click
      // time, and its removal already announced then (see scheduleDelete)
      // — nothing left to change here besides this id's own bookkeeping.
      clearPendingDelete(pendingDeletesRef, pendingDeleteTimersRef, setPendingDeletes, id);
    } catch {
      // Failure: restore the row — at its ORIGINAL position, via the same
      // nextId anchor Undo itself uses, never appended — and hand off to
      // the exact same deleteErrors alert (and its Retry, via
      // removeAttachment above) that an immediate delete failure already
      // used before this file had an undo window at all, rather than
      // inventing a second failure UI for the same kind of failure.
      clearPendingDelete(pendingDeletesRef, pendingDeleteTimersRef, setPendingDeletes, id);
      setAttachments((prev) => insertAtAnchor(prev, attachment, nextId));
      setDeleteErrors((prev) => ({
        ...prev,
        [id]: {
          text: `Could not delete "${attachment.name}". Try again.`,
          seq: nextSeqFor(deleteErrorSeqRef, id),
        },
      }));
    }
  }, []);

  // Cancels a still-pending deletion and puts the row back exactly where
  // it was — see insertAtAnchor's own comment for why "where it was" is
  // tracked by neighbour id rather than a numeric index. Reuses
  // bumpAnnouncement/the same `statusAnnouncement` region scheduleDelete's
  // own "Removed" announcement already uses, rather than a second
  // mechanism, so two consecutive identical announcements (e.g. two
  // same-named attachments removed back to back) keep getting the real DOM
  // mutation that region's toggle exists for.
  const undoDelete = useCallback((id) => {
    const entry = pendingDeletesRef.current[id];
    if (!entry) return;
    clearPendingDelete(pendingDeletesRef, pendingDeleteTimersRef, setPendingDeletes, id);
    setAttachments((prev) => insertAtAnchor(prev, entry.attachment, entry.nextId));
    setStatusAnnouncement((prev) => bumpAnnouncement(prev.seq, `Restored "${entry.attachment.name}"`));
  }, []);

  // The delete IconButton's own handler. Removes the row from
  // `attachments` right away (one click, no dialog — see UNDO_WINDOW_MS's
  // own comment on why) and schedules the actual DELETE for
  // UNDO_WINDOW_MS later via finalizeDelete, rather than sending it now.
  // `nextId` is captured off `attachments` as it stands the instant before
  // removal, not read again later, so a subsequent Undo (or this same
  // entry's own failure-restore in finalizeDelete) reinserts next to the
  // SAME neighbour this row actually had — not wherever the array happens
  // to end at whatever later moment Undo is clicked, which could easily be
  // a different position once other deletions or undos have happened in
  // between.
  const scheduleDelete = useCallback(
    (attachment) => {
      const id = attachment.id;
      if (pendingDeleteTimersRef.current[id]) return;
      const idx = attachments.findIndex((a) => a.id === id);
      const nextId = idx === -1 ? null : (attachments[idx + 1]?.id ?? null);

      setAttachments((prev) => prev.filter((a) => a.id !== id));
      // The delete IconButton stays clickable even on a row currently
      // showing a PRIOR failed delete's own alert (finalizeDelete restores
      // the row without hiding it) - clearing any stale entry here, the
      // same way removeAttachment/saveNotes clear their own error at the
      // start of every fresh attempt, is what stops that old failure from
      // reappearing next to this row if THIS new attempt is later undone
      // rather than left to finalize. A failed DOWNLOAD's alert goes with it,
      // same id, same reason: a row that comes back - via Undo, or via
      // finalizeDelete's own failure-restore - carries only what is still true.
      setDeleteErrors((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setDownloadErrors((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPendingDelete(pendingDeletesRef, setPendingDeletes, id, { attachment, nextId });
      setStatusAnnouncement((prev) => bumpAnnouncement(prev.seq, `Removed "${attachment.name}"`));

      pendingDeleteTimersRef.current[id] = setTimeout(() => {
        delete pendingDeleteTimersRef.current[id];
        finalizeDelete(id);
      }, UNDO_WINDOW_MS);
    },
    [attachments, finalizeDelete],
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
        <Typography variant="subtitle1">Attachments</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Box
          component="span"
          role="status"
          aria-live="polite"
          sx={{ fontSize: 12.5, color: "text.secondary" }}
        >
          {announcedText(statusAnnouncement)}
        </Box>
      </Stack>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}

      <Box
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        sx={{
          border: "1px dashed",
          borderColor: dragActive ? "primary.main" : "divider",
          borderRadius: 1,
          p: 2,
          mb: 2,
        }}
      >
        <Typography component="label" htmlFor="attachment-file-input" variant="body2" sx={{ display: "block", mb: 1 }}>
          Add a file, image, video, PowerPoint deck, or Excel spreadsheet
        </Typography>
        <input ref={inputRef} id="attachment-file-input" type="file" onChange={onInputChange} disabled={uploading} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Or drag a file into this box. Video up to 100 MB; everything else up to 25 MB.
        </Typography>
      </Box>

      {uploading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
          <CircularProgress size={16} />
          <Typography variant="body2">Uploading…</Typography>
        </Stack>
      )}

      {uploadError.text && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setUploadError((prev) => bumpAnnouncement(prev.seq, ""))}
        >
          {announcedText(uploadError)}
        </Alert>
      )}

      {Object.keys(pendingDeletes).length > 0 && (
        <Stack spacing={1} sx={{ mb: 2 }}>
          {Object.values(pendingDeletes).map(({ attachment }) => (
            <Alert
              key={attachment.id}
              severity="info"
              action={
                <Button color="inherit" size="small" onClick={() => undoDelete(attachment.id)}>
                  Undo
                </Button>
              }
            >
              Removed &quot;{attachment.name}&quot;
            </Alert>
          ))}
        </Stack>
      )}

      {attachments.length === 0 && !loadError && (
        <Typography variant="body2" color="text.secondary">
          No attachments yet.
        </Typography>
      )}

      <Stack spacing={2}>
        {attachments.map((attachment) => (
          <Card key={attachment.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                <Box sx={{ width: 96, flexShrink: 0 }}>
                  {attachment.kind === "image" && attachment.url && (
                    <Box
                      component="img"
                      src={attachment.url}
                      alt={attachment.notes || attachment.name}
                      sx={{ width: 1, borderRadius: 1, display: "block" }}
                    />
                  )}
                  {attachment.kind === "video" && attachment.url && (
                    <Box
                      component="video"
                      controls
                      src={attachment.url}
                      aria-label={attachment.notes || attachment.name}
                      sx={{ width: 1, borderRadius: 1, display: "block" }}
                    />
                  )}
                  {/* Slides/sheet get their own icon, distinct from each other and from
                      the generic InsertDriveFileIcon every other non-preview kind still
                      falls back to — the text label just below already says the kind, so
                      neither icon needs (or gets) an aria-hidden-defeating titleAccess. */}
                  {attachment.kind === "slides" && <SlideshowIcon fontSize="large" color="action" />}
                  {attachment.kind === "sheet" && <TableChartIcon fontSize="large" color="action" />}
                  {(attachment.kind !== "image" &&
                    attachment.kind !== "video" &&
                    attachment.kind !== "slides" &&
                    attachment.kind !== "sheet") && (
                    <InsertDriveFileIcon fontSize="large" color="action" />
                  )}
                </Box>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                    {attachment.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {KIND_LABEL[attachment.kind] || "File"}
                    {formatBytes(attachment.bytes) ? ` • ${formatBytes(attachment.bytes)}` : ""}
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={1}
                    size="small"
                    margin="dense"
                    label="Notes for the AI"
                    // The visible floating label stays identical for every
                    // card on purpose (it's the field's PURPOSE, and that is
                    // the same everywhere) — the accessible name is what has
                    // to be distinct, since it's what a screen reader's
                    // form-field list shows in place of visible position.
                    // slotProps.htmlInput is MUI's documented way to reach
                    // the underlying <textarea> itself, matching
                    // JobDescriptionTab.js's own reasoning: a plain
                    // aria-label prop on TextField would land on the root
                    // FormControl, not the field an AT is actually focused
                    // on.
                    slotProps={{ htmlInput: { "aria-label": `Notes for the AI for ${attachment.name}` } }}
                    inputRef={(el) => {
                      notesFieldRefs.current[attachment.id] = el;
                    }}
                    value={attachment.notes || ""}
                    onChange={(event) => onNotesInput(attachment.id, event.target.value)}
                    onBlur={(event) => saveNotes(attachment.id, attachment.name, event.target.value)}
                  />
                  {notesErrors[attachment.id] && (
                    <Alert
                      severity="error"
                      sx={{ mt: 0.5 }}
                      action={
                        <Button
                          color="inherit"
                          size="small"
                          onClick={() => saveNotes(attachment.id, attachment.name, attachment.notes || "")}
                        >
                          Retry
                        </Button>
                      }
                    >
                      {announcedText(notesErrors[attachment.id])}
                    </Alert>
                  )}
                  {deleteErrors[attachment.id] && (
                    <Alert
                      severity="error"
                      sx={{ mt: 0.5 }}
                      action={
                        <Button color="inherit" size="small" onClick={() => removeAttachment(attachment)}>
                          Retry
                        </Button>
                      }
                    >
                      {announcedText(deleteErrors[attachment.id])}
                    </Alert>
                  )}
                  {downloadErrors[attachment.id] && (
                    <Alert
                      severity="error"
                      sx={{ mt: 0.5 }}
                      action={
                        <Button color="inherit" size="small" onClick={() => downloadAttachment(attachment)}>
                          Retry
                        </Button>
                      }
                    >
                      {announcedText(downloadErrors[attachment.id])}
                    </Alert>
                  )}
                </Box>
                <IconButton
                  aria-label={`Download ${attachment.name}`}
                  onClick={() => downloadAttachment(attachment)}
                  size="small"
                  // Never disabled and never pulled out of the tab order —
                  // see downloadingRef's own comment: the button that
                  // vanishes from tab order the moment it's used is a bug
                  // this repo has already shipped once. aria-busy plus the
                  // spinner below is the whole in-flight signal.
                  aria-busy={downloading[attachment.id] ? "true" : undefined}
                >
                  {downloading[attachment.id] ? <CircularProgress size={16} /> : <DownloadIcon fontSize="small" />}
                </IconButton>
                <IconButton
                  aria-label={`Delete ${attachment.name}`}
                  onClick={() => scheduleDelete(attachment)}
                  size="small"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
