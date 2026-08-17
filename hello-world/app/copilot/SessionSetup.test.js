// Regression pass, defect 2. SessionSetup.js has no test coverage today —
// CopilotClient.wiring.test.js deliberately stubs it out rather than
// mounting the real thing (see that file's own comment: a real SessionSetup
// drags in PostingPicker's network calls for a fact groundingNotice.test.js
// already has its own dedicated surface for). A full render is therefore
// disproportionate just to pin one sentence; a source-text check — the same
// tool CopilotClient.extraction.test.js already uses for "is this piece
// actually wired up, not just present somewhere" — is the right size here.
//
// What this guards: SessionSetup's own recording-consent Alert used to
// append, unconditionally, "Asking to research the company during the
// session also sends its name, this job's title and the posting text for
// that search." That is FALSE on the embedded engine — app/api/
// company-research/route.js's embedded branch calls
// `researchCompanyLocal({ company, jobTitle })` with no `posting` at all —
// and named no recipient at all on the other. Fixed by reusing
// `companyResearchDestination` (lib/copilot/groundingNotice.js), which is
// already pinned by literal-string oracles in groundingNotice.test.js and
// already used the same way by VoiceCueSidebar.js/CompanyBriefPanel.js.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./SessionSetup.js", import.meta.url)), "utf8");

describe("SessionSetup's recording notice reuses the honest, engine-aware company-research disclosure (defect 2)", () => {
  it("imports and calls companyResearchDestination rather than hardcoding a third claim", () => {
    expect(SOURCE).toMatch(/import \{ companyResearchDestination \} from "@\/lib\/copilot\/groundingNotice"/);
    // Called with `isEmbedded` — the one fact this file has no other source
    // for, and the one the old sentence got wrong.
    expect(SOURCE).toMatch(/companyResearchDestination\(\{\s*isEmbedded/);
  });

  it("no longer makes the old claim that named no recipient and always claimed the posting text", () => {
    expect(SOURCE).not.toMatch(/also sends its name, this job's title and the posting text for that search/);
  });

  it("interpolates the shared, engine-aware notice into BOTH recording-notice branches (in-person and tab/system)", () => {
    // Both branches carry the cue disclosure (AC-T2.14/E2: "not
    // audio-source-specific") — a fix landing in only one branch would leave
    // the other one still making the old, engine-blind claim.
    const matches = SOURCE.match(/\$\{companyResearchNotice\}/g) || [];
    expect(matches.length).toBe(2);
  });

  it("takes isEmbedded as a prop rather than guessing engine state itself", () => {
    expect(SOURCE).toMatch(/isEmbedded,?\s*\n/);
  });
});
