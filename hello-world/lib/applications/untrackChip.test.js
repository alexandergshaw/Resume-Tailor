// The chip dock's untrack, both halves: what happens to the ROW
// (`untrackChipApplication`) and what the user is TOLD (`presentUntrackOutcome`).
//
// The defect these cover: `app/page.js`'s old `handleUntrackJob` ended
// `if (refused) return;`, where `refused` was `!deleted` from
// `deleteUntrackedApplication` — a guard that refuses every row except a
// dateless `tracking` one. On a tailored or applied job the chip stayed put
// and nothing was reported, so "Remove" was a control that looked like it
// worked and did nothing.
//
// Every row assertion below reads the row back out of the stateful fake and
// compares `applied_at` for IDENTITY against a seeded value — never
// `toBeTruthy()` — for the same reason
// `test/repro/appliedStatusDataLoss.test.js` gives: a re-stamp writes a
// fresh, non-null, WRONG timestamp that every truthiness assertion accepts.

import { describe, it, expect } from "vitest";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";
import {
  untrackChipApplication,
  presentUntrackOutcome,
  isHiddenFromTracking,
} from "./untrackChip.js";
import {
  APPLICATION_STATUSES,
  APPLIED_OR_LATER_STATUSES,
  TRACKING_TAB_HIDDEN_STATUSES,
  STATUS_LABELS,
} from "./statusVocabulary.js";

const USER_ID = "user-1";
const POSITION_ID = "pos-1";
const EXTERNAL_ID = "gh-1";
const APPLIED_AT = "2026-07-04T15:32:11.000Z";

const JOB = { id: EXTERNAL_ID, title: "Senior Engineer", company: "Acme" };

function seed(status, appliedAt, opts = {}) {
  return makeStatefulSupabase(
    {
      applications:
        status === null
          ? []
          : [
              {
                id: "app-1",
                user_id: USER_ID,
                position_id: POSITION_ID,
                status,
                applied_at: appliedAt,
                notes: "recruiter said Thursday",
              },
            ],
      positions: [
        { id: POSITION_ID, external_id: EXTERNAL_ID, title: "Senior Engineer", company: "Acme" },
      ],
    },
    { user: { id: USER_ID }, ...opts },
  );
}

const run = (sb) => untrackChipApplication(sb, { userId: USER_ID, jobId: EXTERNAL_ID });
const appRow = (sb) => sb.row("applications", (r) => r.id === "app-1");

describe("untrackChipApplication — the row half", () => {
  it("deletes a dateless `tracking` row and says so", async () => {
    const sb = seed("tracking", null);
    expect(await run(sb)).toEqual({ deleted: true, kept: null, unknown: false });
    expect(appRow(sb)).toBeNull();
  });

  it("refuses an APPLIED row, leaves applied_at byte-identical, and hands the row back", async () => {
    const sb = seed("applied", APPLIED_AT);
    expect(await run(sb)).toEqual({
      deleted: false,
      kept: { status: "applied", appliedAt: APPLIED_AT },
      unknown: false,
    });
    const row = appRow(sb);
    expect(row).not.toBeNull();
    expect(row.status).toBe("applied");
    expect(row.applied_at).toBe(APPLIED_AT);
    expect(row.notes).toBe("recruiter said Thursday");
  });

  it("refuses EVERY applied-or-later status — the D2/D5 guard, swept", async () => {
    for (const status of APPLIED_OR_LATER_STATUSES) {
      const sb = seed(status, APPLIED_AT);
      const outcome = await run(sb);
      expect(outcome.deleted, `${status} must never be deleted by untrack`).toBe(false);
      expect(outcome.kept).toEqual({ status, appliedAt: APPLIED_AT });
      expect(appRow(sb)?.applied_at, `${status} lost its date`).toBe(APPLIED_AT);
    }
  });

  it("refuses a `tailored` row (pre-apply, but not deletable by untrack) and reports it", async () => {
    const sb = seed("tailored", null);
    expect(await run(sb)).toEqual({
      deleted: false,
      kept: { status: "tailored", appliedAt: null },
      unknown: false,
    });
    expect(appRow(sb)).not.toBeNull();
  });

  it("refuses a `tracking` row that still carries a date (the stranded D1 victim)", async () => {
    const sb = seed("tracking", APPLIED_AT);
    expect(await run(sb)).toEqual({
      deleted: false,
      kept: { status: "tracking", appliedAt: APPLIED_AT },
      unknown: false,
    });
    expect(appRow(sb)?.applied_at).toBe(APPLIED_AT);
  });

  it("reports nothing kept when there is no application row at all", async () => {
    const sb = seed(null, null);
    expect(await run(sb)).toEqual({ deleted: false, kept: null, unknown: false });
  });

  it("issues no statement against `applications` at all when the position is unknown", async () => {
    const sb = makeStatefulSupabase({ applications: [], positions: [] }, { user: { id: USER_ID } });
    expect(await run(sb)).toEqual({ deleted: false, kept: null, unknown: false });
    expect(sb.calls.filter((c) => c.table === "applications")).toEqual([]);
  });

  it("reports `unknown` — never a guess — when the read-back errors", async () => {
    const sb = seed("applied", APPLIED_AT, { errors: { applications: { select: { message: "boom" } } } });
    expect(await run(sb)).toEqual({ deleted: false, kept: null, unknown: true });
    // The refusal still held: the row is untouched.
    expect(appRow(sb)?.applied_at).toBe(APPLIED_AT);
  });

  it("returns the inert outcome, and queries nothing, without a user or a job id", async () => {
    const sb = seed("applied", APPLIED_AT);
    expect(await untrackChipApplication(sb, { userId: "", jobId: EXTERNAL_ID })).toEqual({
      deleted: false,
      kept: null,
      unknown: false,
    });
    expect(await untrackChipApplication(sb, { userId: USER_ID, jobId: "" })).toEqual({
      deleted: false,
      kept: null,
      unknown: false,
    });
    expect(sb.calls).toEqual([]);
  });

  it("the delete it issues is `deleteUntrackedApplication`'s statement, both filters intact", async () => {
    const sb = seed("applied", APPLIED_AT);
    await run(sb);
    const del = sb.calls.find((c) => c.table === "applications" && c.verb === "delete");
    expect(del).toBeTruthy();
    // Widening either of these two is the D2/D5 regression.
    expect(del.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: "status", operator: "eq", value: "tracking" }),
        expect.objectContaining({ column: "applied_at", operator: "is", value: null }),
        expect.objectContaining({ column: "user_id", operator: "eq", value: USER_ID }),
      ]),
    );
  });
});

describe("isHiddenFromTracking — the visibility question the notice turns on", () => {
  it("is exactly the frozen list both application loaders exclude", () => {
    for (const status of APPLICATION_STATUSES) {
      expect(isHiddenFromTracking(status)).toBe(TRACKING_TAB_HIDDEN_STATUSES.includes(status));
    }
  });

  it("an APPLIED row is NOT hidden — this is why dropping its chip loses nothing", () => {
    for (const status of APPLIED_OR_LATER_STATUSES) {
      expect(isHiddenFromTracking(status)).toBe(false);
    }
  });
});

describe("presentUntrackOutcome — what the user is told", () => {
  it("says nothing when the row was really deleted (the chip's absence is the whole message)", () => {
    expect(presentUntrackOutcome({ deleted: true, kept: null, unknown: false }, JOB)).toBeNull();
  });

  it("says nothing when there was no row to keep", () => {
    expect(presentUntrackOutcome({ deleted: false, kept: null, unknown: false }, JOB)).toBeNull();
    expect(presentUntrackOutcome(null, JOB)).toBeNull();
  });

  it("a kept APPLIED row: info tone, names the status, points at Tracking, seeds the search", () => {
    const notice = presentUntrackOutcome(
      { deleted: false, kept: { status: "applied", appliedAt: APPLIED_AT }, unknown: false },
      JOB,
    );
    expect(notice).not.toBeNull();
    expect(notice.tone).toBe("info");
    expect(notice.jobId).toBe(EXTERNAL_ID);
    expect(notice.sentence).toContain("Senior Engineer at Acme");
    expect(notice.sentence).toContain(STATUS_LABELS.applied);
    expect(notice.sentence).toContain("Tracking");
    expect(notice.searchSeed).toBe("Acme");
  });

  it("a kept row Tracking does NOT list: warning tone, no search seed, and it says nothing shows it", () => {
    for (const status of TRACKING_TAB_HIDDEN_STATUSES) {
      const notice = presentUntrackOutcome(
        { deleted: false, kept: { status, appliedAt: null }, unknown: false },
        JOB,
      );
      expect(notice.tone, status).toBe("warning");
      // Never a link to a tab that filters this row out: an empty result reads
      // as "it is gone", which is the opposite of what happened.
      expect(notice.searchSeed, status).toBe("");
      expect(notice.sentence, status).toContain("does not list");
      expect(notice.sentence, status).toContain(STATUS_LABELS[status]);
    }
  });

  it("warns, rather than reassures, when the read-back could not confirm anything", () => {
    const notice = presentUntrackOutcome({ deleted: false, kept: null, unknown: true }, JOB);
    expect(notice.tone).toBe("warning");
    expect(notice.sentence).toContain("could not confirm");
    expect(notice.searchSeed).toBe("Acme");
  });

  it("tone is warning if and only if the surviving row is invisible in Tracking", () => {
    for (const status of APPLICATION_STATUSES) {
      const notice = presentUntrackOutcome(
        { deleted: false, kept: { status, appliedAt: null }, unknown: false },
        JOB,
      );
      expect(notice.tone === "warning", status).toBe(TRACKING_TAB_HIDDEN_STATUSES.includes(status));
    }
  });

  it("the announcement is the kicker and the sentence, so the live region says the whole thing", () => {
    const notice = presentUntrackOutcome(
      { deleted: false, kept: { status: "offer", appliedAt: APPLIED_AT }, unknown: false },
      JOB,
    );
    expect(notice.announcement).toBe(`${notice.kicker}. ${notice.sentence}`);
  });

  it("degrades to a neutral noun rather than an empty gap when the chip has no title or company", () => {
    const notice = presentUntrackOutcome(
      { deleted: false, kept: { status: "applied", appliedAt: null }, unknown: false },
      { id: "x", title: "   ", company: "" },
    );
    expect(notice.sentence).toContain("That posting");
    expect(notice.sentence).not.toContain("undefined");
    expect(notice.searchSeed).toBe("");
  });

  it("renders a status outside the vocabulary as its raw value, never as a blank", () => {
    const notice = presentUntrackOutcome(
      { deleted: false, kept: { status: "twelfth_status", appliedAt: null }, unknown: false },
      JOB,
    );
    expect(notice.sentence).toContain("twelfth_status");
    expect(notice.tone).toBe("info");
  });
});
