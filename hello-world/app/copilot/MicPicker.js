"use client";

import { useEffect, useState } from "react";
import TextField from "@mui/material/TextField";
import { listMicrophones, SYSTEM_DEFAULT_OPTION } from "@/lib/copilot/audioDevices";
import { TOUCH_FIELD_SX, TOUCH_NATIVE_SELECT_SX } from "./mobileSx";

// AC-I1: live mode's microphone picker. Modelled on PostingPicker.js — it
// loads its own options on mount and the caller owns only the current
// selection (`value`/`onChange`), nothing about storage or persistence.
// Whether a session is live lives in the caller too; this component just
// respects whatever `disabled` it's given (AC-I1.7 — switching microphones
// mid-session would require tearing down and rebuilding the "you" capture
// pipeline, which is out of scope, so the picker is disabled rather than
// silently doing nothing).
//
// Deliberately a NATIVE select (`slotProps.select.native`), not MUI's
// listbox-based Select this component used before. MUI's non-native Select
// points its trigger's `aria-labelledby` at the field label ONLY — never at
// the element holding the selected value's own text — so the trigger's
// accessible name is just "Microphone", while its visible text is the
// chosen device. RolePicker.js (../roles/RolePicker.js) hit the identical
// WCAG 2.5.3 mismatch and solved it the same way: a real `<label for>` names
// a native `<select>` correctly, and "which device is selected" is never
// asserted as part of the control's name.
//
// A first attempt at this conversion (2026-08-20) was reverted for shipping
// two regressions no test caught. Both are now pinned by MicPicker.test.js
// and both fixes below exist because of it — see that file's header comment
// for the full mechanism.

// audioDevices.js's normalizeMicDevices substitutes this exact shape
// ("Microphone 1", "Microphone 2", ...) for any real device whose `label`
// came back empty — which, pre-permission, is EVERY real device (a browser
// privacy rule: MediaDeviceInfo.label is blank until the page has been
// granted mic access at least once, not a sign anything is broken). This
// regex recognizes that shape so the picker can tell the user why, instead
// of leaving them to wonder why their microphones are all called
// "Microphone 1" / "Microphone 2".
const PLACEHOLDER_LABEL_RE = /^Microphone \d+$/;

// Index 0 is always SYSTEM_DEFAULT_OPTION (see audioDevices.js), whose
// label is the literal "System default" and is never a placeholder — only
// the real devices listed after it can be showing pre-permission names, so
// only those are checked here.
function hasPlaceholderLabels(options) {
  return options.slice(1).some((option) => PLACEHOLDER_LABEL_RE.test(option?.label || ""));
}

export default function MicPicker({ value, onChange, disabled }) {
  const [options, setOptions] = useState([SYSTEM_DEFAULT_OPTION]);

  useEffect(() => {
    let cancelled = false;

    // Deliberately does NOT call getUserMedia to unlock real labels —
    // listMicrophones() (audioDevices.js) only ever calls
    // enumerateDevices(), which never prompts. Requesting the microphone
    // just to render a dropdown would pop a permission prompt as a side
    // effect of the page loading, before the user has asked to start
    // anything.
    function refresh() {
      listMicrophones().then((rows) => {
        if (!cancelled) setOptions(rows);
      });
    }

    refresh();

    // AC-I1.6: refresh when a device is plugged in or unplugged mid-visit.
    // `navigator.mediaDevices` can be entirely absent (older browsers, or a
    // non-browser environment) — listMicrophones() already degrades to just
    // System default for that case on its own, but attaching a listener to
    // something that doesn't exist would throw here, so guard for it.
    const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    mediaDevices?.addEventListener?.("devicechange", refresh);

    return () => {
      cancelled = true;
      mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  const showsPlaceholders = hasPlaceholderLabels(options);

  const normalizedValue = value ?? null;
  const knownOption = options.find((option) => option.deviceId === normalizedValue);

  // AC-I1.5 / the reverted attempt's regression #2: a native <select> cannot
  // hold a value that isn't one of its own <option>s — the browser silently
  // forces selectedIndex back to 0 (System default) and fires no `change`
  // event. Left alone, that would make the picker SHOW "System default"
  // while `value` (useCaptureSetup's stored id) still held the unplugged
  // device's id, and lib/copilot/capture.js would still apply that id as
  // `deviceId: { exact: ... }` — asserting a selection the control visibly
  // is not making, right before capture fails with OverconstrainedError. So
  // when the stored id isn't in the fresh device list, inject a synthetic
  // option that IS the current value, labelled to say it's gone, instead of
  // letting the browser silently substitute System default underneath us.
  // This never calls `onChange` to rewrite the stored selection either:
  // silently correcting it is exactly what resolveStoredMicDeviceId
  // (lib/copilot/audioDevices.js) exists to prevent — its own header
  // comment explains why a quiet fallback there would be worse than an
  // explicit "unavailable" here.
  const showsUnavailable = normalizedValue !== null && !knownOption;
  const selectOptions = showsUnavailable
    ? [...options, { deviceId: normalizedValue, label: "Selected microphone (unavailable)" }]
    : options;

  const helperText = showsUnavailable
    ? "This microphone is no longer available. Choose another, or reconnect it."
    : showsPlaceholders
      ? "Device names appear after the first session grants microphone access — this isn't an error."
      : undefined;

  return (
    <TextField
      select
      size="small"
      label="Microphone"
      value={normalizedValue ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      helperText={helperText}
      // `inputLabel: { shrink: true }` is passed UNCONDITIONALLY, not only
      // once options have loaded. MUI derives InputLabel's shrink from the
      // FormControl's `filled` state, which InputBase computes on MOUNT from
      // the DOM value already sitting in `inputRef.current`. Options here
      // load ASYNCHRONOUSLY (see the effect above), so at mount the select
      // holds only "System default" and reads non-empty anyway — but with
      // `value` pre-set from a stored device id, `filled` would otherwise be
      // decided before that id's real label has even rendered, and the
      // filled-on-mount computation never re-runs later because `value`
      // itself doesn't change when the option list arrives. Forcing shrink
      // is correct here unconditionally, not just a workaround, because a
      // native select has no genuinely blank state for the label to sit on
      // top of — "System default" is always showing, even at `value: null`.
      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      sx={{
        minWidth: { xs: 0, sm: 220 },
        width: { xs: "100%", sm: "auto" },
        ...TOUCH_FIELD_SX,
        ...TOUCH_NATIVE_SELECT_SX,
      }}
    >
      {selectOptions.map((option) => (
        <option key={option.deviceId ?? "system-default"} value={option.deviceId ?? ""}>
          {option.label}
        </option>
      ))}
    </TextField>
  );
}
