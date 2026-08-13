import { describe, it, expect } from "vitest";
import { splitFrames, pointsFromPartialJson } from "./answerStream.js";

// AC-P2: the two pure pieces of the streaming answer path.
//
//   splitFrames            the NDJSON wire framing between route and client.
//   pointsFromPartialJson  turning a HALF-RECEIVED model response into the
//                          complete bullets so far, so the card fills in as
//                          the model writes instead of after it finishes.
//
// Both live here rather than inside the route or the client because this
// repo's vitest config is `environment: "node"` with no jsdom — a decision
// buried in a fetch loop or a ReadableStream reader is not reachable from a
// test, and an unfalsifiable parser is exactly where a truncated answer would
// hide. Same reasoning as answerWindow.js and answerPoints.js.

describe("splitFrames — NDJSON framing (AC-P2.1)", () => {
  it("returns complete frames and keeps the trailing partial line as rest", () => {
    const { frames, rest } = splitFrames('{"t":"points","points":["a"]}\n{"t":"do');
    expect(frames).toEqual([{ t: "points", points: ["a"] }]);
    expect(rest).toBe('{"t":"do');
  });

  it("returns every complete frame in arrival order", () => {
    const { frames, rest } = splitFrames('{"t":"points","points":["a"]}\n{"t":"points","points":["a","b"]}\n');
    expect(frames).toEqual([
      { t: "points", points: ["a"] },
      { t: "points", points: ["a", "b"] },
    ]);
    expect(rest).toBe("");
  });

  it("drops an unparseable line rather than throwing, and keeps going", () => {
    // A proxy injecting a keep-alive, or a truncated frame from a dropped
    // connection, must not take the whole answer down with it.
    const { frames, rest } = splitFrames('not json\n{"t":"points","points":["a"]}\n');
    expect(frames).toEqual([{ t: "points", points: ["a"] }]);
    expect(rest).toBe("");
  });

  it("ignores blank and whitespace-only lines", () => {
    const { frames } = splitFrames('\n  \n{"t":"points","points":[]}\n\n');
    expect(frames).toEqual([{ t: "points", points: [] }]);
  });

  it("treats a buffer with no newline as entirely partial", () => {
    const { frames, rest } = splitFrames('{"t":"points"');
    expect(frames).toEqual([]);
    expect(rest).toBe('{"t":"points"');
  });

  it("handles the empty buffer", () => {
    expect(splitFrames("")).toEqual({ frames: [], rest: "" });
  });

  it("tolerates \\r\\n line endings", () => {
    const { frames, rest } = splitFrames('{"t":"points","points":["a"]}\r\n{"t":"x"}\r\n');
    expect(frames).toEqual([{ t: "points", points: ["a"] }, { t: "x" }]);
    expect(rest).toBe("");
  });

  it("never throws on malformed input", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(() => splitFrames(bad)).not.toThrow();
      expect(splitFrames(bad)).toEqual({ frames: [], rest: "" });
    }
  });
});

describe("pointsFromPartialJson — complete bullets from a half-received response (AC-P2.2)", () => {
  it("returns the closed strings and excludes the one still being written", () => {
    const partial = '{"points":["Situation: I led the migration.","Task: cut latency by ha';
    expect(pointsFromPartialJson(partial)).toEqual(["Situation: I led the migration."]);
  });

  it("returns nothing before the points array has opened", () => {
    expect(pointsFromPartialJson("")).toEqual([]);
    expect(pointsFromPartialJson("{")).toEqual([]);
    expect(pointsFromPartialJson('{"poi')).toEqual([]);
    expect(pointsFromPartialJson('{"points":')).toEqual([]);
    expect(pointsFromPartialJson('{"points":[')).toEqual([]);
    expect(pointsFromPartialJson('{"points":["')).toEqual([]);
  });

  it("returns every point once the array has closed", () => {
    expect(pointsFromPartialJson('{"points":["a","b","c"],"type":"general"}')).toEqual(["a", "b", "c"]);
  });

  it("stops at the end of the points array and never bleeds in a later field", () => {
    // `cues` is a sibling array of strings in answer mode. Treating the two as
    // one list would show the candidate cue fragments as if they were answer
    // bullets.
    const full = '{"points":["a","b"],"cues":["c1","c2"],"type":"general"}';
    expect(pointsFromPartialJson(full)).toEqual(["a", "b"]);
  });

  it("decodes escaped quotes inside a point", () => {
    expect(pointsFromPartialJson('{"points":["He said \\"ship it\\" and we did."]}')).toEqual([
      'He said "ship it" and we did.',
    ]);
  });

  it("does not treat an escaped quote as the end of a point", () => {
    // Truncated mid-point, immediately after an escaped quote. A naive scanner
    // closes the string here and emits a mangled half-bullet.
    expect(pointsFromPartialJson('{"points":["He said \\"ship it')).toEqual([]);
  });

  it("decodes escaped backslashes, newlines and unicode", () => {
    expect(pointsFromPartialJson('{"points":["a\\\\b","line\\none","caf\\u00e9"]}')).toEqual([
      "a\\b",
      "line\none",
      "café",
    ]);
  });

  it("does not mistake a trailing escaped backslash for an escaped quote", () => {
    // The point's text ends in a literal backslash, so the very next quote IS
    // the terminator. Getting this backwards swallows the rest of the payload
    // into one bullet.
    expect(pointsFromPartialJson('{"points":["ends with a slash \\\\","next"]}')).toEqual([
      "ends with a slash \\",
      "next",
    ]);
  });

  it("tolerates a leading markdown fence, like parseModelJson does", () => {
    expect(pointsFromPartialJson('```json\n{"points":["a","b')).toEqual(["a"]);
  });

  it("tolerates whitespace and newlines around the key and the array", () => {
    expect(pointsFromPartialJson('{\n  "points" : [\n    "a",\n    "b')).toEqual(["a"]);
  });

  it("returns [] for a document with no points key at all", () => {
    expect(pointsFromPartialJson('{"type":"general","cues":["a"]}')).toEqual([]);
  });

  it("never throws on malformed input", () => {
    for (const bad of [null, undefined, 42, {}, [], '{"points":[}', '{"points":["a"'.repeat(50)]) {
      expect(() => pointsFromPartialJson(bad)).not.toThrow();
      expect(Array.isArray(pointsFromPartialJson(bad))).toBe(true);
    }
  });

  it("grows monotonically as the same response arrives byte by byte", () => {
    // The property the UI actually depends on: a bullet that has appeared can
    // never disappear or change on a later chunk. Anything else renders as
    // text flickering in front of someone mid-interview.
    const full = '{"points":["First point here.","Second point, with a \\"quote\\".","Third."],"type":"behavioral"}';
    let previous = [];
    for (let i = 0; i <= full.length; i += 1) {
      const got = pointsFromPartialJson(full.slice(0, i));
      expect(got.length).toBeGreaterThanOrEqual(previous.length);
      expect(got.slice(0, previous.length)).toEqual(previous);
      previous = got;
    }
    expect(previous).toEqual(["First point here.", 'Second point, with a "quote".', "Third."]);
  });

  it("agrees with JSON.parse once the document is complete", () => {
    // The streamed view and the final authoritative parse must never disagree
    // about what the answer was — otherwise the card rewrites itself at the
    // moment the request finishes.
    const full = '{"points":["a","b \\u2014 c","d\\\\e"],"cues":["x"],"type":"general"}';
    expect(pointsFromPartialJson(full)).toEqual(JSON.parse(full).points);
  });
});
