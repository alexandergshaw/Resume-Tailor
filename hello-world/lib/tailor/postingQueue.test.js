// Contract for the Job Description tab's multi-posting queue.
//
// Written from the acceptance criteria BEFORE the implementation exists, and
// deliberately about observable behaviour of the queue (what gets submitted,
// what a retry re-runs, what survives a reload) rather than about the shape
// of any React state. Everything here is a pure function so it runs under the
// suite's default `environment: "node"`.

import { describe, it, expect } from "vitest";
import {
  createEntry,
  addEntry,
  removeEntry,
  setEntryText,
  patchEntry,
  submittableEntries,
  failedEntries,
  markQueued,
  queueSummary,
  restorePostingTexts,
  serializeEntries,
  postingLabel,
  buildPostingsPin,
} from "./postingQueue.js";

function entriesFrom(texts) {
  return texts.map((text, i) => createEntry(`p${i + 1}`, text));
}

describe("createEntry", () => {
  it("starts a posting idle, with no error, warning, or tailored job", () => {
    expect(createEntry("p1", "Some posting")).toEqual({
      id: "p1",
      text: "Some posting",
      status: "idle",
      error: "",
      warning: "",
      jobId: null,
      jobTitle: "",
      company: "",
    });
  });

  it("defaults to empty text so a fresh box can be added with no arguments", () => {
    expect(createEntry("p1").text).toBe("");
  });
});

describe("addEntry / removeEntry (AC-1)", () => {
  it("appends a new empty posting at the end", () => {
    const next = addEntry(entriesFrom(["A"]), "p2");
    expect(next.map((e) => e.text)).toEqual(["A", ""]);
  });

  it("removes only the requested posting", () => {
    const next = removeEntry(entriesFrom(["A", "B", "C"]), "p2");
    expect(next.map((e) => e.text)).toEqual(["A", "C"]);
  });

  it("refuses to remove the last remaining posting, so the tab is never empty", () => {
    const only = entriesFrom(["A"]);
    expect(removeEntry(only, "p1")).toEqual(only);
  });

  it("does not mutate the list it was given", () => {
    const before = entriesFrom(["A"]);
    addEntry(before, "p2");
    removeEntry(before, "p1");
    expect(before).toHaveLength(1);
    expect(before[0].text).toBe("A");
  });
});

describe("setEntryText", () => {
  it("updates only the targeted posting's text", () => {
    const next = setEntryText(entriesFrom(["A", "B"]), "p2", "B2");
    expect(next.map((e) => e.text)).toEqual(["A", "B2"]);
  });

  it("clears a previous run's outcome, so a stale Failed/Ready badge cannot outlive the text it described", () => {
    const ran = patchEntry(entriesFrom(["A"]), "p1", {
      status: "error",
      error: "Boom",
      warning: "hmm",
      jobId: "manual-1",
      jobTitle: "Staff Engineer",
      company: "Acme",
    });
    expect(setEntryText(ran, "p1", "A rewritten")[0]).toEqual({
      id: "p1",
      text: "A rewritten",
      status: "idle",
      error: "",
      warning: "",
      jobId: null,
      jobTitle: "",
      company: "",
    });
  });
});

describe("submittableEntries (AC-2, AC-6)", () => {
  it("keeps only postings with real text", () => {
    const picked = submittableEntries(entriesFrom(["A", "", "   ", "\n\t", "B"]));
    expect(picked.map((e) => e.text)).toEqual(["A", "B"]);
  });

  it("returns nothing when every box is blank", () => {
    expect(submittableEntries(entriesFrom(["", "  "]))).toEqual([]);
  });
});

describe("failedEntries / markQueued (AC-5)", () => {
  const mixed = [
    { ...createEntry("p1", "A"), status: "done", jobId: "manual-1" },
    { ...createEntry("p2", "B"), status: "error", error: "Server said no" },
    { ...createEntry("p3", "C"), status: "done", jobId: "manual-3" },
  ];

  it("finds exactly the postings that failed", () => {
    expect(failedEntries(mixed).map((e) => e.id)).toEqual(["p2"]);
  });

  it("queues only the listed postings and leaves the rest exactly as they were", () => {
    const next = markQueued(mixed, ["p2"]);
    expect(next[0]).toEqual(mixed[0]);
    expect(next[2]).toEqual(mixed[2]);
    // toEqual against the ORIGINAL entry, not toMatchObject: a subset check
    // here would pass an implementation that rebuilt the entry from scratch
    // and blanked the user's text on every Generate click.
    expect(next[1]).toEqual({
      ...mixed[1],
      status: "pending",
      error: "",
      warning: "",
      jobId: null,
    });
  });

  it("keeps the queued posting's text verbatim", () => {
    expect(markQueued(mixed, ["p1", "p2", "p3"]).map((e) => e.text)).toEqual(["A", "B", "C"]);
  });

  it("drops a queued posting's previous job id, so a retry cannot reuse the failed run's tracked job", () => {
    const withJob = patchEntry(entriesFrom(["A"]), "p1", { status: "error", jobId: "manual-1" });
    expect(markQueued(withJob, ["p1"])[0].jobId).toBeNull();
  });
});

describe("queueSummary (AC-3)", () => {
  it("counts each posting under its own status", () => {
    const entries = [
      createEntry("p1", "A"),
      { ...createEntry("p2", "B"), status: "pending" },
      { ...createEntry("p3", "C"), status: "processing" },
      { ...createEntry("p4", "D"), status: "done" },
      { ...createEntry("p5", "E"), status: "error" },
      { ...createEntry("p6", "F"), status: "error" },
    ];
    expect(queueSummary(entries)).toEqual({
      idle: 1,
      pending: 1,
      processing: 1,
      done: 1,
      error: 2,
    });
  });

  it("reports all zeroes for an empty queue", () => {
    expect(queueSummary([])).toEqual({ idle: 0, pending: 0, processing: 0, done: 0, error: 0 });
  });
});

describe("restorePostingTexts (AC-8)", () => {
  it("restores every saved posting, in order", () => {
    expect(restorePostingTexts(JSON.stringify(["A", "B", "C"]), null)).toEqual(["A", "B", "C"]);
  });

  it("restores a value saved by the single-textarea version as one posting", () => {
    expect(restorePostingTexts(null, "Legacy posting text")).toEqual(["Legacy posting text"]);
  });

  it("prefers the multi-posting list over the legacy value once both exist", () => {
    expect(restorePostingTexts(JSON.stringify(["A", "B"]), "Legacy")).toEqual(["A", "B"]);
  });

  // The reachable case: the queue is never empty, so clearing the only box
  // saves '[""]', never '[]'. Emptying the box must not resurrect the legacy
  // text the user has already moved past.
  it("treats a single emptied box as an emptied box, not as a reason to resurrect the legacy text", () => {
    expect(restorePostingTexts(JSON.stringify([""]), "Legacy")).toEqual([""]);
  });

  it("treats an explicitly empty list as one empty box", () => {
    expect(restorePostingTexts("[]", "Legacy")).toEqual([""]);
  });

  it("falls back to the legacy value when the saved list is not valid JSON", () => {
    expect(restorePostingTexts("{not json", "Legacy")).toEqual(["Legacy"]);
  });

  it("falls back to the legacy value when the saved value is not a list at all", () => {
    expect(restorePostingTexts(JSON.stringify({ a: 1 }), "Legacy")).toEqual(["Legacy"]);
  });

  it("ignores non-string members rather than rendering them as postings", () => {
    expect(restorePostingTexts(JSON.stringify(["A", 7, null, { a: 1 }, "B"]), null)).toEqual(["A", "B"]);
  });

  it("yields one empty box when every saved member was unusable", () => {
    expect(restorePostingTexts(JSON.stringify([7, null]), "Legacy")).toEqual([""]);
  });

  it("always yields at least one box when nothing was ever saved", () => {
    expect(restorePostingTexts(null, null)).toEqual([""]);
    expect(restorePostingTexts(null, "   ")).toEqual([""]);
  });
});

describe("serializeEntries (AC-8)", () => {
  it("saves the postings' text, and round-trips through restorePostingTexts", () => {
    const entries = entriesFrom(["A", "", "B"]);
    const saved = serializeEntries(entries);
    expect(JSON.parse(saved)).toEqual(["A", "", "B"]);
    expect(restorePostingTexts(saved, null)).toEqual(["A", "", "B"]);
  });

  it("saves the text only — never a run's status, error, or tracked job id", () => {
    const ran = patchEntry(entriesFrom(["A"]), "p1", {
      status: "done",
      jobId: "manual-1",
      warning: "cover letter failed",
    });
    expect(JSON.parse(serializeEntries(ran))).toEqual(["A"]);
  });
});

describe("postingLabel (AC-10)", () => {
  it("names each box by its position, counting from one", () => {
    expect(postingLabel(0)).toBe("Job posting 1");
    expect(postingLabel(4)).toBe("Job posting 5");
  });
});

describe("buildPostingsPin (AC-7)", () => {
  // The chat panel pins ONE context object (app/hooks/useChat.js holds a
  // single `chatPinnedContext`), so several postings are pinned as one block
  // rather than several pins. With exactly one posting the label and body must
  // be byte-identical to what the single-textarea version pinned, or the same
  // action starts producing different chat context than it did yesterday.
  it("pins a lone posting exactly as the single-textarea version did", () => {
    expect(buildPostingsPin(entriesFrom(["The posting text"]))).toEqual({
      label: "Pasted Job Description",
      content: "Pasted Job Description:\nThe posting text",
    });
  });

  it("ignores blank boxes when deciding it is a lone posting", () => {
    expect(buildPostingsPin(entriesFrom(["", "The posting text", "   "]))).toEqual({
      label: "Pasted Job Description",
      content: "Pasted Job Description:\nThe posting text",
    });
  });

  it("pins every non-blank posting, each labelled by its position", () => {
    const pin = buildPostingsPin(entriesFrom(["First", "", "Second"]));
    expect(pin.label).toBe("Pasted Job Descriptions (2)");
    expect(pin.content).toContain("First");
    expect(pin.content).toContain("Second");
    expect(pin.content).toContain("Pasted Job Description 1:");
    expect(pin.content).toContain("Pasted Job Description 2:");
  });

  it("returns nothing to pin when every box is blank", () => {
    expect(buildPostingsPin(entriesFrom(["", "  "]))).toBeNull();
  });
});
