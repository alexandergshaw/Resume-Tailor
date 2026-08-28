// node (this repo's default environment). Pure — no React, no DOM.
import { describe, it, expect } from "vitest";
import { practiceInterviewTypeAnnouncement } from "./practiceInterviewTypeAnnouncement.js";

const BASE = {
  origin: "local",
  label: "Behavioral",
  answering: false,
  settling: false,
  answerMetrics: null,
  blocked: false,
};

describe("practiceInterviewTypeAnnouncement — hadRecording/hadReview derivation", () => {
  it("plain local change: no recording, no review", () => {
    const { ordinary } = practiceInterviewTypeAnnouncement(BASE);
    expect(ordinary).toBe("Interview type set to Behavioral. Practice questions cleared.");
  });

  it("answering true -> hadRecording", () => {
    const { ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, answering: true });
    expect(ordinary).toBe(
      "Interview type set to Behavioral. Practice questions cleared and your recording was discarded.",
    );
  });

  it("settling true -> hadRecording (the post-Done drain counts as recording, not just answering)", () => {
    const { ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, settling: true });
    expect(ordinary).toBe(
      "Interview type set to Behavioral. Practice questions cleared and your recording was discarded.",
    );
  });

  it("a truthy answerMetrics with no recording -> hadReview", () => {
    const { ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, answerMetrics: { wordCount: 12 } });
    expect(ordinary).toBe(
      "Interview type set to Behavioral. Practice questions cleared and your last answer's review was closed.",
    );
  });

  it("recording wins over review when both are true", () => {
    const { ordinary } = practiceInterviewTypeAnnouncement({
      ...BASE,
      answering: true,
      answerMetrics: { wordCount: 12 },
    });
    expect(ordinary).toBe(
      "Interview type set to Behavioral. Practice questions cleared and your recording was discarded.",
    );
  });
});

describe("practiceInterviewTypeAnnouncement — offers BOTH rows, decides nothing (manual-regression MATERIAL)", () => {
  // The defect this shape exists to make unreachable: this side used to
  // return one sentence and a dead `nextAnnounced`, so on a storage-blocked
  // tab it asked for the storage sentence forever and the latch owner — whose
  // only other answer was `""` — silenced every change after the first.
  //
  // It now returns both rows and picks neither. `claimStorageAnnouncement`
  // is the only code in the tree that decides between them.

  it("when blocked, `storage` carries the clause and `ordinary` is the same row without it", () => {
    const { storage, ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, blocked: true });

    expect(storage).toBe(
      "Interview type set to Behavioral. Practice questions cleared. Not saved. This browser is blocking stored settings.",
    );
    // THE FALLBACK. This is what a second change on a blocked tab now says,
    // where it previously said nothing at all.
    expect(ordinary).toBe("Interview type set to Behavioral. Practice questions cleared.");
    expect(ordinary).not.toContain("blocking stored settings");
  });

  it("the fallback still reports what the change destroyed", () => {
    // The whole point of not falling back to `""`: the second change on a
    // blocked tab can be the one that discards a take.
    const { ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, blocked: true, answering: true });
    expect(ordinary).toBe(
      "Interview type set to Behavioral. Practice questions cleared and your recording was discarded.",
    );
  });

  it("a blocked FOREIGN change keeps its wipe report and claims no failed write", () => {
    const { storage, ordinary } = practiceInterviewTypeAnnouncement({
      ...BASE,
      blocked: true,
      origin: "foreign",
    });
    const wipe =
      "Interview type changed to Behavioral in another window. Your score average and drafted answers were cleared. The question on screen stays until you ask for the next one.";

    expect(storage).toBe(`${wipe} This browser is blocking stored settings.`);
    expect(storage).not.toContain("Not saved");
    expect(ordinary).toBe(wipe);
  });

  it("when storage is healthy the two rows are identical, so the latch is never touched", () => {
    // `claimStorageAnnouncement` only spends the latch for a string carrying
    // the clause. Identical rows here mean a healthy tab cannot burn it.
    for (const origin of ["local", "foreign"]) {
      const { storage, ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, origin });
      expect(storage).toBe(ordinary);
      expect(storage).not.toContain("blocking stored settings");
    }
  });

  it("returns no latch state of its own — the two-latch defect cannot come back", () => {
    // `alreadyAnnounced`/`nextAnnounced` are gone. A key reappearing here is
    // this side starting to track a fact it does not own, which is how the
    // seam broke twice already.
    expect(Object.keys(practiceInterviewTypeAnnouncement({ ...BASE, blocked: true })).sort()).toEqual([
      "ordinary",
      "storage",
    ]);
  });
});

describe("practiceInterviewTypeAnnouncement — forwards origin/label/surface faithfully", () => {
  it("a foreign-origin change gets practice's own foreign sentence, never live's", () => {
    const { ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, origin: "foreign" });
    expect(ordinary).toBe(
      "Interview type changed to Behavioral in another window. Your score average and drafted answers were cleared. The question on screen stays until you ask for the next one.",
    );
  });

  it("forwards the label verbatim", () => {
    const { ordinary } = practiceInterviewTypeAnnouncement({ ...BASE, label: "System design" });
    expect(ordinary).toContain("System design");
  });

  it("always passes surface: 'practice', never 'live' — this module has no other caller", () => {
    // If this delegated with surface "live", a local-origin change would
    // return "" (the live row) instead of the practice sentence above.
    const { ordinary } = practiceInterviewTypeAnnouncement(BASE);
    expect(ordinary).not.toBe("");
  });
});
