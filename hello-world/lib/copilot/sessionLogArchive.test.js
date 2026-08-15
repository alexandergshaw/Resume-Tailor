import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  sessionLogArchiveEntries,
  buildSessionLogArchive,
  sessionLogArchiveName,
} from "./sessionLogArchive.js";
import { createSessionLog, sessionLogFileBase } from "./sessionLog.js";

// AC-Q5: one button, one file. The user asked for both the readable record
// and the raw diagnostic log without being made to choose between them at
// download time, so the archive carries both and the click stays single.
//
// jszip is already a dependency here (the .docx/.pptx writers use it), so
// this adds nothing to the bundle that was not already being paid for.

const T0 = Date.UTC(2026, 7, 15, 18, 32, 0);

function populatedLog() {
  let n = 0;
  const log = createSessionLog({
    mode: "live",
    source: "inperson",
    provider: "deepgram",
    startedAt: T0,
    now: () => T0 + (n += 1000),
  });
  log.event("session.start", { source: "inperson" });
  log.event("transcript", {
    speaker: "them",
    text: "Walk me through a project that went badly.",
    isFinal: true,
    speechFinal: true,
  });
  log.event("question.added", { id: 1, question: "Walk me through a project that went badly." });
  log.event("answer.done", { id: 1, points: ["Own the decision", "Say what changed after"] });
  return log.snapshot();
}

describe("what goes in the archive (AC-Q5.1)", () => {
  it("carries exactly the readable record and the raw log", () => {
    const entries = sessionLogArchiveEntries(populatedLog());
    const names = Object.keys(entries).sort();
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.endsWith(".md"))).toBe(true);
    expect(names.some((n) => n.endsWith(".json"))).toBe(true);
  });

  it("names both files after the session, so two downloads never collide", () => {
    const snap = populatedLog();
    const base = sessionLogFileBase(snap);
    const names = Object.keys(sessionLogArchiveEntries(snap));
    for (const name of names) {
      expect(name.startsWith(base)).toBe(true);
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
    }
  });

  it("puts the real rendered content in each, not a placeholder", () => {
    const entries = sessionLogArchiveEntries(populatedLog());
    const md = entries[Object.keys(entries).find((n) => n.endsWith(".md"))];
    const json = entries[Object.keys(entries).find((n) => n.endsWith(".json"))];

    expect(md).toContain("Walk me through a project that went badly.");
    expect(md).toContain("Own the decision");
    expect(md).toMatch(/^# /m);

    const parsed = JSON.parse(json);
    expect(parsed.mode).toBe("live");
    expect(parsed.events.length).toBeGreaterThan(0);
  });

  it("still produces both files for a session that recorded nothing", () => {
    // The failure this whole feature exists to explain. An empty archive, or
    // a crash here, would leave the user with nothing to send.
    const empty = createSessionLog({ mode: "live", source: "inperson", startedAt: T0 }).snapshot();
    const entries = sessionLogArchiveEntries(empty);
    expect(Object.keys(entries)).toHaveLength(2);
    for (const content of Object.values(entries)) {
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("does not throw on a snapshot it was never given", () => {
    expect(() => sessionLogArchiveEntries(null)).not.toThrow();
    expect(Object.keys(sessionLogArchiveEntries(null))).toHaveLength(2);
  });
});

describe("the archive itself (AC-Q5.2)", () => {
  it("builds a real zip a user can open", async () => {
    const snap = populatedLog();
    const blob = await buildSessionLogArchive(snap);
    expect(blob).toBeTruthy();

    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(Object.keys(sessionLogArchiveEntries(snap)).sort());

    const mdName = names.find((n) => n.endsWith(".md"));
    const text = await zip.file(mdName).async("string");
    expect(text).toContain("Walk me through a project that went badly.");
  });

  it("names the archive after the session too (AC-Q5.3)", () => {
    const snap = populatedLog();
    expect(sessionLogArchiveName(snap)).toBe(`${sessionLogFileBase(snap)}.zip`);
    expect(sessionLogArchiveName(null)).toMatch(/\.zip$/);
    expect(sessionLogArchiveName(null)).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("distinguishes a practice archive from a live one (AC-Q5.3)", () => {
    const practice = createSessionLog({ mode: "practice", startedAt: T0 }).snapshot();
    expect(sessionLogArchiveName(practice)).toContain("practice");
  });
});

// D9 — sessionLogArchiveEntries(snapshot) used to call
// renderSessionLogMarkdown(snapshot) with ONE argument, so
// opts.speakerSnapshot was `undefined` in every real download — the
// renderer's own speakerDisplayLabel fallback (lib/copilot/
// speakerIdentity.js) resolves an unresolvable snapshot to "Speaker 1",
// "Speaker 2", ... instead of "You"/"Them", for every in-person turn.
describe("speaker labels reach the download, not just the on-screen transcript (D9)", () => {
  function inPersonLog() {
    const log = createSessionLog({ mode: "live", source: "inperson", provider: "deepgram", startedAt: T0 });
    log.event("transcript", {
      speaker: "them",
      text: "Tell me about a time you disagreed with a teammate.",
      isFinal: true,
      speechFinal: true,
      speakerTag: 0,
    });
    log.event("transcript", {
      speaker: "you",
      text: "Sure, on a recent project...",
      isFinal: true,
      speechFinal: true,
      speakerTag: 1,
    });
    return log.snapshot();
  }

  it("resolves an in-person turn to a human label when the archive is built WITH a speaker snapshot", () => {
    const speakerSnapshot = { userTag: 1, confidence: "high", overridden: true, tags: [0, 1] };
    const entries = sessionLogArchiveEntries(inPersonLog(), { speakerSnapshot });
    const md = entries[Object.keys(entries).find((n) => n.endsWith(".md"))];
    expect(md).toContain("**Them:** Tell me about a time you disagreed with a teammate.");
    expect(md).toContain("**You:** Sure, on a recent project");
    expect(md).not.toMatch(/Speaker \d/);
  });

  it("[control] falls back to numbered tags with no speaker snapshot at all — proving the check above is real", () => {
    const entries = sessionLogArchiveEntries(inPersonLog());
    const md = entries[Object.keys(entries).find((n) => n.endsWith(".md"))];
    expect(md).toMatch(/Speaker \d/);
    expect(md).not.toContain("**Them:**");
  });

  it("a REAL downloaded archive (buildSessionLogArchive -> the zip's own .md entry) resolves the label too", async () => {
    const speakerSnapshot = { userTag: 1, confidence: "high", overridden: true, tags: [0, 1] };
    const buffer = await buildSessionLogArchive(inPersonLog(), { speakerSnapshot });
    const zip = await JSZip.loadAsync(buffer);
    const mdName = Object.keys(zip.files).find((n) => n.endsWith(".md"));
    const text = await zip.file(mdName).async("string");
    expect(text).toContain("**Them:** Tell me about a time you disagreed with a teammate.");
    expect(text).not.toMatch(/Speaker \d/);
  });
});
