// The recorder: ordering, the cap, what the cap says it dropped, and the
// aggregation seam feature logs attach through.
//
// `now` is injected everywhere (lib/copilot/sessionLog.js's own idiom) so no
// assertion here depends on the machine clock.

import { describe, it, expect } from "vitest";
import {
  ACTIVITY_LOG_SCHEMA,
  MAX_ACTIVITY_EVENTS,
  MAX_ACTIVITY_SECTIONS,
  createActivityLog,
} from "./appActivityLog.js";
import { REDACTED } from "./activityRedaction.js";

function fixedClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

describe("createActivityLog records an action AND its outcome", () => {
  it("keeps the outcome fields, not just the fact that something was attempted", () => {
    // The mutant this pins: a recorder that logs "a fetch happened" and drops
    // the status is a log that cannot explain a failure -- the exact defect
    // every sibling log module in this repo was written against.
    const clock = fixedClock();
    const log = createActivityLog({ now: clock.now, startedAt: clock.now() });
    log.record("net", "fetch", { method: "POST", path: "/api/tailor", status: 500, ok: false, ms: 812 });
    const [entry] = log.snapshot().events;
    expect(entry.channel).toBe("net");
    expect(entry.type).toBe("fetch");
    expect(entry.status).toBe(500);
    expect(entry.ok).toBe(false);
    expect(entry.ms).toBe(812);
    expect(entry.path).toBe("/api/tailor");
  });

  it("stamps every entry with the instant and the elapsed time", () => {
    const clock = fixedClock();
    const log = createActivityLog({ now: clock.now, startedAt: clock.now() });
    clock.advance(2500);
    log.record("act", "tailor.start", {});
    const [entry] = log.snapshot().events;
    expect(entry.at).toBe(1_700_000_002_500);
    expect(entry.t).toBe(2500);
  });

  it("gives two identical events in the SAME millisecond two separate entries", () => {
    // The "two rapid events collapse into one" mutant. A log that deduplicates
    // is a re-render of current state, not a ledger: `renderDuplicateApplyLog`
    // states this property for its own feature and it must hold app-wide.
    const clock = fixedClock();
    const log = createActivityLog({ now: clock.now, startedAt: clock.now() });
    log.record("net", "fetch", { method: "GET", path: "/api/drive/status", status: 200 });
    log.record("net", "fetch", { method: "GET", path: "/api/drive/status", status: 200 });
    const { events } = log.snapshot();
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
    expect(events[0].at).toBe(events[1].at);
  });

  it("preserves the order things happened in", () => {
    const clock = fixedClock();
    const log = createActivityLog({ now: clock.now, startedAt: clock.now() });
    for (const type of ["a", "b", "c", "d"]) {
      log.record("act", type, {});
      clock.advance(1);
    }
    expect(log.snapshot().events.map((e) => e.type)).toEqual(["a", "b", "c", "d"]);
  });

  it("redacts a credential-shaped field before it is ever stored", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.record("net", "fetch", { path: "/api/x", authorization: "Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0" });
    expect(JSON.stringify(log.snapshot().events)).not.toContain("9f8e7d6c5b4a39281706f5e4d3c2b1a0");
    expect(log.snapshot().events[0].authorization).toBe(REDACTED);
  });

  it("never lets a hostile payload take the recorder down", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    const hostile = {};
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get() {
        throw new Error("nope");
      },
    });
    expect(() => log.record("act", "x", hostile)).not.toThrow();
    expect(log.snapshot().events).toHaveLength(1);
    expect(() => JSON.stringify(log.snapshot())).not.toThrow();
  });

  it("returns a snapshot that later recording cannot mutate", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.record("act", "first", {});
    const snap = log.snapshot();
    log.record("act", "second", {});
    expect(snap.events).toHaveLength(1);
  });

  it("carries the schema and the session start on the snapshot", () => {
    const log = createActivityLog({ now: () => 5, startedAt: 4 });
    const snap = log.snapshot();
    expect(snap.schema).toBe(ACTIVITY_LOG_SCHEMA);
    expect(snap.startedAt).toBe(4);
  });

  it("records when instrumentation installed, so 'before this instant' is legible", () => {
    const log = createActivityLog({ now: () => 9, startedAt: 4 });
    expect(log.snapshot().installedAt).toBe(null);
    log.markInstalled(7);
    expect(log.snapshot().installedAt).toBe(7);
    // Installing twice does not move the instant -- the FIRST install is the
    // boundary a reader needs.
    log.markInstalled(11);
    expect(log.snapshot().installedAt).toBe(7);
  });
});

describe("the cap bounds memory AND says what it dropped", () => {
  it("keeps the newest MAX_ACTIVITY_EVENTS entries", () => {
    const clock = fixedClock();
    const log = createActivityLog({ now: clock.now, startedAt: clock.now() });
    for (let i = 0; i < MAX_ACTIVITY_EVENTS + 25; i += 1) {
      log.record("act", `e${i}`, {});
      clock.advance(1);
    }
    const { events } = log.snapshot();
    expect(events).toHaveLength(MAX_ACTIVITY_EVENTS);
    expect(events[events.length - 1].type).toBe(`e${MAX_ACTIVITY_EVENTS + 24}`);
    expect(events[0].type).toBe("e25");
  });

  it("counts the drops, and counts them PER CHANNEL", () => {
    // Silent truncation in a log is self-defeating (lib/experience/pageContext.js
    // shipped exactly that). A bare total is nearly as bad: "500 events gone"
    // does not tell a reader whether they lost their own actions or 500 status
    // polls, so the breakdown is what makes the gap actionable.
    const clock = fixedClock();
    const log = createActivityLog({ now: clock.now, startedAt: clock.now() });
    for (let i = 0; i < 30; i += 1) {
      log.record("act", `user${i}`, {});
      clock.advance(1);
    }
    for (let i = 0; i < MAX_ACTIVITY_EVENTS; i += 1) {
      log.record("net", "fetch", {});
      clock.advance(1);
    }
    const snap = log.snapshot();
    expect(snap.dropped).toBe(30);
    expect(snap.droppedByChannel).toEqual({ act: 30 });
  });

  it("names the time window the dropped entries covered", () => {
    const clock = fixedClock();
    const log = createActivityLog({ now: clock.now, startedAt: clock.now() });
    for (let i = 0; i < MAX_ACTIVITY_EVENTS + 3; i += 1) {
      log.record("act", `e${i}`, {});
      clock.advance(1000);
    }
    const snap = log.snapshot();
    expect(snap.dropped).toBe(3);
    expect(snap.droppedFrom).toBe(1_700_000_000_000);
    expect(snap.droppedTo).toBe(1_700_000_002_000);
  });

  it("reports nothing dropped when nothing was", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.record("act", "x", {});
    const snap = log.snapshot();
    expect(snap.dropped).toBe(0);
    expect(snap.droppedByChannel).toEqual({});
    expect(snap.droppedFrom).toBe(null);
    expect(snap.droppedTo).toBe(null);
  });

  it("bounds a single field so one pasted job description cannot eat the tab", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.record("act", "paste", { text: "x".repeat(50_000) });
    const stored = log.snapshot().events[0].text;
    expect(stored.length).toBeLessThan(5000);
    expect(stored).toContain("truncated");
  });
});

describe("aggregation: a feature log attaches, it is not re-implemented", () => {
  it("renders an attached section at snapshot time, not at attach time", () => {
    // The property that makes attachment usable from a hook: the closure reads
    // the feature's own refs when the user clicks download, so the section can
    // never be a stale copy of what the feature held at mount.
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    let ledger = "empty";
    log.attachSection("dupe", { title: "Duplicate-application checks", render: () => ledger });
    ledger = "two checks, one dismissal";
    const [section] = log.snapshot().sections;
    expect(section.id).toBe("dupe");
    expect(section.title).toBe("Duplicate-application checks");
    expect(section.markdown).toBe("two checks, one dismissal");
  });

  it("detaches on unmount so a remounted feature does not appear twice", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    const detach = log.attachSection("dupe", { title: "D", render: () => "x" });
    expect(log.snapshot().sections).toHaveLength(1);
    detach();
    expect(log.snapshot().sections).toHaveLength(0);
  });

  it("replaces a section attached twice under the same id", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.attachSection("dupe", { title: "D", render: () => "first" });
    log.attachSection("dupe", { title: "D", render: () => "second" });
    const { sections } = log.snapshot();
    expect(sections).toHaveLength(1);
    expect(sections[0].markdown).toBe("second");
  });

  it("turns a throwing section into a stated failure, never a lost download", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.attachSection("boom", {
      title: "Broken feature",
      render: () => {
        throw new Error("feature exploded");
      },
    });
    const [section] = log.snapshot().sections;
    expect(section.markdown).toContain("could not be rendered");
    // The failure message must not smuggle the thrown text into the file.
    expect(section.markdown).not.toContain("feature exploded");
  });

  it("redacts a secret a feature section tries to render", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.attachSection("leaky", { title: "L", render: () => "token AIzaSyD-1234567890abcdefghijklmnopqrstuvw here" });
    expect(log.snapshot().sections[0].markdown).not.toContain("AIzaSyD-1234567890abcdefghijklmnopqrstuvw");
  });

  it("caps the number of attached sections", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    for (let i = 0; i < MAX_ACTIVITY_SECTIONS + 5; i += 1) {
      log.attachSection(`s${i}`, { title: `S${i}`, render: () => "x" });
    }
    expect(log.snapshot().sections.length).toBeLessThanOrEqual(MAX_ACTIVITY_SECTIONS);
  });
});
