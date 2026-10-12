"use client";

import { useId, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import {
  AREA_STATE,
  MAX_PLAN_DAYS,
  RATIO_PRESETS,
  areaState,
  knobEffects,
  ratioPresetId,
  setAreaState,
  setDaysUntil,
  setNewReviewRatio,
  summarizeKnobs,
} from "@/lib/studyPlan/studyPlanKnobs";
import { fillStudyCopy } from "@/lib/studyPlan/studyPlanNotices";
import { BREAK_LONG_WORDS_SX, TOUCH_FIELD_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";

// N157 SC-D (design sections 3.2 to 3.5): the customization controls. ONE collapsed
// disclosure ("Customize your plan" before a plan exists, "Plan settings" inside
// the open outline) with a one-line summary of what the plan will use, and, open,
// exactly the three controls the four schema knobs need:
//
//   Days until your interview   a numeric field  -> pace.daysUntil
//   Mix of new and review cards  three presets    -> newReviewRatio
//   Areas                        Focus / Skip     -> weakTopicIds / topicScope.excludedAreas
//
// PRESENTATIONAL. Every change is computed by the D-a model (studyPlanKnobs.js) from
// the `knobs` it is handed and passed up whole through `onChange`; the draft lives in
// useStudyKnobs, in the shell, so closing the panel or the outline loses nothing.
// Only the disclosure state and the days field's typed text are local, and neither
// is a knob. The panel is conditionally rendered, so it is absent from the DOM when
// closed, and it holds NO headings (it mounts under the page's h3 and the outline's
// h4/h5): each knob is a fieldset with a legend, so heading levels cannot skip.
//
// ACCESSIBILITY. The days fieldset's legend is visually hidden because the field's
// own visible label carries the same words. An area row is role="group" labelled by
// its area name; the two toggles are named by their visible text only (no aria-label
// override, WCAG 2.5.3) and carry aria-pressed. The reason a Skip is blocked is a
// visible caption wired by aria-describedby, never a Tooltip or an aria-label. There
// is no live region here (the shell owns the one).
//
// PER ENGINE. knobEffects names what the engine honours. Under the embedded engine
// the Gemini-only controls (the days field and every Focus toggle) are disabled and
// point at the embedded caption; the mix and Skip stay operable.

const SECONDARY_TEXT_SX = { color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX };
const FIELDSET_SX = { m: 0, p: 0, border: 0, minWidth: 0 };
const LEGEND_SX = { p: 0, mb: 0.5, fontWeight: 700 };
const SEGMENT_SX = { textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX };
const MIX_LABELS = {
  "mostly-new": STUDY_COPY.knobs.mixMostlyNew,
  even: STUDY_COPY.knobs.mixEven,
  "mostly-review": STUDY_COPY.knobs.mixMostlyReview,
};

function Knob({ legend, hideLegend, disabled, children }) {
  return (
    <Box component="fieldset" disabled={disabled} sx={FIELDSET_SX}>
      <Typography component="legend" variant="subtitle2" sx={hideLegend ? visuallyHidden : LEGEND_SX}>
        {legend}
      </Typography>
      <Stack spacing={0.75} sx={{ minWidth: 0 }}>
        {children}
      </Stack>
    </Box>
  );
}

// The typed text lives here so the box can be cleared mid-edit; only a valid whole
// number reaches the model (and so the knobs), anything else shows the error and
// commits nothing. On blur the box snaps back to the committed value.
function DaysField({ knobs, onChange, disabled }) {
  const copy = STUDY_COPY.knobs;
  const [typed, setTyped] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const slots = { max: MAX_PLAN_DAYS };

  const onType = (event) => {
    const raw = event.target.value;
    const result = setDaysUntil(knobs, raw);
    setTyped(raw);
    setInvalid(!result.ok);
    if (result.ok) onChange(result.knobs);
  };
  const onBlur = () => {
    setTyped(null);
    setInvalid(false);
  };

  return (
    <Knob legend={copy.daysLegend} hideLegend disabled={disabled}>
      <TextField
        size="small"
        label={copy.daysLegend}
        value={typed ?? String(knobs.pace.daysUntil)}
        onChange={onType}
        onBlur={onBlur}
        error={invalid}
        helperText={fillStudyCopy(invalid ? copy.daysError : copy.daysHelper, slots)}
        disabled={disabled}
        slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", autoComplete: "off" } }}
        sx={{ width: "100%", maxWidth: 320, ...TOUCH_FIELD_SX }}
      />
    </Knob>
  );
}

function MixField({ knobs, onChange, disabled }) {
  const copy = STUDY_COPY.knobs;
  const presetId = ratioPresetId(knobs);
  const newPercent = Math.round(knobs.newReviewRatio * 100);
  const caption =
    presetId === null
      ? fillStudyCopy(copy.mixCustomCaption, { new: newPercent })
      : fillStudyCopy(copy.mixCaption, { new: newPercent, review: 100 - newPercent });

  // An already-selected segment yields null: swallowed, as a mix always has one value.
  const onSelect = (_event, next) => {
    const preset = RATIO_PRESETS.find((entry) => entry.id === next);
    if (preset) onChange(setNewReviewRatio(knobs, preset.value));
  };

  return (
    <Knob legend={copy.mixLegend} disabled={disabled}>
      <ToggleButtonGroup exclusive fullWidth size="small" value={presetId} onChange={onSelect} disabled={disabled}>
        {RATIO_PRESETS.map((preset) => (
          <ToggleButton key={preset.id} value={preset.id} sx={SEGMENT_SX}>
            {MIX_LABELS[preset.id]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
        {caption}
      </Typography>
    </Knob>
  );
}

// One area: its name and an exclusive Focus / Skip pair where "neither pressed" IS
// the include state, so a re-tap on the pressed one means "back to include".
function AreaRow({ row, knobs, options, onChange, disabled, focusOff, captionId, reasonId }) {
  const copy = STUDY_COPY.knobs;
  const labelId = useId();
  const { area, state, skipBlocked } = row;

  const onSelect = (_event, next) => {
    const result = setAreaState(knobs, area, next ?? AREA_STATE.INCLUDE, options);
    if (result.ok) onChange(result.knobs);
  };

  return (
    <Box role="group" aria-labelledby={labelId} sx={{ display: "flex", alignItems: "center", columnGap: 1 }}>
      <Typography id={labelId} component="span" variant="body2" sx={{ flex: 1, minWidth: 0, ...BREAK_LONG_WORDS_SX }}>
        {area}
      </Typography>
      <ToggleButtonGroup
        role="presentation"
        exclusive
        size="small"
        value={state === AREA_STATE.INCLUDE ? null : state}
        onChange={onSelect}
        sx={{ flexShrink: 0 }}
      >
        <ToggleButton
          value={AREA_STATE.FOCUS}
          disabled={disabled || focusOff}
          aria-describedby={focusOff ? captionId : undefined}
          sx={SEGMENT_SX}
        >
          {copy.focus}
        </ToggleButton>
        <ToggleButton
          value={AREA_STATE.SKIP}
          disabled={disabled || skipBlocked}
          aria-describedby={skipBlocked ? reasonId : undefined}
          sx={SEGMENT_SX}
        >
          {copy.skip}
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}

function AreasField({ knobs, options, suggestions, effects, onChange, disabled, captionId }) {
  const copy = STUDY_COPY.knobs;
  const reasonId = useId();
  const rows = options.map((area) => {
    const state = areaState(knobs, area);
    // The last non-skipped area cannot be skipped (a plan with nothing in it cannot
    // be built): the model refuses, and the row says why.
    const skipBlocked = state !== AREA_STATE.SKIP && !setAreaState(knobs, area, AREA_STATE.SKIP, options).ok;
    return { area, state, skipBlocked };
  });
  const pending = suggestions.filter((entry) => areaState(knobs, entry.area) !== AREA_STATE.FOCUS);

  const onFocusSuggested = () => {
    const next = suggestions.reduce((acc, entry) => {
      const result = setAreaState(acc, entry.area, AREA_STATE.FOCUS, options);
      return result.ok ? result.knobs : acc;
    }, knobs);
    onChange(next);
  };

  return (
    <Knob legend={copy.areasLegend} disabled={disabled}>
      <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
        {copy.areasHelper}
      </Typography>
      {effects.weakAreas && suggestions.length > 0 ? (
        <Stack direction="row" useFlexGap sx={{ alignItems: "center", columnGap: 1.5, ...WRAP_ROW_SX }}>
          <Typography variant="body2" sx={{ ...SECONDARY_TEXT_SX, minWidth: 0 }}>
            {fillStudyCopy(copy.suggestion, {
              list: suggestions.map((entry) => `${entry.area} (${entry.missed})`).join(", "),
            })}
          </Typography>
          {pending.length > 0 ? (
            <Button variant="outlined" size="small" onClick={onFocusSuggested} disabled={disabled} sx={TOUCH_TARGET_SX}>
              {copy.suggestionButton}
            </Button>
          ) : null}
        </Stack>
      ) : null}
      {rows.map((row) => (
        <AreaRow
          key={row.area}
          row={row}
          knobs={knobs}
          options={options}
          onChange={onChange}
          disabled={disabled}
          focusOff={!effects.weakAreas}
          captionId={captionId}
          reasonId={reasonId}
        />
      ))}
      {rows.some((row) => row.skipBlocked) ? (
        <Typography id={reasonId} variant="body2" sx={SECONDARY_TEXT_SX}>
          {copy.lastIncludedReason}
        </Typography>
      ) : null}
    </Knob>
  );
}

export default function StudyPlanControls({
  label = STUDY_COPY.knobs.disclosureCreate,
  knobs,
  onChange,
  options,
  suggestions,
  engine,
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const summaryId = useId();
  const captionId = useId();
  const effects = knobEffects(engine);
  const busy = disabled === true;

  return (
    <Stack spacing={1} sx={{ alignItems: "flex-start", alignSelf: "stretch", minWidth: 0 }}>
      <Button
        variant="outlined"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={summaryId}
        sx={TOUCH_TARGET_SX}
      >
        {label}
      </Button>
      <Typography id={summaryId} variant="body2" sx={SECONDARY_TEXT_SX}>
        {summarizeKnobs(knobs)}
      </Typography>
      {open ? (
        <Stack id={panelId} role="group" aria-label={label} spacing={2} sx={{ alignSelf: "stretch", minWidth: 0 }}>
          <DaysField knobs={knobs} onChange={onChange} disabled={busy || !effects.pace} />
          <MixField knobs={knobs} onChange={onChange} disabled={busy} />
          <AreasField
            knobs={knobs}
            options={options}
            suggestions={suggestions}
            effects={effects}
            onChange={onChange}
            disabled={busy}
            captionId={captionId}
          />
          <Typography id={captionId} variant="body2" sx={SECONDARY_TEXT_SX}>
            {effects.weakAreas ? STUDY_COPY.knobs.geminiCaption : STUDY_COPY.knobs.embeddedCaption}
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
