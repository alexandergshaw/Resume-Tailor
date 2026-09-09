// R-343, R-344, R-348, R-349, R-373, R-374, R-375 -- the "researched" predicate.
//
// This is the file the whole feature reduces to. A definition is
// `provenance: "researched"` if and only if EIGHT conditions hold, and every one
// of them exists because a constructed attack defeated the version without it.
// The attacks are reproduced here as cases, not summarised:
//
//   * ATTACK 1  -- one citation spanning [0, byteLen-1) marked 12/12 terms
//     researched, all sourced to one SEO farm, under a rule that tested only
//     "overlap >= 12 chars". `SPAN_REFUSAL.WHOLE_DOCUMENT` did not save it: that
//     rule is an EXACT equality on [0, length), and one byte short is a
//     different claim (citationSpans.js:218-227 says so deliberately).
//   * ATTACK 2  -- a citation correctly covering definition #1 whose end runs 20
//     characters into definition #2 sourced BOTH.
//   * ATTACK 3  -- "largest overlap wins" made the widest, wrongest citation
//     beat a correct narrow one on every term INCLUDING the one with a correct
//     citation.
//   * ATTACK 5/5b/5c -- the per-block join. See glossaryCitations.test.js.
//   * ATTACK 6  -- an Interaction that produced no text THREW out of the join,
//     because `interactionOutputText` throws when the SDK omits `output_text`
//     (it omits it whenever the text is empty: `output_text && { output_text }`,
//     and "" is falsy). This predicate never reads that field.
//   * ATTACK 9  -- five redirectors and interstitials passed the href gate AND
//     the vendor-redirect check.
//
// The precision rule is a THEOREM, not a heuristic: definition ranges are
// pairwise disjoint, so if one citation of width W qualified for two of them we
// would have overlap(c,d1) > W/2 and overlap(c,d2) > W/2, hence a sum > W, while
// both overlaps are disjoint subsets of c's own span and so sum to <= W.
// Contradiction. The sweep below confirms it empirically as well.

import { describe, it, expect } from "vitest";
import {
  RESEARCH_LINE_RE,
  parseResearchLines,
  isThirdPartyIntermediary,
  servesVendorRedirect,
  joinResearchBatch,
} from "./glossaryResearch.js";

const enc = new TextEncoder();
const B = (s) => enc.encode(s).length;

const DEFS = [
  "A property of an operation whereby applying it repeatedly produces the same result as applying it once.",
  "The process of organising relational tables to reduce redundancy across first, second and third normal form.",
  "A data structure that speeds lookup on a column at the cost of write throughput and storage overhead.",
  "An audit report covering security, availability and confidentiality over an observation period of months.",
  "A concurrency control method that gives each transaction a consistent snapshot without blocking readers.",
  "The maximum acceptable delay between a request and its response, usually stated as a percentile.",
  "A pattern in which a failing dependency is isolated so its failures do not cascade through the system.",
  "The practice of expressing infrastructure configuration in version-controlled declarative files.",
  "A message ordering guarantee ensuring each record is processed at least once despite retries.",
  "A deployment strategy that routes a small share of traffic to a new version before full rollout.",
  "The property that a distributed system continues to operate despite the loss of some of its nodes.",
  "A cryptographic technique that lets a receiver confirm a message was not altered in transit.",
];
const BODY = DEFS.map((d, i) => `${i + 1}. ${d}`).join("\n");

const citation = (url, title, s, e) => ({
  type: "url_citation",
  url,
  title,
  start_index: s,
  end_index: e,
});

// One search step then one text block -- the minimal well-formed grounded shape.
const interactionOf = (text, annotations, extra = {}) => ({
  status: "completed",
  steps: [
    { type: "google_search_call" },
    { type: "model_output", content: [{ type: "text", text, annotations }] },
  ],
  output_text: text,
  ...extra,
});

const REF = parseResearchLines(BODY);
const defOf = (i) => REF.find((d) => d.index === i);
const researchedOf = (out) => out.results.filter((r) => r.provenance === "researched");
const join = (interaction) => joinResearchBatch(interaction, { batchSize: 12 });

describe("parseResearchLines (AC-R37, AC-R38, AC-R8')", () => {
  it("parses one numbered line per definition with its character range", () => {
    expect(REF).toHaveLength(12);
    expect(BODY.slice(REF[0].defStart, REF[0].defEnd)).toBe(DEFS[0]);
    expect(BODY.slice(REF[11].defStart, REF[11].defEnd)).toBe(DEFS[11]);
  });

  it("strips a CRLF carriage return rather than storing it (AC-R37)", () => {
    // `.` excludes \n but INCLUDES \r, so a naive /^(\d{1,3})\.\s(.+)$/ stores a
    // trailing \r in every definition on a CRLF response, shifting every defEnd
    // by one and storing a string the word-count contract was not written for.
    const crlf = DEFS.map((d, i) => `${i + 1}. ${d}`).join("\r\n");
    const parsed = parseResearchLines(crlf);
    expect(parsed).toHaveLength(12);
    expect(parsed.every((p) => !p.text.endsWith("\r"))).toBe(true);
    expect(parsed[2].text).toBe(DEFS[2]);
  });

  it("drops the LATER occurrence of a duplicated index, never both (AC-R38)", () => {
    // Dropping both destroys the unrelated real term whose number was reused --
    // e.g. a wrapped definition whose continuation happens to begin "2. ".
    const text = "1. First definition here.\n2. Real second definition here.\n2. A wrapped continuation.";
    const parsed = parseResearchLines(text);
    expect(parsed.map((p) => p.index)).toEqual([1, 2]);
    expect(parsed[1].text).toBe("Real second definition here.");
  });

  it("ignores lines that are not numbered definitions", () => {
    expect(parseResearchLines("Here you go:\n1. A real one.\n\nThanks!")).toHaveLength(1);
  });

  it("exports the recogniser so a regression to the naive form is visible", () => {
    expect(RESEARCH_LINE_RE.source).toContain("\\r?");
  });
});

describe("condition 4: one citation can never claim a batch (R-344)", () => {
  it("refuses a citation spanning the exact whole document", () => {
    const out = join(interactionOf(BODY, [citation("https://evil-seo-farm.example/g", "G", 0, B(BODY))]));
    expect(researchedOf(out)).toHaveLength(0);
  });

  it("refuses a citation spanning [0, byteLen-1) -- ONE BYTE SHORT of the whole document", () => {
    // This is ATTACK 1. Under a rule that tested only overlap, this marked
    // 12/12 and `SPAN_REFUSAL.WHOLE_DOCUMENT` stayed silent because it is an
    // exact equality. The row would have been written status:'ready',
    // recalled_count 0, and twelve popovers would offer one SEO farm.
    const out = join(interactionOf(BODY, [citation("https://evil-seo-farm.example/g", "G", 0, B(BODY) - 1)]));
    expect(out.results).toHaveLength(12);
    expect(researchedOf(out)).toHaveLength(0);
    expect(out.results.every((r) => r.sourceUrl === null)).toBe(true);
  });

  it("refuses a span whose precision is exactly one half -- the comparison is STRICT", () => {
    const d1 = defOf(1);
    // A span twice the width of definition #1, starting at it: overlap/width is
    // exactly 0.5, and `> 0.5` must reject it.
    const width = d1.defEnd - d1.defStart;
    const out = join(
      interactionOf(BODY, [
        citation(
          "https://en.wikipedia.org/wiki/Idempotence",
          "I",
          B(BODY.slice(0, d1.defStart)),
          B(BODY.slice(0, d1.defStart + width * 2)),
        ),
      ]),
    );
    expect(researchedOf(out)).toHaveLength(0);
  });

  it("refuses an overlap below the 20-character floor", () => {
    const d1 = defOf(1);
    const out = join(
      interactionOf(BODY, [
        citation(
          "https://en.wikipedia.org/wiki/Idempotence",
          "I",
          B(BODY.slice(0, d1.defStart)),
          B(BODY.slice(0, d1.defStart + 15)),
        ),
      ]),
    );
    expect(researchedOf(out)).toHaveLength(0);
  });

  it("refuses a citation that TOUCHES more than two definitions, for all of them", () => {
    const d1 = defOf(1);
    const d3 = defOf(3);
    const out = join(
      interactionOf(BODY, [
        citation(
          "https://evil-seo-farm.example/three",
          "T",
          B(BODY.slice(0, d1.defStart)),
          B(BODY.slice(0, d3.defEnd)),
        ),
      ]),
    );
    expect(researchedOf(out)).toHaveLength(0);
  });

  it("EXHAUSTIVELY: no single citation can ever source more than ONE definition (AC-R30)", () => {
    // The algebraic proof, confirmed by sweep. A stride keeps the runtime sane;
    // the theorem is what makes a stride honest rather than a hope.
    const bytes = B(BODY);
    let worst = 0;
    let worstSpan = null;
    for (let s = 0; s <= bytes; s += 7) {
      for (let e = s; e <= bytes; e += 7) {
        const out = join(interactionOf(BODY, [citation("https://one.example/x", "X", s, e)]));
        const n = researchedOf(out).length;
        if (n > worst) {
          worst = n;
          worstSpan = [s, e];
        }
      }
    }
    // Exactly 1, not "<= 1": the upper half is the theorem, and the lower half
    // is the positive control that stops this passing because the predicate
    // refuses everything.
    expect({ worst, worstSpan }).toEqual({ worst: 1, worstSpan: expect.any(Array) });
  }, 120_000);
});

describe("the adjacent-line bleed and the tie-break (ATTACK 2, ATTACK 3)", () => {
  it("keeps a correct citation for #1 and refuses its 20-character bleed into #2", () => {
    // Refusing the citation outright would ALSO lose the correct #1, and
    // under-claiming a correct source feeds straight into RESEARCH_FLOOR. That
    // is why MAX_CITATION_DEFINITIONS is 2 rather than 1.
    const d1 = defOf(1);
    const d2 = defOf(2);
    const out = join(
      interactionOf(BODY, [
        citation(
          "https://en.wikipedia.org/wiki/Idempotence",
          "Idempotence",
          B(BODY.slice(0, d1.defStart)),
          B(BODY.slice(0, d2.defStart + 20)),
        ),
      ]),
    );
    expect(out.results[0].provenance).toBe("researched");
    expect(out.results[0].sourceHost).toBe("en.wikipedia.org");
    expect(out.results[1].provenance).toBe("recalled");
    expect(out.results[1].sourceUrl).toBe(null);
  });

  it("selects on PRECISION first, so a correct narrow citation beats a wide one", () => {
    // Under "largest overlap wins, ties on earliest startByte" the wide bogus
    // citation won EVERY term including the one that had a correct citation.
    const d2 = defOf(2);
    const wide = citation("https://evil-seo-farm.example/all", "All", 0, B(BODY) - 1);
    const correct = citation(
      "https://en.wikipedia.org/wiki/Database_normalization",
      "Normalization",
      B(BODY.slice(0, d2.defStart)),
      B(BODY.slice(0, d2.defEnd)),
    );
    const out = join(interactionOf(BODY, [correct, wide]));
    const r2 = out.results.find((r) => r.index === 2);
    expect(r2.sourceUrl).toBe("https://en.wikipedia.org/wiki/Database_normalization");
    expect(out.results.every((r) => r.sourceUrl !== "https://evil-seo-farm.example/all")).toBe(true);
  });
});

describe("the per-block join (R-373)", () => {
  it("refuses a citation on a block EXCLUDED from output_text, and still stores every definition", () => {
    // The canonical grounded flow: model_output -> google_search_call ->
    // model_output. The SDK's backwards, barrier-terminated scan drops the
    // preamble from `output_text`, but `extractCitationSources` still returns
    // its annotation -- which then resolves CLEANLY onto definition #1.
    const preamble = "Let me search for authoritative definitions of these twelve terms first.";
    const out = join({
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: preamble,
              annotations: [citation("https://preamble.example/x", "Pre", 0, B(preamble))],
            },
          ],
        },
        { type: "google_search_call" },
        { type: "google_search_result", search_suggestions: "..." },
        { type: "model_output", content: [{ type: "text", text: BODY, annotations: [] }] },
      ],
    });
    expect(out.definitionCount).toBe(12);
    expect(out.results.every((r) => r.sourceUrl === null)).toBe(true);
  });

  it("resolves two blocks in one step against each block's OWN text", () => {
    const lead = "Here are the twelve definitions you asked for.\n";
    const d1 = defOf(1);
    const out = join({
      status: "completed",
      steps: [
        { type: "google_search_call" },
        {
          type: "model_output",
          content: [
            { type: "text", text: lead, annotations: [] },
            {
              type: "text",
              text: BODY,
              annotations: [
                citation(
                  "https://en.wikipedia.org/wiki/Idempotence",
                  "I",
                  B(BODY.slice(0, d1.defStart)),
                  B(BODY.slice(0, d1.defEnd)),
                ),
              ],
            },
          ],
        },
      ],
    });
    const researched = researchedOf(out);
    expect(researched).toHaveLength(1);
    expect(researched[0].index).toBe(1);
    expect(researched[0].precision).toBeGreaterThan(0.99);
  });

  it("attributes a mid-document citation to the RIGHT definition under a leading block", () => {
    // ATTACK 5c weaponised: an adversary who can steer the model's text emits
    // one short leading block, and every honest annotation slides backwards by
    // len(block1) under an output_text join -- silently re-attributing REAL
    // publisher URLs to the wrong terms, with nothing malformed.
    const pad = "Sources consulted: evil-seo-farm.example.\n";
    const d5 = defOf(5);
    const out = join({
      status: "completed",
      steps: [
        { type: "google_search_call" },
        {
          type: "model_output",
          content: [
            { type: "text", text: pad, annotations: [] },
            {
              type: "text",
              text: BODY,
              annotations: [
                citation(
                  "https://www.postgresql.org/docs/current/mvcc-intro.html",
                  "MVCC",
                  B(BODY.slice(0, d5.defStart)),
                  B(BODY.slice(0, d5.defEnd)),
                ),
              ],
            },
          ],
        },
      ],
    });
    const researched = researchedOf(out);
    expect(researched).toHaveLength(1);
    expect(researched[0].index).toBe(5);
  });

  it("stores a definition straddling a block boundary, and marks it recalled", () => {
    // AC-R28. Parsing per block would LOSE it; a containment test that ignored
    // block ranges would falsely SOURCE it.
    const cutAt = BODY.indexOf("relational tables");
    const out = join({
      status: "completed",
      steps: [
        { type: "google_search_call" },
        {
          type: "model_output",
          content: [
            { type: "text", text: BODY.slice(0, cutAt), annotations: [] },
            {
              type: "text",
              text: BODY.slice(cutAt),
              annotations: [
                citation("https://en.wikipedia.org/wiki/Database_normalization", "N", 0, 30),
              ],
            },
          ],
        },
      ],
    });
    const straddler = out.results.find((r) => r.index === 2);
    expect(straddler).toBeDefined();
    expect(straddler.provenance).toBe("recalled");
    expect(out.definitionCount).toBe(12);
  });
});

describe("the throw path is closed twice (R-374)", () => {
  it("does not throw when the SDK omitted output_text entirely", () => {
    // The SDK writes `Object.assign(..., output_text && { output_text }, ...)`,
    // so an empty text OMITS the key. `interactionOutputText` throws on that,
    // while `interactionSearched` is true -- so the "no search" criterion never
    // fires; the code reaches the throw first. This predicate never reads it.
    const empty = {
      status: "completed",
      steps: [
        { type: "google_search_call" },
        { type: "model_output", content: [{ type: "text", text: "", annotations: [] }] },
      ],
    };
    expect(() => join(empty)).not.toThrow();
    const out = join(empty);
    expect(out.definitionCount).toBe(0);
    expect(out.results).toEqual([]);
  });

  it("does not throw when steps is not an array", () => {
    expect(() => join({ steps: "nope" })).not.toThrow();
    expect(join({ steps: "nope" }).searched).toBe(false);
  });

  it("does not throw when a content block is a string", () => {
    expect(() => join({ steps: [{ type: "model_output", content: "a string" }] })).not.toThrow();
  });
});

describe("the reasons are named, never a bare empty (R-348, R-349)", () => {
  it("distinguishes walk-broke from no-citations from unparsed-lines (AC-R36)", () => {
    const walkBroke = join({
      status: "completed",
      steps: [{ type: "google_search_call" }, { type: "model_output", content: [] }],
    });
    expect(walkBroke.reason).toBe("walk-broke");
    expect(walkBroke.textBlocks).toBe(0);

    const noCitations = join(interactionOf(BODY, []));
    expect(noCitations.reason).toBe("no-citations");
    expect(noCitations.textBlocks).toBeGreaterThan(0);
    expect(noCitations.annotations).toBe(0);

    const unparsed = join(
      interactionOf("I could not find anything useful.", [
        citation("https://en.wikipedia.org/wiki/X", "X", 0, 10),
      ]),
    );
    expect(unparsed.reason).toBe("unparsed-lines");
  });

  it("names an all-refused batch, and names the surrogate cliff separately (AC-R34)", () => {
    const allRefused = join(
      interactionOf(BODY, [citation("https://evil-seo-farm.example/g", "G", 0, B(BODY) - 1)]),
    );
    expect(allRefused.reason).toBe("all-citations-refused");
    expect(allRefused.refusalReasons).toBeTypeOf("object");

    const poisoned = `1. \uD83DA property of an operation applied repeatedly to one value.\n${DEFS.slice(1)
      .map((d, i) => `${i + 2}. ${d}`)
      .join("\n")}`;
    const d12 = parseResearchLines(poisoned).find((d) => d.index === 12);
    const surrogate = join(
      interactionOf(poisoned, [
        citation(
          "https://en.wikipedia.org/wiki/X",
          "X",
          B(poisoned.slice(0, d12.defStart)),
          B(poisoned.slice(0, d12.defEnd)),
        ),
      ]),
    );
    expect(surrogate.reason).toBe("surrogate-cliff");
    expect(surrogate.refusalReasons["unpaired-surrogate"]).toBeGreaterThan(0);
  });

  it("confines the surrogate cliff to its own block (AC-R34, §2.6)", () => {
    const poisoned = `1. \uD83DA property of an operation applied repeatedly to one value.\n${DEFS.slice(1)
      .map((d, i) => `${i + 2}. ${d}`)
      .join("\n")}`;
    const cut = poisoned.indexOf("\n2. ") + 1;
    const b1 = poisoned.slice(0, cut);
    const b2 = poisoned.slice(cut);
    const d12 = parseResearchLines(b2).find((d) => d.index === 12);
    const out = join({
      status: "completed",
      steps: [
        { type: "google_search_call" },
        {
          type: "model_output",
          content: [
            { type: "text", text: b1, annotations: [] },
            {
              type: "text",
              text: b2,
              annotations: [
                citation(
                  "https://en.wikipedia.org/wiki/X",
                  "X",
                  B(b2.slice(0, d12.defStart)),
                  B(b2.slice(0, d12.defEnd)),
                ),
              ],
            },
          ],
        },
      ],
    });
    expect(out.results.find((r) => r.index === 12).provenance).toBe("researched");
  });
});

describe("condition 1: a batch that did not search is never researched (AC-R11)", () => {
  it("marks every term recalled when no google_search_call step is present", () => {
    const d1 = defOf(1);
    const noSearch = {
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: BODY,
              annotations: [
                citation(
                  "https://en.wikipedia.org/wiki/Idempotence",
                  "I",
                  B(BODY.slice(0, d1.defStart)),
                  B(BODY.slice(0, d1.defEnd)),
                ),
              ],
            },
          ],
        },
      ],
    };
    const out = join(noSearch);
    expect(out.searched).toBe(false);
    expect(researchedOf(out)).toHaveLength(0);
  });
});

describe("conditions 5, 6 and 7: the URL gates (R-343, R-375)", () => {
  const REDIRECTORS = [
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC",
    "https://VertexAISearch.Cloud.Google.com/grounding-api-redirect/AbC",
    "https://www.google.com/url?q=https://evil.example/x",
    "https://r.jina.ai/https://evil.example/x",
    "https://webcache.googleusercontent.com/search?q=cache:evil.example",
    "https://translate.google.com/translate?u=https://evil.example",
    "https://en-wikipedia-org.translate.goog/wiki/Idempotence?_x_tr_sl=en",
    "https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example",
    "https://t.co/abcdef",
    "https://bit.ly/3xYzAbC",
    "https://cloud.google.com/vertex-ai/docs/grounding-api-redirect-notes",
  ];
  const PUBLISHERS = [
    "https://en.wikipedia.org/wiki/Idempotence",
    "https://www.postgresql.org/docs/current/mvcc-intro.html",
    "https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker",
    "https://datatracker.ietf.org/doc/html/rfc7231",
  ];

  const hostOf = (u) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");

  it("blocks every redirector and interstitial", () => {
    for (const url of REDIRECTORS) {
      const host = hostOf(url);
      const blocked = servesVendorRedirect(host, url) || isThirdPartyIntermediary(host, url);
      expect({ url, blocked }).toEqual({ url, blocked: true });
    }
  });

  it("ADMITS four real publishers -- the positive control without which the rule passes by refusing everything", () => {
    for (const url of PUBLISHERS) {
      const host = hostOf(url);
      expect({ url, redirect: servesVendorRedirect(host, url) }).toEqual({ url, redirect: false });
      expect({ url, intermediary: isThirdPartyIntermediary(host, url) }).toEqual({
        url,
        intermediary: false,
      });
    }
  });

  it("does NOT suppress a lone publisher the way a whole-batch host rule would", () => {
    // The shared `nonPublisherHosts` helper carries a second clause that
    // suppresses a host shared by EVERY entry of a digest. On a glossary batch
    // -- twelve related terms, often one reference page -- that clause
    // suppresses `en.wikipedia.org` outright. It is guarded by `hosts.length > 1`,
    // so asking it about ONE citation at a time makes the clause structurally
    // inert. This test is what pins that, and it is why no second copy of the
    // vendor redirect list exists in this feature.
    expect(servesVendorRedirect("en.wikipedia.org", "https://en.wikipedia.org/wiki/Idempotence")).toBe(false);
  });

  it("yields recalled with NO source fields for a vendor-redirect citation (R-343)", () => {
    const d1 = defOf(1);
    const out = join(
      interactionOf(BODY, [
        citation(
          "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC",
          "R",
          B(BODY.slice(0, d1.defStart)),
          B(BODY.slice(0, d1.defEnd)),
        ),
      ]),
    );
    expect(out.results[0].provenance).toBe("recalled");
    expect(out.results[0].sourceUrl).toBe(null);
    expect(out.results[0].sourceHost).toBe(null);
    expect(out.results[0].sourceTitle).toBe(null);
  });

  it("yields recalled for a t.co citation (R-375)", () => {
    const d1 = defOf(1);
    const out = join(
      interactionOf(BODY, [
        citation("https://t.co/abcdef", "T", B(BODY.slice(0, d1.defStart)), B(BODY.slice(0, d1.defEnd))),
      ]),
    );
    expect(out.results[0].provenance).toBe("recalled");
  });

  it("yields recalled for a URL the href gate refuses outright", () => {
    const d1 = defOf(1);
    const out = join(
      interactionOf(BODY, [
        citation("javascript:alert(1)", "J", B(BODY.slice(0, d1.defStart)), B(BODY.slice(0, d1.defEnd))),
      ]),
    );
    expect(out.results[0].provenance).toBe("recalled");
  });
});

describe("what a researched row carries", () => {
  it("stores the citation url VERBATIM, its derived host, and a truncated title", () => {
    const d1 = defOf(1);
    const url = "https://en.wikipedia.org/wiki/Idempotence?x=1";
    const out = join(
      interactionOf(BODY, [
        citation(url, "T".repeat(400), B(BODY.slice(0, d1.defStart)), B(BODY.slice(0, d1.defEnd))),
      ]),
    );
    expect(out.results[0].sourceUrl).toBe(url);
    expect(out.results[0].sourceHost).toBe("en.wikipedia.org");
    expect(out.results[0].sourceTitle).toHaveLength(120);
  });

  it("reports truncation from the vendor's own status, never guessed", () => {
    expect(join(interactionOf(BODY, [], { status: "incomplete" })).truncated).toBe(true);
    expect(join(interactionOf(BODY, [])).truncated).toBe(false);
    expect(join({ steps: [] }).truncated).toBe(false);
  });
});
