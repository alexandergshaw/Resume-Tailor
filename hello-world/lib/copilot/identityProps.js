// AC-M1.5.6: TranscriptView's optional identity props — passed only for
// the in-person source, which is the pinned compatibility gate
// (TranscriptView treats `onAssignUser`'s mere PRESENCE as "render the
// correction UI"; leaving it undefined for tab/system is what keeps that
// mode byte-identical to HEAD, per TranscriptView's own doc). Spread onto
// both TranscriptView render sites in CopilotClient.js (live-collapsed and
// !live).
//
// BUG-5: `identityUnsettled` (from useLiveSession) is true from mount —
// the default snapshot's confidence is "unknown" — and stays true for the
// rest of the page's idle life, before a session has ever run and again
// after one ends. Gating the whole bundle on `source` alone let
// TranscriptView's "Still working out who is who in this conversation"
// caption render over an idle transcript that had not heard a word yet
// ("Transcript will appear here once the session starts…" directly under
// a claim about a conversation that hasn't happened), and again once a
// session ends. `speakerLabelFor`/`onAssignUser` stay gated on `source`
// alone as before — BUG-2's fix already makes `onAssignUser` a safe no-op
// once no session exists, so leaving the correction control reachable
// post-session is harmless, just inert. Only the CLAIM of unsettled
// identity needs an extra gate: `live` (a session is running right now)
// or `speakerSnapshot.tags.length > 0` (at least one voice has actually
// been observed) — the latter is belt-and-braces given stop() (BUG-2)
// resets `speakerSnapshot` back to its tags-less default the instant a
// session ends, so `live` alone already covers every reachable case; kept
// explicit so this reads correctly on its own, the same discipline
// useLiveSession.js's own `identityUnsettled` comment already follows for
// its `!overridden` half.
//
// Line-budget extraction out of app/copilot/CopilotClient.js (chunk C, D-2's
// headroom problem) — pure, no React, sibling to groundingNotice.js and
// captureNotices.js, both split out of that same file for the same reason.
// Re-verified before moving: no test pins `identityProps` by identifier or
// by this block's source text inside CopilotClient.js, and `speakerLabelFor`/
// `onAssignUser` are handed through untouched (this module never calls
// them), so nothing here needs React.
export function identityPropsFor({ source, speakerLabelFor, identityUnsettled, live, speakerSnapshot, onAssignUser }) {
  return source === "inperson"
    ? {
        speakerLabelFor,
        identityUnsettled: identityUnsettled && (live || speakerSnapshot.tags.length > 0),
        onAssignUser,
      }
    : {};
}
