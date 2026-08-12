import { describe, it, expect } from "vitest";
import { buildResearchPrompt, reconcileCitations } from "./researchReport.js";

// The "how would current technology improve this project" researcher.
//
// reconcileCitations is the honesty-critical half and the reason this module
// exists as pure code. app/api/company-research/route.js already learned this
// lesson the expensive way, in its own words: model-supplied links 404 and
// model-supplied dates are invented. So the model's claimed citations are
// checked against groundingMetadata - the URLs the search tool actually
// visited - and anything uncorroborated is demoted to plain text.
//
// A research report with fabricated citations is worse than no report, because
// it looks checkable. That is the property these tests exist to hold.

const grounded = (uri, title = "") => ({ uri, title });

describe("buildResearchPrompt", () => {
  const page = {
    id: "p1",
    title: "Payments migration",
    body: "# Context\n\nMoved billing off the legacy processor.",
  };

  it("includes the page, its place in the tree, and its children", () => {
    const prompt = buildResearchPrompt({
      page,
      breadcrumb: ["Work", "Platform", "Payments migration"],
      childTitles: ["Rollout plan"],
      attachments: [],
    });
    expect(prompt).toContain("Payments migration");
    expect(prompt).toContain("Moved billing off the legacy processor.");
    expect(prompt).toContain("Work / Platform / Payments migration");
    expect(prompt).toContain("Rollout plan");
  });

  it("passes an attachment's name and notes, never its bytes", () => {
    // Notes are the ONLY thing a model ever learns about a video, since video
    // bytes are not sent as context. Shipping bytes into a search-grounded
    // prompt would be pure cost for no signal.
    const prompt = buildResearchPrompt({
      page,
      breadcrumb: ["Payments migration"],
      childTitles: [],
      attachments: [
        { name: "arch.png", notes: "current topology", dataB64: "AAAABBBB", storage_path: "u1/x" },
      ],
    });
    expect(prompt).toContain("arch.png");
    expect(prompt).toContain("current topology");
    expect(prompt).not.toContain("AAAABBBB");
    expect(prompt).not.toContain("u1/x");
  });

  it("asks for what the user actually wants, not resume phrasing", () => {
    // The user chose "doing the work" over "talking about the work". If the
    // prompt drifts to positioning language the report becomes the other
    // feature, silently.
    const prompt = buildResearchPrompt({
      page,
      breadcrumb: ["Payments migration"],
      childTitles: [],
      attachments: [],
    }).toLowerCase();
    expect(prompt).toContain("trade");
    expect(prompt).not.toContain("resume");
    expect(prompt).not.toContain("interview");
  });

  it("survives an empty page without producing a prompt about nothing", () => {
    const prompt = buildResearchPrompt({
      page: { id: "p2", title: "", body: "" },
      breadcrumb: [],
      childTitles: [],
      attachments: [],
    });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("reconcileCitations", () => {
  it("keeps a citation the search actually visited", () => {
    const out = reconcileCitations({
      markdown: "Consider [Postgres logical replication](https://www.postgresql.org/docs/current/logical-replication.html).",
      groundedSources: [grounded("https://www.postgresql.org/docs/current/logical-replication.html", "Logical Replication")],
    });
    expect(out.markdown).toContain("](https://www.postgresql.org/docs/current/logical-replication.html)");
    expect(out.dropped).toEqual([]);
  });

  it("demotes a citation the search never visited, keeping its text", () => {
    // The invented-link case. The claim may still be worth reading; the link
    // must not look verified.
    const out = reconcileCitations({
      markdown: "See [the 2026 benchmark](https://example.com/invented-benchmark) for numbers.",
      groundedSources: [grounded("https://www.postgresql.org/docs/current/logical-replication.html")],
    });
    expect(out.markdown).not.toContain("https://example.com/invented-benchmark");
    expect(out.markdown).toContain("the 2026 benchmark");
    expect(out.markdown).toContain("for numbers");
    expect(out.dropped).toEqual(["https://example.com/invented-benchmark"]);
  });

  it("matches a grounded source despite a differing query, fragment, or trailing slash", () => {
    // Grounding metadata routinely carries tracking parameters and redirect
    // wrappers that the model's own citation does not. Comparing raw strings
    // would drop real citations, which trains the reader to distrust the
    // filter rather than the model.
    const out = reconcileCitations({
      markdown: "[docs](https://www.postgresql.org/docs/current/logical-replication.html)",
      groundedSources: [
        grounded("https://WWW.postgresql.org/docs/current/logical-replication.html/?utm_source=x#frag"),
      ],
    });
    expect(out.dropped).toEqual([]);
  });

  it("does not treat a different path on the same host as corroborated", () => {
    // The positive control's inverse: host-only matching would wave through
    // any page on a site the search happened to touch.
    const out = reconcileCitations({
      markdown: "[claim](https://www.postgresql.org/docs/current/something-else.html)",
      groundedSources: [grounded("https://www.postgresql.org/docs/current/logical-replication.html")],
    });
    expect(out.dropped).toEqual(["https://www.postgresql.org/docs/current/something-else.html"]);
  });

  it("appends a sources section built only from grounded URLs", () => {
    const out = reconcileCitations({
      markdown: "Body text with [a link](https://a.example/one).",
      groundedSources: [grounded("https://a.example/one", "One"), grounded("https://b.example/two", "Two")],
    });
    expect(out.markdown).toContain("https://a.example/one");
    expect(out.markdown).toContain("https://b.example/two");
  });

  it("marks a report ungrounded when the search returned nothing", () => {
    // Presenting an ungrounded answer as researched is the failure this whole
    // module exists to prevent. Every citation goes, and the report says so.
    const out = reconcileCitations({
      markdown: "Use [this](https://example.com/x) approach.",
      groundedSources: [],
    });
    expect(out.grounded).toBe(false);
    expect(out.dropped).toEqual(["https://example.com/x"]);
    expect(out.markdown.toLowerCase()).toContain("not grounded");
    expect(out.markdown).not.toContain("https://example.com/x");
  });

  it("reports a grounded run as grounded", () => {
    const out = reconcileCitations({
      markdown: "no links here",
      groundedSources: [grounded("https://a.example/one")],
    });
    expect(out.grounded).toBe(true);
    expect(out.dropped).toEqual([]);
  });

  it("leaves a report with no citations alone", () => {
    const out = reconcileCitations({ markdown: "Plain prose.", groundedSources: [] });
    expect(out.markdown).toContain("Plain prose.");
    expect(out.dropped).toEqual([]);
  });

  it("never emits a dangerous scheme, even if the model produced one", () => {
    // The report is rendered by the page markdown renderer, which has its own
    // allowlist - but a citation is also copied into a sources list, so this
    // must not be the only line of defence, and it must not be the weaker one.
    const out = reconcileCitations({
      markdown: "[x](javascript:alert(1)) and [y](data:text/html;base64,PHM+)",
      groundedSources: [grounded("javascript:alert(1)")],
    });
    expect(out.markdown).not.toContain("javascript:");
    expect(out.markdown).not.toContain("data:text/html");
  });

  it("survives junk input without throwing", () => {
    for (const input of [
      { markdown: "", groundedSources: [] },
      { markdown: null, groundedSources: null },
      { markdown: "text", groundedSources: [{ uri: null }, null] },
      {},
    ]) {
      expect(() => reconcileCitations(input)).not.toThrow();
    }
  });
});
