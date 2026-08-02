import { describe, it, expect } from "vitest";
import { classifyLineChanges } from "./versionDiff.js";

describe("classifyLineChanges", () => {
  it("returns an empty map for identical arrays", () => {
    const previous = ["line1", "line2", "line3"];
    const current = ["line1", "line2", "line3"];
    const changes = classifyLineChanges(previous, current);

    expect(changes).toBeInstanceOf(Map);
    expect(changes.size).toBe(0);
  });

  it("returns an empty map when previousLines is empty (first version is never all-marked)", () => {
    const previous = [];
    const current = ["line1", "line2", "line3"];
    const changes = classifyLineChanges(previous, current);

    expect(changes.size).toBe(0);
  });

  it("returns an empty map when currentLines is empty", () => {
    const previous = ["line1", "line2", "line3"];
    const current = [];
    const changes = classifyLineChanges(previous, current);

    expect(changes.size).toBe(0);
  });

  it("treats whitespace-only differences as unchanged", () => {
    const previous = ["a b"];
    const current = ["  a b  "];
    const changes = classifyLineChanges(previous, current);

    expect(changes.size).toBe(0);
  });

  it("classifies a line rewritten in place as modified at its index", () => {
    const previous = ["line1", "line2", "line3"];
    const current = ["line1", "line2_reworded", "line3"];
    const changes = classifyLineChanges(previous, current);

    expect(changes.size).toBe(1);
    expect(changes.get(1)).toBe("modified");
  });

  it("classifies an inserted line as added and leaves surrounding lines unmarked", () => {
    const previous = ["line1", "line2", "line3"];
    const current = ["line1", "NEW", "line2", "line3"];
    const changes = classifyLineChanges(previous, current);

    expect(changes.size).toBe(1);
    expect(changes.get(1)).toBe("added");
    expect(changes.has(0)).toBe(false);
    expect(changes.has(2)).toBe(false);
    expect(changes.has(3)).toBe(false);
  });

  it("leaves remaining current lines unmarked when a line is deleted from previous", () => {
    const previous = ["line1", "line2", "line3"];
    const current = ["line1", "line3"];
    const changes = classifyLineChanges(previous, current);

    expect(changes.size).toBe(0);
  });

  it("keeps the current-index mapping correct when blank lines surround a changed line", () => {
    const previous = ["Header", "Bullet one", "Footer"];
    const current = ["", "Header", "Bullet one edited", "", "Footer"];
    const changes = classifyLineChanges(previous, current);

    // Only the real changed line (index 2) is marked - the blanks at 0 and 3,
    // and the unchanged Header/Footer at 1 and 4, must not be flagged.
    expect(changes.size).toBe(1);
    expect(changes.get(2)).toBe("modified");
    expect(changes.has(0)).toBe(false);
    expect(changes.has(1)).toBe(false);
    expect(changes.has(3)).toBe(false);
    expect(changes.has(4)).toBe(false);
  });

  it("reports every independent change with the correct index and classification", () => {
    const previous = ["line1", "line2", "line3", "line4"];
    const current = ["line1_changed", "line2", "NEW", "line3", "line4_changed"];
    const changes = classifyLineChanges(previous, current);

    expect(changes.size).toBe(3);
    expect(changes.get(0)).toBe("modified");
    expect(changes.get(2)).toBe("added");
    expect(changes.get(4)).toBe("modified");
    expect(changes.has(1)).toBe(false);
    expect(changes.has(3)).toBe(false);
  });
});
