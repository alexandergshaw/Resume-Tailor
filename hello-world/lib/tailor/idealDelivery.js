// N105 Step 6 - the pure delivery rules for an Ideal result, plus the
// Ideal-level gate. No I/O, no storage, no environment.
//
// An Ideal run produces two documents and a review that exists only in the
// preview. So an Ideal result is never saved to disk on the user's behalf and
// never displaces what they are looking at: this helper decides whether the
// preview should open, and nothing here ever starts a file save. The
// never-auto-save barrier is structural: this module has no save call to
// misuse.

// The Ideal-level gate (K14). Slice 1 built the whole Ideal path dark; going live
// (N107) is an owner decision, not something a later step flips on its own, and
// it is this constant that records that decision. It is also the single
// kill-switch: setting it back to false hides the slider stop on the client AND
// makes the tailor route refuse an Ideal request (idealUnavailableRefusal), so a
// crafted POST cannot reach the pipeline while the level is off. Every surface
// that exposes the stop (the slider, its caption, a batch dialog, a later
// auto-tailor path) asks this predicate rather than deciding for itself.
const IDEAL_LEVEL_ENABLED = true;

export function idealLevelEnabled() {
  return IDEAL_LEVEL_ENABLED;
}

// The server's answer to an Ideal request while the gate is off: a 422 carrying
// no artifact, in the same `{ error, refusal }` shape as the route's other Ideal
// refusals. It leads with the state and names the remedy, and it is returned
// before the resume is parsed or any model is called.
export function idealUnavailableRefusal() {
  return {
    status: 422,
    body: {
      error: "The Ideal level is not available right now. Pick another tailoring level.",
      refusal: { level: "ideal", code: "level-unavailable" },
    },
  };
}

// Whether a finished Ideal run should open the preview on its own.
//   isOpen  a preview is already open (read from a ref, not a stale closure)
//   opts    the run's options; `skipDownload` marks runs whose caller owns
//           delivery (batch tailor-only, screenshots, library re-tailor)
//
// A single user-initiated run with nothing open opens the preview (D2). A run
// that finishes while a preview is open does not replace it, since swapping the
// document under a user mid-review would lose their place (D3). A run that
// skips delivery neither opens nor saves anything (D4).
export function shouldAutoOpenIdealPreview({ isOpen, opts } = {}) {
  if (isOpen) return false;
  if (opts && opts.skipDownload) return false;
  return true;
}

// What the chip handler (app/page.js#handleTailorJob) does with a finished run:
// open the preview, save a file, both, or neither.
//   payload      the /api/tailor response; an Ideal run is the one carrying an
//                `ideal` block
//   previewOpen  a preview is already open (read from a ref, not a stale closure)
//   opts         the run's options; `skipDownload` marks runs whose caller owns
//                delivery
//
//   run        previewOpen  skipDownload   openPreview  autoDownload
//   standard   any          no             no           yes
//   standard   any          yes            no           no
//   Ideal      no           no             yes          no
//   Ideal      yes          no             no           no
//   Ideal      any          yes            no           no
//
// An Ideal result is never saved on the user's behalf, whatever the options say:
// its review exists only in the preview, so the preview opens (unless one is
// already open or the caller owns delivery) and nothing downloads.
export function resolveIdealChipDelivery({ payload, previewOpen, opts } = {}) {
  const ideal = payload ? payload.ideal : null;
  if (ideal === null || typeof ideal !== "object" || Array.isArray(ideal)) {
    return { openPreview: false, autoDownload: !(opts && opts.skipDownload) };
  }
  return { openPreview: shouldAutoOpenIdealPreview({ isOpen: previewOpen, opts }), autoDownload: false };
}

// The context finishByOpeningPreview takes to open the dialog on an Ideal chip
// run: the application-ready resume only (no cover letter), described from the
// job and the title the run produced rather than from state a long await left
// stale.
export function idealChipPreviewContext(job, generatedJobTitle) {
  return {
    jobId: job.id,
    jobTitle: generatedJobTitle || job.title,
    company: job.company,
    posting: job.description,
    url: job.url,
    applyResume: true,
    applyCover: false,
    coverLetterResultLines: [],
  };
}
