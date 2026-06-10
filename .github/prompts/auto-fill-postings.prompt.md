---
description: "Replace the rocket-ship auto-apply button with an 'Auto Fill' button on job cards that auto-fills the application form at the posting URL"
name: "Auto Fill posting forms"
argument-hint: "Implement the Auto Fill button on job cards"
agent: "agent"
---

Implement an "Auto Fill" feature on the job cards in the auto-applying tab.

## Context

- The job cards live in [LiveFeedTab.js](../../hello-world/app/components/LiveFeedTab.js). Each card renders a row of action `IconButton`s (tailor, auto-apply, hide).
- The current "rocket ship" button is the auto-apply `IconButton` that uses `RocketLaunchIcon` and `handleAutoApply` (around the tooltip "Auto-apply (tailor résumé + cover letter & queue)").
- Each card's posting object exposes the application/posting URL (`posting.url`).

## Requirements

1. **Remove the rocket ship button.**
   - Delete the `RocketLaunchIcon` `IconButton` and its wrapping `Tooltip`/`span` from the card actions.
   - Remove the now-unused `RocketLaunchIcon` import and the `handleAutoApply` handler if nothing else references them. Leave the auto-apply queue API/logic intact if it is still used elsewhere.

2. **Add an "Auto Fill" button to each job card** in the auto-applying tab.
   - Label the control **Auto Fill** (visible text label, not just an icon).
   - Place it where the rocket button used to be, matching the existing button styling/spacing.
   - Disable it when there is no `posting.url`, when the user is not signed in, or while the card is busy.

3. **Auto-fill behavior on click.**
   - When clicked, open/navigate to the posting URL on the card and automatically fill the forms/controls of the application at that posting.
   - Map the user's known profile/application data (name, email, phone, resume, cover letter, and any other available fields) to the matching form fields at the posting.
   - Handle the case where the posting page cannot be auto-filled gracefully (surface a clear error/notice to the user via the existing error UI).

## Notes

- Follow the existing patterns in the file (MUI components, `busyIds` state, `Tooltip`, error handling via `setError`).
- Do not introduce new features beyond the Auto Fill button and its behavior.
- Confirm there are no lint/build errors after the change.
