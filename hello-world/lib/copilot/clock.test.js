import { describe, it, expect } from "vitest";
import { fmtClock } from "./clock";

describe("fmtClock", () => {
  it("formats zero as 0:00", () => {
    expect(fmtClock(0)).toBe("0:00");
  });

  it("formats a value with both minutes and seconds, padding seconds to two digits", () => {
    expect(fmtClock(61000)).toBe("1:01");
  });

  it("formats a round ten-minute value with zero-padded seconds", () => {
    expect(fmtClock(600000)).toBe("10:00");
  });

  it("clamps negative input to 0:00 instead of producing a negative clock", () => {
    expect(fmtClock(-5000)).toBe("0:00");
  });

  it("floors sub-second values down to 0:00", () => {
    expect(fmtClock(999)).toBe("0:00");
  });

  it("floors sub-second remainders past a whole second instead of rounding up", () => {
    expect(fmtClock(1999)).toBe("0:01");
  });
});
