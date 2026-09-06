import { describe, it, expect } from "vitest";

import { buildDupeLogRecord, hashPostingKey, LOG_FORBIDDEN_FIELDS } from "@/lib/duplicateApply/duplicateApplyLog.js";

// ---------------------------------------------------------------------------
// 3-plan-dupapply.md §2.5 / §3.5, rationale in 1f-admin-dupapply.md FINDING
// L-3. This module builds one LOG RECORD from a duplicateApplyVerdict.js
// verdict + run context -- it does not call createSessionLog and does not
// touch the DOM (that is Wave 4's job, lib/copilot/sessionLog.js and
// lib/document/download.js).
//
// Standing bias for this file specifically: the log has a clearly visible
// download button (the standing feature-logs rule), so it is a disclosure
// surface. Every test that builds a "salted" verdict is proving a NEGATIVE
// (the salt never reaches the output) and is paired with a positive control
// proving the record is not simply empty -- a gutted implementation that
// returns `{}` would otherwise pass every negative test vacuously.
// ---------------------------------------------------------------------------

const REAL_HASH = hashPostingKey;

function stubHash(prefix) {
  return (key) => `${prefix}:${key}`;
}

function rawEvidence(overrides = {}) {
  return {
    applicationId: "app-999",
    company: "Acme Corp",
    title: "Staff Engineer",
    url: "https://boards.greenhouse.io/acme/jobs/555",
    status: "applied",
    appliedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function hitVerdict(overrides = {}) {
  return {
    samePosition: { verdict: "hit", match: rawEvidence(), route: "url" },
    company: { verdict: "clear", count: 0, undatableCount: 0, futureCount: 0 },
    checkedAt: 1_750_000_000_000,
    diagnostics: {
      rowsExamined: 12,
      rowsCounted: 1,
      rowsState: "ready",
      candidateKey: "u:https://boards.greenhouse.io/acme/jobs/555",
      candidateCompanyKey: "a:acme",
      windowDays: 30,
      runStartedAt: 1_749_999_000_000,
    },
    ...overrides,
  };
}

function clearVerdict(overrides = {}) {
  return {
    samePosition: { verdict: "clear" },
    company: { verdict: "clear", count: 0, undatableCount: 0, futureCount: 0 },
    checkedAt: 1_750_000_000_000,
    diagnostics: {
      rowsExamined: 40,
      rowsCounted: 0,
      rowsState: "ready",
      candidateKey: "u:https://example.com/jobs/1",
      candidateCompanyKey: "a:beta-widgets",
      windowDays: 30,
      runStartedAt: 1_749_999_000_000,
    },
    ...overrides,
  };
}

function unavailableVerdict(reason, rowsState) {
  const unavailable = { verdict: "unavailable", reason };
  return {
    samePosition: unavailable,
    company: unavailable,
    checkedAt: 1_750_000_000_000,
    diagnostics: {
      rowsExamined: 0,
      rowsCounted: 0,
      rowsState,
      candidateKey: null,
      candidateCompanyKey: "",
      windowDays: 30,
      runStartedAt: 1_749_999_000_000,
    },
  };
}

// ---------------------------------------------------------------------------
// hashPostingKey -- the sync FNV digest.
// ---------------------------------------------------------------------------
describe("hashPostingKey", () => {
  it("returns an 8-character lowercase hex digest for a normal string", () => {
    const out = REAL_HASH("u:https://boards.greenhouse.io/acme/jobs/555");
    expect(out).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic -- the same input always hashes the same way", () => {
    const a = REAL_HASH("a:acme");
    const b = REAL_HASH("a:acme");
    expect(a).toBe(b);
  });

  it("different inputs produce different digests (no trivial collision on these fixtures)", () => {
    expect(REAL_HASH("a:acme")).not.toBe(REAL_HASH("a:beta-widgets"));
    expect(REAL_HASH("u:https://example.com/jobs/1")).not.toBe(REAL_HASH("u:https://example.com/jobs/2"));
  });

  it("never returns the input string itself, even for a short or hex-shaped input", () => {
    for (const input of ["a", "deadbeef", "0", "u:x", "1234abcd"]) {
      expect(REAL_HASH(input)).not.toBe(input);
    }
  });

  it("returns null (never throws) for null, undefined, non-string, or empty-string input", () => {
    expect(REAL_HASH(null)).toBeNull();
    expect(REAL_HASH(undefined)).toBeNull();
    expect(REAL_HASH(42)).toBeNull();
    expect(REAL_HASH({})).toBeNull();
    expect(REAL_HASH("")).toBeNull();
  });

  it("does not throw on a very long string (companyIdentityKey/postingKeyOfPosition have their own caps, but this function must not add a second failure mode)", () => {
    const long = "u:https://example.com/" + "x".repeat(200_000);
    expect(() => REAL_HASH(long)).not.toThrow();
    expect(REAL_HASH(long)).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// buildDupeLogRecord -- which signal fired, its verdict, its reason.
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- signal, verdict, reason", () => {
  it("records a hit verdict: which signal, its verdict, its route, and that a match exists (never the match's content)", () => {
    const record = buildDupeLogRecord({ verdict: hitVerdict(), jobId: "url-https://example.com/1", entryPoint: "E3" });
    expect(record.samePosition.verdict).toBe("hit");
    expect(record.samePosition.reason).toBeNull(); // a hit carries no reason
    expect(record.samePosition.route).toBe("url");
    expect(record.samePosition.matched).toBe(true);
  });

  it("records an indeterminate verdict with its reason (evidence-bearing case)", () => {
    const verdict = clearVerdict({ samePosition: { verdict: "indeterminate", reason: "undated-match" } });
    const record = buildDupeLogRecord({ verdict, jobId: "url-x", entryPoint: "E3" });
    expect(record.samePosition.verdict).toBe("indeterminate");
    expect(record.samePosition.reason).toBe("undated-match");
    expect(record.samePosition.matched).toBe(false);
  });

  it("records a genuine clear with no reason and no match", () => {
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId: "url-x", entryPoint: "E3" });
    expect(record.samePosition.verdict).toBe("clear");
    expect(record.samePosition.reason).toBeNull();
    expect(record.samePosition.matched).toBe(false);
  });

  it("covers every one of the ten documented reason strings -- each passes through unchanged (control: the allow-list is not accidentally missing one)", () => {
    const reasons = [
      "no-posting-identity",
      "no-company-key",
      "rows-unavailable",
      "undated-match",
      "future-or-concurrent",
      "unknown-status-match",
      "stranded-applied-row",
      "undated-company-rows",
      "future-company-rows",
      "check-threw",
    ];
    for (const reason of reasons) {
      const verdict = clearVerdict({ samePosition: { verdict: "indeterminate", reason } });
      const record = buildDupeLogRecord({ verdict, jobId: "url-x", entryPoint: "E3" });
      expect(record.samePosition.reason, `reason "${reason}" should pass through`).toBe(reason);
    }
  });

  it("covers all four verdict values and both route values (control)", () => {
    for (const verdictValue of ["hit", "clear", "indeterminate", "unavailable"]) {
      const v = clearVerdict({ samePosition: { verdict: verdictValue, reason: verdictValue === "indeterminate" ? "no-company-key" : undefined } });
      const record = buildDupeLogRecord({ verdict: v, jobId: "url-x", entryPoint: "E3" });
      expect(record.samePosition.verdict).toBe(verdictValue);
    }
    for (const route of ["url", "extra"]) {
      const v = clearVerdict({ samePosition: { verdict: "hit", match: rawEvidence(), route } });
      const record = buildDupeLogRecord({ verdict: v, jobId: "url-x", entryPoint: "E3" });
      expect(record.samePosition.route).toBe(route);
    }
  });

  it("drops an out-of-vocabulary verdict/reason/route to null instead of forwarding an unrecognized string", () => {
    const v = clearVerdict({ samePosition: { verdict: "definitely-maybe", reason: "not-a-real-reason", route: "carrier-pigeon" } });
    const record = buildDupeLogRecord({ verdict: v, jobId: "url-x", entryPoint: "E3" });
    expect(record.samePosition.verdict).toBeNull();
    expect(record.samePosition.reason).toBeNull();
    expect(record.samePosition.route).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A refusal is recorded with its reason -- rows-unavailable and check-threw
// are the two "the check did not run" capability reasons.
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- a refusal is recorded with its reason", () => {
  it("records rows-unavailable (a load in flight, or errored) on both signals", () => {
    const record = buildDupeLogRecord({ verdict: unavailableVerdict("rows-unavailable", "loading"), jobId: "url-x", entryPoint: "E1" });
    expect(record.samePosition.verdict).toBe("unavailable");
    expect(record.samePosition.reason).toBe("rows-unavailable");
    expect(record.company.verdict).toBe("unavailable");
    expect(record.company.reason).toBe("rows-unavailable");
    expect(record.diagnostics.rowsState).toBe("loading");
  });

  it("records check-threw (the call itself blew up) distinctly from rows-unavailable", () => {
    const record = buildDupeLogRecord({ verdict: unavailableVerdict("check-threw", "ready"), jobId: "url-x", entryPoint: "E1" });
    expect(record.samePosition.reason).toBe("check-threw");
    expect(record.company.reason).toBe("check-threw");
    // rowsState can be "ready" here -- the row set had loaded fine; it was
    // the CALL that threw, not the load. That is exactly why the two
    // capability reasons must not be collapsed into one boolean.
    expect(record.diagnostics.rowsState).toBe("ready");
  });

  it("an error load is recorded with rowsState \"error\", not conflated with \"loading\"", () => {
    const record = buildDupeLogRecord({ verdict: unavailableVerdict("rows-unavailable", "error"), jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.rowsState).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// A zero result must be distinguishable from a check that never ran.
// (3-plan-dupapply.md §4 A-2 -- "the highest-value fix in the chunk".)
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- clear vs unavailable are distinguishable", () => {
  it("a genuine clear (rows examined, ready, nothing qualified) and a never-ran check (unavailable, nothing examined) differ on the load-bearing fields", () => {
    const genuineClear = buildDupeLogRecord({ verdict: clearVerdict(), jobId: "url-x", entryPoint: "E1" });
    const neverRan = buildDupeLogRecord({ verdict: unavailableVerdict("rows-unavailable", "loading"), jobId: "url-x", entryPoint: "E1" });

    // The verdict itself differs...
    expect(genuineClear.samePosition.verdict).toBe("clear");
    expect(neverRan.samePosition.verdict).toBe("unavailable");

    // ...and so does the evidence the verdict is checkable against: a
    // genuine clear examined real rows; a never-ran check examined none.
    expect(genuineClear.diagnostics.rowsState).toBe("ready");
    expect(genuineClear.diagnostics.rowsExamined).toBeGreaterThan(0);
    expect(neverRan.diagnostics.rowsState).not.toBe("ready");
    expect(neverRan.diagnostics.rowsExamined).toBe(0);
  });

  it("the examined count is present and exact, for a range of values including zero", () => {
    for (const n of [0, 1, 7, 500]) {
      const record = buildDupeLogRecord({
        verdict: clearVerdict({ diagnostics: { ...clearVerdict().diagnostics, rowsExamined: n } }),
        jobId: "url-x",
        entryPoint: "E1",
      });
      expect(record.diagnostics.rowsExamined).toBe(n);
    }
  });
});

// ---------------------------------------------------------------------------
// The stage counts: examined, counted, dropped-and-why.
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- row-stage counts", () => {
  it("computes rowsDropped as the gap between examined and counted", () => {
    const verdict = clearVerdict({ diagnostics: { ...clearVerdict().diagnostics, rowsExamined: 10, rowsCounted: 3 } });
    const record = buildDupeLogRecord({ verdict, jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.rowsExamined).toBe(10);
    expect(record.diagnostics.rowsCounted).toBe(3);
    expect(record.diagnostics.rowsDropped).toBe(7);
  });

  it("rowsDropped is 0, not negative or NaN, when every examined row was counted", () => {
    const verdict = clearVerdict({ diagnostics: { ...clearVerdict().diagnostics, rowsExamined: 5, rowsCounted: 5 } });
    const record = buildDupeLogRecord({ verdict, jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.rowsDropped).toBe(0);
  });

  it("rowsDropped is null, not NaN, when either count is missing", () => {
    const verdict = clearVerdict({ diagnostics: { ...clearVerdict().diagnostics, rowsCounted: undefined } });
    const record = buildDupeLogRecord({ verdict, jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.rowsDropped).toBeNull();
    expect(Number.isNaN(record.diagnostics.rowsDropped)).toBe(false);
  });

  it("passes through windowDays, and the company signal's groups/undatableCount/futureCount, as counts -- never the evidence rows", () => {
    const verdict = hitVerdict({
      company: { verdict: "hit", count: 3, undatableCount: 1, futureCount: 2, evidence: [rawEvidence(), rawEvidence(), rawEvidence()] },
    });
    const record = buildDupeLogRecord({ verdict, jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.windowDays).toBe(30);
    expect(record.company.groups).toBe(3);
    expect(record.company.undatableCount).toBe(1);
    expect(record.company.futureCount).toBe(2);
    expect(record.company.evidenceCount).toBe(3);
    expect(record.company).not.toHaveProperty("evidence");
  });

  it("evidenceCount is 0 (not null, not missing) when the company signal is clear and carries no evidence array", () => {
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId: "url-x", entryPoint: "E1" });
    expect(record.company.evidenceCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// candidateKey / candidateCompanyKey are hashed, never carried in the clear.
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- candidate keys are hashed", () => {
  it("hashes candidateKey and candidateCompanyKey using the injected hashKey function", () => {
    const record = buildDupeLogRecord({ verdict: hitVerdict(), jobId: "url-x", entryPoint: "E1", hashKey: stubHash("H") });
    expect(record.diagnostics.candidateKeyHash).toBe("H:u:https://boards.greenhouse.io/acme/jobs/555");
    expect(record.diagnostics.candidateCompanyKeyHash).toBe("H:a:acme");
  });

  it("defaults to the real hashPostingKey when no hashKey is injected", () => {
    const record = buildDupeLogRecord({ verdict: hitVerdict(), jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.candidateKeyHash).toBe(REAL_HASH("u:https://boards.greenhouse.io/acme/jobs/555"));
  });

  it("the raw candidateKey (which for a URL-based key IS the posting URL) never appears anywhere in the record", () => {
    const record = buildDupeLogRecord({ verdict: hitVerdict(), jobId: "url-x", entryPoint: "E1" });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("boards.greenhouse.io");
    expect(serialized).not.toContain("/acme/jobs/555");
  });

  it("candidateKeyHash is null when candidateKey is null (no posting identity)", () => {
    const record = buildDupeLogRecord({ verdict: unavailableVerdict("rows-unavailable", "loading"), jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.candidateKeyHash).toBeNull();
  });

  it("candidateCompanyKeyHash is null when candidateCompanyKey is the empty string (no company key)", () => {
    const record = buildDupeLogRecord({ verdict: unavailableVerdict("rows-unavailable", "loading"), jobId: "url-x", entryPoint: "E1" });
    expect(record.diagnostics.candidateCompanyKeyHash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// jobId -- prefix only, never the tail (which for "url-" IS the posting URL).
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- jobId prefix only", () => {
  it.each([
    ["url-https://example.com/job/123", "url-"],
    ["feed-abc123", "feed-"],
    ["manual-9", "manual-"],
    ["shot-42", "shot-"],
    ["gh-55", "gh-"],
  ])("extracts the known prefix from %s", (jobId, expectedPrefix) => {
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId, entryPoint: "E1" });
    expect(record.jobIdPrefix).toBe(expectedPrefix);
  });

  it("an unrecognized jobId shape is recorded as \"other\", never a partial or guessed prefix", () => {
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId: "totally-unexpected-format-123", entryPoint: "E1" });
    expect(record.jobIdPrefix).toBe("other");
  });

  it("a missing or non-string jobId yields null, not a thrown error", () => {
    expect(buildDupeLogRecord({ verdict: clearVerdict(), jobId: undefined, entryPoint: "E1" }).jobIdPrefix).toBeNull();
    expect(buildDupeLogRecord({ verdict: clearVerdict(), jobId: 12345, entryPoint: "E1" }).jobIdPrefix).toBeNull();
  });

  it("the full jobId -- specifically the URL after \"url-\" -- never appears anywhere in the record", () => {
    const secretUrl = "https://boards.greenhouse.io/acme/jobs/999?utm_source=super-secret-campaign";
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId: `url-${secretUrl}`, entryPoint: "E1" });
    const serialized = JSON.stringify(record);
    expect(record.jobIdPrefix).toBe("url-");
    expect(serialized).not.toContain("super-secret-campaign");
    expect(serialized).not.toContain("boards.greenhouse.io");
  });
});

// ---------------------------------------------------------------------------
// entryPoint -- passed through, bounded.
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- entryPoint", () => {
  it("passes through a normal entry-point string", () => {
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId: "url-x", entryPoint: "E4" });
    expect(record.entryPoint).toBe("E4");
  });

  it("a non-string entryPoint becomes null", () => {
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId: "url-x", entryPoint: 4 });
    expect(record.entryPoint).toBeNull();
  });

  it("an oversized entryPoint (a smuggled blob, not a code) is dropped to null rather than truncated-and-kept", () => {
    const huge = "resume-text-".repeat(1000);
    const record = buildDupeLogRecord({ verdict: clearVerdict(), jobId: "url-x", entryPoint: huge });
    expect(record.entryPoint).toBeNull();
    expect(JSON.stringify(record)).not.toContain("resume-text-");
  });
});

// ---------------------------------------------------------------------------
// The negative test: no secret, token, or resume content can reach the
// record, however it is salted onto the verdict object. Paired with a
// positive control so this cannot pass by the record being empty.
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- SEC-5: no secret/token/resume/PII content reaches the record", () => {
  it("strips every planted forbidden value, from every place it could be salted onto the verdict, while still producing a genuinely populated record", () => {
    const PLANTED_SECRET_TOKEN = "sk-live-SUPER-SECRET-TOKEN-abc123";
    const PLANTED_USER_ID = "user-tenant-abc-999";
    const PLANTED_COMPANY = "Acme Corp (Confidential Employer)";
    const PLANTED_TITLE = "Staff Engineer, Secret Project";
    const PLANTED_URL = "https://boards.greenhouse.io/acme/jobs/424242?ref=confidential";
    const PLANTED_APPLIED_AT = "2024-03-14T00:00:00.000Z";
    const PLANTED_APPLICATION_ID = "application-row-id-777";
    const PLANTED_RESUME = "John Q. Applicant, SSN 123-45-6789, Objective: Senior Engineer role...";
    const PLANTED_MARKER = "__PLANTED_MARKER_SHOULD_NEVER_APPEAR__";

    const salted = {
      samePosition: {
        verdict: "hit",
        route: "url",
        // The real evidence shape (rawEvidenceFromRow), PLUS extra
        // attacker/bug-shaped fields that must not exist on a real verdict
        // but must still be neutralized if they somehow appear.
        match: {
          applicationId: PLANTED_APPLICATION_ID,
          company: PLANTED_COMPANY,
          title: PLANTED_TITLE,
          url: PLANTED_URL,
          status: "applied",
          appliedAt: PLANTED_APPLIED_AT,
          userId: PLANTED_USER_ID,
          user_id: PLANTED_USER_ID,
          sessionToken: PLANTED_SECRET_TOKEN,
          resumeText: PLANTED_RESUME,
          marker: PLANTED_MARKER,
        },
        // A reason field overwritten with secret-shaped text instead of a
        // real reason string -- must degrade to null, not pass through.
        reason: PLANTED_SECRET_TOKEN,
        extraField: PLANTED_MARKER,
      },
      company: {
        verdict: "hit",
        count: 2,
        undatableCount: 0,
        futureCount: 0,
        evidence: [
          {
            applicationId: "app-1",
            company: PLANTED_COMPANY,
            title: PLANTED_TITLE,
            url: PLANTED_URL,
            status: "applied",
            appliedAt: PLANTED_APPLIED_AT,
            secret: PLANTED_SECRET_TOKEN,
          },
          { applicationId: "app-2", company: PLANTED_COMPANY, title: "Another Title", url: PLANTED_URL, status: "applied", appliedAt: "2024-01-01" },
        ],
      },
      checkedAt: 1_750_000_000_000,
      diagnostics: {
        rowsExamined: 9,
        rowsCounted: 2,
        rowsState: "ready",
        candidateKey: PLANTED_URL, // a URL-based candidateKey IS the URL
        candidateCompanyKey: "a:acme",
        windowDays: 30,
        runStartedAt: 1_749_999_000_000,
        userId: PLANTED_USER_ID,
        user_id: PLANTED_USER_ID,
        sessionToken: PLANTED_SECRET_TOKEN,
      },
      // Top-level extra fields a bug (or an attacker who controls part of
      // the verdict construction) might add.
      userSessionToken: PLANTED_SECRET_TOKEN,
      rawResume: PLANTED_RESUME,
    };

    const record = buildDupeLogRecord({
      verdict: salted,
      jobId: `url-${PLANTED_URL}`,
      entryPoint: PLANTED_RESUME, // also try smuggling it through entryPoint
      snapshotAgeMs: 1234,
    });

    const serialized = JSON.stringify(record);

    for (const forbidden of [
      PLANTED_SECRET_TOKEN,
      PLANTED_USER_ID,
      PLANTED_COMPANY,
      PLANTED_TITLE,
      PLANTED_URL,
      PLANTED_APPLIED_AT,
      PLANTED_APPLICATION_ID,
      PLANTED_RESUME,
      PLANTED_MARKER,
      "boards.greenhouse.io", // the host inside the planted URL, in case of partial leakage
      "123-45-6789", // the SSN-shaped substring inside the planted resume text
    ]) {
      expect(serialized, `record must not contain: ${forbidden}`).not.toContain(forbidden);
    }

    // Positive control: the record is NOT empty/gutted. A mutant that
    // returns `{}` (or omits fields wholesale) would otherwise pass every
    // assertion above vacuously.
    expect(record.samePosition.verdict).toBe("hit");
    expect(record.samePosition.matched).toBe(true);
    expect(record.samePosition.reason).toBeNull(); // the salted "reason" was secret-shaped -- dropped
    expect(record.company.verdict).toBe("hit");
    expect(record.company.groups).toBe(2);
    expect(record.company.evidenceCount).toBe(2);
    expect(record.diagnostics.rowsExamined).toBe(9);
    expect(record.diagnostics.rowsCounted).toBe(2);
    expect(record.diagnostics.candidateKeyHash).toBe(REAL_HASH(PLANTED_URL));
    expect(record.jobIdPrefix).toBe("url-");
    expect(record.entryPoint).toBeNull(); // the resume text was oversized -- dropped, not truncated-and-kept
  });

  it("LOG_FORBIDDEN_FIELDS is exported and names the raw fields SEC-5 forbids (so the Wave-4 download sweep can plant exactly these)", () => {
    expect(Array.isArray(LOG_FORBIDDEN_FIELDS)).toBe(true);
    expect(LOG_FORBIDDEN_FIELDS.length).toBeGreaterThan(0);
    for (const field of ["company", "title", "url", "applied_at", "user_id", "id"]) {
      expect(LOG_FORBIDDEN_FIELDS).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// Never throws.
// ---------------------------------------------------------------------------
describe("buildDupeLogRecord -- never throws", () => {
  it("handles a completely missing/empty input without throwing", () => {
    expect(() => buildDupeLogRecord({})).not.toThrow();
    expect(() => buildDupeLogRecord(undefined)).not.toThrow();
  });

  it("handles a null verdict, or a verdict missing samePosition/company/diagnostics, without throwing", () => {
    expect(() => buildDupeLogRecord({ verdict: null, jobId: "url-x", entryPoint: "E1" })).not.toThrow();
    expect(() => buildDupeLogRecord({ verdict: {}, jobId: "url-x", entryPoint: "E1" })).not.toThrow();
    const record = buildDupeLogRecord({ verdict: {}, jobId: "url-x", entryPoint: "E1" });
    expect(record.samePosition.verdict).toBeNull();
    expect(record.company.verdict).toBeNull();
    expect(record.diagnostics.rowsExamined).toBeNull();
  });

  it("handles a hostile getter that throws when read", () => {
    const hostile = clearVerdict();
    Object.defineProperty(hostile.diagnostics, "candidateKey", {
      get() {
        throw new Error("boom");
      },
    });
    expect(() => buildDupeLogRecord({ verdict: hostile, jobId: "url-x", entryPoint: "E1" })).not.toThrow();
  });

  it("handles a hashKey function that throws", () => {
    const record = buildDupeLogRecord({
      verdict: hitVerdict(),
      jobId: "url-x",
      entryPoint: "E1",
      hashKey: () => {
        throw new Error("boom");
      },
    });
    expect(record.diagnostics.candidateKeyHash).toBeNull();
  });

  it("does not choke on a circular reference planted deep in the verdict", () => {
    const circular = { self: null };
    circular.self = circular;
    const verdict = clearVerdict({ samePosition: { verdict: "hit", match: { ...rawEvidence(), circular } } });
    expect(() => buildDupeLogRecord({ verdict, jobId: "url-x", entryPoint: "E1" })).not.toThrow();
  });
});
