// N143 fix round F2 (m1): the client-side Row 2 watchdog must outlast the
// server's budget for the same call. The owner removed the cap on Row 2 so a
// slow success lands; a watchdog shorter than the route's model deadline
// (ON_THE_SPOT_TIMEOUT_MS) would abort a request the server was about to answer
// and paint "Couldn't write one this time" over a project seconds away.
//
// Two pins, each against the failure direction:
//   1. the inequality itself, against the SERVER's own constant (so retuning
//      either side alone reds here instead of silently reintroducing the abort);
//   2. the behaviour: a result that arrives AFTER the server's deadline but
//      inside the watchdog is a ready example, with the matching control that a
//      request that never answers still ends in failed at the watchdog (so the
//      pending state can never stick).

import { describe, it, expect, vi, afterEach } from "vitest";
import { ROW2_PENDING_MAX_MS, startProjectExampleLive } from "./projectExampleLive.js";
import { ON_THE_SPOT_TIMEOUT_MS } from "./projectExampleGen.js";

const READY = {
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("the Row 2 watchdog outlasts the server's budget", () => {
  it("is at least the server's model deadline, and strictly more (the reads and the network ride on top)", () => {
    expect(ROW2_PENDING_MAX_MS).toBeGreaterThan(ON_THE_SPOT_TIMEOUT_MS);
  });

  it("lands a slow success that arrives after the server's deadline but before the watchdog", async () => {
    vi.useFakeTimers();
    let release;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    const applied = [];
    startProjectExampleLive({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchLive: () => slow,
      apply: (value, settled) => applied.push({ value, settled }),
    });
    // Past the server's own deadline: the old 20 s watchdog had already failed
    // this card by now.
    await vi.advanceTimersByTimeAsync(ON_THE_SPOT_TIMEOUT_MS + 1000);
    expect(applied).toHaveLength(1);
    release({ projectExample: READY });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toHaveLength(2);
    expect(applied[1].settled).toBe(true);
    expect(applied[1].value.status).toBe("ready");
  });

  it("[control] a request that never answers still ends in failed at the watchdog", async () => {
    vi.useFakeTimers();
    const applied = [];
    startProjectExampleLive({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchLive: () => new Promise(() => {}),
      apply: (value, settled) => applied.push({ value, settled }),
    });
    await vi.advanceTimersByTimeAsync(ROW2_PENDING_MAX_MS - 1);
    expect(applied).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toHaveLength(2);
    expect(applied[1]).toEqual({ value: { status: "failed" }, settled: true });
  });
});
