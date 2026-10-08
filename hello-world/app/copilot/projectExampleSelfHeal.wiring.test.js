// N143 fix round F2 (M2): the self-heal chain is wired at its PRODUCTION call
// sites. noteRowOneStatus (useApplicationProjectPool) is behaviour-tested in
// app/hooks/useApplicationProjectPool.selfHeal.test.js, and each producer's
// report is behaviour-tested beside it. What no behavioural test reaches is the
// join: the clients that mount the pool hook must hand its noteRowOneStatus to
// the hooks that draft answers. A value that exists at both ends and is dropped
// in the middle leaves every unit test green and the card warming forever, so
// the join is pinned off the source of the real mounting files (comments
// stripped, and the argument object located with a balanced scan so a nested
// brace cannot end it early).
//
// The chain, per mode:
//   live      CopilotClient -> useLiveSession -> useDraftAnswer
//   practice  PracticeClient -> useSampleAnswer
//                            -> useRoomQuestions

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../lib/sourceScan/tokenizeSource.js";

function read(rel) {
  return stripComments(readFileSync(path.resolve(process.cwd(), rel), "utf8"));
}

// The text of the call starting at `marker` (which must end in the opening
// paren), through its matching close paren.
function callExpression(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

const CLIENT = read("app/copilot/CopilotClient.js");
const PRACTICE = read("app/copilot/practice/PracticeClient.js");
const LIVE_SESSION = read("app/copilot/useLiveSession.js");

describe("[canary] the call extractor finds real, non-empty calls in the mounting files", () => {
  it("finds the pool hook, the session hook and the two practice producers", () => {
    for (const [src, marker] of [
      [CLIENT, "useApplicationProjectPool("],
      [CLIENT, "useLiveSession("],
      [PRACTICE, "useApplicationProjectPool("],
      [PRACTICE, "useSampleAnswer("],
      [PRACTICE, "useRoomQuestions("],
      [LIVE_SESSION, "useDraftAnswer("],
    ]) {
      const call = callExpression(src, marker);
      expect(call, marker).not.toBeNull();
      expect(call.length, marker).toBeGreaterThan(marker.length + 4);
    }
  });
});

// The relay is created BEFORE the producers and bound AFTER the pool hook, in
// that order: a bind that precedes the relay, or sits above the pool hook it
// binds, is a use-before-define the build would only catch for the first.
function indexOfCode(src, needle) {
  const at = src.indexOf(needle);
  expect(at, needle).toBeGreaterThan(-1);
  return at;
}

describe("live mode: CopilotClient relays noteRowOneStatus into the drafts", () => {
  it("creates a stable relay from the shared relay hook", () => {
    expect(CLIENT).toMatch(/const \{ onRowOneStatus, bindRowOneStatus \} = useRowOneStatusRelay\(\);/);
  });

  it("hands the relay to useLiveSession", () => {
    const call = callExpression(CLIENT, "useLiveSession(");
    expect(call).toMatch(/\bonRowOneStatus,/);
  });

  it("points the relay at the pool hook's noteRowOneStatus, after both exist", () => {
    expect(CLIENT).toMatch(/const \{ noteRowOneStatus \} = useApplicationProjectPool\(/);
    expect(CLIENT).toMatch(/useBindRowOneStatus\(bindRowOneStatus, noteRowOneStatus\);/);
    expect(indexOfCode(CLIENT, "useRowOneStatusRelay();")).toBeLessThan(indexOfCode(CLIENT, "useLiveSession("));
    expect(indexOfCode(CLIENT, "useApplicationProjectPool(")).toBeLessThan(indexOfCode(CLIENT, "useBindRowOneStatus("));
  });

  it("useLiveSession accepts it and passes it on to useDraftAnswer", () => {
    expect(LIVE_SESSION).toMatch(/\n\s*onRowOneStatus,\s*\n\}\) \{/);
    const call = callExpression(LIVE_SESSION, "useDraftAnswer(");
    expect(call).toMatch(/\bonRowOneStatus,/);
  });
});

describe("practice mode: PracticeClient relays noteRowOneStatus into both producers", () => {
  it("creates the stable relay and points it at the pool hook's noteRowOneStatus, after both exist", () => {
    expect(PRACTICE).toMatch(/const \{ onRowOneStatus, bindRowOneStatus \} = useRowOneStatusRelay\(\);/);
    expect(PRACTICE).toMatch(/const \{ noteRowOneStatus \} = useApplicationProjectPool\(/);
    expect(PRACTICE).toMatch(/useBindRowOneStatus\(bindRowOneStatus, noteRowOneStatus\);/);
    expect(indexOfCode(PRACTICE, "useRowOneStatusRelay();")).toBeLessThan(indexOfCode(PRACTICE, "useRoomQuestions("));
    expect(indexOfCode(PRACTICE, "useApplicationProjectPool(")).toBeLessThan(indexOfCode(PRACTICE, "useBindRowOneStatus("));
  });

  it("hands the relay to the sample answer and to the room-question detector", () => {
    expect(callExpression(PRACTICE, "useSampleAnswer(")).toMatch(/\bonRowOneStatus,/);
    expect(callExpression(PRACTICE, "useRoomQuestions(")).toMatch(/\bonRowOneStatus,/);
  });
});

describe("each producer actually reports through the callback it is handed", () => {
  it.each([
    ["app/copilot/useDraftAnswer.js"],
    ["app/copilot/practice/useSampleAnswer.js"],
    ["app/copilot/practice/useRoomQuestions.js"],
  ])("%s calls onRowOneStatusRef.current with the application and the status", (rel) => {
    expect(read(rel)).toMatch(/onRowOneStatusRef\.current\?\.\([^)]*status\)/);
  });
});
