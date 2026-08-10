"use client";

import { useCallback, useEffect, useState } from "react";
import { listMicrophones, resolveStoredMicDeviceId, SYSTEM_DEFAULT_OPTION } from "@/lib/copilot/audioDevices";
import {
  displayCaptureSupported,
  sourceAvailability,
  resolveInterviewerSource,
  unavailableSourceReason,
} from "@/lib/copilot/captureSupport";

// Split out of CopilotClient.js to keep that file under the project's
// 1000-line cap. Owns the interviewer-audio-source and microphone SETUP
// concern: seeding both from localStorage (falling back to whatever this
// device can actually run), persisting a change back, and the derived facts
// SessionSetup needs to render the picker. Everything that merely READS
// `source` afterwards (share-dialog instructions, the in-person-only speaker
// bar, ...) stays in CopilotClient — those are render concerns, not setup.

const SOURCE_STORAGE_KEY = "copilot-audio-source";
// AC-I1.4: the selected microphone's own key — separate from
// SOURCE_STORAGE_KEY (interviewer audio) and PrepContext's storage key, so
// the three controls persist independently. Follows the exact same
// seed-from-storage/persist pattern as SOURCE_STORAGE_KEY below (try/catch,
// a bad or missing value falling back to the default).
const MIC_STORAGE_KEY = "copilot-mic-device";

// Phase 4/AC-P7/AC-I1: the interviewer-audio-source and microphone setup
// CopilotClient hands to SessionSetup — seed-from-storage/persist for both,
// plus the derived availability facts SessionSetup needs to render the
// picker. See usePrepContext.js for the smallest example of this house
// style.
export function useCaptureSetup() {
  const [source, setSource] = useState("tab"); // "tab" | "system" | "inperson" — the interviewer's audio source
  // AC-I1: the selected microphone's device id, or `null` for "System
  // default" — audioDevices.js's SYSTEM_DEFAULT_OPTION.deviceId, and exactly
  // the value capture.js's captureMicAudio treats as "no deviceId
  // constraint at all" (AC-I1.3).
  const [micDeviceId, setMicDeviceId] = useState(null);
  // AC-P7: which interviewer-audio sources this device can actually run —
  // `getDisplayMedia` is unsupported on every mobile browser (see
  // lib/copilot/captureSupport.js's header for the full list), so "tab" and
  // "system" would only ever throw there. Detected once on mount, in the
  // effect below, since the answer cannot change mid-visit. Defaults to
  // `true` (every source assumed runnable) so a desktop user never sees a
  // flash of the degraded UI while detection resolves.
  const [displayCapture, setDisplayCapture] = useState(true);

  // AC-P7: feature-detect once on mount. Pure function, no user-agent
  // sniffing (see captureSupport.js's own doc) — `navigator` always exists
  // by the time an effect body runs (effects never execute during SSR), so
  // no extra guard is needed here. The setState call is deferred a microtask
  // out via Promise.resolve().then(...), same shape as the source-seed
  // effect right below, which is what keeps this clear of
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    const supported = displayCaptureSupported(navigator.mediaDevices);
    Promise.resolve().then(() => setDisplayCapture(supported));
  }, []);

  // Seed the interviewer-audio-source choice from localStorage, wrapped in
  // try/catch — a private-mode or quota error must not take the page down,
  // the same discipline every other storage read in this app follows
  // (usePrepContext.js is the closest example). The actual setSource call is
  // deferred a microtask out (same shape the mic seed effect right below
  // already uses via listMicrophones().then(...)) rather than called
  // synchronously in the effect body, which is what keeps this clear of
  // react-hooks/set-state-in-effect — this project's lint rule set only
  // started surfacing this specific effect once CopilotClient.js's hook
  // graph shrank enough for its whole-component analysis to complete; the
  // pattern itself was always the thing the rule flags.
  //
  // AC-M1.5.2/R-037: "inperson" is a third valid stored value, alongside
  // "tab"/"system" — omitting it would mean a candidate who picked in-person
  // mode loses that choice on every reload. That requirement is now carried
  // by resolveInterviewerSource's own vocabulary rather than by an inline
  // check here (see AC-P7 below): the guard this comment used to describe —
  // `stored === "tab" || stored === "system" || stored === "inperson"`,
  // which left the useState default in place for anything else — no longer
  // exists, and setSource is now called unconditionally with a value that
  // module guarantees is runnable. Only the deferred
  // Promise.resolve().then(...) shape is unchanged.
  //
  // AC-P7: a missing/unrecognized stored value, or a display-capture choice
  // ("tab"/"system") this device cannot run, is now resolved through
  // resolveInterviewerSource (captureSupport.js) against `displayCapture`
  // instead of the old inline stored === "tab" || ... check — so a source
  // picked on a laptop, or simply today's "tab" default, resolves to
  // something runnable when read back on a phone. This effect depends on
  // `displayCapture` (not `[]`) so it re-resolves once the mount-time
  // detection effect above lands its real value — on first mount this
  // effect can run before that detection settles, while `displayCapture`
  // still holds its optimistic default.
  useEffect(() => {
    let stored = null;
    try {
      stored = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    } catch {
      stored = null;
    }
    const resolved = resolveInterviewerSource(stored, displayCapture);
    Promise.resolve().then(() => setSource(resolved));
  }, [displayCapture]);

  // AC-I1.4/AC-I1.5: seed the selected microphone from localStorage, same
  // try/catch discipline as the source seed above. A stored id can't just be
  // trusted, though — the device it names may no longer be plugged in — so
  // this resolves it against a FRESH device list via
  // resolveStoredMicDeviceId (wave 1's audioDevices.js) before adopting it,
  // falling back to System default (`null`, already today's useState
  // default) rather than leaving a stale id in place that would later throw
  // OverconstrainedError. listMicrophones() only calls enumerateDevices(),
  // never getUserMedia, so this never prompts for permission on its own —
  // same guarantee MicPicker's own mount-time load relies on.
  useEffect(() => {
    let stored = null;
    try {
      stored = window.localStorage.getItem(MIC_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (!stored) return undefined;
    let cancelled = false;
    listMicrophones().then((options) => {
      if (cancelled) return;
      const resolved = resolveStoredMicDeviceId(stored, options);
      if (resolved) setMicDeviceId(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // AC-M1.5.2/R-037: accepts "inperson" alongside the original two values —
  // omitting it here is the OTHER half of what would make the new toggle
  // option inert (the seeding effect above is the other half).
  const onSourceChange = useCallback((val) => {
    if (val !== "tab" && val !== "system" && val !== "inperson") return;
    setSource(val);
    try {
      window.localStorage.setItem(SOURCE_STORAGE_KEY, val);
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

  // AC-I1.4: `id` is `null` for "System default" (MicPicker's own
  // SYSTEM_DEFAULT_OPTION.deviceId) — that's the useState default already,
  // so there is nothing meaningful to persist for it; only a real device id
  // is written to storage, and choosing System default clears whatever was
  // stored before.
  const onMicDeviceChange = useCallback((id) => {
    setMicDeviceId(id || null);
    try {
      if (id) {
        window.localStorage.setItem(MIC_STORAGE_KEY, id);
      } else {
        window.localStorage.removeItem(MIC_STORAGE_KEY);
      }
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

  // `micLabel` skips a second device-enumeration lookup (MicPicker.js's own
  // job, out of scope here) for a fact that's always true without one:
  // whether a specific device is selected.
  const micLabel = micDeviceId ? "custom microphone" : SYSTEM_DEFAULT_OPTION.label;

  // AC-P7: which of the three interviewer-audio options this device can
  // actually run, and why, for SessionSetup to render — computed here
  // (rather than inside SessionSetup, which owns no derived values of its
  // own) and handed down as flat props, same convention as postingSummary
  // and micLabel above. `unavailableSourceReason` is called with the fixed
  // string "tab", never the current `source` state: "tab" and "system"
  // share the identical reason whenever display capture is missing
  // (captureSupport.js's own tests pin this), and "inperson" always returns
  // "" — so reading it off the CURRENTLY SELECTED source would go silent
  // right when it's needed most, since a device without display capture is
  // exactly the case where `source` has already been resolved to
  // "inperson" (see the seed effect above).
  const interviewerSourceAvailability = sourceAvailability(displayCapture);
  const interviewerSourceUnavailableReason = unavailableSourceReason("tab", displayCapture);

  return {
    source,
    onSourceChange,
    micDeviceId,
    onMicDeviceChange,
    micLabel,
    sourceAvailability: interviewerSourceAvailability,
    sourceUnavailableReason: interviewerSourceUnavailableReason,
  };
}
