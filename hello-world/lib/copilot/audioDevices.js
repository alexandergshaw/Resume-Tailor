// Browser-side loader for live mode's microphone picker (AC-I1). Mirrors
// postings.js's structure: a PURE normalizer exported separately so it is
// unit-testable without a browser, plus a thin async wrapper that touches
// the platform API.
//
// Two browser quirks this module exists to paper over:
//
// 1. `MediaDeviceInfo.label` is an EMPTY STRING until the page has been
//    granted microphone permission at least once — this is a documented
//    browser privacy rule (MDN: "the labels [...] will only be visible if
//    active media stream exists or if persistent permission has been
//    granted"), not a bug and not evidence the device has no name. Before
//    that grant, every real microphone shows up unlabeled — the picker
//    needs a usable placeholder for each one rather than a blank row.
//
// 2. Some browsers (Chrome/Edge notably) list a device more than once,
//    including a `deviceId: "default"` (and sometimes `"communications"`)
//    entry that is not a distinct physical microphone but an ALIAS for
//    whichever real device the OS currently treats as the default. Surfacing
//    that alias as its own selectable row would both duplicate the real
//    device already listed under its own id, and behave wrongly if chosen:
//    selecting it would pin capture to that one device via a real `deviceId`
//    constraint, whereas picking "System default" must produce a
//    getUserMedia call with NO deviceId constraint at all (AC-I1.3) so the
//    OS default can keep floating if the user changes it later. Those alias
//    ids are dropped entirely — this module's own synthetic "System
//    default" option (id `null`) is what "system default" means here.

// Ids some browsers use for the OS-default-device alias described above,
// rather than a distinct physical microphone. Never surfaced as their own
// row — see the module comment.
const ALIAS_DEVICE_IDS = new Set(["default", "communications"]);

// The option every device list starts with, always first, always selected
// by default. `deviceId: null` (not `""`, not `"default"`) is deliberate:
// it is the signal capture.js's captureMicAudio uses to omit the
// `deviceId` constraint from getUserMedia entirely, which is what "use
// whatever the OS considers the default microphone" actually requires.
// Neither `""` nor `"default"` would do that — `"default"` in particular is
// a REAL constraint value some browsers recognize as their own alias id
// (see ALIAS_DEVICE_IDS above), which is a different thing from "no
// constraint at all".
export const SYSTEM_DEFAULT_OPTION = { deviceId: null, label: "System default" };

// Pure normalizer: whatever `navigator.mediaDevices.enumerateDevices()`
// returned -> the picker's options. Never throws — non-array input, `null`
// entries, or entries missing fields all degrade to just the System default
// option, since a picker that renders a blank/broken control is worse than
// one that renders a single, always-safe choice.
//
// Placeholder numbering ("Microphone 1", "Microphone 2", ...) runs over the
// KEPT audioinput devices only, in the order they appear after the
// audioinput filter, the alias-id drop, and de-duplication above — so
// plugging in a camera or speaker never shifts the numbers, and neither
// does a browser's own alias/duplicate rows (they're dropped before
// numbering, not just before display).
export function normalizeMicDevices(devices) {
  const list = Array.isArray(devices) ? devices : [];
  const options = [SYSTEM_DEFAULT_OPTION];
  const seenIds = new Set();
  let position = 0;

  for (const device of list) {
    if (!device || device.kind !== "audioinput") continue;

    const deviceId = typeof device.deviceId === "string" ? device.deviceId : "";
    if (!deviceId || ALIAS_DEVICE_IDS.has(deviceId)) continue;

    // De-duplicate by deviceId: browsers can list the same physical device
    // twice (see the module comment). First occurrence wins; later repeats
    // of an id already kept are silently skipped rather than surfaced as a
    // second, identical row the user has no way to tell apart from the
    // first.
    if (seenIds.has(deviceId)) continue;
    seenIds.add(deviceId);

    position += 1;
    const rawLabel = typeof device.label === "string" ? device.label.trim() : "";
    const label = rawLabel || `Microphone ${position}`;
    options.push({ deviceId, label });
  }

  return options;
}

// Async wrapper: calls the real platform API and passes its result through
// normalizeMicDevices. Deliberately does NOT request permission (no
// getUserMedia call here) — enumerateDevices alone never prompts, and this
// function's only job is to list what's there, unlabeled or not; asking for
// permission is a decision the caller (the picker UI) makes explicitly, not
// something a device listing should trigger as a side effect.
//
// Returns just the System default option — never throws — when the API is
// unavailable (older browser, non-browser environment) or when the call
// itself rejects (permission API quirks, a transient platform error): a
// microphone picker that can't enumerate devices should still let the user
// keep using the OS default, not break the rest of the page.
export async function listMicrophones() {
  try {
    const enumerate = globalThis.navigator?.mediaDevices?.enumerateDevices;
    if (typeof enumerate !== "function") {
      return normalizeMicDevices([]);
    }
    const devices = await globalThis.navigator.mediaDevices.enumerateDevices();
    return normalizeMicDevices(devices);
  } catch {
    return normalizeMicDevices([]);
  }
}

// Resolves a PREVIOUSLY STORED device id (e.g. read back from
// localStorage) against a FRESH device list, falling back to System default
// (`null`) when that id is no longer present — AC-I1.5, the unplugged-
// headset case. This matters beyond cosmetics: capture.js's captureMicAudio
// applies a chosen device id as `deviceId: { exact: id }`, and `exact`
// against an id the browser no longer recognizes throws
// OverconstrainedError, which would otherwise kill mic capture outright on
// the very next visit after a device change rather than quietly falling
// back the way "System default" does.
//
// `micOptions` is the already-normalized list (normalizeMicDevices's or
// listMicrophones's output), not a raw device list — kept pure and
// browser-free like the rest of this module's real logic.
export function resolveStoredMicDeviceId(storedDeviceId, micOptions) {
  if (!storedDeviceId) return null;
  const options = Array.isArray(micOptions) ? micOptions : [];
  const stillPresent = options.some((option) => option && option.deviceId === storedDeviceId);
  return stillPresent ? storedDeviceId : null;
}
