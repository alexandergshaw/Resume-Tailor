// Outages, from Atlassian Statuspage's public incidents feed.
// Written before lib/techwatch/sources/statuspage.js exists.
//
// The fixture is a REAL trimmed response from https://www.githubstatus.com,
// captured 2026-08-17. It is the guard against upstream shape drift and must
// not be replaced with a hand-written object: a parser tested only against
// what we imagine the vendor sends is a parser tested against itself.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseStatuspageIncidents,
  parseStatuspageMaintenances,
  fetchStatuspageIncidents,
  fetchStatuspageMaintenances,
} from "./statuspage.js";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/statuspage.github.json", import.meta.url)), "utf8"),
);

const NOW = new Date("2026-08-17T15:30:00.000Z");

const ENTRY = {
  id: "github",
  label: "GitHub",
  statuspage: { host: "www.githubstatus.com", vendor: "GitHub" },
};

// Everything in the fixture, so window filtering can be tested separately
// from mapping.
const WIDE = { entry: ENTRY, now: NOW, windowHours: 168 };

describe("parseStatuspageIncidents", () => {
  it("maps every incident in the fixture inside a wide window", () => {
    const items = parseStatuspageIncidents(FIXTURE, WIDE);
    expect(items.map((i) => i.id)).toEqual([
      "statuspage:github:zkxwbgr0cnmx",
      "statuspage:github:pf25whpq58hh",
      "statuspage:github:24t8gsgqx2qb",
    ]);
  });

  it("dates an ongoing incident by its NEWEST update, not when it opened", () => {
    // This is what makes an unfolding outage reappear in the current hour of
    // the briefing instead of sitting frozen in the hour it started.
    const [live] = parseStatuspageIncidents(FIXTURE, WIDE);
    expect(live.occurredAt).toBe("2026-08-17T14:49:24.334Z");
    expect(live.occurredAt).not.toBe("2026-08-17T13:40:03.629Z");
    expect(live.timePrecision).toBe("minute");
  });

  it("carries the incident's own name, status, components and status-page link", () => {
    const [live] = parseStatuspageIncidents(FIXTURE, WIDE);
    expect(live.category).toBe("outage");
    expect(live.title).toBe("Incident with GitHub.com");
    expect(live.status).toBe("investigating");
    expect(live.technologyId).toBe("github");
    expect(live.technology).toBe("GitHub");
    expect(live.affected).toBe("Webhooks, API Requests, Issues, Pull Requests, Actions, Copilot");
    expect(live.sources).toEqual([
      { label: "GitHub status", url: "https://stspg.io/y1fl26l6wpzr" },
    ]);
  });

  it("summarizes with the newest update's own words", () => {
    const [live] = parseStatuspageIncidents(FIXTURE, WIDE);
    expect(live.summary).toBe(
      "Issues is experiencing degraded availability. We are continuing to investigate.",
    );
  });

  it.each([
    ["critical", "critical"],
    ["major", "high"],
    ["minor", "medium"],
    ["maintenance", "info"],
    ["none", "info"],
    ["something-new", "info"],
  ])("maps impact %s to severity %s", (impact, severity) => {
    const json = { incidents: [{ ...FIXTURE.incidents[0], id: "x", impact }] };
    const [item] = parseStatuspageIncidents(json, WIDE);
    expect(item.severity).toBe(severity);
  });

  it("leaves rootCause blank when the vendor has only said it is investigating", () => {
    // Every update on this incident is status "investigating". Borrowing
    // that text as a root cause would put "we are continuing to investigate"
    // under a heading that claims to explain why - worse than an honest gap.
    const [live] = parseStatuspageIncidents(FIXTURE, WIDE);
    expect(live.rootCause).toBe("");
    expect(live.remedy).toBe("");
    expect(live.workaround).toBe("");
  });

  it("takes rootCause from an identified update and remedy from the resolved one", () => {
    const json = {
      incidents: [
        {
          id: "rca",
          name: "Elevated errors",
          status: "resolved",
          impact: "major",
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T12:00:00.000Z",
          shortlink: "https://stspg.io/rca",
          components: [{ name: "API" }],
          incident_updates: [
            { id: "u3", status: "resolved", body: "Rolled back the deploy.", created_at: "2026-08-17T12:00:00.000Z" },
            { id: "u2", status: "identified", body: "A bad config push exhausted the connection pool.", created_at: "2026-08-17T11:00:00.000Z" },
            { id: "u1", status: "investigating", body: "Looking into it.", created_at: "2026-08-17T10:00:00.000Z" },
          ],
        },
      ],
    };
    const [item] = parseStatuspageIncidents(json, WIDE);
    expect(item.rootCause).toBe("A bad config push exhausted the connection pool.");
    expect(item.remedy).toBe("Rolled back the deploy.");
    expect(item.status).toBe("resolved");
  });

  it("prefers a postmortem update over an earlier identified one for rootCause", () => {
    const json = {
      incidents: [
        {
          id: "pm",
          name: "Elevated errors",
          status: "postmortem",
          impact: "major",
          created_at: "2026-08-17T10:00:00.000Z",
          shortlink: "https://stspg.io/pm",
          components: [],
          incident_updates: [
            { id: "u3", status: "postmortem", body: "Full writeup: a schema migration locked the table.", created_at: "2026-08-17T13:00:00.000Z" },
            { id: "u2", status: "identified", body: "Early guess.", created_at: "2026-08-17T11:00:00.000Z" },
          ],
        },
      ],
    };
    const [item] = parseStatuspageIncidents(json, WIDE);
    expect(item.rootCause).toBe("Full writeup: a schema migration locked the table.");
  });

  it("drops incidents older than the window and keeps the ones inside it", () => {
    const items = parseStatuspageIncidents(FIXTURE, { entry: ENTRY, now: NOW, windowHours: 24 });
    // Positive control alongside the exclusion: a parser returning nothing
    // would satisfy "the 13 August incidents are gone" all by itself.
    expect(items.map((i) => i.id)).toEqual(["statuspage:github:zkxwbgr0cnmx"]);
  });

  it("dates an incident with no updates from updated_at, then created_at", () => {
    // Every incident in the fixture and every synthetic one above has a
    // non-empty incident_updates, so an implementation that reads
    // `incident_updates[0].created_at` with NO fallback passes all of them.
    // Real feeds do serve incidents with an empty updates array, and under
    // that implementation occurredAt is undefined, normalizeItem returns
    // null, and the outage disappears with no failed-source row to hint at it.
    const noUpdates = {
      ...FIXTURE.incidents[0],
      id: "no-updates",
      incident_updates: [],
      updated_at: "2026-08-17T14:00:00.000Z",
    };
    expect(parseStatuspageIncidents({ incidents: [noUpdates] }, WIDE)[0].occurredAt).toBe(
      "2026-08-17T14:00:00.000Z",
    );

    const bare = { ...noUpdates, id: "bare", updated_at: undefined };
    expect(parseStatuspageIncidents({ incidents: [bare] }, WIDE)[0].occurredAt).toBe(
      "2026-08-17T13:40:03.629Z",
    );
  });

  it("returns an empty array for a malformed payload instead of throwing", () => {
    for (const json of [null, undefined, {}, { incidents: null }, { incidents: "nope" }]) {
      expect(parseStatuspageIncidents(json, WIDE)).toEqual([]);
    }
  });

  it("skips an individual incident that has no id, keeping its siblings", () => {
    const json = {
      incidents: [
        { ...FIXTURE.incidents[0], id: "" },
        FIXTURE.incidents[0],
      ],
    };
    expect(parseStatuspageIncidents(json, WIDE).map((i) => i.id)).toEqual([
      "statuspage:github:zkxwbgr0cnmx",
    ]);
  });

  it("omits a blank shortlink rather than emitting a link to nowhere", () => {
    const json = { incidents: [{ ...FIXTURE.incidents[0], shortlink: "" }] };
    expect(parseStatuspageIncidents(json, WIDE)[0].sources).toEqual([]);
  });
});

// Planned maintenance is the vendor's own announcement of a coming change or
// decommission - the third thing the briefing is for, and it lives on a
// DIFFERENT endpoint from incidents.json.
describe("parseStatuspageMaintenances", () => {
  const MAINTENANCE = {
    scheduled_maintenances: [
      {
        id: "mnt1",
        name: "Retiring the v1 REST endpoints",
        status: "scheduled",
        impact: "maintenance",
        created_at: "2026-08-17T09:00:00.000Z",
        scheduled_for: "2026-09-01T01:00:00.000Z",
        shortlink: "https://stspg.io/mnt1",
        components: [{ name: "API Requests" }],
        incident_updates: [
          {
            id: "u1",
            status: "scheduled",
            body: "The v1 REST endpoints will be removed. Migrate to v2 before 1 September.",
            created_at: "2026-08-17T09:00:00.000Z",
          },
        ],
      },
    ],
  };

  it("reads the scheduled_maintenances array, not incidents", () => {
    const items = parseStatuspageMaintenances(MAINTENANCE, WIDE);
    expect(items.map((i) => i.id)).toEqual(["statuspage-maint:github:mnt1"]);
    expect(items[0].title).toBe("Retiring the v1 REST endpoints");
    expect(items[0].summary).toContain("Migrate to v2");
  });

  it("marks a maintenance as scheduled and informational, whatever its impact says", () => {
    const [item] = parseStatuspageMaintenances(MAINTENANCE, WIDE);
    expect(item.category).toBe("outage");
    expect(item.status).toBe("scheduled");
    expect(item.severity).toBe("info");
    expect(item.affected).toBe("API Requests");
  });

  it("returns an empty array when the vendor has nothing scheduled", () => {
    expect(parseStatuspageMaintenances({ scheduled_maintenances: [] }, WIDE)).toEqual([]);
    expect(parseStatuspageMaintenances({}, WIDE)).toEqual([]);
    expect(parseStatuspageMaintenances(null, WIDE)).toEqual([]);
    // It must NOT fall back to reading `incidents` - the two feeds are
    // different endpoints and mixing them double-reports every outage.
    expect(parseStatuspageMaintenances(FIXTURE, WIDE)).toEqual([]);
  });
});

describe("fetchStatuspageIncidents", () => {
  it("requests the vendor's own incidents feed over https", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE,
    });
    const result = await fetchStatuspageIncidents({ entry: ENTRY, fetchImpl, now: NOW, windowHours: 168 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://www.githubstatus.com/api/v2/incidents.json");
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.error).toBeNull();
  });

  it("reports a non-ok response as a failure without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const result = await fetchStatuspageIncidents({ entry: ENTRY, fetchImpl, now: NOW, windowHours: 24 });
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(String(result.error)).toContain("503");
  });

  it("reports a network throw as a failure without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const result = await fetchStatuspageIncidents({ entry: ENTRY, fetchImpl, now: NOW, windowHours: 24 });
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(String(result.error)).toContain("ENOTFOUND");
  });

  it("makes no request at all for an entry with no status page", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchStatuspageIncidents({
      entry: { id: "react", label: "React", statuspage: null },
      fetchImpl,
      now: NOW,
      windowHours: 24,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, items: [], error: null, note: null });
  });
});

describe("fetchStatuspageMaintenances", () => {
  it("requests the scheduled-maintenances endpoint, not the incidents one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ scheduled_maintenances: [] }),
    });
    const result = await fetchStatuspageMaintenances({ entry: ENTRY, fetchImpl, now: NOW, windowHours: 168 });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://www.githubstatus.com/api/v2/scheduled-maintenances.json",
    );
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it("makes no request for an entry with no status page", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchStatuspageMaintenances({
      entry: { id: "react", label: "React", statuspage: null },
      fetchImpl,
      now: NOW,
      windowHours: 24,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, items: [], error: null, note: null });
  });

  it("reports failure without throwing", async () => {
    const result = await fetchStatuspageMaintenances({
      entry: ENTRY,
      fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      now: NOW,
      windowHours: 24,
    });
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(String(result.error)).toContain("ECONNRESET");
    expect(result.note).toBeNull();
  });

  it("treats a 404 as 'this vendor publishes no maintenance feed', not as unreachable", async () => {
    // Verified live on 2026-08-17: status.hashicorp.com returns 404 for
    // /api/v2/scheduled-maintenances.json while serving incidents.json
    // normally, and www.cloudflarestatus.com returns 200 for both. Reporting
    // the 404 as a failed source would put a permanent "could not be reached"
    // line in the panel - steady noise in the one signal the briefing uses to
    // admit what it could not see, which is precisely how such a signal stops
    // being read.
    const result = await fetchStatuspageMaintenances({
      entry: ENTRY,
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
      now: NOW,
      windowHours: 24,
    });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.error).toBeNull();
    expect(result.note).toBe("no maintenance feed");
  });

  it("still reports a 500 as a real failure", async () => {
    // Only 404 means "no such feed". A server error is the vendor being down
    // and must stay visible, or the 404 rule becomes a blanket excuse.
    const result = await fetchStatuspageMaintenances({
      entry: ENTRY,
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
      now: NOW,
      windowHours: 24,
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("500");
    expect(result.note).toBeNull();
  });
});
