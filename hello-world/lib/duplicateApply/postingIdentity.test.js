import { describe, it, expect } from "vitest";
import {
  postingUrlKey,
  externalIdKey,
  postingKeyOfPosition,
  canonicalPositionKey,
  samePostingRows,
  matchesCandidate,
  C_3D_MAX_FALSE_ADMITS_PER_POSTING,
} from "@/lib/duplicateApply/postingIdentity";

// Answers "are these two job postings the same posting?" from a URL,
// conservatively. AC-duplicate-apply-r4.md C-1 .. C-4a, and 3-plan-dupapply.md
// §2.1 / §3.1. Standing bias: a false alarm is the expensive failure -- every
// rule here errs toward MISSING a duplicate rather than inventing one, and
// every accepted miss below is pinned so nobody widens the rule by accident.
//
// This module does NOT import canonicalPostingUrl from lib/feed/canonicalUrl.js
// (plan §8 C-6 / AC R4-17): composing on top of that function's OUTPUT STRING
// means re-parsing it, and the round trip is lossy on 3 of 6 rows with query
// params [qf-urlroundtrip.mjs]. Every function below does its own SINGLE fresh
// `new URL(raw)` parse of the original input.

describe("C_3D_MAX_FALSE_ADMITS_PER_POSTING", () => {
  it("is the adopted exchange-rate constant, 0.25 -- do not re-derive it here", () => {
    expect(C_3D_MAX_FALSE_ADMITS_PER_POSTING).toBe(0.25);
  });
});

describe("postingUrlKey -- step 1, the fragment guard (runs FIRST, on the raw input)", () => {
  it("a bare trailing # is not a fragment -- hash is '' and the URL proceeds normally", () => {
    // A 6+ digit run delimited by '/' and end-of-string still admits.
    expect(postingUrlKey("https://acme.com/jobs/123456#")).toBe("u:https://acme.com/jobs/123456");
  });

  it("[pin] any NON-EMPTY fragment refuses the WHOLE url, even when the path independently carries evidence", () => {
    // On a fragment-addressed board the fragment IS the posting id; discarding
    // it and keying on what remains would claim identity from a string that
    // no longer contains it. So the whole URL is refused, not just the hash.
    expect(postingUrlKey("https://acme.com/jobs/123456#apply")).toBeNull();
    expect(postingUrlKey("https://acme.com/careers#jobId=123456")).toBeNull();
    expect(postingUrlKey("https://acme.com/careers#/job/123456")).toBeNull();
  });
});

describe("postingUrlKey -- step 2, the scheme gate", () => {
  it("admits only http: and https:", () => {
    expect(postingUrlKey("ftp://acme.com/jobs/123456")).toBeNull();
    expect(postingUrlKey("mailto:jobs@acme.com")).toBeNull();
    expect(postingUrlKey("javascript:alert(document.cookie)")).toBeNull();
  });

  it("returns null rather than throwing on unparseable input", () => {
    expect(postingUrlKey("not a url")).toBeNull();
    expect(postingUrlKey("")).toBeNull();
    expect(postingUrlKey(null)).toBeNull();
    expect(postingUrlKey(undefined)).toBeNull();
    expect(postingUrlKey(12345)).toBeNull();
  });
});

describe("postingUrlKey -- step 3, host", () => {
  it("lowercases the host and strips a leading www.", () => {
    expect(postingUrlKey("HTTPS://WWW.Acme.com/jobs/123456")).toBe(
      "u:https://acme.com/jobs/123456",
    );
  });

  it("folds the scheme to https: UNCONDITIONALLY, even for an http: input", () => {
    // canonicalPostingUrl keeps parsed.protocol, so http/https fork there.
    // This module deliberately does not: two spellings of one posting must
    // not be allowed to fork on scheme alone.
    expect(postingUrlKey("http://acme.com/jobs/123456")).toBe("u:https://acme.com/jobs/123456");
  });

  it("[pin] the port is dropped, so two ports on one host are one key -- inherited, accepted merge", () => {
    expect(postingUrlKey("https://acme.com:8443/jobs/123456")).toBe(
      postingUrlKey("https://acme.com/jobs/123456"),
    );
  });

  it("[pin] two DIFFERENT hosts serving what a human would call the same posting do NOT match -- accepted miss, do not widen", () => {
    // A Greenhouse-embedded careers page and the vendor's own boards.greenhouse.io
    // mirror can carry the same posting id under two different hostnames.
    // This module has no cross-host alias table and must not grow one.
    const embedded = postingUrlKey("https://acme.com/careers?gh_jid=99");
    const vendor = postingUrlKey("https://boards.greenhouse.io/acme/jobs/123456");
    expect(embedded).not.toBeNull();
    expect(vendor).not.toBeNull();
    expect(embedded).not.toBe(vendor);
  });
});

describe("postingUrlKey -- step 4, path", () => {
  it("strips a trailing slash when the path is longer than '/'", () => {
    expect(postingUrlKey("https://acme.com/jobs/123456/")).toBe(
      "u:https://acme.com/jobs/123456",
    );
  });

  it("does not strip the bare root path", () => {
    // No evidence on the root path either way, but this must not throw or
    // strip down to an empty string.
    expect(postingUrlKey("https://acme.com/")).toBeNull();
  });

  it("[pin] path case is significant -- do not lowercase the path", () => {
    const upper = postingUrlKey("https://acme.com/Jobs/123456");
    const lower = postingUrlKey("https://acme.com/jobs/123456");
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upper).not.toBe(lower);
  });
});

describe("postingUrlKey -- step 5, tracking-param removal (case-insensitive)", () => {
  it("strips utm_* and the inherited TRACKING_PARAM_NAMES set", () => {
    const withTracking = postingUrlKey(
      "https://acme.com/jobs/123456?utm_source=x&UTM_Medium=y&ref=linkedin&gh_src=abc&gclid=1&fbclid=2&mc_cid=3&mc_eid=4&igshid=5&source=indeed",
    );
    expect(withTracking).toBe("u:https://acme.com/jobs/123456");
  });

  it("strips the seven additional named tokens, case-insensitively", () => {
    const withTracking = postingUrlKey(
      "https://acme.com/jobs/123456?TrId=1&refId=2&trackingId=3&EBURL=4&lipi=5&originalToken=6&savedSearchId=7",
    );
    expect(withTracking).toBe("u:https://acme.com/jobs/123456");
  });

  it("a URL whose ONLY evidence is a tracking param yields no key -- stripping happens before admission", () => {
    expect(postingUrlKey("https://acme.com/careers?utm_source=newsletter")).toBeNull();
  });
});

describe("postingUrlKey -- E1, the digit-run admission rule", () => {
  it("admits a >=6-digit run delimited on both sides", () => {
    expect(postingUrlKey("https://acme.com/jobs/123456")).not.toBeNull();
    expect(postingUrlKey("https://acme.com/jobs/1234567890")).not.toBeNull();
  });

  it("[pin] the threshold is 6, not 5 -- 5 digits is the US ZIP band", () => {
    expect(postingUrlKey("https://acme.com/careers/City-State-12345")).toBeNull();
    expect(postingUrlKey("https://acme.com/careers/City-State-123456")).not.toBeNull();
  });

  it("[pin] the run must be DELIMITED on both sides, not merely contained", () => {
    // A 6+ digit run welded to letters (e.g. inside a UUID's hex, or an
    // alphanumeric slug) is not admitted -- undelimited E1 would silently
    // re-implement the rejected E2-anywhere rule.
    expect(postingUrlKey("https://acme.com/jobs/abc123456def")).toBeNull();
    expect(postingUrlKey("https://acme.com/jobs/ef0123456789-abcd-abcd-abcd-abcdabcdabcd")).toBeNull();
  });

  it("REJECTED constant: the mixed-alphanumeric token rule is not implemented", () => {
    // >=8 chars containing a letter and a digit, with no delimited digit run
    // and no UUID/id-param evidence, must not admit (round three's own
    // candidate rule; rejected at a 0.50 exchange rate, C-3c).
    expect(postingUrlKey("https://acme.com/careers/ab12cd34")).toBeNull();
  });
});

describe("postingUrlKey -- E2, UUID as the LAST path segment only", () => {
  it("admits when the last segment is a UUID", () => {
    expect(
      postingUrlKey("https://boards.acme.com/postings/a1b2c3d4-1234-5678-9abc-1234567890ab"),
    ).not.toBeNull();
  });

  it("[pin] a UUID that is NOT the last segment is not evidence -- E2-anywhere was rejected (0.43 vs 0.20)", () => {
    expect(
      postingUrlKey("https://boards.acme.com/a1b2c3d4-1234-5678-9abc-1234567890ab/apply"),
    ).toBeNull();
  });

  it("is case-insensitive on the hex digits", () => {
    expect(
      postingUrlKey("https://boards.acme.com/postings/A1B2C3D4-1234-5678-9ABC-1234567890AB"),
    ).not.toBeNull();
  });
});

describe("postingUrlKey -- E3, the id-param rule (shape + two anchored names + value guard)", () => {
  it("admits the two anchored names, case-insensitively", () => {
    expect(postingUrlKey("https://www.indeed.com/viewjob?jk=abcdef1234")).not.toBeNull();
    expect(postingUrlKey("https://acme.com/careers?gh_jid=99")).not.toBeNull();
  });

  it('"?JK= and ?jk= are the same param" -- both are recognized as the anchored id-shaped param', () => {
    const upper = postingUrlKey("https://www.indeed.com/viewjob?JK=abcdef1234");
    const lower = postingUrlKey("https://www.indeed.com/viewjob?jk=abcdef1234");
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
  });

  it('"career_job_req_id keys a SuccessFactors posting" -- the three-part shape rule', () => {
    expect(postingUrlKey("https://acme.successfactors.com/career?career_job_req_id=884321")).not.toBeNull();
  });

  it("admits an id-shaped param even on what looks like a listing page (LinkedIn pane worked example)", () => {
    // A per-posting param IS a discriminator: admitting it forks keys rather
    // than merging them, so it can only ever miss, never false-merge.
    expect(
      postingUrlKey("https://www.linkedin.com/jobs/search?currentJobId=4012345&keywords=engineer"),
    ).not.toBeNull();
  });

  it('[pin] "jobType and jobCategory are not posting-id params" -- the veto list', () => {
    expect(postingUrlKey("https://acme.com/careers?jobType=fulltime")).toBeNull();
    expect(postingUrlKey("https://acme.com/careers?jobCategory=engineering")).toBeNull();
    expect(postingUrlKey("https://acme.com/careers?searchJobId=fulltime")).toBeNull();
    expect(postingUrlKey("https://acme.com/careers?jobTitle=engineer")).toBeNull();
  });

  it("the value guard rejects a value shorter than 3 characters", () => {
    expect(postingUrlKey("https://acme.com/careers?jobId=ab")).toBeNull();
    expect(postingUrlKey("https://acme.com/careers?jobId=abc")).not.toBeNull();
  });

  it("an anchored name with an empty value is not evidence", () => {
    expect(postingUrlKey("https://www.indeed.com/viewjob?jk=")).toBeNull();
  });

  it("E3 has zero measured false admits on the union corpus -- LinkedIn pane example does not false-merge two postings", () => {
    const paneA = postingUrlKey(
      "https://www.linkedin.com/jobs/search?currentJobId=4012345&keywords=engineer",
    );
    const paneB = postingUrlKey(
      "https://www.linkedin.com/jobs/search?currentJobId=5098765&keywords=engineer",
    );
    expect(paneA).not.toBe(paneB);
  });
});

describe("postingUrlKey -- C-3b, the three residual false admits (pinned, must remain admitting -- NOT adopted for narrowing, Q18)", () => {
  it("[pin] a listing URL whose only long number is a team or location id is a known false admit -- the evidence list must render the URL", () => {
    expect(postingUrlKey("https://boards.acme.com/team/12345678/openings")).not.toBeNull();
  });

  it("[pin] a hyphen-delimited phone number in the path is a known false admit", () => {
    expect(postingUrlKey("https://acme.com/careers/contact/1-800-5551234")).not.toBeNull();
  });

  it("[pin] an UltiPro board root whose trailing slash promotes the board UUID to the last segment is a known false admit", () => {
    expect(
      postingUrlKey(
        "https://recruiting2.ultipro.com/ACM1000/JobBoard/a1b2c3d4-1234-5678-9abc-1234567890ab/?q=&o=postedDateDesc",
      ),
    ).not.toBeNull();
  });
});

describe("postingUrlKey -- accepted misses (pinned)", () => {
  it("[pin] a slug-only posting URL with no id token yields no key -- accepted miss", () => {
    expect(postingUrlKey("https://acme.com/careers/senior-software-engineer")).toBeNull();
  });

  it("[pin] a URL with no posting-id evidence yields indeterminate territory (null), never a fabricated key", () => {
    expect(postingUrlKey("https://acme.com/careers")).toBeNull();
  });
});

describe("postingUrlKey -- F2 regression: no round trip through another function's output", () => {
  // qf-urlroundtrip.mjs found canonicalPostingUrl's OUTPUT STRING lossy on
  // re-parse for 3 of 6 query-param rows. This module parses the RAW input
  // once and re-encodes on rebuild, so these three shapes must not collapse.
  it("a %23 in a param value does not grow a fragment or drop a sibling param", () => {
    const a = postingUrlKey("https://acme.com/jobs/4012345?job_id=a%23zzz&x=1");
    const b = postingUrlKey("https://acme.com/jobs/4012345?job_id=a%23yyy&x=1");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    // Both the encoded '#' and the sibling param must survive rebuild.
    expect(a).toContain("x=1");
    expect(a).toMatch(/job_id=a%23zzz/i);
  });

  it("a %26 in a param value is not split into two params", () => {
    const key = postingUrlKey("https://acme.com/jobs/4012345?job_id=a%26b");
    expect(key).not.toBeNull();
    // Must remain ONE param, re-encoded -- not "job_id=a&b=".
    expect(key).toContain("job_id=a%26b");
    expect(key).not.toContain("&b=");
  });

  it("a %2B in a param value round-trips as a literal plus, not a space", () => {
    const key = postingUrlKey("https://acme.com/jobs/4012345?job_id=a%2Bb");
    expect(key).not.toBeNull();
    expect(key).toContain("job_id=a%2Bb");
  });
});

describe("postingUrlKey -- query rebuild", () => {
  it("sorts surviving params by name so order cannot fork the key", () => {
    const a = postingUrlKey("https://acme.com/jobs/123456?b=2&jobId=abc");
    const b = postingUrlKey("https://acme.com/jobs/123456?jobId=abc&b=2");
    expect(a).toBe(b);
  });
});

describe("externalIdKey -- C-2, the degenerate literals", () => {
  it("[pin] the literal strings 'undefined', 'null' and 'NaN' never become a posting key", () => {
    expect(externalIdKey("undefined")).toBeNull();
    expect(externalIdKey("null")).toBeNull();
    expect(externalIdKey("NaN")).toBeNull();
    expect(externalIdKey(undefined)).toBeNull();
    expect(externalIdKey(null)).toBeNull();
    expect(externalIdKey(NaN)).toBeNull();
  });

  it("returns null for an empty or whitespace-only value", () => {
    expect(externalIdKey("")).toBeNull();
    expect(externalIdKey("   ")).toBeNull();
  });

  it("trims before comparing, and namespaces a valid id", () => {
    expect(externalIdKey("  gh-12345  ")).toBe("x:gh-12345");
  });
});

describe("externalIdKey -- C-2a, the ephemeral shot-/manual- namespaces, CASE-INSENSITIVE", () => {
  it("[pin] a shot- external id is not an identity key, in any letter case", () => {
    expect(externalIdKey("shot-1699999999-0-123")).toBeNull();
    expect(externalIdKey("SHOT-1")).toBeNull();
    expect(externalIdKey("Shot-abc")).toBeNull();
  });

  it("a manual- external id is not an identity key, in any letter case", () => {
    expect(externalIdKey("manual-abc123")).toBeNull();
    expect(externalIdKey("Manual-abc")).toBeNull();
    expect(externalIdKey("MANUAL-999")).toBeNull();
  });

  it("trim runs before the ephemeral check", () => {
    expect(externalIdKey(" shot-1 ")).toBeNull();
  });

  it("a stable, non-ephemeral mint IS an identity key", () => {
    expect(externalIdKey("gh-99")).toBe("x:gh-99");
    expect(externalIdKey("url-https://acme.com/jobs/1")).toBe("x:url-https://acme.com/jobs/1");
    expect(externalIdKey("feed-42")).toBe("x:feed-42");
  });
});

describe("both namespaces are present and distinct", () => {
  it("postingUrlKey always returns a 'u:'-prefixed key or null", () => {
    const key = postingUrlKey("https://acme.com/jobs/123456");
    expect(key.startsWith("u:")).toBe(true);
  });

  it("externalIdKey always returns an 'x:'-prefixed key or null", () => {
    const key = externalIdKey("gh-99");
    expect(key.startsWith("x:")).toBe(true);
  });

  it("[pin] a row with both a URL and an external id keys on the URL, and the key is namespaced -- C-1b", () => {
    const key = postingKeyOfPosition({
      url: "https://acme.com/jobs/123456",
      external_id: "gh-99",
    });
    expect(key).toBe("u:https://acme.com/jobs/123456");
  });

  it("[pin] the two namespaces cannot cross-match on a coincidence -- an external id that IS a URL string stays in the x: namespace", () => {
    // C-1b: "url-https://…" literally contains a URL; without namespacing
    // the two key spaces could cross-match on a coincidence nobody reasoned
    // about.
    const urlKeyed = postingKeyOfPosition({ url: "https://acme.com/jobs/4012345" });
    const externalIdKeyed = postingKeyOfPosition({
      url: null,
      external_id: "https://acme.com/jobs/4012345",
    });
    expect(urlKeyed).toBe("u:https://acme.com/jobs/4012345");
    expect(externalIdKeyed).toBe("x:https://acme.com/jobs/4012345");
    expect(urlKeyed).not.toBe(externalIdKeyed);
  });
});

describe("postingKeyOfPosition -- priority and absence", () => {
  it("URL wins over external id when both are present and admit", () => {
    const key = postingKeyOfPosition({
      url: "https://acme.com/jobs/123456",
      external_id: "gh-different-99",
    });
    expect(key).toBe("u:https://acme.com/jobs/123456");
  });

  it("falls back to the external id when the URL carries no evidence", () => {
    const key = postingKeyOfPosition({
      url: "https://acme.com/careers/senior-engineer",
      external_id: "gh-99",
    });
    expect(key).toBe("x:gh-99");
  });

  it("returns null when neither is present or neither admits", () => {
    expect(postingKeyOfPosition({})).toBeNull();
    expect(postingKeyOfPosition({ url: null, external_id: null })).toBeNull();
    expect(postingKeyOfPosition(null)).toBeNull();
    expect(postingKeyOfPosition(undefined)).toBeNull();
  });

  it('[pin] "a manually added application with an application URL is still reachable by Signal 1; without one it is not"', () => {
    const withUrl = postingKeyOfPosition({
      url: "https://acme.com/jobs/123456",
      external_id: "manual-abc123",
    });
    expect(withUrl).toBe("u:https://acme.com/jobs/123456");

    const withoutUrl = postingKeyOfPosition({ url: null, external_id: "manual-abc123" });
    expect(withoutUrl).toBeNull();
  });

  it('[pin] "a screenshot run with url:\'\' yields no key" -- an ephemeral external id plus an empty URL is invisible to Signal 1', () => {
    const key = postingKeyOfPosition({ url: "", external_id: "shot-1699999999-0-123" });
    expect(key).toBeNull();
  });
});

describe("canonicalPositionKey -- C-1c, the embed may be absent and must never throw", () => {
  it("[pin] a row whose positions embed is null yields a null canonical key and is silently excluded, never a throw", () => {
    expect(() => canonicalPositionKey({ id: "A13", positions: null })).not.toThrow();
    expect(canonicalPositionKey({ id: "A13", positions: null })).toBeNull();
  });

  it("does not throw when positions is undefined or the row itself is null/undefined", () => {
    expect(() => canonicalPositionKey({ id: "A13" })).not.toThrow();
    expect(canonicalPositionKey({ id: "A13" })).toBeNull();
    expect(() => canonicalPositionKey(null)).not.toThrow();
    expect(canonicalPositionKey(null)).toBeNull();
    expect(() => canonicalPositionKey(undefined)).not.toThrow();
    expect(canonicalPositionKey(undefined)).toBeNull();
  });

  it("prefers the posting key (url/external id) over the pos: id fallback", () => {
    const key = canonicalPositionKey({
      id: "app-1",
      positions: { id: "P9", url: "https://acme.com/jobs/123456" },
    });
    expect(key).toBe("u:https://acme.com/jobs/123456");
  });

  it("falls back to pos:<positions.id> only when the posting itself carries no key", () => {
    const key = canonicalPositionKey({
      id: "app-1",
      positions: { id: "P9", url: "https://acme.com/careers/no-id-here" },
    });
    expect(key).toBe("pos:P9");
  });

  it("returns null when there is no embed AND no positions.id", () => {
    expect(canonicalPositionKey({ id: "app-1", positions: {} })).toBeNull();
  });

  it("[pin] the C-16b adversarial row: positions.id is the literal string of a URL -- namespaced, does not collide with a real URL key", () => {
    const adversarial = canonicalPositionKey({
      id: "app-adv",
      positions: { id: "https://acme.com/jobs/4012345", url: null, external_id: null },
    });
    expect(adversarial).toBe("pos:https://acme.com/jobs/4012345");

    const genuine = canonicalPositionKey({
      id: "app-real",
      positions: { id: "P-real", url: "https://acme.com/jobs/4012345" },
    });
    expect(genuine).toBe("u:https://acme.com/jobs/4012345");

    // If the "pos:" prefix were ever dropped, these two would collide.
    expect(adversarial).not.toBe(genuine);
  });
});

describe("samePostingRows / matchesCandidate", () => {
  it("two rows sharing one posting URL count as one (the exact case round three's naming bug broke)", () => {
    const a = { positions: { id: "P1", url: "https://acme.com/jobs/123456" } };
    const b = { positions: { id: "P2", url: "https://acme.com/jobs/123456/" } };
    expect(samePostingRows(a, b)).toBe(true);
  });

  it("[pin] a row matching only on external id does NOT match a candidate that has a URL -- accepted miss, do not restore set intersection (C-1d)", () => {
    const row = { positions: { id: "P1", url: null, external_id: "gh-99" } };
    const candidate = { url: "https://acme.com/jobs/123456", external_id: "gh-99" };
    // The candidate's URL wins (C-1), so its key is the URL key, which the
    // row (no URL) cannot match -- even though both share the same external id.
    expect(matchesCandidate(row, candidate)).toBe(false);
  });

  it("returns false, never throws, when either side's key is null (irreflexivity of the null key)", () => {
    const noEvidence = { positions: {} };
    expect(samePostingRows(noEvidence, noEvidence)).toBe(false);
    expect(() => samePostingRows(noEvidence, noEvidence)).not.toThrow();
  });

  it("[pin] never matches on title+company, even when both are byte-identical", () => {
    const a = {
      positions: {
        id: "P1",
        title: "Software Engineer",
        company: "Acme",
        url: "https://acme.com/jobs/111111",
      },
    };
    const b = {
      positions: {
        id: "P2",
        title: "Software Engineer",
        company: "Acme",
        url: "https://acme.com/jobs/222222",
      },
    };
    expect(samePostingRows(a, b)).toBe(false);

    const candidateSameTitleCompany = {
      title: "Software Engineer",
      company: "Acme",
      url: "https://acme.com/jobs/333333",
    };
    expect(matchesCandidate(a, candidateSameTitleCompany)).toBe(false);
  });

  it("matchesCandidate is true only when the candidate's key equals the row's posting key", () => {
    const row = { positions: { id: "P1", url: "https://acme.com/jobs/123456" } };
    const matchingCandidate = { url: "https://acme.com/jobs/123456" };
    const differentCandidate = { url: "https://acme.com/jobs/999999" };
    expect(matchesCandidate(row, matchingCandidate)).toBe(true);
    expect(matchesCandidate(row, differentCandidate)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timing: this module's regexes run over attacker-influenced URLs on the
// browser's main thread. A sibling module's suffix regex measured 31.7s on a
// 200KB input. Every regex here must be proven fast on a >=100KB adversarial
// input, generous enough not to be flaky, tight enough to catch a quadratic.
// ---------------------------------------------------------------------------
describe("timing -- every regex in this module, on >=100KB adversarial input", () => {
  const TIMING_BOUND_MS = 500;

  it("postingUrlKey: a 100KB+ path with no digit run at all does not hang (DIGIT_RUN_RE)", () => {
    const hugePath = "a".repeat(120_000);
    const start = performance.now();
    const result = postingUrlKey(`https://acme.com/${hugePath}`);
    const elapsed = performance.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(TIMING_BOUND_MS);
  });

  it("postingUrlKey: a 100KB+ path built from thousands of near-miss 5-digit runs does not exhibit quadratic blowup (DIGIT_RUN_RE)", () => {
    // Each segment is a 5-digit run delimited by '-' -- one character short
    // of the threshold, forcing the regex engine to re-attempt at every
    // position without ever matching.
    const segment = "12345-";
    const hugePath = segment.repeat(20_000); // 120,000 chars
    const start = performance.now();
    const result = postingUrlKey(`https://acme.com/careers/${hugePath}`);
    const elapsed = performance.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(TIMING_BOUND_MS);
  });

  it("postingUrlKey: a 100KB+ last path segment that almost-but-never matches the UUID shape does not hang (UUID_RE)", () => {
    const hugeSegment = "g".repeat(120_000); // 'g' is not a hex digit -- fails fast at position 0, every start
    const start = performance.now();
    const result = postingUrlKey(`https://acme.com/postings/${hugeSegment}`);
    const elapsed = performance.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(TIMING_BOUND_MS);
  });

  it("postingUrlKey: a 100KB+ id-shaped query param VALUE does not hang (ID_PARAM_VALUE_RE)", () => {
    const hugeValue = "a".repeat(120_000);
    const start = performance.now();
    const result = postingUrlKey(`https://acme.com/careers?jobId=${hugeValue}`);
    const elapsed = performance.now() - start;
    expect(result).not.toBeNull(); // a long alnum run still satisfies the value guard
    expect(elapsed).toBeLessThan(TIMING_BOUND_MS);
  });

  it("postingUrlKey: thousands of query params does not exhibit quadratic blowup in tracking-strip + sort + rebuild", () => {
    const params = [];
    for (let i = 0; i < 20_000; i += 1) params.push(`p${i}=v${i}`);
    params.push("jobId=abc123"); // one real admission signal
    const url = `https://acme.com/careers?${params.join("&")}`; // > 150KB
    const start = performance.now();
    const result = postingUrlKey(url);
    const elapsed = performance.now() - start;
    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(2000);
  });

  it("externalIdKey: a 100KB+ value that is not ephemeral does not hang (EPHEMERAL_EXTERNAL_ID_RE)", () => {
    const huge = `gh-${"9".repeat(120_000)}`;
    const start = performance.now();
    const result = externalIdKey(huge);
    const elapsed = performance.now() - start;
    expect(result).toBe(`x:${huge}`);
    expect(elapsed).toBeLessThan(TIMING_BOUND_MS);
  });

  it("externalIdKey: a 100KB+ value that near-misses the shot-/manual- prefix on every character does not hang", () => {
    const huge = "s".repeat(120_000);
    const start = performance.now();
    const result = externalIdKey(huge);
    const elapsed = performance.now() - start;
    expect(result).toBe(`x:${huge}`);
    expect(elapsed).toBeLessThan(TIMING_BOUND_MS);
  });
});
