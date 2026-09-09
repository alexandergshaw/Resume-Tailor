// THE SHARED REQUEST PROLOGUE, and the drift test that is the whole point of
// extracting it.
//
// The answer context cache is keyed `${userId}::${applicationId}` off a value
// the answer route normalises with
// `(body?.applicationId ?? "").toString().trim().slice(0, MAX_APPLICATION_ID_CHARS)`.
// A second route that writes `String(body.applicationId)`, or drops the
// `.trim()`, or omits the cap, computes a DIFFERENT key. Nothing breaks
// visibly: every expansion just misses the cache forever and pays a full
// Supabase fan-out, which is seven round trips, so five expansions cost
// thirty-five queries instead of zero.
//
// Extraction would normally be the structural guarantee here, but this chunk
// is not permitted to modify app/api/copilot/answer/route.js. So the guarantee
// is the next best thing that is still mechanical rather than a comment saying
// "keep these in sync": this module owns the normalisation, and the test below
// READS THE ANSWER ROUTE'S SOURCE and fails if its normalisation stops
// matching. A comment cannot do that; this can.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MAX_QUESTION_CHARS } from "./questionVocabulary.js";
import {
  MAX_APPLICATION_ID_CHARS,
  MAX_PROFILE_CHARS,
  answerRequestFields,
} from "./answerRequestPrologue.js";

const ROUTE = readFileSync(
  fileURLToPath(new URL("../../app/api/copilot/answer/route.js", import.meta.url)),
  "utf8",
);

describe("answerRequestFields — the same normalisation the answer route performs", () => {
  it("trims and caps applicationId exactly as the answer route does", () => {
    expect(answerRequestFields({ applicationId: "  app-1  " }).applicationId).toBe("app-1");
    expect(answerRequestFields({ applicationId: "x".repeat(500) }).applicationId).toHaveLength(
      MAX_APPLICATION_ID_CHARS,
    );
  });

  it("refuses to coerce a non-string into an id", () => {
    // The answer route's `.toString()` would turn `{}` into "[object Object]"
    // and cache under it. This route is newer and takes the stricter posture
    // the question-vocabulary module takes: refuse, do not coerce.
    expect(answerRequestFields({ applicationId: {} }).applicationId).toBe("");
    expect(answerRequestFields({ applicationId: 7 }).applicationId).toBe("");
    expect(answerRequestFields(null).applicationId).toBe("");
  });

  it("trims and caps the question, and caps the profile", () => {
    expect(answerRequestFields({ question: "  Tell me about a failure.  " }).question).toBe(
      "Tell me about a failure.",
    );
    expect(answerRequestFields({ question: "q".repeat(9000) }).question).toHaveLength(MAX_QUESTION_CHARS);
    expect(answerRequestFields({ profile: "p".repeat(20000) }).profile).toHaveLength(MAX_PROFILE_CHARS);
  });

  it("normalises interviewType and codeLanguage through the shared normalisers", () => {
    const fields = answerRequestFields({ interviewType: "not-a-type", codeLanguage: "not-a-language" });
    expect(typeof fields.interviewType).toBe("string");
    expect(fields.interviewType).not.toBe("not-a-type");
    expect(typeof fields.codeLanguage).toBe("string");
    expect(fields.codeLanguage).not.toBe("not-a-language");
  });

  it("reads no grounding from the body", () => {
    // The answer route fetches the resume and cover letter ITSELF and never
    // reads a client-supplied one, so a client cannot inject arbitrary text
    // labelled "submitted resume". This module must not open that door.
    const fields = answerRequestFields({ resume: "INJECTED", coverLetter: "INJECTED", pages: ["INJECTED"] });
    expect(Object.values(fields).join(" ")).not.toContain("INJECTED");
    expect(Object.keys(fields).sort()).toEqual(
      ["applicationId", "codeLanguage", "interviewType", "profile", "question"].sort(),
    );
  });

  it("never throws on junk", () => {
    expect(() => answerRequestFields(undefined)).not.toThrow();
    expect(() => answerRequestFields("nonsense")).not.toThrow();
    expect(() => answerRequestFields({ question: [] })).not.toThrow();
  });
});

describe("the drift guard — the answer route still normalises the same way", () => {
  // If any of these goes red, the answer route changed its normalisation and
  // this module has to follow, or every expansion silently starts missing the
  // shared context cache.
  it("still caps applicationId at 100 and trims it", () => {
    expect(ROUTE).toContain("const MAX_APPLICATION_ID_CHARS = 100;");
    expect(ROUTE).toContain(
      'const applicationId = (body?.applicationId ?? "").toString().trim().slice(0, MAX_APPLICATION_ID_CHARS);',
    );
    expect(MAX_APPLICATION_ID_CHARS).toBe(100);
  });

  it("still caps the profile at 8000", () => {
    expect(ROUTE).toContain("const MAX_PROFILE_CHARS = 8000;");
    expect(MAX_PROFILE_CHARS).toBe(8000);
  });

  it("still keys the context cache on the normalised id", () => {
    expect(ROUTE).toContain("answerContextKey(user.id, applicationId)");
  });

  it("[control] the drift guard can actually fail", () => {
    expect(ROUTE).not.toContain("const MAX_APPLICATION_ID_CHARS = 101;");
  });
});
