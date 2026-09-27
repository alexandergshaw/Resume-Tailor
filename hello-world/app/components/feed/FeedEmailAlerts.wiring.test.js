// N60 follow-up. Commits 36db0b8 and d27ff4c removed the per-search
// notify_email recipient override server-side (owner ruling: alerts go to
// the account email only). The UI was left behind: FeedEmailAlerts.js still
// rendered a text field the user could type into, wired to
// `setSavedSearchAutoTailor(entry.id, { notifyEmail })` -- a control that
// looked functional and was silently ignored, because the sanitizer that
// used to read `notifyEmail` was deleted in the same commits that left this
// input standing.
//
// RE-POINTED (N60 S8). FeedEmailAlerts.js is gone -- its markup (the
// email-alerts toggle, moved out of the Filters sheet per AC-F2/F3) now
// lives in FeedAutomationCard.js, beside the auto-tailor enable control this
// step adds. The three properties this file polices are about that markup,
// not about which file it lives in, so they are re-pointed at the new file
// rather than dropped.
//
// WHY STRUCTURAL, NOT A LITERAL GREP. A test that just asserts
// `!source.includes("notifyEmail")` passes the moment someone reintroduces
// the same control under a different prop name (`recipientEmail`,
// `alertTo`, ...) -- exactly the kind of rename this repo's own traps note
// warns about. This instead asks a structural question: does the card
// render ANY editable text-entry control at all? It should not -- every
// email affordance in this card is a toggle plus static text, nothing the
// user types into. That property survives a rename of the removed field.
//
// CANARIED. The detector below is exercised against a synthetic snippet
// that DOES contain an editable control first, so a typo or a dead regex
// that always returns "nothing found" cannot make the real assertion pass
// vacuously -- the canary would fail first.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./FeedAutomationCard.js", import.meta.url),
  "utf8",
);

// Every MUI (and native) tag that renders something a user can type into.
// Structural on purpose: it does not name the removed prop, so a rename of
// the old `notifyEmail` field does not slip past it.
const EDITABLE_TEXT_ENTRY_TAGS = [
  "TextField",
  "OutlinedInput",
  "FilledInput",
  "InputBase",
  "Input",
  "Autocomplete",
  "Select",
  "input",
  "textarea",
  "select",
];

function findEditableControls(src) {
  const found = [];
  for (const tag of EDITABLE_TEXT_ENTRY_TAGS) {
    if (new RegExp(`<${tag}\\b`).test(src)) found.push(tag);
  }
  return found;
}

describe("class guard: FeedAutomationCard never re-grows an editable recipient control", () => {
  it("canary: the detector actually finds an editable control when one is present", () => {
    // Proves findEditableControls is a real detector, not a regex that
    // always comes back empty. If this fails, the "none found" assertion
    // below would be meaningless.
    const withReintroducedField = `
      <TextField
        value={entry.notifyEmail ?? ""}
        onChange={(e) => setSavedSearchAutoTailor(entry.id, { notifyEmail: e.target.value })}
      />
    `;
    expect(findEditableControls(withReintroducedField)).toEqual(
      expect.arrayContaining(["TextField"]),
    );
  });

  it("canary: an unrelated renamed prop is still caught by the structural check", () => {
    // Guards specifically against the rename evasion this test is written
    // to close: renaming `notifyEmail` to something else does not help,
    // because detection never looks at the prop name.
    const renamedField = `
      <TextField
        value={entry.alertRecipient ?? ""}
        onChange={(e) => setSavedSearchAutoTailor(entry.id, { alertRecipient: e.target.value })}
      />
    `;
    expect(findEditableControls(renamedField)).toEqual(
      expect.arrayContaining(["TextField"]),
    );
  });

  it("the shipped automation card renders no editable text-entry control at all", () => {
    expect(findEditableControls(source)).toEqual([]);
  });

  it("still renders the emailOnNewJobs toggle (sanity check the file was read)", () => {
    expect(source).toMatch(/<Switch\b/);
    expect(source).toMatch(/emailOnNewJobs/);
  });

  it("tells the user where alerts go now that the recipient field is gone", () => {
    expect(source).toMatch(/account email/i);
  });

  it("never rebuilds the old notifyEmail/notify_email plumbing under its old name either", () => {
    expect(source).not.toMatch(/notifyEmail/);
    expect(source).not.toMatch(/notify_email/);
  });
});
