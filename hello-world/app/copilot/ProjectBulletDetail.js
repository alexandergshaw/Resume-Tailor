"use client";

import { useId } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

import { useProjectBulletDetailApi } from "./useProjectBulletDetails";
import { useWarmOnMount } from "./useWarmOnMount";

// THE PER-BULLET "MORE DETAIL" CONTROL AND ITS INLINE REGION, for one bullet of an
// invented example project (the two rows AnswerAids renders). Presentation only:
// what a bullet resolves to, whether it is open and what its record says all come
// from the scope's api (useProjectBulletDetails.js), so this file fetches nothing.
//
// IT IS PROSE INSIDE THE BULLET'S OWN <li>, NEVER AN <li> OF ITS OWN. The example
// list's item count is the bullet count, and a screen reader announces it. So the
// control and its region are plain blocks, and each carries `data-bullet-detail`
// (the `data-expansion` precedent in ExpansionPanel.js): a test that wants "the
// bullet's own text" removes those nodes by that one attribute.
//
// WHAT THIS COMPONENT RETURNS IS A FRAGMENT of at most two blocks, the control
// and, while open, its region. When no scope is mounted, or the bullet is not one
// the scope can name a question for, it returns null: the DOM is byte-identical to
// what it was before this control existed.
//
// EACH BULLET WARMS ITS OWN DETAIL ON MOUNT, so opening it is instant. Bullets
// exist only inside the example group's CollapsibleAid body, which unmounts while
// the group is collapsed, so a collapsed group warms nothing: its bullets are not
// on screen. Expanding it mounts every bullet together and they warm together
// (throttled by the shared prefetch queue). Keyed on the resolved store key so a
// store write never re-fires it; a stand-in api without keyFor/prefetch yields a
// null key, a no-op.
//
// NO LOCAL FOCUS STYLING. The app-wide theme already draws a ring on the class MUI
// emits for every ButtonBase root; this is a MUI <Button> for that reason.

const LABEL = "More detail";
const GLYPH_OPEN = "▾"; // down-pointing triangle
const GLYPH_CLOSED = "▸"; // right-pointing triangle

const LOADING_TEXT = "Writing more detail…";
const EMPTY_TEXT = "Nothing useful to add for this one.";
const ERROR_TEXT = "Couldn't get more detail.";
const TIMEOUT_TEXT = "That took too long to look up.";
const DISABLED_TEXT = "More detail is unavailable on this server right now.";

// How many words of a bullet stand in for it in the control's accessible name.
const NAME_WORDS = 6;

const IDLE_RECORD = { status: "idle", detail: "", empty: false, code: null };

function shortName(bullet) {
  return bullet.trim().split(/\s+/).filter(Boolean).slice(0, NAME_WORDS).join(" ");
}

function messageFor(status, code) {
  if (status === "empty") return EMPTY_TEXT;
  if (code === "timeout") return TIMEOUT_TEXT;
  if (code === "disabled") return DISABLED_TEXT;
  return ERROR_TEXT;
}

export default function ProjectBulletDetail({ title, bulletIndex, bullet }) {
  const api = useProjectBulletDetailApi();
  const panelId = useId();

  // What a bullet knows about itself; the scope resolves everything else.
  const descriptor = { title, bulletIndex, bullet };
  const warmKey = typeof api?.keyFor === "function" ? api.keyFor(descriptor) : null;
  useWarmOnMount(warmKey, () => api?.prefetch?.(descriptor));

  // Every hook above this line runs unconditionally.
  if (!api || !api.resolves(descriptor)) return null;

  const open = api.isOpen(descriptor);
  const record = api.get(descriptor) || IDLE_RECORD;
  const status = record.status;
  const name = shortName(bullet);
  // `idle` on an OPEN bullet means its record was evicted from the bounded store;
  // it reads as a failure with a Retry rather than a "writing" line that never
  // ends. No Retry on the kill switch (retrying what an operator switched off is a
  // lie) and none on an honest empty (it would spend money to be told the same
  // thing).
  const retryable = (status === "error" || status === "idle") && record.code !== "disabled";

  const control = (
    <Box data-bullet-detail="control" sx={{ mt: 0.25 }}>
      <Button
        type="button"
        size="small"
        variant="text"
        onClick={() => api.toggle(descriptor)}
        aria-expanded={open ? "true" : "false"}
        // Set ONLY while the region exists. There is no hidden region, so a
        // collapsed aria-controls would be a dangling IDREF, which is invalid ARIA
        // rather than merely untidy.
        aria-controls={open ? panelId : undefined}
        // WCAG 2.5.3 Label in Name: it begins with the words a speech-input user
        // can actually see on the control.
        aria-label={`${LABEL}: ${name}`}
        sx={{
          ...TOUCH_TARGET_SX,
          p: 0,
          justifyContent: "flex-start",
          textTransform: "none",
          color: "var(--text-secondary)",
        }}
      >
        {LABEL}
        {/* The non-colour half of the state affordance (WCAG 1.4.1). */}
        <Box component="span" aria-hidden="true">{` ${open ? GLYPH_OPEN : GLYPH_CLOSED}`}</Box>
      </Button>
    </Box>
  );

  if (!open) return <>{control}</>;

  return (
    <>
      {control}
      <Box
        data-bullet-detail="panel"
        id={panelId}
        aria-live="polite"
        sx={{ borderLeft: "2px solid var(--border-strong)", pl: 1.25, mt: 0.5, ...BREAK_LONG_WORDS_SX }}
      >
        {status === "loading" ? (
          // `aria-busy` stays on this inner line and never on the live region
          // above, which would suppress its announcements.
          <Typography component="p" variant="body2" aria-busy="true" sx={{ m: 0, color: "var(--text-secondary)" }}>
            {LOADING_TEXT}
          </Typography>
        ) : status === "done" ? (
          <Typography component="p" variant="body2" sx={{ m: 0, color: "var(--text-primary)" }}>
            {record.detail}
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
            <Typography component="p" variant="body2" sx={{ m: 0, color: "var(--text-secondary)" }}>
              {messageFor(status, record.code)}
            </Typography>
            {retryable ? (
              <Button
                type="button"
                size="small"
                color="inherit"
                onClick={() => api.retry(descriptor)}
                aria-label={`Retry more detail for: ${name}`}
                sx={TOUCH_TARGET_SX}
              >
                Retry
              </Button>
            ) : null}
          </Stack>
        )}
      </Box>
    </>
  );
}
