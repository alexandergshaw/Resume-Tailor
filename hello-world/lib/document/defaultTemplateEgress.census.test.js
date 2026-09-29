// N97 (4b) — the EGRESS CALL-SITE CENSUS (plan R1 headline + R5). This is a
// DELIBERATE source-text reachability census, not a prose assertion: the
// mechanism test (docx.defaultTemplateOverride.test.js) proves the override
// WORKS when the params are passed; this file proves each current-session
// egress SURFACE actually passes them, and that the past-application /
// re-download surfaces do NOT (non-retroactivity). It is the exact instrument
// for the N64 failure class the brief names: "wires the override at one egress
// but MISSES another" — a missed surface reds HERE, per surface.
//
// The census strips comments before scanning (loop-traps: prose citing a
// symbol is otherwise read as using it), using the repo's shared
// stripComments. `formattingTemplate` / `coverFormattingTemplate` are params
// N97 introduces, so their presence in a file's CODE = that surface is wired.
//
// RED-on-HEAD: none of the current-session egress files reference the params
// today (canaried: grep -> 0). Green-on-HEAD and green-post-impl: the
// past-application surfaces never reference them.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";

const HELLO_WORLD = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function code(relPath) {
  const src = readFileSync(resolve(HELLO_WORLD, relPath), "utf8");
  return stripComments(src, { label: relPath });
}
const hasParam = (relPath) => /\bformattingTemplate\b/.test(code(relPath));

// The four current-session egress surfaces (plan §4 Step 4 / C3): a fresh
// generation of a type, downloaded or Drive-saved in THIS session, must adopt
// the stored default. Each is pinned so a missed surface is visible.
const CURRENT_SESSION_EGRESS = [
  ["modal download (useDocumentPreview)", "app/hooks/useDocumentPreview.js"],
  ["Drive save (useDriveDocuments)", "app/hooks/useDriveDocuments.js"],
  ["post-generation auto-download (page.js:2081/2591)", "app/page.js"],
];

// Past-application / chip re-download surfaces (C3): re-downloading a
// previously-sent application must NOT adopt a newly-set default (R5).
const RETROACTIVE_SURFACES = [
  ["tracking ApplicationCard", "app/components/tracking/ApplicationCard.js"],
  ["tracking TrackingTab", "app/components/TrackingTab.js"],
  ["status-bar chip (StatusBar)", "app/components/StatusBar.js"],
];

// ---------------------------------------------------------------------------
// INSTRUMENT CANARY — prove the reader discriminates (loop-traps: prove both
// ways by execution) before trusting any pass/fail below.
// ---------------------------------------------------------------------------
describe("census instrument canary", () => {
  it("stripComments blanks a comment mention but keeps a code identifier", () => {
    const inComment = stripComments("// formattingTemplate goes here\nconst x = 1;");
    const inCode = stripComments("const args = { formattingTemplate: t };");
    expect(/\bformattingTemplate\b/.test(inComment), "a COMMENT mention must not count as usage").toBe(false);
    expect(/\bformattingTemplate\b/.test(inCode), "a CODE identifier must survive stripping").toBe(true);
  });

  it("the reader really reads each surface file (a known token is present today)", () => {
    // If a path were wrong, readFileSync would throw; these known tokens also
    // prove the file is the intended one, not an empty read.
    expect(code("app/hooks/useDocumentPreview.js")).toMatch(/buildDownloadArgs/);
    expect(code("app/hooks/useDriveDocuments.js")).toMatch(/previewBlobArgs|buildPreviewBlob/);
    expect(code("app/page.js")).toMatch(/downloadDocxFiles/);
  });
});

// ---------------------------------------------------------------------------
// R1 — every current-session egress surface passes the default (RED on HEAD).
// ---------------------------------------------------------------------------
describe("R1 — the default reaches EVERY current-session egress surface", () => {
  for (const [label, path] of CURRENT_SESSION_EGRESS) {
    it(`${label} threads a formattingTemplate (RED on HEAD)`, () => {
      expect(hasParam(path), `${path} does not wire the default template into its egress build`).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// R5 — past-application / chip re-download surfaces do NOT adopt the default
// (green on HEAD and post-impl; non-retroactivity).
// ---------------------------------------------------------------------------
describe("R5 — re-downloading a past application does not adopt a newly-set default", () => {
  for (const [label, path] of RETROACTIVE_SURFACES) {
    it(`${label} never references the override param (invariant)`, () => {
      expect(hasParam(path), `${path} must not thread a default template into a past-application re-download`).toBe(false);
    });
  }
});
