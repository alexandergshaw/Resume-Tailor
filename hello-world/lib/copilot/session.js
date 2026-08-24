// Orchestrates a full copilot capture session across the interviewer-audio
// sources the UI can pick from:
//   - "tab" / "system": the interviewer's voice, from a shared browser tab or
//     shared system audio (whichever `source` selects), each opened as its
//     own capture stream alongside an OPTIONAL microphone stream for "you".
//     Two independent per-source sockets give structural speaker separation
//     for free on this path — no diarization requested, none needed — and
//     every transcript event is tagged with the source ("them"/"you") it
//     came from, exactly as it was before this file grew the third source
//     below.
//   - "inperson" (AC-M1.4): everyone is on ONE shared microphone — an
//     in-person interview, a phone on speaker, a room mic. There is no tab
//     and no system audio carrying the other person's voice, so there is no
//     "them" stream to open at all, and unlike the two sources above the
//     microphone here is REQUIRED, not optional — it IS the session. Speaker
//     separation instead comes from asking the STT provider to diarize
//     (AC-M1.1/M1.2) and resolving which voice is the user with
//     speakerIdentity.js (AC-M1.3) over utterances assembled by
//     utteranceAssembly.js (AC-M1.6). That is NOT free, and it is NOT yet
//     verified against Deepgram's live service (see AC-M1's "Unverified"
//     section) — passing every test in session.inperson.test.js proves the
//     mapping/routing/identity logic is correct GIVEN Deepgram's documented
//     response shape, not that Deepgram returns that shape for this
//     account/model/audio. That gap is the user's manual regression case.
//
// A single aggregated status is reported to the UI regardless of source. Not
// every source is equally load-bearing, though (D1): "tab"/"system" sessions
// have an ESSENTIAL "them" source (the interviewer's audio — what the
// session is FOR) and an OPTIONAL "you" source (the user's own mic, already
// soft-failed at start() below if it never opens at all); "inperson" has
// exactly one source, the mic, which is simultaneously the only and
// therefore ESSENTIAL source there. aggregateStatus() below only escalates
// to "error" — which the UI reads as "kill the whole session" — off an
// ESSENTIAL source's failure. A non-essential source failing mid-session
// (e.g. an unexpected close on the optional mic socket, see
// stt/deepgram.js's unexpected-close handling) still reaches the user
// through the normal onError warning channel; it just doesn't take the
// healthy essential source down with it.
//
// Transcript events reach `onTranscript` tagged with the two-value `speaker`
// ("them"/"you") every existing consumer already understands; "inperson"
// additionally fires a second callback, `onUtterance`, once per assembled
// utterance, carrying the raw diarized `speakerTag` and an `evaluate` flag
// that drives question detection (AC-M1.4.9/10). "tab"/"system" never fire
// `onUtterance` — their existing per-tag assembly stays exactly where it
// lives today, in CopilotClient.js's own pendingRef path, untouched.

import { captureTabAudio, captureSystemAudio, captureMicAudio, PcmPipeline } from "./capture";
import { createSttStream } from "./stt";
import { createSpeakerIdentity } from "./speakerIdentity";
import { createUtteranceAssembly } from "./utteranceAssembly";

// Maps the `source` option to the capture function used for "them". Anything
// not in this map (including an omitted or garbage value, and "inperson" —
// see below) resolves to the tab path here, so an unrecognized choice
// degrades to today's behavior instead of throwing. "inperson" is
// deliberately absent: it has no "them" stream at all, and start() branches
// off to its own path (see _startInPerson) before this map is ever
// consulted, so its presence/absence here is moot for that source — it's
// left out anyway so a future reader can't mistake this map for a complete
// list of sources.
const THEM_CAPTURE_BY_SOURCE = {
  tab: captureTabAudio,
  system: captureSystemAudio,
};

// D2: mirrors THEM_CAPTURE_BY_SOURCE above, one-for-one, so _addSource's
// PcmPipeline failure message names the capture that's actually running
// (see captureLabel on _addSource) instead of always claiming to be the
// microphone — a tab or screen share failing at the AudioContext-resume
// check in capture.js used to be misreported as a mic problem. Same
// fallback rule as THEM_CAPTURE_BY_SOURCE: an unrecognized `source` degrades
// to the tab wording, matching the tab capture function it actually falls
// back to.
const THEM_CAPTURE_LABEL_BY_SOURCE = {
  tab: "Tab audio capture",
  system: "System audio capture",
};

// The utteranceAssembly key every "inperson" frame buffers under when
// `attributeSpeakers` is false (see _handleInPersonFrame). Any single stable
// value works — assembly only cares that the same turn's frames share one
// key — but a named constant says "the room" instead of leaning on
// `frame.speakerTag` silently reading as `undefined` when the key is absent.
const ROOM_TAG = "room";

// AC-I1.8: a getUserMedia rejection whose `.name` is "OverconstrainedError"
// means the `deviceId: { exact }` constraint captureMicAudio applied
// (session.js's own micDeviceId, or a stored id resolved by
// resolveStoredMicDeviceId in audioDevices.js that turned out to be stale
// anyway) couldn't be satisfied by any currently connected device — the
// selected microphone was unplugged or disconnected since it was chosen,
// not a permission problem. Telling a user in that state "microphone
// permission was denied" would be actively wrong and send them to the
// browser's site-permission settings looking for a toggle that was never
// the issue. This is checked by `.name` (the standard DOMException field
// getUserMedia rejections use), not by matching the error message text,
// which is not part of any spec and can't be relied on across browsers.
function micFailureMessage(err) {
  if (err?.name === "OverconstrainedError") {
    return "Selected microphone is no longer available (it may have been unplugged or disconnected). Continuing with interviewer audio only.";
  }
  return `Microphone unavailable (${err?.message || "denied"}). Continuing with interviewer audio only.`;
}

// AC-M1.4.3: in "tab"/"system" mode the microphone is optional and
// micFailureMessage's "Continuing with interviewer audio only" is true — the
// them stream keeps running either way. In "inperson" mode the microphone IS
// the entire session; there is no other source to continue with, so that
// sentence would be a plain falsehood here. This is a separate function, not
// a branch inside micFailureMessage, so the two wordings can never
// accidentally converge again. session.inperson.test.js matches on "cannot
// start" appearing in the rejection.
function micFatalMessage(err) {
  if (err?.name === "OverconstrainedError") {
    return "Selected microphone is no longer available (it may have been unplugged or disconnected). The session cannot start without a microphone.";
  }
  return `Microphone unavailable (${err?.message || "denied"}). The session cannot start without a microphone.`;
}

export class CopilotSession {
  constructor({
    withMic = true,
    source = "tab",
    micDeviceId,
    // Defaults true so every existing caller/test — none of which pass this
    // — constructs exactly the "inperson" session they always have: identity
    // built, diarization requested, labels resolved to "you"/"them". Only a
    // caller that explicitly opts out (the meeting copilot; see
    // session.meeting.test.js) gets the no-attribution behaviour threaded
    // through the seams below. "tab"/"system" never look at this flag at
    // all — they never built a speaker identity in the first place (see the
    // file header comment), so there is nothing here for it to turn off.
    attributeSpeakers = true,
    onTranscript,
    onUtterance,
    onSpeakerIdentity,
    onStatus,
    onError,
  } = {}) {
    this.withMic = withMic;
    this.source = source;
    // Left as whatever the caller passed — including `undefined` when
    // omitted — rather than defaulted to `null` here. captureMicAudio
    // already treats every falsy value (null, undefined, "") identically
    // (see capture.js), so this preserves "omitting micDeviceId reproduces
    // today's behaviour byte-for-byte" without this class needing its own
    // opinion about which falsy value means "no selection".
    this.micDeviceId = micDeviceId;
    this.captureThem = THEM_CAPTURE_BY_SOURCE[source] || captureTabAudio;
    // D2: paired with captureThem above so a PcmPipeline failure on the
    // "them" source names the right capture.
    this.captureThemLabel = THEM_CAPTURE_LABEL_BY_SOURCE[source] || THEM_CAPTURE_LABEL_BY_SOURCE.tab;
    this.onTranscript = onTranscript || (() => {});
    // AC-M1.4.9: fired only for the "inperson" source, once per utterance
    // assembled by utteranceAssembly.js. "tab"/"system" never call this.
    this.onUtterance = onUtterance || (() => {});
    // AC-M1.5.6: fired whenever the speaker-identity snapshot changes —
    // both from new evidence (observe, inside _emitUtterance below) and
    // from a manual correction (assignUser below) — so the UI can re-render
    // the transcript's labels. A correction alone produces no new
    // transcript line, so without this callback nothing would tell the UI
    // to re-read `speakerSnapshot()`/re-resolve labels at all. "tab"/
    // "system" have no speaker identity instance and never call this,
    // exactly like onUtterance above.
    this.onSpeakerIdentity = onSpeakerIdentity || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this._sources = []; // { key, stream, pipeline, dg }
    // AC-S4.3 / defect 7: every MediaStream this session has ever captured,
    // recorded the moment it is captured — BEFORE _addSource is attempted,
    // not after it succeeds. If _addSource throws partway through (the STT
    // provider's connect() rejecting because e.g. the token route 503'd is
    // the reported case), the stream never reaches `_sources` above, and
    // stop() used to only ever walk that array — the browser's own
    // recording indicator stayed lit for the rest of the page's life with
    // nothing left that could ever turn it off. stop() below stops every
    // track recorded here regardless of whether its source finished wiring.
    this._openStreams = [];
    this._statuses = {}; // key -> connecting | open | closed | error
    // D1: key -> whether that source is ESSENTIAL to the session (see the
    // essential-source rule in the file header comment above, and
    // aggregateStatus() below). Populated by _addSource before it opens
    // anything for that key, so it's always present by the time any status
    // callback for that key can fire.
    this._essential = {};
    this._stopped = false;
    // Stashed on the instance (not just closed over here) because
    // _startInPerson reads it too, to decide whether to ask the STT
    // provider for diarization at all and whether the "can't tell speakers
    // apart" warning still means anything.
    this.attributeSpeakers = attributeSpeakers;

    // AC-M1.4.9: ownership of both the speaker-identity and utterance-
    // assembly instances lives here, on the session, and only for
    // "inperson" — "tab"/"system" have structural separation already and
    // must stay on their existing, untouched pendingRef path in
    // CopilotClient.js (AC-M1.4.7). Creating these unconditionally would
    // cost nothing functionally (they'd simply never be fed), but scoping
    // them to the source that actually uses them keeps it obvious from the
    // constructor alone which sources this bookkeeping applies to.
    //
    // `attributeSpeakers` is a second, independent gate on the identity half
    // only. `_utteranceAssembly` is built exactly as before, off `source`
    // alone: a meeting still has turns that need assembling from interim
    // frames into whole utterances, it just never runs them through
    // speakerIdentity.js afterward (see _resolveSpeakerLabel/_emitUtterance
    // below) — the youScore formula that file uses to decide who "you" is
    // assumes the candidate talks most and asks fewest questions, which is
    // routinely backwards for a meeting's actual quietest/most-inquisitive
    // participant (see this file's own header and speakerIdentity.js's).
    this._speakerIdentity =
      source === "inperson" && attributeSpeakers ? createSpeakerIdentity() : null;
    this._utteranceAssembly = source === "inperson" ? createUtteranceAssembly() : null;
  }

  _setStatus(key, s) {
    this._statuses[key] = s;
    this.onStatus(this.aggregateStatus());
  }

  // Collapse per-source socket states into one status for the UI.
  //
  // D1 / R-038: a failure on a non-essential source must DEGRADE the
  // session, not KILL it — only an "error" on an ESSENTIAL source (see the
  // file header comment's essential-source rule, and `this._essential`
  // above) escalates the whole aggregate to "error". Concretely: on a
  // "tab"/"system" session an unexpected close of the optional "you" mic
  // socket must leave the aggregate exactly where the interviewer's own
  // "them" socket says it is (still "live" if "them" is still open) — the
  // mic error is still told to the user, just through onError (see
  // _addSource's onError handler below), not by tearing down a session
  // that's still doing its job. A "them" failure, and the sole "mic" source
  // failing on an "inperson" session, are essential by contrast and DO
  // escalate — they are not silently downgraded.
  //
  // A non-essential source that ended in "error" is otherwise treated like
  // "closed" for the rest of this computation (the `effective` map below):
  // it must not itself keep the aggregate stuck at "connecting", and it
  // must not stop an all-other-sources-closed session from correctly
  // reporting "idle".
  aggregateStatus() {
    const entries = Object.entries(this._statuses);
    if (entries.length === 0) return "idle";
    const essentialFailed = entries.some(
      ([key, v]) => v === "error" && this._essential[key] !== false,
    );
    if (essentialFailed) return "error";
    const effective = entries.map(([, v]) => (v === "error" ? "closed" : v));
    if (effective.every((v) => v === "closed")) return "idle";
    if (effective.some((v) => v === "open")) return "live";
    return "connecting";
  }

  // `onFrame`, when given, replaces the default "forward the frame to
  // onTranscript untouched" behavior. Only the "inperson" path passes one
  // (see _startInPerson) — "tab"/"system" always fall through to the default
  // arm, which is byte-identical to what this method did before "inperson"
  // existed (AC-M1.4.7). Returns the connected stream so a caller that needs
  // to inspect it post-connect (AC-M1.4.11's diarizationActive check) can.
  //
  // `essential` (D1, defaults true) records, in `this._essential`, whether
  // THIS source is allowed to take the whole session down with it when its
  // socket errors — see the essential-source rule in the file header
  // comment and aggregateStatus() above. Set before anything is opened for
  // this key, since a status/error callback for it can in principle fire as
  // early as createSttStream's own onStatus("connecting").
  //
  // `captureLabel` (D2) names the actual thing being captured — "Tab audio
  // capture" / "System audio capture" / "Microphone capture" — so a failure
  // inside pipeline.start() (see capture.js's PcmPipeline) reports itself
  // correctly instead of always claiming to be the microphone. Defaults to
  // PcmPipeline's own default, which is "Microphone capture" — every
  // non-"them" call site here is in fact a microphone, so only the "them"
  // call site needs to override it.
  async _addSource({ key, speaker, stream, diarize = false, onFrame, essential = true, captureLabel }) {
    this._essential[key] = essential;
    const dg = await createSttStream({
      speaker,
      diarize,
      onStatus: (s) => this._setStatus(key, s),
      onError: (err) => {
        this.onError(err);
        this._setStatus(key, "error");
      },
      onTranscript: onFrame || ((t) => this.onTranscript(t)),
    });

    // D2: from here down, `dg`'s socket can be OPEN (once connect() below
    // resolves) and the PcmPipeline's AudioContext can be live (once
    // pipeline.start() resolves) before either has ever reached
    // `this._sources` — the ONLY place stop() looks to close them. A throw
    // anywhere in this window (pipeline.start()'s AudioContext-resume check
    // in capture.js, AC-S4.1, is the reported case, but this guards the
    // whole window, not just that one call) used to leak both: the socket
    // stayed open and billed, and the AudioContext stayed live, for the
    // rest of the page's life, because nothing ever ran that had a
    // reference to either. Catch, release both, then rethrow so start()
    // still rejects exactly as it did before — callers' existing
    // `.rejects.toThrow(...)` expectations are unchanged.
    let pipeline;
    try {
      await dg.connect();
      pipeline = new PcmPipeline();
      await pipeline.start(stream, (chunk) => dg.send(chunk), captureLabel);
    } catch (err) {
      try {
        dg.close();
      } catch {
        // ignore — best-effort teardown of a source that's already failing
      }
      if (pipeline) {
        try {
          await pipeline.stop();
        } catch {
          // ignore — same best-effort teardown
        }
      }
      throw err;
    }

    // Native "Stop sharing" button or an unplugged mic ends the track — tear the
    // whole session down so the UI returns to idle.
    stream.getAudioTracks()[0]?.addEventListener("ended", () => this.stop());

    this._sources.push({ key, stream, pipeline, dg });
    return dg;
  }

  // AC-M1.4.8/10: resolves a frame's raw `speakerTag` to the two-value label
  // every existing consumer already understands. speakerIdentity.labelFor
  // has a THIRD value, "unknown" — for a tag that hasn't been observed yet
  // at all, including every tag's very first turn (AC-M1.3.7 forbids "you"
  // from a single observed voice on purpose). "unknown" collapses to "them"
  // here, the same direction question detection defaults to: an
  // as-yet-unidentified voice's first question must never be dropped by a
  // downstream consumer that only branches on speaker === "them".
  _resolveSpeakerLabel(tag) {
    // No identity instance means attribution was never wanted (see the
    // constructor) — there is no argmax to consult and, more importantly,
    // no separated voices to describe. "them"/"you" both claim a specific
    // one of two people; "room" claims neither, because on a shared meeting
    // microphone there isn't a two-party split to be right or wrong about.
    if (!this._speakerIdentity) return "room";
    return this._speakerIdentity.labelFor(tag) === "you" ? "you" : "them";
  }

  // AC-M1.3.2: observe() must run once per ASSEMBLED utterance, never once
  // per transcript frame — this is the only call site that invokes it, fed
  // exclusively by utteranceAssembly's push()/drain()/drainAll() below.
  _emitUtterance(tag, text) {
    // With attribution off there is no identity to feed observe() into, and
    // therefore nothing that could have just resolved/changed argmax — so
    // observe()/onSpeakerIdentity are skipped outright rather than called
    // against a stub. Firing onSpeakerIdentity here at all would tell the UI
    // an identity was computed, which is exactly the false impression this
    // option exists to prevent (see session.meeting.test.js's "never reports
    // a speaker identity"). `evaluate` is unconditionally true: the gate
    // this flag normally comes from (shouldEvaluateAsQuestion) exists to
    // stay conservative about ATTRIBUTING a question to the wrong party —
    // a distinction a meeting with one undivided voice doesn't have. There
    // is no "the other person asked this" to be conservative about, so
    // every turn is potential material.
    if (!this._speakerIdentity) {
      this.onUtterance({ speakerTag: null, speaker: "room", text, evaluate: true });
      return;
    }
    this._speakerIdentity.observe({ speakerTag: tag, text });
    // AC-M1.5.6: identity may have just resolved, changed argmax, or
    // reached "high" confidence as a direct result of this observation —
    // notify on every observation, not only on a manual correction, so the
    // transcript's labels (and the "still working out who is who" banner)
    // stay live as the conversation actually unfolds, not only at the one
    // moment a user clicks a correction.
    this.onSpeakerIdentity(this._speakerIdentity.snapshot());
    this.onUtterance({
      speakerTag: tag,
      speaker: this._resolveSpeakerLabel(tag),
      text,
      // AC-M1.4.10: deliberately from shouldEvaluateAsQuestion, NOT from the
      // label above. The label is a display guess; the gate is deliberately
      // more conservative (AC-M1.3.5). Routing question detection off the
      // label instead of this flag would reintroduce v1's exact
      // silent-deafness bug — see speakerIdentity.js's header comment.
      evaluate: this._speakerIdentity.shouldEvaluateAsQuestion(tag),
    });
  }

  // AC-M1.4.8/9: the onTranscript handler used ONLY for the "inperson"
  // source's single mic stream (wired in _startInPerson below).
  _handleInPersonFrame(frame) {
    // With attribution off, diarize is never requested (see _startInPerson),
    // so frame.speakerTag isn't merely undefined — stt/index.js's contract
    // is that the key is ABSENT entirely when the provider didn't split the
    // frame. utteranceAssembly still needs SOME key to buffer under, the
    // same way it does for a real speaker tag, so ROOM_TAG stands in for
    // "the one voice in this room" — a single constant every frame shares,
    // so pushes from turn to turn keep landing in the same buffer and drain
    // exactly like a normal per-speaker buffer would.
    const tag = this._speakerIdentity ? frame.speakerTag : ROOM_TAG;
    this.onTranscript({ ...frame, speaker: this._resolveSpeakerLabel(tag) });

    // Only a LOCKED run feeds the utterance buffer. Deepgram's interim runs
    // for a still-settling span repeat and revise the same words as they
    // firm up; pushing every interim would duplicate text into the
    // assembled utterance the same way R-127 duplicated it at the provider
    // layer — the exact class of bug AC-M1's "Unverified" section warns
    // against repeating.
    if (!frame.isFinal) return;

    // AC-S4.4 / defect 8: mirrors app/copilot/useLiveSession.js:739's own
    // guard on the exact same field. `textAlreadyDelivered` (see
    // stt/index.js's onTranscript contract) means this frame's TEXT is an
    // exact re-delivery of a final this instance already pushed — ElevenLabs'
    // commit_strategy=vad re-sends a final utterance's text a second time
    // purely to carry `speechFinal: true`. Pushing it again would double
    // every assembled in-person utterance built from such frames, the same
    // R-127 bug useLiveSession.js already guards against on its own
    // accumulation path. `speechFinal` below is still honoured
    // unconditionally — it is this frame's own end-of-turn signal
    // regardless of whether its text was new.
    if (!frame.textAlreadyDelivered) {
      const completed = this._utteranceAssembly.push(tag, frame.transcript);
      if (completed) this._emitUtterance(completed.tag, completed.text);
    }

    // AC-M1.6.2: a tag also drains on its OWN speechFinal, independent of
    // whichever tag push() above just completed (if any) — "whichever comes
    // first" between a different speaker's run arriving and this speaker's
    // own end-of-turn signal.
    if (frame.speechFinal) {
      const drained = this._utteranceAssembly.drain(tag);
      if (drained) this._emitUtterance(drained.tag, drained.text);
    }
  }

  // AC-M1.4.2/3/4: mic-only. No getDisplayMedia call of any kind — the
  // microphone is captured directly and is REQUIRED (withMic is ignored;
  // honoring `withMic: false` here would build a session with zero sources,
  // whose aggregateStatus() reports "idle" while nothing ever transcribes).
  async _startInPerson() {
    let micStream;
    try {
      micStream = await captureMicAudio(this.micDeviceId);
    } catch (err) {
      // AC-M1.4.3: fatal, not a soft warning — there is no interviewer
      // stream to keep running without it.
      throw new Error(micFatalMessage(err));
    }
    if (this._stopped) {
      // R-041 / AC-M1.4.5: the same discipline the them/you branches below
      // apply — a stop() that landed while the getUserMedia prompt was still
      // up must release the granted tracks and return without ever opening
      // a socket.
      micStream.getTracks().forEach((t) => t.stop());
      return;
    }

    // AC-S4.3: recorded before _addSource is attempted (see the
    // _openStreams comment in the constructor) — if the STT connect() call
    // inside _addSource throws, this is what stop() still finds to release.
    this._openStreams.push(micStream);

    const dg = await this._addSource({
      key: "mic",
      speaker: "mic",
      stream: micStream,
      // Asking a provider to separate speakers and then discarding the
      // answer would still cost the request and, on Deepgram, a different
      // model — so this is never requested at all when nothing downstream
      // (see the constructor's `_speakerIdentity` gate) will ever consult
      // it.
      diarize: this.attributeSpeakers,
      onFrame: (frame) => this._handleInPersonFrame(frame),
      // D1: the mic is this session's ONLY source — simultaneously the only
      // and therefore essential one (see the file header comment) — so its
      // default of `essential: true` is left implicit here.
    });

    // `this.attributeSpeakers &&` here (not just below `!dg.diarizationActive`)
    // is what keeps this a warning about a DEGRADATION rather than a
    // description of the option working as configured — with attribution
    // off, diarize was never requested above, so dg.diarizationActive is
    // always false here too, and without this guard every meeting session
    // would trip this same warning on every single run. The wording below
    // names live pace and filler-word readings "for you" and describes
    // turns that "can't be attributed" — both meaningless when nobody asked
    // for attribution in the first place.
    if (this.attributeSpeakers && !dg.diarizationActive) {
      // AC-M1.4.11: requesting diarization from a provider that can't do it
      // (ElevenLabs Scribe v2 Realtime, or a Deepgram request whose token
      // fetch failed before diarizationActive could be earned — see
      // stt/index.js) is not an error. The session still starts and
      // transcribes; every utterance simply routes as "them" and gets
      // question-evaluated, which is still genuinely useful since in an
      // interview the questions mostly do come from the other person. But
      // silently degrading would look identical to a normal working session
      // that just never separates speakers, so this warns once, in the
      // user's terms, and names what specifically stops working: turns
      // can't be attributed, and live pace / filler-word readings for "you"
      // are not measured at all, because recordSpeechSample is gated on
      // speaker === "you" — nothing here will ever resolve to that value.
      this.onError(
        new Error(
          "Your configured speech-to-text provider can't tell speakers apart on a single microphone, so this session will transcribe everyone as one voice. Live pace and filler-word measurements for you will not be available this session.",
        ),
      );
    }
  }

  // AC-M1.5.6: the public identity surface the UI's correction control
  // needs. Both are harmless no-ops for "tab"/"system", which never build a
  // `_speakerIdentity` instance (see the constructor) — those paths stay
  // byte-identical to HEAD.
  speakerSnapshot() {
    if (!this._speakerIdentity) return { userTag: null, confidence: "unknown", overridden: false, tags: [] };
    return this._speakerIdentity.snapshot();
  }

  assignUser(tag) {
    if (!this._speakerIdentity) return;
    this._speakerIdentity.setUserTag(tag);
    // AC-M1.5.6: a correction produces no new transcript line on its own —
    // this is the ONE notification a re-render has to go on.
    this.onSpeakerIdentity(this._speakerIdentity.snapshot());
  }

  async start() {
    this._stopped = false;

    if (this.source === "inperson") {
      return this._startInPerson();
    }

    // Interviewer audio (tab or system, per `source`) is required. Capture it
    // first so its picker shows before we prompt for the mic.
    const themStream = await this.captureThem();
    if (this._stopped) {
      themStream.getTracks().forEach((t) => t.stop());
      return;
    }
    // AC-S4.3: recorded before _addSource is attempted — see the
    // _openStreams comment in the constructor for why `_sources` alone
    // cannot be trusted to release this stream on a later stop().
    this._openStreams.push(themStream);
    // D1: essential — a failure here is fatal and rejects start() (R-038),
    // so `essential` is left at its default of true. D2: captureLabel names
    // the actual capture (tab vs. system) rather than the mic default.
    await this._addSource({
      key: "them",
      speaker: "them",
      stream: themStream,
      captureLabel: this.captureThemLabel,
    });

    if (this.withMic) {
      try {
        const micStream = await captureMicAudio(this.micDeviceId);
        if (this._stopped) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        this._openStreams.push(micStream);
        // D1: NOT essential — the mic is optional on this source (see the
        // file header comment); an error on this socket must degrade, not
        // kill, the session. See aggregateStatus() for how that's enforced.
        await this._addSource({ key: "you", speaker: "you", stream: micStream, essential: false });
      } catch (err) {
        // The mic is optional — keep the tab transcript running and surface a
        // soft warning rather than failing the whole session, regardless of
        // WHY it failed. micFailureMessage above only changes the wording
        // for an unavailable-selected-device failure; the "keep going with
        // interviewer audio only" behaviour is identical either way.
        this.onError(new Error(micFailureMessage(err)));
      }
    }
  }

  async stop() {
    this._stopped = true;

    // AC-M1.6.2: drainAll() so a turn mid-flight when the session ends isn't
    // silently stranded in a buffer for the life of the process. Whatever
    // comes back still goes through the exact same observe()/onUtterance
    // path as any other completed utterance. Note: no test in
    // session.inperson.test.js currently exercises this — every delivered
    // turn there carries its own speechFinal and self-drains immediately, so
    // nothing is ever left buffered at stop() time in that suite. This block
    // is covered by the AC's requirement, not by a red test; removing it
    // does not fail the pinned suite (verified by deliberately removing it
    // and re-running — see the sabotage report).
    if (this._utteranceAssembly) {
      for (const { tag, text } of this._utteranceAssembly.drainAll()) {
        this._emitUtterance(tag, text);
      }
    }

    for (const src of this._sources) {
      try {
        src.dg.close();
      } catch {
        // ignore
      }
      try {
        await src.pipeline.stop();
      } catch {
        // ignore
      }
    }

    // AC-S4.3 / defect 7: stops every track from every stream this session
    // ever captured — not just the ones whose source finished wiring into
    // `_sources` above. A stream that was captured but never made it that
    // far (its _addSource call threw) is exactly the leak this closes: the
    // browser's own "microphone/screen in use" indicator otherwise stays lit
    // for the rest of the page's life, reading to the user as a session
    // that is somehow still live.
    for (const stream of this._openStreams) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    }

    this._sources = [];
    this._openStreams = [];
    this._statuses = {};
    this._essential = {};
    this.onStatus("idle");
  }
}
