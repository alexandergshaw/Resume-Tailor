// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { upsertPosition, editPositionFieldsViaApi } from "./upsertPosition.js";

// In the browser these helpers must NOT talk to Postgres. Every direct write
// from a client bundle is exactly what forces `positions_update_authenticated`
// (`auth.role() = 'authenticated'`) to stay permissive, and that policy is
// what lets one account overwrite another's catalogue row.

const JOB = {
  id: "url-https://acme.example/jobs/1",
  title: "Senior Engineer",
  company: "Acme",
  url: "https://acme.example/jobs/1",
  description: "Build things",
};

function supabaseSpy() {
  return { from: vi.fn(() => { throw new Error("the browser must not reach positions directly"); }) };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ positionId: "pos-1" }) }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("upsertPosition, in the browser", () => {
  it("POSTs the job to /api/positions and returns the id the route reports", async () => {
    const sb = supabaseSpy();
    const id = await upsertPosition(sb, JOB);

    expect(id).toBe("pos-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/positions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).job.id).toBe(JOB.id);
  });

  it("never touches the Supabase client it was handed", async () => {
    const sb = supabaseSpy();
    await upsertPosition(sb, JOB);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("sends no user id — the route reads the caller from the session cookie", async () => {
    await upsertPosition(supabaseSpy(), { ...JOB, userId: "user-1", user_id: "user-1" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("user_id");
  });

  it("returns null (never throws) when the route refuses", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) });
    await expect(upsertPosition(supabaseSpy(), JOB)).resolves.toBeNull();
  });

  it("returns null (never throws) when the network fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(upsertPosition(supabaseSpy(), JOB)).resolves.toBeNull();
  });

  it("still refuses a job with no id, without a round trip", async () => {
    expect(await upsertPosition(supabaseSpy(), null)).toBeNull();
    expect(await upsertPosition(supabaseSpy(), {})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("editPositionFieldsViaApi, in the browser", () => {
  it("PATCHes /api/positions with only the three editable fields", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const res = await editPositionFieldsViaApi("pos-1", {
      title: "Staff Eng",
      company: "Acme Corp",
      description: "notes",
    });

    expect(res.error).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/positions");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["company", "description", "positionId", "title"]);
  });

  it("reports the route's error message rather than swallowing it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Not your application" }) });
    const res = await editPositionFieldsViaApi("pos-1", { company: "Acme Corp" });
    expect(res.error).toBe("Not your application");
  });

  it("reports an error when the network fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const res = await editPositionFieldsViaApi("pos-1", { company: "Acme Corp" });
    expect(res.error).toBeTruthy();
  });
});
