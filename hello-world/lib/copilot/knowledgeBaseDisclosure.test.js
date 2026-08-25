// The privacy notice must name what is actually sent.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT, and it is one this codebase has
// shipped before and named BUG-H5: a new feature silently falsifying an
// existing disclosure. The notice enumerates what leaves the browser when a
// sample answer is revealed, and its no-posting branch reads "sends that
// question and your prep context to Gemini as well." The answer route now
// also sends, on every non-embedded reveal and regardless of whether a
// posting is selected:
//
//   - up to 12000 characters of the user's own project-page prose, and
//   - an INVENTORY OF THEIR ATTACHMENTS: file name, kind, and saved notes.
//
// The attachment inventory is a new CATEGORY of data, not more of an existing
// one, and file names are frequently sensitive in a way page bodies are not —
// "2024-severance-agreement.pdf", "offer-letter-competitor.pdf". A user
// reading the current sentence would not expect either to be sent.
//
// The clause must be UNCONDITIONAL. Gating it on whether the user has any
// pages would need a count the client does not have until after the first
// send, which is too late to disclose anything — the same reasoning
// practiceRoomQuestionPrivacy.js's own header already gives for its clause.

import { describe, it, expect } from "vitest";
import { buildPrivacyNotice } from "./practiceNotices.js";
import { roomQuestionPrivacyClause } from "@/app/copilot/practice/practiceRoomQuestionPrivacy.js";

const STATES = [
  { label: "no posting", hasPosting: false, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
  { label: "posting, docs not settled", hasPosting: true, docsSettled: false, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
  { label: "posting with resume", hasPosting: true, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: false },
  { label: "posting, no docs found", hasPosting: true, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
];

describe("the practice privacy notice discloses the knowledge base", () => {
  for (const state of STATES) {
    it(`names project pages and attachment file names — ${state.label}`, () => {
      const notice = buildPrivacyNotice({ isEmbedded: false, ...state });
      const text = JSON.stringify(notice).toLowerCase();
      expect(text).toContain("project page");
      // The genuinely new category. "Pages" alone does not tell a user their
      // file names are going too.
      expect(text).toMatch(/file name|attachment/);
    });
  }

  it("says none of it when no AI provider is involved at all", () => {
    // The embedded engine makes no model call, so disclosing a transfer that
    // does not happen would be its own kind of false.
    const notice = buildPrivacyNotice({
      isEmbedded: true,
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: false,
    });
    const text = JSON.stringify(notice).toLowerCase();
    expect(text).not.toContain("project page");
  });

  it("still says everything it said before about documents and prep context", () => {
    // Positive control: the new clause must be additive. A rewrite that
    // dropped an existing disclosure to make room would pass the cases above.
    const notice = buildPrivacyNotice({
      isEmbedded: false,
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: false,
    });
    const text = JSON.stringify(notice).toLowerCase();
    expect(text).toContain("prep context");
    expect(text).toContain("resume");
  });
});

describe("the room-question clause discloses it too", () => {
  it("names project pages and attachment file names on the Gemini path", () => {
    // Same route, same payload — a question asked aloud in the room drafts
    // through the identical draftAnswer call.
    const clause = roomQuestionPrivacyClause({
      isEmbedded: false,
      hasPosting: false,
      docsSettled: true,
      hasSubmittedResume: false,
      hasSubmittedCoverLetter: false,
    }).toLowerCase();
    expect(clause).toContain("project page");
    expect(clause).toMatch(/file name|attachment/);
  });

  it("says nothing of the sort on the embedded path", () => {
    const clause = roomQuestionPrivacyClause({
      isEmbedded: true,
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: true,
    }).toLowerCase();
    expect(clause).not.toContain("project page");
  });
});

// LIVE mode got none of this, and live mode sends the same payload.
//
// Practice mode's notice was corrected and `postingGroundingNotice` — the one
// live mode renders — was not. That is the "one half of a pair updated" shape:
// two surfaces, one route, one payload, and only one of them told the truth
// about it. Worse than practice's original gap, because this notice returns
// the empty string outright when no posting is selected, which is the ordinary
// live-mode state — so in the common case live mode disclosed nothing at all
// about a transfer it now performs on every single drafted answer.
describe("live mode discloses the knowledge base too", () => {
  it("names project pages and attachment file names even with no posting selected", async () => {
    const { postingGroundingNotice } = await import("./groundingNotice.js");
    const notice = String(
      postingGroundingNotice({ isEmbedded: false, posting: null, docsSettled: true, resume: null, coverLetter: null }) || "",
    ).toLowerCase();
    expect(notice).toContain("project page");
    expect(notice).toMatch(/file name|attachment/);
  });

  it("says nothing of the sort when no AI provider is involved", async () => {
    const { postingGroundingNotice } = await import("./groundingNotice.js");
    const notice = String(
      postingGroundingNotice({ isEmbedded: true, posting: null, docsSettled: true, resume: null, coverLetter: null }) || "",
    ).toLowerCase();
    expect(notice).not.toContain("project page");
  });
});
