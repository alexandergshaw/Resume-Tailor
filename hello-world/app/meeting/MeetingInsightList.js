"use client";

// Presentational only, per this feature's split: no fetching, no polling,
// no session. `insights`/`topic`/`loading`/`error` all arrive as props from
// whatever hook owns the live read (app/meeting/use*.js, out of scope
// here); `onRetry`/`onNudge` are callbacks this component only ever calls,
// never implements.
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

function InsightCard({ insight }) {
  const kindLabel = KIND_LABEL[insight.kind] || (INSIGHT_KINDS.includes(insight.kind) ? insight.kind : "Point");
  const attribution = attributionText(insight.source);
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
      </CardContent>
    </Card>
  );
}

export default function MeetingInsightList({ insights, topic, topicChanged, loading, error, onRetry, onNudge }) {
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
            <InsightCard key={insight.id} insight={insight} />
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
