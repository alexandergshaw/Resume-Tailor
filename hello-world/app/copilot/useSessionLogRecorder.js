"use client";

import { useCallback, useRef, useState } from "react";
// AC-Q6: wiring only — createSessionLog/downloadSessionLogArchive are the
// pure, already-tested recorder and delivery halves (lib/copilot/
// sessionLog.js, sessionLogArchive.js); nothing here restates their logic.
import { createSessionLog, SESSION_LOG_SCHEMA } from "@/lib/copilot/sessionLog";
import { downloadSessionLogArchive } from "@/lib/copilot/sessionLogArchive";

// AC-Q6.9: split out of useLiveSession.js purely to keep that file under
// this project's 1000-line cap (the same reason useLiveSession.js was
// itself split out of CopilotClient.js — see its own module doc). This is
// the live pipeline's session-log WIRING SURFACE, not the recorder itself:
// useLiveSession.js is still the only caller, and still the only place
// that decides WHEN each event fires.
//
// D9: `speakerSnapshotRef` is optional and, when handed in, is read only at
// DOWNLOAD time (below) — never at construction — so this hook never needs
// to know when identity settles, only what it currently is the moment a
// user actually presses the button.
export function useSessionLogRecorder(source, speakerSnapshotRef) {
  // AC-Q6: this session's own diagnostic log. Replaced wholesale by
  // startLog() at the top of every start() (AC-Q6.6) so a second
  // interview's turns never follow the first into a download; stays
  // populated after stop() (AC-Q6.7) since that's exactly when a user
  // reviews or downloads it.
  const sessionLogRef = useRef(null);
  // D7: a real, reactive twin of "does sessionLogRef hold anything" — the
  // log itself lives on a ref (event() writes through it without forcing a
  // re-render per entry), but a control gated on "has this session recorded
  // anything" has to be driven by real React state to ever re-render at
  // all. Same idiom practice mode's usePracticeSessionLog.js already uses
  // for its own `hasLog`: flips true once, here in startLog(), and never
  // back to false — once a session has ever run this tab, there is
  // something to download for the rest of the page's life (AC-Q6.7's
  // "works after Stop" too).
  const [hasEvents, setHasEvents] = useState(false);

  // AC-Q6.1/Q6.6: called once, at the very top of start(), before any other
  // per-session reset — so even a session that fails moments later still
  // has a session.start entry to explain what it was.
  const startLog = useCallback(() => {
    sessionLogRef.current = createSessionLog({ mode: "live", source, startedAt: Date.now() });
    setHasEvents(true);
  }, [source]);

  // AC-Q6.10: the one call site every recording call in useLiveSession.js
  // goes through. sessionLog.js's own event() already never throws; the
  // optional-chain and try/catch here are belt-and-braces so a missing ref
  // (no session ever started) or any surprise from a hostile payload can
  // never interrupt the interview this log exists to explain.
  const logEvent = useCallback((type, data) => {
    try {
      sessionLogRef.current?.event(type, data);
    } catch {
      // Never let recording break the pipeline.
    }
  }, []);

  // AC-Q6.1: safe to call before any session has ever run — falls back to a
  // fresh, empty log built the same way startLog() builds a real one,
  // rather than restating createSessionLog's own empty-log shape here.
  const sessionLogSnapshot = useCallback(() => {
    try {
      return (sessionLogRef.current || createSessionLog({ mode: "live", source })).snapshot();
    } catch {
      return {
        schema: SESSION_LOG_SCHEMA,
        mode: "live",
        source: source || null,
        provider: null,
        startedAt: 0,
        events: [],
        dropped: 0,
      };
    }
  }, [source]);

  // AC-Q6.5/Q6.7/D9: always the CURRENT snapshot, on demand — during a
  // session or after Stop, exactly once per call, never throwing into the
  // caller. `speakerSnapshot` rides along as a second argument (not folded
  // into the snapshot itself, which sessionLog.js's own createSessionLog
  // never learns to carry) so renderSessionLogMarkdown can resolve an
  // in-person turn's `speakerTag` to "You"/"Them" instead of the numbered
  // fallback it falls back to with no snapshot at all — see
  // sessionLogArchive.js's own doc for why this has to be threaded through
  // rather than recovered from the log's events.
  const downloadLog = useCallback(async () => {
    try {
      await downloadSessionLogArchive(sessionLogSnapshot(), {
        speakerSnapshot: speakerSnapshotRef?.current,
      });
    } catch {
      // A failed download must not surface as an unhandled rejection.
    }
  }, [sessionLogSnapshot, speakerSnapshotRef]);

  return { startLog, logEvent, sessionLogSnapshot, downloadLog, hasEvents };
}
