"use client";

// Presentational only, per this feature's split: no fetching, no polling,
// no session. `insights`/`topic`/`loading`/`error` all arrive as props from
// whatever hook owns the live read (app/meeting/use*.js, out of scope
// here); `onRetry`/`onNudge`/`onFindReferences` are callbacks this component
// only ever calls, never implements. `referencesByInsightId` is likewise
// owned and fetched elsewhere — MeetingPanel.js, per its own header comment —
// this file only ever reads its own insight's entry out of it.
//
// The one property this file exists to protect is attribution
// (lib/meeting/insightContract.js's whole reason for having a `source`
// field on an insight in the first place — see that module's own doc
// comment on `normalizeSource`): a list that renders a page-sourced point
// and a model-composed one identically throws away the very distinction the
// contract went to the trouble of computing. So every card below reads its
// own `source.kind` and decides, per card, whether it is allowed to claim
// where its text came from.

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { INSIGHT_KINDS } from "@/lib/meeting/insightContract";

// Inlined for the same reason MeetingTranscript.js inlines its own copy:
// one small, stable style object is a smaller dependency than importing
// lib/copilot/answerStatus.js's `visuallyHidden` export into a
// meeting-feature file for it.
const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const KIND_LABEL = { point: "Point", question: "Question", gap: "Gap" };

// The two sentences the whole reference-links feature stands or falls on:
// each says something a bare "no links shown" cannot. `dropped` is about
// INTEGRITY — the model suggested
// more than what is on screen, and staying silent about that would let a
// filtered list masquerade as a complete one. `grounded === false` is about
// PROVENANCE — no search happened at all, which reads completely differently
// from "a search happened and came up empty" (groundedEmptyMessage below);
// collapsing the two into one "nothing found" string would tell the user
// their topic has no documentation when the truth is nobody looked.
function droppedMessage(dropped) {
  const n = typeof dropped === "number" && dropped > 0 ? dropped : 0;
  const noun = n === 1 ? "suggestion" : "suggestions";
  const verb = n === 1 ? "is" : "are";
  return `${n} ${noun} could not be verified and ${verb} not shown.`;
}
const groundedEmptyMessage = "No verified references were found for this point.";
const notGroundedMessage =
  "This point could not be checked against search results, so no references are shown.";

// A card's reference-fetch control needs its OWN accessible name, not a
// shared "Find sources" repeated on every card — this repo has shipped that
// exact bug on another tab (identical controls, indistinguishable to a
// screen reader) and forbids repeating it here. The insight's own text is
// what uniquely identifies which point the control acts on, so it goes
// straight into the label rather than a truncated summary that could
// collide between two similar insights.
//
// Sighted and non-sighted users get the SAME information through different
// channels, none of which relies on focus moving:
//   - `aria-label` keeps its "Find sources for: …" prefix in both states
//     (so nothing here breaks a screen reader's "find the control for this
//     insight" query), but is no longer IDENTICAL while loading — an
//     aria-label overrides the visible "Finding sources…" text node
//     entirely, so a label that never changed made that busy state
//     invisible to assistive tech even though it was plainly visible on
//     screen.
//   - `aria-busy` says the same thing in the one attribute built for it.
//   - the `CircularProgress` gets its own accessible name — an unnamed
//     `role="progressbar"` announces nothing.
//   - a visually-hidden `role="status"` region PROACTIVELY announces
//     progress and a landed result, so a screen reader user does not have
//     to be focused on this control at the moment either happens. A
//     FAILURE is deliberately not repeated in here — ReferenceResults' own
//     `role="alert"` Alert already carries it, and announcing it twice
//     (once politely, once as the correct interruption) would be worse than
//     once. Unconditionally mounted, same discipline as the topic-change
//     region above: a later announcement must be a text CHANGE on an
//     already-mounted node, never a region that appears already carrying
//     its final text. Does not move focus.
function referenceAnnouncement(insight, referenceState) {
  if (!referenceState) return "";
  if (referenceState.status === "loading") {
    return `Finding sources for: ${insight.text}`;
  }
  if (referenceState.status === "done") {
    const references = Array.isArray(referenceState.result?.references) ? referenceState.result.references : [];
    if (references.length > 0) {
      const noun = references.length === 1 ? "reference" : "references";
      return `${references.length} ${noun} found for: ${insight.text}.`;
    }
    return referenceState.result?.grounded ? groundedEmptyMessage : notGroundedMessage;
  }
  return "";
}

function ReferenceControl({ insight, referenceState, onFindReferences }) {
  const loading = referenceState?.status === "loading";
  const label = loading
    ? `Find sources for: ${insight.text} (finding sources…)`
    : `Find sources for: ${insight.text}`;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
      {/* Never disabled while rendered — a loading fetch must not remove
          this control from the tab order, the same rule this file's own
          Nudge button already follows (see its header comment below). */}
      <Button
        size="small"
        variant="outlined"
        onClick={() => onFindReferences(insight)}
        aria-label={label}
        aria-busy={loading}
      >
        {loading ? "Finding sources…" : "Find sources"}
      </Button>
      {loading ? <CircularProgress size={14} aria-label="Finding sources" /> : null}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {referenceAnnouncement(insight, referenceState)}
      </Box>
    </Stack>
  );
}

// Renders the last successful lookup for one insight (`result`), plus an
// error banner when the MOST RECENT attempt failed. `result` is sticky
// across a failed retry — see MeetingPanel's own reference-state comment —
// so a card that already has references keeps them on screen right through
// a failed re-fetch, exactly like the list-level error above keeps existing
// insights on screen.
//
// `insight` exists on this component for exactly one reason: the Retry
// button below needs its OWN accessible name, the identical rule
// ReferenceControl's own header comment already states for the "Find
// sources" control. A bare `<Button>Retry</Button>` on two cards in an
// error state produces two indistinguishable controls — plus the
// pre-existing list-level "Retry" above, three where there was meant to be
// one this repo has already shipped that exact bug and forbids repeating.
function ReferenceResults({ insight, referenceState, onRetry }) {
  if (!referenceState) return null;
  const { status, error, result } = referenceState;
  const references = Array.isArray(result?.references) ? result.references : [];
  const hasResult = result != null;

  return (
    <Box sx={{ mt: 1 }}>
      {status === "error" ? (
        <Alert
          severity="error"
          sx={{ mb: 1 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={onRetry}
              aria-label={`Retry finding sources for: ${insight.text}`}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {references.length > 0 ? (
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {references.map((ref, index) => (
            <Typography key={`${ref.url}-${index}`} variant="body2" sx={{ wordBreak: "break-word" }}>
              <a href={ref.url} target="_blank" rel="noopener noreferrer">
                {ref.title}
              </a>
              {/* The host is shown so the user can see where a link goes
                  BEFORE saying it out loud - the whole point of citing
                  something in a live meeting. */}
              {ref.host ? (
                <Typography component="span" variant="caption" sx={{ ml: 0.5, color: "var(--text-secondary)" }}>
                  ({ref.host})
                </Typography>
              ) : null}
            </Typography>
          ))}
        </Stack>
      ) : null}

      {/* Only rendered once a result has actually landed - never on the
          untouched "button not pressed yet" state, and never invented from
          an error alone with no prior successful fetch to describe. */}
      {hasResult && result.dropped > 0 ? (
        <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "var(--text-secondary)" }}>
          {droppedMessage(result.dropped)}
        </Typography>
      ) : null}

      {hasResult && references.length === 0 ? (
        <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "var(--text-secondary)" }}>
          {result.grounded ? groundedEmptyMessage : notGroundedMessage}
        </Typography>
      ) : null}
    </Box>
  );
}

// The whole attribution rule, in one function: `page` and `transcript` each
// name the real thing the point traces back to (falling back to a generic
// phrase when the specific name is missing — normalizeInsights in
// insightContract.js can hand back a page source with a null `pageTitle`, so
// this has to degrade gracefully rather than print "From your page: null").
// `model` — and anything this list doesn't recognise — returns "" on purpose:
// silence, not a guess, is what "must not imply a source" means here.
function attributionText(source) {
  if (!source || !source.kind) return "";
  if (source.kind === "page") {
    return source.pageTitle ? `From your page: ${source.pageTitle}` : "From one of your pages";
  }
  // `attachment` is treated exactly like `model`: it claims nothing.
  //
  // No attachment contents are part of a read today, and nothing verifies
  // this kind the way `page` is verified — normalizeSource only checks a
  // page's id against the pages a read actually included, so `attachment`
  // passes normalization on the model's say-so alone, with its
  // `attachmentName` stripped in the process (a non-page source keeps only
  // its `kind`). Rendering "From one of your attachments" on that basis would
  // be exactly the unverifiable claim of provenance insightContract.js's
  // downgrade rule exists to prevent, on a read where no attachment was sent
  // at all. Restore a real branch here when attachments genuinely become part
  // of a read AND normalizeSource verifies the named attachment the same way
  // it verifies a page id.
  if (source.kind === "transcript") {
    return "From what was just said in this meeting";
  }
  return "";
}

function InsightCard({ insight, referenceState, onFindReferences }) {
  const kindLabel = KIND_LABEL[insight.kind] || (INSIGHT_KINDS.includes(insight.kind) ? insight.kind : "Point");
  const attribution = attributionText(insight.source);
  const canFindReferences = typeof onFindReferences === "function";
  return (
    <Card variant="outlined">
      <CardContent sx={{ "&:last-child": { pb: 2 } }}>
        <Chip
          size="small"
          label={kindLabel}
          sx={{
            height: 20,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-secondary)",
            background: "var(--bg-soft)",
            border: "1px solid var(--border)",
            mb: 0.5,
          }}
        />
        <Typography sx={{ color: "var(--text-primary)", wordBreak: "break-word" }}>{insight.text}</Typography>
        {/* Attribution is the whole point of this card existing as
            something other than a plain bullet list — see this file's own
            header comment. Rendered ONLY when attributionText found
            something honest to say; a `source.kind === "model"` insight
            renders no line here at all, which is the "must not imply a
            source" requirement satisfied by omission rather than by a
            defensive-sounding label like "AI suggestion" that would still
            be making a claim. */}
        {attribution ? (
          <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "var(--text-secondary)" }}>
            {attribution}
          </Typography>
        ) : null}
        {/* Optional-prop gate, same shape this file's own Nudge control uses
            below: rendered only when the caller actually wired a handler up,
            so a component under test (or a future caller with no reference
            feature) degrades to today's card rather than a broken button. */}
        {canFindReferences ? (
          <ReferenceControl insight={insight} referenceState={referenceState} onFindReferences={onFindReferences} />
        ) : null}
        {canFindReferences ? (
          <ReferenceResults insight={insight} referenceState={referenceState} onRetry={() => onFindReferences(insight)} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function MeetingInsightList({
  insights,
  topic,
  topicChanged,
  loading,
  error,
  onRetry,
  onNudge,
  referencesByInsightId,
  onFindReferences,
}) {
  const list = Array.isArray(insights) ? insights : [];
  const hasTopic = typeof topic === "string" && topic.trim().length > 0;

  // "A changed topic is perceivable without relying on colour alone" (AC):
  // the topic heading's own text updating is already the primary,
  // always-visible cue — plain text, no colour dependency to begin with.
  // Below it adds a second, explicit textual marker (not a colour swatch)
  // next to the heading, plus a live-region announcement for anyone not
  // looking at the screen at the moment it changes.
  //
  // WHETHER the topic changed is not this component's to decide, and it
  // deliberately does not keep its own memory of the previous topic to work
  // it out. insightContract.js's normalizeTopic already computed that
  // server-side, comparing NORMALIZED text so that a trailing period, a
  // doubled space, or a trivial rephrase of the same subject is not reported
  // as movement. A `prevTopic !== topic` check here would fire on exactly
  // that noise, and this cue is what interrupts a user's attention
  // mid-meeting. It also latched: once true it never went back to false, so
  // "(just changed)" stopped meaning "just" after the first change of the
  // meeting. Reading the flag straight from the read that produced this
  // topic fixes both — a later read that did not change the topic simply
  // arrives with `topicChanged: false` and the cue goes away on its own,
  // with no state to clear.
  //
  // The announcement is derived from the same flag rather than stored, so
  // there is nothing to keep in sync: it is empty on the first render of a
  // meeting (the first topic a meeting ever gets is not a change — there is
  // nothing it changed FROM, and the route reports it as such), and empties
  // again the moment the flag does.
  const changed = topicChanged === true && hasTopic;
  const announcement = changed ? `Topic changed to ${topic}.` : "";

  const nudgeable = typeof onNudge === "function";

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ color: "var(--text-primary)" }}>
          Topic: {hasTopic ? topic : "Not yet identified"}
        </Typography>
        {/* Text, not colour, is what marks a recent change — satisfies the
            "not colour alone" AC by never having used colour for this in
            the first place. */}
        {changed ? (
          <Typography variant="caption" sx={{ color: "var(--text-secondary)", fontWeight: 700 }}>
            (just changed)
          </Typography>
        ) : null}
      </Stack>
      {/* Unconditionally mounted (never nested inside a conditional), so a
          later announcement is always a text change on an already-mounted
          node — the same discipline lib/copilot/answerStatus.js's own
          header comment documents, and the same reason a live region that
          mounts already carrying its final text is unreliable. Does not
          move focus. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>

      {loading ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
          <CircularProgress size={16} />
          <Typography variant="body2" role="status" aria-live="polite" sx={{ color: "var(--text-secondary)" }}>
            Listening for insights…
          </Typography>
        </Stack>
      ) : null}

      {/* AC: an error is shown IN PLACE, with a Retry, and must not clear
          whatever insights are already on screen — this Alert is a sibling
          of the insight list below, never a replacement for it. MUI's
          <Alert> defaults its own `role` prop to "alert" (see
          node_modules/@mui/material/Alert/Alert.js), which is what actually
          satisfies the "role=alert for failure" AC here — nothing further
          to add. */}
      {error ? (
        <Alert
          severity="error"
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {/* AC: empty this early must read as "listening", never as failure —
          gated on `!error` so this never renders alongside (or instead of)
          the failure Alert above, and worded identically to the loading
          state's own text so there is one voice for "nothing to show yet"
          across both. */}
      {list.length === 0 && !loading && !error ? (
        <Typography sx={{ color: "var(--text-muted)" }}>
          Listening — insights will appear here as the meeting continues.
        </Typography>
      ) : null}

      {list.length > 0 ? (
        <Stack spacing={1} sx={{ mb: 1.5 }}>
          {list.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              // Keyed lookup, not the whole map: each card reads only ITS
              // OWN entry, so two cards can never end up rendering each
              // other's references even if the map briefly holds stale data
              // for an id neither card currently owns.
              referenceState={referencesByInsightId ? referencesByInsightId[insight.id] : undefined}
              onFindReferences={onFindReferences}
            />
          ))}
        </Stack>
      ) : null}

      {/* "Nudge" alone does not say what the control does (AC) — the
          visible label stays short (matches this repo's house style of a
          short visible label plus a fuller `aria-label`, e.g.
          AttachmentCard.js's download/delete IconButtons), but the
          accessible name spells out the action. Rendered only when the
          caller actually wired up a handler, same optional-prop gate
          app/copilot/TranscriptView.js uses for `onAssignUser` — and never
          disabled while rendered, so it never leaves the tab order while
          its own explanation (this button) is the only thing on screen
          explaining what it does. */}
      {nudgeable ? (
        <Button size="small" variant="outlined" onClick={() => onNudge()} aria-label="Ask for a fresh insight now">
          Nudge
        </Button>
      ) : null}
    </Box>
  );
}
