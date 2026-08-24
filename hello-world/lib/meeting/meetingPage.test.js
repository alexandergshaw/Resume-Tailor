// What a finished meeting looks like once it is a page in the knowledge base.
//
// Pure on purpose: every timestamp is an argument, so this never reads a
// clock and the whole shape is testable without rendering anything.
//
// The saved page is an ORDINARY Experience page. It is deliberately NOT
// marked `generated_kind` — the user's instruction was that a recorded
// meeting is their own experience and must be used when tailoring a résumé
// and when answering in an interview, and both of those paths
// (lib/copilot/projectStories.js, lib/experience/tailorSources.js) skip any
// row with that column set. Marking it would have made the feature useless
// for its main purpose while looking correct.
//
// That decision puts the honesty burden HERE instead, on the body's shape: a
// transcript contains other people's words, and /api/copilot/answer instructs
// the model to speak project-page material as the candidate's own
// experience. So the page leads with the topic and the user's own discussion
// points, and the transcript sits under a heading that says plainly it is a
// recording of several people. Nothing is withheld; it is just labelled.

import { describe, it, expect } from "vitest";
import { buildMeetingPage } from "./meetingPage.js";

const STARTED = Date.parse("2026-03-04T14:05:00.000Z");
const ENDED = Date.parse("2026-03-04T14:47:00.000Z");

const turns = [
  { id: "t1", speaker: "you", text: "Are we still gated on the legacy processor?", at: STARTED + 1000 },
  { id: "t2", speaker: "them", text: "Only for refunds now.", at: STARTED + 4000 },
];

const insights = [
  {
    id: "i1",
    text: "Mention that reconciliation dropped from three days to under an hour.",
    kind: "point",
    source: { kind: "page", pageId: "p-1", pageTitle: "Payments migration", attachmentName: null },
  },
  {
    id: "i2",
    text: "Ask who owns the refund path after the cutover.",
    kind: "question",
    source: { kind: "model", pageId: null, pageTitle: null, attachmentName: null },
  },
];

const call = (over = {}) => ({
  topic: "Payments migration cutover",
  insights,
  turns,
  startedAt: STARTED,
  endedAt: ENDED,
  source: "inperson",
  ...over,
});

describe("the title", () => {
  it("names the topic and the day", () => {
    // A page tree full of "Meeting" is unusable a month later.
    const { title } = buildMeetingPage(call());
    expect(title).toContain("Payments migration cutover");
    expect(title).toContain("2026-03-04");
  });

  it("still produces a usable title when no topic was ever worked out", () => {
    // A short meeting, or one that ended before the first read landed.
    const { title } = buildMeetingPage(call({ topic: "" }));
    expect(title.trim().length).toBeGreaterThan(0);
    expect(title).toContain("2026-03-04");
    expect(title.toLowerCase()).toContain("meeting");
  });
});

describe("the body leads with what the user can use", () => {
  it("opens with the topic, not with the transcript", () => {
    const { body } = buildMeetingPage(call());
    const topicAt = body.indexOf("Payments migration cutover");
    const transcriptAt = body.search(/##\s*Transcript/i);
    expect(topicAt).toBeGreaterThanOrEqual(0);
    expect(transcriptAt).toBeGreaterThan(topicAt);
  });

  it("puts the discussion points above the transcript", () => {
    // These are the reusable part - the thing worth surfacing when this page
    // is later mined for a résumé bullet or an interview answer.
    const { body } = buildMeetingPage(call());
    const pointsAt = body.indexOf("Mention that reconciliation dropped");
    const transcriptAt = body.search(/##\s*Transcript/i);
    expect(pointsAt).toBeGreaterThanOrEqual(0);
    expect(transcriptAt).toBeGreaterThan(pointsAt);
  });

  it("records when it happened, how long it ran, and how it was captured", () => {
    const { body } = buildMeetingPage(call());
    expect(body).toContain("2026-03-04");
    // 14:05 to 14:47 is 42 minutes.
    expect(body).toMatch(/42\s*min/i);
  });
});

describe("insights keep their attribution", () => {
  it("names the page an insight came from", () => {
    // AC7 matters as much a week later as it did live: without this the page
    // records a claim with no way to tell whose it was.
    const { body } = buildMeetingPage(call());
    const line = body.split("\n").find((l) => l.includes("reconciliation dropped"));
    expect(line).toBeDefined();
    expect(line).toContain("Payments migration");
  });

  it("does NOT imply a source for something the model composed", () => {
    // Positive control's other half: a builder that appended "from your
    // notes" to every line would pass the test above and lie here.
    const { body } = buildMeetingPage(call());
    const line = body.split("\n").find((l) => l.includes("who owns the refund path"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/from your page|your notes/i);
  });

  it("says so plainly when no points were raised", () => {
    const { body } = buildMeetingPage(call({ insights: [] }));
    expect(body).toMatch(/no discussion points|none/i);
  });
});

describe("the transcript", () => {
  it("is labelled as a recording of more than one person", () => {
    // THE HONESTY MITIGATION. This page feeds résumé tailoring and interview
    // answers, where the model is told to speak page material as the user's
    // own experience. Every word stays - it is simply labelled so the model
    // can see that a transcript is not a first-person claim.
    const { body } = buildMeetingPage(call());
    const heading = body.split("\n").find((l) => /##\s*Transcript/i.test(l));
    expect(heading).toBeDefined();
    expect(body.toLowerCase()).toMatch(/several people|multiple speakers|more than one person|everyone in/);
  });

  it("keeps every finalized turn, not the window that was sent to the model", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      speaker: "room",
      text: `Turn number ${i} said something worth keeping.`,
      at: STARTED + i * 1000,
    }));
    const { body } = buildMeetingPage(call({ turns: many }));
    expect(body).toContain("Turn number 0 ");
    expect(body).toContain("Turn number 59 ");
  });

  it("labels the two structurally separate streams of a call", () => {
    const { body } = buildMeetingPage(call({ source: "tab" }));
    expect(body).toContain("You");
    expect(body).toContain("Others");
  });

  it("writes an unattributed room turn with no speaker label at all", () => {
    // One shared microphone genuinely cannot attribute a turn. Writing
    // "Room:" or "Speaker:" into a page that later becomes interview
    // material would invent an attribution that never existed.
    const { body } = buildMeetingPage(call({ turns: [{ id: "t1", speaker: "room", text: "Only for refunds now.", at: STARTED }] }));
    expect(body).toContain("Only for refunds now.");
    expect(body).not.toMatch(/^\s*(Room|Speaker)\s*:/m);
  });

  it("never writes interim text into the page", () => {
    // Interims are half-heard guesses that the provider revises. A page is
    // permanent; only finalized turns belong in one.
    const { body } = buildMeetingPage(
      call({ turns: [{ id: "t1", speaker: "room", text: "Final text.", at: STARTED, interim: true }] }),
    );
    expect(body).not.toContain("Final text.");
  });
});

describe("it never throws on a thin meeting", () => {
  it("handles no turns, no insights and no topic at once", () => {
    // Someone starts a meeting, changes their mind, and stops. That must
    // still save something coherent rather than failing at the last step and
    // losing whatever there was.
    const result = buildMeetingPage(call({ topic: "", insights: [], turns: [] }));
    expect(result.title.trim().length).toBeGreaterThan(0);
    expect(result.body.trim().length).toBeGreaterThan(0);
  });

  it("survives junk in the lists", () => {
    const result = buildMeetingPage(call({ insights: [null, {}, 42], turns: [null, undefined] }));
    expect(typeof result.body).toBe("string");
  });
});
