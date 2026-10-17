# Live-app verification policy delivery

Owner request: always incorporate live verification in the live application into
the agnostic development loop. Bounded documentation-only implementation; no
application, engine, gate configuration, provider grant or deployment changes.

The authoritative requirement is in AGENTS.md, referenced by WORKFLOW.md,
USAGE.md and repository.md. Intake must plan the live flow; completion requires
actual live observations, deployed-candidate binding for changed behavior,
sanitized evidence and independent checking. Access/deployment/authority blockers
remain pending. Source publication and live verification are separate statuses.
Existing commands are explicitly described as not enforcing this host obligation.

Independent policy review: check.md records current four-file identities and an
ACCEPT verdict. `git diff --check` passed. Full application/engine suites and
mutation tests were not rerun because no executable bytes changed; they cannot
establish whether a written policy accurately transcribes the owner's request.

Live smoke observation: 2026-10-17, approximately 16:29 UTC, through root's actual
CUA browser control at https://resume-tailor-tan-psi.vercel.app/. A fresh background
tab displayed Resume Tailor, Auto Applying selected, and Feed/Queue/Automation/
Setup chat navigation. Clicking Setup chat displayed “Set up your search,
together.”, the search-conversation composer, disabled empty Send message button,
and the empty Your proposal panel. Expected navigation and empty-state controls
were observed. The page also displayed “10 src errors”; this is an observed
ingest-status limitation, not a successful feed-health assertion.

Evidence: actual browser tool observations in this chat (tab 6 initial AX tree and
post-click AX diff). No form submitted, saved search created, model invoked or
test data retained. Deployed revision identity unknown. This is only a smoke
check for this documentation change; it does not validate the policy through
runtime execution or establish live verification of N174 saving/name behavior.
That prior local-only evidence remains historical with live behavior unproven.

Final source publication requires normal main commit/push and successful live
`npm.cmd run loop:delivery`; its ignored receipt will bind the final commit.
