// N105 Step 5 (4b) — scope vocabulary + bespoke hypothetical bytes (K4, D-9/D-9b).
// Binds to: N105.plan.r2.md Step 5 + PL-8; N105.design.r2.md §3 (M2) + D-9/D-9b;
// research F-3; AC-12a; AC-17.
//
// WHY K4 IS A POWER ROW (SILENT). `buildDownloadArgs` branches only on
// scope==="cover"; a new "hypothetical" scope falling through the else branch
// reads entry.docxB64 — the APPLICATION-READY's bytes — and serves the wrong
// document under the HYPOTHETICAL name (research F-3). The distinct-bytes fixture
// below reds exactly that.
//
// documentScopes.js EXISTS on HEAD, so these are test-level reds (SCOPES lacks
// "hypothetical"; buildDownloadArgs has no hypothetical branch), not collection
// failures — except where noted the D-9 controls PASS on HEAD and must stay green.

import { describe, it, expect } from "vitest";
import {
  SCOPES,
  SCOPE_LABEL,
  DOCX_SCOPES,
  buildDownloadArgs,
} from "./documentScopes.js";

describe("D-9 — DOCX_SCOPES stays ['resume','cover'] so combine/set-default/Drive refuse the hypothetical structurally", () => {
  // CONTROLS: green on HEAD, must STAY green — the structural refusal that keeps
  // the markerless hypothetical out of every shared-docx surface.
  it("DOCX_SCOPES is exactly ['resume','cover']", () => {
    expect(DOCX_SCOPES).toEqual(["resume", "cover"]);
  });

  it("'hypothetical' is NOT a member of DOCX_SCOPES", () => {
    expect(DOCX_SCOPES).not.toContain("hypothetical");
  });
});

describe("D-9 — the hypothetical is a first-class SCOPES/SCOPE_LABEL member (tab vocabulary)", () => {
  it("SCOPES includes 'hypothetical'", () => {
    expect(SCOPES).toContain("hypothetical");
  });

  it("SCOPE_LABEL carries a sentence label for the hypothetical", () => {
    expect(typeof SCOPE_LABEL.hypothetical).toBe("string");
    expect(SCOPE_LABEL.hypothetical.length).toBeGreaterThan(0);
  });

  // AC-17: the legacy scopes are untouched.
  it("keeps the legacy scopes and labels unchanged", () => {
    expect(SCOPES.slice(0, 3)).toEqual(["resume", "cover", "email"]);
    expect(SCOPE_LABEL.resume).toBe("Resume");
    expect(SCOPE_LABEL.cover).toBe("Cover letter");
    expect(SCOPE_LABEL.email).toBe("Hiring email");
  });
});

describe("D-9b / K4 — buildDownloadArgs hypothetical branch reads ONLY its own bytes", () => {
  const entry = {
    docxB64: "BYTES_APPLICATION_READY",
    docxPath: "path/app-ready.docx",
    hypotheticalDocxB64: "BYTES_HYPOTHETICAL",
    hypotheticalDocxPath: "path/hypothetical.docx",
    resumeFileName: "",
  };

  function hypoArgs() {
    return buildDownloadArgs({
      scope: "hypothetical",
      entry,
      text: "Hypothetical resume text",
      lines: ["Hypothetical resume text"],
      serveFinished: true,
      title: "Payments Engineer",
      company: "Acme",
      spacing: null,
      formattingTemplate: null,
      fileNameOverride: undefined,
    });
  }

  it("carries the HYPOTHETICAL bytes and NEVER the application-ready bytes", () => {
    const serialized = JSON.stringify(hypoArgs());
    expect(serialized).toContain("BYTES_HYPOTHETICAL");
    expect(serialized).not.toContain("BYTES_APPLICATION_READY");
  });

  it("carries the hypothetical's own docx path, not the application-ready's", () => {
    const serialized = JSON.stringify(hypoArgs());
    expect(serialized).toContain("path/hypothetical.docx");
    expect(serialized).not.toContain("path/app-ready.docx");
  });

  // CONTROL: the resume branch is unchanged (reads entry.docxB64) — proof the
  // hypothetical branch is additive, not a rewrite of the shared path (AC-17).
  it("the resume scope still reads entry.docxB64 (unchanged)", () => {
    const args = buildDownloadArgs({
      scope: "resume",
      entry,
      text: "Application-ready text",
      lines: ["Application-ready text"],
      serveFinished: true,
      title: "Payments Engineer",
      company: "Acme",
      spacing: null,
      formattingTemplate: null,
      fileNameOverride: undefined,
    });
    expect(args.templateDocxB64).toBe("BYTES_APPLICATION_READY");
  });
});
