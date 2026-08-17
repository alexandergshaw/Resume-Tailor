// AC-T1.9..T1.12. Owns the single decision "which question entry is
// current" for both live and practice mode, plus the pin decision (T1) that
// builds on top of it: whether that "current" entry should instead be
// whatever the candidate pinned, and how many newer entries have arrived
// since. `latestQuestionEntry` used to live in
// app/copilot/dashboard/CopilotDashboard.js; it moved here, verbatim, so a
// pure `lib/` module could add the pin decision on top of it without
// importing from a component (a `lib/` module may not import from `app/`).
// CopilotDashboard.js re-exports it so QuestionFeed.js's existing import
// keeps resolving to this exact function — see that re-export's own comment
// for why it exists.
//
// Deliberately no React, no MUI, no DOM, no Date.now() — pure over plain
// arrays, same discipline as the rest of lib/copilot/.

// AC-M1.3.5: prefers the last NON-provisional entry, when one exists, over
// the array's true last entry. `provisional` means "attributed to the voice
// currently believed to be the user" (userTag !== null && q.speakerTag ===
// userTag — see useLiveSession.js), no longer tied to confidence — a
// question detected from the tag currently presumed to be the candidate is
// recorded `provisional` regardless of how sure the app is of that tag.
// Without this preference, the candidate's own "Does that answer your
// question?" would evict the interviewer's live question and answer from
// the panel the candidate is reading, mid-answer, exactly the failure this
// AC exists to prevent. Falls back to the array's true last entry when
// EVERY entry is provisional (nothing settled has been detected yet, or —
// see BUG-1 below — the cold-start case where the interviewer spoke first
// and became the provisional argmax on word count alone), so the panel
// still shows the best guess available rather than nothing at all.
//
// BUG-3/R-121 group-L: exported so QuestionFeed.js can read the SAME
// "what's current" decision instead of hand-rolling
// `questions[questions.length - 1]` — before this export, the dashboard's
// panels and the feed's live region could name two different entries as
// current the moment a fallback was in effect, which is exactly the "one
// decision, one place" standard that regression case's amendment sets.
// Lives here, in lib/, precisely so a lib/ module (pinnedQuestionEntry,
// below) can build on it — a lib/ module may not import from a component,
// so the decision had to move before the pin decision could reuse it.
//
// BUG-4: guards both the element (`list[i] &&`) and the fallback return
// (`|| null`). The previous version dereferenced `list[i].provisional`
// unguarded, which throws on a null/undefined element instead of degrading
// to the empty state — the one reader of `questions` whose throw would take
// the whole dashboard down mid-interview, unlike the sibling
// `askedQuestionsFor` (useCopilotDashboard.js), which already guards for
// exactly this reason. Not reachable from today's two call sites, but cheap
// insurance against a future one that isn't as careful.
//
// Practice mode never sets a `provisional` key at all (see PracticeClient's
// `dashboardQuestions`), so `list[i] && !list[i].provisional` still
// evaluates `true && !undefined === true` on the first (only) iteration and
// returns that single entry — byte-identical to both the pre-guard version
// and the pre-AC-M1.3.5 version, for the same reason `askedQuestionsFor`'s
// guard never changes a well-formed caller's result.
export function latestQuestionEntry(questions) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) return null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && !list[i].provisional) return list[i];
  }
  return list[list.length - 1] || null;
}

// AC-T1.10: the pin decision. `pinnedId` names an entry to hold on screen
// while newer questions keep arriving underneath it (T1 — a candidate's own
// "let me think about that" must not evict the question they are currently
// answering). Degrading to latestQuestionEntry(questions) for a null/
// undefined pin is what keeps every unpinned caller byte-identical to
// today — nothing changes for either mode until something actually pins.
//
// The stale-pin fallback (pinnedId names an entry no longer in the list) is
// load-bearing, not a convenience: a cleared feed or a new session must
// never blank the panel a candidate is reading mid-interview by returning
// null for an id that simply does not exist anymore. Falling back to
// latestQuestionEntry keeps the same "always show the best available
// entry, never nothing" guarantee latestQuestionEntry itself already gives
// an empty list.
export function pinnedQuestionEntry(questions, pinnedId) {
  const list = Array.isArray(questions) ? questions : [];
  if (pinnedId === null || pinnedId === undefined) return latestQuestionEntry(list);
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].id === pinnedId) return list[i];
  }
  return latestQuestionEntry(list);
}

// AC-T1.11: how many entries arrived after the pinned one, for the "Held on
// screen" badge (AC-T1.16) to say "2 newer questions detected" rather than
// leave a pin silently stale. `0` covers three distinct cases the same way
// on purpose: nothing pinned, the pinned entry is already last, and the
// pinned id can no longer be found (the same stale-pin situation
// pinnedQuestionEntry falls back for above) — none of those is "many newer
// questions", so none should read as one.
//
// F4: null elements after the pinned entry are skipped, not counted, same as
// latestQuestionEntry's own BUG-4 guard. `list.length - 1 - i` (the previous
// implementation) counts holes as questions, so `[q1, null, null, q2]` would
// render "3 newer questions detected" when only one actually arrived.
export function newerQuestionCount(questions, pinnedId) {
  const list = Array.isArray(questions) ? questions : [];
  if (pinnedId === null || pinnedId === undefined) return 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].id === pinnedId) {
      let count = 0;
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[j]) count += 1;
      }
      return count;
    }
  }
  return 0;
}
