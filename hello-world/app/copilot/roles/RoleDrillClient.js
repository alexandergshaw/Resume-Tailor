"use client";

import { useCallback } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { answerStatusMessage, visuallyHidden } from "@/lib/copilot/answerStatus";
import { roleLabel } from "@/lib/copilot/roleRegisters";
import CameraPreview from "../practice/CameraPreview";
import TranscriptView from "../TranscriptView";
import ModelResponse from "./ModelResponse";
import RoleAnswerPanel from "./RoleAnswerPanel";
import RoleDrillControls from "./RoleDrillControls";
import RolePicker from "./RolePicker";
import SituationCard from "./SituationCard";
import { useRoleAnswer } from "./useRoleAnswer";
import { useRoleChoice } from "./useRoleChoice";
import { useRoleDrill } from "./useRoleDrill";

// AC-Q0/AC-Q9/AC-R1 - the "Speak as" mode's own screen: a role picker, a
// situation to answer out loud, a recording surface for that answer, and an
// on-demand model answer that demonstrates the role's register. Owns layout
// only - the persisted role choice lives in useRoleChoice.js, the situation/
// reveal state and every situation/model-answer network call live in
// useRoleDrill.js, and the whole answer-recording/critique/save flow (AC-R1)
// lives in useRoleAnswer.js, which reuses practice mode's own machinery
// rather than reimplementing it (see that file's own doc). Mounted by
// app/copilot/CopilotClient (wave 3) only while its own toggle is selected,
// which is what satisfies AC-Q0.2's "no fetch on page load while another
// mode is selected": this component simply doesn't exist in the tree until
// then.
//
// AC-R1 (post-recording revision): this mode now streams audio to the STT
// provider and, once an answer is recorded, sends the answer transcript
// (the role and the situation text too, so the critique can judge whether
// the answer fits the register) to the feedback engine - the
// roleRecordingPrivacyNotice above the recording controls states exactly
// what leaves the browser, for the engine and switches as they currently
// stand. Nothing about the user's resume, cover letter, prep context or a
// posting is ever read or sent by any request this mode makes (see
// lib/copilot/roleDrillAnswer.js's roleAnswerContext, which hard-pins those
// fields to their "absent" values, and lib/copilot/roleDrillClient.js's own
// doc for the situation/model-answer requests).
//
// A fixed id, not a generated one: exactly one RoleDrillClient is ever
// mounted at a time (CopilotClient's mode ternary renders it INSTEAD of the
// other modes, never alongside them), so there is no collision risk to
// guard against, and a static id keeps the disclosure wiring below trivial
// to read.
const REVEAL_PANEL_ID = "speak-as-reveal-panel";

export default function RoleDrillClient({ sttProviderName, micDeviceId, onMicDeviceChange } = {}) {
  const { role, setRole } = useRoleChoice();
  const {
    situation,
    situationStatus,
    situationError,
    situationLoading,
    exhausted,
    requestNewSituation,
    retrySituation,
    reveal,
    toggleReveal,
    retryReveal,
  } = useRoleDrill(role);

  const label = roleLabel(role);

  const roleAnswer = useRoleAnswer({
    situation,
    roleLabel: label,
    micDeviceId,
    sttProviderName,
    situationLoading,
    situationStatus,
  });

  // AC-R1.8: a role change abandons whatever answer is in progress - Stop
  // and leaving the mode already do their half inside
  // usePracticeCaptureSession/usePracticeAnswer themselves (see
  // useRoleAnswer.js's own onAbandon doc), so this is the ONE place a role
  // change fires from, rather than a second, competing effect watching
  // `role` for changes. Uses the UNARMED onAbandon, not
  // onNewSituationRequested below - switching roles has no business starting
  // a recording by itself the moment the new role's situation lands.
  const onRoleChange = useCallback(
    (nextRole) => {
      roleAnswer.onAbandon();
      setRole(nextRole);
    },
    [roleAnswer.onAbandon, setRole], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Wave 3, BLOCKER 1/2: the ONE handler behind both "New situation"
  // buttons - the situation card's own, and the feedback panel's (passed to
  // RoleAnswerPanel below). onNewSituationRequested (not onAbandon) is what
  // ARMS auto-start, so the fresh-situation loop costs one press instead of
  // two - see that function's own doc in useRoleAnswer.js.
  const onNewSituation = useCallback(() => {
    roleAnswer.onNewSituationRequested();
    requestNewSituation();
  }, [roleAnswer.onNewSituationRequested, requestNewSituation]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack spacing={2}>
      <RolePicker role={role} onChange={onRoleChange} />

      {situationStatus === "error" ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retrySituation} disabled={situationLoading}>
              Retry
            </Button>
          }
        >
          {situationError || "Could not load a situation."}
        </Alert>
      ) : (
        <SituationCard
          roleLabel={label}
          situation={situation}
          exhausted={exhausted}
          revealVisible={reveal.visible}
          revealPanelId={REVEAL_PANEL_ID}
          onToggleReveal={toggleReveal}
          situationLoading={situationLoading}
          onNewSituation={onNewSituation}
        />
      )}

      {/* AC-Q9.6 follow-up (adversarial review): the reveal button reports
          `aria-expanded` and names the panel it opens via `aria-controls` -
          `id` lives on this wrapper (not inside ModelResponse) so it covers
          every reveal state - loading, error, done - the button can report
          itself expanded for, not only the "done" shape.
          ROUGH EDGE (separate adversarial review): this block used to sit
          at the BOTTOM of the whole Stack, after the recording controls,
          the camera/transcript row and the review/feedback panel - so a
          revealed model answer's own `<h4>` sections read as subsections of
          the AI feedback on the user's own answer, not as what they
          actually are: a disclosure that belongs to the situation card
          above, next to the toggle that opens it. Moved directly after the
          situation card. This does not change which `role="status"` region
          is first in the document (ModelResponse renders none of its own),
          so the AC-Q9.7 contract just below still holds. */}
      {reveal.visible ? (
        <Box id={REVEAL_PANEL_ID}>
          <ModelResponse status={reveal.status} error={reveal.error} payload={reveal.payload} onRetry={retryReveal} />
        </Box>
      ) : null}

      {/* AC-Q9.7 - mounted unconditionally, from the very first render, so
          only its TEXT ever changes from here on. A region that first
          appears already carrying its final content (e.g. nested inside the
          `reveal.visible` block below) is not reliably announced by
          NVDA/JAWS - see lib/copilot/answerStatus.js's own long comment,
          which is about exactly this failure. Speaks for the REVEAL only:
          a situation loading is not an answer, so this stays silent through
          every bit of the situation machinery above. Kept in this exact
          spot (ahead of the recording controls below, which mount their OWN
          status region for the recording state - RoleDrillControls.js) so
          it stays the first `role="status"` region in the document, matching
          the one RoleDrillClient.contract.test.js already pins. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {answerStatusMessage({ status: reveal.status, bulletCount: reveal.payload?.lines?.length })}
      </Box>

      <RoleDrillControls
        privacyNotice={roleAnswer.privacyNotice}
        micDeviceId={micDeviceId}
        onMicDeviceChange={onMicDeviceChange}
        status={roleAnswer.status}
        running={roleAnswer.running}
        startedAt={roleAnswer.startedAt}
        elapsed={roleAnswer.elapsed}
        answering={roleAnswer.answering}
        settling={roleAnswer.settling}
        primaryDisabled={roleAnswer.primaryDisabled}
        focusPrimarySignal={roleAnswer.focusPrimarySignal}
        onStartSpeaking={roleAnswer.onStartSpeaking}
        onDoneAnswer={roleAnswer.onDoneAnswer}
        onStop={roleAnswer.stop}
        recordingStatusText={roleAnswer.recordingStatusText}
        cameraOff={roleAnswer.cameraOff}
        hasVideo={roleAnswer.hasVideo}
        onToggleCamera={roleAnswer.onToggleCamera}
        micMuted={roleAnswer.micMuted}
        onToggleMic={roleAnswer.onToggleMic}
        sendFrames={roleAnswer.sendFrames}
        isEmbedded={roleAnswer.isEmbedded}
        onSendFramesChange={roleAnswer.onSendFramesChange}
        saveEnabled={roleAnswer.saveEnabled}
        onToggleSaveEnabled={roleAnswer.onToggleSaveEnabled}
      />

      {roleAnswer.warning ? (
        <Alert severity="warning" onClose={() => roleAnswer.setWarning("")}>
          {roleAnswer.warning}
        </Alert>
      ) : null}
      {roleAnswer.error ? <Alert severity="error">{roleAnswer.error}</Alert> : null}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "stretch" }}>
        <CameraPreview stream={roleAnswer.stream} hasVideo={roleAnswer.hasVideo} cameraOff={roleAnswer.cameraOff} />
        <TranscriptView
          finals={roleAnswer.finals}
          interims={{ them: "", you: roleAnswer.interim }}
          startedAt={roleAnswer.startedAt}
        />
      </Stack>

      {!roleAnswer.answering && !roleAnswer.settling && roleAnswer.answerMetrics ? (
        <RoleAnswerPanel
          answerTranscript={roleAnswer.answerTranscript}
          answerMetrics={roleAnswer.answerMetrics}
          replayUrl={roleAnswer.replayUrl}
          replaySupported={roleAnswer.replaySupported}
          saveStatus={roleAnswer.saveStatus}
          saveError={roleAnswer.saveError}
          critiqueStatus={roleAnswer.critiqueStatus}
          critique={roleAnswer.critique}
          critiqueError={roleAnswer.critiqueError}
          critiqueFramesSent={roleAnswer.critiqueFramesSent}
          onRetryCritique={roleAnswer.onRetryCritique}
          onNewSituation={onNewSituation}
          onTryAgain={roleAnswer.onTryAgain}
        />
      ) : null}
    </Stack>
  );
}
