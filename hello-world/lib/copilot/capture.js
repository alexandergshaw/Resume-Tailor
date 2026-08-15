// Audio/video capture for the interview copilot.
//
// Four sources:
//   - captureTabAudio(): the OTHER party's voice, via getDisplayMedia tab share.
//     Chrome/Edge only, and the shared surface must have "Share tab audio" on.
//   - captureSystemAudio(): the OTHER party's voice, via getDisplayMedia whole-
//     screen share with system audio. Use this when the interview is happening
//     in a native app (Zoom/Teams desktop client) or on a phone on speaker,
//     where there's no browser tab to share. Chrome cannot capture system
//     audio on macOS at all — sharing a browser tab is the only option there.
//   - captureMicAudio(): your own voice, via getUserMedia.
//   - captureCameraAndMic(): your camera + your own voice, via getUserMedia,
//     for practice mode's self-view.
//
// Each MediaStream is fed through PcmPipeline, which uses an AudioWorklet to
// emit 16 kHz mono PCM16 chunks. The AudioContext is pinned to 16 kHz so the
// browser handles resampling for us.

const WORKLET_URL = "/copilot/pcm-worklet.js";

// Shared by both getDisplayMedia paths below so tab capture and system capture
// can't quietly drift apart (e.g. one gaining a processing option the other
// lacks). Both want the raw signal — Deepgram does its own noise handling.
const DISPLAY_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

// Shared by captureMicAudio and captureCameraAndMic, the two getUserMedia
// paths that want a clean, processed voice signal (as opposed to the raw
// signal DISPLAY_AUDIO_CONSTRAINTS asks for above).
const MIC_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// Both display-capture paths fail the same way when the shared surface has no
// audio (wrong picker choice, or the audio checkbox left off): stop every
// granted track immediately — an unstopped video track keeps the browser's
// "sharing this tab/screen" indicator lit — then throw a source-specific
// message telling the user how to fix it.
//
// buildErrorMessage is a callback, not a plain string, because
// captureSystemAudio's message depends on which surface the user actually
// shared, and that can only be read off the still-live video track (see
// readDisplaySurface below). Calling it here, before the stop() loop, is what
// guarantees the read happens while the track is still live. captureTabAudio
// doesn't need any of that, so its callback just returns its static string —
// which keeps that path's message byte-identical to what it was before this
// function took a callback instead of a string.
function requireAudioTrack(stream, buildErrorMessage) {
  if (stream.getAudioTracks().length === 0) {
    const message = buildErrorMessage(stream);
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(message);
  }
  return stream;
}

export async function captureTabAudio() {
  // Chrome only grants tab audio when a video track is also requested, so we ask
  // for video and simply never render it.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: DISPLAY_AUDIO_CONSTRAINTS,
  });

  return requireAudioTrack(
    stream,
    () =>
      'No tab audio was captured. In the share dialog, pick a browser tab (not a window or your whole screen) and turn on "Share tab audio".',
  );
}

// getSettings().displaySurface reports which surface the user actually chose
// in the picker: "monitor" (whole screen), "window", or "browser" (a tab).
// This must be read here, before requireAudioTrack stops the track — once a
// track is stopped, browsers are free to clear or invalidate its settings.
//
// displaySurface in the getDisplayMedia() constraints below is only ADVISORY
// ("The specified options can't be used to limit the choices available to the
// user" — MDN): it pre-selects the Entire Screen pane, but the user remains
// free to pick a window or a tab instead. That's the actual bug this guards
// against — the old code assumed the "monitor" hint constrained the choice,
// so every no-audio failure got the "Entire Screen" message even when the
// user had picked a window or a tab, where that advice doesn't apply.
//
// getSettings can be missing on the track entirely, or can throw; the stream
// might not carry a video track at all, or might not even implement
// getVideoTracks (this project's own test doubles for other capture paths
// don't need one, since they never fail this way). None of that should turn
// a clear "no system audio" error into a TypeError, so every one of those
// cases falls through to undefined here, which buildSystemAudioMessage below
// treats the same as an explicit "monitor" reading.
function readDisplaySurface(stream) {
  try {
    const videoTrack = stream.getVideoTracks?.()?.[0];
    if (!videoTrack || typeof videoTrack.getSettings !== "function") {
      return undefined;
    }
    return videoTrack.getSettings().displaySurface;
  } catch {
    return undefined;
  }
}

// Per-surface wording for the "no system audio" failure. "monitor" keeps
// today's message verbatim (turn on "Share system audio"), and so does any
// surface value this app doesn't recognize, or couldn't read at all — see
// readDisplaySurface above. "window" and "browser" get their own wording
// because the fix is different, and telling a window/tab user to find a
// "Share system audio" checkbox sends them looking for a control that Chrome
// never shows them for those surfaces.
const DEFAULT_SYSTEM_AUDIO_MESSAGE =
  'No system audio was captured. In the share dialog, pick "Entire Screen" and turn on "Share system audio". Note: Chrome cannot capture system audio on macOS at all — on a Mac, sharing a browser tab is the only option.';

const SYSTEM_AUDIO_MESSAGES_BY_SURFACE = {
  window:
    'No system audio was captured. You shared a window, and on Windows a window share carries no system audio at all — there is no checkbox to turn on for it. Pick "Entire Screen" instead.',
  browser:
    'No system audio was captured. You shared a browser tab. Use this app\'s "Browser tab" interviewer-audio option instead, or re-pick "Entire Screen" in the share dialog if you meant to share your screen.',
};

function buildSystemAudioMessage(stream) {
  const surface = readDisplaySurface(stream);
  return SYSTEM_AUDIO_MESSAGES_BY_SURFACE[surface] ?? DEFAULT_SYSTEM_AUDIO_MESSAGE;
}

export async function captureSystemAudio() {
  // displaySurface: "monitor" steers the picker toward "Entire Screen" (the
  // only surface system audio can ride along with), and systemAudio: "include"
  // plus monitorTypeSurfaces: "include" is what makes Chrome offer the "Share
  // system audio" toggle in the first place.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor" },
    audio: DISPLAY_AUDIO_CONSTRAINTS,
    systemAudio: "include",
    monitorTypeSurfaces: "include",
  });

  return requireAudioTrack(stream, () => buildSystemAudioMessage(stream));
}

// `deviceId` is OPTIONAL (AC-I1.8) — the picker's "System default" option
// (see audioDevices.js's SYSTEM_DEFAULT_OPTION) is `deviceId: null`, and any
// falsy value here (null, undefined, "") must produce EXACTLY today's
// constraints object: `{ audio: MIC_AUDIO_CONSTRAINTS }` with no `deviceId`
// key at all — not `deviceId: undefined`, which still shows up as an own
// key when the constraints object is serialized/inspected, and not
// `deviceId: "default"`, which some browsers treat as a REAL alias id
// rather than "no constraint" (see audioDevices.js's ALIAS_DEVICE_IDS
// comment). That's why the branch below reuses the MIC_AUDIO_CONSTRAINTS
// object as-is instead of spreading it into a new one when there's no id.
//
// When a device id IS given, it's applied as `deviceId: { exact: id }`.
// `exact` (as opposed to `ideal`) is mandatory: with `ideal`, or with a bare
// string constraint, the browser is free to silently substitute a different
// device when the requested one is unavailable, and the user would believe
// they're being recorded on a microphone they are not. `exact` instead makes
// getUserMedia reject with OverconstrainedError when the id doesn't match
// any current device — a failure CopilotSession handles explicitly (see
// session.js) rather than a silent wrong-device substitution.
// AC-S4.2 / defect 6: captureMicAudio used to hand back whatever
// getUserMedia gave it, raw — every sibling capture function above already
// runs its stream through requireAudioTrack. A stream with zero audio
// tracks (a device that granted permission but produced no audio track —
// seen on some virtual/loopback devices) flowed on silently and the live
// in-person session that depends on this mic never transcribed anything.
export async function captureMicAudio(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: micAudioConstraints(deviceId),
  });
  return requireAudioTrack(
    stream,
    () =>
      "No microphone audio was captured. This session needs your microphone to transcribe the conversation.",
  );
}

// The audio half of both getUserMedia paths, extracted so captureMicAudio
// and captureCameraAndMic apply a chosen microphone IDENTICALLY (AC-J1.2).
// Two copies of this three-line expression is exactly how live and practice
// mode would end up disagreeing about whether "System default" means an
// absent key or a `deviceId: undefined` one — a difference invisible in
// review and only observable by inspecting the constraints object's own
// keys, which is what capture.test.js asserts on.
function micAudioConstraints(deviceId) {
  if (!deviceId) return MIC_AUDIO_CONSTRAINTS;
  return { ...MIC_AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } };
}

// Practice mode's capture: your camera plus your own voice. Video is a
// standard 720p-ideal front-facing request; audio reuses the same processed
// constraints as captureMicAudio so the two paths can't drift apart. Unlike
// the display-capture paths above, a rejection here (permission denied, no
// camera present, etc.) propagates unchanged — this function doesn't decide
// what to do about it, that's PracticeSession's job.
//
// AC-J1.1: `deviceId` is OPTIONAL and obeys the exact same rules
// captureMicAudio's does (see micAudioConstraints above) — falsy produces
// today's constraints object with no `deviceId` own-key at all, and a real
// id is applied as `deviceId: { exact: id }`. Practice mode used to have no
// microphone selection of its own, which meant a user who had picked a
// specific microphone for live mode was silently recorded on the OS default
// the moment they switched to practice.
export async function captureCameraAndMic(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: micAudioConstraints(deviceId),
  });

  return requireAudioTrack(
    stream,
    () =>
      "No microphone audio was captured. Practice needs your microphone to transcribe your answer.",
  );
}

export class PcmPipeline {
  constructor() {
    this.ctx = null;
    this.nodes = [];
    this._stopped = false;
  }

  // Wires stream -> worklet -> muted gain -> destination, calling onChunk with
  // each ArrayBuffer of PCM16. Routing the (silent) worklet output through a
  // zero-gain node to the destination keeps the graph "live" so process() keeps
  // firing, without echoing the captured audio back out the speakers.
  //
  // `sourceLabel` (D2) names whatever `stream` actually is, for the
  // AudioContext-resume failure message below. Defaults to "Microphone
  // capture" because every caller that omits it (practiceSession.js's own
  // mic+camera capture, and this file's own tests) IS in fact capturing a
  // microphone — this class also backs captureTabAudio/captureSystemAudio
  // via session.js's _addSource, though, which passes its own label rather
  // than falling back to this default: a tab or screen share failing here
  // must not be misreported as a microphone problem.
  async start(stream, onChunk, sourceLabel = "Microphone capture") {
    this._stopped = false;

    const ctx = new AudioContext({ sampleRate: 16000 });
    // Assigned before the addModule await so a stop() that lands while the
    // worklet module is still loading always finds a real AudioContext to
    // close. Assigning only after addModule() resolves (the old behavior)
    // left that window's stop() closing nothing, and the AudioContext this
    // call went on to build was a live, unreferenced leak nobody could ever
    // close — it held the audio graph over the captured stream open for the
    // life of the page.
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(WORKLET_URL);

    // The stop() above (if one landed) already closed `ctx`. Building nodes
    // on an already-closed context would throw and surface to the user as a
    // spurious error after they pressed Stop, so bail out instead of wiring
    // the graph.
    if (this._stopped) {
      return null;
    }

    // AC-S4.1 / defect 5: a suspended AudioContext never runs its worklet —
    // zero PCM bytes ever reach onChunk, and nothing about that state throws
    // or logs anywhere in this file. That is exactly how the reported bug
    // looked from the user's side: status pinned at "Live" with nothing ever
    // transcribed and no error shown. The in-person path builds this context
    // three async boundaries after the user's click (a permission prompt, a
    // token fetch, a socket handshake) — precisely where a mobile browser's
    // sticky user-activation window can run out, leaving the context created
    // in the "suspended" state instead of resuming automatically.
    //
    // Gated on `typeof ctx.state === "string"`: a real AudioContext always
    // reports `.state`, so this check runs unconditionally in production.
    // It's guarded here only because this class is also constructed by
    // PracticeSession (lib/copilot/practiceSession.js — out of scope for
    // this change) against fakes in lib/copilot/practiceSessionTestDoubles.js
    // that predate this AC and never modelled `.state` at all; skipping the
    // check when the double doesn't report a state leaves those suites
    // exactly as they were rather than requiring an edit outside this
    // defect's file list.
    if (typeof ctx.state === "string" && ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // Reported by the state check right below either way — resume()
        // rejecting and resume() silently not helping look identical from
        // here, and both must reach the same "still not running" report.
      }
      // A stop() can land while the resume() above was pending; that is not
      // a capture failure, it is a normal teardown racing this async call —
      // bail out the same way the _stopped check above already does, rather
      // than report a fatal error for a session the user chose to end.
      if (this._stopped) {
        return null;
      }
      if (ctx.state !== "running") {
        // AC-S4.1: this is the "REPORTED failure, not a silent one" —
        // thrown (the same channel requireAudioTrack in this file already
        // uses for a fatal capture problem) so it propagates out of
        // PcmPipeline.start(), out of CopilotSession._addSource, and
        // rejects start() instead of leaving the UI pinned at "Live"
        // forever.
        throw new Error(
          `${sourceLabel} could not start: the browser's audio pipeline is stuck "${ctx.state}" and would not resume. Try tapping or clicking the page, then start the session again.`,
        );
      }
    }

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
    const mute = ctx.createGain();
    mute.gain.value = 0;

    worklet.port.onmessage = (evt) => onChunk(evt.data);
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(ctx.destination);

    this.nodes = [source, worklet, mute];
    return ctx;
  }

  async stop() {
    this._stopped = true;
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.nodes = [];
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        // ignore
      }
      this.ctx = null;
    }
  }
}
