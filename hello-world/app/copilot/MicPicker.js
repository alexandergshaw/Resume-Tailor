"use client";

import { useEffect, useState } from "react";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormHelperText from "@mui/material/FormHelperText";
import { listMicrophones, SYSTEM_DEFAULT_OPTION } from "@/lib/copilot/audioDevices";
import { TOUCH_FIELD_SX } from "./mobileSx";

// AC-I1: live mode's microphone picker. Modelled on PostingPicker.js — it
// loads its own options on mount and the caller owns only the current
// selection (`value`/`onChange`), nothing about storage or persistence.
// Whether a session is live lives in the caller too; this component just
// respects whatever `disabled` it's given (AC-I1.7 — switching microphones
// mid-session would require tearing down and rebuilding the "you" capture
// pipeline, which is out of scope, so the picker is disabled rather than
// silently doing nothing).

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

  return (
    <FormControl
      size="small"
      disabled={disabled}
      sx={{
        minWidth: { xs: 0, sm: 220 },
        width: { xs: "100%", sm: "auto" },
        ...TOUCH_FIELD_SX,
      }}
    >
      <InputLabel id="mic-picker-label">Microphone</InputLabel>
      <Select
        labelId="mic-picker-label"
        label="Microphone"
        value={value ?? null}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <MenuItem key={option.deviceId ?? "system-default"} value={option.deviceId}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
      {showsPlaceholders ? (
        <FormHelperText>
          Device names appear after the first session grants microphone access — this
          isn&apos;t an error.
        </FormHelperText>
      ) : null}
    </FormControl>
  );
}
