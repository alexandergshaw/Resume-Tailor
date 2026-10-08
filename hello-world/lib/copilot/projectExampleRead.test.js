// N143 fix round F1, M1 + M2 -- how the answer route gets Row 1 onto a done
// frame without it ever costing the answer anything (lib/copilot/projectExampleRead.js).
// The route-level proof (a never-resolving read still streams the answer, and
// the points frames are written while the read is unsettled) is
// app/api/copilot/answer/route.projectPoolRead.test.js; this is the unit half.
//
// The deadline is read back through fake timers: it is deliberately not an
// export, and a hung read is by definition a promise that never settles, so the
// only honest way to see the deadline win is to let the clock run past it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startProjectExampleField } from "./projectExampleRead.js";
import { selectPoolProject } from "./projectExampleSelect.js";

const entry = (competency, domain, title) => ({
  competency,
  domain,
  title,
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack improved"],
  hypothetical: true,
});
const READY = {
  status: "ready",
  engine: "gemini",
  updated_at: "2026-10-08T00:00:00.000Z",
  projects: [entry("incident response", "SRE", "Rebuilt the paging rotation"), entry("curriculum design", "K-12 teaching", "Rebuilt the fractions unit")],
};
const Q = "Tell me about an incident you handled in production.";
const pick = (pool) => selectPoolProject(pool?.projects, { question: Q });
const NEVER = () => new Promise(() => {});

function start(overrides = {}) {
  return startProjectExampleField({ read: async () => ({ pool: READY, error: null }), pick, applicationId: "app-1", engine: "gemini", ...overrides });
}

let warn;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startProjectExampleField -- the fragment, per status", () => {
  it("[positive control] a ready pool and a close pick yield a ready example carrying the probe's evidence", async () => {
    const { projectExample } = await start();
    expect(projectExample.status).toBe("ready");
    expect(projectExample.competency).toBe("incident response");
    expect(projectExample.fitScore).toBeGreaterThanOrEqual(1);
    expect(projectExample.poolTags).toHaveLength(2);
  });

  it("no close pick yields no_match", async () => {
    const { projectExample } = await start({ pick: () => ({ outcome: "no_match", entry: null, fitScore: 0 }) });
    expect(projectExample.status).toBe("no_match");
  });

  it("a clean miss (no row, no error) is pending", async () => {
    expect(await start({ read: async () => ({ pool: null, error: null }) })).toEqual({ projectExample: { status: "pending" } });
  });

  it("a read that reports an error is failed, never pending, and is logged", async () => {
    const out = await start({ read: async () => ({ pool: null, error: "connection reset" }) });
    expect(out).toEqual({ projectExample: { status: "failed" } });
    expect(warn).toHaveBeenCalled();
  });

  it("a read that rejects, or throws before it returns a promise, is failed and never rejects", async () => {
    await expect(start({ read: () => Promise.reject(new Error("db down")) })).resolves.toEqual({ projectExample: { status: "failed" } });
    await expect(
      start({
        read: () => {
          throw new Error("client could not be built");
        },
      }),
    ).resolves.toEqual({ projectExample: { status: "failed" } });
  });

  it("a pick that throws is a failed card, not a failed answer", async () => {
    const out = await start({
      pick: () => {
        throw new Error("boom");
      },
    });
    expect(out).toEqual({ projectExample: { status: "failed" } });
  });
});

describe("startProjectExampleField -- when there is no Row 1 to build", () => {
  it("starts no read and yields {} with no applicationId", async () => {
    const read = vi.fn(async () => ({ pool: READY, error: null }));
    expect(await start({ read, applicationId: "" })).toEqual({});
    expect(read).not.toHaveBeenCalled();
  });

  it("starts no read and yields {} for the embedded engine, however good the pool", async () => {
    const read = vi.fn(async () => ({ pool: READY, error: null }));
    expect(await start({ read, engine: "embedded" })).toEqual({});
    expect(read).not.toHaveBeenCalled();
  });

  it("[control] the same inputs with a Gemini engine DO start the read, so the two cases above are not a dead gate", async () => {
    const read = vi.fn(async () => ({ pool: READY, error: null }));
    await start({ read });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a pick that throws still yields {} (not a failed card) when there was nothing to build", async () => {
    const out = await start({
      engine: "embedded",
      pick: () => {
        throw new Error("boom");
      },
    });
    expect(out).toEqual({});
  });
});

describe("startProjectExampleField -- the deadline (M1)", () => {
  it("a read that never settles resolves to failed once the default deadline passes -- it does not hang", async () => {
    vi.useFakeTimers();
    let result = null;
    start({ read: NEVER }).then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBeNull();
    // Past a few seconds the wait would be felt on the done frame it delays.
    await vi.advanceTimersByTimeAsync(3000);
    expect(result).toEqual({ projectExample: { status: "failed" } });
  });

  it("a read that settles inside the deadline wins; one that settles after it loses", async () => {
    vi.useFakeTimers();
    const after = (ms) => () => new Promise((resolve) => setTimeout(() => resolve({ pool: READY, error: null }), ms));
    let fast = null;
    let slow = null;
    start({ read: after(100) }).then((value) => (fast = value));
    start({ read: after(10_000) }).then((value) => (slow = value));
    await vi.advanceTimersByTimeAsync(3000);
    expect(fast.projectExample.status).toBe("ready");
    expect(slow).toEqual({ projectExample: { status: "failed" } });
  });

  it("the read is STARTED synchronously, so its clock runs from the request and not from the wait", () => {
    const read = vi.fn(NEVER);
    start({ read });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
