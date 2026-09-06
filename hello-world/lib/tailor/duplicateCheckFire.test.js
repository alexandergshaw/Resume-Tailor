import { describe, it, expect, vi } from "vitest";
import { fireDuplicateCheckSafely } from "./duplicateCheckFire.js";

describe("fireDuplicateCheckSafely", () => {
  it("calls the callback with the candidate and ctx, unmodified", () => {
    const onCheckDuplicate = vi.fn();
    const candidate = { id: "job-1", title: "Staff Engineer" };
    const ctx = { jobId: "job-1", entryPoint: "revise" };
    fireDuplicateCheckSafely(onCheckDuplicate, candidate, ctx);
    expect(onCheckDuplicate).toHaveBeenCalledTimes(1);
    expect(onCheckDuplicate).toHaveBeenCalledWith(candidate, ctx);
  });

  it("is a no-op when onCheckDuplicate is not a function -- an omitted, optional prop", () => {
    expect(() => fireDuplicateCheckSafely(undefined, { id: "job-1" }, {})).not.toThrow();
    expect(() => fireDuplicateCheckSafely(null, { id: "job-1" }, {})).not.toThrow();
  });

  it("swallows a throw from the callback -- never escapes to the caller", () => {
    const onCheckDuplicate = vi.fn(() => {
      throw new Error("duplicate check exploded");
    });
    expect(() => fireDuplicateCheckSafely(onCheckDuplicate, { id: "job-1" }, {})).not.toThrow();
    expect(onCheckDuplicate).toHaveBeenCalledTimes(1);
  });
});
