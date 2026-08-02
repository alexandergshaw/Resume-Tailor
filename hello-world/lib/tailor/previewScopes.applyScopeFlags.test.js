import { describe, it, expect } from "vitest";
import { applyScopeFlags } from "./previewScopes.js";

function makePrev() {
  return {
    busy: { resume: false, cover: false },
    notice: { resume: "", cover: "" },
    error: { resume: "", cover: "" },
    tab: "resume",
    jobId: "j1",
  };
}

describe("applyScopeFlags", () => {
  it("writes only the targeted scope for a single scope string, leaving the other scope untouched", () => {
    const prev = makePrev();
    const next = applyScopeFlags(prev, "resume", { busy: true });
    expect(next.busy).toEqual({ resume: true, cover: false });
  });

  it("writes all listed scopes when given an array of scopes", () => {
    const prev = makePrev();
    const next = applyScopeFlags(prev, ["resume", "cover"], { busy: true });
    expect(next.busy).toEqual({ resume: true, cover: true });
  });

  it("only touches keys present in the patch, leaving the other flag maps object-identical to prev", () => {
    const prev = makePrev();
    const next = applyScopeFlags(prev, "resume", { busy: true });
    expect(next.notice).toBe(prev.notice);
    expect(next.error).toBe(prev.error);
  });

  it("leaves unrelated top-level fields like tab and jobId unchanged", () => {
    const prev = makePrev();
    const next = applyScopeFlags(prev, "cover", { notice: "saved" });
    expect(next.tab).toBe("resume");
    expect(next.jobId).toBe("j1");
  });

  it("does not mutate prev or its nested per-key objects", () => {
    const prev = makePrev();
    const prevBusyRef = prev.busy;
    const next = applyScopeFlags(prev, "resume", { busy: true });
    expect(prev.busy.resume).toBe(false);
    expect(prev.busy).toBe(prevBusyRef);
    expect(next.busy).not.toBe(prev.busy);
  });

  it("updates busy, notice, and error together when the patch contains all three keys", () => {
    const prev = makePrev();
    const next = applyScopeFlags(prev, "cover", {
      busy: false,
      notice: "done",
      error: "oops",
    });
    expect(next.busy).toEqual({ resume: false, cover: false });
    expect(next.notice).toEqual({ resume: "", cover: "done" });
    expect(next.error).toEqual({ resume: "", cover: "oops" });
  });

  it("returns an object equal in content to prev but a different reference for an empty patch", () => {
    const prev = makePrev();
    const next = applyScopeFlags(prev, "resume", {});
    expect(next).toEqual(prev);
    expect(next).not.toBe(prev);
  });

  it("is harmless to list the same scope twice in the scopes array", () => {
    const prev = makePrev();
    const next = applyScopeFlags(prev, ["resume", "resume"], { notice: "hi" });
    expect(next.notice).toEqual({ resume: "hi", cover: "" });
  });
});
