import { describe, it, expect } from "vitest";

import { buildDupeLogRecord, LOG_FORBIDDEN_FIELDS } from "@/lib/duplicateApply/duplicateApplyLog.js";
import {
  DUPE_LOG_SCHEMA,
  MAX_DUPE_LOG_ENTRIES,
  renderDuplicateApplyLog,
  duplicateApplyLogFileName,
} from "@/lib/duplicateApply/duplicateApplyLogDocument.js";

// ---------------------------------------------------------------------------
// THE "WAVE-4 DOWNLOAD SWEEP" duplicateApplyLog.js's own header names by this
// exact filename ("the Wave-4 download sweep (duplicateApplyLog.download.test.js)
// plants and searches for exactly these values"). It covers the half of this
// feature jsdom structurally cannot: what the downloaded FILE says and what it
// is CALLED. jsdom has no download implementation at all -- a click cannot be
// proven to produce a file -- so the document and its name are tested here as
// PURE FUNCTIONS, and the control that invokes them is tested separately for
// presence and wiring (app/components/StatusBar.dupeLog.test.js) and for
// accumulation (app/hooks/useDuplicateApplyCheck.log.test.js). Neither half is
// a substitute for the other and this file claims only its own.
//
// STANDING BIAS, inherited verbatim from duplicateApplyLog.test.js: the log has
// a clearly visible download button, so it is a DISCLOSURE SURFACE. Every test
// below that plants a secret is proving a NEGATIVE (the secret never reaches
// the file) and is paired with a positive control proving the document is not
// simply empty -- a renderer gutted to `return ""` would otherwise pass every
// negative assertion vacuously, and "the button downloads an empty file" is a
// named failure this file exists to catch.
// ---------------------------------------------------------------------------

const T0 = 1_750_000_000_000; // 2025-06-15T15:06:40.000Z

function rawEvidence(overrides = {}) {
  return {
    applicationId: "app-999",
    company: "Acme Corp",
    title: "Staff Engineer",
    url: "https://boards.greenhouse.io/acme/jobs/555",
    appliedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function hitVerdict(overrides = {}) {
  return {
    samePosition: { verdict: "hit", reason: "undated-match", match: rawEvidence(), route: "url" },
    company: {
      verdict: "indeterminate",
      reason: "undated-company-rows",
      count: 3,
      undatableCount: 2,
      futureCount: 1,
      evidence: [rawEvidence(), rawEvidence({ applicationId: "app-1000" })],
    },
    checkedAt: T0,
    diagnostics: {
      rowsExamined: 12,
      rowsCounted: 1,
      rowsState: "ready",
      candidateKey: "u:https://boards.greenhouse.io/acme/jobs/555",
      candidateCompanyKey: "a:acme",
      windowDays: 30,
      runStartedAt: T0 - 1000,
    },
    ...overrides,
  };
}

function clearVerdict(overrides = {}) {
  return {
    samePosition: { verdict: "clear" },
    company: { verdict: "clear", count: 0, undatableCount: 0, futureCount: 0 },
    checkedAt: T0,
    diagnostics: {
      rowsExamined: 40,
      rowsCounted: 0,
      rowsState: "ready",
      candidateKey: "u:https://example.com/jobs/1",
      candidateCompanyKey: "a:beta-widgets",
      windowDays: 30,
      runStartedAt: T0 - 1000,
    },
    ...overrides,
  };
}

function unavailableVerdict(reason, rowsState) {
  const unavailable = { verdict: "unavailable", reason };
  return {
    samePosition: unavailable,
    company: unavailable,
    checkedAt: T0,
    diagnostics: {
      rowsExamined: 0,
      rowsCounted: 0,
      rowsState,
      candidateKey: null,
      candidateCompanyKey: "",
      windowDays: 30,
      runStartedAt: T0,
    },
  };
}

// One accumulated ledger entry, exactly the shape the hook stores: a
// `buildDupeLogRecord` output, the KIND of thing that happened, and the wall
// clock the HOOK stamped (never one the pure modules read for themselves --
// duplicateApplyLog.js's C-19 posture, which this module inherits).
function entry(kind, verdict, { jobId = "url-https://example.com/jobs/1", entryPoint = "E3", at = T0, snapshotAgeMs } = {}) {
  return { kind, at, record: buildDupeLogRecord({ verdict, jobId, entryPoint, snapshotAgeMs }) };
}

const doc = (entries, opts = {}) => renderDuplicateApplyLog({ entries, startedAt: T0, ...opts });

// ---------------------------------------------------------------------------
// The document exists at all, and says which schema wrote it.
// ---------------------------------------------------------------------------
describe("renderDuplicateApplyLog -- the document is real, not a stub", () => {
  it("[positive control] a single recorded check produces a substantial document, not an empty string", () => {
    const out = doc([entry("check", hitVerdict())]);
    expect(typeof out).toBe("string");
    // The named failure "the button renders but downloads an empty file".
    expect(out.length).toBeGreaterThan(200);
    expect(out.split("\n").length).toBeGreaterThan(8);
  });

  it("names its schema, so a later format change is diagnosable from the file itself", () => {
    expect(DUPE_LOG_SCHEMA).toBe(1);
    expect(doc([entry("check", hitVerdict())])).toContain(`Schema: ${DUPE_LOG_SCHEMA}`);
  });

  it("states how many entries it holds, and that count matches what was passed", () => {
    const out = doc([entry("check", hitVerdict()), entry("check", clearVerdict()), entry("dismiss", hitVerdict())]);
    expect(out).toMatch(/Entries recorded: 3/);
    expect(out).toMatch(/Checks: 2/);
    expect(out).toMatch(/Dismissals: 1/);
  });

  it("reports the session start it was given, as an unambiguous UTC instant", () => {
    expect(doc([entry("check", clearVerdict())])).toContain(new Date(T0).toISOString());
  });
});

// ---------------------------------------------------------------------------
// THE EVIDENCE, NOT JUST THE VERDICT. The named mutant is a log that records
// `hit` and nothing about WHY -- which is precisely the log duplicateApplyLog.js's
// header says cannot explain a failure.
// ---------------------------------------------------------------------------
describe("renderDuplicateApplyLog -- records the evidence that produced the verdict, not only the verdict", () => {
  const out = doc([entry("check", hitVerdict(), { entryPoint: "E3", snapshotAgeMs: 4321 })]);

  it("records both signals' verdicts", () => {
    expect(out).toMatch(/Same-position:\s*hit\b/);
    expect(out).toMatch(/Company:\s*indeterminate\b/);
  });

  it("records each signal's REASON -- the field that answers 'why'", () => {
    expect(out).toContain("undated-match");
    expect(out).toContain("undated-company-rows");
  });

  it("records the same-position route and whether a row actually matched", () => {
    expect(out).toMatch(/route\s*url/);
    expect(out).toMatch(/matched\s*yes/);
  });

  it("records the company signal's counts -- groups, undatable, future and evidence size", () => {
    expect(out).toMatch(/groups\s*3/);
    expect(out).toMatch(/undatable\s*2/);
    expect(out).toMatch(/future\s*1/);
    expect(out).toMatch(/evidence\s*2/);
  });

  it("records the row-stage counts, including the DROPPED gap between examined and counted", () => {
    expect(out).toMatch(/examined\s*12/);
    expect(out).toMatch(/counted\s*1/);
    expect(out).toMatch(/dropped\s*11/);
  });

  it("records the rows state and the comparison window", () => {
    expect(out).toMatch(/state\s*ready/);
    expect(out).toMatch(/window\s*30/);
  });

  it("records the entry point and the snapshot age it was given", () => {
    expect(out).toContain("E3");
    expect(out).toContain("4321");
  });

  it("records the HASHED candidate keys (support triage needs a repeat pattern to be visible)", () => {
    const record = buildDupeLogRecord({ verdict: hitVerdict(), jobId: "url-x", entryPoint: "E3" });
    expect(record.diagnostics.candidateKeyHash).toMatch(/^[0-9a-f]{8}$/);
    expect(out).toContain(record.diagnostics.candidateKeyHash);
    expect(out).toContain(record.diagnostics.candidateCompanyKeyHash);
  });

  it("[mutation guard] a record stripped of its reasons and counts produces a VISIBLY different document -- so the assertions above are not satisfied by boilerplate", () => {
    const full = doc([entry("check", hitVerdict())]);
    const gutted = doc([
      {
        kind: "check",
        at: T0,
        record: { entryPoint: "E3", jobIdPrefix: "url-", samePosition: { verdict: "hit" }, company: {}, diagnostics: {} },
      },
    ]);
    expect(gutted).not.toContain("undated-match");
    expect(gutted).not.toMatch(/examined\s*12/);
    expect(full).not.toBe(gutted);
  });
});

// ---------------------------------------------------------------------------
// The three states S-10i renders identically on screen must be DISTINGUISHABLE
// in the file -- the reason duplicateApplyLog.js exists at all.
// ---------------------------------------------------------------------------
describe("renderDuplicateApplyLog -- the silent states stay distinguishable", () => {
  it("a genuine clear (rows examined, none qualified) is not the same text as a check that never ran", () => {
    const genuine = doc([entry("check", clearVerdict())]);
    const neverRan = doc([entry("check", unavailableVerdict("rows-unavailable", "loading"))]);
    expect(genuine).not.toBe(neverRan);
    expect(genuine).toMatch(/state\s*ready/);
    expect(genuine).toMatch(/examined\s*40/);
    expect(neverRan).toMatch(/state\s*loading/);
    expect(neverRan).toContain("rows-unavailable");
  });

  it("a check that threw is distinguishable from a load that had not finished", () => {
    const threw = doc([entry("check", unavailableVerdict("check-threw", "error"))]);
    const loading = doc([entry("check", unavailableVerdict("rows-unavailable", "loading"))]);
    expect(threw).toContain("check-threw");
    expect(threw).toMatch(/state\s*error/);
    expect(loading).not.toContain("check-threw");
  });

  it("an empty ledger says so explicitly rather than rendering a blank file", () => {
    const out = doc([]);
    expect(out.length).toBeGreaterThan(80);
    expect(out).toMatch(/Entries recorded: 0/);
    expect(out).toMatch(/no duplicate-application check/i);
  });
});

// ---------------------------------------------------------------------------
// A DISMISSAL IS A DECISION AND IS RECORDED AS ONE. The named mutant is a log
// rebuilt from current state at download time, in which a dismissed verdict has
// simply vanished.
// ---------------------------------------------------------------------------
describe("renderDuplicateApplyLog -- dismissals", () => {
  it("renders a dismissal as its own kind, distinct from a check", () => {
    const out = doc([entry("check", hitVerdict()), entry("dismiss", hitVerdict())]);
    expect(out).toMatch(/\bdismiss\b/);
    expect(out).toMatch(/\bcheck\b/);
    expect(out).toMatch(/Dismissals: 1/);
  });

  it("a dismissal still carries WHAT was dismissed -- its verdict and reason, not a bare 'dismissed' line", () => {
    const out = doc([entry("dismiss", hitVerdict())]);
    expect(out).toMatch(/Same-position:\s*hit\b/);
    expect(out).toContain("undated-match");
  });

  it("entries render in the order given -- a later dismissal never reorders or replaces the check before it", () => {
    const out = doc([entry("check", clearVerdict()), entry("check", hitVerdict()), entry("dismiss", hitVerdict())]);
    const first = out.indexOf("clear");
    const dismissAt = out.lastIndexOf("dismiss");
    expect(first).toBeGreaterThan(-1);
    expect(dismissAt).toBeGreaterThan(first);
    // Three entries in, three entries out: nothing is collapsed or deduplicated.
    expect(out.match(/^### \d+\./gm)).toHaveLength(3);
  });

  it("two byte-identical checks are TWO entries, never collapsed into one", () => {
    const out = doc([entry("check", hitVerdict()), entry("check", hitVerdict())]);
    expect(out.match(/^### \d+\./gm)).toHaveLength(2);
    expect(out).toMatch(/Entries recorded: 2/);
  });
});

// ---------------------------------------------------------------------------
// SEC-5: the plant-and-search sweep the shipped header asks for BY NAME.
// ---------------------------------------------------------------------------
describe("renderDuplicateApplyLog -- SEC-5: no forbidden raw field reaches the downloadable file", () => {
  const SENTINEL = "ZZTOPSECRETZZ";

  // "company" is BOTH a forbidden raw field name and the name of a real signal
  // object on the verdict, so planting it at the top level would replace the
  // company signal with a string rather than salt it -- testing the
  // "company is not an object" path instead of the disclosure path this block
  // is about. It is planted on every sub-object as usual, and the top-level
  // string case gets its own dedicated test below.
  const TOP_LEVEL_PLANTED = LOG_FORBIDDEN_FIELDS.filter((field) => field !== "company");

  function saltedVerdict() {
    const salted = hitVerdict();
    // Every field on LOG_FORBIDDEN_FIELDS, planted at every level a verdict
    // object has, plus the free-text-shaped enums an attacker would aim at.
    for (const field of LOG_FORBIDDEN_FIELDS) {
      salted.samePosition[field] = `${SENTINEL}-${field}`;
      salted.company[field] = `${SENTINEL}-${field}`;
      salted.diagnostics[field] = `${SENTINEL}-${field}`;
    }
    for (const field of TOP_LEVEL_PLANTED) {
      salted[field] = `${SENTINEL}-${field}`;
    }
    salted.samePosition.reason = `${SENTINEL}-reason`;
    salted.samePosition.route = `${SENTINEL}-route`;
    salted.company.verdict = `${SENTINEL}-verdict`;
    salted.diagnostics.rowsState = `${SENTINEL}-rowsstate`;
    return salted;
  }

  it("[positive control] the salted verdict really does carry every forbidden field, so the sweep below is not searching an empty haystack", () => {
    const salted = saltedVerdict();
    for (const field of TOP_LEVEL_PLANTED) {
      expect(String(salted[field])).toContain(SENTINEL);
    }
    for (const field of LOG_FORBIDDEN_FIELDS) {
      expect(String(salted.samePosition[field])).toContain(SENTINEL);
      expect(String(salted.company[field])).toContain(SENTINEL);
      expect(String(salted.diagnostics[field])).toContain(SENTINEL);
    }
    expect(JSON.stringify(salted)).toContain(SENTINEL);
  });

  it("a verdict whose whole `company` signal has been replaced by secret-shaped text discloses nothing and still renders", () => {
    const salted = hitVerdict();
    salted.company = `${SENTINEL}-company`;
    const out = doc([entry("check", salted)]);
    expect(out).not.toContain(SENTINEL);
    expect(out).toMatch(/Entries recorded: 1/);
    expect(out).toContain("undated-match"); // the other signal still reports
  });

  it("no planted sentinel survives into the rendered document", () => {
    const out = doc([entry("check", saltedVerdict()), entry("dismiss", saltedVerdict())]);
    expect(out).not.toContain(SENTINEL);
  });

  it("[positive control] that same document is still a real record, not an empty string that trivially contains no sentinel", () => {
    const out = doc([entry("check", saltedVerdict())]);
    expect(out.length).toBeGreaterThan(200);
    expect(out).toMatch(/Entries recorded: 1/);
    expect(out).toMatch(/examined\s*12/);
  });

  it("the raw posting URL, company name, title and applied_at from the matched row never appear", () => {
    const out = doc([entry("check", hitVerdict(), { jobId: "url-https://boards.greenhouse.io/acme/jobs/555" })]);
    expect(out).not.toContain("boards.greenhouse.io");
    expect(out).not.toContain("Acme Corp");
    expect(out).not.toContain("Staff Engineer");
    expect(out).not.toContain("2026-01-01T00:00:00.000Z");
    expect(out).not.toContain("app-999");
  });

  it("only the jobId's TYPE PREFIX survives -- never the tail, which IS the posting URL", () => {
    const secret = "https://secret.example.com/private-posting-42";
    const out = doc([entry("check", clearVerdict(), { jobId: `url-${secret}` })]);
    expect(out).not.toContain(secret);
    expect(out).not.toContain("secret.example.com");
    expect(out).toContain("url-");
  });

  // -------------------------------------------------------------------------
  // THE RENDERER'S OWN DEFENSE, exercised on its own. Every test above reaches
  // this module THROUGH buildDupeLogRecord, which has already refused anything
  // outside its closed vocabularies -- so they prove defense #1 and say nothing
  // about defense #2. These hand-build a record that never went through the
  // builder, which is exactly what a future caller that forgets it would
  // produce, and what makes "two independent defenses" a claim rather than a
  // sentence in a header.
  // -------------------------------------------------------------------------
  const FREE_TEXT_LEAKS = [
    "Acme Corp Holdings", // a company name: spaces
    "https://secret.example.com/private-posting-42", // a posting URL: scheme and slashes
    "2026-01-01T00:00:00.000Z", // an applied_at: colons
    "Staff Engineer, Platform", // a job title: comma and spaces
  ];

  function bypassRecord() {
    const [company, url, appliedAt, title] = FREE_TEXT_LEAKS;
    return {
      entryPoint: title,
      jobIdPrefix: url,
      checkedAt: T0,
      snapshotAgeMs: 1,
      samePosition: { verdict: company, reason: url, route: appliedAt, matched: true },
      company: { verdict: appliedAt, reason: company, groups: 1, undatableCount: 0, futureCount: 0, evidenceCount: 0 },
      diagnostics: {
        rowsExamined: 1,
        rowsCounted: 0,
        rowsDropped: 1,
        rowsState: title,
        windowDays: 30,
        candidateKeyHash: url,
        candidateCompanyKeyHash: company,
      },
      // Unknown keys of exactly the kind a record gains when someone adds a
      // field upstream and forgets this file exists. A renderer that spreads or
      // stringifies the record carries every one of them into the download.
      rawCompany: company,
      rawUrl: url,
      applied_at: appliedAt,
      user_id: "user-abcdef",
    };
  }

  it("a record that BYPASSED buildDupeLogRecord still discloses none of its free-text fields", () => {
    const out = renderDuplicateApplyLog({ entries: [{ kind: "check", at: T0, record: bypassRecord() }], startedAt: T0 });
    for (const leak of FREE_TEXT_LEAKS) {
      expect(out).not.toContain(leak);
    }
    expect(out).not.toContain("user-abcdef");
  });

  it("an unknown extra key on a record has no path into the file at all -- every field is read by name", () => {
    const record = bypassRecord();
    record.somethingNobodyAnticipated = "Acme Corp Holdings internal note";
    const out = renderDuplicateApplyLog({ entries: [{ kind: "check", at: T0, record }], startedAt: T0 });
    expect(out).not.toContain("somethingNobodyAnticipated");
    expect(out).not.toContain("internal note");
  });

  it("[positive control] that bypassed record still renders as a real entry -- the fields degrade, the file does not disappear", () => {
    const out = renderDuplicateApplyLog({ entries: [{ kind: "check", at: T0, record: bypassRecord() }], startedAt: T0 });
    expect(out).toMatch(/Entries recorded: 1/);
    expect(out).toMatch(/^### 1\. check/m);
    // The numeric fields, which carry no free text, survive intact.
    expect(out).toMatch(/window\s*30/);
    expect(out).toMatch(/examined\s*1/);
  });

  it("the candidate keys appear ONLY as digests -- never the plaintext key they were computed from", () => {
    const out = doc([entry("check", hitVerdict())]);
    expect(out).not.toContain("u:https://boards.greenhouse.io/acme/jobs/555");
    expect(out).not.toContain("a:acme");
    expect(out).toMatch(/[0-9a-f]{8}/);
  });
});

// ---------------------------------------------------------------------------
// Never throws. The file is the artifact a user reaches for when everything
// else has already failed.
// ---------------------------------------------------------------------------
describe("renderDuplicateApplyLog -- never throws", () => {
  it("survives no arguments, a null bag, and a non-array entries field", () => {
    expect(() => renderDuplicateApplyLog()).not.toThrow();
    expect(() => renderDuplicateApplyLog(null)).not.toThrow();
    expect(() => renderDuplicateApplyLog({ entries: "nope" })).not.toThrow();
    expect(typeof renderDuplicateApplyLog()).toBe("string");
    expect(renderDuplicateApplyLog().length).toBeGreaterThan(0);
    // DEGRADES TO AN HONEST EMPTY LOG, not to the "could not be rendered"
    // fallback: a caller whose own state was not ready yet is not an error, and
    // a reader must be able to tell "nothing was recorded" from "this file
    // broke". Only an actual throw inside the builder earns the fallback.
    for (const bag of [undefined, null, { entries: "nope" }]) {
      expect(renderDuplicateApplyLog(bag)).toMatch(/Entries recorded: 0/);
      expect(renderDuplicateApplyLog(bag)).not.toMatch(/could not be rendered/);
    }
  });

  it("survives null, undefined and primitive entries mixed into a real ledger", () => {
    const entries = [null, undefined, 42, "x", entry("check", hitVerdict()), { kind: "check" }];
    let out;
    expect(() => {
      out = renderDuplicateApplyLog({ entries, startedAt: T0 });
    }).not.toThrow();
    // The one real entry still renders -- a malformed neighbour costs its own
    // line, never the whole file.
    expect(out).toContain("undated-match");
    // ...and the primitives are DISCARDED rather than rendered as phantom
    // entries: only the two object-shaped elements are counted, so the file
    // never overstates how many checks actually happened.
    expect(out).toMatch(/Entries recorded: 2/);
    expect(out.match(/^### \d+\./gm)).toHaveLength(2);
  });

  it("survives a hostile entry whose getters throw on read", () => {
    const hostile = {
      kind: "check",
      at: T0,
      get record() {
        throw new Error("nope");
      },
    };
    expect(() => renderDuplicateApplyLog({ entries: [hostile], startedAt: T0 })).not.toThrow();
  });

  it("survives a non-finite startedAt and still produces a document", () => {
    for (const bad of [undefined, null, NaN, Infinity, "yesterday", {}]) {
      const out = renderDuplicateApplyLog({ entries: [entry("check", clearVerdict())], startedAt: bad });
      expect(typeof out).toBe("string");
      expect(out).toMatch(/Entries recorded: 1/);
    }
  });

  it("reports how many entries the FIFO cap dropped, so a truncated ledger says so", () => {
    const out = renderDuplicateApplyLog({ entries: [entry("check", clearVerdict())], startedAt: T0, dropped: 7 });
    expect(out).toMatch(/dropped 7/i);
    expect(MAX_DUPE_LOG_ENTRIES).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE FILENAME. jsdom cannot prove a click saves a file, so the name that
// click WOULD use is pinned here, as a pure function of the session start.
// ---------------------------------------------------------------------------
describe("duplicateApplyLogFileName", () => {
  it("is derived from the session's own start instant, in UTC, to the minute", () => {
    // T0 = 2025-06-15T15:06:40.000Z. UTC deliberately, not the machine's local
    // zone: this file is a support artifact that crosses timezones, and a local
    // stamp would also make this very assertion depend on where it is run.
    expect(duplicateApplyLogFileName({ startedAt: T0 })).toBe("duplicate-check-log-2025-06-15-1506.md");
  });

  it("is STABLE -- re-downloading the same session produces the same name (never the clock at download time)", () => {
    const a = duplicateApplyLogFileName({ startedAt: T0 });
    const b = duplicateApplyLogFileName({ startedAt: T0 });
    expect(a).toBe(b);
  });

  it("a different session start produces a different name", () => {
    expect(duplicateApplyLogFileName({ startedAt: T0 })).not.toBe(
      duplicateApplyLogFileName({ startedAt: T0 + 60 * 60 * 1000 }),
    );
  });

  it("ends in .md and contains no character that is illegal in a file name", () => {
    const name = duplicateApplyLogFileName({ startedAt: T0 });
    expect(name.endsWith(".md")).toBe(true);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("falls back to a named, still-legal file name when the start instant is missing or nonsense -- never 'NaN' or 'Invalid Date'", () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, "yesterday", {}]) {
      const name = duplicateApplyLogFileName({ startedAt: bad });
      expect(name.endsWith(".md")).toBe(true);
      expect(name).not.toMatch(/NaN|Invalid/i);
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
      expect(name.length).toBeGreaterThan(4);
      // Pinned exactly, not merely "legal-looking": a name built by slicing an
      // unusable stamp ("duplicate-check-log-unknown-.md") also has no illegal
      // character and also ends in .md, so a shape-only assertion cannot tell a
      // deliberate fallback from a half-formatted accident.
      expect(name).toBe("duplicate-check-log-unknown-start.md");
    }
    expect(() => duplicateApplyLogFileName()).not.toThrow();
    expect(duplicateApplyLogFileName()).toBe("duplicate-check-log-unknown-start.md");
  });

  it("never carries a posting URL, a company or any other caller-supplied text -- the name is a disclosure surface too", () => {
    // Unlike lib/copilot/sessionLog.js's `sessionLogFileBase`, which interpolates
    // a `mode` string, this name is built ONLY from a timestamp. A file name is
    // visible in a download shelf, a shared folder and a support ticket's
    // attachment list, so there is nothing here to scrub in the first place.
    const name = duplicateApplyLogFileName({ startedAt: T0, jobId: "url-https://secret.example.com/x", company: "Acme" });
    expect(name).not.toContain("secret.example.com");
    expect(name).not.toContain("Acme");
    expect(name).toBe("duplicate-check-log-2025-06-15-1506.md");
  });
});
