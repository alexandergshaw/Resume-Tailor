// N60 S5 (4b/TDD) -- AC-E3: the email body must CONTAIN A REACHABLE LINK, not
// prose. At HEAD newJobsEmail.js prints "You're receiving this because email
// alerts are on for a saved search in Resume Tailor." as plain prose with NO
// link (:88, :99) -- the repo's own recorded trap ("a remedy named without being
// reachable"), live in outbound mail.
//
// The guard is over the CLASS -- reachability, not the presence of a word: given
// an unsubscribe URL, BOTH the HTML and the text bodies must carry it as an
// actual link (an <a href> in HTML, the absolute URL in text), and the link must
// be DERIVED from the argument (not a hardcoded string).
//
// This is a SEPARATE file from newJobsEmail.test.js so the S2-authored (owner-
// ruling) grouping/build tests there are untouched. buildNewJobsEmail keeps its
// existing one-argument behaviour (those tests stay green); the second argument
// is additive.
//
// RED on HEAD: buildNewJobsEmail ignores a second argument today, so neither body
// contains the URL.
//
// NON-VACUITY: two different URLs are asserted to appear (and the other's not
// to), which fails a build that hardcodes any single link; and a control asserts
// the one-arg call still builds a body (backward compatibility with the protected
// tests).

import { describe, it, expect } from "vitest";
import { buildNewJobsEmail } from "./newJobsEmail.js";

function job(overrides = {}) {
  return {
    title: "Senior Software Engineer",
    company: "Acme Corp",
    url: "https://example.com/job/1",
    savedSearchName: "Backend roles",
    ...overrides,
  };
}

const UNSUB = "https://app.example.com/api/alerts/unsubscribe?token=abc123";

describe("buildNewJobsEmail embeds a reachable unsubscribe link (AC-E3)", () => {
  it("puts the unsubscribe URL in the HTML as an actual anchor to the unsubscribe route", () => {
    const { html } = buildNewJobsEmail([job()], { unsubscribeUrl: UNSUB });
    // Reachability, not a word: a real href pointing at the unsubscribe route.
    expect(html).toMatch(/href="[^"]*\/api\/alerts\/unsubscribe\?token=/);
    expect(html).toContain(UNSUB);
  });

  it("puts the unsubscribe URL in the plain-text body too", () => {
    const { text } = buildNewJobsEmail([job()], { unsubscribeUrl: UNSUB });
    expect(text).toContain(UNSUB);
  });

  it("derives the link from the argument (a different URL appears; the first does not)", () => {
    const other = "https://app.example.com/api/alerts/unsubscribe?token=zzz999";
    const { html, text } = buildNewJobsEmail([job()], { unsubscribeUrl: other });
    expect(html).toContain(other);
    expect(text).toContain(other);
    expect(html).not.toContain("token=abc123");
    expect(text).not.toContain("token=abc123");
  });

  it("[control] still builds a usable body when called with one argument (backward compatible)", () => {
    // Non-vacuity + protects the S2 one-arg tests: the additive second arg must
    // not break the existing single-argument contract.
    const { subject, html, text } = buildNewJobsEmail([job()]);
    expect(subject).toContain("Senior Software Engineer");
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });
});
