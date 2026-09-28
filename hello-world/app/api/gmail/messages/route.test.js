// U3 (plan §4) — POST /api/gmail/messages (M2). Binds AC-2 / AC-11.
//
// This route has no test on HEAD (verified: Glob of app/api/gmail/** finds only
// connect + oauth2callback). This file is a NEW instrument, created here.
//
// The three cause tests are the RED ones. On HEAD the route's refusal branch is
//   const auth = await getAuthenticatedClient(...); if (!auth) return 403 { error }
// with NO cause field (route.js:38-43). Under the NEW contract getAuthenticatedClient
// resolves to `{ok:false, cause}` — which is TRUTHY — so HEAD's `if (!auth)` is
// false, the route sails past the refusal branch, and (with no tracked companies)
// returns 200 {messages:[]}. So `expect(status).toBe(403)` and `body.cause` fail RED
// for exactly the right reason: the route does not yet consume `.ok` or emit a cause.
//
// The 401 test, the success (200) test, and the empty-inbox (200) test are
// NON-REGRESSION GUARDS — they pass on HEAD and must keep passing on the reference
// (AC-11: the 401 shape and the 200 {messages} shape are unchanged; no cause on 401).
// They are the controls that stop the fix from turning every request into a refusal.
//
// The 500-detail test IS red on HEAD: route.js:80 returns `detail: err?.message` on
// the 500 path, and plan P-1 removes it in this same step. That test pins the removal.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/gmail/gmailClient", () => ({
  getAuthenticatedClient: vi.fn(),
  fetchJobRelatedMessages: vi.fn(),
}));
vi.mock("@/lib/supabase/upsertGmailMessages", () => ({ upsertGmailMessages: vi.fn(async () => {}) }));

import { POST } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, fetchJobRelatedMessages } from "@/lib/gmail/gmailClient";

const USER = "3f2a7c10-0000-4c6b-9a17-0be82d5f43c1";
const PROVIDER_LEAK = "PROVIDER_INTERNAL_LEAK_must_never_reach_the_client";

function request(body = {}) {
  return new Request("http://localhost:3000/api/gmail/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Authenticated caller with a set of tracked companies (so the route reaches the
// Gmail fetch rather than the empty-inbox early return).
function signedInWithApps() {
  createClient.mockResolvedValue(
    makeSupabase(
      { applications: { data: [{ positions: { company: "Acme", title: "Engineer" } }] } },
      { user: { id: USER } },
    ),
  );
}

let errorSpy;
let logSpy;

beforeEach(() => {
  createClient.mockReset();
  getAuthenticatedClient.mockReset();
  fetchJobRelatedMessages.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/gmail/messages — refusal carries a coarse cause behind auth (AC-2)", () => {
  for (const cause of ["not_connected", "reauth_required", "temporarily_unavailable"]) {
    it(`403 body carries cause "${cause}" plus a human error string`, async () => {
      // Authenticated (getUser succeeds) so the cause is only ever produced for the
      // caller's own account (AC-2/AC-11 by construction).
      createClient.mockResolvedValue(makeSupabase({}, { user: { id: USER } }));
      getAuthenticatedClient.mockResolvedValue({ ok: false, cause });

      const res = await POST(request());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.cause).toBe(cause);
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);

      // AC-11: coarse-only. No fine logCode, no `detail`, no raw provider text.
      expect(body.logCode).toBeUndefined();
      expect(body.detail).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(PROVIDER_LEAK);
    });
  }

  it("GUARD (green on HEAD): an unauthenticated caller gets 401 with NO cause field (AC-2/AC-11)", async () => {
    // opts.user omitted -> getUser yields null -> 401. The cause vocabulary must
    // never be produced for an unauthenticated caller (no account-existence probe).
    createClient.mockResolvedValue(makeSupabase({}, {}));

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.cause).toBeUndefined();
    // getAuthenticatedClient must not even be consulted before auth.
    expect(getAuthenticatedClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/gmail/messages — success and 500 shapes (AC-11 backward compat + leak)", () => {
  it("GUARD (green on HEAD): a successful fetch returns 200 {messages} with NO cause field", async () => {
    signedInWithApps();
    getAuthenticatedClient.mockResolvedValue({ ok: true, client: {} });
    const messages = [{ id: "m1", threadId: "t1", subject: "Interview", from: "a@b.com", date: "", snippet: "", body: "" }];
    fetchJobRelatedMessages.mockResolvedValue(messages);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toEqual(messages);
    expect(body.cause).toBeUndefined();
  });

  it("GUARD (green on HEAD): no tracked companies -> 200 {messages:[]} early return unchanged", async () => {
    createClient.mockResolvedValue(makeSupabase({ applications: { data: [] } }, { user: { id: USER } }));
    getAuthenticatedClient.mockResolvedValue({ ok: true, client: {} });

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toEqual([]);
  });

  it("the 500 path does NOT leak the provider error message (AC-11, plan P-1)", async () => {
    // RED on HEAD: route.js:80 returns `detail: err?.message`, so the thrown
    // sentinel reaches the client body. P-1 removes it. The 500 must still name a
    // generic human error (control), and carry no `detail` and no provider text.
    signedInWithApps();
    getAuthenticatedClient.mockResolvedValue({ ok: true, client: {} });
    fetchJobRelatedMessages.mockRejectedValue(new Error(PROVIDER_LEAK));

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(PROVIDER_LEAK);
  });
});
