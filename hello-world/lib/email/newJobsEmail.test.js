import { describe, it, expect } from "vitest";
import {
  selectEmailableJobs,
  groupJobsByRecipient,
  buildNewJobsEmail,
} from "./newJobsEmail.js";

function job(overrides = {}) {
  return {
    title: "Senior Software Engineer",
    company: "Acme Corp",
    url: "https://example.com/job/1",
    savedSearchName: "Backend roles",
    emailOnNewJobs: true,
    notifyEmail: null,
    ...overrides,
  };
}

describe("selectEmailableJobs", () => {
  it("keeps only jobs whose search opted into email", () => {
    const jobs = [job(), job({ emailOnNewJobs: false }), job({ title: "B" })];
    expect(selectEmailableJobs(jobs)).toHaveLength(2);
  });
  it("returns [] for non-arrays", () => {
    expect(selectEmailableJobs(undefined)).toEqual([]);
    expect(selectEmailableJobs(null)).toEqual([]);
  });
  it("ignores null/undefined entries", () => {
    expect(selectEmailableJobs([null, undefined, job()])).toHaveLength(1);
  });
});

describe("groupJobsByRecipient", () => {
  it("routes jobs with an override to that address", () => {
    const groups = groupJobsByRecipient(
      [job({ notifyEmail: "override@x.com" })],
      "account@x.com",
    );
    expect([...groups.keys()]).toEqual(["override@x.com"]);
  });
  it("falls back to the account email when no override", () => {
    const groups = groupJobsByRecipient([job()], "account@x.com");
    expect(groups.get("account@x.com")).toHaveLength(1);
  });
  it("trims override whitespace and groups multiple jobs together", () => {
    const groups = groupJobsByRecipient(
      [job({ notifyEmail: " me@x.com " }), job({ title: "B", notifyEmail: "me@x.com" })],
      "account@x.com",
    );
    expect(groups.get("me@x.com")).toHaveLength(2);
  });
  it("drops jobs with no resolvable recipient", () => {
    const groups = groupJobsByRecipient([job()], null);
    expect(groups.size).toBe(0);
  });
  it("returns an empty map for non-array input", () => {
    expect(groupJobsByRecipient(undefined, "a@x.com").size).toBe(0);
  });
});

describe("buildNewJobsEmail", () => {
  it("uses a singular subject for one job", () => {
    const { subject } = buildNewJobsEmail([job()]);
    expect(subject).toBe("New job match: Senior Software Engineer — Acme Corp");
  });
  it("uses a count subject for multiple jobs", () => {
    const { subject } = buildNewJobsEmail([job(), job({ title: "B" })]);
    expect(subject).toBe("2 new job matches from your saved searches");
  });
  it("includes title, company, and link in html and text", () => {
    const { html, text } = buildNewJobsEmail([job()]);
    expect(html).toContain("Senior Software Engineer");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("https://example.com/job/1");
    expect(text).toContain("• Senior Software Engineer — Acme Corp");
    expect(text).toContain("https://example.com/job/1");
  });
  it("escapes HTML in untrusted fields", () => {
    const { html } = buildNewJobsEmail([
      job({ title: "<script>alert(1)</script>", company: "A&B" }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B");
  });
  it("handles a missing url gracefully", () => {
    const { html, text } = buildNewJobsEmail([job({ url: null })]);
    expect(html).not.toContain("view posting");
    expect(text).not.toContain("https://");
  });
});
