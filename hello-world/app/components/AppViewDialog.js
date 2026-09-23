"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useIsMobile } from "../hooks/useResponsive";
import { usePrepGeneration } from "../hooks/usePrepGeneration";
import { usePrepActionQueue } from "../hooks/usePrepActionQueue";
import FieldError from "./FieldError";
import FormattedContent from "./FormattedContent";
import DigestPanel from "./tracking/DigestPanel";
import PrepPackPanel from "./tracking/PrepPackPanel";
import { triggerBlobDownload } from "@/lib/document/download";

// The digest tab's body lives in ./tracking/DigestPanel.js. It moved out
// because it grew the thing this dialog cannot host: citation markers, three
// separately labelled source groups, and the four states that look alike but
// mean opposite things (cited / never searched / searched-and-none-placed /
// written before the pipeline existed). None of that is falsifiable while it
// is a private function inside a component that needs a page-sized prop tree
// to mount.
//
// The interview-prep tab's body lives in ./tracking/PrepPackPanel.js, for the
// same reason plus one more (design-reconciled.r2.md ss5.3/ss4.2): it must
// never import prepStore.js/prepParse.js/prepPack.js/trustedNames.js, because
// those carry the O-15 given-name lexicon at module scope, and this dialog is
// itself a "use client" file -- so THIS file cannot import them either. Pack
// content, section completeness, and both name fields all arrive here as
// plain JSON from the server-only GET /api/interview-prep route instead.

/** F-1's fix (chunk N33/N25 blocker): the ONLY client caller of `PUT
 *  /api/interview-prep` -- PrepPackPanel's own header says it must never
 *  fetch for itself, so this is the production call site `onSaveNames`
 *  wires to below, exactly like `downloadPrepLog` below is the wiring for
 *  `onDownloadLog`. Exported (unlike `downloadPrepLog`) so a test can call
 *  it directly rather than mounting this whole dialog's full prop tree.
 *  Always sends BOTH `candidateName` and `interviewerNamesText` together --
 *  see PrepPackPanel.js's own header (F-7) for why a partial body would
 *  silently wipe whichever field it omits. */
export async function saveTrustedNames(applicationId, { candidateName, interviewerNamesText }) {
  const res = await fetch("/api/interview-prep", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, candidateName, interviewerNamesText }),
  });
  return res.json();
}

/** N29/DS-N29.7: the interview-prep GET fetch, extracted from the mount
 *  effect's own body so it is callable from two sites -- the mount/reopen
 *  effect below, and the N53 queue's settled handler's own post-action
 *  refetch -- with exactly one implementation, not two independently-
 *  maintained copies. The setter is threaded in as a parameter, not closed
 *  over, so this stays a plain, directly-testable module function (mirroring
 *  `saveTrustedNames` above), rather than a closure only reachable by
 *  mounting the whole dialog. Every POST/PATCH branch this route can return
 *  carries no pack content of its own (route.js's own terminal writes are
 *  `{status}` only), so a completed generation or restore is only ever
 *  reflected by re-running this GET. */
// M-3 (N50 fix round 3): resolves to the fetched body (or the same error
// shape the `catch` branch already wrote into state) rather than the setter
// call's own return value -- so a caller that needs to know WHAT a refetch
// saw (the settled handler's own follow-up polling below) can decide whether
// to poll again without a second, independent fetch implementation. Every
// existing direct-call assertion (AppViewDialog.messageFor.test.js) only
// ever inspects the calls this makes, never what `fetchPrep(...)` itself
// resolves to, so this is additive, not a contract change.
//
// B-1 (N50 fix round 5, verify.r5.md): every GET this feature issues goes
// through this one function -- the mount/reopen effect, the queue's settled
// handler, the scheduled follow-up chain, and "Check again" all call it via
// `fetchPrepForRow` below. verify.r5.md's own blocker: the settled handler
// `await`s this call with no bound of its own, so a GET that simply never
// answers (a stalled connection, an edge function that accepted and hung --
// the same failure class the queue's own send timeout exists for) left
// `drain()` (prepActionQueue.js) awaiting forever, which meant `active` --
// and therefore `generating` -- never cleared. Bounded the SAME way `send`
// already is (prepActionQueue.js's own header): an AbortController paired
// with a timer, so a hung GET settles (via the existing `catch` branch,
// which already turns a rejection into an honest error shape) within a
// known window, whatever the network is doing. `PREP_FETCH_TIMEOUT_MS` is
// far shorter than the send's own ~165s: a plain read carries no server-side
// claim lease to wait out.
const PREP_FETCH_TIMEOUT_MS = 20_000;

export function fetchPrep(applicationId, setPrepById, { timeoutMs = PREP_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(`/api/interview-prep?applicationId=${encodeURIComponent(applicationId)}`, { signal: controller.signal })
    .then((res) => res.json())
    .then((data) => {
      clearTimeout(timer);
      // N50 final polish (verify.r8.md minor m-2): `res.json()` can resolve
      // to a literal JSON `null` (or any other non-object) without ever
      // throwing -- an empty/non-JSON body throws instead, which the
      // `catch` below already turns into `{error}`. A `null` written
      // verbatim left `dPrep` falsy, so the dialog's `!dPrep` branch (this
      // file's own header, above) never ends: no real body was ever
      // written, but nothing here noticed. Coerced into the SAME read-error
      // shape the `catch` branch writes, so the guarantee that header
      // states is actually true, not merely asserted.
      const written = data && typeof data === "object" ? data : { error: "Could not load your prep pack." };
      setPrepById((prev) => ({ ...prev, [applicationId]: written }));
      return written;
    })
    .catch(() => {
      clearTimeout(timer);
      const data = { error: "Could not load your prep pack." };
      setPrepById((prev) => ({ ...prev, [applicationId]: data }));
      return data;
    });
}

/** N46's restore control -- the ONLY client caller of `PATCH
 *  /api/interview-prep`. Body is exactly `{applicationId, section,
 *  revision}`: `expectedUpdatedAt` is read server-side, in the same request
 *  (route.js's own PATCH handler), never supplied by the client -- see that
 *  handler's own header (plan risk R13) for why. Module-private, unlike
 *  `saveTrustedNames`/`fetchPrep` above: this one's own reachability test
 *  (AppViewDialog.prepRestore.reachability.test.js) drives it through the
 *  real rendered control, never by name, so exporting it would only add an
 *  unreachable export (lib/sourceScan/exportReachability.sweep.test.js's
 *  own ORPHAN_EXPORTS bucket). */
// M-1 (N50 fix round 2): `signal`, when the queue hands one in, rides
// straight into `fetch` -- same wiring as usePrepGeneration.js's own
// requestPrepGeneration, so a restore that outlives the queue's timeout is
// also actually stopped, not merely stopped being waited on.
async function restoreSectionRevision(applicationId, section, revision, signal) {
  const res = await fetch("/api/interview-prep", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, section, revision }),
    signal,
  });
  return res.json();
}

/** N29: maps a `usePrepGeneration` result to the transient message
 *  `PrepPackPanel` shows for an outcome that leaves no trace in the
 *  persisted pack row (disabled / refused / a bare error) -- a normal
 *  terminal status (ready/partial/failed/unavailable) needs no message of
 *  its own, since the panel's own `StatusBanner` already renders it off the
 *  refetched pack. Total: never throws, never returns `undefined`, so its
 *  caller can always render the return value directly. `"attempts-spent"` is
 *  no longer a value the server can produce once N41's cap-removal migration
 *  lands, so it is not special-cased here -- an unrecognized `reason` falls
 *  to the same generic "refused" copy as a genuine claim-RPC error. */
export function messageFor(result) {
  if (result?.status === "disabled") {
    return "Interview prep isn't available right now. Nothing was generated — try again later.";
  }
  if (result?.status === "refused") {
    if (result.reason === "in-flight") {
      return "A prep pack is already being generated for this application. Wait for it to finish, then check back.";
    }
    return "Something went wrong starting this attempt. Try again.";
  }
  return result?.error || "Something went wrong. Try again.";
}

const GENERATE_TERMINAL_STATUSES = ["ready", "partial", "failed", "unavailable"];

// M-3 (N50 fix round 3): deltas from the timeout's OWN first refetch, not
// from each other -- the first entry fires ~20s after that refetch, the
// second ~60s after it (40s later still), matching verify.r3.md's own
// example. Bounded: once both have run with no non-running reply, the
// candidate's own explicit retry control (restored by B-1's fix, below) is
// the way out, not an unbounded background poll.
const TIMEOUT_FOLLOW_UP_DELAYS_MS = [20_000, 40_000];

/** B-1 (N50 fix round 4, verify4.md): a whole-pack result this session must
 *  treat the same way it treats a `timedOut` one -- "I stopped actively
 *  waiting on this, but the server may still be holding its claim, so keep
 *  checking rather than either blocking forever or pretending nothing is
 *  happening." A `timedOut` result is the client giving up on its OWN
 *  request. A `{status:"refused", reason:"in-flight"}` result is the server
 *  saying a claim -- possibly this session's own just-abandoned one -- is
 *  STILL live; verify4.md's B-1 path 3 measured that retrying the whole-pack
 *  control after a timeout meets exactly this reply, and the old code never
 *  refetched, released the block, or scheduled a follow-up for it, which put
 *  the panel right back in the zero-control state the retry exists to leave.
 *  Deliberately NOT applied to a section's own outcome (PrepPackPanel.js's
 *  `runningSectionName` stays `timedOut`-only): PrepPackPanel.
 *  queueDisplay.test.js's own "an outcome is still reported while the
 *  section's controls are unavailable (a running pack)" case pins a section's
 *  OWN `refused`/`in-flight` restore outcome as a state that leaves that
 *  section's controls blocked, on purpose -- a plain refusal, unlike a
 *  timeout, is not evidence THIS attempt is still running. */
function releasesTimeoutBlock(result) {
  return result?.timedOut === true || (result?.status === "refused" && result?.reason === "in-flight");
}

/** Builds the "Download prep log" content from the `events` array the GET
 *  route's own response already carries -- never a second, independent
 *  download mechanism (AC-N33.21's own bar). Hosts/outcomes only, matching
 *  this repo's other feature logs' own discipline of never re-deriving pack
 *  content into a download. */
function downloadPrepLog(dApp, dPrep) {
  const events = Array.isArray(dPrep?.events) ? dPrep.events : [];
  const lines = [
    "# Interview prep activity log",
    "",
    `Application: ${dApp?.id || "unknown"}`,
    "",
    ...events.map(
      (e) =>
        `- ${e.at || "unknown time"}: ${e.event_type || "event"} (${e.outcome || "unknown"})${
          e.reason ? ` — ${e.reason}` : ""
        }`
    ),
  ];
  triggerBlobDownload(
    new Blob([`${lines.join("\n")}\n`], { type: "text/markdown" }),
    `interview-prep-log-${dApp?.id || "row"}.md`
  );
}

export default function AppViewDialog({
  appDialog,
  setAppDialog,
  applicationData,
  communicationsDialog,
  loadCommunicationsForApp,
  openAddCommunicationDialog,
  digestsById = {},
  researchingIds,
  researchOne,
}) {
  const isMobile = useIsMobile();

  // "Researched <relative time>" needs a wall-clock reference, and calling
  // Date.now() directly during render is impure (the same trap
  // LiveFeedTab.js's own `nowTs` comment documents) - resolved once after
  // mount instead, in an effect, same as that file's fix.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setNowTs(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  // N25/N33's read surface. Fetched on demand (only once per application,
  // never re-fetched merely for switching pages back and forth) from the
  // server-only GET route -- never from a client-side prepStore.js/
  // prepParse.js import, per this file's own header.
  const [prepById, setPrepById] = useState({});
  const dApp = appDialog.rowIndex != null ? applicationData[appDialog.rowIndex] : null;
  const dPos = dApp?.positions;
  const dResume = dApp?.generated_resumes;
  const dDigest = dApp?.id ? digestsById[dApp.id] : null;
  const dPrep = dApp?.id ? prepById[dApp.id] : null;
  // N29's coordinator-named defect: the id "last fetched fresh for, since
  // the dialog was last opened" -- reset to null on close, so the very next
  // "prep" open (same row or a different one) always fetches fresh, instead
  // of the old guard's `|| prepById[dApp.id]) return`, which never refetched
  // a cached snapshot once one existed (including a stale `status:"running"`
  // left behind by an automatic B1/B3 trigger nobody in this session is
  // watching). Paging between kinds within one open session still never
  // refetches -- the ref stays equal to `dApp.id` for the whole time the
  // dialog stays open.
  const prepFetchedForRef = useRef(null);
  // V-1 fix (N29/N41 verification round 2): guards a fetchPrep write against
  // a SLOWER, now-superseded GET for the same application landing AFTER a
  // fresher one already has -- restoring the staleness protection the
  // pre-N29 effect held via `let cancelled = false` (dropped when the
  // reopen-refetch fix above landed), without reinstating that effect's OWN
  // bug (prepFetchedForRef, just above, already fixes the
  // never-refetches-once-cached defect and is untouched by this). A
  // monotonic counter per applicationId, not a single boolean, since more
  // than one request for the same id can be reachable at once (this effect
  // and the N53 queue's settled handler both call this). Lives OUTSIDE
  // `fetchPrep` itself -- that function stays the plain, unconditional
  // `(applicationId, setPrepById)` module export
  // AppViewDialog.messageFor.test.js already pins directly as its own
  // contract, so the guard wraps the SETTER this component passes in,
  // rather than changing fetchPrep's own behavior.
  // M-3 (N50 fix round 3): resolves to `{applied, data}` -- `data` is
  // whatever this GET actually saw, and `applied` is whether it was still
  // the latest request by the time it settled (the SAME staleness check the
  // setter guard below already makes, exposed to the caller instead of only
  // acted on internally) -- so the settled handler's own follow-up polling
  // can both read the reply and know whether a NEWER request has already
  // superseded it, without a second staleness mechanism.
  const prepRequestSeqRef = useRef({});
  function fetchPrepForRow(applicationId) {
    const seq = (prepRequestSeqRef.current[applicationId] || 0) + 1;
    prepRequestSeqRef.current[applicationId] = seq;
    return fetchPrep(applicationId, (updater) => {
      if (prepRequestSeqRef.current[applicationId] !== seq) return;
      setPrepById(updater);
    }).then((data) => ({ applied: prepRequestSeqRef.current[applicationId] === seq, data }));
  }

  // N29: the manual "prepare me for this interview" control
  // (usePrepGeneration.js). `generatingIds` is no longer read here -- N50/N53
  // moved "what is in flight" to the action queue below, which spans a
  // section's own post-success refetch too (that hook's own in-flight signal
  // does not).
  const { generateNow } = usePrepGeneration();

  // N50/N53: the module-scope action queue (plan.r2.md section 3). Declared
  // BEFORE the open/refetch effect below, because that effect's fresh-open
  // branch calls `dropSeenOutcomes`.
  const {
    state: q,
    enqueue,
    setSettledHandler,
    markOutcomesSeen,
    dropSeenOutcomes,
    retireStaleTimedOut,
    cacheReadyPack,
    cachedPack,
  } = usePrepActionQueue(dApp?.id ?? null);

  // M2 (N50 fix round 1): whenever a GET actually lands real pack content
  // (any status but `running` -- the server blanks the pack row the moment a
  // claim starts, per route.js's own GATE 9), remember it as this
  // application's own "last known ready pack", outside React, at the SAME
  // module scope and lifetime as the queue above (usePrepActionQueue.js).
  // This is what a reopen mid-action reads below, instead of the empty pack
  // the server honestly reports while a claim is live.
  //
  // M-1/M-2 (N50 fix round 5, verify.r5.md): the SAME effect also retires a
  // stale `timedOut` outcome, every time this application's own `dPrep`
  // changes -- the mount/reopen GET, the settled handler's own refetch, a
  // scheduled follow-up, or "Check again" all land here. `dPrep.status !==
  // "running"` is the strongest signal (the claim that outcome was about is
  // provably over); `retireStaleTimedOut` itself also expires one that is
  // simply too old to still plausibly be about the same claim even while
  // `status` keeps reading `running` -- see that function's own header
  // (prepActionQueue.js) for both branches.
  useEffect(() => {
    if (!dApp?.id || !dPrep) return;
    if (dPrep.status !== "running" && dPrep.pack) cacheReadyPack(dApp.id, dPrep);
    retireStaleTimedOut(dApp.id, dPrep.status === "running");
  }, [dApp?.id, dPrep, cacheReadyPack, retireStaleTimedOut]);

  useEffect(() => {
    if (!appDialog.open) {
      prepFetchedForRef.current = null;
      return;
    }
    if (appDialog.kind !== "prep" || !dApp?.id || prepFetchedForRef.current === dApp.id) return;
    prepFetchedForRef.current = dApp.id;
    // N50/AC-N50.16(b): a fresh open is where a SEEN outcome's lifetime ends
    // (an outcome nobody has seen yet survives it -- see the settled-outcome
    // effect below). Runs once per fresh open even under StrictMode's double
    // effect invocation, because the ref guard above already gates entry to
    // this branch to once per (open, application) pair.
    dropSeenOutcomes(dApp.id);
    fetchPrepForRow(dApp.id);
  }, [appDialog.kind, appDialog.open, dApp?.id, dropSeenOutcomes]);

  // N50/AC-N50.16(b): an outcome is marked seen once the panel is actually
  // showing it -- not merely once the dialog is open, and not merely once
  // the GET has been requested, but once the prep VIEW for this application
  // is on screen. `panelShown` mirrors the render branch below exactly.
  // Cannot loop: once every outcome is already seen, `markOutcomesSeen` is a
  // no-op (no state change, no notification), so this effect's own
  // dependency (`q.outcomes`) does not re-fire it.
  // N50 fix round 6 (verify.r6.md B-1): the `dPrep.error && !dPrep.status`
  // exclusion used to mirror the render branch below skipping the panel
  // entirely for a failed read -- that branch no longer does (see its own
  // header, further down), so this no longer excludes it either.
  const panelShown = appDialog.open && appDialog.kind === "prep" && !!dPrep;
  useEffect(() => {
    if (panelShown && dApp?.id) markOutcomesSeen(dApp.id);
  }, [panelShown, dApp?.id, q.outcomes, markOutcomesSeen]);

  // N50/N53: the queue's settled handler -- what happens once a generate or
  // restore request this dialog enqueued settles. Refetches only when the
  // reply actually changed the persisted pack (a `restored` restore, or a
  // generate reply that is not itself a refusal/disabled marker); a
  // section's own refusal or a restore conflict is rendered by
  // PrepSectionActions straight off the queue's outcome instead.
  //
  // M-1 (N50 fix round 2): a `timedOut` outcome ALSO refetches, regardless of
  // `kind` -- the client gave up on the reply, but the server's own claim
  // lease is close enough to the queue's timeout that the server may have
  // finished anyway. This is "state unknown, go check" rather than a
  // recognized terminal status. (fetchPrepForRow's own staleness guard,
  // prepRequestSeqRef above, already drops any of these GETs' results if a
  // later request -- e.g. the candidate's own retry -- has since started a
  // fresher one.)
  //
  // M-3 (N50 fix round 3, verify.r3.md): ONE refetch fired the instant the
  // client gives up almost always lands inside the server's own claim lease
  // still `running` -- the reply the client just stopped waiting for can
  // land a second later, and a single immediate check can never observe it.
  // `scheduleTimeoutFollowUps` below polls a SMALL, bounded number of times
  // more, spaced past where the lease could plausibly have cleared, stopping
  // the moment a reply is no longer an empty `running` body or the attempts
  // run out -- never indefinitely. It is deliberately NOT awaited by the
  // handler itself: `drain()` (prepActionQueue.js) awaits the settled
  // handler before moving the queue on, so an awaited multi-minute poll here
  // would leave that action "active" -- and its control replaced rather than
  // restored -- for the whole polling window, which is exactly the
  // zero-controls state B-1 exists to end.
  //
  // Split into two effects (m3): the closure that reads the latest
  // `fetchPrepForRow` is refreshed in a plain, dependency-less effect after
  // EVERY commit -- never assigned during render, which `react-hooks/refs`
  // correctly flags as a lint error -- and the queue is handed a stable
  // trampoline that only ever reads `handlerRef.current`, registered once.
  //
  // M-4 (N50 fix round 4, verify4.md): a fire-and-forget `setTimeout` loop
  // with no `AbortController` and no cleanup was what let the scheduled
  // follow-ups outlive their own reason to exist -- verify4.md measured 2
  // further GETs, past both the dialog's own unmount AND its Close button,
  // each one calling `setPrepById` on an instance that is gone.
  // `followUpsAllowedForRef` names the ONE applicationId this instance
  // currently allows a follow-up chain to poll for -- `dApp?.id` while
  // mounted with `appDialog.open` true, `null` the instant either stops
  // being so. A plain boolean "cancelled" flag is not enough: reusing this
  // dialog INSTANCE for a DIFFERENT application (close, then reopen on a
  // new row -- React updates the SAME component with new props, never an
  // unmount) would un-cancel a chain still captured over the OLD id the
  // moment the new one opens, so it is the id itself that is compared, not
  // merely whether the dialog happens to be open. The loop below checks it
  // right after every wait, so a cancellation that lands mid-wait stops the
  // NEXT fetch, never merely the next scheduling call; `handlerRef.current`
  // also checks it before ever STARTING a chain -- the module-scope queue
  // outlives this instance (AC-N50.15(e)), so an entry can still settle,
  // and this ref (unlike `handlerRef`/`scheduleTimeoutFollowUpsRef`
  // themselves, which React never clears on unmount) is the one thing that
  // tells a stale closure it must not begin new work.
  const followUpsAllowedForRef = useRef(null);
  useEffect(() => {
    followUpsAllowedForRef.current = appDialog.open ? (dApp?.id ?? null) : null;
  });
  useEffect(() => {
    return () => {
      followUpsAllowedForRef.current = null;
    };
  }, []);
  const scheduleTimeoutFollowUpsRef = useRef(null);
  useEffect(() => {
    scheduleTimeoutFollowUpsRef.current = async (applicationId) => {
      for (const delayMs of TIMEOUT_FOLLOW_UP_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (followUpsAllowedForRef.current !== applicationId) return;
        const { applied, data } = await fetchPrepForRow(applicationId);
        if (!applied || data?.status !== "running") return;
      }
    };
  });
  const handlerRef = useRef(null);
  useEffect(() => {
    handlerRef.current = async (entry, result) => {
      // B-1 (N50 fix round 4): `releasesTimeoutBlock` also fires a refetch
      // for a whole-pack retry's own `refused`/`in-flight` reply -- see that
      // function's own header for why sections stay `timedOut`-only.
      const givenUp = entry.target === "pack" ? releasesTimeoutBlock(result) : result?.timedOut === true;
      const refetch =
        givenUp ||
        (entry.kind === "generate" && result?.status !== undefined && result.status !== "disabled" && result.status !== "refused") ||
        (entry.kind === "restore" && result?.status === "restored");
      if (!refetch) return;
      const first = await fetchPrepForRow(entry.applicationId);
      if (givenUp && first.applied && first.data?.status === "running" && followUpsAllowedForRef.current === entry.applicationId) {
        scheduleTimeoutFollowUpsRef.current?.(entry.applicationId);
      }
    };
  });
  useEffect(() => setSettledHandler((entry, result) => handlerRef.current?.(entry, result)), [setSettledHandler]);

  // N50/N53: the panel's display props, derived from the queue's snapshot for
  // THIS application. `q.active`/`q.queued` never carry more than one
  // "pack"-targeted entry each (the queue itself refuses a duplicate target),
  // so `generating` reflects the whole-pack action alone -- a section's own
  // in-progress state (including its post-success refetch, since `active`
  // stays set until the settled handler above resolves) never flips the
  // whole-pack control into "Generating…" (AC-N50.16(c)).
  const sectionActivity = {};
  for (const [entry, state] of [[q.active, "in-progress"], ...q.queued.map((e) => [e, "queued"])]) {
    if (entry && entry.target !== "pack") sectionActivity[entry.target] = { state, kind: entry.kind, revision: entry.revision };
  }
  const wholePackQueued = q.queued.some((e) => e.target === "pack");
  const sectionOutcomes = {};
  for (const [target, outcome] of Object.entries(q.outcomes)) {
    if (target !== "pack") sectionOutcomes[target] = outcome;
  }
  const packOutcome = q.outcomes.pack;
  const packMessage =
    packOutcome && !GENERATE_TERMINAL_STATUSES.includes(packOutcome.result?.status) ? messageFor(packOutcome.result) : null;
  // B-1 (N50 fix round 3): this session's OWN whole-pack action timed out and
  // the server is still (or again) reporting `running` -- see the matching
  // comment on `timedOutSectionTarget` below for why `status==="running"`
  // alone must stop meaning "block everything" once this session has already
  // given up waiting on it. A `disabled` outcome, or a `refused` one for any
  // OTHER reason, must keep blocking, since a fresh click there would only
  // spend another rate-limit token repeating the exact same refusal.
  //
  // B-1 (N50 fix round 4, verify4.md): `releasesTimeoutBlock` (above) widens
  // this to ALSO release on `refused`/`in-flight` -- verify4.md's own path 3
  // measured that retrying the whole-pack control after a timeout meets
  // exactly that reply (the ORIGINAL claim is still live), and the round-3
  // code left THAT reply blocking forever: `packTimedOut` went back to
  // `false`, so the panel returned to the same zero-control dead end the
  // retry exists to leave.
  const packTimedOut = releasesTimeoutBlock(packOutcome?.result);

  // M2 (N50 fix round 1): `activeSectionTarget` is this session's OWN queue
  // naming which section (never "pack") is the currently active claim, if
  // any. While the server reports `running` for exactly that scenario, the
  // panel reads its CONTENT (pack/completeSections/names/revisions) from the
  // cached snapshot when one exists -- never the server's honestly-empty
  // running body -- while `status` itself is left alone (still the real
  // `dPrep.status`), so PrepPackPanel's own `runningSection` derivation
  // (from `sectionActivity`, computed there) still sees a genuine `running`
  // status and renders the section-named banner rather than the whole-pack
  // one. With no cache yet (first open mid-action), content stays the
  // server's own empty body, and the relaxed PackSections gate (M2) still
  // shows that section's in-progress line among the otherwise-empty headers.
  //
  // B-1 (N50 fix round 3, verify.r3.md): the client's own timeout can fire,
  // and its refetch land, WHILE the server's claim lease is still live --
  // 135 < 150 was pure arithmetic, and even the raised default only makes
  // this rarer, not impossible (the server can hold its claim past either
  // number). So `status:"running"` keeps being reported after this session
  // has already stopped waiting, and the queue's own `active` is `null` by
  // then (drain() clears it once the settled handler above returns). A
  // section whose OWN action timed out -- `sectionOutcomes[target].result.
  // timedOut`, which now persists until a FRESH action on that exact target
  // supersedes it (B-1, round 4: prepActionQueue.js's own `dropSeenOutcomes`
  // exempts a `timedOut` outcome, so merely reopening or remounting the
  // dialog no longer drops it -- verify4.md's B-1 paths 1 and 2) -- keeps
  // naming that same target here, so the cache stays on screen, the banner
  // keeps naming the section instead of claiming the whole pack, and (via
  // PrepPackPanel's own `runningSection` bypass, below) that section's own
  // control comes back as a retry rather than vanishing until the dialog is
  // closed and reopened.
  const timedOutSectionTarget =
    Object.keys(sectionOutcomes).find((target) => sectionOutcomes[target]?.result?.timedOut === true) || null;
  const activeSectionTarget = (q.active && q.active.target !== "pack" ? q.active.target : null) || timedOutSectionTarget;
  // M-1 (N50 fix round 4, verify4.md): a whole-pack action this session has
  // GIVEN UP ON (`packTimedOut`, now also covering the `refused`/`in-flight`
  // reply a retry meets) also reads from the cache, not only a section's own
  // timeout. verify4.md's own measurement: a whole-pack timeout rendered
  // every section as "No ... here yet." under a banner that still claimed
  // the pack was generating -- a run that is genuinely still live and one
  // this session has stopped waiting for are different states, and only the
  // second has no reason left to hide content the candidate can still read.
  // PrepPackPanel.js's own `sectionActionsHavePack` gate (M-2, verify4.md)
  // is what keeps this from ALSO re-offering per-section Regenerate/Restore
  // controls while the whole pack's own claim might still be live -- reading
  // the cache and offering to act on it are kept independent on purpose.
  // B-1 (N50 fix round 6, verify.r6.md): a failed READ is a THIRD reason to
  // prefer the cache over `dPrep` itself -- `fetchPrep`'s own `catch` branch
  // (this file's header, above) writes `{error}` with no `pack` of its own,
  // so without this a cache that already existed would read as gone the
  // instant a single refetch (or a first-open GET, or a row that a later
  // read can no longer find) failed. Unlike the `running` branch, this one
  // needs no `activeSectionTarget`/`packTimedOut` gate: a read failure
  // carries no server status at all to weigh against showing the cache --
  // when one exists, showing it is strictly better than showing nothing
  // (verify.r6.md's own B-1: "the cached pack disappears").
  const readError = !!dPrep?.error && !dPrep?.status;
  const usingCachedContent =
    (dPrep?.status === "running" && !!cachedPack && (!!activeSectionTarget || packTimedOut)) ||
    (readError && !!cachedPack);
  const prepContent = usingCachedContent ? cachedPack : dPrep;

  /** `opts` is forwarded as-is: `undefined` (the whole-pack GenerateControl's
   *  own call) targets `"pack"`; `{section}` (a per-section control's call)
   *  targets that section. Either way the request goes through the queue,
   *  never straight to `generateNow` -- AC-N50.15's one-outstanding-request
   *  rule lives here, above `usePrepGeneration`, because a restore does not
   *  go through that hook at all (plan.r2.md section 3.1). */
  function handleGenerateNow(opts) {
    if (!dApp?.id) return;
    const id = dApp.id;
    const section = opts?.section;
    // M-1 (N50 fix round 2): `send` now takes the queue's own AbortSignal and
    // forwards it to `generateNow`, so a timed-out request is actually
    // aborted rather than merely abandoned (see prepActionQueue.js's header).
    enqueue({
      applicationId: id,
      target: section || "pack",
      kind: "generate",
      send: (signal) => generateNow(id, { section, signal }),
    });
  }

  function handleRestoreRevision(section, revision) {
    if (!dApp?.id) return;
    const id = dApp.id;
    enqueue({
      applicationId: id,
      target: section,
      kind: "restore",
      revision,
      send: (signal) => restoreSectionRevision(id, section, revision, signal),
    });
  }

  const pages = [
    dApp?.id ? "communications" : null,
    dPos?.description ? "jd" : null,
    dResume?.content ? "resume" : null,
    dDigest?.markdown ? "digest" : null,
    dApp?.id ? "prep" : null,
  ].filter(Boolean);
  const pageIdx = pages.indexOf(appDialog.kind);
  const commsLoadedForThisApp =
    dApp && communicationsDialog.applicationId === dApp.id;
  const dialogTitle =
    appDialog.kind === "jd"
      ? `${dPos?.company || ""} — Job Description`
      : appDialog.kind === "resume"
        ? `Your Resume — ${dPos?.title || "Role"}`
        : appDialog.kind === "digest"
          ? `${dPos?.company || "Company"} & role — Research`
          : appDialog.kind === "prep"
            ? `Interview Prep${dPos?.company ? ` — ${dPos.company}` : ""}`
            : `Recruiter Communications${
              dPos?.company || dPos?.title
                ? ` — ${dPos?.company || "Unknown Company"}${dPos?.title ? ` / ${dPos.title}` : ""}`
                : ""
            }`;
  const navigate = (dir) => {
    if (pages.length === 0) return;
    const next = (pageIdx + dir + pages.length) % pages.length;
    const nextKind = pages[next];
    setAppDialog((prev) => ({ ...prev, kind: nextKind }));
    if (nextKind === "communications" && dApp && communicationsDialog.applicationId !== dApp.id) {
      loadCommunicationsForApp(dApp);
    }
  };
  return (
    <Dialog
      open={appDialog.open}
      onClose={() => setAppDialog({ open: false, rowIndex: null, kind: "jd" })}
      maxWidth="md"
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        onKeyDown: (e) => {
          if (e.key === "ArrowRight") navigate(1);
          if (e.key === "ArrowLeft") navigate(-1);
        },
        tabIndex: -1,
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            size="small"
            disabled={pages.length <= 1}
            onClick={() => navigate(-1)}
            sx={{ minWidth: 36, px: 0.75, fontSize: 22, lineHeight: 1 }}
            aria-label="Previous"
          >
            ‹
          </Button>
          <Box sx={{ flex: 1, fontWeight: 700, fontSize: "1rem" }}>
            {dialogTitle}
            {pages.length > 1 && (
              <Box component="span" sx={{ ml: 1.5, fontSize: 12, fontWeight: 400, color: "text.secondary" }}>
                {pageIdx + 1} / {pages.length}
              </Box>
            )}
          </Box>
          <Button
            size="small"
            disabled={pages.length <= 1}
            onClick={() => navigate(1)}
            sx={{ minWidth: 36, px: 0.75, fontSize: 22, lineHeight: 1 }}
            aria-label="Next"
          >
            ›
          </Button>
        </Box>
      </DialogTitle>
      {/* On a phone the dialog is already fullScreen, so a 70vh cap on the
          scrolling body leaves ~30% of the screen unused above a footer that
          has nowhere to go - and the source groups this feature adds are what
          gets pushed off the bottom. The cap is desktop-only. */}
      <DialogContent dividers sx={{ maxHeight: isMobile ? "none" : "70vh" }}>
        {appDialog.kind === "communications" ? (
          !commsLoadedForThisApp || communicationsDialog.loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : communicationsDialog.error ? (
            <FieldError>{communicationsDialog.error}</FieldError>
          ) : communicationsDialog.items.length === 0 ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "flex-start" }}>
              <p style={{ color: "var(--text-secondary)", margin: 0 }}>No recruiter communications logged yet.</p>
              {dApp ? (
                <Button size="small" variant="outlined" onClick={() => openAddCommunicationDialog(dApp)}>
                  Add Communication
                </Button>
              ) : null}
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {communicationsDialog.items.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    p: 1.5,
                    borderRadius: 2.5,
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg-soft)",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
                    <Chip size="small" label={item.direction || "inbound"} variant="outlined" />
                    <Chip size="small" label={item.type || "email"} variant="outlined" />
                    <Box component="span" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {item.communicated_at ? new Date(item.communicated_at).toLocaleString() : "Logged communication"}
                    </Box>
                  </Box>
                  {item.subject ? (
                    <Box sx={{ fontWeight: 700, mb: 0.75 }}>{item.subject}</Box>
                  ) : null}
                  {(item.sender_name || item.sender_email || item.sender_title) ? (
                    <Box sx={{ mb: 0.75, fontSize: 12, color: "var(--text-secondary)" }}>
                      {[item.sender_name, item.sender_title, item.sender_email].filter(Boolean).join(" · ")}
                    </Box>
                  ) : null}
                  <Box sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 13.5 }}>
                    {item.body || "—"}
                  </Box>
                </Box>
              ))}
            </Box>
          )
        ) : appDialog.kind === "digest" ? (
          <DigestPanel
            digest={dDigest}
            nowTs={nowTs}
            researching={!!researchingIds?.has?.(dApp?.id)}
            onResearchAgain={researchOne}
          />
        ) : appDialog.kind === "prep" ? (
          // B-1 (N50 fix round 6, verify.r6.md): a failed read used to render
          // a bare FieldError here -- no PrepPackPanel, so no control of any
          // kind, and the cached pack (if any) vanished from screen even
          // though `usingCachedContent` above already restores it into
          // `prepContent`. verify.r6.md measured this as the invariant's own
          // dead end, relocated rather than closed: the fetch that feeds this
          // branch is now bounded (this file's own `fetchPrep` header), but a
          // bounded fetch still fails sometimes -- a hung connection past its
          // own timeout, a first-open error, a row deleted in another tab --
          // and a load failure is the single most ordinary thing a network
          // request can do. The panel renders in every state once `dPrep`
          // exists; it is what actually reads `error` (via the `error` prop
          // below) and offers "Check again" for it -- see PrepPackPanel.js's
          // own `ReadErrorNotice`/`showCheckAgain` headers.
          //
          // M-1 (N50 fix round 7, verify.r7.md): `!dApp?.id` is its OWN
          // branch, checked FIRST. The row itself can leave `applicationData`
          // while this dialog stays open -- a filter, a delete from another
          // tab -- without `appDialog` ever closing on its own
          // (useApplicationDialogs.js's own filter does not touch it). `dPrep`
          // is forced to `null` the exact same way once that happens (`dApp
          // ?.id ? prepById[dApp.id] : null`, above), and nothing re-fetches
          // for an id that no longer exists, so without this branch that
          // state fell into the SAME spinner below and spun forever with
          // nothing on screen to explain it (verify.r7.md's own PR-D). A
          // plain `!dPrep` (this application's own read still in flight) is
          // different and stays a spinner on purpose: `fetchPrepForRow`'s
          // bounded fetch always eventually writes something -- a real body
          // or `{error}` -- within `PREP_FETCH_TIMEOUT_MS`.
          !dApp?.id ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "flex-start" }}>
              <p style={{ color: "var(--text-secondary)", margin: 0 }}>
                This application is no longer available.
              </p>
            </Box>
          ) : !dPrep ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <PrepPackPanel
              applicationId={dApp?.id}
              // M2 (N50 fix round 1): pack/completeSections/names/revisions
              // read from `prepContent` -- the cached last-known-ready
              // snapshot while a SECTION action is live and a cache exists,
              // the real `dPrep` otherwise. `status` and `error` stay the
              // REAL `dPrep` values always: the banner must keep saying the
              // truth about what the server is doing, only the CONTENT
              // beneath it should not appear to have been wiped.
              pack={prepContent.pack ?? null}
              status={dPrep.status ?? null}
              completeSections={prepContent.completeSections ?? []}
              attemptsExhausted={!!dPrep.attemptsExhausted}
              candidateName={prepContent.candidateName ?? null}
              interviewerNames={prepContent.interviewerNames ?? []}
              error={dPrep.error ?? null}
              onDownloadLog={() => downloadPrepLog(dApp, dPrep)}
              generating={q.active?.target === "pack"}
              packTimedOut={packTimedOut}
              triggerMessage={packMessage}
              onGenerateNow={handleGenerateNow}
              // INVARIANT (N50 fix round 4, verify4.md): a manual escape
              // hatch for the one `in-flight` shape none of the states
              // above resolve on their own -- `status==="running"` with
              // neither `generating` (this session's own active claim, which
              // resolves via the queue's own timeout) nor a known section/
              // pack reason (which resolves via the retry control those
              // states restore). That is exactly a first open mid an
              // EXTERNALLY-triggered run: nothing this session started, and
              // nothing it is polling for. A plain manual refetch, wired to
              // the SAME `fetchPrepForRow` every other read path already
              // uses -- never a second GET implementation.
              onCheckAgain={() => {
                if (dApp?.id) fetchPrepForRow(dApp.id);
              }}
              // N50 fix round 5 (verify.r5.md minor m-1): the no-description
              // state's own forward control -- see PrepPackPanel.js's
              // `GenerateControl` for why it needs one at all. Navigates this
              // SAME dialog instance to its "jd" page -- this application's
              // own job-posting view, the closest real, wired destination
              // within this file's own scope; the actual Edit form the
              // panel's own copy already points to lives outside this
              // dialog, on the tracking row itself.
              onOpenApplication={() => {
                if (dApp?.id) setAppDialog((prev) => ({ ...prev, kind: "jd" }));
              }}
              hasDescription={!!String(dPos?.description || "").trim()}
              onRegenerateSection={(section) => handleGenerateNow({ section })}
              onRestoreRevision={handleRestoreRevision}
              sectionRevisions={prepContent.sectionRevisions ?? {}}
              liveRevisions={prepContent.liveRevisions ?? {}}
              sectionActivity={sectionActivity}
              sectionOutcomes={sectionOutcomes}
              wholePackQueued={wholePackQueued}
              onSaveNames={(form) => {
                if (!dApp?.id) return;
                saveTrustedNames(dApp.id, form)
                  .then((result) => {
                    if (!result?.written) return;
                    setPrepById((prev) => ({
                      ...prev,
                      [dApp.id]: {
                        ...(prev[dApp.id] || {}),
                        candidateName: (form.candidateName || "").trim(),
                        interviewerNames: form.interviewerNamesText
                          .split(",")
                          .map((name) => name.trim())
                          .filter(Boolean),
                      },
                    }));
                  })
                  .catch(() => {});
              }}
            />
          )
        ) : (
          <FormattedContent
            text={appDialog.kind === "jd" ? (dPos?.description ?? "") : (dResume?.content ?? "")}
            kind={appDialog.kind}
          />
        )}
      </DialogContent>
      <DialogActions>
        {appDialog.kind === "communications" && dApp ? (
          <Button onClick={() => openAddCommunicationDialog(dApp)}>
            Add
          </Button>
        ) : null}
        <Button onClick={() => setAppDialog({ open: false, rowIndex: null, kind: "jd" })}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
