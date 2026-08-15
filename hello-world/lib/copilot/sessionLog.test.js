import { describe, it, expect } from "vitest";
import {
  createSessionLog,
  renderSessionLogMarkdown,
  renderSessionLogJson,
  sessionLogFileBase,
  SESSION_LOG_SCHEMA,
  MAX_SESSION_LOG_EVENTS,
  MAX_LOG_FIELD_CHARS,
} from "./sessionLog.js";
import { fmtClock } from "./clock.js";

// AC-Q1..Q4: the pure half of "download a log of this interview session".
// Everything here runs with no DOM, no React and no network — the recorder
// takes its clock by injection so a timestamp is a value under test rather
// than whatever the machine's wall clock happened to say.
//
// The reason this module exists at all is the failure it is meant to explain:
// a live session that started, looked live, and transcribed NOTHING. So the
// zero-event log is a first-class case here (AC-Q2.5), not an edge case.

const T0 = Date.UTC(2026, 7, 15, 18, 32, 0); // 2026-08-15T18:32:00Z

// A controllable clock: each call returns T0 + the next queued offset, so a
// test states event times directly instead of sleeping.
function fakeClock(offsetsMs) {
  const queue = [...offsetsMs];
  let last = 0;
  return () => {
    last = queue.length ? queue.shift() : last;
    return T0 + last;
  };
}

function newLog(offsets = [], overrides = {}) {
  return createSessionLog({
    mode: "live",
    source: "inperson",
    provider: "deepgram",
    startedAt: T0,
    now: fakeClock(offsets),
    ...overrides,
  });
}

describe("createSessionLog — the recorder (AC-Q1)", () => {
  it("starts with the session's own metadata and no events (AC-Q1.1)", () => {
    const snap = newLog().snapshot();
    expect(snap.schema).toBe(SESSION_LOG_SCHEMA);
    expect(snap.mode).toBe("live");
    expect(snap.source).toBe("inperson");
    expect(snap.provider).toBe("deepgram");
    expect(snap.startedAt).toBe(T0);
    expect(snap.events).toEqual([]);
    expect(snap.dropped).toBe(0);
  });

  it("appends events in order, stamped with ms since the session started (AC-Q1.2)", () => {
    const log = newLog([0, 1500, 62_000]);
    log.event("session.start", { source: "inperson" });
    log.event("transcript", { speaker: "them", text: "Hello there" });
    log.event("question.added", { id: 1, question: "Why us?" });

    const { events } = log.snapshot();
    expect(events.map((e) => e.type)).toEqual([
      "session.start",
      "transcript",
      "question.added",
    ]);
    expect(events.map((e) => e.t)).toEqual([0, 1500, 62_000]);
    expect(events[1].speaker).toBe("them");
    expect(events[1].text).toBe("Hello there");
  });

  it("keeps the snapshot independent of later recording (AC-Q1.2)", () => {
    const log = newLog([0, 10]);
    log.event("transcript", { text: "first" });
    const snap = log.snapshot();
    log.event("transcript", { text: "second" });
    expect(snap.events).toHaveLength(1);
    expect(log.snapshot().events).toHaveLength(2);
  });

  it("stays bounded, dropping the OLDEST events and counting them (AC-Q1.3)", () => {
    const log = newLog();
    const total = MAX_SESSION_LOG_EVENTS + 25;
    for (let i = 0; i < total; i += 1) log.event("transcript", { n: i });

    const snap = log.snapshot();
    expect(snap.events).toHaveLength(MAX_SESSION_LOG_EVENTS);
    expect(snap.dropped).toBe(25);
    // The oldest went, the newest stayed — a long interview must keep the end
    // of the session, which is where the user stopped and noticed the problem.
    expect(snap.events[0].n).toBe(25);
    expect(snap.events[snap.events.length - 1].n).toBe(total - 1);
  });

  it("redacts a credential-shaped field, however deeply nested (AC-Q1.4)", () => {
    const log = newLog();
    log.event("stt.open", {
      url: "wss://api.deepgram.com/v1/listen",
      token: "dg-live-SECRETVALUE",
      auth: { apiKey: "sk-SECRETVALUE", Authorization: "Bearer SECRETVALUE" },
      keywords: ["kubernetes"],
    });

    const [evt] = log.snapshot().events;
    const serialized = JSON.stringify(evt);
    expect(serialized).not.toContain("SECRETVALUE");
    expect(evt.token).toBe("[redacted]");
    expect(evt.auth.apiKey).toBe("[redacted]");
    expect(evt.auth.Authorization).toBe("[redacted]");
    // Positive control: redaction must not swallow ordinary fields, and
    // "keywords" is not a credential just because it contains "key".
    expect(evt.url).toBe("wss://api.deepgram.com/v1/listen");
    expect(evt.keywords).toEqual(["kubernetes"]);
  });

  it("truncates an oversized string field and says how much it dropped (AC-Q1.5)", () => {
    const log = newLog();
    const huge = "x".repeat(MAX_LOG_FIELD_CHARS + 500);
    log.event("transcript", { text: huge, speaker: "them" });

    const [evt] = log.snapshot().events;
    expect(evt.text.length).toBeLessThan(huge.length);
    expect(evt.text.startsWith("x".repeat(100))).toBe(true);
    expect(evt.text).toContain("truncated");
    expect(evt.text).toContain("500");
    // Positive control: a normal-length string is stored verbatim.
    log.event("transcript", { text: "short one" });
    expect(log.snapshot().events[1].text).toBe("short one");
  });

  it("never throws on hostile data, and records that it could not (AC-Q1.5)", () => {
    const log = newLog();
    const circular = { name: "loop" };
    circular.self = circular;

    expect(() => log.event("weird", { circular, fn: () => {}, u: undefined })).not.toThrow();
    // Whatever it does with the value, the log must still be serializable and
    // must still hold a record that something happened at this point.
    const snap = log.snapshot();
    expect(snap.events).toHaveLength(1);
    expect(() => JSON.stringify(snap)).not.toThrow();
  });

  it("survives a missing or malformed event payload (AC-Q1.5)", () => {
    const log = newLog();
    expect(() => log.event("session.start")).not.toThrow();
    expect(() => log.event("noise", null)).not.toThrow();
    expect(() => log.event(null, { a: 1 })).not.toThrow();
    expect(() => JSON.stringify(log.snapshot())).not.toThrow();
  });
});

describe("renderSessionLogMarkdown — the readable record (AC-Q2)", () => {
  function populated() {
    const log = newLog([0, 4_000, 9_000, 12_000, 15_000, 20_000, 724_000]);
    log.event("session.start", { source: "inperson", provider: "deepgram" });
    log.event("transcript", {
      speaker: "them",
      text: "Tell me about a time a project slipped.",
      isFinal: true,
      speechFinal: true,
      speakerTag: 0,
    });
    log.event("transcript", {
      speaker: "you",
      text: "Sure, at my last role",
      isFinal: true,
      speakerTag: 1,
    });
    log.event("transcript", {
      speaker: "them",
      text: "ignore this interim",
      isFinal: false,
      speakerTag: 0,
    });
    log.event("question.added", {
      id: 7,
      question: "Tell me about a time a project slipped.",
      type: "behavioral",
    });
    log.event("answer.done", {
      id: 7,
      points: ["Situation: a stalled migration", "Result: shipped two weeks early"],
    });
    log.event("stt.close", { code: 1006, reason: "abnormal closure" });
    return log;
  }

  it("heads the document with what the session actually was (AC-Q2.1)", () => {
    const md = renderSessionLogMarkdown(populated().snapshot());
    expect(md).toMatch(/^# /m);
    expect(md).toContain("live");
    expect(md).toContain("inperson");
    expect(md).toContain("deepgram");
    // Duration runs from the session start to the last recorded event.
    expect(md).toContain(fmtClock(724_000));
  });

  it("renders each finalized turn with a clock time and a speaker (AC-Q2.2)", () => {
    const md = renderSessionLogMarkdown(populated().snapshot());
    expect(md).toContain("## Transcript");
    expect(md).toContain("[0:04]");
    expect(md).toContain("Tell me about a time a project slipped.");
    expect(md).toContain("[0:09]");
    expect(md).toContain("Sure, at my last role");
    // An interim frame is not a turn — it would double every line.
    expect(md).not.toContain("ignore this interim");
  });

  it("resolves a numeric speaker tag through the identity snapshot (AC-Q2.2)", () => {
    const snap = populated().snapshot();
    const md = renderSessionLogMarkdown(snap, {
      speakerSnapshot: { userTag: 1, confidence: "high", overridden: false, tags: [0, 1] },
    });
    const themLine = md.split("\n").find((l) => l.includes("Tell me about a time"));
    const youLine = md.split("\n").find((l) => l.includes("Sure, at my last role"));
    expect(themLine).toBeTruthy();
    expect(youLine).toBeTruthy();
    // Tag 1 is the user; tag 0 is therefore the other voice. The two turns must
    // NOT carry the same label — that is the exact defect this pins.
    expect(themLine).not.toBe(youLine);
    expect(/you/i.test(youLine)).toBe(true);
    expect(/you/i.test(themLine)).toBe(false);
  });

  it("pairs each detected question with the answer that was drafted for it (AC-Q2.3)", () => {
    const md = renderSessionLogMarkdown(populated().snapshot());
    expect(md).toContain("## Questions and drafted answers");
    expect(md).toContain("[0:15]");
    expect(md).toContain("Situation: a stalled migration");
    expect(md).toContain("Result: shipped two weeks early");
  });

  it("says so explicitly when a question was never answered (AC-Q2.3)", () => {
    const log = newLog([0, 5_000]);
    log.event("question.added", { id: 3, question: "Why this role?" });
    log.event("answer.error", { id: 3, message: "Failed to draft." });
    const md = renderSessionLogMarkdown(log.snapshot());
    expect(md).toContain("Why this role?");
    expect(md).toContain("No answer drafted");
  });

  it("lists the diagnostics that explain a session that did nothing (AC-Q2.4)", () => {
    const md = renderSessionLogMarkdown(populated().snapshot());
    expect(md).toContain("## Diagnostics");
    expect(md).toContain("stt.close");
    expect(md).toContain("1006");
    expect(md).toContain("abnormal closure");
    // The narrative sections already carried the turns; repeating all of them
    // under Diagnostics would bury the one line that matters.
    const diagnostics = md.slice(md.indexOf("## Diagnostics"));
    expect(diagnostics).not.toContain("Sure, at my last role");
  });

  it("renders a legible document for a session that transcribed NOTHING (AC-Q2.5)", () => {
    const log = newLog([0, 1_000]);
    log.event("session.start", { source: "inperson" });
    log.event("session.status", { status: "live" });
    const md = renderSessionLogMarkdown(log.snapshot());
    expect(md).toContain("## Transcript");
    expect(md).toContain("No speech was transcribed");
    expect(md).toContain("## Diagnostics");
    expect(md).toContain("session.status");
    expect(md).toContain("live");
  });

  it("never leaks a stringified object or an undefined into the document (AC-Q2.6)", () => {
    const log = newLog([0, 1_000, 2_000]);
    log.event("transcript", { speaker: "them", text: "Hi", isFinal: true });
    log.event("question.added", { id: 1, question: "Why us?" });
    log.event("stt.error", { detail: { code: 1006, nested: { a: 1 } } });
    const md = renderSessionLogMarkdown(log.snapshot());
    expect(md).not.toContain("[object Object]");
    expect(md).not.toMatch(/\bundefined\b/);
  });

  it("does not throw on a snapshot it was never given (AC-Q2.6)", () => {
    expect(() => renderSessionLogMarkdown(null)).not.toThrow();
    expect(() => renderSessionLogMarkdown({})).not.toThrow();
    expect(typeof renderSessionLogMarkdown(null)).toBe("string");
  });
});

describe("renderSessionLogJson — the diagnostic record (AC-Q3)", () => {
  it("round-trips the snapshot exactly (AC-Q3.1)", () => {
    const log = newLog([0, 2_000]);
    log.event("session.start", { source: "inperson" });
    log.event("transcript", { speaker: "them", text: "Hello", isFinal: true });
    const snap = log.snapshot();

    const json = renderSessionLogJson(snap);
    expect(typeof json).toBe("string");
    expect(JSON.parse(json)).toEqual(snap);
  });

  it("carries a schema version so an old log stays readable (AC-Q3.2)", () => {
    const parsed = JSON.parse(renderSessionLogJson(newLog().snapshot()));
    expect(parsed.schema).toBe(SESSION_LOG_SCHEMA);
    expect(typeof SESSION_LOG_SCHEMA).toBe("number");
  });

  it("does not throw on a snapshot it was never given (AC-Q3.1)", () => {
    expect(() => renderSessionLogJson(null)).not.toThrow();
    expect(() => JSON.parse(renderSessionLogJson(null))).not.toThrow();
  });
});

describe("sessionLogFileBase — the download name (AC-Q4)", () => {
  it("names the file after the mode and the session's own start time (AC-Q4.1)", () => {
    const base = sessionLogFileBase(newLog().snapshot());
    const d = new Date(T0);
    const pad = (n) => String(n).padStart(2, "0");
    const expected = `interview-log-live-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    expect(base).toBe(expected);
  });

  it("distinguishes practice from live (AC-Q4.1)", () => {
    const practice = sessionLogFileBase(newLog([], { mode: "practice" }).snapshot());
    expect(practice).toContain("practice");
    expect(practice).not.toContain("live");
  });

  it("is safe to hand to a filesystem (AC-Q4.1)", () => {
    const base = sessionLogFileBase(
      newLog([], { mode: 'live/"weird":*?<>|\\' }).snapshot(),
    );
    expect(base).not.toMatch(/[\\/:*?"<>|]/);
    expect(base.trim()).toBe(base);
    expect(base.length).toBeGreaterThan(0);
  });

  it("still produces a usable name with no snapshot at all (AC-Q4.1)", () => {
    expect(typeof sessionLogFileBase(null)).toBe("string");
    expect(sessionLogFileBase(null).length).toBeGreaterThan(0);
    expect(sessionLogFileBase(null)).not.toMatch(/[\\/:*?"<>|]/);
  });
});
