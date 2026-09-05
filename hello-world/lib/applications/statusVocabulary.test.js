import { describe, it, expect } from "vitest";

import {
  APPLICATION_STATUSES,
  APPLIED_OR_LATER_STATUSES,
  PRE_APPLY_STATUSES,
  USER_SELECTABLE_STATUSES,
  USER_SELECTABLE_STATUSES_ORDERED,
  TRACKING_TAB_HIDDEN_STATUSES,
  RETURN_TO_PRE_APPLY_STATUS,
  STATUS_LABELS,
  STATUS,
  classifyStatus,
  isAppliedOrLater,
  excludeTrackingTabHiddenStatuses,
} from "@/lib/applications/statusVocabulary.js";

// ---------------------------------------------------------------------------
// The vocabulary's CLOSURE. This is the file that has to fail the day someone
// adds a twelfth status to `applications_status_check` and classifies it
// nowhere, because every other guard in this chunk is derived from these
// arrays and would silently widen or narrow with them.
//
// Three disciplines, stated once:
//
//   1. `toEqual` on a SORTED array, never `toContain` / `toHaveLength` /
//      `toBeGreaterThanOrEqual`. A lower bound cannot detect an unprotected
//      addition, and a membership check cannot detect a spurious one.
//   2. The PARTITION is asserted in both directions — union complete AND
//      intersection empty. Either alone is satisfiable by a wrong set.
//   3. `classifyStatus` is asserted as a whole TABLE (`toEqual` over an object
//      built from all 11 values plus the off-vocabulary cases), not as a
//      sequence of independent `toBe`s, so a status that silently drops out of
//      the switch fails here rather than at its first call site.
//
// Source of truth for the 11 values, in order of authority:
//   - the LIVE `applications_status_check` constraint, read from
//     `pg_constraint` by the owner (AC PART 0, S2);
//   - `supabase/migrations/20260610020000_applications_status_auto_queued.sql`
//     lines 20-30, which match it value-for-value and in the same order.
// ---------------------------------------------------------------------------

// Sorted. AC-4 says `toEqual` on a sorted array, so the literal is sorted.
const ELEVEN = [
  "accepted",
  "applied",
  "auto_queued",
  "auto_tailored",
  "interviewing",
  "offer",
  "phone_screen",
  "rejected",
  "tailored",
  "tracking",
  "withdrawn",
];

const SEVEN_APPLIED_OR_LATER = [
  "accepted",
  "applied",
  "interviewing",
  "offer",
  "phone_screen",
  "rejected",
  "withdrawn",
];

const FOUR_PRE_APPLY = ["auto_queued", "auto_tailored", "tailored", "tracking"];

// The eight both dialogs render today, sorted. `EditAppDialog.js:53-60` and
// `AddAppDialog.js:55-62` carry byte-identical lists; F-5 freezes the rendered
// output, so these are the eight and their labels are the eight labels.
const EIGHT_USER_SELECTABLE = [
  "accepted",
  "applied",
  "interviewing",
  "offer",
  "phone_screen",
  "rejected",
  "tailored",
  "withdrawn",
];

// Pipeline order: the order a job actually moves through, and the order both
// dialogs render the status Select in. Deliberately NOT alphabetical — the
// alphabetically-sorted EIGHT_USER_SELECTABLE above starts "accepted, applied,
// ..." which puts the eight's rarest first pick ahead of its most common one
// ("applied").
const PIPELINE_ORDER_EXPECTED = [
  "tailored",
  "applied",
  "phone_screen",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
];

const sorted = (xs) => [...xs].sort();

describe("statusVocabulary — the closed sets", () => {
  it("APPLICATION_STATUSES is exactly the eleven values the CHECK constraint allows", () => {
    expect(sorted(APPLICATION_STATUSES)).toEqual(ELEVEN);
    // Asserted separately from the sorted comparison: the module is required to
    // export it already sorted, and `sorted()` above would hide an unsorted one.
    expect([...APPLICATION_STATUSES]).toEqual(ELEVEN);
  });

  it("APPLIED_OR_LATER_STATUSES is exactly the seven protected values", () => {
    expect([...APPLIED_OR_LATER_STATUSES]).toEqual(SEVEN_APPLIED_OR_LATER);
  });

  it("PRE_APPLY_STATUSES is exactly the four the write guard allows through", () => {
    expect([...PRE_APPLY_STATUSES]).toEqual(FOUR_PRE_APPLY);
  });

  it("TRACKING_TAB_HIDDEN_STATUSES is exactly the two both loaders exclude", () => {
    // `app/page.js:1391-1392` and `lib/copilot/postings.js:80-81`, in that order.
    expect([...TRACKING_TAB_HIDDEN_STATUSES]).toEqual(["auto_tailored", "tracking"]);
  });

  it("every exported set is frozen, so a caller cannot widen the guard by pushing to it", () => {
    expect(Object.isFrozen(APPLICATION_STATUSES)).toBe(true);
    expect(Object.isFrozen(APPLIED_OR_LATER_STATUSES)).toBe(true);
    expect(Object.isFrozen(PRE_APPLY_STATUSES)).toBe(true);
    expect(Object.isFrozen(USER_SELECTABLE_STATUSES)).toBe(true);
    expect(Object.isFrozen(USER_SELECTABLE_STATUSES_ORDERED)).toBe(true);
    expect(Object.isFrozen(TRACKING_TAB_HIDDEN_STATUSES)).toBe(true);
    expect(Object.isFrozen(STATUS_LABELS)).toBe(true);
    expect(Object.isFrozen(STATUS)).toBe(true);
  });
});

describe("statusVocabulary — the partition", () => {
  it("PRE_APPLY ∪ APPLIED_OR_LATER covers the whole vocabulary", () => {
    expect(sorted([...PRE_APPLY_STATUSES, ...APPLIED_OR_LATER_STATUSES])).toEqual(ELEVEN);
  });

  it("PRE_APPLY ∩ APPLIED_OR_LATER is empty", () => {
    const both = APPLIED_OR_LATER_STATUSES.filter((s) => PRE_APPLY_STATUSES.includes(s));
    expect(both).toEqual([]);
  });

  it("[control] the partition assertions can fail — a duplicated status breaks both halves", () => {
    // The union/intersection pair above is the test that catches an
    // unclassified twelfth status. This control proves the arithmetic behind
    // it is real rather than trivially satisfied: mis-classify one value and
    // both halves move.
    const wrongPreApply = [...PRE_APPLY_STATUSES, "applied"];
    expect(sorted([...wrongPreApply, ...APPLIED_OR_LATER_STATUSES])).not.toEqual(ELEVEN);
    expect(APPLIED_OR_LATER_STATUSES.filter((s) => wrongPreApply.includes(s))).toEqual(["applied"]);
  });
});

describe("statusVocabulary — the user-selectable subset", () => {
  it("USER_SELECTABLE_STATUSES is exactly the eight both dialogs offer today", () => {
    expect([...USER_SELECTABLE_STATUSES]).toEqual(EIGHT_USER_SELECTABLE);
  });

  it("USER_SELECTABLE_STATUSES ⊂ APPLICATION_STATUSES", () => {
    const strays = USER_SELECTABLE_STATUSES.filter((s) => !APPLICATION_STATUSES.includes(s));
    expect(strays).toEqual([]);
    // Proper subset: eight of eleven, so the containment above is not vacuous
    // through equality.
    expect(USER_SELECTABLE_STATUSES.length).toBeLessThan(APPLICATION_STATUSES.length);
  });

  it("auto_queued is NOT hand-settable — a user cannot invent a queue membership", () => {
    // Stated as a positive first, so the negative below is known to be about a
    // vocabulary that actually carries the value.
    expect(APPLICATION_STATUSES.includes("auto_queued")).toBe(true);
    expect(USER_SELECTABLE_STATUSES.includes("auto_queued")).toBe(false);
  });

  it("neither loader-hidden status is hand-settable either", () => {
    // `tracking` and `auto_tailored` are excluded by both application loaders,
    // so offering them in the Select would be a one-way door: the row would
    // vanish from the only screen that can correct it.
    for (const hidden of TRACKING_TAB_HIDDEN_STATUSES) {
      expect(APPLICATION_STATUSES.includes(hidden)).toBe(true);
      expect(USER_SELECTABLE_STATUSES.includes(hidden)).toBe(false);
    }
  });
});

describe("statusVocabulary — USER_SELECTABLE_STATUSES_ORDERED, the dialogs' render order", () => {
  it("is pinned to pipeline order, NOT alphabetical order", () => {
    expect([...USER_SELECTABLE_STATUSES_ORDERED]).toEqual(PIPELINE_ORDER_EXPECTED);
  });

  it("[control] the order pin can fail — the sorted array is a different sequence", () => {
    // Proves the toEqual above is actually checking sequence, not just
    // membership: the alphabetically-sorted form of the same eight values is
    // NOT equal to the pipeline-ordered form, even though both are frozen
    // arrays. A test that could not tell these apart would pass on either
    // order the module ever exported.
    expect([...USER_SELECTABLE_STATUSES]).not.toEqual(PIPELINE_ORDER_EXPECTED);
  });

  it("carries EXACTLY the same members as USER_SELECTABLE_STATUSES — reordered, not a different set", () => {
    expect(sorted(USER_SELECTABLE_STATUSES_ORDERED)).toEqual(sorted(USER_SELECTABLE_STATUSES));
    expect(sorted(USER_SELECTABLE_STATUSES_ORDERED)).toEqual(EIGHT_USER_SELECTABLE);
  });

  it("USER_SELECTABLE_STATUSES itself stays sorted — this export does not touch it", () => {
    // The standing discipline: do not weaken an assertion already pinning a
    // set sorted. USER_SELECTABLE_STATUSES is the membership set every
    // closure/subset test above reads; it must still equal its own sorted
    // form after this module also exports a differently-ordered copy.
    expect([...USER_SELECTABLE_STATUSES]).toEqual(sorted(USER_SELECTABLE_STATUSES));
  });
});

describe("statusVocabulary — RETURN_TO_PRE_APPLY_STATUS, the two-way door", () => {
  // Three clauses. Each closes one way the door could become one-way again.
  it("is 'tailored'", () => {
    expect(RETURN_TO_PRE_APPLY_STATUS).toBe("tailored");
  });

  it("∈ PRE_APPLY_STATUSES — so the writer will promote the row again later", () => {
    expect(PRE_APPLY_STATUSES.includes(RETURN_TO_PRE_APPLY_STATUS)).toBe(true);
  });

  it("∈ USER_SELECTABLE_STATUSES — so the Select can actually offer it", () => {
    expect(USER_SELECTABLE_STATUSES.includes(RETURN_TO_PRE_APPLY_STATUS)).toBe(true);
  });

  it("∉ TRACKING_TAB_HIDDEN_STATUSES — so the row stays visible where the remedy lives", () => {
    expect(TRACKING_TAB_HIDDEN_STATUSES.includes(RETURN_TO_PRE_APPLY_STATUS)).toBe(false);
  });
});

describe("statusVocabulary — STATUS_LABELS", () => {
  it("labels exactly the eleven statuses, and nothing else", () => {
    expect(sorted(Object.keys(STATUS_LABELS))).toEqual(ELEVEN);
  });

  it("renders the eight dialog labels byte-identically to today", () => {
    // `EditAppDialog.js:53-60` / `AddAppDialog.js:55-62`. F-5 requires the
    // rendered output to be unchanged once the dialogs source their options
    // from this map, so these eight strings are frozen by that criterion.
    expect(STATUS_LABELS.tailored).toBe("Tailored");
    expect(STATUS_LABELS.applied).toBe("Applied");
    expect(STATUS_LABELS.phone_screen).toBe("Phone Screen");
    expect(STATUS_LABELS.interviewing).toBe("Interviewing");
    expect(STATUS_LABELS.offer).toBe("Offer");
    expect(STATUS_LABELS.accepted).toBe("Accepted");
    expect(STATUS_LABELS.rejected).toBe("Rejected");
    expect(STATUS_LABELS.withdrawn).toBe("Withdrawn");
  });

  it("labels auto_queued as the Edit dialog's out-of-range item reads it", () => {
    // F-5 appends `${STATUS_LABELS[s]} (current)` for a status outside the
    // eight, and 1c fixes that rendered string as "In auto-apply queue
    // (current)" — so the label itself is the prefix.
    expect(STATUS_LABELS.auto_queued).toBe("In auto-apply queue");
  });

  it("every label is a non-empty string — no status renders as a blank menu item", () => {
    const empty = Object.entries(STATUS_LABELS)
      .filter(([, label]) => typeof label !== "string" || label.trim() === "")
      .map(([value]) => value);
    expect(empty).toEqual([]);
  });

  it("no two statuses share a label — the Select would be ambiguous", () => {
    const labels = Object.values(STATUS_LABELS);
    expect(sorted(new Set(labels))).toEqual(sorted(labels));
  });
});

describe("statusVocabulary — STATUS value constants", () => {
  it("carries one constant per status, named as the upper-snake of its value", () => {
    // The plan names `STATUS.APPLIED` (F-1) and `STATUS.AUTO_QUEUED` (wave 3's
    // literal-for-constant swap in `app/api/auto-apply-queue/route.js`), and
    // requires eleven keys. Both named cases are the upper-snake form.
    expect(sorted(Object.keys(STATUS))).toEqual(sorted(ELEVEN.map((s) => s.toUpperCase())));
  });

  it("every constant's value is its own status string", () => {
    const mapped = Object.fromEntries(Object.keys(STATUS).map((k) => [k, STATUS[k]]));
    const expected = Object.fromEntries(ELEVEN.map((s) => [s.toUpperCase(), s]));
    expect(mapped).toEqual(expected);
  });

  it("STATUS's values are exactly APPLICATION_STATUSES — one home, no drift", () => {
    expect(sorted(Object.values(STATUS))).toEqual(ELEVEN);
  });
});

describe("statusVocabulary — classifyStatus", () => {
  it("classifies all eleven, as a whole table", () => {
    const table = Object.fromEntries(ELEVEN.map((s) => [s, classifyStatus(s)]));
    expect(table).toEqual({
      accepted: "applied-or-later",
      applied: "applied-or-later",
      auto_queued: "pre-apply",
      auto_tailored: "pre-apply",
      interviewing: "applied-or-later",
      offer: "applied-or-later",
      phone_screen: "applied-or-later",
      rejected: "applied-or-later",
      tailored: "pre-apply",
      tracking: "pre-apply",
      withdrawn: "applied-or-later",
    });
  });

  it("is three-valued: anything outside the eleven is 'unknown', not 'pre-apply'", () => {
    // Load-bearing, not documentary. The write guard is an ALLOW-LIST, so
    // "unknown" is the class the writer refuses. Under a two-valued
    // classifier a twelfth status added to the live CHECK by a future
    // integration would be silently demoted.
    const offVocabulary = {
      screening: classifyStatus("screening"),
      "": classifyStatus(""),
      null: classifyStatus(null),
      undefined: classifyStatus(undefined),
      APPLIED: classifyStatus("APPLIED"),
      "applied ": classifyStatus("applied "),
      number: classifyStatus(7),
    };
    expect(offVocabulary).toEqual({
      screening: "unknown",
      "": "unknown",
      null: "unknown",
      undefined: "unknown",
      // Case- and whitespace-sensitivity is deliberate: the column stores the
      // exact strings the CHECK constraint allows, and a classifier that
      // normalises would accept a value Postgres would reject.
      APPLIED: "unknown",
      "applied ": "unknown",
      number: "unknown",
    });
  });

  it("agrees with the two sets it is derived from, for every one of the eleven", () => {
    const disagreements = ELEVEN.filter((s) => {
      const c = classifyStatus(s);
      return (
        (c === "applied-or-later") !== APPLIED_OR_LATER_STATUSES.includes(s) ||
        (c === "pre-apply") !== PRE_APPLY_STATUSES.includes(s)
      );
    });
    expect(disagreements).toEqual([]);
  });
});

describe("statusVocabulary — isAppliedOrLater", () => {
  it("is true for exactly the seven", () => {
    const trueFor = ELEVEN.filter((s) => isAppliedOrLater(s));
    expect(trueFor).toEqual(SEVEN_APPLIED_OR_LATER);
  });

  it("is false — never throwing, never truthy — for an unknown or absent status", () => {
    const table = {
      screening: isAppliedOrLater("screening"),
      null: isAppliedOrLater(null),
      undefined: isAppliedOrLater(undefined),
      "": isAppliedOrLater(""),
    };
    expect(table).toEqual({ screening: false, null: false, undefined: false, "": false });
  });
});

describe("statusVocabulary — excludeTrackingTabHiddenStatuses", () => {
  // The two application loaders keep two hand-written copies of the same
  // filter today. This helper is what makes them one. Its shape is PINNED by
  // `lib/copilot/postings.test.js:195-196`, whose local fake exposes only
  // `select`, `eq`, `neq`, `order` and `then` — so an `.in()` / `.not()` /
  // `.is()` here is not a style disagreement, it is a TypeError that takes
  // that whole file down. The stub below models exactly that constraint: it
  // has a `neq` and nothing else, so any other method is a hard failure.
  function neqOnlyQuery() {
    const calls = [];
    const q = {
      calls,
      neq(column, value) {
        calls.push([column, value]);
        return q;
      },
    };
    return q;
  }

  it("emits exactly two .neq() calls, in the order both loaders already use", () => {
    const q = neqOnlyQuery();
    excludeTrackingTabHiddenStatuses(q);
    expect(q.calls).toEqual([
      ["status", "tracking"],
      ["status", "auto_tailored"],
    ]);
  });

  it("returns the query so it stays chainable", () => {
    const q = neqOnlyQuery();
    expect(excludeTrackingTabHiddenStatuses(q)).toBe(q);
  });

  it("uses no builder method beyond .neq() — the pinned fake has no others", () => {
    // A duck-typed positive: the stub has one method. If the helper reaches
    // for `.in`, `.not`, `.is` or `.or`, this throws rather than quietly
    // producing a different filter that only fails in production.
    const q = neqOnlyQuery();
    expect(Object.keys(q).filter((k) => typeof q[k] === "function")).toEqual(["neq"]);
    expect(() => excludeTrackingTabHiddenStatuses(q)).not.toThrow();
  });

  it("filters out exactly the hidden statuses when applied to a real row set", () => {
    // A behavioural control on the pure one above: two `.neq`s that name the
    // wrong columns would still be "two `.neq` calls".
    const rowQuery = (rows) => ({
      rows,
      neq: (column, value) => rowQuery(rows.filter((r) => r[column] !== value)),
    });
    const out = excludeTrackingTabHiddenStatuses(
      rowQuery(ELEVEN.map((status, i) => ({ id: `a${i}`, status }))),
    );
    expect(sorted(out.rows.map((r) => r.status))).toEqual(
      ELEVEN.filter((s) => !TRACKING_TAB_HIDDEN_STATUSES.includes(s)),
    );
  });
});
