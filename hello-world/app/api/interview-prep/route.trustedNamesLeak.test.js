// F-R13-1 (fix round r13, MAJOR, verify.r13.md) -- GET's own `error` field
// (route.js:821, sourced from `lib/interviewPrep/trustedNames.js`'s
// readTrustedNames) used to hand the database's own PostgREST message
// straight to the candidate on an otherwise-successful 200 response -- the
// "tenth leak" route.dbFailureSweep.test.js never polices, because it is not
// a status:500 `Response.json(` call at all (readTrustedNames's failure is a
// SOFT field on a healthy read, not a terminal refusal).
//
// Fixed AT THE SOURCE (readTrustedNames's own fail-closed branch,
// trustedNames.js -- see that file's own tests for the unit-level proof),
// never by patching this one route.js call site: the raw detail is logged
// server-side via prepStore.js's logDbFailure, and only a generic,
// candidate-facing sentence ever leaves readTrustedNames. This file drives
// the REAL GET handler (never a mock of it) against
// test/helpers/supabaseFake.js's stateful fake, with a forced
// candidate_identity query error -- the same instrument shape
// route.trustedNamesWiring.test.js and route.restore.test.js already use --
// so the fix is proven end to end, not merely at the unit that owns it.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { GET } from "./route.js";

const APP_ID = "app-trusted-leak-1";
const USER_ID = "user-trusted-leak-1";
const RAW_DB_MESSAGE = "PGRST301 relation candidate_identity does not exist at char 42";

function getRequest() {
  return new Request(`http://localhost/api/interview-prep?applicationId=${APP_ID}`, { method: "GET" });
}

describe("F-R13-1 -- GET never hands the database's own raw text back through its own `error` field", () => {
  it("[RED before this fix round] a candidate_identity read failure still returns 200, but with a GENERIC error sentence, never the raw PostgREST message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeStatefulSupabase(
      { applications: [{ id: APP_ID, user_id: USER_ID }] },
      { user: { id: USER_ID }, errors: { candidate_identity: { select: { message: RAW_DB_MESSAGE } } } },
    );
    createClient.mockResolvedValue(sb);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status, "a fail-closed trustedNames read must not turn a healthy pack read into an error status").toBe(200);
    expect(body.error).not.toBeNull();
    expect(body.error).not.toContain("PGRST301");
    expect(JSON.stringify(body), "the raw database text must not appear anywhere in the response body").not.toContain(
      RAW_DB_MESSAGE,
    );
    // The fail-closed default still applies: no name is readable when the
    // read that would resolve it failed.
    expect(body.candidateName).toBeNull();
    expect(body.interviewerNames).toEqual([]);
    spy.mockRestore();
  });

  it("[control, proves the assertion above is not vacuous] a healthy read carries error: null on the same response shape", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeStatefulSupabase({ applications: [{ id: APP_ID, user_id: USER_ID }] }, { user: { id: USER_ID } });
    createClient.mockResolvedValue(sb);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeNull();
    spy.mockRestore();
  });
});
