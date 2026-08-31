import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DRIVE_UPLOAD_MAX_BYTES, DRIVE_EXPORT_MAX_BYTES, oversizeMessage } from "./driveSize.js";
import { DRIVE_BATCH_MESSAGE } from "./driveMessages.js";

describe("DRIVE_UPLOAD_MAX_BYTES", () => {
  it("is exactly 4,000,000 bytes -- the one constant both client and server enforce", () => {
    expect(DRIVE_UPLOAD_MAX_BYTES).toBe(4_000_000);
  });
});

describe("DRIVE_EXPORT_MAX_BYTES", () => {
  it("is exactly 10,000,000 bytes", () => {
    expect(DRIVE_EXPORT_MAX_BYTES).toBe(10_000_000);
  });
});

// WAVE2-SEAMS.md MAJOR-7: the too-large message existed in three
// independently-spelled variants across the wave -- driveMessages.js's
// DRIVE_BATCH_MESSAGE.tooLargeUpload, driveSaveBatch.js's own
// TOO_LARGE_MESSAGE, and this module's oversizeMessage(), the only one that
// named concrete byte counts. driveMessages.js's own test forbids digits in
// that string (Drive's real 5 TB ceiling must never appear), so
// oversizeMessage() previously violated its own sibling's contract. This
// collapses to ONE canonical, digit-free string, sourced from
// driveMessages.js.
describe("oversizeMessage", () => {
  it("is driveMessages.js's canonical tooLargeUpload string -- imported, not a local re-derivation", () => {
    expect(oversizeMessage()).toBe(DRIVE_BATCH_MESSAGE.tooLargeUpload);
  });

  it("driveSize.js's own source never hardcodes the sentence -- it must come from the import, not a local duplicate", () => {
    // Mutation-proof: reintroducing a second, locally-spelled copy of the
    // oversize string (even a byte-identical one that would still satisfy
    // the value-equality assertion above) trips this source-text check.
    const src = readFileSync(path.join(process.cwd(), "lib/drive/driveSize.js"), "utf8");
    expect(src).not.toContain("too large for the app to upload to Drive");
    expect(src).toMatch(/from ["']\.\/driveMessages(\.js)?["']/);
  });

  it("names THIS APP's own decision, never Drive's -- no digits, no 'Drive's limit' phrasing", () => {
    const message = oversizeMessage();
    // Positive control first: the string actually exists and has content to
    // check, so the absence assertions below can't pass vacuously against
    // an accidentally emptied string.
    expect(message.length).toBeGreaterThan(20);
    expect(message).not.toMatch(/\d/);
    expect(message.toLowerCase()).not.toContain("drive's");
    expect(message).not.toMatch(/drive('s)?\s+(limit|cap|ceiling)/i);
  });

  it("offers a real, actionable recovery -- the local .docx download", () => {
    expect(oversizeMessage()).toContain("Download it as .docx here instead.");
  });
});
