// Per-speaker utterance assembly for live in-person sessions (AC-M1.6). Pure
// module: it imports NOTHING, has no React, no DOM, no browser globals, no
// timers. `vitest.config.js` runs with `environment: "node"` and this repo
// has no jsdom and no React testing library, so any of this logic living
// inside `CopilotClient.js` — or the `useLiveSession.js` hook it is being
// extracted into — could never be exercised by a test at all (AC-M1.6.1).
// Per-tag utterance assembly is the most fragile new logic in this chunk, so
// it lives here, the same reasoning that already put answerPoints.js and
// answerWindow.js in lib/.
//
// session.js is the intended caller: for an in-person session it feeds one
// `createUtteranceAssembly()` instance a stream of `push(speakerTag, text)`
// calls built from Deepgram's per-run `onTranscript` frames (AC-M1.2.5), and
// calls speakerIdentity's `observe()` on whatever this module hands back —
// so `observe()` runs once per assembled UTTERANCE, never once per
// interim/final transcript frame (AC-M1.3.2).
//
// AC-M1.6.2 — the drain rule, and how an earlier draft deadlocked on it:
// that draft said `speechFinal` rides the LAST run of a Deepgram frame
// (AC-M1.2.5) AND that a speaker's buffer drains on "its own speechFinal".
// Those two rules deadlock. With `endpointing=300`, a frame that carries
// `speech_final` routinely ALSO carries the next speaker's opening words
// ("...that's right" / "Okay, so"), so the first speaker's run is not the
// frame's last run, never receives `speechFinal`, and its buffer never
// drains — the interviewer's question is silently lost, and its text is
// later glued onto whatever that speaker says minutes afterwards. The fix:
// a speaker's buffer ALSO completes the instant a run from a DIFFERENT
// speaker arrives, because on a single shared microphone a speaker change
// genuinely IS the end of a turn. That is a.k.a. "whichever comes first":
// (a) a different tag's run arrives while this tag has buffered segments,
// or (b) this tag's own `speechFinal`/explicit `drain()` arrives — for a
// speaker who simply stops talking without ever being interrupted.
// `drainAll()` exists so session teardown never strands a buffer for the
// rest of the process's life.

// Trims a pushed text segment and collapses internal whitespace runs to a
// single space, so segments accumulated from several transcript frames join
// back into one utterance without doubled spaces at the seams.
function normalizeSegment(text) {
  return String(text == null ? "" : text)
    .trim()
    .replace(/\s+/g, " ");
}

export function createUtteranceAssembly() {
  // Invariant maintained by push()/drain() below: at most ONE tag has a
  // non-empty buffer at any moment. Every push() either extends that one
  // active buffer (same tag pushes again) or first completes-and-clears it
  // (a different tag pushes) before starting a fresh one, and drain() /
  // drainAll() always clear whatever they return. `active` tracks which tag
  // that is, or `null` when nobody currently has anything buffered.
  const buffers = new Map();
  let active = null;

  function bufferedText(tag) {
    const segments = buffers.get(tag);
    return segments && segments.length ? segments.join(" ") : "";
  }

  function push(tag, text) {
    const segment = normalizeSegment(text);
    // A blank/whitespace-only segment is dropped outright — never buffered
    // as an empty turn, and never treated as "a different speaker started
    // talking" either. In practice every STT provider already filters
    // empty/whitespace-only transcript before calling onTranscript, but a
    // defensive no-op here costs nothing and means a stray blank frame can
    // never masquerade as a real speaker change.
    if (!segment) return null;

    let completed = null;
    if (active !== null && active !== tag) {
      // AC-M1.6.2's deadlock-breaking rule: a run from a DIFFERENT tag
      // completes whoever was previously buffering, regardless of whether
      // that speaker's own speechFinal ever arrives at all.
      const prevText = bufferedText(active);
      if (prevText) completed = { tag: active, text: prevText };
      buffers.delete(active);
    }

    const existing = buffers.get(tag) || [];
    existing.push(segment);
    buffers.set(tag, existing);
    active = tag;

    return completed;
  }

  function pending(tag) {
    return bufferedText(tag);
  }

  function drain(tag) {
    const text = bufferedText(tag);
    if (!text) return null;
    buffers.delete(tag);
    if (active === tag) active = null;
    return { tag, text };
  }

  function drainAll() {
    const drained = [];
    for (const [tag, segments] of buffers) {
      if (segments && segments.length) drained.push({ tag, text: segments.join(" ") });
    }
    buffers.clear();
    active = null;
    return drained;
  }

  return { push, drain, drainAll, pending };
}
