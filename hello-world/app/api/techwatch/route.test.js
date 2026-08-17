import { describe, it, expect, vi, beforeEach } from "vitest";

// Route contract for the Tech Watch briefing. Written before the route
// exists.
//
// The data layer and the collector are mocked so these assertions pin
// observable route behavior - status codes, what reaches the client, and the
// one thing that must NOT reach it - rather than re-testing the collector.
// lib/techwatch/watchlist.js is deliberately NOT mocked: "the user's pages
// decide the watchlist" is a real integration between the route and that
// module, and it is the whole reason this feature lives on this tab.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/techwatch/collect", () => ({
  collectTechWatch: vi.fn(),
  SOURCE_CACHE_TTL_SECONDS: 600,
}));

import { createClient } from "@/lib/supabase/server";
import { listPages } from "@/lib/supabase/experiencePages";
import { collectTechWatch } from "@/lib/techwatch/collect";
import { GET } from "./route.js";

function signedIn(userId = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

function page(id, body, extra = {}) {
  return { id, user_id: "user-1", parent_id: null, title: id, body, generated_kind: null, ...extra };
}

const request = (qs = "") => new Request(`http://localhost/api/techwatch${qs}`);

const EMPTY_COLLECTION = { items: [], lifecycle: [], sources: [] };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  listPages.mockResolvedValue({ pages: [], error: null });
  collectTechWatch.mockResolvedValue(EMPTY_COLLECTION);
});

describe("GET /api/techwatch", () => {
  it("refuses an unauthenticated caller", async () => {
    signedOut();
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(collectTechWatch).not.toHaveBeenCalled();
    expect(listPages).not.toHaveBeenCalled();
  });

  it("scopes the page read to the caller", async () => {
    signedIn("user-42");
    await GET(request());
    expect(listPages).toHaveBeenCalledTimes(1);
    expect(listPages.mock.calls[0][1]).toBe("user-42");
  });

  it("reports a store failure as a 500", async () => {
    listPages.mockResolvedValue({ pages: null, error: "connection refused" });
    const res = await GET(request());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("connection refused") });
  });

  it("derives the watchlist from the caller's own pages and passes it to the collector", async () => {
    listPages.mockResolvedValue({
      pages: [page("p1", "We run Next.js 14.2.3 behind Cloudflare.")],
      error: null,
    });
    await GET(request());
    const { entries } = collectTechWatch.mock.calls[0][0];
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("nextjs");
    expect(ids).toContain("cloudflare");
    const next = entries.find((e) => e.id === "nextjs");
    expect(next.detectedVersions).toEqual(["14.2.3"]);
    // The collector needs the fetch coordinates, so they must survive the trip.
    expect(next.osv).toEqual({ name: "next", ecosystem: "npm" });
  });

  it("returns the briefing the collector produced", async () => {
    const items = [
      {
        id: "osv:nextjs:GHSA-1",
        sourceId: "osv",
        category: "vulnerability",
        severity: "high",
        title: "A thing",
        technologyId: "nextjs",
        technology: "Next.js",
        affected: "< 15.5.16",
        occurredAt: "2026-08-17T14:00:00.000Z",
        timePrecision: "minute",
        status: "",
        summary: "",
        rootCause: "Because.",
        remedy: "Upgrade.",
        workaround: "",
        exploited: true,
        cveIds: ["CVE-2026-44575"],
        sources: [{ label: "Advisory", url: "https://example.com/a" }],
      },
    ];
    const lifecycle = [{ technologyId: "nextjs", technology: "Next.js", cycle: "14", state: "unsupported", inUse: true }];
    const sources = [{ id: "osv:nextjs", label: "OSV Next.js", technologyId: "nextjs", ok: true, error: null, itemCount: 1, note: null }];
    collectTechWatch.mockResolvedValue({ items, lifecycle, sources });

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual(items);
    expect(body.lifecycle).toEqual(lifecycle);
    expect(body.sources).toEqual(sources);
    expect(typeof body.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
  });

  it("summarizes the watchlist for the client without leaking internal fetch coordinates", async () => {
    listPages.mockResolvedValue({ pages: [page("p1", "React 17 and TypeScript")], error: null });
    const res = await GET(request());
    const body = await res.json();
    expect(body.watchlist.usedDefaults).toBe(false);
    expect(typeof body.watchlist.truncated).toBe("boolean");
    const react = body.watchlist.entries.find((e) => e.id === "react");
    // Exact shape, not toMatchObject: the client renders names, not
    // endpoints, and an allow-list assertion is the only kind that catches a
    // coordinate (or the alias list) being echoed by accident. It also pins
    // that `hits` is PRESENT, which a not.toHaveProperty sweep cannot.
    expect(react).toEqual({
      id: "react",
      label: "React",
      detectedIn: ["p1"],
      detectedVersions: ["17"],
      hits: expect.any(Number),
    });
    for (const entry of body.watchlist.entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "detectedIn",
        "detectedVersions",
        "hits",
        "id",
        "label",
      ]);
    }
  });

  it("says when it fell back to the default watchlist", async () => {
    listPages.mockResolvedValue({ pages: [], error: null });
    const body = await (await GET(request())).json();
    expect(body.watchlist.usedDefaults).toBe(true);
    expect(body.watchlist.entries.length).toBeGreaterThan(0);
  });

  it.each([
    ["", 24],
    ["?windowHours=24", 24],
    ["?windowHours=72", 72],
    ["?windowHours=168", 168],
  ])("accepts %s as a %s hour window", async (qs, expected) => {
    const res = await GET(request(qs));
    expect(collectTechWatch.mock.calls[0][0].windowHours).toBe(expected);
    await expect(res.json()).resolves.toMatchObject({ windowHours: expected });
  });

  it.each(["?windowHours=abc", "?windowHours=0", "?windowHours=-5", "?windowHours=9999", "?windowHours="])(
    "falls back to 24 hours for %s rather than refusing to brief",
    async (qs) => {
      const res = await GET(request(qs));
      expect(res.status).toBe(200);
      expect(collectTechWatch.mock.calls[0][0].windowHours).toBe(24);
    },
  );

  it("still answers 200 when every source failed, so the client can say what broke", async () => {
    collectTechWatch.mockResolvedValue({
      items: [],
      lifecycle: [],
      sources: [
        { id: "osv:nextjs", label: "OSV Next.js", technologyId: "nextjs", ok: false, error: "503", itemCount: 0, note: null },
      ],
    });
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    // A 500 here would erase the difference between "nothing happened" and
    // "we could not look", which is the difference the panel exists to show.
    expect(body.items).toEqual([]);
    expect(body.sources[0].ok).toBe(false);
  });

  it("reports a 500 when the collector itself throws, which it is contracted never to do", async () => {
    collectTechWatch.mockRejectedValue(new Error("unexpected"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("is marked dynamic so no shared cache can serve one user's watchlist to another", async () => {
    const mod = await import("./route.js");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.runtime).toBe("nodejs");
  });
});
