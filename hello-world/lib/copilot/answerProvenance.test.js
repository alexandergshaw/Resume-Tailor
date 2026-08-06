import { describe, it, expect } from "vitest";
import { framesWereSent, videoWasReviewed } from "./answerProvenance";

// These two functions decide what practice mode CLAIMS about who looked at
// the user's video. Both claims can fail in either direction, and both
// directions are harmful in a way that is invisible from the screen:
//
//   - claiming a human/model reviewed the video when nothing was sent
//     invents a review that never happened;
//   - claiming nobody reviewed it when frames did go to Gemini understates
//     what actually left the browser.
//
// They live in lib/ rather than inside AnswerFeedback.js specifically so
// they can be tested: this repo's vitest runs `environment: "node"` with no
// jsdom anywhere, so nothing that lives inside a component module can be
// exercised by a test at all (the same reason lib/copilot/answerPoints.js
// exists).

describe("framesWereSent", () => {
  it("is true only when the array actually carried at least one frame", () => {
    expect(framesWereSent(["frame-a"])).toBe(true);
    expect(framesWereSent(["frame-a", "frame-b", "frame-c"])).toBe(true);
  });

  // The case this function exists for. `includeFrames` (the opt-in switch
  // AND a non-embedded engine) can be true while the frames array is still
  // empty: the camera was off, no camera was present, or the sampler failed
  // to capture anything. runCritique sends `frames: []` in that situation,
  // so nothing was reviewed, and recording the SWITCH rather than the array
  // would claim a review of a video that was never transmitted.
  it("is false for an empty array, which is what an opt-in with no usable camera produces", () => {
    expect(framesWereSent([])).toBe(false);
  });

  it("is false rather than throwing for a missing or non-array value", () => {
    expect(framesWereSent(undefined)).toBe(false);
    expect(framesWereSent(null)).toBe(false);
    expect(framesWereSent("frame-a")).toBe(false);
    expect(framesWereSent({ length: 3 })).toBe(false);
    expect(framesWereSent(3)).toBe(false);
  });
});

describe("videoWasReviewed", () => {
  it("is true only when Gemini ran AND frames were actually sent to it", () => {
    expect(videoWasReviewed("gemini", true)).toBe(true);
  });

  // The embedded engine never constructs a Gemini client and never parses a
  // frame, so it cannot have looked at the video no matter what the frames
  // flag says.
  it("is false on the embedded engine even when frames were sent", () => {
    expect(videoWasReviewed("embedded", true)).toBe(false);
  });

  // The Gemini-failed-and-fell-back-to-embedded path reports source
  // "embedded" even though frames may already have been transmitted for the
  // failed attempt. Frames leaving the browser is a privacy fact; a review
  // having happened is a different fact, and this function reports the
  // second one.
  it("is false when Gemini was attempted but the result came back from the embedded fallback", () => {
    expect(videoWasReviewed("embedded", true)).toBe(false);
  });

  it("is false when Gemini ran but no frame was sent", () => {
    expect(videoWasReviewed("gemini", false)).toBe(false);
  });

  it("is false for a missing or unknown source", () => {
    expect(videoWasReviewed(undefined, true)).toBe(false);
    expect(videoWasReviewed(null, true)).toBe(false);
    expect(videoWasReviewed("", true)).toBe(false);
    expect(videoWasReviewed("openai", true)).toBe(false);
  });

  it("coerces a missing frames flag to false rather than throwing", () => {
    expect(videoWasReviewed("gemini", undefined)).toBe(false);
    expect(videoWasReviewed("gemini", null)).toBe(false);
  });

  it("always returns a real boolean, never a truthy passthrough value", () => {
    // AnswerFeedback renders one of two different sentences off this value,
    // so a truthy-but-not-true return would still pick the right branch and
    // hide a sloppy implementation from every assertion above.
    expect(videoWasReviewed("gemini", "yes")).toBe(true);
    expect(typeof videoWasReviewed("gemini", "yes")).toBe("boolean");
    expect(typeof videoWasReviewed("gemini", 0)).toBe("boolean");
  });
});
