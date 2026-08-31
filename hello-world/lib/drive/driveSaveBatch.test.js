import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { driveSaveBatch, SCOPE_OUTCOME, BATCH_ERROR } from "./driveSaveBatch.js";
import { DOCX_SCOPES, SCOPES } from "@/lib/tailor/documentScopes";

const RESUME_SAVED = {
  scope: "resume",
  label: "Resume",
  result: SCOPE_OUTCOME.SAVED,
  name: "Acme - Senior Engineer - Resume",
  webViewLink: "https://docs.google.com/document/d/resume123/edit",
};

const COVER_LETTER_SAVED = {
  scope: "cover",
  label: "Cover letter",
  result: SCOPE_OUTCOME.SAVED,
  name: "Acme - Senior Engineer - CL",
  webViewLink: "https://docs.google.com/document/d/cl456/edit",
};

const COVER_LETTER_NO_BYTES = {
  scope: "cover",
  label: "Cover letter",
  result: SCOPE_OUTCOME.NO_BYTES,
};

describe("driveSaveBatch — all saved", () => {
  it("2 of 2 saved: summary and announcement pluralise, alert is empty, connectionLost is false", () => {
    const result = driveSaveBatch([RESUME_SAVED, COVER_LETTER_SAVED]);
    expect(result.summary).toBe("Saved 2 documents to Drive.");
    expect(result.announcement).toEqual({ polite: "Saved 2 documents to Drive.", alert: "" });
    expect(result.connectionLost).toBe(false);
  });

  it("1 of 1 saved: summary uses the singular 'document' (positive control against the plural case)", () => {
    const result = driveSaveBatch([RESUME_SAVED]);
    expect(result.summary).toBe("Saved 1 document to Drive.");
    expect(result.announcement.polite).toBe("Saved 1 document to Drive.");
  });

  it("builds the exact saved-row segment sequence: prefix text then one link, in order", () => {
    const result = driveSaveBatch([RESUME_SAVED]);
    expect(result.rows).toEqual([
      {
        scope: "resume",
        kind: "saved",
        attributed: true,
        errorKind: null,
        segments: [
          { type: "text", value: "Resume — " },
          {
            type: "link",
            href: "https://docs.google.com/document/d/resume123/edit",
            text: "Acme - Senior Engineer - Resume",
          },
        ],
      },
    ]);
  });

  it("uses the name Drive returned as the link's visible text, not the app's own name (AC-S13)", () => {
    // Same webViewLink, deliberately different `name` from what the app
    // would have computed — proves the row echoes Drive's name, not a
    // recomputed one.
    const renamedInDrive = { ...RESUME_SAVED, name: "Renamed By The User In Google Docs" };
    const result = driveSaveBatch([renamedInDrive]);
    const linkSeg = result.rows[0].segments.find((s) => s.type === "link");
    expect(linkSeg.text).toBe("Renamed By The User In Google Docs");
  });
});

describe("driveSaveBatch — partial", () => {
  it("keeps the success row AND shows only the failing scope's error (never claims both succeeded)", () => {
    const result = driveSaveBatch([RESUME_SAVED, COVER_LETTER_NO_BYTES]);
    expect(result.summary).toBe("Saved 1 of 2 documents to Drive.");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].kind).toBe("saved");
    expect(result.rows[0].scope).toBe("resume");
    expect(result.rows[1].kind).toBe("no-bytes");
    expect(result.rows[1].scope).toBe("cover");
  });

  it("no-bytes row text matches AC-S27c verbatim and is attributed to the scope", () => {
    const result = driveSaveBatch([RESUME_SAVED, COVER_LETTER_NO_BYTES]);
    const row = result.rows[1];
    expect(row.attributed).toBe(true);
    expect(row.segments).toEqual([
      {
        type: "text",
        value:
          "Cover letter — couldn't rebuild the document. Regenerate the cover letter, or upload your cover letter template (.docx), then save again.",
      },
    ]);
  });

  it("partial announcement: polite is the summary, alert is the short single-failure sentence (UX.md §8)", () => {
    const result = driveSaveBatch([RESUME_SAVED, COVER_LETTER_NO_BYTES]);
    expect(result.announcement).toEqual({
      polite: "Saved 1 of 2 documents to Drive.",
      alert: "Cover letter wasn't saved: couldn't rebuild the document.",
    });
  });

  it("too-large is rendered WITHOUT a scope prefix (UX.md §6.6: 'not attributed to a scope')", () => {
    const result = driveSaveBatch([
      RESUME_SAVED,
      { scope: "cover", label: "Cover letter", result: SCOPE_OUTCOME.TOO_LARGE },
    ]);
    const row = result.rows[1];
    expect(row.attributed).toBe(false);
    expect(row.segments).toEqual([
      {
        type: "text",
        value: "This document is too large for the app to upload to Drive. Download it as .docx here instead.",
      },
    ]);
  });

  it("a Drive-API error row is unattributed and uses driveErrors.js's kind to pick the exact §6.6 sentence", () => {
    const cases = [
      ["storage-full", "Your Google Drive is out of space. Free some up, then save again."],
      [
        "refused",
        "Google Drive wouldn't accept this file. If your account is managed by an organisation, its policy may block this; otherwise check that the “Resume Tailor” folder still exists in your Drive and that you can edit it.",
      ],
      ["transient", "Google Drive is busy. Try saving again in a moment."],
      ["reconnect", "Your Drive connection expired. Reconnect and this save will finish on its own."],
      // WAVE2-SEAMS.md MAJOR-3 / the "one that stayed green": these two used
      // to have NO content assertion anywhere in this suite, so a private
      // `driveSaveBatch.js` copy could (and did) diverge from
      // `driveMessages.js`'s canonical text and every test stayed green.
      // Both now come from `driveErrorMessage()` / `UNKNOWN_ERROR_MESSAGE`.
      ["gone", "That Google Doc is no longer in your Drive. Save again to create a new one."],
      ["unknown", "Something went wrong saving to Google Drive. Try again."],
    ];
    for (const [errorKind, message] of cases) {
      const result = driveSaveBatch([
        RESUME_SAVED,
        { scope: "cover", label: "Cover letter", result: SCOPE_OUTCOME.ERROR, errorKind },
      ]);
      const row = result.rows[1];
      expect(row.attributed).toBe(false);
      expect(row.errorKind).toBe(errorKind);
      expect(row.segments).toEqual([{ type: "text", value: message }]);
    }
  });

  it("refused and storage-full render different sentences from each other (they must differ, per AC-E10)", () => {
    const refused = driveSaveBatch([
      { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.ERROR, errorKind: "refused" },
    ]).rows[0].segments[0].value;
    const full = driveSaveBatch([
      { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.ERROR, errorKind: "storage-full" },
    ]).rows[0].segments[0].value;
    expect(refused).not.toBe(full);
  });

  it("dismissed row text matches UX.md §6.4 verbatim and is attributed", () => {
    const result = driveSaveBatch([
      COVER_LETTER_SAVED,
      { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.DISMISSED },
    ]);
    const row = result.rows[1];
    expect(row.attributed).toBe(true);
    expect(row.segments).toEqual([
      {
        type: "text",
        value: "Resume — not saved. The Doc in Drive has changed since the app last saved it.",
      },
    ]);
  });

  it("a saved-as-new-doc-after-conflict row (B-3) carries two links in the documented order", () => {
    const result = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        conflictNewDoc: true,
        name: "Acme - Resume (2)",
        webViewLink: "https://docs.google.com/document/d/new/edit",
        previousName: "Acme - Resume",
        previousWebViewLink: "https://docs.google.com/document/d/old/edit",
      },
    ]);
    expect(result.rows).toEqual([
      {
        scope: "resume",
        kind: "saved-new-doc",
        attributed: true,
        errorKind: null,
        segments: [
          { type: "text", value: "Resume — saved to a new Doc: " },
          { type: "link", href: "https://docs.google.com/document/d/new/edit", text: "Acme - Resume (2)" },
          {
            type: "text",
            value: ". Your earlier Doc, with the changes made in your Drive, is still there: ",
          },
          { type: "link", href: "https://docs.google.com/document/d/old/edit", text: "Acme - Resume" },
          { type: "text", value: "." },
        ],
      },
    ]);
  });

  it("a replaced-deleted-Doc row (AC-E10) states the reason then appends the new link", () => {
    const result = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        replacedDeleted: true,
        name: "Acme - Resume",
        webViewLink: "https://docs.google.com/document/d/new/edit",
      },
    ]);
    expect(result.rows).toEqual([
      {
        scope: "resume",
        kind: "replaced-deleted",
        attributed: true,
        errorKind: null,
        segments: [
          {
            type: "text",
            value: "Resume — the previous Doc was no longer in your Drive, so a new one was created. ",
          },
          { type: "link", href: "https://docs.google.com/document/d/new/edit", text: "Acme - Resume" },
        ],
      },
    ]);
  });

  it("more than one failure alongside a success still produces a single terse alert, not a list", () => {
    const result = driveSaveBatch([
      RESUME_SAVED,
      { scope: "cover", label: "Cover letter", result: SCOPE_OUTCOME.NO_BYTES },
      { scope: "email", label: "Hiring email", result: SCOPE_OUTCOME.TOO_LARGE },
    ]);
    expect(result.summary).toBe("Saved 1 of 3 documents to Drive.");
    expect(result.announcement.polite).toBe("Saved 1 of 3 documents to Drive.");
    expect(result.announcement.alert).toBe("2 documents weren't saved.");
  });
});

describe("driveSaveBatch — nothing saved (per-scope failures)", () => {
  it("summary is absent (null); the failure row carries the message instead (AC-S20)", () => {
    const result = driveSaveBatch([COVER_LETTER_NO_BYTES]);
    expect(result.summary).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].kind).toBe("no-bytes");
  });

  it("positive control: the SAME batch with one scope saved and one failing DOES get a summary", () => {
    // Pairs with the assertion above so "summary is null" cannot be
    // satisfied by an implementation that never sets a summary at all.
    const result = driveSaveBatch([RESUME_SAVED, COVER_LETTER_NO_BYTES]);
    expect(result.summary).not.toBeNull();
  });

  it("alert carries the single failure's full row text verbatim (not shortened, unlike the partial case)", () => {
    const result = driveSaveBatch([COVER_LETTER_NO_BYTES]);
    expect(result.announcement).toEqual({
      polite: "",
      alert:
        "Cover letter — couldn't rebuild the document. Regenerate the cover letter, or upload your cover letter template (.docx), then save again.",
    });
  });

  it("connectionLost is true when the sole failure is a reconnect-kind error", () => {
    const result = driveSaveBatch([
      { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.ERROR, errorKind: "reconnect" },
    ]);
    expect(result.connectionLost).toBe(true);
  });

  it("positive control: connectionLost is false for every other error kind", () => {
    for (const errorKind of ["storage-full", "refused", "transient", "gone", "unknown"]) {
      const result = driveSaveBatch([
        { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.ERROR, errorKind },
      ]);
      expect(result.connectionLost).toBe(false);
    }
  });

  it("connectionLost stays true in a partial batch too (one scope saved, the other needs reconnect)", () => {
    const result = driveSaveBatch([
      RESUME_SAVED,
      { scope: "cover", label: "Cover letter", result: SCOPE_OUTCOME.ERROR, errorKind: "reconnect" },
    ]);
    expect(result.connectionLost).toBe(true);
  });
});

describe("driveSaveBatch — batch aborts (nothing attempted at all)", () => {
  const cases = [
    [BATCH_ERROR.CONSENT_REFUSED, "Drive access wasn't granted — nothing was saved."],
    [
      BATCH_ERROR.POPUP_BLOCKED,
      "Your browser blocked the Google window. Allow pop-ups for this site, then try again.",
    ],
    [BATCH_ERROR.POPUP_CLOSED, "The Google window closed before access was granted. Nothing was saved."],
    [BATCH_ERROR.OFFLINE, "Couldn't reach Google Drive — check your connection."],
    [BATCH_ERROR.UNAUTHORIZED, "You've been signed out. Sign in again, then save."],
    [BATCH_ERROR.MISCONFIGURED, "Drive saving isn't set up on this server."],
  ];

  for (const [batchError, message] of cases) {
    it(`renders the exact §6.6 sentence for "${batchError}", with no summary and no scope attribution`, () => {
      const result = driveSaveBatch([{ batchError }]);
      expect(result.summary).toBeNull();
      expect(result.rows).toEqual([
        { scope: null, kind: "batch-error", attributed: false, errorKind: null, segments: [{ type: "text", value: message }] },
      ]);
      expect(result.announcement).toEqual({ polite: "", alert: message });
    });
  }

  it("a batch-abort never sets connectionLost — an expired app session is not a lost Drive connection", () => {
    expect(driveSaveBatch([{ batchError: BATCH_ERROR.UNAUTHORIZED }]).connectionLost).toBe(false);
  });
});

describe("driveSaveBatch — edge cases", () => {
  it("returns an inert result for an empty batch, without throwing", () => {
    expect(driveSaveBatch([])).toEqual({
      rows: [],
      summary: null,
      announcement: { polite: "", alert: "" },
      connectionLost: false,
    });
  });

  it("does not throw for non-array input and behaves like an empty batch", () => {
    expect(() => driveSaveBatch(undefined)).not.toThrow();
    expect(driveSaveBatch(undefined).rows).toEqual([]);
    expect(driveSaveBatch(null).rows).toEqual([]);
  });

  it("falls back to a generic label when an outcome has none", () => {
    const result = driveSaveBatch([{ scope: "resume", result: SCOPE_OUTCOME.DISMISSED }]);
    expect(result.rows[0].segments[0].value).toBe(
      "Document — not saved. The Doc in Drive has changed since the app last saved it.",
    );
  });

  it("row order matches input order exactly (toEqual on the whole array, not an indexOf comparison)", () => {
    const outcomes = [
      COVER_LETTER_SAVED,
      RESUME_SAVED,
      { scope: "email", label: "Hiring email", result: SCOPE_OUTCOME.NO_BYTES },
    ];
    const result = driveSaveBatch(outcomes);
    expect(result.rows.map((r) => r.scope)).toEqual(["cover", "resume", "email"]);
  });
});

// WAVE2-SEAMS.md MAJOR-5: `driveSaveBatch.js`'s JSDoc called "coverLetter" "a
// DOCX_SCOPES key" -- it never was. `DOCX_SCOPES` is imported here from the
// REAL module (`lib/tailor/documentScopes.js`), never re-declared locally,
// so a change to the real list is felt here automatically instead of this
// guard quietly drifting out of sync with it -- a locally re-declared copy
// would just be the same class of bug one level up.
describe("scope vocabulary agrees with the real DOCX_SCOPES (WAVE2-SEAMS.md MAJOR-5)", () => {
  it("[control] DOCX_SCOPES is exactly resume/cover -- imported from lib/tailor/documentScopes.js", () => {
    expect(DOCX_SCOPES).toEqual(["resume", "cover"]);
  });

  it("every docx-flow fixture's scope in this file is a real DOCX_SCOPES member", () => {
    // Mutation-proof: reintroducing "coverLetter" on any of these fixtures
    // makes this assertion fail, because "coverLetter" is not, and never
    // was, in DOCX_SCOPES.
    expect(DOCX_SCOPES).toContain(RESUME_SAVED.scope);
    expect(DOCX_SCOPES).toContain(COVER_LETTER_SAVED.scope);
    expect(DOCX_SCOPES).toContain(COVER_LETTER_NO_BYTES.scope);
  });

  it("the invalid 'coverLetter' spelling is not, and never was, a DOCX_SCOPES member", () => {
    expect(DOCX_SCOPES).not.toContain("coverLetter");
  });

  // WAVE2-REVERIFY.md MINOR-3: the membership check above only names three
  // fixtures by hand and silently missed the inline fixtures below whose
  // scope is "email" (the row-order test and the multi-failure test both
  // use one). Rather than growing that hand-maintained list every time a new
  // inline fixture appears -- the same drift risk that let the miss happen
  // -- this reads this file's OWN source and checks EVERY `scope:` string
  // literal in it, named const or inline alike.
  //
  // Deliberate choice on "email": `driveSaveBatch`'s own JSDoc documents
  // `scope` as "a real DOCX_SCOPES key" because a save outcome that reaches
  // Drive persistence must be one -- but `driveSaveBatch` itself is a pure
  // reducer that never touches the database and never validates scope
  // against DOCX_SCOPES; the CHECK constraint lives on `drive_documents`,
  // several layers away. The "email" fixtures exist only to give the
  // row-order and multi-failure tests a third, realistic, non-docx scope
  // (a hiring-email attempt genuinely has scope "email" -- see
  // `lib/tailor/documentScopes.js`'s `SCOPES`) -- not an invented or
  // misspelled one. So the guard here is the wider real vocabulary
  // (`SCOPES` = resume/cover/email), not the narrower `DOCX_SCOPES`, and the
  // exception is expressed as "email is a real SCOPES member" rather than by
  // quietly not checking it at all.
  it("every scope: literal in this file -- named fixture or inline -- is a real SCOPES member (resume/cover/email)", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/drive/driveSaveBatch.test.js"), "utf8");
    const literalScopes = [...source.matchAll(/scope:\s*"([^"]+)"/g)].map((m) => m[1]);
    // Positive control: fails vacuously-green if the regex ever stops
    // matching anything (e.g. after a refactor away from string literals).
    expect(literalScopes.length).toBeGreaterThan(0);
    for (const scope of literalScopes) {
      expect(SCOPES).toContain(scope);
    }
  });

  it("[canary] the sweep above DOES flag an invented spelling, proving it isn't a dead check", () => {
    expect(SCOPES).not.toContain("coverLetter");
  });

  // NOTE: this deliberately does NOT also grep driveSaveBatch.js's source for
  // the literal substring "coverLetter" -- its own JSDoc legitimately quotes
  // that spelling, in backticks, to document why it's wrong (the same
  // convention driveClient.js's header uses to quote a hazardous shape by
  // name). A raw substring sweep would match that prose and go red against
  // correct code -- precisely the self-matching trap WAVE2-SEAMS.md warned
  // about. The membership checks above are the real, mutation-proof guard:
  // they read the actual fixture values, not the file's prose.
});

// WAVE2-SEAMS.md MAJOR-3: driveSaveBatch.js used to re-derive ~12 strings
// driveMessages.js already owns, and two of them (gone/unknown) had quietly
// diverged with no test catching it. These checks read driveSaveBatch.js's
// OWN source text, so a private re-derivation of a string driveMessages.js
// already exports fails here even if its wording happens to still agree --
// the point is the import, not just today's value.
describe("driveSaveBatch.js imports its message tables rather than re-deriving them (WAVE2-SEAMS.md MAJOR-3)", () => {
  const SOURCE = readFileSync(path.join(process.cwd(), "lib/drive/driveSaveBatch.js"), "utf8");

  it("imports DRIVE_BATCH_MESSAGE, driveErrorMessage, savedSummary, and partialSavedSummary from driveMessages.js", () => {
    expect(SOURCE).toMatch(/from ["']\.\/driveMessages(\.js)?["']/);
    expect(SOURCE).toMatch(/\bDRIVE_BATCH_MESSAGE\b/);
    expect(SOURCE).toMatch(/\bdriveErrorMessage\b/);
    // Not named in WAVE2-SEAMS.md MAJOR-3's own finding (which only flagged
    // BATCH_MESSAGE/DRIVE_ERROR_MESSAGE/TOO_LARGE_MESSAGE/SHORT_REASON), but
    // buildSummary()'s hand-rolled "Saved N document(s) to Drive." /
    // "Saved N of M documents to Drive." text was the exact same class of
    // duplication against driveMessages.js's own savedSummary/
    // partialSavedSummary exports -- found and fixed alongside it.
    expect(SOURCE).toMatch(/\bsavedSummary\b/);
    expect(SOURCE).toMatch(/\bpartialSavedSummary\b/);
  });

  it("no longer declares its own private BATCH_MESSAGE, DRIVE_ERROR_MESSAGE, or TOO_LARGE_MESSAGE tables", () => {
    expect(SOURCE).not.toMatch(/\bconst BATCH_MESSAGE\b/);
    expect(SOURCE).not.toMatch(/\bconst DRIVE_ERROR_MESSAGE\b/);
    expect(SOURCE).not.toMatch(/\bconst TOO_LARGE_MESSAGE\b/);
  });

  it("buildSummary's own source no longer hardcodes the saved-summary sentences", () => {
    expect(SOURCE).not.toContain('"Saved 1 document to Drive."');
    expect(SOURCE).not.toMatch(/`Saved \$\{savedCount\} documents to Drive\.`/);
    expect(SOURCE).not.toMatch(/`Saved \$\{savedCount\} of \$\{total\} documents to Drive\.`/);
  });

  it("[canary] the pattern this test uses DOES match a synthetic local re-derivation, proving it isn't a dead check", () => {
    expect("const TOO_LARGE_MESSAGE = 'x';").toMatch(/\bconst TOO_LARGE_MESSAGE\b/);
  });

  // WAVE2-REVERIFY.md MAJOR-1: buildRow() itself hand-rolled five row
  // strings driveMessages.js already exports -- a duplication none of the
  // checks above catch, because they only look at the batch-level tables
  // (DRIVE_BATCH_MESSAGE / driveErrorMessage / the two summaries), not at
  // buildRow's per-scope rows. Proven unguarded (mutation U1 in
  // WAVE2-REVERIFY.md): rewording driveMessages.js's dismissedRow and its
  // own test together left this whole suite green while buildRow kept
  // emitting the old sentence.
  it("imports savedRowPrefix, savedAsNewDocFragments, replacedRowText, coverNoBytesRow, and dismissedRow -- buildRow's five per-scope row strings -- from driveMessages.js", () => {
    expect(SOURCE).toMatch(/\bsavedRowPrefix\b/);
    expect(SOURCE).toMatch(/\bsavedAsNewDocFragments\b/);
    expect(SOURCE).toMatch(/\breplacedRowText\b/);
    expect(SOURCE).toMatch(/\bcoverNoBytesRow\b/);
    expect(SOURCE).toMatch(/\bdismissedRow\b/);
  });

  it("no longer hand-rolls the row sentences those five helpers already own", () => {
    // Distinctive fragments of the sentences buildRow used to re-type
    // itself, kept out of both the header comment above and any other
    // in-file prose (checked directly below) so this can't self-match.
    expect(SOURCE).not.toContain("saved to a new Doc: `");
    expect(SOURCE).not.toContain("Your earlier Doc, with the changes made in your Drive, is still there");
    expect(SOURCE).not.toContain("the previous Doc was no longer in your Drive, so a new one was created");
    expect(SOURCE).not.toContain("upload your cover letter template (.docx)");
    expect(SOURCE).not.toContain("The Doc in Drive has changed since the app last saved it");
  });

  it("[canary] the fragments above DO match a synthetic hand-rolled row, proving the check isn't dead", () => {
    const handRolled =
      "textSeg(`${label} — the previous Doc was no longer in your Drive, so a new one was created. `)";
    expect(handRolled).toContain("the previous Doc was no longer in your Drive, so a new one was created");
  });
});
