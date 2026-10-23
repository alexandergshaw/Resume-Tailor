# N177 — Resume formatting check and cleanup

Status: owner-request intake; implementation and verification pending.

Add a clearly labeled button in the existing resume preview/edit modal that checks the current resume for formatting deficiencies and lets the user clean them up there.

Proposed acceptance criteria:

- N177-1: The resume preview/edit modal exposes an accessible formatting-check button operating on the current document, including current edits. Show progress and a useful no-issues result.
- N177-2: Findings identify concrete formatting problems and their locations with an explanation. Discover the supported checks from the actual DOCX/rendering pipeline; assess inconsistent typography, spacing, indentation, bullets, headings, alignment and pagination without promising unsupported detection. Distinguish defects from subjective style choices.
- N177-3: Offer cleanup from the findings, show what changes, and preserve resume facts, wording and tailoring strength. Preserve existing edits; save corrections as a reversible version using existing document history. A cleanup must not silently rewrite the resume's content.
- N177-4: Preview, saved/reopened document and downloaded DOCX reflect the corrections. Document switching, edits during a check, cancellation and late results cannot apply corrections to the wrong document or version. Errors retain the original and allow retry.
- N177-5: Verify the affected flow in the deployed live app: check an intentionally inconsistent disposable resume, inspect findings, apply cleanup, undo/version recovery, save/reopen and download/render fidelity. Record candidate identity and independently checked evidence. Local assertions alone do not establish layout quality.

Advantage: diagnoses and repairs the actual editable/exportable resume in place, retaining version history instead of requiring manual inspection or copying content into another chat. Findings and explicit failure/no-issues states provide diagnostics.

Discovery found the existing modal at `hello-world/app/components/DocumentPreviewDialog.js`, which already supports basic formatting edits and previews the download's DOCX. This identifies a starting point, not an admitted write set or a proven check instrument. Reuse its existing editing, export and version contracts after inspecting callers. Independently check architecture, test oracles, UX/accessibility and document fidelity before implementation; assess privacy/cost if any model is proposed. No new paid calls, installation, authentication or deployment are authorized here.

Keep this separate from N176 interview preparation. The prior manual run is expired and its extension unanswered; intake does not renew that grant. No implementation, test pass, push or live verification is claimed.
