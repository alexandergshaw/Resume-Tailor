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

// §A.6, AC-A24/A25 — allocated to this file because CopilotClient.wiring.test.js
// deliberately mocks SessionSetup wholesale (a real render drags in
// PostingPicker's network calls), so nothing else in the tree reads this
// component's own source at all. A source-text check cannot pin the
// accessible name or the rendered reading order (that stays manual, R-269),
// but it CAN pin that the picker is wired in above PostingPicker and that
// the collapsed summary's own template literal names all three facts in the
// right order.
describe("the shared interview type is wired into SessionSetup (AC-A24/A25)", () => {
  it("takes interviewType/onInterviewTypeChange/interviewTypeLabel as props", () => {
    expect(SOURCE).toMatch(/\binterviewType\s*,/);
    expect(SOURCE).toMatch(/\bonInterviewTypeChange\s*,/);
    expect(SOURCE).toMatch(/\binterviewTypeLabel\s*,/);
  });

  it("imports InterviewTypePicker and renders it ABOVE PostingPicker", () => {
    expect(SOURCE).toMatch(/import InterviewTypePicker from "\.\/InterviewTypePicker"/);
    const pickerAt = SOURCE.indexOf("<InterviewTypePicker");
    const postingAt = SOURCE.indexOf("<PostingPicker");
    expect(pickerAt).toBeGreaterThan(-1);
    expect(postingAt).toBeGreaterThan(-1);
    expect(pickerAt).toBeLessThan(postingAt);
  });

  it("passes the shared value and callback straight through, enabled", () => {
    expect(SOURCE).toMatch(
      /<InterviewTypePicker\s+value=\{interviewType\}\s+onChange=\{onInterviewTypeChange\}\s+disabled=\{false\}\s*\/>/,
    );
  });

  it("does not convert the picker to a native <select> (prohibition 15)", () => {
    expect(SOURCE).not.toMatch(/<select[\s>]/);
  });

  it("wraps the disclosure glyph aria-hidden, and no longer inlines it into the button's own text", () => {
    expect(SOURCE).toMatch(/aria-hidden="true"/);
    // The old unwrapped form this replaces — its presence would mean the
    // glyph is still entering the button's computed accessible name.
    expect(SOURCE).not.toMatch(/"▾ Hide setup"/);
    expect(SOURCE).not.toMatch(/▸ Show setup/);
  });

  it("labels every fact in the collapsed summary (posting, interview type, mic) in that order", () => {
    expect(SOURCE).toMatch(
      /Show setup — Posting: \$\{postingSummary\} · Interview type: \$\{interviewTypeLabel\} · Mic: \$\{micLabel\}/,
    );
  });
});

// A-31 (chunk C, §B.6/§B.8): the code-language control's render gate and
// F-C2's deferred unmount both live inside CodeLanguageField, so this file
// gains one element and no hooks — its own "no hooks, no handlers, no
// derived values here" header (`:24-26`) stays literally true. A real render
// is disproportionate here for the same reason it is above (PostingPicker's
// network calls) — CodeLanguageField's own behaviour is pinned by
// CodeLanguageField.test.js, which mounts the real thing.
describe("the code-language control is wired into SessionSetup (§B.6, §B.8)", () => {
  it("takes codeLanguage/onCodeLanguageChange as props", () => {
    expect(SOURCE).toMatch(/\bcodeLanguage\s*,/);
    expect(SOURCE).toMatch(/\bonCodeLanguageChange\s*,/);
  });

  it("renders CodeLanguageField and passes all four of its props straight through", () => {
    expect(SOURCE).toMatch(/import CodeLanguageField from "\.\/CodeLanguageField"/);
    expect(SOURCE).toMatch(/<CodeLanguageField[\s\S]{0,240}interviewType=\{interviewType\}/);
    expect(SOURCE).toMatch(/<CodeLanguageField[\s\S]{0,240}isEmbedded=\{isEmbedded\}/);
    expect(SOURCE).toMatch(/<CodeLanguageField[\s\S]{0,240}value=\{codeLanguage\}/);
    expect(SOURCE).toMatch(/<CodeLanguageField[\s\S]{0,240}onChange=\{onCodeLanguageChange\}/);
  });

  it("sits between the interview-type picker and the posting picker, in that order", () => {
    const typeAt = SOURCE.indexOf("<InterviewTypePicker");
    const languageAt = SOURCE.indexOf("<CodeLanguageField");
    const postingAt = SOURCE.indexOf("<PostingPicker");

    expect(typeAt).toBeGreaterThan(-1);
    expect(languageAt).toBeGreaterThan(-1);
    expect(postingAt).toBeGreaterThan(-1);

    const found = [typeAt, languageAt, postingAt];
    expect([...found].sort((a, b) => a - b)).toEqual(found);
  });

  it("does not edit the existing InterviewTypePicker or PostingPicker elements", () => {
    expect(SOURCE).toMatch(
      /<InterviewTypePicker\s+value=\{interviewType\}\s+onChange=\{onInterviewTypeChange\}\s+disabled=\{false\}\s*\/>/,
    );
  });
});
