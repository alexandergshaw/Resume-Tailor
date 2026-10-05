import { describe, it, expect, vi, afterEach } from "vitest";
import { createPrepLog } from "./prepLog.js";

// The ephemeral per-tab prep-activity ledger: a pure, no-React, no-IO factory
// that backs the on-screen "N events recorded" caption and its own reset
// control. It is NOT the durable disclosure record (that is
// `interview_prep_events`, served by prepStore.js), so the properties pinned
// here are the ledger's own: what one entry looks like, how it is bounded,
// that the array a caller holds is a snapshot, that reset really empties it,
// and that recording can never break the attempt/delete flow that calls it.
//
// The module takes its clock by injection, so a timestamp is a value under
// test rather than whatever the machine's wall clock happened to say. The
// fixed time below is deliberately far from "now" so a ledger that ignored
// the injected clock and read Date.now() could not pass by coincidence.
//
// ON REDACTION, STATED HONESTLY. This module has no redaction or truncation
// step: an entry has exactly three fields (kind, outcome, at), and `outcome`
// is whatever short label the caller hands over, stored as given. The
// protection against user content reaching the ledger is therefore
// STRUCTURAL -- there is no free-form payload slot and extra arguments are
// dropped -- and that structural property is what the "carries no free-form
// payload" block pins. These tests deliberately do not assert that a long or
// sensitive `outcome` string is stored verbatim: that is a gap in the module,
// not a contract worth freezing, and a future caller wiring this up should be
// reviewed against it.

const T0 = Date.UTC(2020, 5, 15, 12, 0, 0);

// A clock that returns T0, T0 + 1, T0 + 2 ... so each entry's `at` says how
// many times the ledger consulted the clock before it was recorded.
function counterClock(start = T0) {
  let n = start;
  return () => {
    const value = n;
    n += 1;
    return value;
  };
}

function newLog(now = counterClock()) {
  return createPrepLog({ now });
}

function recordMany(log, total) {
  for (let i = 0; i < total; i += 1) log.record("attempt", String(i));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPrepLog -- a fresh ledger", () => {
  it("starts empty", () => {
    const log = newLog();
    expect(log.count()).toBe(0);
    expect(log.list()).toEqual([]);
  });

  it("offers record, reset, list and count", () => {
    const log = newLog();
    for (const method of ["record", "reset", "list", "count"]) {
      expect(typeof log[method], `${method} is missing`).toBe("function");
    }
  });

  it("works with no options at all, reading the wall clock", () => {
    const log = createPrepLog();
    const before = Date.now();
    log.record("attempt", "ok");
    const after = Date.now();
    const [entry] = log.list();
    expect(entry.at).toBeGreaterThanOrEqual(before);
    expect(entry.at).toBeLessThanOrEqual(after);
  });

  it("works with an empty options object, reading the wall clock", () => {
    const log = createPrepLog({});
    log.record("delete", "ok");
    expect(log.count()).toBe(1);
    expect(typeof log.list()[0].at).toBe("number");
  });

  it("keeps two ledgers entirely separate", () => {
    const a = newLog();
    const b = newLog();
    a.record("attempt", "ok");
    a.record("delete", "ok");
    expect(a.count()).toBe(2);
    expect(b.count()).toBe(0);
    b.record("attempt", "other");
    a.reset();
    expect(a.count()).toBe(0);
    expect(b.list()).toEqual([{ kind: "attempt", outcome: "other", at: T0 }]);
  });
});

describe("record -- one entry", () => {
  it("appends an entry of the shape {kind, outcome, at}, stamped by the injected clock", () => {
    const log = newLog();
    log.record("attempt", "ok");
    expect(log.count()).toBe(1);
    expect(log.list()).toEqual([{ kind: "attempt", outcome: "ok", at: T0 }]);
  });

  it("keeps insertion order and consults the clock exactly once per record", () => {
    const log = newLog();
    log.record("attempt", "first");
    log.record("delete", "second");
    log.record("attempt", "third");
    expect(log.list()).toEqual([
      { kind: "attempt", outcome: "first", at: T0 },
      { kind: "delete", outcome: "second", at: T0 + 1 },
      { kind: "attempt", outcome: "third", at: T0 + 2 },
    ]);
  });

  it("defaults outcome to null when it is omitted or undefined, and keeps an explicit null", () => {
    const log = newLog();
    log.record("attempt");
    log.record("attempt", undefined);
    log.record("attempt", null);
    expect(log.list().map((e) => e.outcome)).toEqual([null, null, null]);
  });

  it("keeps an empty-string outcome as given rather than turning it into null", () => {
    const log = newLog();
    log.record("attempt", "");
    expect(log.list()[0].outcome).toBe("");
  });

  it("falls back to 'unknown' only for a missing or nullish kind", () => {
    const log = newLog();
    log.record();
    log.record(null, "x");
    log.record(undefined, "x");
    expect(log.list().map((e) => e.kind)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("stringifies any other kind, and keeps an empty-string kind as given", () => {
    const log = newLog();
    log.record(7, "x");
    log.record("", "x");
    log.record("attempt", "x");
    expect(log.list().map((e) => e.kind)).toEqual(["7", "", "attempt"]);
  });

  it("does not validate kind against the database vocabulary", () => {
    // The CHECK vocabulary lives in the database, enforced through
    // prepStore.js. This ledger only echoes what it is told.
    const log = newLog();
    log.record("attempt", "ok");
    log.record("delete", "ok");
    log.record("something-the-database-would-refuse", "ok");
    expect(log.list().map((e) => e.kind)).toEqual([
      "attempt",
      "delete",
      "something-the-database-would-refuse",
    ]);
  });
});

describe("record -- never breaks the caller's own flow", () => {
  it("swallows a throwing clock, records nothing for that call, and is not wedged afterwards", () => {
    let calls = 0;
    const log = newLog(() => {
      calls += 1;
      if (calls === 1) throw new Error("clock unavailable");
      return T0;
    });

    expect(() => log.record("attempt", "lost")).not.toThrow();
    // No half-entry: an entry the clock could not stamp is not recorded.
    expect(log.count()).toBe(0);
    expect(log.list()).toEqual([]);

    log.record("delete", "kept");
    expect(log.list()).toEqual([{ kind: "delete", outcome: "kept", at: T0 }]);
  });

  it("swallows a kind that cannot be turned into a string", () => {
    const log = newLog();
    const throwingToString = {
      toString() {
        throw new Error("no string for you");
      },
    };
    const noPrototype = Object.create(null);

    expect(() => log.record(throwingToString, "x")).not.toThrow();
    expect(() => log.record(noPrototype, "x")).not.toThrow();
    expect(log.count()).toBe(0);

    log.record("attempt", "ok");
    expect(log.count()).toBe(1);
  });
});

describe("the FIFO cap -- a long-lived tab stays bounded", () => {
  // The cap is not exported, so its value is pinned here as 200: the
  // module's own comment calls it AC-shaped headroom, and changing it should
  // be a visible edit to this file rather than a silent one.
  it("holds exactly 200 entries without evicting any", () => {
    const log = newLog();
    recordMany(log, 200);
    expect(log.count()).toBe(200);
    expect(log.list()[0].outcome).toBe("0");
    expect(log.list()[199].outcome).toBe("199");
  });

  it("evicts the oldest entry, and only that one, when the 201st arrives", () => {
    const log = newLog();
    recordMany(log, 201);
    const entries = log.list();
    expect(log.count()).toBe(200);
    expect(entries).toHaveLength(200);
    expect(entries[0].outcome).toBe("1");
    expect(entries[199].outcome).toBe("200");
  });

  it("keeps the NEWEST 200, in order, after a long run", () => {
    const log = newLog();
    recordMany(log, 500);
    const entries = log.list();
    expect(log.count()).toBe(200);
    expect(entries.map((e) => e.outcome)).toEqual(
      Array.from({ length: 200 }, (_, i) => String(300 + i)),
    );
    // Each survivor keeps its own timestamp -- eviction does not restamp.
    expect(entries.map((e) => e.at)).toEqual(
      Array.from({ length: 200 }, (_, i) => T0 + 300 + i),
    );
  });

  it("reports a count that always equals the list it would return", () => {
    const log = newLog();
    for (const step of [0, 1, 50, 149, 1, 1, 100]) {
      recordMany(log, step);
      expect(log.count()).toBe(log.list().length);
    }
    log.reset();
    expect(log.count()).toBe(log.list().length);
  });
});

describe("list -- a snapshot, not the live ledger", () => {
  it("returns a fresh array on every call", () => {
    const log = newLog();
    log.record("attempt", "ok");
    expect(log.list()).not.toBe(log.list());
    expect(log.list()).toEqual(log.list());
  });

  it("cannot be used to change the ledger by mutating the returned array", () => {
    const log = newLog();
    log.record("attempt", "a");
    log.record("delete", "b");
    const snapshot = log.list();
    expect(snapshot).toHaveLength(2); // control: there was something to damage

    snapshot.push({ kind: "forged", outcome: "forged", at: 0 });
    snapshot.splice(0, 1);
    snapshot.length = 0;

    expect(log.count()).toBe(2);
    expect(log.list().map((e) => e.outcome)).toEqual(["a", "b"]);
  });

  it("is unaffected by later recording and by a later reset", () => {
    const log = newLog();
    log.record("attempt", "a");
    const snapshot = log.list();

    log.record("delete", "b");
    expect(snapshot).toHaveLength(1);
    expect(log.list()).toHaveLength(2);

    log.reset();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].outcome).toBe("a");
    expect(log.list()).toEqual([]);
  });
});

describe("reset -- the candidate-visible clear", () => {
  it("empties a populated ledger", () => {
    const log = newLog();
    recordMany(log, 3);
    expect(log.count()).toBe(3); // control: it was populated

    log.reset();
    expect(log.count()).toBe(0);
    expect(log.list()).toEqual([]);
  });

  it("empties a ledger that is sitting at the cap", () => {
    const log = newLog();
    recordMany(log, 250);
    log.reset();
    expect(log.count()).toBe(0);
    log.record("attempt", "fresh");
    expect(log.list().map((e) => e.outcome)).toEqual(["fresh"]);
  });

  it("is safe on an empty ledger, and safe to repeat", () => {
    const log = newLog();
    expect(() => log.reset()).not.toThrow();
    log.record("attempt", "ok");
    log.reset();
    expect(() => log.reset()).not.toThrow();
    expect(log.count()).toBe(0);
  });

  it("lets recording carry on afterwards, holding only post-reset entries", () => {
    const log = newLog();
    log.record("attempt", "before");
    log.reset();
    log.record("delete", "after");
    expect(log.list()).toEqual([{ kind: "delete", outcome: "after", at: T0 + 1 }]);
  });
});

describe("what the ledger carries -- no free-form payload", () => {
  // A distinctive marker that stands in for user content (a job description,
  // a resume line, an email address, a pack body). If it appears anywhere in
  // the serialized ledger, user content got in.
  const USER_CONTENT = "ZQX-USER-CONTENT-7731";

  it("gives every entry exactly the three fields kind, outcome and at", () => {
    const log = newLog();
    log.record("attempt", "ok");
    log.record("delete");
    for (const entry of log.list()) {
      expect(Object.keys(entry).sort()).toEqual(["at", "kind", "outcome"]);
    }
  });

  it("drops extra arguments, so a payload handed alongside never reaches the ledger", () => {
    const log = newLog();
    log.record(
      "attempt",
      "ok",
      { jobDescription: USER_CONTENT, resume: USER_CONTENT, email: `${USER_CONTENT}@example.com` },
      USER_CONTENT,
    );

    // Positive control: the entry WAS recorded, so an absent marker cannot be
    // the result of a ledger that silently recorded nothing.
    expect(log.list()).toEqual([{ kind: "attempt", outcome: "ok", at: T0 }]);
    expect(JSON.stringify(log.list())).not.toContain(USER_CONTENT);
  });

  it("stores kind as a string, so an object handed in as kind is not carried by reference", () => {
    const log = newLog();
    log.record({ jobDescription: USER_CONTENT }, "ok");

    const [entry] = log.list();
    expect(entry.outcome).toBe("ok"); // control: the entry was recorded
    expect(typeof entry.kind).toBe("string");
    expect(JSON.stringify(log.list())).not.toContain(USER_CONTENT);
  });

  it("never touches the network, whatever it is asked to do", () => {
    // The ledger must never read or write interview_prep_packs,
    // interview_prep_spend or interview_prep_events; a Supabase call would
    // surface as a fetch.
    const fetchSpy = vi.fn(() => {
      throw new Error("the ledger must not use the network");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const log = newLog();
    recordMany(log, 205);
    log.list();
    log.count();
    log.reset();

    expect(log.count()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("controls -- this suite is not vacuous", () => {
  it("record is observable: a no-op record would leave these at zero", () => {
    const log = newLog();
    expect(log.count()).toBe(0);
    log.record("attempt", "one");
    log.record("delete", "two");
    log.record("attempt", "three");
    expect(log.count()).toBe(3);
    expect(log.list().map((e) => `${e.kind}:${e.outcome}`)).toEqual([
      "attempt:one",
      "delete:two",
      "attempt:three",
    ]);
  });

  it("reset is observable: a no-op reset would leave the three entries in place", () => {
    const log = newLog();
    recordMany(log, 3);
    expect(log.list()).toHaveLength(3);
    log.reset();
    expect(log.list()).toHaveLength(0);
  });

  it("the injected clock is honoured: the stamp is T0, not the machine's clock", () => {
    const log = newLog();
    log.record("attempt", "ok");
    expect(log.list()[0].at).toBe(T0);
    // The fixture itself is far from the wall clock, so equal-by-coincidence
    // is impossible.
    expect(Math.abs(Date.now() - T0)).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});
