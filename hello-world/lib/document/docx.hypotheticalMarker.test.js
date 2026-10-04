// N105 Step 2 (4b) — the HYPOTHETICAL filename marker choke point (K1 / AC-3).
// Binds to: N105.plan.r2.md Step 2 + PL-4; N105.design.r2.md §6 + D-8 (amended
// to a PREFIX, N105.ux.r2.md §A / OC-3); N105.ac.r2.md AC-3; UX-41; U27.
//
// WHY THIS IS A POWER ROW (K1, SILENT). N101 proved (executed mutation) that a
// WHOLE-FILE regex census over docx.js greens while a mutant drops the marker on
// ONE call site — the hypothetical's file then leaves under a submittable name.
// So every assertion below drives a SINGLE named resolver through its real
// filename resolution and asserts the marker on THAT site alone; the per-site
// mutant (named in each block's comment) reds only that site. The whole-file
// census is explicitly NOT the instrument.
//
// These use the module namespace (not named imports) so HEAD collects cleanly:
// on HEAD `ensureHypotheticalMarker`/`HYPOTHETICAL_TOKEN` are undefined and the
// `isHypothetical` param is ignored, so each assertion reds at the test level
// (an absent branch), never at import time.

import { describe, it, expect } from "vitest";
import * as docx from "./docx.js";
import { driveDocName } from "../drive/driveNames.js";
import { resolveActiveDocumentTitle } from "../tailor/documentScopes.js";

// UX-41 / D-8 amended: the token is the FIRST token of the name. The exact
// separator ("[HYPOTHETICAL] ", "HYPOTHETICAL - ", …) is the implementer's call,
// so the discriminator is "begins with the token", not an exact string.
const BEGINS_WITH_TOKEN = /^[^A-Za-z0-9]*HYPOTHETICAL/;

describe("ensureHypotheticalMarker + HYPOTHETICAL_TOKEN (the single idempotent forcing fn)", () => {
  it("exports the token constant literally 'HYPOTHETICAL'", () => {
    expect(docx.HYPOTHETICAL_TOKEN).toBe("HYPOTHETICAL");
  });

  it("prefixes the token when isHypothetical and absent; is a no-op when false", () => {
    const marked = docx.ensureHypotheticalMarker("Acme - Dev - Resume.docx", true);
    expect(marked).toMatch(BEGINS_WITH_TOKEN);
    expect(docx.ensureHypotheticalMarker("Acme - Dev - Resume.docx", false)).toBe(
      "Acme - Dev - Resume.docx",
    );
  });

  // IDEMPOTENCY (U27): applying twice changes nothing — layering egresses is safe.
  it("is idempotent: applying twice equals applying once", () => {
    const once = docx.ensureHypotheticalMarker("Acme - Dev - Resume.docx", true);
    const twice = docx.ensureHypotheticalMarker(once, true);
    expect(twice).toBe(once);
    // Exactly one occurrence of the token.
    expect((twice.match(/HYPOTHETICAL/g) || []).length).toBe(1);
  });
});

describe("per-call-site: the hypothetical's filename BEGINS with the marker at every egress", () => {
  // SITE 1 — getDownloadFileNameForTitle (the common base buildDocumentFileName,
  // Resume kind). Mutant: drop the isHypothetical thread into buildDocumentFileName
  // -> this reds, the resolveDocumentFileName site below stays green.
  it("getDownloadFileNameForTitle(..., isHypothetical=true) begins with the marker", () => {
    expect(docx.getDownloadFileNameForTitle("Dev Role", "Acme", true)).toMatch(BEGINS_WITH_TOKEN);
  });

  // SITE 1b — the CL variant (param in place even though the hypothetical is
  // resume-only, so the obligation is structural — design §6).
  it("getDownloadCoverLetterFileNameForTitle(..., isHypothetical=true) begins with the marker", () => {
    expect(docx.getDownloadCoverLetterFileNameForTitle("Dev Role", "Acme", true)).toMatch(
      BEGINS_WITH_TOKEN,
    );
  });

  // SITE 2 — resolveDocumentFileName NO-OVERRIDE branch. Mutant: drop the thread
  // on the final return -> this + the override case below red, SITE 1 stays green.
  it("resolveDocumentFileName no-override begins with the marker", () => {
    expect(docx.resolveDocumentFileName("", "Dev Role", "Acme", "Resume", true)).toMatch(
      BEGINS_WITH_TOKEN,
    );
  });

  // SITE 2b — resolveDocumentFileName OVERRIDE branch (a user-typed name bypasses
  // buildDocumentFileName, so the marker must be forced on the FINAL return).
  it("resolveDocumentFileName WITH a user override still begins with the marker", () => {
    expect(docx.resolveDocumentFileName("My Custom Name", "Dev Role", "Acme", "Resume", true)).toMatch(
      BEGINS_WITH_TOKEN,
    );
  });

  // U27 — a 150-char override is sliced; a PREFIX survives the slice in either
  // application order, a suffix would not. This is why OC-3 made it a prefix.
  it("resolveDocumentFileName with a 200-char override still begins with the marker (survives the .slice(0,150))", () => {
    const longName = "x".repeat(200);
    expect(docx.resolveDocumentFileName(longName, "Dev Role", "Acme", "Resume", true)).toMatch(
      BEGINS_WITH_TOKEN,
    );
  });

  // SITE 3 — driveDocName, BOTH branches (Drive strips ".docx"; a leading token
  // survives the strip). Mutant: force the marker on only one driveDocName
  // branch -> the other branch's assertion reds alone.
  it("driveDocName no-override branch begins with the marker", () => {
    const name = driveDocName({ override: "", jobTitle: "Dev Role", company: "Acme", kind: "Resume", isHypothetical: true });
    expect(name).toMatch(BEGINS_WITH_TOKEN);
  });

  it("driveDocName override branch begins with the marker", () => {
    const name = driveDocName({ override: "My Doc", jobTitle: "Dev Role", company: "Acme", kind: "Resume", isHypothetical: true });
    expect(name).toMatch(BEGINS_WITH_TOKEN);
  });

  // SITE 4 — resolveActiveDocumentTitle (documentScopes), the copy-filename egress.
  it("resolveActiveDocumentTitle(..., isHypothetical=true) begins with the marker", () => {
    const title = resolveActiveDocumentTitle("", "", "Dev Role", "Acme", "Resume", true);
    expect(title).toMatch(BEGINS_WITH_TOKEN);
  });
});

describe("AC-17 default-false canary: non-N105 callers are byte-identical to today", () => {
  // These PASS on HEAD and must stay green after the thread lands — the control
  // that the additive `isHypothetical=false` param changes no existing caller.
  it("getDownloadFileNameForTitle with no flag is unchanged and has no marker", () => {
    const name = docx.getDownloadFileNameForTitle("Dev Role", "Acme");
    expect(name).toBe("Acme - Dev Role - Resume.docx");
    expect(name).not.toMatch(/HYPOTHETICAL/);
  });

  it("resolveDocumentFileName with no flag is unchanged and has no marker", () => {
    const name = docx.resolveDocumentFileName("", "Dev Role", "Acme", "Resume");
    expect(name).toBe("Acme - Dev Role - Resume.docx");
    expect(name).not.toMatch(/HYPOTHETICAL/);
  });

  it("driveDocName with no flag is unchanged and has no marker", () => {
    const name = driveDocName({ override: "", jobTitle: "Dev Role", company: "Acme", kind: "Resume" });
    expect(name).toBe("Acme - Dev Role - Resume");
    expect(name).not.toMatch(/HYPOTHETICAL/);
  });
});

describe("per-call-site CENSUS (N101 G1/G2 fix — NOT a whole-file regex)", () => {
  // The structural backstop to the behavioral tests above: assert the marker
  // forcing is applied in the NEIGHBOURHOOD of each named forcing function in
  // docx.js, comment-stripped, so a comment citing the function cannot satisfy
  // it (loop-traps-tests: "prose citing a module is read as using it"). This is
  // a sweep, not a prose assertion, and it carries its own canary.
  it("ensureHypotheticalMarker is invoked within buildDocumentFileName and resolveDocumentFileName", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./docx.js", import.meta.url)), "utf8");
    // Strip line and block comments so a "// see ensureHypotheticalMarker" note
    // does not count as usage.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    // Canary: the sweep can find a real reference where one is expected.
    expect(code).toMatch(/ensureHypotheticalMarker/);

    const sliceAround = (anchor) => {
      const i = code.indexOf(anchor);
      return i === -1 ? "" : code.slice(i, i + 400);
    };
    expect(sliceAround("function buildDocumentFileName")).toMatch(/ensureHypotheticalMarker/);
    expect(sliceAround("function resolveDocumentFileName")).toMatch(/ensureHypotheticalMarker/);
  });
});
