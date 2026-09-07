// THE FILE ITSELF: what a downloaded activity log actually says.
//
// jsdom cannot download, so this suite covers the CONTENT and the FILE NAME as
// pure functions of a snapshot. The other half -- that a control exists, is
// reachable in the settings menu, and is wired to exactly this pair -- is
// app/components/ActivityLogButton.test.js.

import { describe, it, expect } from "vitest";
import { renderActivityLog, activityLogFileName } from "./activityLogDocument.js";
import { createActivityLog, MAX_ACTIVITY_EVENTS } from "./appActivityLog.js";
import { CAPTURED_CHANNELS, UNCAPTURED_SURFACES, FEATURE_LOG_LEDGER } from "./activityChannels.js";
import { PLANTED_SECRETS } from "../../test/helpers/plantedSecrets.js";

function logAt(start = 1_700_000_000_000) {
  let t = start;
  const log = createActivityLog({ now: () => t, startedAt: start });
  return {
    log,
    advance(ms) {
      t += ms;
    },
    md() {
      return renderActivityLog(log.snapshot());
    },
  };
}

describe("the document states its own scope, both halves", () => {
  it("names every captured channel, in the file", () => {
    const md = renderActivityLog(logAt().log.snapshot());
    expect(CAPTURED_CHANNELS.length).toBeGreaterThanOrEqual(4);
    for (const channel of CAPTURED_CHANNELS) {
      expect(md, `the file never says it captures ${channel.id}`).toContain(channel.label);
      expect(md).toContain(channel.what);
    }
  });

  it("names every surface it does NOT capture, with the reason", () => {
    // "A log that says 'everything' and quietly misses whole subsystems is
    // worse than one that states its scope honestly." A reader must be able to
    // tell "nothing happened" from "this subsystem does not report".
    const md = renderActivityLog(logAt().log.snapshot());
    expect(UNCAPTURED_SURFACES.length).toBeGreaterThanOrEqual(5);
    for (const gap of UNCAPTURED_SURFACES) {
      expect(md, `the file hides the gap ${gap.id}`).toContain(gap.what);
      expect(md).toContain(gap.why);
    }
  });

  it("says which feature logs are folded in and which are not", () => {
    const md = renderActivityLog(logAt().log.snapshot());
    for (const entry of FEATURE_LOG_LEDGER) {
      expect(md, `the feature-log ledger entry ${entry.module} is missing from the file`).toContain(entry.label);
    }
    for (const entry of FEATURE_LOG_LEDGER.filter((e) => !e.attached)) {
      expect(md).toContain(entry.why);
    }
  });

  it("never claims to contain everything", () => {
    const md = renderActivityLog(logAt().log.snapshot());
    expect(md.toLowerCase()).not.toMatch(/contains everything|every single thing|complete record of everything/);
  });
});

describe("an empty log is a report, not a degenerate case", () => {
  it("distinguishes 'nothing happened' from 'the recorder never started'", () => {
    const notInstalled = renderActivityLog(logAt().log.snapshot());
    expect(notInstalled).toContain("never installed");

    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    const installed = h.md();
    expect(installed).not.toContain("never installed");
    expect(installed).toContain("No activity has been recorded");
  });

  it("still renders the scope statement when there are no events", () => {
    const md = renderActivityLog(logAt().log.snapshot());
    expect(md).toContain("What this file does NOT contain");
    expect(md.length).toBeGreaterThan(500);
  });

  it("never throws, whatever it is handed", () => {
    expect(() => renderActivityLog(null)).not.toThrow();
    expect(() => renderActivityLog(undefined)).not.toThrow();
    expect(() => renderActivityLog("not a snapshot")).not.toThrow();
    expect(renderActivityLog(null)).toContain("Activity log");
  });
});

describe("events are rendered as a ledger", () => {
  it("writes one line per event, in order, with its outcome", () => {
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    h.log.record("net", "fetch", { method: "POST", path: "/api/tailor", status: 500, ok: false, ms: 812 });
    h.advance(50);
    h.log.record("act", "tailor.finished", { engine: "gemini", ok: true });
    const md = h.md();
    expect(md).toContain("/api/tailor");
    expect(md).toContain("500");
    expect(md).toContain("812");
    expect(md).toContain("tailor.finished");
    expect(md.indexOf("/api/tailor")).toBeLessThan(md.indexOf("tailor.finished"));
  });

  it("renders two identical rapid events as two lines", () => {
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    h.log.record("net", "fetch", { method: "GET", path: "/api/drive/status", status: 200 });
    h.log.record("net", "fetch", { method: "GET", path: "/api/drive/status", status: 200 });
    const occurrences = h.md().split("/api/drive/status").length - 1;
    expect(occurrences).toBe(2);
  });

  it("never renders the literal word undefined or [object Object]", () => {
    const h = logAt();
    h.log.record("act", "weird", { a: undefined, b: { nested: { deep: 1 } }, c: [1, 2] });
    const md = h.md();
    expect(md).not.toContain("[object Object]");
    expect(md).not.toMatch(/\bundefined\b/);
  });

  it("counts the events it is showing", () => {
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    for (let i = 0; i < 3; i += 1) h.log.record("act", `e${i}`, {});
    expect(h.md()).toContain("Events recorded: 3");
  });
});

describe("when the cap bites, the file says what it dropped", () => {
  it("states the total, the per-channel breakdown and the window", () => {
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    for (let i = 0; i < 40; i += 1) {
      h.log.record("act", `user${i}`, {});
      h.advance(1000);
    }
    for (let i = 0; i < MAX_ACTIVITY_EVENTS; i += 1) {
      h.log.record("net", "fetch", { path: "/api/poll", status: 200 });
      h.advance(10);
    }
    const md = h.md();
    // The number.
    expect(md).toContain("40");
    // The names, so a reader knows WHICH kind of thing was lost -- rendered
    // through lib/experience/droppedNames.js's shared fragment builder, the
    // same one every budgeted context builder in this repo uses.
    expect(md).toMatch(/“[^”]*40[^”]*”/);
    // The window, so the gap is locatable in time rather than merely counted.
    expect(md).toContain("2023-11-14T22:13:20.000Z");
    expect(md).toContain("older");
  });

  it("says nothing about dropping when nothing was dropped", () => {
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    h.log.record("act", "x", {});
    expect(h.md()).not.toContain("older entries were dropped");
  });

  it("rations the drop notice so the notice can never be the thing that is cut", () => {
    // A notice that names N things is itself text; lib/experience/droppedNames.js's
    // header is the ruling. Twenty channels' worth of names must not produce an
    // unbounded sentence.
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    for (let i = 0; i < 40; i += 1) {
      h.log.record(`channel-with-a-long-name-${i}`, "x", {});
      h.advance(1);
    }
    for (let i = 0; i < MAX_ACTIVITY_EVENTS; i += 1) {
      h.log.record("net", "fetch", {});
      h.advance(1);
    }
    const md = h.md();
    const noticeLine = md.split("\n").find((line) => line.includes("older"));
    expect(noticeLine).toBeTruthy();
    expect(noticeLine.length).toBeLessThanOrEqual(400);
    expect(noticeLine).toContain("more");
  });
});

describe("aggregation: attached feature logs land in the same file", () => {
  it("writes an attached feature log verbatim under its own heading", () => {
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    h.log.attachSection("duplicate-apply", {
      title: "Duplicate-application checks",
      render: () => "# Duplicate-application check log\n\n- Entries recorded: 2\n",
    });
    const md = h.md();
    expect(md).toContain("Duplicate-application checks");
    expect(md).toContain("Entries recorded: 2");
  });

  it("demotes an attached log's own headings so the file keeps one outline", () => {
    const h = logAt();
    h.log.attachSection("x", { title: "X", render: () => "# Top level\n## Second\ntext\n" });
    const md = h.md();
    // A nested "# Top level" would make the combined file read as several
    // documents stapled together.
    expect(md).not.toMatch(/^# Top level$/m);
    expect(md).toMatch(/^#{3,} Top level$/m);
  });

  it("says when a feature log that could attach did not", () => {
    const md = renderActivityLog(logAt().log.snapshot());
    const notAttached = FEATURE_LOG_LEDGER.filter((e) => !e.attached);
    expect(notAttached.length).toBeGreaterThan(0);
    for (const entry of notAttached) {
      expect(md).toContain(entry.label);
    }
  });
});

describe("[planted secret] no credential reaches the file, by any route", () => {
  // The end-to-end half of activityRedaction.test.js: the same fixture, driven
  // through the recorder and the renderer, arriving at the actual bytes a user
  // downloads. A scrubber that is correct in isolation and bypassed by one
  // field is the defect this describe exists to catch.
  function fileCarryingEverySecret() {
    const h = logAt();
    h.log.markInstalled(1_700_000_000_000);
    for (const secret of PLANTED_SECRETS) {
      // Route 1: a credential-shaped field name.
      h.log.record("net", "fetch", { path: "/api/x", authorization: secret.literal, apiKey: secret.literal });
      // Route 2: an innocent field name carrying a secret VALUE.
      h.log.record("err", "uncaught", { message: `provider rejected ${secret.literal}` });
      // Route 3: a URL query value.
      h.log.record("net", "fetch", { path: `/api/cb?token=${secret.literal}`, status: 401 });
      // Route 4: the event TYPE itself.
      h.log.record("act", `paste:${secret.literal}`, {});
      // Route 5: an attached feature-log section.
      h.log.attachSection(`leak-${secret.id}`, { title: "Leaky feature", render: () => `dump: ${secret.literal}` });
    }
    return h.md();
  }

  const md = fileCarryingEverySecret();

  for (const secret of PLANTED_SECRETS) {
    it(`never writes ${secret.id} (${secret.where})`, () => {
      expect(md, `${secret.id} reached the downloaded file`).not.toContain(secret.literal);
    });
  }

  it("still wrote a real file, so the assertions above are not passing on an empty string", () => {
    // Without this, deleting the renderer's body would make every assertion in
    // this describe pass.
    expect(md.length).toBeGreaterThan(1000);
    expect(md).toContain("/api/x");
    expect(md).toContain("Leaky feature");
    expect(md).toContain("401");
  });
});

describe("the file name", () => {
  it("is built from the session's own start instant, in UTC", () => {
    expect(activityLogFileName({ startedAt: Date.UTC(2026, 8, 5, 14, 26, 40) })).toBe("activity-log-2026-09-05-1426.md");
  });

  it("is stable across two downloads of the same session", () => {
    const snap = { startedAt: 1_700_000_000_000 };
    expect(activityLogFileName(snap)).toBe(activityLogFileName(snap));
  });

  it("interpolates nothing caller-supplied", () => {
    // A file name is itself a disclosure surface: it shows up in a download
    // shelf and a support ticket's attachment list. Same ruling as
    // duplicateApplyLogFileName.
    const name = activityLogFileName({ startedAt: 1_700_000_000_000, mode: "../../etc/passwd", note: "secret" });
    expect(name).toMatch(/^activity-log-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  });

  it("degrades to a stated fallback rather than throwing", () => {
    expect(activityLogFileName(null)).toBe("activity-log-unknown-start.md");
    expect(activityLogFileName({ startedAt: NaN })).toBe("activity-log-unknown-start.md");
  });
});
