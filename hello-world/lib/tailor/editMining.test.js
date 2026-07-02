import { describe, it, expect } from "vitest";
import { addedEditText, editFingerprint } from "./editMining.js";

const GENERATED = [
  "Alex Shaw",
  "Senior Software Engineer",
  "- Built a React component library.",
  "- Led a cross-functional team of 5.",
];

describe("addedEditText", () => {
  it("returns only the lines the user added", () => {
    const edited = [
      ...GENERATED,
      "- Deployed workloads to Kubernetes with Terraform-managed infrastructure.",
    ];
    const out = addedEditText(GENERATED, edited);
    expect(out).toBe("- Deployed workloads to Kubernetes with Terraform-managed infrastructure.");
  });

  it("treats a modified line as added (its new vocabulary matters)", () => {
    const edited = [...GENERATED];
    edited[2] = "- Built a React component library used across 12 product teams.";
    const out = addedEditText(GENERATED, edited);
    expect(out).toContain("12 product teams");
    expect(out).not.toContain("cross-functional team of 5");
  });

  it("normalizes bullets/whitespace/case so cosmetic changes don't count", () => {
    const edited = ["ALEX  SHAW", "• Built a React component library.", "Senior Software Engineer", "- Led a cross-functional team of 5."];
    expect(addedEditText(GENERATED, edited)).toBe("");
  });

  it("ignores deletions and tiny fragments", () => {
    expect(addedEditText(GENERATED, GENERATED.slice(0, 2))).toBe("");
    expect(addedEditText(GENERATED, [...GENERATED, "ok"])).toBe("");
  });

  it("handles empty/missing inputs", () => {
    expect(addedEditText([], [])).toBe("");
    expect(addedEditText(undefined, undefined)).toBe("");
  });
});

describe("editFingerprint", () => {
  it("is stable for the same text and differs across texts", () => {
    expect(editFingerprint("abc")).toBe(editFingerprint("abc"));
    expect(editFingerprint("abc")).not.toBe(editFingerprint("abd"));
    expect(editFingerprint("")).toBe(editFingerprint(""));
  });
});
