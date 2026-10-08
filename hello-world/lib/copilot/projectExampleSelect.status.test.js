// N143 fix round F1 -- M2 (a pool read ERROR is not "being prepared") and the
// owner probe's evidence (withPoolTags).
//
// M2. The answer route used to destructure `{ pool, error }` from the pool read,
// log the error, and then hand buildProjectExample only the pool. A failed read
// came back as `{ pool: null }`, which is indistinguishable from "no row yet",
// so a database that was down or slow read as `{ status: "pending" }` -- "being
// prepared" -- on every question for as long as it stayed down. A clean miss and
// a failed read are different facts: the first self-heals (the client asks for
// the pool and it appears), the second says nothing about whether a pool exists.
//
// The two landed pending tests in projectExampleSelect.test.js (no row, young
// pending row) are unchanged and still pin the clean-miss side.

import { describe, it, expect } from "vitest";
import {
  buildProjectExample,
  selectPoolProject,
  withPoolTags,
  POOL_PENDING_MAX_AGE,
} from "./projectExampleSelect.js";

const AT = Date.parse("2026-10-08T00:00:00.000Z");
const entry = (over = {}) => ({
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack improved"],
  hypothetical: true,
  ...over,
});
const readyPool = (projects = [entry()]) => ({ status: "ready", projects, engine: "gemini", updated_at: "2026-10-08T00:00:00.000Z" });
const Q = "Tell me about an incident you handled in production.";

describe("buildProjectExample -- a read ERROR is failed, a clean miss is pending (M2)", () => {
  it("[positive control] a clean miss (no row, no error) is still pending", () => {
    const out = buildProjectExample({ pool: null, poolError: null, pick: null, applicationId: "app-1", engine: "gemini", now: AT });
    expect(out).toEqual({ status: "pending" });
  });

  it("a read that ERRORED is failed, never pending", () => {
    const out = buildProjectExample({
      pool: null,
      poolError: "connection reset by peer",
      pick: null,
      applicationId: "app-1",
      engine: "gemini",
      now: AT,
    });
    expect(out).toEqual({ status: "failed" });
  });

  it("a timed-out read (reported as an error) is failed", () => {
    const out = buildProjectExample({
      pool: null,
      poolError: "Timed out reading the project pool.",
      pick: null,
      applicationId: "app-1",
      engine: "gemini",
      now: AT,
    });
    expect(out).toEqual({ status: "failed" });
  });

  it("the error outranks whatever pool the caller also passed: a failed read never emits a benchmark", () => {
    // Defensive: a caller that passed both would otherwise get ready content
    // from a read that reported it had failed.
    const out = buildProjectExample({
      pool: readyPool(),
      poolError: "boom",
      pick: selectPoolProject([entry()], { question: Q }),
      applicationId: "app-1",
      engine: "gemini",
      now: AT,
    });
    expect(out).toEqual({ status: "failed" });
    expect(out).not.toHaveProperty("title");
    expect(out).not.toHaveProperty("bullets");
  });

  it("an error does not make the omit cases speak: no applicationId and an embedded engine still omit", () => {
    expect(buildProjectExample({ pool: null, poolError: "boom", applicationId: "", engine: "gemini", now: AT })).toBeUndefined();
    expect(buildProjectExample({ pool: null, poolError: "boom", applicationId: "app-1", engine: "embedded", now: AT })).toBeUndefined();
  });

  it("a young pending row is still pending when no error accompanies it (the warming state is intact)", () => {
    const out = buildProjectExample({
      pool: { status: "pending", projects: [], updated_at: "2026-10-08T00:00:00.000Z" },
      poolError: null,
      pick: null,
      applicationId: "app-1",
      engine: "gemini",
      now: AT + (POOL_PENDING_MAX_AGE - 1000),
    });
    expect(out).toEqual({ status: "pending" });
  });
});

describe("withPoolTags -- the whole pool, for the owner probe", () => {
  const POOL = [
    entry({ competency: "incident response", domain: "SRE", title: "Rebuilt the paging rotation" }),
    entry({ competency: "capacity planning", domain: "cloud infrastructure", title: "Forecast the quarter's load" }),
    entry({ competency: "observability", domain: "monitoring", title: "One dashboard per service" }),
  ];

  it("[positive control] a ready value gains the fit score and EVERY entry's competency, domain and title", () => {
    const pick = selectPoolProject(POOL, { question: Q });
    const base = buildProjectExample({ pool: readyPool(POOL), pick, applicationId: "app-1", engine: "gemini", now: AT });
    expect(base.status).toBe("ready");
    const out = withPoolTags(base, { pool: readyPool(POOL), pick });
    expect(out.fitScore).toBe(pick.fitScore);
    expect(out.poolTags).toEqual([
      { competency: "incident response", domain: "SRE", title: "Rebuilt the paging rotation" },
      { competency: "capacity planning", domain: "cloud infrastructure", title: "Forecast the quarter's load" },
      { competency: "observability", domain: "monitoring", title: "One dashboard per service" },
    ]);
    // The value's own fields are untouched.
    expect(out.title).toBe(base.title);
    expect(out.bullets).toEqual(base.bullets);
  });

  it("a no_match value gains them too, which is when the probe needs them most", () => {
    const pick = selectPoolProject(POOL, { question: "Describe how you redesigned a curriculum unit." });
    expect(pick.outcome).toBe("no_match");
    const base = buildProjectExample({ pool: readyPool(POOL), pick, applicationId: "app-1", engine: "gemini", now: AT });
    expect(base).toEqual({ status: "no_match" });
    const out = withPoolTags(base, { pool: readyPool(POOL), pick });
    expect(out.status).toBe("no_match");
    expect(out.fitScore).toBe(0);
    expect(out.poolTags).toHaveLength(3);
    // Still carries no benchmark of its own.
    expect(out).not.toHaveProperty("bullets");
    expect(out).not.toHaveProperty("title");
  });

  it("carries no bullets: tags and titles only", () => {
    const pick = selectPoolProject(POOL, { question: Q });
    const out = withPoolTags(
      buildProjectExample({ pool: readyPool(POOL), pick, applicationId: "app-1", engine: "gemini", now: AT }),
      { pool: readyPool(POOL), pick },
    );
    for (const tag of out.poolTags) expect(Object.keys(tag).sort()).toEqual(["competency", "domain", "title"]);
  });

  it("[mutation control] pending, failed and omitted values pass through untouched", () => {
    for (const example of [{ status: "pending" }, { status: "failed" }, undefined, null]) {
      expect(withPoolTags(example, { pool: readyPool(POOL), pick: { fitScore: 3 } })).toBe(example);
    }
  });

  it("tolerates a malformed pool and a missing pick without throwing", () => {
    const ready = { status: "ready", title: "t", bullets: ["a"] };
    expect(withPoolTags(ready, { pool: null, pick: undefined })).toEqual({ ...ready, fitScore: 0, poolTags: [] });
    expect(withPoolTags(ready, { pool: { projects: [null, "x", entry()] }, pick: { fitScore: 2 } }).poolTags).toHaveLength(1);
  });

  it("bounds a runaway tag instead of putting it on the wire", () => {
    const long = "x".repeat(5000);
    const out = withPoolTags({ status: "no_match" }, { pool: { projects: [entry({ competency: long, domain: long, title: long })] }, pick: null });
    expect(out.poolTags[0].competency.length).toBeLessThanOrEqual(120);
    expect(out.poolTags[0].title.length).toBeLessThanOrEqual(120);
  });
});
