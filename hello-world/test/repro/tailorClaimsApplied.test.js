import { describe, it, expect } from "vitest";
import { makeStatefulSupabase } from "../helpers/supabaseFake.js";

// ---------------------------------------------------------------------------
// P-1 — "tailoring a résumé" is not "applying to a job", but THREE tailor-time
// writes claimed it is:
//
//   app/page.js handleUrlSubmit         — await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "applied" });
//   app/page.js handleTailorFeedPosting — await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "applied" });
//   app/hooks/useManualTailor.js tailorPosting — await upsertApplication(supabase, { userId: currentUser.id, positionId, status: STATUS.APPLIED });
//
// (search for the call shape above — line numbers drift; the third site was
// missed by the first search pass because it lives in a hook file, not
// app/page.js). All three sites fire the instant a document is generated,
// before the user has downloaded anything, opened the posting, or clicked
// any "apply" control. A brand-new row is created already at "applied" with
// a fabricated `applied_at`, and — because `upsertApplication` is a wrapper
// around `writeApplicationStatus`'s C1 allow-list UPDATE, whose target IS
// "applied" — an EXISTING row already sitting at some other applied-or-later
// status (e.g. "offer") gets silently rewritten to "applied" too: C1's guard
// only ever asks "is the CURRENT status pre-apply", never "is the TARGET
// status itself applied-or-later", so a promote-to-"applied" call is not a
// protected write the way a promote-to-"tailored" call is.
//
// `handleTailorJob` (app/page.js) shows the correct model: it promotes to
// "tailored"/"auto_tailored" — a PRE-APPLY status — behind the very same
// writer, so its own C1 guard genuinely protects an applied-or-later row
// because the target itself is never one.
//
// The three helpers below are a literal transcription of each call site's
// persistence write. The first two (handleUrlSubmit / handleTailorFeedPosting
// live inside a 3000+ line "use client" component and cannot be imported);
// the third (useManualTailor's tailorPosting) IS importable, but is kept in
// the same transcribed style deliberately, for consistency with the other
// two and to avoid pulling in tailorPosting's much larger fetch/FormData
// surface just to exercise one persistence call. All three call the REAL,
// unmocked `upsertApplication` — so what is under test is production code,
// not a reimplementation of it. Their `status` argument is kept
// byte-identical to whatever the call site currently passes; when a fix
// lands (the literal "applied" / STATUS.APPLIED replaced with STATUS.TAILORED
// at that call site) this file's matching literal is updated to match, same
// as any other transcription would be kept in sync with its source.
// ---------------------------------------------------------------------------

import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { STATUS, APPLIED_OR_LATER_STATUSES, classifyStatus } from "@/lib/applications/statusVocabulary.js";

const USER_ID = "user-1";
const POSITION_ID = "pos-1";
const APPLIED_AT = "2026-07-04T15:32:11.000Z";

// Transcribed from app/page.js, handleUrlSubmit's persistence block, which
// now promotes to STATUS.TAILORED (P-1 fix) rather than the pre-fix literal
// "applied".
async function urlSubmitApplicationWrite(sb, { userId, positionId }) {
  return upsertApplication(sb, { userId, positionId, status: STATUS.TAILORED });
}

// Transcribed from app/page.js, handleTailorFeedPosting's persistence block.
// Same fix as urlSubmitApplicationWrite above.
async function tailorFeedPostingApplicationWrite(sb, { userId, positionId }) {
  return upsertApplication(sb, { userId, positionId, status: STATUS.TAILORED });
}

// The THIRD P-1 site, missed by the search instrument that found the two
// above because it lives in a hook file, not app/page.js:
// app/hooks/useManualTailor.js, `tailorPosting`'s persistence block (~line
// 205, "Persist the generated resume + cover letter and link them to an
// application"), which now promotes to STATUS.TAILORED (P-1 fix) rather than
// the pre-fix STATUS.APPLIED. Same fix as urlSubmitApplicationWrite above.
async function manualTailorApplicationWrite(sb, { userId, positionId }) {
  return upsertApplication(sb, { userId, positionId, status: STATUS.TAILORED });
}

const SITES = [
  ["handleUrlSubmit", urlSubmitApplicationWrite],
  ["handleTailorFeedPosting", tailorFeedPostingApplicationWrite],
  ["useManualTailor's tailorPosting", manualTailorApplicationWrite],
];

function appRow(sb) {
  return sb.row("applications", (r) => r.position_id === POSITION_ID);
}

describe.each(SITES)("P-1 — %s's tailor-time write must not claim 'applied'", (name, write) => {
  it("a fresh row (no prior application) lands pre-apply, with no fabricated applied date", async () => {
    const sb = makeStatefulSupabase({}, { user: { id: USER_ID } });

    const id = await write(sb, { userId: USER_ID, positionId: POSITION_ID });
    expect(id).not.toBeNull();

    const row = appRow(sb);
    expect(row).not.toBeNull();
    // The user has generated a document, not submitted anything. "applied"
    // (and a stamped applied_at) is a claim only a real apply-action may make
    // — see applyAutoTailoredRow / handleToggleApplied, both untouched by
    // this fix.
    expect(classifyStatus(row.status)).toBe("pre-apply");
    expect(row.status).not.toBe(STATUS.APPLIED);
    expect(row.applied_at).toBeNull();
  });

  it.each(APPLIED_OR_LATER_STATUSES)(
    "a row already at '%s' is NOT demoted or re-stamped by a re-tailor",
    async (existingStatus) => {
      const sb = makeStatefulSupabase(
        {
          applications: [
            {
              id: "app-1",
              user_id: USER_ID,
              position_id: POSITION_ID,
              status: existingStatus,
              applied_at: APPLIED_AT,
            },
          ],
        },
        { user: { id: USER_ID } },
      );

      await write(sb, { userId: USER_ID, positionId: POSITION_ID });

      const row = appRow(sb);
      expect(row.status).toBe(existingStatus);
      // Identity, not truthiness: a re-stamp defect writes a fresh, non-null,
      // WRONG timestamp, which every `not.toBeNull()`-shaped assertion misses.
      expect(row.applied_at).toBe(APPLIED_AT);
    },
  );
});
