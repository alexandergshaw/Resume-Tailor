"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchRoleSituation, fetchRoleResponse } from "@/lib/copilot/roleDrillClient";
import {
  EMPTY_ROLE_ENTRY,
  getAskedPrompts,
  getRoleDrillEntry,
  recordAnswer,
  recordSituation,
  setRevealVisible,
  subscribeRoleDrill,
} from "./roleDrillStore";

// AC-Q9 - all the state behind the "Speak as" drill: the situation on screen
// and the (optional) revealed model answer for it. Components under
// app/copilot/roles/ are presentational; every decision here is a plain
// value this hook computes, the same split useSampleAnswer.js and
// useApplicationDocs.js already draw between "state" and "what to show".
//
// SESSION-SCOPED STATE LIVES IN THE STORE, NOT IN `useState` (post-AC-Q9
// fix): the asked list, the last situation shown, and every revealed answer
// per role are all read from roleDrillStore.js via `useSyncExternalStore`,
// exactly the way useRoleChoice.js reads the persisted role. That's what
// makes leaving "Speak as" (which unmounts this whole tree - see
// CopilotClient's mode ternary) and coming back RESTORE the drill the user
// was mid-way through, instead of a fresh `useState` losing everything and
// the mount effect below paying for another fetchRoleSituation the user
// never asked for. Only two things stay in local `useState`: an in-flight
// fetch's transient loading/error state, which has no business surviving a
// remount (a retry is always available; a stale error certainly shouldn't
// resurrect itself as if it just happened).
//
// SITUATION LOADING, GATED ON WHAT'S ALREADY KNOWN: the mount/role-change
// effect below only calls fetchRoleSituation when the store has NOTHING for
// the current role yet - AC-Q0.2 still holds (a role visited for the first
// time has nothing known, so it still fetches with no click), but a role
// the store already has an answer for restores instantly. Nothing here ever
// calls a React state setter synchronously from the effect body - the store
// write (`recordSituation`) and its `notify()` only ever happen inside a
// `.then`/`.catch`, and `setFetchError`, the one real `useState` setter this
// file owns, is never reachable synchronously from the effect either - see
// useApplicationDocs.js's own comment for the fuller version of this same
// argument about react-hooks/set-state-in-effect.
//
// A monotonic `genRef` gates which situation request's result is allowed to
// write the store at all - the useSampleAnswer.js/useApplicationDocs.js
// pattern - so a slow situation for a role the user has since moved off
// repaints nothing even when it resolves last (AC-Q9.2). `revealGenRef`
// does the identical job for the reveal, independently, since the two can
// be in flight at once.
export function useRoleDrill(role) {
  // ---- situation ------------------------------------------------------
  const entry = useSyncExternalStore(
    subscribeRoleDrill,
    () => getRoleDrillEntry(role),
    () => EMPTY_ROLE_ENTRY,
  );
  const genRef = useRef(0);
  // Transient only - never written to the store, so an old failure can
  // never resurface on a later, unrelated mount.
  const [fetchError, setFetchError] = useState(null); // { forRole, message } | null
  // BUG (adversarial review): with nothing gating it, five fast clicks on
  // "New situation" fired five authenticated fetchRoleSituation calls; four
  // were discarded by `genRef` above but - because that guard runs AFTER
  // the request is already sent - all five still hit the server, and the
  // asked-list write for the four discarded ones never happens, so the
  // server can serve those exact situations again later. Also transient
  // only, and only ever flipped `true` from an EVENT HANDLER (below), never
  // from the mount/role-change effect - see that effect's own comment.
  const [situationLoading, setSituationLoading] = useState(false);

  const requestSituation = useCallback((forRole) => {
    const gen = (genRef.current += 1);
    fetchRoleSituation({ role: forRole, asked: getAskedPrompts(forRole) })
      .then((json) => {
        setSituationLoading(false);
        if (genRef.current !== gen) return;
        recordSituation(forRole, json?.situation || null, json?.exhausted);
        setFetchError(null);
      })
      .catch((err) => {
        setSituationLoading(false);
        if (genRef.current !== gen) return;
        setFetchError({ forRole, message: err?.message || "Could not load a situation." });
      });
  }, []);

  // Fires on mount and on every `role` change - entering the mode IS the
  // request (AC-Q0.2), but only when there's nothing to show yet. A role
  // the store already has a situation for (the user is returning to it,
  // whether that's a mode switch or a page reload) is shown immediately,
  // no network call. Deliberately never touches `situationLoading`: that
  // flag only disables a button, and there is no button to disable yet
  // while this effect is the one fetching the FIRST situation for a role
  // (SituationCard renders no actions at all until `situation` exists) -
  // setting React state synchronously here, even by calling a shared
  // helper, is also exactly what react-hooks/set-state-in-effect exists to
  // catch (see useApplicationDocs.js's own comment for the fuller version
  // of this argument).
  useEffect(() => {
    if (!getRoleDrillEntry(role).situation) {
      requestSituation(role);
    }
  }, [role, requestSituation]);

  // "New situation" always fetches - the whole point of the button - and
  // always records its own prompt into that role's asked list via
  // requestSituation's own success handler. An event handler, not an
  // effect, so flipping `situationLoading` synchronously here (to disable
  // the button for the duration of exactly one request) is fine.
  const requestNewSituation = useCallback(() => {
    setSituationLoading(true);
    requestSituation(role);
  }, [role, requestSituation]);

  // A failed situation load's own retry - also always fetches, also an
  // event handler.
  const retrySituation = requestNewSituation;

  const situation =
    fetchError && fetchError.forRole === role
      ? null
      : entry.situation;
  const situationStatus =
    fetchError && fetchError.forRole === role ? "error" : entry.situation ? "done" : "loading";
  const situationError = fetchError && fetchError.forRole === role ? fetchError.message : "";

  // ---- revealed model answer -------------------------------------------
  // Whether the CURRENTLY on-screen situation's answer is showing, per the
  // store - independent of whether it's cached from a fetch this mount
  // made or restored from a completely earlier session.
  const revealVisible = !!(situation && entry.revealedSituationId === situation.id);
  const cachedPayload = situation ? entry.answers[situation.id] : undefined;

  const revealGenRef = useRef(0);
  // Transient only, same reasoning as `fetchError` above - a loading spinner
  // or a failed draft has no business surviving a remount, and hiding an
  // errored panel must be able to cancel it outright rather than merely
  // toggle a stored flag a slow response could still overwrite.
  const [revealFetch, setRevealFetch] = useState(null); // { forSituationId, status, error } | null

  const runReveal = useCallback((sit, forRole) => {
    const gen = (revealGenRef.current += 1);
    setRevealFetch({ forSituationId: sit.id, status: "loading", error: "" });
    fetchRoleResponse({ role: forRole, situationId: sit.id, situationPrompt: sit.prompt })
      .then((json) => {
        if (revealGenRef.current !== gen) return;
        recordAnswer(forRole, sit.id, {
          lines: Array.isArray(json?.lines) ? json.lines : [],
          cadence: Array.isArray(json?.cadence) ? json.cadence : [],
          terms: Array.isArray(json?.terms) ? json.terms : [],
          termsUsed: Array.isArray(json?.termsUsed) ? json.termsUsed : [],
          avoid: Array.isArray(json?.avoid) ? json.avoid : [],
          source: json?.source || "",
          // AC-Q9 follow-up (adversarial review): a generated situation id
          // is never in the bank, so a Gemini failure falls back to the
          // register's generic beats - an answer about a slipped deadline
          // under a scene about two engineers competing for a promotion,
          // captioned only "Gemini could not draft this one". Missing
          // entirely (a response shape that predates this field) reads as
          // matched, same as an explicit `true` - only a literal `false`
          // means the beats aren't actually about this scene.
          situationMatched: json?.situationMatched !== false,
        });
        setRevealFetch(null);
      })
      .catch((err) => {
        if (revealGenRef.current !== gen) return;
        setRevealFetch({
          forSituationId: sit.id,
          status: "error",
          error: err?.message || "Could not draft a model answer.",
        });
      });
  }, []);

  const revealingNow = !!(revealFetch && situation && revealFetch.forSituationId === situation.id);

  // The reveal is a disclosure (AC-Q9.6): a second click on an already-open
  // panel just hides it, never re-requesting - and cancels an in-flight or
  // errored request outright, so a slow response for a panel the user has
  // since closed can never silently reopen it. Opening a hidden panel
  // serves the cache when one exists for this exact situation id
  // (AC-Q9.4/AC-Q0.5) and fetches only when it doesn't.
  const toggleReveal = useCallback(() => {
    if (!situation) return;
    if (revealingNow || revealVisible) {
      revealGenRef.current += 1;
      setRevealFetch(null);
      setRevealVisible(role, situation.id, false);
      return;
    }
    const cached = entry.answers[situation.id];
    if (cached) {
      setRevealVisible(role, situation.id, true);
      return;
    }
    runReveal(situation, role);
  }, [situation, revealingNow, revealVisible, role, entry.answers, runReveal]);

  // A failed reveal's own Retry - distinct from the toggle above, which
  // would otherwise just hide an already-open (errored) panel instead of
  // trying again.
  const retryReveal = useCallback(() => {
    if (!situation) return;
    runReveal(situation, role);
  }, [situation, role, runReveal]);

  const reveal = revealingNow
    ? { visible: true, status: revealFetch.status, error: revealFetch.error, payload: null }
    : revealVisible
      ? { visible: true, status: "done", error: "", payload: cachedPayload || null }
      : { visible: false, status: null, error: "", payload: null };

  return {
    situation,
    situationStatus,
    situationError,
    situationLoading,
    exhausted: !fetchError && !!entry.exhausted,
    requestNewSituation,
    retrySituation,
    reveal,
    toggleReveal,
    retryReveal,
  };
}
