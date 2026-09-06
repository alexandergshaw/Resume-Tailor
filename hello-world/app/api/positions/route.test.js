import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeStatefulSupabase } from "../../../test/helpers/supabaseFake.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST, PATCH } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const USER = { id: "user-1" };
const OTHER = { id: "user-2" };
const EXTERNAL_ID = "url-https://acme.example/jobs/1";
// See lib/supabase/positionMerge.test.js for why these are short.
const TRUNCATION = "Responsibilities: ship things, own the roadmap, and…";
const FULL =
  "Responsibilities: ship things, own the roadmap, and partner with design. " +
  "Requirements: 5+ years. Benefits: dental, 401k, remote-first. Apply by Friday.";

const req = (body) => ({ json: async () => body });

const job = (over = {}) => ({
  id: EXTERNAL_ID,
  title: "Senior Engineer",
  company: "Acme",
  url: "https://acme.example/jobs/1",
  description: FULL,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

function signedIn(user, seed = {}) {
  createClient.mockResolvedValue(makeStatefulSupabase(seed, { user }));
}

describe("POST /api/positions — authentication", () => {
  it("rejects an unauthenticated caller with 401 and writes nothing", async () => {
    signedIn(null);
    const admin = makeStatefulSupabase({ positions: [] });
    createAdminClient.mockReturnValue(admin);

    const res = await POST(req({ job: job() }));

    expect(res.status).toBe(401);
    expect(admin.rows("positions")).toHaveLength(0);
    // The service-role client bypasses RLS entirely, so the route's own auth
    // check is the ONLY thing standing between an anonymous request and the
    // shared catalogue. It must run before the client is even built.
    expect(admin.calls).toHaveLength(0);
  });

  it("rejects a body that is not JSON", async () => {
    signedIn(USER);
    createAdminClient.mockReturnValue(makeStatefulSupabase({ positions: [] }));
    const res = await POST({ json: async () => { throw new Error("bad"); } });
    expect(res.status).toBe(400);
  });

  it("rejects a job with no external id", async () => {
    signedIn(USER);
    createAdminClient.mockReturnValue(makeStatefulSupabase({ positions: [] }));
    const res = await POST(req({ job: job({ id: "" }) }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/positions — the merge, end to end", () => {
  it("creates the row and returns its id", async () => {
    signedIn(USER);
    const admin = makeStatefulSupabase({ positions: [] });
    createAdminClient.mockReturnValue(admin);

    const res = await POST(req({ job: job() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.positionId).toBeTruthy();
    expect(admin.rows("positions")[0].company).toBe("Acme");
  });

  it("a SECOND account's empty-company run does not blank the first account's company", async () => {
    const admin = makeStatefulSupabase({ positions: [] });
    createAdminClient.mockReturnValue(admin);

    signedIn(USER);
    await POST(req({ job: job() }));

    signedIn(OTHER);
    const res = await POST(req({ job: job({ company: "", url: "", title: "" }) }));

    expect(res.status).toBe(200);
    const stored = admin.rows("positions")[0];
    expect(stored.company).toBe("Acme");
    expect(stored.url).toBe("https://acme.example/jobs/1");
  });

  it("lets a full description replace a stored truncation", async () => {
    const admin = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: EXTERNAL_ID, company: "Acme", description: TRUNCATION }],
    });
    createAdminClient.mockReturnValue(admin);
    signedIn(USER);

    const res = await POST(req({ job: job({ description: FULL }) }));
    expect((await res.json()).positionId).toBe("pos-1");
    expect(admin.rows("positions")[0].description).toBe(FULL);
  });
});

describe("PATCH /api/positions — authentication and authorization", () => {
  const seedAdmin = () =>
    makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: "manual-1", company: "Acme", title: "Eng", description: "old" }],
    });

  it("rejects an unauthenticated caller with 401 and writes nothing", async () => {
    signedIn(null);
    const admin = seedAdmin();
    createAdminClient.mockReturnValue(admin);

    const res = await PATCH(req({ positionId: "pos-1", company: "Hijacked" }));

    expect(res.status).toBe(401);
    expect(admin.rows("positions")[0].company).toBe("Acme");
  });

  it("refuses a caller who holds no application on that position", async () => {
    // Today's RLS authorizes nothing at all: `positions_update_authenticated`
    // is `auth.role() = 'authenticated'`, so ANY signed-in account can edit
    // ANY catalogue row. This is the authorization that policy never had.
    signedIn(USER, { applications: [{ id: "app-9", user_id: "user-2", position_id: "pos-1" }] });
    const admin = seedAdmin();
    createAdminClient.mockReturnValue(admin);

    const res = await PATCH(req({ positionId: "pos-1", company: "Hijacked" }));

    expect(res.status).toBe(403);
    expect(admin.rows("positions")[0].company).toBe("Acme");
  });

  it("takes the caller's identity from the SESSION, never from the body", async () => {
    // The route holds the service-role client, which bypasses RLS. If the
    // ownership check read a user id out of the body, it would be checking
    // `applications.user_id = <whatever the attacker typed>` — i.e. checking
    // nothing. user-1 is signed in and owns no application here; user-2 does,
    // and the body claims to be user-2.
    signedIn(USER, { applications: [{ id: "app-9", user_id: "user-2", position_id: "pos-1" }] });
    const admin = seedAdmin();
    createAdminClient.mockReturnValue(admin);

    const res = await PATCH(req({ positionId: "pos-1", userId: "user-2", user_id: "user-2", company: "Hijacked" }));

    expect(res.status).toBe(403);
    expect(admin.rows("positions")[0].company).toBe("Acme");
  });

  it("applies the edit for a caller who does hold an application on that position", async () => {
    signedIn(USER, { applications: [{ id: "app-1", user_id: "user-1", position_id: "pos-1" }] });
    const admin = seedAdmin();
    createAdminClient.mockReturnValue(admin);

    const res = await PATCH(req({ positionId: "pos-1", company: "Acme Corp", title: "Staff Eng", description: "new" }));

    expect(res.status).toBe(200);
    const stored = admin.rows("positions")[0];
    expect(stored.company).toBe("Acme Corp");
    expect(stored.title).toBe("Staff Eng");
    expect(stored.description).toBe("new");
  });

  it("does not blank a stored field from an empty box", async () => {
    signedIn(USER, { applications: [{ id: "app-1", user_id: "user-1", position_id: "pos-1" }] });
    const admin = seedAdmin();
    createAdminClient.mockReturnValue(admin);

    const res = await PATCH(req({ positionId: "pos-1", company: "", title: "", description: "" }));

    expect(res.status).toBe(200);
    const stored = admin.rows("positions")[0];
    expect(stored.company).toBe("Acme");
    expect(stored.title).toBe("Eng");
    expect(stored.description).toBe("old");
  });

  it("rejects a missing positionId", async () => {
    signedIn(USER);
    createAdminClient.mockReturnValue(seedAdmin());
    const res = await PATCH(req({ company: "Acme Corp" }));
    expect(res.status).toBe(400);
  });
});
