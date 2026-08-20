"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { answerStatusMessage, visuallyHidden } from "@/lib/copilot/answerStatus";
import { roleLabel } from "@/lib/copilot/roleRegisters";
import ModelResponse from "./ModelResponse";
import RolePicker from "./RolePicker";
import SituationCard from "./SituationCard";
import { useRoleChoice } from "./useRoleChoice";
import { useRoleDrill } from "./useRoleDrill";

// AC-Q0/AC-Q9 - the "Speak as" mode's own screen: a role picker, a
// situation to answer out loud, and an on-demand model answer that
// demonstrates the role's register. Owns layout only - the persisted role
// choice lives in useRoleChoice.js, the situation/reveal state and every
// network call live in useRoleDrill.js. Mounted by app/copilot/CopilotClient
// (wave 3) only while its own toggle is selected, which is what satisfies
// AC-Q0.2's "no fetch on page load while another mode is selected": this
// component simply doesn't exist in the tree until then.
//
// Nothing here records audio, touches the camera, or reads the STT stack -
// this drill is about how a role SOUNDS, not about interview practice, and
// nothing about the user's resume, cover letter, prep context or a posting
// is ever read or sent (see lib/copilot/roleDrillClient.js's own doc for
// what the two requests below carry, in full).
//
// A fixed id, not a generated one: exactly one RoleDrillClient is ever
// mounted at a time (CopilotClient's mode ternary renders it INSTEAD of the
// other modes, never alongside them), so there is no collision risk to
// guard against, and a static id keeps the disclosure wiring below trivial
// to read.
const REVEAL_PANEL_ID = "speak-as-reveal-panel";

export default function RoleDrillClient() {
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

  return (
    <Stack spacing={2}>
      <RolePicker role={role} onChange={setRole} />

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
          onNewSituation={requestNewSituation}
        />
      )}

      {/* AC-Q9.7 - mounted unconditionally, from the very first render, so
          only its TEXT ever changes from here on. A region that first
          appears already carrying its final content (e.g. nested inside the
          `reveal.visible` block below) is not reliably announced by
          NVDA/JAWS - see lib/copilot/answerStatus.js's own long comment,
          which is about exactly this failure. Speaks for the REVEAL only:
          a situation loading is not an answer, so this stays silent through
          every bit of the situation machinery above. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {answerStatusMessage({ status: reveal.status, bulletCount: reveal.payload?.lines?.length })}
      </Box>

      {/* AC-Q9.6 follow-up (adversarial review): the reveal button reported
          `aria-expanded` but named no panel at all - it pointed at nothing,
          and the panel it opens had no id to be pointed at. `id` lives on
          this wrapper (not inside ModelResponse) so it covers every reveal
          state - loading, error, done - the button can report itself
          expanded for, not only the "done" shape. */}
      {reveal.visible ? (
        <Box id={REVEAL_PANEL_ID}>
          <ModelResponse status={reveal.status} error={reveal.error} payload={reveal.payload} onRetry={retryReveal} />
        </Box>
      ) : null}
    </Stack>
  );
}
