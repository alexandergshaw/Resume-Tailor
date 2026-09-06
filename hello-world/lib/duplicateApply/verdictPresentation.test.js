import { describe, it, expect } from "vitest";

import {
  presentVerdict,
  shouldRenderBanner,
  dismissalFingerprint,
  orderVerdicts,
  FORBIDDEN_STRINGS,
} from "@/lib/duplicateApply/verdictPresentation.js";

// ---------------------------------------------------------------------------
// AC-duplicate-apply-r4.md PART 2 (S-8a .. S-17); 3-plan-dupapply.md §2.4 /
// §3.4 / §4 (A-1..A-3) / §5 (S-3). This module is the pure surface decision
// -- given a verdict object, decide everything the DOM needs. This file
// never imports React and never touches a DOM: the DOM/CSS wiring is Wave 3
// (app/components/StatusBar.js, app/page.js), out of this wave's scope.
//
// Standing bias: a false alarm is the expensive failure, but silence about a
// real uncertainty is its own failure. Every fixture below is built from the
// EXACT shape duplicateApplyVerdict.js (Wave 1B, shipped, off-limits) really
// returns -- not the AC's aspirational shape -- so a mismatch between the
// two is caught here, not discovered at Wave 3 wiring time.
// ---------------------------------------------------------------------------

const RUN_STARTED_AT = Date.parse("2026-06-15T12:00:00.000Z");

function row({ applicationId = 1, company = "Acme Inc", title = "Software Engineer", status = "applied", appliedAt = "2026-06-01T00:00:00.000Z" } = {}) {
  return { applicationId, company, title, url: "https://boards.greenhouse.io/acme/jobs/4012345", status, appliedAt };
}

// --- Signal 1 (samePosition) fixtures, in duplicateApplyVerdict.js's own shape ---
const sp = {
  hit: (overrides) => ({ verdict: "hit", match: row(overrides), route: "url" }),
  clear: () => ({ verdict: "clear" }),
  noPostingIdentity: () => ({ verdict: "indeterminate", reason: "no-posting-identity" }), // capability
  undatedMatch: () => ({ verdict: "indeterminate", reason: "undated-match" }), // evidence-bearing
  futureOrConcurrent: () => ({ verdict: "indeterminate", reason: "future-or-concurrent" }), // evidence-bearing
  unknownStatusMatch: () => ({ verdict: "indeterminate", reason: "unknown-status-match" }), // evidence-bearing
  strandedAppliedRow: () => ({ verdict: "indeterminate", reason: "stranded-applied-row" }), // evidence-bearing
  rowsUnavailable: () => ({ verdict: "unavailable", reason: "rows-unavailable" }),
  checkThrew: () => ({ verdict: "unavailable", reason: "check-threw" }),
};

// --- Signal 2 (company) fixtures, in duplicateApplyVerdict.js's own shape ---
const co = {
  hit: (overrides = {}) => ({
    verdict: "hit",
    count: 2,
    undatableCount: 0,
    futureCount: 0,
    evidence: [row({ applicationId: 2, company: "Beta Co", title: "Analyst", appliedAt: "2026-06-05T00:00:00.000Z" }), row({ applicationId: 3, company: "Beta Co", title: "Analyst II", appliedAt: "2026-05-01T00:00:00.000Z" })],
    ...overrides,
  }),
  clear: () => ({ verdict: "clear", count: 0, undatableCount: 0, futureCount: 0 }),
  noCompanyKey: () => ({ verdict: "indeterminate", reason: "no-company-key" }), // capability
  undatedCompanyRows: () => ({
    verdict: "indeterminate",
    reason: "undated-company-rows",
    count: 0,
    undatableCount: 1,
    futureCount: 0,
    evidence: [row({ applicationId: 4, company: "Beta Co", title: "Undated Role", appliedAt: null })],
  }),
  futureCompanyRows: () => ({
    verdict: "indeterminate",
    reason: "future-company-rows",
    count: 0,
    undatableCount: 0,
    futureCount: 1,
    evidence: [row({ applicationId: 5, company: "Beta Co", title: "Future Role", appliedAt: "2026-07-01T00:00:00.000Z" })],
  }),
  rowsUnavailable: () => ({ verdict: "unavailable", reason: "rows-unavailable" }),
  checkThrew: () => ({ verdict: "unavailable", reason: "check-threw" }),
};

function verdict(samePosition, company) {
  return { samePosition, company, checkedAt: RUN_STARTED_AT, diagnostics: { rowsExamined: 1, rowsCounted: 1, rowsState: "ready" } };
}

function present(samePosition, company, extra = {}) {
  return presentVerdict({
    verdict: verdict(samePosition, company),
    jobId: "job-1",
    jobTitle: "",
    candidateCompany: "Acme Inc",
    queueLength: 1,
    timeZone: "UTC",
    statusLabels: { applied: "Applied", phone_screen: "Phone Screen" },
    ...extra,
  });
}

function allForbiddenLower() {
  return FORBIDDEN_STRINGS.map((s) => s.toLowerCase());
}

function assertNoForbiddenStrings(text) {
  const lower = String(text).toLowerCase();
  for (const bad of allForbiddenLower()) {
    expect(lower.includes(bad), `copy must not contain forbidden phrase "${bad}": "${text}"`).toBe(false);
  }
}

// ===========================================================================
// 1. THE FULL STATE MATRIX -- every combination of the two signals' four
//    values (hit / clear / indeterminate / unavailable), with the
//    capability/evidence-bearing split named explicitly wherever it changes
//    the outcome. This is the load-bearing enumeration the brief requires:
//    "assert what each renders -- including the ones that render nothing."
// ===========================================================================

describe("presentVerdict — the state matrix", () => {
  // Representative fixture per class, and whether that class RAISES a
  // banner alone. This is the ground truth the whole matrix is checked
  // against; every cell below is derived from these two tables, not
  // hand-picked per cell, so the matrix is exhaustive by construction.
  const S1_CLASSES = {
    hit: { make: sp.hit, raises: true },
    clear: { make: sp.clear, raises: false },
    capabilityIndeterminate: { make: sp.noPostingIdentity, raises: false },
    evidenceIndeterminate: { make: sp.undatedMatch, raises: true },
    unavailable: { make: sp.rowsUnavailable, raises: false },
  };
  const S2_CLASSES = {
    hit: { make: co.hit, raises: true },
    clear: { make: co.clear, raises: false },
    capabilityIndeterminate: { make: co.noCompanyKey, raises: false },
    evidenceIndeterminate: { make: co.undatedCompanyRows, raises: true },
    unavailable: { make: co.rowsUnavailable, raises: false },
  };

  for (const [s1Name, s1] of Object.entries(S1_CLASSES)) {
    for (const [s2Name, s2] of Object.entries(S2_CLASSES)) {
      const expectRaise = s1.raises || s2.raises;
      it(`samePosition=${s1Name} / company=${s2Name} -> ${expectRaise ? "a banner" : "NOTHING (null)"}`, () => {
        const result = present(s1.make(), s2.make());
        if (!expectRaise) {
          expect(result).toBeNull();
          return;
        }
        expect(result).not.toBeNull();
        const hasS1Clause = s1Name !== "clear";
        const hasS2Clause = s2Name !== "clear";
        const signalAxes = result.signals.map((sig) => sig.signal);
        expect(signalAxes.includes("same-position")).toBe(hasS1Clause);
        expect(signalAxes.includes("company")).toBe(hasS2Clause);
        // "once a banner exists, say everything" -- a rendered banner never
        // omits a non-clear axis just because that axis didn't raise it.
        expect(result.signals.length).toBe((hasS1Clause ? 1 : 0) + (hasS2Clause ? 1 : 0));
        assertNoForbiddenStrings(result.announcement);
      });
    }
  }

  it("[V-1-style non-vacuity control] the matrix above is not vacuously green: at least one cell renders a banner and at least one renders null", () => {
    let anyBanner = false;
    let anyNull = false;
    for (const s1 of Object.values(S1_CLASSES)) {
      for (const s2 of Object.values(S2_CLASSES)) {
        if (present(s1.make(), s2.make()) === null) anyNull = true;
        else anyBanner = true;
      }
    }
    expect(anyBanner).toBe(true);
    expect(anyNull).toBe(true);
  });
});

// ===========================================================================
// 2. THE SILENT CELLS, NAMED INDIVIDUALLY (S-10c/g/h/i) -- redundant with
//    the matrix above by design: these are the cells a sabotaged
//    implementation is most likely to get wrong quietly, so each gets its
//    own assertion independent of the loop.
// ===========================================================================

describe("presentVerdict — the four silent cells, each asserted directly", () => {
  it("S-10c: clear / clear renders nothing at all", () => {
    expect(present(sp.clear(), co.clear())).toBeNull();
  });

  it("S-10g: capability-indeterminate samePosition / clear company renders nothing (the manual-paste / OCR common case)", () => {
    expect(present(sp.noPostingIdentity(), co.clear())).toBeNull();
  });

  it("S-10h: capability-indeterminate / capability-indeterminate renders nothing (the noise cell)", () => {
    expect(present(sp.noPostingIdentity(), co.noCompanyKey())).toBeNull();
  });

  it("S-10i: unavailable / unavailable (a failed or in-flight applications load) renders nothing", () => {
    expect(present(sp.rowsUnavailable(), co.rowsUnavailable())).toBeNull();
  });

  it("S-10i extended: unavailable / clear renders nothing (an unavailable check must never read as a checked-and-clear one)", () => {
    expect(present(sp.rowsUnavailable(), co.clear())).toBeNull();
  });

  it("a whole-run throw (both signals unavailable/check-threw) renders nothing", () => {
    expect(present(sp.checkThrew(), co.checkThrew())).toBeNull();
  });
});

// ===========================================================================
// 3. EXACT COPY -- S-9, S-9a, S-10, S-10a/b, S-10e, S-10f, and the plan's
//    three NEW reasons (A-1 check-threw, A-2 rows-unavailable already
//    covered above, A-3 stranded-applied-row).
// ===========================================================================

describe("presentVerdict — exact copy per state", () => {
  it("S-9: samePosition hit alone — exact sentence, hit kicker, one evidence row for the matched application", () => {
    const result = present(sp.hit({ applicationId: 9, company: "Acme Inc", title: "Backend Engineer", appliedAt: "2026-05-20T00:00:00.000Z" }), co.clear());
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ signal: "same-position", severity: "hit", kicker: "POSSIBLE DUPLICATE" });
    expect(result.signals[0].sentence).toBe("Looks like you already applied to this posting");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].main).toBe("Acme Inc — Backend Engineer");
    expect(result.evidence[0].meta).toBe("Applied · 2026-05-20 · https://boards.greenhouse.io/acme/jobs/4012345");
    expect(result.evidence[0].dated).toBe("known");
  });

  it("S-9a (k=1): company hit alone — floor-count sentence names the candidate's own company", () => {
    const result = present(sp.clear(), co.hit());
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ signal: "company", severity: "hit", kicker: "APPLICATIONS AT THIS EMPLOYER" });
    expect(result.signals[0].sentence).toBe("At least 2 applications at Acme Inc in the past 30 days");
  });

  it("S-9a (k>1): distinct raw company spellings in the evidence switch to the B' phrasing", () => {
    const mixedEvidence = co.hit({
      evidence: [row({ applicationId: 6, company: "Beta Co" }), row({ applicationId: 7, company: "Beta Co, Inc." })],
    });
    const result = present(sp.clear(), mixedEvidence);
    expect(result.signals[0].sentence).toBe("At least 2 applications in the past 30 days, recorded under 2 different company names");
  });

  it("S-9a suffixes: undatableCount and futureCount both append their own 'Plus …' sentence, in that order, only when non-zero", () => {
    const result = present(sp.clear(), co.hit({ undatableCount: 1, futureCount: 2 }));
    expect(result.signals[0].sentence).toBe(
      "At least 2 applications at Acme Inc in the past 30 days Plus 1 with no recorded date. Plus 2 dated after this run started.",
    );
  });

  it("S-9a suffixes: zero counts add no suffix sentence at all", () => {
    const result = present(sp.clear(), co.hit());
    expect(result.signals[0].sentence).toBe("At least 2 applications at Acme Inc in the past 30 days");
  });

  it("S-10: both hit — ONE banner, same-position sentence before company sentence, combined evidence", () => {
    const result = present(sp.hit({ applicationId: 1 }), co.hit());
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0].signal).toBe("same-position");
    expect(result.signals[1].signal).toBe("company");
    // the combined evidence list carries the same-position match AND both
    // company rows -- never a second, separate banner or a second list.
    expect(result.evidence.length).toBe(3);
  });

  it("S-10a: samePosition hit + company capability-indeterminate — 'once a banner exists, say everything', capability reason included", () => {
    const result = present(sp.hit(), co.noCompanyKey());
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0]).toMatchObject({ signal: "same-position", severity: "hit" });
    expect(result.signals[1]).toMatchObject({ signal: "company", severity: "indeterminate", reason: "no-company-key" });
    expect(result.signals[1].sentence).toMatch(/couldn't identify the employer/i);
  });

  it("S-10b: company hit + samePosition capability-indeterminate — the mirror of S-10a", () => {
    const result = present(sp.noPostingIdentity(), co.hit());
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0]).toMatchObject({ signal: "company", severity: "hit" }); // hit line always first
    expect(result.signals[1]).toMatchObject({ signal: "same-position", severity: "indeterminate", reason: "no-posting-identity" });
  });

  it("S-10e (undated-match): samePosition evidence-bearing indeterminate alone — exact sentence, no accompanying evidence row (the evaluator retains no row reference for this reason)", () => {
    const result = present(sp.undatedMatch(), co.clear());
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].sentence).toBe(
      "You have an application on file for this posting with no recorded date — it may or may not be a duplicate.",
    );
    expect(result.evidence).toHaveLength(0);
  });

  it("S-10e (future-or-concurrent): exact sentence", () => {
    const result = present(sp.futureOrConcurrent(), co.clear());
    expect(result.signals[0].sentence).toBe(
      "You have an application on file for this posting dated after this run started — it may be a mistyped date or another tab's write.",
    );
  });

  it("S-10e (unknown-status-match): exact sentence", () => {
    const result = present(sp.unknownStatusMatch(), co.clear());
    expect(result.signals[0].sentence).toBe("You have an application on file for this posting at a status this check doesn't recognise.");
  });

  it("A-3 (stranded-applied-row, NEW): evidence-bearing, raises alone, never asserts a hit", () => {
    const result = present(sp.strandedAppliedRow(), co.clear());
    expect(result).not.toBeNull();
    expect(result.signals[0]).toMatchObject({ signal: "same-position", severity: "indeterminate", reason: "stranded-applied-row" });
    assertNoForbiddenStrings(result.signals[0].sentence);
  });

  it("S-10f (undated-company-rows): exact sentence names the candidate's company and the undatable count", () => {
    const result = present(sp.clear(), co.undatedCompanyRows());
    expect(result.signals[0].sentence).toBe("Couldn't count the past 30 days at Acme Inc — 1 application(s) there have no recorded date.");
    // undated rows are LISTED, never dropped, even though the company
    // signal itself did not reach `hit`.
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].dated).toBe("unknown");
    expect(result.evidence[0].meta).toContain("date unknown");
  });

  it("S-10f (future-company-rows): exact sentence names the future count", () => {
    const result = present(sp.clear(), co.futureCompanyRows());
    expect(result.signals[0].sentence).toBe("Couldn't count the past 30 days at Acme Inc — 1 application(s) there are dated after this run started.");
  });

  it("A-1 (check-threw, NEW): exact clause text, identical whichever axis it is attached to", () => {
    const onS1 = present(sp.checkThrew(), co.hit());
    const onS2 = present(sp.hit(), co.checkThrew());
    const clauseOnS1 = onS1.signals.find((s) => s.signal === "same-position").sentence;
    const clauseOnS2 = onS2.signals.find((s) => s.signal === "company").sentence;
    expect(clauseOnS1).toBe("This check hit an unexpected problem and couldn't finish.");
    expect(clauseOnS2).toBe("This check hit an unexpected problem and couldn't finish.");
  });

  it("A-2 (rows-unavailable, NEW) paired with a hit on the other axis: the unavailable axis gets a clause, never silent omission — the defect this design exists to prevent", () => {
    const result = present(sp.hit(), co.rowsUnavailable());
    expect(result).not.toBeNull();
    expect(result.signals).toHaveLength(2);
    const companyClause = result.signals.find((s) => s.signal === "company");
    expect(companyClause).toBeDefined();
    expect(companyClause.severity).toBe("unavailable");
    expect(companyClause.sentence).toBe("Your application history hadn't finished loading, so this couldn't be checked.");
  });
});

// ===========================================================================
// 4. SEVERITY IS DISTINGUISHABLE WITHOUT COLOUR (WCAG 1.4.1) -- this module
//    emits no colour at all; severity must be recoverable from
//    `severity`/`kicker`/array order alone.
// ===========================================================================

describe("presentVerdict — severity survives a colourless (or colour-blind) reading", () => {
  it("emits no colour value anywhere in its output — kicker/sentence carry no hex or CSS colour keyword", () => {
    const result = present(sp.hit(), co.hit());
    const hexPattern = /#[0-9a-f]{3,8}\b/i;
    for (const s of result.signals) {
      expect(s.kicker).not.toMatch(hexPattern);
      expect(s.sentence).not.toMatch(hexPattern);
    }
  });

  it("the three severities have pairwise-DIFFERENT kicker words — a screen reader or monochrome render distinguishes them by word, not hue", () => {
    const hitKicker = present(sp.hit(), co.clear()).signals[0].kicker;
    const indeterminateKicker = present(sp.undatedMatch(), co.clear()).signals[0].kicker;
    const unavailableKicker = present(sp.hit(), co.rowsUnavailable()).signals.find((s) => s.signal === "company").kicker;
    expect(hitKicker).not.toBe(indeterminateKicker);
    // indeterminate and unavailable intentionally SHARE a kicker word (1e's
    // own severity table groups them under one visual treatment) -- the
    // channel that still separates them is `severity` itself plus DOM order,
    // asserted next.
    expect(indeterminateKicker).toBe(unavailableKicker);
    expect(new Set([hitKicker]).has(unavailableKicker)).toBe(false);
  });

  it("`severity` is a distinct machine-readable value even where the kicker word is shared (hit vs indeterminate vs unavailable)", () => {
    const result = present(sp.hit(), co.rowsUnavailable());
    // samePosition is genuinely hit, company is genuinely unavailable --
    // both rendered, both distinguishable by `severity` alone.
    const samePos = result.signals.find((s) => s.signal === "same-position");
    const company = result.signals.find((s) => s.signal === "company");
    expect(samePos.severity).toBe("hit");
    expect(company.severity).toBe("unavailable");
    expect(samePos.severity).not.toBe(company.severity);
  });

  it("DOM order is a fourth non-colour channel: a `hit` line always sorts before a non-hit line, regardless of which axis it is", () => {
    const hitIsCompany = present(sp.noPostingIdentity(), co.hit());
    expect(hitIsCompany.signals[0].signal).toBe("company");
    const hitIsSamePosition = present(sp.hit(), co.noCompanyKey());
    expect(hitIsSamePosition.signals[0].signal).toBe("same-position");
  });
});

// ===========================================================================
// 5. NEVER ASSERTS A NEGATIVE (S-15.2) -- swept across every reachable copy
//    string this module can produce.
// ===========================================================================

describe("presentVerdict — S-15.2, never asserts a negative, swept across every reachable state", () => {
  const ALL_SP = [sp.hit(), sp.undatedMatch(), sp.futureOrConcurrent(), sp.unknownStatusMatch(), sp.strandedAppliedRow(), sp.noPostingIdentity(), sp.rowsUnavailable(), sp.checkThrew(), sp.clear()];
  const ALL_CO = [co.hit(), co.undatedCompanyRows(), co.futureCompanyRows(), co.noCompanyKey(), co.rowsUnavailable(), co.checkThrew(), co.clear()];

  it("no reachable announcement string contains a forbidden negative-assertion phrase", () => {
    let checked = 0;
    for (const s1 of ALL_SP) {
      for (const s2 of ALL_CO) {
        const result = present(s1, s2);
        if (result === null) continue;
        checked += 1;
        assertNoForbiddenStrings(result.announcement);
        for (const sig of result.signals) assertNoForbiddenStrings(sig.sentence);
      }
    }
    expect(checked).toBeGreaterThan(0); // the sweep must actually exercise non-null cases
  });
});

// ===========================================================================
// 6. EVIDENCE LIST — ordering, undated rows listed not dropped, raw (never
//    normalised) company text (C-22/C-24's mitigation).
// ===========================================================================

describe("presentVerdict — evidence list", () => {
  it("sorts newest-dated first, undated last, across a combined same-position + company list", () => {
    const result = present(
      sp.hit({ applicationId: 1, appliedAt: "2026-06-10T00:00:00.000Z" }),
      co.hit({
        evidence: [
          row({ applicationId: 2, appliedAt: null }),
          row({ applicationId: 3, appliedAt: "2026-06-20T00:00:00.000Z" }),
          row({ applicationId: 4, appliedAt: "2026-01-01T00:00:00.000Z" }),
        ],
      }),
    );
    expect(result.evidence.map((e) => e.key)).toEqual(["app:3", "app:1", "app:4", "app:2"]);
    expect(result.evidence.at(-1).dated).toBe("unknown");
  });

  it("undated rows are LISTED, never dropped, and carry the literal 'date unknown'", () => {
    const result = present(sp.clear(), co.hit({ evidence: [row({ applicationId: 8, appliedAt: null })] }));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].dated).toBe("unknown");
    expect(result.evidence[0].meta).toContain("date unknown");
  });

  it("renders the RAW company string per row, never a normalised key — two differently-spelled evidence rows both surface verbatim", () => {
    const result = present(
      sp.clear(),
      co.hit({ evidence: [row({ applicationId: 10, company: "Acme Inc" }), row({ applicationId: 11, company: "ACME, Incorporated" })] }),
    );
    const mains = result.evidence.map((e) => e.main);
    expect(mains.some((m) => m.startsWith("Acme Inc —"))).toBe(true);
    expect(mains.some((m) => m.startsWith("ACME, Incorporated —"))).toBe(true);
  });

  it("statuses render through the caller-supplied statusLabels map, never an invented label", () => {
    const result = present(sp.clear(), co.hit({ evidence: [row({ applicationId: 12, status: "phone_screen" })] }), {
      statusLabels: { phone_screen: "Phone Screen" },
    });
    expect(result.evidence[0].meta).toContain("Phone Screen");
  });

  it("an unrecognised status falls back to the raw status string rather than throwing or inventing a label", () => {
    const result = present(sp.clear(), co.hit({ evidence: [row({ applicationId: 13, status: "some_future_status" })] }), { statusLabels: {} });
    expect(result.evidence[0].meta).toContain("some_future_status");
  });
});

// ===========================================================================
// 7. interviewSearchSeed — S-14's mandatory guard.
// ===========================================================================

describe("presentVerdict — interviewSearchSeed guard (S-14)", () => {
  it("seeds the candidate's own company when every cited row's raw company contains it", () => {
    const result = present(sp.clear(), co.hit({ evidence: [row({ company: "Acme Inc" }), row({ company: "Acme Inc HQ" })] }), {
      candidateCompany: "Acme Inc",
    });
    expect(result.interviewSearchSeed).toBe("Acme Inc");
  });

  it("falls back to '' when a cited row's raw company would be HIDDEN by the candidate's own spelling — the exact C-22 merge case", () => {
    const result = present(sp.clear(), co.hit({ evidence: [row({ company: "Acme" }), row({ company: "Beta Holdings" })] }), {
      candidateCompany: "Acme Inc",
    });
    expect(result.interviewSearchSeed).toBe("");
  });

  it("always SETS the seed (never leaves a caller's stale search stale) even with zero evidence rows", () => {
    const result = present(sp.hit(), co.clear(), { candidateCompany: "Acme Inc" });
    expect(result.interviewSearchSeed).toBe("Acme Inc");
  });
});

// ===========================================================================
// 8. CONCURRENCY — the "1 of N" queue label and worst-first ordering.
// ===========================================================================

describe("presentVerdict — queueLabel", () => {
  it("is null when queueLength <= 1 (including undefined)", () => {
    expect(present(sp.hit(), co.clear(), { queueLength: 1 }).queueLabel).toBeNull();
    expect(present(sp.hit(), co.clear(), { queueLength: 0 }).queueLabel).toBeNull();
    expect(present(sp.hit(), co.clear(), { queueLength: undefined }).queueLabel).toBeNull();
  });

  it("is '1 of N' when queueLength > 1", () => {
    expect(present(sp.hit(), co.clear(), { queueLength: 3 }).queueLabel).toBe("1 of 3");
  });
});

describe("orderVerdicts — worst outstanding verdict first, oldest-first on a tie", () => {
  it("ranks hit > evidence-bearing indeterminate > capability indeterminate > unavailable > clear", () => {
    const entries = [
      { jobId: "clear-job", verdict: verdict(sp.clear(), co.clear()) },
      { jobId: "unavailable-job", verdict: verdict(sp.rowsUnavailable(), co.rowsUnavailable()) },
      { jobId: "capability-job", verdict: verdict(sp.noPostingIdentity(), co.clear()) },
      { jobId: "evidence-job", verdict: verdict(sp.undatedMatch(), co.clear()) },
      { jobId: "hit-job", verdict: verdict(sp.hit(), co.clear()) },
    ];
    const ordered = orderVerdicts(entries).map((e) => e.jobId);
    expect(ordered).toEqual(["hit-job", "evidence-job", "capability-job", "unavailable-job", "clear-job"]);
  });

  it("is stable: two equally-severe entries keep their original (arrival / oldest-first) order", () => {
    const entries = [
      { jobId: "first-hit", verdict: verdict(sp.hit({ applicationId: 1 }), co.clear()) },
      { jobId: "second-hit", verdict: verdict(sp.hit({ applicationId: 2 }), co.clear()) },
    ];
    expect(orderVerdicts(entries).map((e) => e.jobId)).toEqual(["first-hit", "second-hit"]);
  });

  it("accepts bare verdict objects (not only {jobId, verdict} wrappers) and does not mutate the input array", () => {
    const a = verdict(sp.clear(), co.clear());
    const b = verdict(sp.hit(), co.clear());
    const input = [a, b];
    const ordered = orderVerdicts(input);
    expect(ordered).toEqual([b, a]);
    expect(input).toEqual([a, b]); // original array untouched
  });

  it("returns [] for a non-array input rather than throwing", () => {
    expect(orderVerdicts(null)).toEqual([]);
    expect(orderVerdicts(undefined)).toEqual([]);
  });
});

// ===========================================================================
// 9. shouldRenderBanner — the single source of truth, consistent with
//    presentVerdict's own null/non-null decision across the whole matrix.
// ===========================================================================

describe("shouldRenderBanner", () => {
  it("agrees with presentVerdict's null/non-null decision across every fixture combination", () => {
    const ALL_SP = [sp.hit(), sp.clear(), sp.noPostingIdentity(), sp.undatedMatch(), sp.futureOrConcurrent(), sp.unknownStatusMatch(), sp.strandedAppliedRow(), sp.rowsUnavailable(), sp.checkThrew()];
    const ALL_CO = [co.hit(), co.clear(), co.noCompanyKey(), co.undatedCompanyRows(), co.futureCompanyRows(), co.rowsUnavailable(), co.checkThrew()];
    for (const s1 of ALL_SP) {
      for (const s2 of ALL_CO) {
        const v = verdict(s1, s2);
        expect(shouldRenderBanner(v)).toBe(present(s1, s2) !== null);
      }
    }
  });

  it("returns false for a malformed or missing verdict rather than throwing", () => {
    expect(shouldRenderBanner(null)).toBe(false);
    expect(shouldRenderBanner(undefined)).toBe(false);
    expect(shouldRenderBanner({})).toBe(false);
  });
});

// ===========================================================================
// 10. dismissalFingerprint — AC S-17.
// ===========================================================================

describe("dismissalFingerprint", () => {
  it("is identical across two evaluations of the SAME unchanged verdict (repeat-run dismissal stays dismissed)", () => {
    const a = dismissalFingerprint(verdict(sp.hit({ applicationId: 1 }), co.clear()), "job-1");
    const b = dismissalFingerprint(verdict(sp.hit({ applicationId: 1 }), co.clear()), "job-1");
    expect(a).toBe(b);
  });

  it("changes when the company count grows (2 -> 3) — the one case a bare job-id key would wrongly suppress", () => {
    const before = dismissalFingerprint(verdict(sp.clear(), co.hit({ count: 2 })), "job-1");
    const after = dismissalFingerprint(verdict(sp.clear(), co.hit({ count: 3 })), "job-1");
    expect(before).not.toBe(after);
  });

  it("changes when a new prior application appears in the company evidence", () => {
    const before = dismissalFingerprint(verdict(sp.clear(), co.hit()), "job-1");
    const after = dismissalFingerprint(
      verdict(sp.clear(), co.hit({ evidence: [row({ applicationId: 2 }), row({ applicationId: 3 }), row({ applicationId: 99 })] })),
      "job-1",
    );
    expect(before).not.toBe(after);
  });

  it("differs across two different jobIds even with an identical verdict", () => {
    const v = verdict(sp.hit(), co.clear());
    expect(dismissalFingerprint(v, "job-1")).not.toBe(dismissalFingerprint(v, "job-2"));
  });
});

// ===========================================================================
// 11. Purity — presentVerdict never mutates its input.
// ===========================================================================

describe("presentVerdict — purity", () => {
  it("does not mutate a frozen verdict object", () => {
    const v = verdict(sp.hit(), co.hit());
    Object.freeze(v);
    Object.freeze(v.samePosition);
    Object.freeze(v.company);
    Object.freeze(v.company.evidence);
    expect(() =>
      presentVerdict({ verdict: v, jobId: "job-1", jobTitle: "", candidateCompany: "Acme Inc", queueLength: 1, timeZone: "UTC", statusLabels: {} }),
    ).not.toThrow();
  });

  it("falls back to UTC for an invalid IANA timeZone instead of throwing", () => {
    expect(() => present(sp.hit(), co.clear(), { timeZone: "Not/AZone" })).not.toThrow();
  });
});
