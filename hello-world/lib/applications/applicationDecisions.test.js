import { describe, it, expect } from "vitest";

import {
  selectAppliedToggleAction,
  buildEditApplicationPayload,
  buildStatusChangeConfirmation,
} from "@/lib/applications/applicationDecisions.js";
import {
  APPLICATION_STATUSES,
  APPLIED_OR_LATER_STATUSES,
  PRE_APPLY_STATUSES,
} from "@/lib/applications/statusVocabulary.js";

// ---------------------------------------------------------------------------
// The three PURE decisions extracted out of `app/page.js` and
// `app/hooks/useApplicationDialogs.js` (AC-11). They are extracted so their
// tests do not have to mount a 3200-line client component to reach them —
// every over-refusal risk in this chunk lives in that region, and a criterion
// observed only by a transcription is not observed.
//
// Two things this file deliberately does NOT do:
//
//   - It does not assert `"unapply"` is absent by checking for its absence.
//     An assertion of absence is satisfied by a dead feature. The toggle table
//     below is a whole-object `toEqual` over all eleven statuses plus the two
//     off-vocabulary cases, so a fourth return value fails as a wrong value
//     rather than as a missing negative.
//   - It does not test `applied_at` with truthiness. Every date assertion is
//     an identity against a literal, because the defect this chunk exists to
//     stop writes a fresh, non-null, WRONG timestamp — and every truthiness
//     assertion passes against it. Same rule as
//     `test/repro/appliedStatusDataLoss.test.js`'s header.
// ---------------------------------------------------------------------------

const JOB_ID = "gh-1";
const APPLIED_AT = "2026-07-04T15:32:11.000Z";

function mapWith(status, extra = {}) {
  return new Map([[JOB_ID, { status, appliedAt: null, applicationId: "app-1", ...extra }]]);
}

describe("applicationDecisions — selectAppliedToggleAction", () => {
  it("classifies every status in the vocabulary, plus absent and unknown, as one table", () => {
    // A whole-table `toEqual`. A status that quietly changes class later fails
    // here, and so does a fourth return value.
    const table = Object.fromEntries(
      APPLICATION_STATUSES.map((s) => [s, selectAppliedToggleAction(mapWith(s), JOB_ID)]),
    );
    expect(table).toEqual({
      // Pre-apply: the machine door may still promote these.
      tracking: "apply",
      tailored: "apply",
      auto_tailored: "apply",
      auto_queued: "apply",
      // Applied-or-later: no write. Surface the row's real status and send the
      // user to the Tracking tab, where the Edit dialog and the delete live.
      applied: "open-tracking",
      phone_screen: "open-tracking",
      interviewing: "open-tracking",
      offer: "open-tracking",
      accepted: "open-tracking",
      rejected: "open-tracking",
      withdrawn: "open-tracking",
    });
  });

  it("returns 'apply' when the map has loaded and holds no row for the job", () => {
    expect(selectAppliedToggleAction(new Map(), JOB_ID)).toBe("apply");
    expect(selectAppliedToggleAction(mapWith("offer"), "gh-somebody-else")).toBe("apply");
  });

  it("returns 'refuse-unknown' when the row carries a status outside the eleven", () => {
    // The UI-side complement of the writer's fail-closed allow-list. A twelfth
    // status added to the live CHECK by a future integration must not produce
    // a confident click in either layer.
    expect(selectAppliedToggleAction(mapWith("screening"), JOB_ID)).toBe("refuse-unknown");
    expect(selectAppliedToggleAction(mapWith(null), JOB_ID)).toBe("refuse-unknown");
    expect(selectAppliedToggleAction(mapWith(""), JOB_ID)).toBe("refuse-unknown");
  });

  it("returns 'refuse-unknown' when the map has not loaded", () => {
    // Distinct from "loaded, and this job is not in it" above, which is
    // "apply". Collapsing the two is how a click during load writes a row the
    // user never asked for.
    expect(selectAppliedToggleAction(null, JOB_ID)).toBe("refuse-unknown");
    expect(selectAppliedToggleAction(undefined, JOB_ID)).toBe("refuse-unknown");
  });

  it("classifies by STATUS, not by the date that put the row in the map", () => {
    // `loadAppliedOrLaterExternalIds` unions two queries: status ∈ the seven,
    // OR `applied_at IS NOT NULL`. So a D1 victim — status `tracking`, real
    // date still attached — is IN the map. Its badge reads applied (that is
    // the widening's deliberate, visible consequence), but the toggle's branch
    // is chosen from the status, so the row stays promotable. Promoting it
    // cannot fabricate a date: the stamp's `applied_at IS NULL` guard finds a
    // value and leaves it alone.
    expect(selectAppliedToggleAction(mapWith("tracking", { appliedAt: APPLIED_AT }), JOB_ID)).toBe(
      "apply",
    );
    expect(selectAppliedToggleAction(mapWith("offer", { appliedAt: null }), JOB_ID)).toBe(
      "open-tracking",
    );
  });

  it("agrees with the vocabulary's partition for every status", () => {
    const disagreements = APPLICATION_STATUSES.filter((s) => {
      const action = selectAppliedToggleAction(mapWith(s), JOB_ID);
      if (PRE_APPLY_STATUSES.includes(s)) return action !== "apply";
      if (APPLIED_OR_LATER_STATUSES.includes(s)) return action !== "open-tracking";
      return true;
    });
    expect(disagreements).toEqual([]);
  });
});

describe("applicationDecisions — buildEditApplicationPayload", () => {
  // Today's inline literal at `useApplicationDialogs.js:345-349` names
  // `applied_at` on EVERY save, round-tripped through
  // `new Date(form.appliedAt).toISOString()`. So saving after editing only
  // the URL rewrites the column — and because the round trip is UTC-based
  // while TrackingTab renders in local time, the DISPLAYED date can move by a
  // day on a save that touched nothing but a URL. AC-8b's fix is narrow and
  // exact: when the date field is unchanged, the column is not named at all.
  const form = (over = {}) => ({
    status: "applied",
    appliedAt: "2026-07-04",
    applicationUrl: "https://acme.example/careers/1",
    ...over,
  });

  it("omits applied_at entirely when the date field is unchanged", () => {
    const { payload } = buildEditApplicationPayload({
      form: form(),
      storedAppliedAt: APPLIED_AT,
    });
    // The key set, sorted — an extra column silently added later fails here.
    expect(Object.keys(payload).sort()).toEqual(["application_url", "status"]);
    expect("applied_at" in payload).toBe(false);
  });

  it("reports nothing destroyed when the date is unchanged, so no confirm is owed", () => {
    const out = buildEditApplicationPayload({ form: form(), storedAppliedAt: APPLIED_AT });
    expect(out.destroysDate).toBe(false);
    expect(out.clearsAppliedAt).toBe(false);
  });

  it("names applied_at with the new value when the date field changed", () => {
    const { payload } = buildEditApplicationPayload({
      form: form({ appliedAt: "2026-07-05" }),
      storedAppliedAt: APPLIED_AT,
    });
    expect(Object.keys(payload).sort()).toEqual(["application_url", "applied_at", "status"]);
    // Identity against the literal, never `expect.any(String)`.
    expect(payload.applied_at).toBe("2026-07-05T00:00:00.000Z");
  });

  it("reports destroysDate when a real stored date is being overwritten", () => {
    const out = buildEditApplicationPayload({
      form: form({ appliedAt: "2026-07-05" }),
      storedAppliedAt: APPLIED_AT,
    });
    expect(out.destroysDate).toBe(true);
    expect(out.clearsAppliedAt).toBe(false);
  });

  it("clears the column, and says so, when the user empties the date field", () => {
    const out = buildEditApplicationPayload({
      form: form({ appliedAt: "" }),
      storedAppliedAt: APPLIED_AT,
    });
    expect(Object.keys(out.payload).sort()).toEqual(["application_url", "applied_at", "status"]);
    expect(out.payload.applied_at).toBeNull();
    expect(out.clearsAppliedAt).toBe(true);
    expect(out.destroysDate).toBe(true);
  });

  it("does not name applied_at when there was no stored date and none was typed", () => {
    // The most common row in the table. A builder that names the column here
    // would make the door's compare-and-set run on every save of a dateless
    // row, which is where `.eq(col, null)` refuses everything.
    const out = buildEditApplicationPayload({
      form: form({ appliedAt: "" }),
      storedAppliedAt: null,
    });
    expect(Object.keys(out.payload).sort()).toEqual(["application_url", "status"]);
    expect(out.clearsAppliedAt).toBe(false);
    expect(out.destroysDate).toBe(false);
  });

  it("names applied_at, but destroys nothing, when a date is added to a dateless row", () => {
    const out = buildEditApplicationPayload({
      form: form({ appliedAt: "2026-09-01" }),
      storedAppliedAt: null,
    });
    expect(Object.keys(out.payload).sort()).toEqual(["application_url", "applied_at", "status"]);
    expect(out.payload.applied_at).toBe("2026-09-01T00:00:00.000Z");
    // Nothing non-NULL is lost, so this is not the destructive case and must
    // not cost the user a confirmation.
    expect(out.destroysDate).toBe(false);
    expect(out.clearsAppliedAt).toBe(false);
  });

  it("compares against the SAME UTC derivation the dialog populated the field with", () => {
    // `openEditApplicationDialog` fills the field with
    // `new Date(app.applied_at).toISOString().slice(0,10)`. A stored value
    // late enough in the UTC day that a local-time derivation would name a
    // different date must still count as UNCHANGED, or every save of such a
    // row rewrites the column — the exact defect AC-8b closes.
    const lateInTheUtcDay = "2026-07-04T23:59:59.000Z";
    const out = buildEditApplicationPayload({
      form: form({ appliedAt: "2026-07-04" }),
      storedAppliedAt: lateInTheUtcDay,
    });
    expect("applied_at" in out.payload).toBe(false);
    expect(out.destroysDate).toBe(false);
  });

  it("carries the status and the trimmed URL through, exactly as today", () => {
    const { payload } = buildEditApplicationPayload({
      form: form({ status: "offer", applicationUrl: "  https://acme.example/x  " }),
      storedAppliedAt: APPLIED_AT,
    });
    expect(payload.status).toBe("offer");
    expect(payload.application_url).toBe("https://acme.example/x");
  });

  it("writes a null URL for a blank field, exactly as today", () => {
    const { payload } = buildEditApplicationPayload({
      form: form({ applicationUrl: "   " }),
      storedAppliedAt: APPLIED_AT,
    });
    expect(payload.application_url).toBeNull();
  });

  it("[control] destroysDate is true only when a non-NULL date actually moves", () => {
    // The four-cell truth table, as one object. `confirm` is owed iff this
    // cell is true, so a builder that is over-eager here manufactures a
    // confirmation on an ordinary save, and one that is under-eager destroys a
    // date silently. Both directions fail this assertion.
    const cell = (appliedAt, storedAppliedAt) =>
      buildEditApplicationPayload({ form: form({ appliedAt }), storedAppliedAt }).destroysDate;
    expect({
      unchangedWithDate: cell("2026-07-04", APPLIED_AT),
      changedWithDate: cell("2026-07-05", APPLIED_AT),
      clearedWithDate: cell("", APPLIED_AT),
      addedWithoutDate: cell("2026-09-01", null),
      unchangedWithoutDate: cell("", null),
    }).toEqual({
      unchangedWithDate: false,
      changedWithDate: true,
      clearedWithDate: true,
      addedWithoutDate: false,
      unchangedWithoutDate: false,
    });
  });
});

describe("applicationDecisions — buildStatusChangeConfirmation", () => {
  // AC-2a: no path that clears or overwrites a non-NULL `applied_at` is
  // reachable without an explicit confirmation THAT NAMES THE DATE being
  // destroyed. A generic "are you sure?" satisfies the gesture and none of the
  // criterion — the date is the thing that cannot be recovered, so the date is
  // the thing the sentence has to contain.
  const LOCALE = "en-US";
  const shown = (iso) =>
    new Date(iso).toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "numeric" });

  const args = (over = {}) => ({
    company: "Acme",
    role: "Senior Platform Engineer",
    appliedAtIso: APPLIED_AT,
    locale: LOCALE,
    ...over,
  });

  it("returns a non-empty string", () => {
    const msg = buildStatusChangeConfirmation(args());
    expect(typeof msg).toBe("string");
    expect(msg.trim().length).toBeGreaterThan(0);
  });

  it("names the date in the same format the pipeline already showed the user", () => {
    // `TrackingTab.js:282` / `:609-610` render exactly this call, so the date
    // named in the confirmation is the string already on screen.
    const msg = buildStatusChangeConfirmation(args());
    expect(msg).toContain(shown(APPLIED_AT));
  });

  it("names the company and the role", () => {
    const msg = buildStatusChangeConfirmation(args());
    expect(msg).toContain("Acme");
    expect(msg).toContain("Senior Platform Engineer");
  });

  it("says the loss is irreversible", () => {
    const msg = buildStatusChangeConfirmation(args());
    expect(msg).toMatch(/can(?:'|no)?t be (?:recovered|undone)/i);
  });

  it("asks a question rather than announcing a fact", () => {
    expect(buildStatusChangeConfirmation(args())).toContain("?");
  });

  it("does not leak the raw ISO timestamp into the dialog", () => {
    const msg = buildStatusChangeConfirmation(args());
    // Gate the negative on the operand being a real string first: a negative
    // containment check against `undefined` asserts nothing at all.
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain(APPLIED_AT);
    expect(msg).not.toContain("T15:32:11");
    // Positive control for the same matcher, proving `not.toContain` above is
    // running against a string that CAN contain things.
    expect(msg).toContain(shown(APPLIED_AT));
  });

  it("falls back for a missing company, and drops the dash for a missing role", () => {
    // `useApplicationDialogs.js:507`'s established shape for an application-
    // shaped label. Without both guards the copy renders
    // " — Senior Platform Engineer" or "Acme — undefined".
    const noCompany = buildStatusChangeConfirmation(args({ company: "" }));
    expect(noCompany).toContain("this application");
    expect(noCompany).not.toContain("undefined");

    const noRole = buildStatusChangeConfirmation(args({ role: "" }));
    expect(noRole).toContain("Acme");
    expect(noRole).not.toContain("undefined");
    // The separator is only emitted when there is a role to separate.
    expect(noRole).not.toContain("Acme —");
    // Positive control on the same matcher: with a role, the separator IS there.
    expect(buildStatusChangeConfirmation(args())).toContain("Acme — Senior Platform Engineer");
  });

  it("names a different date when a different date is being destroyed", () => {
    // The control that stops a hard-coded sentence passing every assertion
    // above.
    const other = "2026-01-02T09:00:00.000Z";
    const msg = buildStatusChangeConfirmation(args({ appliedAtIso: other }));
    expect(msg).toContain(shown(other));
    expect(msg).not.toContain(shown(APPLIED_AT));
  });
});
