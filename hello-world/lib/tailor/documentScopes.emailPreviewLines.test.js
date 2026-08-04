import { describe, it, expect } from "vitest";
import { emailPreviewLines, emailPreviewText } from "./documentScopes.js";

// emailPreviewLines/emailPreviewText are the single source shared by the
// preview renderer and the copy-to-clipboard control, so what's shown and
// what's copied can never drift. Every case below asserts both functions
// agree, since that drift is the specific failure this file guards against.
function expectInSync(entry) {
  expect(emailPreviewText(entry)).toBe(emailPreviewLines(entry).join("\n"));
}

describe("emailPreviewLines", () => {
  it("with a subject and body, returns the subject line, a blank separator, then the body in order", () => {
    const entry = { emailSubject: "Following up on the Backend Engineer role", emailResultLines: ["Hi there,", "", "Thanks,", "Alex"] };
    const lines = emailPreviewLines(entry);
    expect(lines).toEqual([
      "Subject: Following up on the Backend Engineer role",
      "",
      "Hi there,",
      "",
      "Thanks,",
      "Alex",
    ]);
    // The separator is explicitly a lone blank string at index 1, not folded
    // into the subject or the first body line.
    expect(lines[1]).toBe("");
    expectInSync(entry);
  });

  it("with no subject (missing), returns the body alone with no Subject: line", () => {
    const entry = { emailResultLines: ["Hi there,", "Thanks,", "Alex"] };
    expect(emailPreviewLines(entry)).toEqual(["Hi there,", "Thanks,", "Alex"]);
    expectInSync(entry);
  });

  it("with no subject (empty string), returns the body alone with no Subject: line", () => {
    const entry = { emailSubject: "", emailResultLines: ["Hi there,", "Thanks,", "Alex"] };
    expect(emailPreviewLines(entry)).toEqual(["Hi there,", "Thanks,", "Alex"]);
    expectInSync(entry);
  });

  it("with no subject (whitespace-only), returns the body alone with no Subject: line", () => {
    const entry = { emailSubject: "   ", emailResultLines: ["Hi there,", "Thanks,", "Alex"] };
    expect(emailPreviewLines(entry)).toEqual(["Hi there,", "Thanks,", "Alex"]);
    expectInSync(entry);
  });

  it("trims surrounding whitespace off a present subject", () => {
    const entry = { emailSubject: "  Re: Backend role  ", emailResultLines: ["Hi there,"] };
    const lines = emailPreviewLines(entry);
    expect(lines[0]).toBe("Subject: Re: Backend role");
    expectInSync(entry);
  });

  it("returns an empty array and does not throw for a missing entry", () => {
    expect(() => emailPreviewLines(undefined)).not.toThrow();
    expect(emailPreviewLines(undefined)).toEqual([]);
    expectInSync(undefined);
  });

  it("returns an empty array and does not throw for a null entry", () => {
    expect(() => emailPreviewLines(null)).not.toThrow();
    expect(emailPreviewLines(null)).toEqual([]);
    expectInSync(null);
  });

  it("treats a non-array emailResultLines as an empty body rather than throwing (undefined)", () => {
    const entry = { emailResultLines: undefined };
    expect(() => emailPreviewLines(entry)).not.toThrow();
    expect(emailPreviewLines(entry)).toEqual([]);
    expectInSync(entry);
  });

  it("treats a non-array emailResultLines as an empty body rather than throwing (null)", () => {
    const entry = { emailResultLines: null };
    expect(() => emailPreviewLines(entry)).not.toThrow();
    expect(emailPreviewLines(entry)).toEqual([]);
    expectInSync(entry);
  });

  it("treats a non-array emailResultLines as an empty body rather than throwing (a string)", () => {
    const entry = { emailResultLines: "Hi there,\nThanks,\nAlex" };
    expect(() => emailPreviewLines(entry)).not.toThrow();
    expect(emailPreviewLines(entry)).toEqual([]);
    expectInSync(entry);
  });

  it("with a subject but a non-array body, the subject line and separator still appear", () => {
    const entry = { emailSubject: "Hello", emailResultLines: "not an array" };
    expect(emailPreviewLines(entry)).toEqual(["Subject: Hello", ""]);
    expectInSync(entry);
  });

  it("returns a copy: mutating the result does not affect entry.emailResultLines", () => {
    const original = ["Hi there,", "Thanks,", "Alex"];
    const entry = { emailResultLines: original };
    const lines = emailPreviewLines(entry);
    expect(lines).not.toBe(original);
    lines.push("tampered");
    lines[0] = "tampered";
    expect(entry.emailResultLines).toEqual(["Hi there,", "Thanks,", "Alex"]);
  });

  it("returns a copy even when a subject is present (spread body is fresh, not aliased)", () => {
    const original = ["Hi there,", "Thanks,", "Alex"];
    const entry = { emailSubject: "Re: role", emailResultLines: original };
    const lines = emailPreviewLines(entry);
    expect(lines).not.toBe(original);
    lines.push("tampered");
    expect(entry.emailResultLines).toEqual(["Hi there,", "Thanks,", "Alex"]);
  });
});

describe("emailPreviewText", () => {
  it("joins subject + blank + body lines with newlines", () => {
    const entry = { emailSubject: "Re: role", emailResultLines: ["Hi there,", "Thanks,", "Alex"] };
    expect(emailPreviewText(entry)).toBe("Subject: Re: role\n\nHi there,\nThanks,\nAlex");
    expectInSync(entry);
  });

  it("joins the body alone with newlines when there is no subject", () => {
    const entry = { emailResultLines: ["Hi there,", "Thanks,", "Alex"] };
    expect(emailPreviewText(entry)).toBe("Hi there,\nThanks,\nAlex");
    expectInSync(entry);
  });

  it("returns an empty string for a missing entry", () => {
    expect(emailPreviewText(undefined)).toBe("");
    expectInSync(undefined);
  });
});
