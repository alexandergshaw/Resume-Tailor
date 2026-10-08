import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ROW2_PENDING_MAX_MS,
  normalizeLiveResult,
  finalProjectExample,
  projectExampleFromResponse,
  startProjectExampleLive,
} from "./projectExampleLive.js";

const READY = (over = {}) => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeLiveResult", () => {
  it("keeps a usable ready entry", () => {
    const entry = READY();
    expect(normalizeLiveResult({ projectExample: entry })).toBe(entry);
  });

  it("turns the embedded engine's null into 'nothing to show'", () => {
    expect(normalizeLiveResult({ projectExample: null })).toBeUndefined();
  });

  it("turns anything that is not a usable ready entry into failed", () => {
    const failed = { status: "failed" };
    expect(normalizeLiveResult({ projectExample: failed })).toEqual(failed);
    expect(normalizeLiveResult({})).toEqual(failed);
    expect(normalizeLiveResult(undefined)).toEqual(failed);
    expect(normalizeLiveResult({ projectExample: READY({ bullets: [] }) })).toEqual(failed);
    expect(normalizeLiveResult({ projectExample: READY({ bullets: "one, two" }) })).toEqual(failed);
    expect(normalizeLiveResult({ projectExample: READY({ title: "  " }) })).toEqual(failed);
    expect(normalizeLiveResult({ projectExample: { ...READY(), status: "pending" } })).toEqual(failed);
  });
});

describe("finalProjectExample", () => {
  it("replays only ready and no_match", () => {
    const ready = READY();
    expect(finalProjectExample(ready)).toBe(ready);
    expect(finalProjectExample({ status: "no_match" })).toEqual({ status: "no_match" });
  });

  it("drops pending, failed and absent values rather than replaying them", () => {
    expect(finalProjectExample({ status: "pending" })).toBeUndefined();
    expect(finalProjectExample({ status: "failed" })).toBeUndefined();
    expect(finalProjectExample(undefined)).toBeUndefined();
    expect(finalProjectExample(null)).toBeUndefined();
  });
});

describe("projectExampleFromResponse", () => {
  it("keeps a status-shaped value and leaves an absent one absent (never defaulted to pending)", () => {
    const value = { status: "pending" };
    expect(projectExampleFromResponse(value)).toBe(value);
    expect(projectExampleFromResponse(undefined)).toBeUndefined();
    expect(projectExampleFromResponse(null)).toBeUndefined();
    expect(projectExampleFromResponse({ title: "no status" })).toBeUndefined();
  });
});

describe("startProjectExampleLive", () => {
  it("does nothing and returns false with no application or on the embedded engine", () => {
    const fetchLive = vi.fn();
    const apply = vi.fn();
    expect(startProjectExampleLive({ applicationId: "", question: "q", engine: "gemini", fetchLive, apply })).toBe(false);
    expect(startProjectExampleLive({ applicationId: "a1", question: "q", engine: "embedded", fetchLive, apply })).toBe(false);
    expect(fetchLive).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("writes pending first, then the settled value, and passes the question through", async () => {
    const applied = [];
    const fetchLive = vi.fn(async () => ({ projectExample: READY() }));
    const started = startProjectExampleLive({
      applicationId: "a1",
      question: "Tell me about an incident.",
      engine: "gemini",
      fetchLive,
      apply: (value, settled) => applied.push({ value, settled }),
    });
    expect(started).toBe(true);
    expect(applied).toEqual([{ value: { status: "pending" }, settled: false }]);
    await vi.waitFor(() => expect(applied).toHaveLength(2));
    expect(applied[1].settled).toBe(true);
    expect(applied[1].value.title).toBe("Rebuilt the paging rotation");
    const arg = fetchLive.mock.calls[0][0];
    expect(arg.applicationId).toBe("a1");
    expect(arg.question).toBe("Tell me about an incident.");
  });

  it("settles a rejected request as failed, never as a rejection", async () => {
    const applied = [];
    startProjectExampleLive({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchLive: () => Promise.reject(new Error("network down")),
      apply: (value, settled) => applied.push({ value, settled }),
    });
    await vi.waitFor(() => expect(applied).toHaveLength(2));
    expect(applied[1]).toEqual({ value: { status: "failed" }, settled: true });
  });

  it("settles a request function that throws synchronously as failed", async () => {
    const applied = [];
    startProjectExampleLive({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchLive: () => {
        throw new Error("boom");
      },
      apply: (value, settled) => applied.push({ value, settled }),
    });
    await vi.waitFor(() => expect(applied).toHaveLength(2));
    expect(applied[1]).toEqual({ value: { status: "failed" }, settled: true });
  });

  it("writes exactly one settled value: a late result after the watchdog fired is ignored", async () => {
    vi.useFakeTimers();
    let release;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    const applied = [];
    let signal;
    startProjectExampleLive({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchLive: (args) => {
        signal = args.signal;
        return slow;
      },
      apply: (value, settled) => applied.push({ value, settled }),
    });
    expect(applied).toHaveLength(1);

    // The watchdog gives up at ROW2_PENDING_MAX_MS: pending reaches a terminal
    // state even though the request never answered, and the request is aborted.
    await vi.advanceTimersByTimeAsync(ROW2_PENDING_MAX_MS);
    expect(applied).toHaveLength(2);
    expect(applied[1]).toEqual({ value: { status: "failed" }, settled: true });
    expect(signal.aborted).toBe(true);

    // A result arriving after that must not repaint the card.
    release({ projectExample: READY() });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toHaveLength(2);
  });

  it("does not fire the watchdog once the request has settled", async () => {
    vi.useFakeTimers();
    const applied = [];
    startProjectExampleLive({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchLive: async () => ({ projectExample: READY() }),
      apply: (value, settled) => applied.push({ value, settled }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(ROW2_PENDING_MAX_MS * 2);
    expect(applied).toHaveLength(2);
    expect(applied[1].value.status).toBe("ready");
  });
});
