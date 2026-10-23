# N178 authored brief independent check — round 1

Checker: /root/modal_ux_checker, fresh context; no authorship of reviewed artifact. Reviewed .agnostic-loop/preview-modal-ux/brief-r1.md SHA256 5ED1AF20707F075BD6CDC39C04C32F85CED22267B74D3A82494409B5BACDDEFD. Source inspected: DocumentPreviewDialog.js, TemplateControlsRow.js, EditorToolbar.js, VersionControl.js, existing preview copy/spacing/scope/template test contracts, root AGENTS and dev-loop guides. Source working tree observed clean. No tests, browser, network or provider calls performed by this checker.

Verdict: REVISE, one blocking criterion defect. Architecture, exclusions, three product paths plus new workspace test, preservation obligations, and independent/live verification plan are otherwise acceptable for the bounded UX request.

## Findings

P1 — NEW class BASELINE-GEOMETRY-ORACLE. N178-2 requires 40% canvas at 1440x900 and 390x844, but at the coordinator-observed failing desktop viewport 1280x720 requires only expanded-tools reachability. Coordinator reports baseline there: DialogContent 34px, paper scrollHeight 698 > clientHeight 656, footer bottom 729.5 outside viewport720 and paper bottom688. The proposal could satisfy its larger-screen criterion while leaving the owner's actual desktop failure substantially unchanged. Add a collapsed-tools measurement at 1280x720 requiring >=300px of initially visible document canvas, and require every delivery/footer control to be visible or reachable through intentional scrolling without clipping. Measure visible document intersection, not DialogContent height including moved filename/bands/tools. Retain the mobile and expanded-tool criteria. Bind the baseline and measurement method in the revised brief. Receiver: brief author; stopping point: design/criterion revision then one independent delta check.

## Implementation and measurement cautions (nonblocking existing obligations)

- Copy suite previewSurface() selects the first direct DialogContent child without data-testid and without contenteditable=true. Moving tools, filename or references before the paper can make it select unrelated chrome. Preserve that real contract through suitable wrapper identification/ordering; do not weaken assertions. CopyDocumentControl itself must remain a direct DialogActions child and existing census and first live-region order must survive.
- Collapsed mounted content must actually be hidden and untabbable. Disclosure is click-only and cannot cause scan/research/template actions. Reopening must collapse again. Expanded tools must be inside the scrollable workspace, rather than fixed chrome.
- Geometry remains unproven until browser measurement, including footer feedback, long title, four scopes, mobile wrapping and short desktop height. Preserve original page typography; measure the visible paper region rather than a tall scroll container containing little visible document.
- Stable editor node/ref/selection ownership and draft flush on scope/version/mode/close remain mandatory; source review alone cannot establish selection or save/reopen persistence. Pending browser/live evidence and independent test design are correctly explicit.

No second substantive review round has occurred. No candidate, gate, live behavior or delivery is accepted by this brief check.
