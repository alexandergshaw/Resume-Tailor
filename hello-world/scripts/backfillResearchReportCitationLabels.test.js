// The backfill's contract. Nothing here touches a network or a database:
// every "client" is `test/helpers/supabaseFake.js`, and the label decisions are
// checked against the SHIPPED rule by importing the same module the script
// imports, never by restating what the label should be.
//
// The four assertions this file exists for, named in the brief:
//   1. IDEMPOTENCE  — a second run changes nothing, proven by running twice.
//   2. BYTE-IDENTITY — a body the rule does not govern comes back `===` the
//      input. This is the empirical form of citationLabel.js's "a match and a
//      mismatch have the same correct outcome".
//   3. THE ADVERSARIAL BRACKET — `Analysis ](https://evil.example/x) more`, the
//      title that rendered as a LIVE LINK to evil.example inside a stored
//      report. Pinned twice: once on the finder (it must not inherit
//      markdown.js's first-`]` bug) and once on the RENDERER itself, by
//      importing `parseMarkdown` and asserting on the token tree a reader
//      actually meets.
//   4. PAGINATION PAST A READ CAP — PostgREST's `db-max-rows` returns a PREFIX
//      of the rows a query asked for, regardless of `.limit()`. `withRowCap`
//      below models exactly that, and the loop must still reach the end.

import { describe, it, expect, vi } from "vitest";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { parseMarkdown } from "@/lib/experience/markdown.js";
import {
  TABLE,
  GENERATED_KIND,
  parseSourceLine,
  relabelReportBody,
  readAllResearchPages,
  runBackfill,
  redactSecrets,
  parseArgs,
} from "./backfillResearchReportCitationLabels.mjs";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";

const REDIRECT_A = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA";
const REDIRECT_B = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB";
const REDIRECT_D = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/DDD";

const PROSE = "Nimbus is a Next.js app with a Postgres store.\n\nUse pgvector for the embeddings.";

function report(...sourceLines) {
  return `${PROSE}\n\n## Sources\n${sourceLines.join("\n")}`;
}

// Every link token anywhere in a parsed markdown tree, in document order.
function linkHrefs(tokens) {
  const out = [];
  const walk = (list) => {
    for (const t of list || []) {
      if (t.type === "link") out.push(t.href);
      if (Array.isArray(t.children)) walk(t.children);
      if (Array.isArray(t.items)) for (const item of t.items) walk(item.children);
    }
  };
  walk(tokens);
  return out;
}

// PostgREST's `db-max-rows`: the SERVER truncates the response to a prefix, no
// matter what `.limit()` asked for, and says nothing about having done it. The
// fake's builder methods return the builder object itself, so overriding its
// `then` in place survives the whole chain.
function withRowCap(sb, cap) {
  return {
    ...sb,
    from: (table) => {
      const builder = sb.from(table);
      const original = builder.then;
      builder.then = (resolve, reject) =>
        original(
          (result) =>
            resolve(
              result && Array.isArray(result.data) && result.data.length > cap
                ? { ...result, data: result.data.slice(0, cap) }
                : result,
            ),
          reject,
        );
      return builder;
    },
  };
}

function seedPage(id, body, userId = USER, extra = {}) {
  return {
    id,
    user_id: userId,
    parent_id: "parent-1",
    title: `Research: Nimbus (2026-08-14) ${id}`,
    body,
    generated_kind: GENERATED_KIND,
    generated_at: "2026-08-14T10:00:00.000Z",
    ...extra,
  };
}

describe("parseSourceLine — the finder must not inherit markdown.js's first-`]` bug", () => {
  it("reads an ordinary source line", () => {
    expect(parseSourceLine(`- [reuters.com](${REDIRECT_A})`)).toEqual({
      label: "reuters.com",
      url: REDIRECT_A,
    });
  });

  it("recovers the WHOLE injected title, not the first `]` — the url is the citation's own", () => {
    const line = `- [Analysis ](https://evil.example/x) more](${REDIRECT_D})`;
    const parsed = parseSourceLine(line);
    expect(parsed).toEqual({
      label: "Analysis ](https://evil.example/x) more",
      url: REDIRECT_D,
    });
    // The naive reading — markdown.js's own, and the one that made this a
    // live link — is `https://evil.example/x`. It must never be the url.
    expect(parsed.url).not.toBe("https://evil.example/x");
  });

  it("keeps a `)` that belongs to the url", () => {
    const line = "- [Wikipedia](https://en.wikipedia.org/wiki/Nimbus_(cloud))";
    expect(parseSourceLine(line)).toEqual({
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Nimbus_(cloud)",
    });
  });

  it("refuses anything that is not a single source line", () => {
    expect(parseSourceLine("Just some prose.")).toBeNull();
    expect(parseSourceLine("- a plain bullet")).toBeNull();
    expect(parseSourceLine("")).toBeNull();
    expect(parseSourceLine("  - [a](https://a.test/)")).toBeNull();
  });
});

describe("relabelReportBody — only what the rule governs", () => {
  it("replaces a bare-domain label sitting over a vendor redirect", () => {
    const before = report(`- [reuters.com](${REDIRECT_A})`, `- [techcrunch.com](${REDIRECT_B})`);
    const result = relabelReportBody(before);

    expect(result.status).toBe("changed");
    expect(result.body).toBe(report(`- [Source (unnamed)](${REDIRECT_A})`, `- [Source (unnamed)](${REDIRECT_B})`));
    expect(result.changes).toHaveLength(2);
    expect(result.changes.map((c) => c.line)).toEqual([6, 7]);
    expect(result.changes[0].before).toBe(`- [reuters.com](${REDIRECT_A})`);
    expect(result.changes[0].after).toBe(`- [Source (unnamed)](${REDIRECT_A})`);
    // The href is NEVER touched — the rule changes what is said, not where
    // the link goes.
    expect(result.body).toContain(REDIRECT_A);
    expect(result.body).toContain(REDIRECT_B);
  });

  it("repairs the `|| g.uri` fallback that stored a URL as a source's NAME", () => {
    const before = report(`- [${REDIRECT_A}](${REDIRECT_A})`);
    const result = relabelReportBody(before);
    expect(result.status).toBe("changed");
    expect(result.body).toBe(report(`- [Source (unnamed)](${REDIRECT_A})`));
  });

  it("BYTE-IDENTITY: a real publisher host over its own href is returned unchanged", () => {
    const before = report("- [reuters.com](https://www.reuters.com/technology/nimbus-series-c/)");
    const result = relabelReportBody(before);
    expect(result.status).toBe("unchanged");
    expect(result.body).toBe(before);
    expect(result.changes).toEqual([]);
  });

  it("BYTE-IDENTITY: two distinct real publishers are returned unchanged", () => {
    const before = report(
      "- [reuters.com](https://www.reuters.com/a)",
      "- [techcrunch.com](https://techcrunch.com/b)",
    );
    expect(relabelReportBody(before).body).toBe(before);
    expect(relabelReportBody(before).status).toBe("unchanged");
  });

  it("BYTE-IDENTITY: a headline survives on a redirect — it asserts no publisher", () => {
    const before = report(`- [Nimbus raises a Series C](${REDIRECT_A})`);
    const result = relabelReportBody(before);
    expect(result.body).toBe(before);
    expect(result.status).toBe("unchanged");
  });

  it("BYTE-IDENTITY: prose outside the Sources section is never rewritten", () => {
    const prose =
      "Nimbus [uses pgvector](https://github.com/pgvector/pgvector) today, and the\n" +
      "docs at [reuters.com](https://vertexaisearch.cloud.google.com/grounding-api-redirect/ZZZ) say so.\n" +
      "A stray ] and a lone [ survive too.";
    const before = `${prose}\n\n## Sources\n- [reuters.com](${REDIRECT_A})`;
    const result = relabelReportBody(before);
    expect(result.body).toBe(`${prose}\n\n## Sources\n- [Source (unnamed)](${REDIRECT_A})`);
    // Exactly one line changed, and it is a Sources line.
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].before.startsWith("- ")).toBe(true);
  });

  it("leaves an ungrounded report (no Sources section) byte-identical", () => {
    const before =
      "Some prose.\n\n**Not grounded** — live search returned no verifiable sources for this report, " +
      "so none of its claims are confirmed. Treat it as a starting point only, and verify anything you plan to act on.";
    const result = relabelReportBody(before);
    expect(result.body).toBe(before);
    expect(result.status).toBe("unchanged");
    expect(result.reason).toBe("no-sources-section");
  });

  it("SKIPS rather than guesses when a line under ## Sources is not a source line", () => {
    const before = `${report(`- [reuters.com](${REDIRECT_A})`)}\n\nI added a note here by hand.`;
    const result = relabelReportBody(before);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("unparseable-source-line");
    expect(result.body).toBe(before);
  });

  it("SKIPS a body carrying carriage returns rather than normalising the user's text", () => {
    const before = report(`- [reuters.com](${REDIRECT_A})`).replace(/\n/g, "\r\n");
    const result = relabelReportBody(before);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("carriage-returns");
    expect(result.body).toBe(before);
  });

  it("SKIPS when the shipped writer would not re-emit the same set of hrefs", () => {
    // `mailto:` is refused by reconcileCitations' own safeUrl, so the oracle
    // returns fewer lines than went in. Dropping a user's source line is data
    // loss, so the whole report is left alone and reported.
    const before = report(`- [reuters.com](${REDIRECT_A})`, "- [mail](mailto:x@y.test)");
    const result = relabelReportBody(before);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("oracle-mismatch");
    expect(result.body).toBe(before);
  });

  it("SKIPS when re-emitting would change an HREF and not just a label", () => {
    // The stored url carries surrounding whitespace, which the shipped writer
    // trims — so the line it re-emits would carry a DIFFERENT href from the one
    // stored. The rule never changes an href, so a changed href means the
    // decomposition was wrong and nothing may be written on its say-so.
    const before = report("- [reuters.com]( https://www.reuters.com/a )");
    const result = relabelReportBody(before);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("oracle-mismatch");
    expect(result.body).toBe(before);
  });

  it("preserves trailing blank lines a hand edit may have left", () => {
    const before = `${report(`- [reuters.com](${REDIRECT_A})`)}\n\n`;
    const result = relabelReportBody(before);
    expect(result.body).toBe(`${report(`- [Source (unnamed)](${REDIRECT_A})`)}\n\n`);
  });

  it("IDEMPOTENT: a second pass over its own output changes nothing", () => {
    const before = report(
      `- [reuters.com](${REDIRECT_A})`,
      `- [${REDIRECT_B}](${REDIRECT_B})`,
      `- [Nimbus raises a Series C](${REDIRECT_D})`,
    );
    const once = relabelReportBody(before);
    expect(once.status).toBe("changed");

    const twice = relabelReportBody(once.body);
    expect(twice.status).toBe("unchanged");
    expect(twice.body).toBe(once.body);
    expect(twice.changes).toEqual([]);

    const thrice = relabelReportBody(twice.body);
    expect(thrice.body).toBe(once.body);
  });
});

describe("the link injection commit 77d9664 closed", () => {
  const injected = report(`- [Analysis ](https://evil.example/x) more](${REDIRECT_D})`);

  it("the stored body really does render as a live link to evil.example (the harm)", () => {
    expect(linkHrefs(parseMarkdown(injected))).toEqual(["https://evil.example/x"]);
  });

  it("after the backfill the renderer produces ONE link, to the citation's own href", () => {
    const after = relabelReportBody(injected);
    expect(after.status).toBe("changed");

    const hrefs = linkHrefs(parseMarkdown(after.body));
    expect(hrefs).toEqual([REDIRECT_D]);
    expect(hrefs.some((h) => h.includes("evil.example"))).toBe(false);
  });

  it("keeps the injected text visible as inert prose rather than deleting it", () => {
    const after = relabelReportBody(injected).body;
    expect(after).toContain("Analysis (https://evil.example/x) more");
    expect(after).toBe(report(`- [Analysis (https://evil.example/x) more](${REDIRECT_D})`));
  });

  it("IDEMPOTENT over the injected line too", () => {
    const once = relabelReportBody(injected);
    const twice = relabelReportBody(once.body);
    expect(twice.body).toBe(once.body);
    expect(twice.status).toBe("unchanged");
  });
});

describe("readAllResearchPages — pagination, and proving the end was reached", () => {
  function seedMany(count) {
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      rows.push(seedPage(`page-${String(i).padStart(4, "0")}`, report(`- [reuters.com](${REDIRECT_A})`)));
    }
    // Rows that must never be read: another tenant, and a hand-written page.
    rows.push(seedPage("other-tenant", report(`- [reuters.com](${REDIRECT_A})`), OTHER_USER));
    rows.push(seedPage("hand-written", "just notes", USER, { generated_kind: null, generated_at: null }));
    return rows;
  }

  it("walks past its own page size and stops on an EMPTY page", async () => {
    const sb = makeStatefulSupabase({ [TABLE]: seedMany(250) });
    const result = await readAllResearchPages({ supabase: sb, userId: USER, pageSize: 100 });

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(250);
    expect(result.reachedEnd).toBe(true);
    expect(result.requests).toBeGreaterThan(1);
    expect(result.rowCount).toBe(250);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(250);
  });

  it("still reaches the end when the SERVER caps every response below the page size", async () => {
    // db-max-rows = 40 while the script asks for 100. A loop that stops on a
    // short page reports success after seeing 40 of 250 rows.
    const sb = withRowCap(makeStatefulSupabase({ [TABLE]: seedMany(250) }), 40);
    const result = await readAllResearchPages({ supabase: sb, userId: USER, pageSize: 100 });

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(250);
    expect(result.reachedEnd).toBe(true);
    expect(result.requests).toBeGreaterThanOrEqual(7);
  });

  it("never reads another tenant's row, or a page nobody generated", async () => {
    const sb = withRowCap(makeStatefulSupabase({ [TABLE]: seedMany(30) }), 7);
    const result = await readAllResearchPages({ supabase: sb, userId: USER, pageSize: 100 });

    expect(result.rows.map((r) => r.id)).not.toContain("other-tenant");
    expect(result.rows.map((r) => r.id)).not.toContain("hand-written");
    for (const call of sb.calls) {
      expect(call.filters).toContainEqual(
        expect.objectContaining({ column: "user_id", operator: "eq", value: USER }),
      );
      expect(call.filters).toContainEqual(
        expect.objectContaining({ column: "generated_kind", operator: "eq", value: GENERATED_KIND }),
      );
    }
  });

  it("reports a read error instead of a short list", async () => {
    const sb = makeStatefulSupabase({ [TABLE]: seedMany(3) }, { errors: { [TABLE]: { select: { message: "boom" } } } });
    const result = await readAllResearchPages({ supabase: sb, userId: USER, pageSize: 100 });
    expect(result.error).toBeTruthy();
    expect(result.reachedEnd).toBe(false);
  });

  it("does not claim it reached the end when it ran out of requests", async () => {
    const sb = makeStatefulSupabase({ [TABLE]: seedMany(250) });
    const result = await readAllResearchPages({ supabase: sb, userId: USER, pageSize: 10, maxRequests: 3 });
    expect(result.reachedEnd).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.rows.length).toBeLessThan(250);
  });

  it("refuses to run unscoped", async () => {
    const sb = makeStatefulSupabase({ [TABLE]: seedMany(3) });
    const result = await readAllResearchPages({ supabase: sb, userId: "", pageSize: 100 });
    expect(result.error).toMatch(/user/i);
    expect(sb.calls).toHaveLength(0);
  });
});

describe("runBackfill — dry run by default", () => {
  function seedTwo() {
    return makeStatefulSupabase({
      [TABLE]: [
        seedPage("p-dirty", report(`- [reuters.com](${REDIRECT_A})`)),
        seedPage("p-clean", report("- [reuters.com](https://www.reuters.com/a)")),
        seedPage("p-other", report(`- [reuters.com](${REDIRECT_A})`), OTHER_USER),
      ],
    });
  }

  it("issues NO write statement and leaves every row untouched", async () => {
    const sb = seedTwo();
    const before = sb.rows(TABLE).map((r) => r.body);

    const summary = await runBackfill({ supabase: sb, userId: USER, log: () => {} });

    expect(summary.apply).toBe(false);
    expect(sb.calls.every((c) => c.verb === "select")).toBe(true);
    expect(sb.rows(TABLE).map((r) => r.body)).toEqual(before);
    expect(summary.written).toBe(0);
  });

  it("reports how many rows matched, how many would change, and the affected lines", async () => {
    const sb = seedTwo();
    const summary = await runBackfill({ supabase: sb, userId: USER, log: () => {} });

    expect(summary.matched).toBe(2);
    expect(summary.changed).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.linesAffected).toBe(1);

    const dirty = summary.reports.find((r) => r.id === "p-dirty");
    expect(dirty.changes[0].before).toBe(`- [reuters.com](${REDIRECT_A})`);
    expect(dirty.changes[0].after).toBe(`- [Source (unnamed)](${REDIRECT_A})`);
  });

  it("never dumps a whole document to the terminal", async () => {
    const huge = `${"x".repeat(40000)}\n\n## Sources\n- [reuters.com](${REDIRECT_A}${"y".repeat(2000)})`;
    const sb = makeStatefulSupabase({ [TABLE]: [seedPage("p-huge", huge, USER, { title: "T".repeat(500) })] });

    const lines = [];
    await runBackfill({ supabase: sb, userId: USER, log: (line) => lines.push(String(line)) });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(400);
    expect(lines.join("\n").length).toBeLessThan(8000);
    expect(lines.join("\n")).not.toContain("x".repeat(300));
  });

  it("caps how many example lines and how many pages it prints", async () => {
    const many = report(...Array.from({ length: 40 }, (_, i) => `- [reuters.com](${REDIRECT_A}${i})`));
    const rows = Array.from({ length: 40 }, (_, i) => seedPage(`p-${String(i).padStart(3, "0")}`, many));
    const sb = makeStatefulSupabase({ [TABLE]: rows });

    const lines = [];
    const summary = await runBackfill({ supabase: sb, userId: USER, log: (line) => lines.push(String(line)) });

    expect(summary.changed).toBe(40);
    expect(summary.linesAffected).toBe(1600);
    expect(lines.join("\n")).toMatch(/more/i);
    expect(lines.length).toBeLessThan(200);
  });
});

describe("runBackfill --apply", () => {
  function seedThree() {
    return makeStatefulSupabase({
      [TABLE]: [
        seedPage("p-dirty", report(`- [reuters.com](${REDIRECT_A})`)),
        seedPage("p-clean", report("- [reuters.com](https://www.reuters.com/a)")),
        seedPage("p-other", report(`- [reuters.com](${REDIRECT_A})`), OTHER_USER),
      ],
    });
  }

  it("writes only the row the rule governs, and only its body", async () => {
    const sb = seedThree();
    const summary = await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });

    expect(summary.written).toBe(1);
    expect(sb.row(TABLE, (r) => r.id === "p-dirty").body).toBe(report(`- [Source (unnamed)](${REDIRECT_A})`));

    const writes = sb.calls.filter((c) => c.verb !== "select");
    expect(writes).toHaveLength(1);
    expect(writes[0].verb).toBe("update");
    expect(Object.keys(writes[0].payload)).toEqual(["body"]);
  });

  it("leaves a clean row byte-identical and never writes it", async () => {
    const sb = seedThree();
    const clean = sb.row(TABLE, (r) => r.id === "p-clean").body;
    await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });

    expect(sb.row(TABLE, (r) => r.id === "p-clean").body).toBe(clean);
    const writes = sb.calls.filter((c) => c.verb !== "select");
    expect(writes.map((w) => w.filters.find((f) => f.column === "id")?.value)).not.toContain("p-clean");
  });

  it("never touches a row outside its owner, on any statement", async () => {
    const sb = seedThree();
    const otherBefore = sb.row(TABLE, (r) => r.id === "p-other").body;
    await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });

    expect(sb.row(TABLE, (r) => r.id === "p-other").body).toBe(otherBefore);
    for (const call of sb.calls) {
      expect(call.filters).toContainEqual(
        expect.objectContaining({ column: "user_id", operator: "eq", value: USER }),
      );
    }
  });

  it("scopes the UPDATE by id AND user_id AND the body it read (optimistic)", async () => {
    const sb = seedThree();
    const original = sb.row(TABLE, (r) => r.id === "p-dirty").body;
    await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });

    const update = sb.calls.find((c) => c.verb === "update");
    expect(update.filters).toContainEqual(expect.objectContaining({ column: "id", value: "p-dirty" }));
    expect(update.filters).toContainEqual(expect.objectContaining({ column: "user_id", value: USER }));
    expect(update.filters).toContainEqual(expect.objectContaining({ column: "body", value: original }));
  });

  it("counts a row that changed underneath it as a conflict, not a write", async () => {
    const sb = seedThree();
    const real = sb.from;
    let edited = false;
    // A concurrent edit landing between the read and the write: the row's body
    // is no longer the one the script read, so the optimistic filter must miss.
    sb.from = vi.fn((table) => {
      const builder = real(table);
      const originalUpdate = builder.update;
      builder.update = (payload) => {
        if (!edited) {
          edited = true;
          sb.seed(
            TABLE,
            sb.rows(TABLE).map((r) => (r.id === "p-dirty" ? { ...r, body: `${r.body}\n\nEdited by hand.` } : r)),
          );
        }
        return originalUpdate(payload);
      };
      return builder;
    });

    const summary = await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });
    expect(summary.written).toBe(0);
    expect(summary.conflicts).toBe(1);
  });

  it("IDEMPOTENT: a second --apply run writes nothing", async () => {
    const sb = seedThree();
    const first = await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });
    expect(first.written).toBe(1);

    const bodiesAfterFirst = sb.rows(TABLE).map((r) => `${r.id}:${r.body}`);
    const second = await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });

    expect(second.changed).toBe(0);
    expect(second.written).toBe(0);
    expect(second.matched).toBe(first.matched);
    expect(sb.rows(TABLE).map((r) => `${r.id}:${r.body}`)).toEqual(bodiesAfterFirst);
  });

  it("does not claim success when the read never reached the end", async () => {
    const sb = makeStatefulSupabase(
      { [TABLE]: [seedPage("p-dirty", report(`- [reuters.com](${REDIRECT_A})`))] },
      { errors: { [TABLE]: { select: { message: "boom" } } } },
    );
    const summary = await runBackfill({ supabase: sb, userId: USER, apply: true, log: () => {} });
    expect(summary.error).toBeTruthy();
    expect(summary.written).toBe(0);
    expect(sb.calls.every((c) => c.verb === "select")).toBe(true);
  });
});

describe("the command line", () => {
  it("refuses to do anything without an explicit user", () => {
    expect(parseArgs([]).error).toMatch(/--user/);
    expect(parseArgs(["--apply"]).error).toMatch(/--user/);
  });

  it("is a dry run unless --apply is spelled out", () => {
    const args = parseArgs(["--user", USER]);
    expect(args.error).toBeNull();
    expect(args.apply).toBe(false);
    expect(args.userId).toBe(USER);
    expect(parseArgs(["--user", USER, "--apply"]).apply).toBe(true);
  });

  it("rejects an argument it does not understand rather than ignoring it", () => {
    expect(parseArgs(["--user", USER, "--aply"]).error).toMatch(/--aply/);
    expect(parseArgs(["--user", USER, "--apply=yes"]).error).toBeTruthy();
  });

  it("accepts a page size and refuses a nonsensical one", () => {
    expect(parseArgs(["--user", USER, "--page-size", "50"]).pageSize).toBe(50);
    expect(parseArgs(["--user", USER, "--page-size", "0"]).error).toBeTruthy();
    expect(parseArgs(["--user", USER, "--page-size", "nope"]).error).toBeTruthy();
  });
});

describe("secrets", () => {
  it("redacts a value that leaked into a message, naming the variable instead", () => {
    const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service.role";
    const out = redactSecrets(`failed to reach ${key} at https://x.supabase.co`, {
      SUPABASE_SERVICE_ROLE_KEY: key,
    });
    expect(out).not.toContain(key);
    expect(out).toContain("[redacted:SUPABASE_SERVICE_ROLE_KEY]");
  });

  it("is a no-op when the secret is absent or empty", () => {
    expect(redactSecrets("nothing here", { SUPABASE_SERVICE_ROLE_KEY: "" })).toBe("nothing here");
    expect(redactSecrets("nothing here", {})).toBe("nothing here");
  });
});
