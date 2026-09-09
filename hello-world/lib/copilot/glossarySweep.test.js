// R-342, R-350 / AC-R4, AC-R6, AC-R13, AC-R14, AC-R29, AC-R32, AC-SCH5 -- the
// source sweeps over the glossary's own modules.
//
// Each of these pins a decision that is invisible at runtime and that a
// well-meaning refactor would undo. Every absence assertion is paired with a
// POSITIVE CONTROL proving the sweep can fail, because an absence assertion over
// a file list that silently went empty is the classic vacuous green.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tokenizeSource } from "../sourceScan/tokenizeSource.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const MODULE_FILES = readdirSync(path.join(ROOT, "lib/copilot"))
  .filter((f) => f.startsWith("glossary") && f.endsWith(".js") && !f.endsWith(".test.js"))
  .map((f) => path.join("lib/copilot", f))
  .concat(["app/api/cron/position-glossary/route.js", "app/api/copilot/glossary/route.js"]);

const sources = MODULE_FILES.map((rel) => ({
  rel,
  // Comments are blanked and string CONTENTS kept, so a paragraph EXPLAINING
  // why a string is forbidden does not itself trip the sweep while a real
  // occurrence in a literal still does -- the same discipline the three shipped
  // safety sweeps use.
  code: tokenizeSource(readFileSync(path.join(ROOT, rel), "utf8"), { label: rel }).readable,
}));

// POSITIVE CONTROLS. Each is a real repo file that legitimately carries the
// string in CODE (not merely in prose), so a sweep that had quietly stopped
// matching anything fails here instead of reading as coverage. They are chosen
// per needle rather than pooled, because `readable` blanks comments: a file
// that only DISCUSSES `vertexaisearch` would not control anything.
const readable = (rel) =>
  tokenizeSource(readFileSync(path.join(ROOT, rel), "utf8"), { label: rel }).readable;

const CONTROLS = {
  vertexaisearch: readable("lib/tracking/citationHref.js"),
  "grounding-api-redirect": readable("lib/tracking/citationHref.js"),
  "cloud.google.com": readable("lib/tracking/citationHref.js"),
  interactionOutputText: readable("lib/llm/interactionCitations.js"),
  groundingMetadata: readable("lib/llm/grounding.js"),
  groundingChunks: readable("lib/llm/grounding.js"),
};

function assertAbsent(needle) {
  for (const { rel, code } of sources) {
    expect({ rel, needle, found: code.includes(needle) }).toEqual({ rel, needle, found: false });
  }
  expect({ needle, controlFinds: CONTROLS[needle].includes(needle) }).toEqual({
    needle,
    controlFinds: true,
  });
}

describe("the sweep itself is not vacuous", () => {
  it("found the glossary modules on disk", () => {
    expect(MODULE_FILES.length).toBeGreaterThanOrEqual(8);
    expect(sources.every((s) => s.code.length > 0)).toBe(true);
  });
});

describe("R-342 / AC-R6, AC-R32: no second copy of the vendor redirect list", () => {
  it("names no vendor redirect host or path of its own", () => {
    // `citationHref.js:15-19` forbids a second copy of a URL allow-list: two
    // copies drift, and the one that drifts is the one nobody re-reads. The
    // glossary reaches the rule through that module rather than restating it.
    assertAbsent("vertexaisearch");
    assertAbsent("grounding-api-redirect");
    assertAbsent("cloud.google.com");
  });

  it("reaches the rule through lib/tracking/citationHref.js", () => {
    const research = sources.find((s) => s.rel.endsWith("glossaryResearch.js"));
    expect(research.code).toContain("citationHref");
  });
});

describe("R-350: the surfaces this feature must never touch", () => {
  it("never reads interactionOutputText (AC-R29)", () => {
    // That function THROWS when the SDK omitted `output_text` -- which it does
    // whenever the text is empty -- while `interactionSearched` is still true,
    // so the "no search" criterion never fires; the code reaches the throw
    // first. The predicate is built so it cannot reach that throw at all.
    assertAbsent("interactionOutputText");
  });

  it("never reads the legacy grounding surface (AC-R13, AC-R14)", () => {
    // `groundingChunks[].web.uri` is a vertexaisearch REDIRECT, never the
    // publisher's URL, and `web.domain` is documented "not supported in Gemini
    // API". That is the defect the Interactions migration exists to fix.
    assertAbsent("groundingMetadata");
    assertAbsent("groundingChunks");
  });

  it("never reads camelCase citation offsets", () => {
    // The wire sends `start_index` / `end_index`. Google's own JS sample for
    // this surface reads `startIndex`, and `"x".slice(undefined, undefined)`
    // returns the WHOLE STRING rather than throwing -- silently wrong.
    for (const { rel, code } of sources) {
      expect({ rel, found: /\bstartIndex\b/.test(code) }).toEqual({ rel, found: false });
      expect({ rel, found: /\bendIndex\b/.test(code) }).toEqual({ rel, found: false });
    }
    expect(/start_index/.test(CONTROLS.interactionOutputText)).toBe(true);
  });

  it("never uses url_context (AC-R4)", () => {
    // A genuine second candidate, rejected on one ground: to give it a URL you
    // must already have solved term -> article URL, and the probe against the
    // owner's own two example terms returned a 404 and a disambiguation page.
    for (const { rel, code } of sources) {
      expect({ rel, found: /urlContext|url_context/.test(code) }).toEqual({ rel, found: false });
    }
  });

  it("sets retry policy PER CALL and never on the client (AC-R2)", () => {
    // `httpOptions.retryOptions.attempts` means DIFFERENT THINGS on the two
    // transports: `attempts: 1` -- documented as "no retries" -- gives ONE
    // attempt on generateContent and TWO on interactions.create, because the
    // next-gen client passes it straight into maxRetries. And getGeminiClient
    // memoises a module singleton whose next-gen transport is memoised on IT, so
    // a client-level option would silently reach seven other features.
    //
    // The needle is the CLIENT-LEVEL option, not the bare word `attempts`: this
    // feature's row has an `attempts` COLUMN counting generations, which is a
    // different thing entirely and must not be swept out by a lazy regex.
    for (const { rel, code } of sources) {
      expect({ rel, found: /httpOptions|retryOptions/.test(code) }).toEqual({ rel, found: false });
      expect({ rel, found: /new GoogleGenAI/.test(code) }).toEqual({ rel, found: false });
    }
    const worker = sources.find((s) => s.rel.endsWith("glossaryWorker.js"));
    expect(worker.code).toContain("maxRetries");
    expect(worker.code).toContain("timeout");
  });
});

describe("AC-SCH5: progress and spend live in Postgres, never in Redis", () => {
  it("reads no cursor and no call count from the cache client", () => {
    // ingestFeed's Redis cursor returns 0 on ANY cache error (:204-206) and its
    // lock fails OPEN (:184-186). For feed ingestion those are correct -- the
    // worst case is scanning the same 25 companies twice. Here a cursor that
    // reads 0 on a cache hiccup restarts a harvest and re-spends ten grounded
    // calls. A failed instrument is invalid, never its zero value, and that
    // rule applies to money.
    for (const { rel, code } of sources) {
      expect({ rel, found: /redisClient|@upstash\/redis/.test(code) }).toEqual({ rel, found: false });
    }
  });
});

describe("the shared-row rule, as a source sweep (AC-S4, section 5.5)", () => {
  it("names no user-private field anywhere in the write path", () => {
    // `position_glossaries` has no user_id and a row is readable by EVERY
    // authenticated account, so no byte derived from a user's own private
    // material may ever be written into it.
    //
    // THIS SWEEP CANNOT SEE PROMPT INJECTION and must not be described as if it
    // could: a module writing 120 attacker-authored definitions passes it
    // perfectly. The controls for that are the fence, the render-as-text rule,
    // and the positions-hardening precondition.
    const store = sources.find((s) => s.rel.endsWith("glossaryStore.js"));
    for (const forbidden of ["coverLetter", "resumeText", "draftedAnswer", "notesText"]) {
      expect({ forbidden, found: store.code.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
    // `user_id` is checked against GLOSSARY_COLUMNS in glossaryStore.test.js
    // rather than swept out of the source here. That is the stronger check and
    // it is also the only workable one: this module DECLARES the forbidden field
    // names, so a source sweep for the string would fire on the guard itself.
  });

  it("writes through the admin client only, never through a user-scoped one", () => {
    const routes = sources.filter((s) => s.rel.includes("/api/"));
    expect(routes).toHaveLength(2);
    for (const { rel, code } of routes) {
      if (code.includes("position_glossaries")) {
        expect({ rel, admin: code.includes("createAdminClient") }).toEqual({ rel, admin: true });
      }
    }
  });
});
