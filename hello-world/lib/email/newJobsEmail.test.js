import { describe, it, expect } from "vitest";
import {
  selectEmailableJobs,
  buildNewJobsEmail,
} from "./newJobsEmail.js";
// N60 S2 (owner ruling 4): `groupJobsByRecipient` is deleted and replaced by the
// account-email-only `groupJobsForAccount`. Imported via the module namespace so
// that on HEAD (where the new export does not exist yet) only the grouping tests
// go red -- the selectEmailableJobs / buildNewJobsEmail tests below, which this
// change does not touch, must stay green on HEAD.
import * as newJobsEmail from "./newJobsEmail.js";

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

// Owner ruling 4: the four override tests are re-authored to the account-email-only
// contract (there is no recipient override any more); the fifth, "returns an empty
// map for non-array input", keeps its substance -- only the function identifier
// changes, because the ruling-authorised rename deleted the old name.
describe("groupJobsForAccount", () => {
  const { groupJobsForAccount } = newJobsEmail;

  it("routes all emailable jobs to the account address, ignoring any stored override", () => {
    // A per-search override must NOT be honoured: it is exactly the unconfirmed
    // third-party recipient this chunk removes. If it were honoured the key would
    // be "override@x.com".
    const groups = groupJobsForAccount(
      [job({ notifyEmail: "override@x.com" })],
      "account@x.com",
    );
    expect([...groups.keys()]).toEqual(["account@x.com"]);
  });
  it("groups jobs under the account email", () => {
    const groups = groupJobsForAccount([job()], "account@x.com");
    expect(groups.get("account@x.com")).toHaveLength(1);
  });
  it("trims the account address and groups multiple jobs together", () => {
    const groups = groupJobsForAccount(
      [job(), job({ title: "B" })],
      " account@x.com ",
    );
    expect(groups.get("account@x.com")).toHaveLength(2);
  });
  it("drops jobs when there is no account recipient", () => {
    const groups = groupJobsForAccount([job()], null);
    expect(groups.size).toBe(0);
  });
  it("returns an empty map for non-array input", () => {
    expect(groupJobsForAccount(undefined, "a@x.com").size).toBe(0);
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
