// Records the candidate's own answer (video + audio) over the practice
// session's existing stream, and hands back the resulting Blob — originally
// purely for in-browser replay, and, since D1, that same Blob may also be
// uploaded to the user's own practice history by the caller (see
// lib/supabase/practiceAnswers.js and usePracticeAnswer.js's persistAnswer).
// This module itself still does no networking either way: it has no
// relation to the Deepgram transcription stream running alongside it, and
// whether/where the Blob it returns goes afterward is entirely up to
// whoever calls stop(). Replay (and now saving) is a bonus feature, not a
// required one: when MediaRecorder is missing, or none of the candidate
// mime types are supported, every method below becomes a safe no-op so its
// absence can never block answering or the delivery metrics computed from
// the transcript instead.
//
// No DOM/browser globals are touched at module scope — MediaRecorder is
// only referenced inside methods, at call time — so this module imports
// cleanly in the Node ("environment: node", no jsdom) test environment this
// repo's vitest config runs under.

// Ordered by preference: webm/vp9 gives the smallest clip for a given
// quality, webm/vp8 is the widest-supported webm fallback, and the mp4
// candidates cover Safari, which never supports webm at all.
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=h264,aac",
  "video/mp4",
];

// How long stop() waits for the recorder's own "stop" event before giving up
// and resolving with null anyway. A track that dies mid-recording (camera
// unplugged, tab backgrounded on some mobile browsers) can leave a
// MediaRecorder that never fires "stop" — the guard means that hang can
// never leave the UI waiting forever for a replay clip that isn't coming.
const STOP_GUARD_MS = 4000;

// Pure: the first candidate `isTypeSupported` accepts, or "" when none are.
// Takes isTypeSupported as a parameter (rather than reading
// MediaRecorder.isTypeSupported itself) so it's callable from a Node test
// with a plain function double, no real MediaRecorder required.
export function pickSupportedMimeType(candidates, isTypeSupported) {
  if (typeof isTypeSupported !== "function") return "";
  for (const type of candidates || []) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Treat a throwing check the same as "not supported" and keep looking.
    }
  }
  return "";
}

export class AnswerRecorder {
  constructor() {
    this._recorder = null;
    this._chunks = null; // set to a fresh array by start(), cleared once stop() settles
    this.mimeType = "";
    this.supported = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
    if (this.supported) {
      this.mimeType = pickSupportedMimeType(MIME_CANDIDATES, (type) => MediaRecorder.isTypeSupported(type));
      this.supported = !!this.mimeType;
    }
  }

  // Begins collecting dataavailable chunks for a fresh answer. A no-op when
  // unsupported, or when a recording is already in progress (start() is not
  // meant to be re-entrant — the caller stops the previous answer first).
  start(stream) {
    if (!this.supported || this._recorder) return;
    // A local array, closed over by the listener below — NOT `this._chunks`
    // read dynamically via `this`. If this recording's "dataavailable" fired
    // late (after stop() had already synchronously nulled `this._recorder`
    // and a brand new start() had already reassigned `this._chunks` to a
    // fresh array for the NEXT answer), a listener that read `this._chunks`
    // would push this recording's chunk into that next answer's array
    // instead — one answer's clip bleeding into another's. Closing over a
    // local makes each listener permanently bound to only its own recording,
    // no matter what `this._chunks` points to by the time the event fires.
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
    } catch {
      // A stream this recorder can't actually record (no tracks, a mime
      // type the browser lied about supporting) degrades to the same
      // no-op-forever behavior as "unsupported" rather than throwing later.
      this.supported = false;
      return;
    }
    recorder.addEventListener("dataavailable", (evt) => {
      if (evt.data && evt.data.size > 0) chunks.push(evt.data);
    });
    try {
      recorder.start();
    } catch {
      this.supported = false;
      return;
    }
    this._recorder = recorder;
    this._chunks = chunks;
  }

  // Always settles: a Blob built from the collected chunks once the
  // recorder's own "stop" event fires, or null when unsupported, when
  // nothing was recording, when no chunks ever arrived, or when the guard
  // timeout above elapses first. Safe to call with no matching start()
  // (never started, or already stopped) and safe to call twice in a row —
  // the second call finds no active recorder and resolves null immediately.
  stop() {
    const recorder = this._recorder;
    const chunks = this._chunks;
    this._recorder = null;
    if (!recorder) {
      this._chunks = null;
      return Promise.resolve(null);
    }

    const mimeType = this.mimeType;
    const toBlob = () => (chunks && chunks.length ? new Blob(chunks, { type: mimeType }) : null);
    // Only clear `this._chunks` if it still points at THIS recording's array
    // — a new start() may already have reassigned it to the next answer's
    // array by the time this settles (guard timeout, or a slow "stop"
    // event), and clearing it then would wipe out a recording that is still
    // in progress. Once nulled, the finished answer's chunks/Blob data stay
    // reachable only through whatever the caller did with the resolved
    // Blob — not pinned on this instance for the rest of the session.
    const clearIfStillCurrent = () => {
      if (this._chunks === chunks) this._chunks = null;
    };

    return new Promise((resolve) => {
      let settled = false;
      const guard = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearIfStillCurrent();
        resolve(null);
      }, STOP_GUARD_MS);
      const finish = (blob) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        clearIfStillCurrent();
        resolve(blob);
      };

      recorder.addEventListener("stop", () => finish(toBlob()), { once: true });
      try {
        if (recorder.state === "inactive") {
          finish(toBlob());
        } else {
          recorder.stop();
        }
      } catch {
        finish(null);
      }
    });
  }
}
