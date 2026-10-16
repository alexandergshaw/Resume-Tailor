# N166 — camera question source intake

Status: proposed scope, pending independent check. Author: `/root/n166_intake`.
Source revision: `7bb3f97ef0042a484d692d71bd031ed8062735b4`.
Assignment permits this document only; no application changes, gates, live calls,
backlog/state writes or dispatch grants were performed here.

## Owner request and interpretation

Owner: “i want the option to have questions also appear through the camera as a
source when in live or practice interview modes. topi priotirty”. Root owns the
N166 first-position backlog entry and ordering verification.

Recommended reversible coordinator interpretation: let the user point a camera at
written/displayed interview questions, explicitly capture one frame, read its text,
review/edit it, and add it to the current interview's question flow. “Camera as a
source” means visual question text here; this is an assumption, not an owner ruling
that continuous recognition or face interpretation was requested. The first chunk
offers an optional source alongside current sources in both live and practice.
Continuous polling, automatic answer submission, remote-camera capture, video
recording, emotion/identity inference, role-drill mode and storage of frames are
excluded. Explicit capture/review provides bounded requests and avoids introducing
background image transfers. No need to block reversible design on this assumption.

## Actual capability and reuse

- `hello-world/app/copilot/CopilotClient.js` renders `ManualQuestion` with
  `useLiveSession.addManualQuestion`; that hook delegates to
  `app/copilot/useQuestionPipeline.js`. The latter validates manual text, enters
  the common card constructor, follows existing auto-draft preference, and seeds
  audio duplicate suppression. Use this sink; do not invent a second answer path.
- `app/copilot/practice/PracticeClient.js` already has camera self-view and a
  manual input. `usePracticeHandlers.onManualQuestion` calls
  `lib/copilot/manualQuestion.js::submitPracticeQuestion`: bank old question,
  abandon/reset old answer, replace drill question, then add a drafted feed entry
  through `practice/useRoomQuestions.addManualQuestion`. Camera input must use
  this same composed handler, not just replace the visible drill card.
- `lib/copilot/manualQuestion.js` normalizes whitespace, requires a Unicode
  letter/digit, and caps at 1,200 characters. It does not rewrite speech. Avoid
  silently truncating OCR output before the user can review it; disclose/select
  the submitted limit in the review UI. Both manual sinks return strict boolean
  acceptance, so rejection must retain editable text and avoid success claims.
- `lib/copilot/practiceSession.js` obtains optional camera plus microphone;
  `practice/usePracticeCaptureSession.js` owns stop/unmount/late permission
  cleanup and camera toggles. `practice/CameraPreview.js` is purely presentational,
  mirrors the self-view, and clears its video element reference without stopping
  tracks. It also has a role-drill caller. Do not change this shared component to
  acquire or stop another owner's stream. Reading should use unmirrored source
  pixels, even if the viewfinder is mirrored.
- `lib/copilot/session.js` orchestrates live audio (tab/system/in-person), not
  camera reading. `useCaptureSetup.js` chooses interviewer audio source. Camera
  question input should be additive, without changing its source enum, diarization,
  selected microphone, or speech capture lifecycle.
- `lib/scrape/screenshotOcr.js::ocrImage` already accepts image bytes and returns
  plain OCR text using installed Tesseract and pinned English language data.
  Reuse this low-level function only. `readScreenshotOffline` additionally derives
  job-posting fields and is unsuitable for interview questions. Existing worker is
  shared and deployment fallback may fetch language data from its CDN; do not
  describe this helper as an unconditional browser-only/no-network guarantee.
- `app/api/posting-from-image/route.js` demonstrates authentication before multipart
  parsing, module-scope rate limiting, MIME/size rejection and the OCR seam. Its
  route also performs job search/page fetching and Gemini vision; do not call that
  endpoint for camera questions. A narrow authenticated OCR route avoids new paid
  model access or installation. Images reach this application's server for OCR;
  text then follows the selected existing answer engine after explicit Add.

Targeted source searches found no camera/image/OCR ingestion in the above live or
practice question hooks/manual control. Known-positive camera canary is
`practice/CameraPreview.js`, and OCR canary is `screenshotOcr.js`; this is a bounded
source inspection, not a claim about every possible repository route or live UI.

## Observable proposed criteria

| ID | Required behavior and evidence receiver |
| --- | --- |
| N166-C1 | Live and practice each expose an optional labelled camera-question action; initial render requests no camera or image transfer. Component tests plus actual caller-wiring checks. |
| N166-C2 | Explicit start requests video only; ready frame capture sends one bounded image to the dedicated OCR endpoint, with no frame polling or automatic Add. Tests inspect media constraints and request counts; real browser camera permission remains separate evidence. |
| N166-C3 | OCR text is displayed editable before Add; empty/unreadable text, denial, unavailable API/camera, unreadied video, failed/limited/unauthorized OCR and rejected submission produce visible actionable status, with retry/close and no false success or lost manual text. Component and route tests. |
| N166-C4 | Accepted text produces existing live card/auto-draft behavior and practice drill-plus-feed behavior with existing answer-state invalidation. Existing manual tests plus camera-to-handler integration/wiring assertions establish this; text must not merely appear in a disconnected textbox. |
| N166-C5 | Close, stop, mode change and unmount release camera-owned tracks; a permission result or OCR completion arriving after close/context change cannot reopen camera, repaint or submit stale text. Do not stop practice/STT-owned tracks. Deferred promises/track-spy tests. |
| N166-C6 | Authenticated endpoint rejects signed-out callers before body/OCR, rejects invalid/oversized images before OCR, bounds attempts before expensive work and returns text only, without frame persistence/logging or Gemini/search calls. Independent negative/boundary tests and source review. |
| N166-C7 | Keyboard-accessible start/capture/edit/Add/close with labelled viewfinder and status; disclosure states server OCR and existing downstream answer processing before capture. Existing typed/audio/generated sources and practice self-view remain available. DOM/a11y and regression tests; browser layout/real hardware observations named separately. |

Advantage over copying into a separate LLM chat: a captured written question can
enter the selected application's existing grounded answer feed and practice drill
without retyping or manually transferring posting/document context. Review protects
against OCR errors. The UI shows camera state, reading state, editable result,
empty/error state and exact accepted action; diagnostics must avoid raw frame logs.

## Proposed exact implementation boundary

Minimum production additions (names proposed, not existing interfaces):

- `hello-world/app/copilot/CameraQuestionSource.js` — shared optional viewfinder,
  explicit capture/review/Add and owned video-only lifecycle.
- `hello-world/lib/copilot/cameraQuestion.js` — bounded image-request/client helpers
  if extraction is needed for independent lifecycle/request tests.
- `hello-world/app/api/copilot/camera-question/route.js` — authenticated bounded
  image-to-plain-OCR-text only, reusing `ocrImage`.
- Existing `hello-world/app/copilot/CopilotClient.js` and
  `hello-world/app/copilot/practice/PracticeClient.js` — mount shared control next
  to manual question and pass the already existing handler and context reset key.

Minimum new tests: `CameraQuestionSource.test.js`, `CameraQuestionSource.wiring.test.js`
under `app/copilot/`; `lib/copilot/cameraQuestion.test.js` if helper admitted;
`app/api/copilot/camera-question/route.test.js`. Any exact expansions need coordinator
admission first, including line-budget extraction or modification of shared OCR.

Affected existing assertions/callers: `ManualQuestion.test.js`,
`useLiveSession.manual.test.js`, `practice/usePracticeQuestions.manual.test.js`,
`practice/useRoomQuestions.manual.test.js`, `practice/usePracticeHandlers.extraction.test.js`,
`practice/PracticeClient.*wiring.test.js`, `practice/PracticeSurface.test.js`,
`practice/CameraPreview.mobile.test.js`, `lib/copilot/practiceSession*.test.js`.
Shared CameraPreview also serves `roles/RoleDrillClient.js` but no role-mode feature
is included. Existing manual handler signatures should remain unchanged.

## Constraints, design receivers and verification

Security/privacy and reliability seats are triggered by image transfer, authenticated
CPU work, camera permission ownership and asynchronous context changes. UX/accessibility
is triggered by new viewfinder/review controls. Storage/schema migration is omitted:
frames remain transient and existing question persistence is reused. A new model
integration is omitted because installed OCR suffices for the first bounded chunk;
recognition quality, non-English scripts and glare are explicit limitations to assess,
not fabricated successes or an excuse to infer unreadable text.

Planner must select exact MIME/decoded-pixel/byte/request limits, malformed-image
handling, timeout and concurrency policy before implementation; shared OCR worker
reuse must not let a camera route terminate other requests' worker. Camera-only
stream is a simple ownership boundary but concurrent browser/device support is a
real-hardware verification obligation; borrowing practice's stream instead requires
an explicit non-owning contract with camera-off/ended and late-start tests.

Required instruments discovered in `hello-world/package.json`: `npm.cmd test`,
`npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run backlog:check` (cwd hello-world).
Root `npm.cmd run loop:test` is the mandatory workflow gate. Gates sharing caches
must be serialized. `vitest.config.js` supports this repository's JSX-bearing .js
test setup. CI workflow inspected is Supabase migration deployment; no SQL/config
changes are proposed and no deploy is authorized here. This document ran no tests.
Independent test designer must supply source-bound mutations for auth-before-work,
stale completion, owned-track cleanup, explicit-review boundary and both-mode sink
wiring, with baseline/harmless/restored controls. Real camera, browser layout and
live authenticated server behavior need their own honest measured evidence.

Source identities (SHA-256 at intake): CopilotClient
`826E71BE7E031A43C9FFD12A72511C28E5938B14208885E07CDACAA4645F4630`;
PracticeClient `6E16BEB8D425C056063308E71A4E019D68A796B5B3A56F908373EE87786C73BB`;
screenshotOcr `78A112614BA0F69F77F5B508C81A3238EA673F85B9F61B2E3724CDD2EAA93EAB`;
manualQuestion `1909FC8DCE6CAE2875455D7F06631CCA48E40F7423D4F43E5AE1BE6BFB4A4E6C`.

## Mount-boundary amendment — before engine admission

Root observed current clients at 938/926 raw lines. Existing
`CopilotClient.extraction.test.js` and
`practice/usePracticeHandlers.extraction.test.js` enforce 950-line ceilings;
do not raise these ceilings or delete explanatory comments to fit new behavior.
The lowest-change mount seam is existing `ManualQuestion`, whose only production
callers in the scoped `hello-world/app` search are CopilotClient and PracticeClient.
The known-positive canaries are their actual `<ManualQuestion` mounts. RoleDrillClient
imports shared CameraPreview but does not mount ManualQuestion. Explicit opt-in still
protects future and test callers: new `cameraEnabled = false` prop, plus a bounded
`cameraContextKey` prop supplied at the two existing mounts. This adds no camera
import or separate viewfinder JSX tree to either near-limit client.

Recommended refinement to the earlier write proposal:

- ADD production ownership `hello-world/app/copilot/ManualQuestion.js`.
- ADD existing-test ownership `hello-world/app/copilot/ManualQuestion.test.js`.
- Keep CameraQuestionSource, route, helper and their new tests as proposed above;
  keep both existing client paths for only explicit enable/context wiring.
- ADD affected assertions, read-only unless a concrete change is admitted:
  `hello-world/app/copilot/CopilotClient.extraction.test.js`,
  `hello-world/app/copilot/SessionControls.extraction.test.js`, and
  `hello-world/app/copilot/roles/RoleDrillClient.recording.test.js`.

ManualQuestion should render its unchanged typed-question form and the opt-in
camera source as sibling elements under a fragment/container. Do not nest the
camera review form inside its existing `<Box component="form">`: that produces
invalid nested forms and can submit the typed input accidentally. Pass the exact
same `onSubmit` to camera source, along with caller's button/confirmation labels
and disabled state where applicable. Camera review maintains its own editable text
and status so starting, failing or cancelling OCR cannot overwrite an unfinished
typed question. A camera-specific acknowledgement should retain source attribution;
acceptance remains the existing strict `true` result. Both sources need only one
explicit Add each; no camera-source Add should trigger the typed form as well.

Context wiring must invalidate camera acquisition/read on selected posting,
interview format, engine and session lifecycle changes. Existing status values are
idle/connecting/live/error, and clients already read posting/engine/format; stable
primitive keys can cover these boundaries without enlarging handler interfaces.
Mode switching unmounts the relevant client. Planner must prove the chosen key
also distinguishes a same-context session restart; status alone cannot be assumed
to establish session identity when transitions can batch. If existing client values
cannot prove this, admit an exact session-epoch bridge before implementation rather
than quietly claiming status provides stronger fencing than it does. Do not key the
whole ManualQuestion form merely to clear camera state, since that would discard
an unrelated unfinished typed question. Reset only the camera child/lifecycle.

Independent tests must prove default-disabled ManualQuestion requests no media,
the two production mounts explicitly enable the feature with correct handlers and
context wiring, role mode remains unaffected, camera refusal leaves both editable
inputs intact, and both caller line ceilings remain unchanged. Source-wiring checks
supplement actual shared-component behavior; they do not establish real camera
permission behavior or full rendered PracticeClient integration.

### Session identity refinement

Further source inspection found an existing true practice identity:
`practice/usePracticeCaptureSession.js` increments private `sessionIdRef` at the
very beginning of each Start, mirrors it into render-safe `activeSessionId` state,
and exposes that state; PracticeClient already destructures it. Use
`activeSessionId` in the practice camera context, alongside status/posting/format/
engine. Do not read the ref during render or manufacture an identity from timestamps.
No additional practice hook production path is needed to distinguish batched
same-context restarts.

Live `useLiveSession.js` exposes `sessionRef`, `startedAt`, `liveSince`, but none is
a suitable render-safe guaranteed unique Start identity: sessionRef is mutable and
assigned only after resets; both time fields use Date.now; neither guarantees
uniqueness for two Starts in one clock tick. Parent `draftGenRef` is also mutable
and additionally changes for draft-context invalidations, not a public session
identity. Prefer a small explicit live lifecycle bridge:

- ADD exact production ownership `hello-world/app/copilot/useLiveSession.js`.
- ADD exact new-test ownership
  `hello-world/app/copilot/useLiveSession.cameraContext.test.js`.
- Introduce render-safe monotonic `cameraSessionEpoch` state, incremented with a
  functional updater at the entry to Start and Stop, before any awaited teardown,
  and return it for the existing CopilotClient to pass to camera context. This
  token invalidates camera work; it must not pretend to fence existing audio
  callbacks or change audio lifecycle behavior. A monotonic identity is not a
  clock, log identifier or persisted record. Hook unmount already unmounts its
  camera child, so no setState-on-unmount is needed.
- Existing affected tests include `useLiveSession.split.test.js` (hook ceiling
  strictly below 880 lines), manual/provider/log/instant tests, and both caller
  line ceilings. No changes to their assertions are proposed. New behavior tests
  hold Date.now constant, run two same-context Starts, and observe distinct camera
  epochs despite final equal status; separately hold Stop teardown unresolved and
  establish invalidation before it resolves.

Stop timing is a separate obligation from restart identity. Both current Stop
handlers await the capture session's stop before setting status idle. Practice's
existing activeSessionId increments on Start only. Therefore practice
activeSessionId+status alone does **not** establish immediate camera invalidation
while a slow Stop is pending. Planner must either admit a narrowly scoped practice
camera-lifecycle epoch bridge (exact additional production
`hello-world/app/copilot/practice/usePracticeCaptureSession.js`, new test
`hello-world/app/copilot/practice/usePracticeCaptureSession.cameraContext.test.js`)
with the same Start/Stop-entry semantics, or provide a proven synchronous Stop
signal at the existing caller. Do not alter existing activeSessionId semantics
merely for camera cleanup: practice session logs already rely on that identity.
The optional practice bridge is included here for coordinator admission before
automatic design; it is not an unchecked permission expansion for a worker.
