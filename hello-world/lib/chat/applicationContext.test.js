// The three losslessness laws for the chat request's `applications` array,
// over a corpus built to VARY the fields the laws actually read.
//
//   L1 (fixed point)  selectRenderedApplications(project(A)) picks the same
//                     POSITIONS as selectRenderedApplications(A)
//   L2 (render)       renderApplicationsSection(project(A))
//                       === renderApplicationsSection(A)
//   L3 (embedded)     localChatReply over project(A) === over A
//
// Written BEFORE lib/chat/applicationContext.js exists, so this file is red on
// arrival by construction: the import below fails and every case in it errors.
// That is the hand-off. Make these pass without changing what they assert.
//
// Two structural warnings, both earned by corpora in this repo that went green
// against real losses:
//
//   * A corpus whose fields are CONSTANT across every combination cannot
//     exercise an invariant that depends on them. The predecessor ran 343
//     combinations and stayed green against an edit that lost 25,678
//     characters, because `appliedAt`, `applicationUrl` and `stages[].outcome`
//     were the same in every fixture. Everything the laws read varies here:
//     see PROFILES.
//   * An ASCII corpus is blind to a byte-based bound. `"d".repeat(n)` has a
//     UTF-8 byte length equal to its `.length`, so a byte bound and a
//     code-unit bound are indistinguishable against it -- while on a realistic
//     accented posting a byte bound silently drops 335 characters and the
//     trailing "…". The corpus carries accents, em dashes, curly quotes,
//     bullets, a euro sign, and a surrogate PAIR straddling the cut.
//
// Every fixture is passed through `JSON.parse(JSON.stringify(...))` before use.
// That round trip is load-bearing, not decoration: the projection's output is
// what `chatbot.js`'s `JSON.stringify` puts on the wire, and a lone surrogate
// at the cut only behaves observably (as a `\udXXX` escape) after it.

import { describe, it, expect } from "vitest";
import {
  MAX_APPLICATIONS,
  MAX_JD_CHARS,
  MAX_TAILORED_CHARS,
  truncate,
  selectRenderedApplications,
  renderApplicationsSection,
  projectApplicationsForRequest,
} from "@/lib/chat/applicationContext";
// The REAL embedded assistant, not a replica: L3 is only worth anything if it
// runs the code the server actually runs (route.js:186).
import { localChatReply } from "@/lib/chat/localAssistant";

// ---------------------------------------------------------------------------
// The corpus.
//
// Deliberately a PROJECTED-shape builder, local to this file. It does NOT
// share `heavyApplication` from chatbot.request.test.js: that is the raw
// Supabase-row shape (the INPUT to chatbot.js's map) with no `stages`, no
// `application_url` and no `pos.url`, so it exercises neither stage branch.
// Different layer, not duplication.
//
// The region between the <corpus> markers is self-contained on purpose, so it
// can be lifted verbatim into a harness and run against a reference
// implementation to prove the corpus is not blind.
// ---------------------------------------------------------------------------

// <corpus>
const ACCENTED_LINE = "Résumé — led “growth” • €1.2M ARR · naïve café über Zurück ";
const RESUME_LINE = "Alex Shaw — Ingénieur données · piloté 4 équipes • €4M ARR ↑ naïve→robuste ";
const ASCII_LINE = "Owns the ingestion pipeline: Airflow, dbt, Snowflake, Terraform, and on-call. ";

function repeatTo(n, line) {
  if (n <= 0) return "";
  let out = "";
  while (out.length < n) out += line;
  return out.slice(0, n);
}

// A string whose surrogate PAIR straddles the bound: the high surrogate lands
// at index `at` and the low at `at + 1`. A `max + 1` code-unit bound therefore
// keeps a LONE high surrogate, which survives JSON.stringify as a "\udXXX"
// escape and is then dropped again by the server's own slice(0, max) -- so the
// rendered block is identical, but only the round trip can show it.
function straddling(n, at, line) {
  if (n < at + 2) return repeatTo(n, line);
  return `${repeatTo(at, line)}😀${repeatTo(n - at - 2, line)}`;
}

const TEXT_KINDS = {
  ascii: (n) => repeatTo(n, ASCII_LINE),
  accented: (n) => repeatTo(n, ACCENTED_LINE),
  surrogate: (n, at) => straddling(n, at, ACCENTED_LINE),
  resume: (n) => repeatTo(n, RESUME_LINE),
  resumeSurrogate: (n, at) => straddling(n, at, RESUME_LINE),
};

const JD_LENGTHS = [0, 1, MAX_JD_CHARS - 1, MAX_JD_CHARS, MAX_JD_CHARS + 1, MAX_JD_CHARS + 2, MAX_JD_CHARS * 10];
const RESUME_LENGTHS = [
  0,
  1,
  MAX_TAILORED_CHARS - 1,
  MAX_TAILORED_CHARS,
  MAX_TAILORED_CHARS + 1,
  MAX_TAILORED_CHARS + 2,
  MAX_TAILORED_CHARS * 10,
];

// The fields the fixed point depends on. Held constant, the canary class below
// is invisible -- that is exactly how the predecessor corpus scored 0/343
// against a selector that lost 25,678 characters.
//
// Note the ALIASING trap in how these are indexed. `stagesFor` branches on
// `i % 4`, so indexing a 4-element list by `i % 4` inside one of those
// branches pins the value: every stage in that branch would carry the same
// outcome, and the "outcome varies" dimension would be a fiction. Outcomes are
// therefore indexed by `Math.floor(i / 4)`, and the two 5-element lists are a
// different length from the branch modulus on purpose.
const OUTCOMES = ["pending", "rejected", "passed", null];
const APPLIED_AT = ["2026-01-04", null, "2025-11-30", "2026-02-17", "2024-08-09"];
const URLS = [
  "https://jobs.example.com/northwind",
  null,
  "https://boards.example.org/lumière",
  null,
  "https://careers.example.net/röle",
];
const STATUSES = ["applied", "interviewing", "rejected", "offer", null];

function outcomeFor(i, offset = 0) {
  return OUTCOMES[(Math.floor(i / 4) + offset) % OUTCOMES.length];
}

// Four stage shapes, including the two that route.js's renderer treats
// differently (a missing `stages` key vs an empty array) and the `type`
// fallback branch (`s.name` absent).
function stagesFor(i) {
  switch (i % 4) {
    case 0:
      return undefined; // no `stages` key at all
    case 1:
      return [];
    case 2:
      return [
        {
          name: "Recruiter screen",
          type: "phone_screen",
          scheduledAt: `2026-03-${String((i % 27) + 1).padStart(2, "0")}T15:00:00Z`,
          outcome: outcomeFor(i),
          interviewers: ["Dana Q."],
          notes: "Ask about the on-call rotation.",
        },
      ];
    default:
      return [
        {
          name: null,
          type: "take_home",
          scheduledAt: null,
          outcome: outcomeFor(i, 2),
          interviewers: [],
          notes: null,
        },
        {
          name: "System design",
          type: "onsite",
          scheduledAt: `2026-04-${String((i % 27) + 1).padStart(2, "0")}T17:30:00Z`,
          outcome: outcomeFor(i, 1),
          interviewers: ["Priya R.", "Sam O."],
          notes: "Two rounds, back to back.",
        },
      ];
  }
}

function baseApplication(i) {
  const app = {
    company: i % 11 === 7 ? null : `Company ${String(i).padStart(3, "0")}`,
    role: i % 13 === 5 ? null : `Rôle ${String(i).padStart(3, "0")}`,
    status: STATUSES[i % STATUSES.length],
    appliedAt: APPLIED_AT[i % APPLIED_AT.length],
    applicationUrl: URLS[i % URLS.length],
    jobDescription: null,
    tailoredResume: null,
  };
  const stages = stagesFor(i);
  if (stages !== undefined) app.stages = stages;
  return app;
}

const PROFILES = [
  {
    label: "boundary lengths, accented",
    app: (i) => ({
      ...baseApplication(i),
      jobDescription: TEXT_KINDS.accented(JD_LENGTHS[i % JD_LENGTHS.length], MAX_JD_CHARS) || null,
      tailoredResume: TEXT_KINDS.resume(RESUME_LENGTHS[(i + 3) % RESUME_LENGTHS.length], MAX_TAILORED_CHARS) || null,
    }),
  },
  {
    label: "boundary lengths, ASCII",
    app: (i) => ({
      ...baseApplication(i),
      jobDescription: TEXT_KINDS.ascii(JD_LENGTHS[(i + 2) % JD_LENGTHS.length], MAX_JD_CHARS) || null,
      tailoredResume: TEXT_KINDS.ascii(RESUME_LENGTHS[(i + 5) % RESUME_LENGTHS.length], MAX_TAILORED_CHARS) || null,
    }),
  },
  {
    label: "surrogate pair straddling the cut",
    app: (i) => ({
      ...baseApplication(i),
      jobDescription: TEXT_KINDS.surrogate(MAX_JD_CHARS + 2, MAX_JD_CHARS),
      tailoredResume: TEXT_KINDS.resumeSurrogate(MAX_TAILORED_CHARS + 2, MAX_TAILORED_CHARS),
    }),
  },
  {
    label: "ten times the cap",
    app: (i) => ({
      ...baseApplication(i),
      jobDescription: TEXT_KINDS.accented(MAX_JD_CHARS * 10, MAX_JD_CHARS),
      tailoredResume: TEXT_KINDS.resume(MAX_TAILORED_CHARS * 10, MAX_TAILORED_CHARS),
    }),
  },
  {
    label: "no documents at all",
    app: (i) => baseApplication(i),
  },
  {
    label: "documents only PAST the pick",
    // The adversarial shape for a projection that bounds by field rather than
    // by position: everything the renderer would show carries no text, and all
    // the text sits where the renderer never looks.
    app: (i) => ({
      ...baseApplication(i),
      jobDescription: i < MAX_APPLICATIONS ? null : TEXT_KINDS.accented(MAX_JD_CHARS + 2, MAX_JD_CHARS),
      tailoredResume: i < MAX_APPLICATIONS ? null : TEXT_KINDS.resume(MAX_TAILORED_CHARS + 2, MAX_TAILORED_CHARS),
    }),
  },
  {
    label: "few early interviews, one past the pick",
    // Without this profile the corpus is BLIND to a projection that drops
    // stage data past the rendered slice: both embedded handlers render
    // `upcoming.slice(0, 5)`, so in every other profile the five slots are
    // filled from early applications and the late ones never show. MEASURED
    // against a reference implementation mutated to drop stages past position
    // 24: 0 of the 49 fixtures the corpus had without this profile caught it;
    // 2 of the 56 it has with it do. Only indices 0, 1, 2 and 25 carry a
    // scheduled stage here, so four entries compete for five slots.
    app: (i) => ({
      ...baseApplication(i),
      jobDescription: TEXT_KINDS.accented(MAX_JD_CHARS + 2, MAX_JD_CHARS),
      tailoredResume: TEXT_KINDS.resume(MAX_TAILORED_CHARS + 2, MAX_TAILORED_CHARS),
      stages:
        [0, 1, 2, MAX_APPLICATIONS].includes(i)
          ? [
              {
                name: "Onsite loop",
                type: "onsite",
                scheduledAt: `2026-05-${String(i + 1).padStart(2, "0")}T16:00:00Z`,
                outcome: outcomeFor(i),
                interviewers: ["Dana Q."],
                notes: "Bring the design doc.",
              },
            ]
          : [],
    }),
  },
  {
    label: "varying JD lengths",
    // JD length grows strictly with the index, so the LONGEST descriptions sit
    // PAST position 24. That property is what makes the L1 canary able to
    // fire: a selector ordering by description length picks entirely from
    // beyond the positional slice, exactly where the projection has nulled the
    // field. With the lengths descending instead, the ordering selector and
    // the positional one would agree and the canary would prove nothing.
    app: (i) => ({
      ...baseApplication(i),
      jobDescription: TEXT_KINDS.accented(100 * (i + 1), MAX_JD_CHARS),
      tailoredResume: TEXT_KINDS.resume(80 * (i + 1), MAX_TAILORED_CHARS),
    }),
  },
];

// KNOWN BLIND DIMENSION, named rather than left to be discovered: every heavy
// field in this corpus is `string | null` by construction, so no fixture here
// carries a TRUTHY NON-STRING (a number, an object) in `jobDescription` or
// `tailoredResume`. L2 is FALSE for that shape under the projection this
// module ships: today's renderer emits an empty `  Job Description: ` line
// (because `truncate` returns "" for a non-string), while `boundSelected`
// returns null for a non-string and the projected render drops the line
// entirely. See the `[boundary]` case below, which pins what the renderer
// does with it.
//
// The shape is NOT REACHABLE from the live data path, which is why keeping it
// out of the corpus costs nothing. `chatbot.js:494-495` builds
// `jobDescription: pos.description || null` from `positions.description`, a
// Supabase TEXT column (string or null/undefined, never a truthy non-string),
// and `tailoredResume: resume?.content || null` from `generated_resumes`,
// whose only writer is `lib/supabase/saveGeneratedResume.js` -- its JSDoc
// declares `content: string` and it refuses falsy values. Neither can hand
// back a number or an object. (An earlier draft of this comment said the
// shape WAS reachable, contradicting `applicationContext.js`'s header, which
// said the opposite about the identical code. The module was right; this is
// the correction.)
//
// The deviation itself is RESOLVED, not open: `applicationContext.js` names
// it as a deliberate exception and rules that bounding beats losslessness for
// a malformed input, because the alternative -- passing an arbitrarily large
// non-string through untouched -- defeats the reason the module exists. So
// the shape stays out of this corpus by decision, not by escalation: adding
// it would turn L2 red for behaviour that is intended.
const COUNTS = [0, 1, 3, MAX_APPLICATIONS - 1, MAX_APPLICATIONS, MAX_APPLICATIONS + 1, 60];

function wire(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCorpus() {
  const out = [];
  for (const count of COUNTS) {
    for (const profile of PROFILES) {
      out.push({
        label: `${count} mixed, ${profile.label}`,
        applications: wire(Array.from({ length: count }, (_, i) => profile.app(i))),
      });
    }
  }
  return out;
}

const CORPUS = buildCorpus();
// </corpus>

// Position of each picked element inside the array it was picked FROM.
// `select()` returns elements of its input BY REFERENCE (slice, filter and
// sort all do), so indexOf resolves them.
//
// Two honest notes about the -1 guards that follow, so nobody mistakes them
// for the defence against vacuity:
//
//   * They are DECORATIVE for every selector used here -- all of them return
//     elements by reference, so indexOf always resolves. They would only fire
//     for a selector that MAPS to new objects, which would otherwise make the
//     equality vacuously true. Cheap insurance, not the guarantee. The real
//     defence against a vacuous pass is the [control] cases, which assert the
//     picks are non-empty and of the expected size.
//   * WHERE the JSON round trip happens is load-bearing. `wire()` runs when a
//     fixture is BUILT -- before anything is projected -- so both sides of
//     every comparison below hold live object references. A round trip applied
//     to the PROJECTION's output instead would break reference identity, every
//     indexOf would return -1, and L1 would collapse into a guard failure that
//     looks like a real defect. The serialization fidelity that matters for
//     the wire is exercised in L2/L3, where the compared value is a string.
function positionsOf(source, picked) {
  return picked.map((p) => source.indexOf(p));
}

function fixedPointReport(selector, raw) {
  const projected = projectApplicationsForRequest(raw);
  const before = positionsOf(raw, selector(raw));
  const after = positionsOf(projected, selector(projected));
  return { before, after };
}

function fixture(label) {
  const found = CORPUS.find((c) => c.label === label);
  if (!found) throw new Error(`corpus fixture "${label}" does not exist`);
  return found.applications;
}

describe("applicationContext corpus", () => {
  it("[control] the corpus really varies the fields the laws read", () => {
    // A corpus that cannot fail is worth nothing, and the way this one failed
    // before was by holding these constant. Assert the variation directly, so
    // a future edit that flattens the builder goes red HERE rather than
    // silently making every law below vacuous.
    expect(CORPUS.length).toBe(COUNTS.length * PROFILES.length);
    const all = CORPUS.flatMap((c) => c.applications);
    const distinct = (fn) => new Set(all.map(fn).map((v) => JSON.stringify(v)));
    expect(distinct((a) => a.appliedAt).size).toBeGreaterThan(1);
    expect(distinct((a) => a.applicationUrl).size).toBeGreaterThan(1);
    expect(distinct((a) => a.status).size).toBeGreaterThan(1);
    expect(distinct((a) => (a.stages || []).map((s) => s.outcome)).size).toBeGreaterThan(3);
    expect(distinct((a) => (a.jobDescription || "").length).size).toBeGreaterThan(5);
    expect(distinct((a) => (a.tailoredResume || "").length).size).toBeGreaterThan(5);
    // Multibyte, and a real surrogate pair, are both present.
    const multibyte = all.filter(
      (a) => typeof a.jobDescription === "string" && new TextEncoder().encode(a.jobDescription).length !== a.jobDescription.length,
    );
    expect(multibyte.length).toBeGreaterThan(50);
    expect(all.some((a) => typeof a.jobDescription === "string" && /😀/.test(a.jobDescription))).toBe(true);
    // Some fixtures are longer than the pick, or nothing here tests a slice.
    expect(CORPUS.some((c) => c.applications.length > MAX_APPLICATIONS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// L1 -- the fixed point. AC-9.
// ---------------------------------------------------------------------------

describe("[L1] selectRenderedApplications is a fixed point of the projection", () => {
  it("picks the same positions before and after the projection, over the whole corpus", () => {
    for (const { label, applications } of CORPUS) {
      const { before, after } = fixedPointReport(selectRenderedApplications, applications);
      expect(before, `${label}: selector did not return elements of its input`).not.toContain(-1);
      expect(after, `${label}: selector did not return elements of the projection`).not.toContain(-1);
      expect(after, `${label}: selectRenderedApplications is not a fixed point`).toEqual(before);
    }
  });

  it("[control] the picked positions are the first MAX_APPLICATIONS, and there really are some", () => {
    // Paired positive control. "The positions did not change" is also
    // satisfied by a selector that picks NOTHING on both sides, which is
    // exactly the degenerate pass this law must not accept.
    const applications = fixture("60 mixed, varying JD lengths");
    const { before, after } = fixedPointReport(selectRenderedApplications, applications);
    expect(before).toHaveLength(MAX_APPLICATIONS);
    expect(after).toHaveLength(MAX_APPLICATIONS);
    expect(before).toEqual(Array.from({ length: MAX_APPLICATIONS }, (_, i) => i));
  });

  it("[canary] the L1 assertion catches a selector that ORDERS by a selected-tier field", () => {
    // Reads `jobDescription` by ordering. Under the shipped tiers a selector
    // reading `outcome`, `appliedAt` or `applicationUrl` is LOSSLESS (they are
    // always-tier), so the canary must use one of the two fields that stay
    // `selected` under every scheme.
    const byJdLength = (apps) =>
      [...apps]
        .sort((a, b) => (b.jobDescription || "").length - (a.jobDescription || "").length)
        .slice(0, MAX_APPLICATIONS);
    const applications = fixture("60 mixed, varying JD lengths");
    const { before, after } = fixedPointReport(byJdLength, applications);
    expect(before).not.toContain(-1);
    expect(after).not.toContain(-1);
    // The law really does fail here -- so a green run above means something.
    expect(after).not.toEqual(before);
  });

  it("[control] a TRUTHINESS filter on an ALWAYS-tier field really is a fixed point, unconditionally", () => {
    // The companion to the canary above: a selector that is NOT positional but
    // is still safe, so the law is shown to be discriminating rather than just
    // strict. `applicationUrl` is `always`-tier -- the projection copies it for
    // EVERY application, inside the pick or not -- so the candidate set is
    // identical on both sides no matter how the filter's slots get filled.
    //
    // It must be an always-tier field. A truthiness filter on `jobDescription`
    // (which PLAN-A1 §2.2 proposed for this control, citing ARCH v2 D2's
    // "monotonicity exception") is NOT a fixed point -- see the canary below,
    // which disproves it. Do not "simplify" this back to a selected-tier field.
    const hasUrl = (apps) => apps.filter((a) => a.applicationUrl).slice(0, MAX_APPLICATIONS);
    for (const { label, applications } of CORPUS) {
      const { before, after } = fixedPointReport(hasUrl, applications);
      expect(before, `${label}`).not.toContain(-1);
      expect(after, `${label}: an always-tier truthiness filter must be a fixed point`).toEqual(before);
    }
    // ...and it is not vacuous: on this fixture the filter really does reach
    // past position 24 to fill its 25 slots, which is exactly the reach that
    // breaks the selected-tier version.
    const applications = fixture("60 mixed, varying JD lengths");
    const { before } = fixedPointReport(hasUrl, applications);
    expect(before).toHaveLength(MAX_APPLICATIONS);
    expect(Math.max(...before)).toBeGreaterThan(MAX_APPLICATIONS - 1);
  });

  it("[canary] ARCH v2 D2's 'monotonicity exception' is FALSE: a truthiness filter on a SELECTED-tier field is not a fixed point", () => {
    // ARCH v2 §11 D2 states flatly that truthiness filters on a
    // `selected`-tier field are lossless, and PLAN-A1 §2.2 turned that into a
    // control asserting one still passes. It does not. A filter-then-slice
    // reaches PAST position MAX_APPLICATIONS-1 to fill its slots, and the
    // projection has already nulled the heavy fields out there -- so every
    // candidate the raw side found beyond the slice vanishes on the projected
    // side. It survives ONLY in the special case where all 25 positional slots
    // already carry job text, which is not a property anyone can rely on.
    //
    // Kept as a test rather than a comment so nobody reintroduces the
    // exception: the law is L1, and "reads only always-tier fields" is the
    // sufficient condition you can check by inspection.
    const hasJobText = (apps) => apps.filter((a) => a.jobDescription).slice(0, MAX_APPLICATIONS);

    // The realistic case: four of the first 25 applications are quick-applies
    // with no saved posting text (JD length 0 in the corpus's boundary set).
    const realistic = fixedPointReport(hasJobText, fixture("60 mixed, boundary lengths, accented"));
    expect(realistic.before).toHaveLength(MAX_APPLICATIONS);
    expect(realistic.after.length).toBeLessThan(realistic.before.length);

    // The extreme case: none of the 25 most recent carry documents.
    const extreme = fixedPointReport(hasJobText, fixture("60 mixed, documents only PAST the pick"));
    expect(extreme.before.length).toBeGreaterThan(0);
    expect(extreme.after).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// L2 -- render equality. AC-5, AC-6, AC-7, AC-8, AC-9, AC-46.
// ---------------------------------------------------------------------------

describe("[L2] the rendered applications block is byte-identical under the projection", () => {
  it("renderApplicationsSection(project(A)) === renderApplicationsSection(A) over the whole corpus", () => {
    for (const { label, applications } of CORPUS) {
      const projected = wire(projectApplicationsForRequest(applications));
      expect(renderApplicationsSection(projected), `${label}: rendered block changed`).toBe(
        renderApplicationsSection(applications),
      );
    }
  });

  it("[control] the block really carries the posting text -- absence of loss is not absence of output", () => {
    // Without this, every equality above is also satisfied by a projection
    // that returns nothing and a renderer that emits null for both sides.
    const applications = fixture("60 mixed, boundary lengths, accented");
    const rendered = renderApplicationsSection(applications);
    const renderedProjected = renderApplicationsSection(wire(projectApplicationsForRequest(applications)));

    expect(typeof rendered).toBe("string");
    expect(rendered).toContain("--- USER'S APPLICATIONS ---");
    expect(rendered.match(/^Application \d+:$/gm)).toHaveLength(MAX_APPLICATIONS);
    expect(rendered).toContain("  Company: Company 000");
    expect(rendered).toContain("  Company: Company 024");
    expect(rendered).not.toContain("  Company: Company 025");
    expect(rendered.length).toBeGreaterThan(10_000);
    // ...and the projected side is the same object, not an empty one.
    expect(renderedProjected).toBe(rendered);

    // The truncated JD of a rendered application, including its ellipsis.
    const first = applications.find((a) => (a.jobDescription || "").length > MAX_JD_CHARS);
    expect(first).toBeDefined();
    expect(rendered).toContain(`  Job Description: ${first.jobDescription.slice(0, MAX_JD_CHARS)}…`);
  });

  it("[AC-7] a job description of exactly MAX_JD_CHARS renders WITHOUT an ellipsis, on both sides", () => {
    const jd = TEXT_KINDS.accented(MAX_JD_CHARS, MAX_JD_CHARS);
    const applications = wire([{ company: "Exactly Ltd", jobDescription: jd }]);
    const rendered = renderApplicationsSection(applications);
    expect(rendered).toContain(`  Job Description: ${jd}`);
    expect(rendered).not.toContain(`${jd}…`);
    expect(renderApplicationsSection(wire(projectApplicationsForRequest(applications)))).toBe(rendered);
  });

  it("[AC-20] zero applications render no section at all, on both sides", () => {
    expect(renderApplicationsSection([])).toBe(null);
    expect(renderApplicationsSection(projectApplicationsForRequest([]))).toBe(null);
    // PAIRED POSITIVE CONTROL: one application does render one.
    const one = renderApplicationsSection([{ company: "Acme" }]);
    expect(one).toContain("--- USER'S APPLICATIONS ---");
    expect(one).toContain("  Company: Acme");
  });

  it("[boundary] a TRUTHY NON-STRING job description renders an empty labelled line -- moved verbatim; the projection's deviation on this shape is named and accepted in applicationContext.js", () => {
    // `truncate` returns "" for a non-string, but the `if (app.jobDescription)`
    // guard above it only tests truthiness -- so a number or an object gets a
    // label with nothing after it. That is today's behaviour and this case
    // pins it, because the renderer moves VERBATIM and this is part of what
    // "verbatim" means.
    const applications = [{ company: "Northwind Analytics", jobDescription: 42, tailoredResume: { text: "x" } }];
    expect(renderApplicationsSection(applications)).toBe(
      "--- USER'S APPLICATIONS ---\nApplication 1:\n  Company: Northwind Analytics\n  Job Description: \n  Tailored Resume: ",
    );

    // WHAT IS DELIBERATELY NOT ASSERTED, and why: whether the PROJECTION is
    // lossless for this shape. It is not -- `boundSelected` returns null for
    // any non-string, so the projected side drops both lines and the block
    // differs. That deviation is SETTLED, not open: `applicationContext.js`
    // names it as a deliberate exception to the module's own losslessness law
    // and rules that bounding wins, because passing an arbitrarily large
    // non-string through unchanged would defeat the bound the module exists
    // to impose. This case pins only the RENDERER's half, which moved
    // verbatim; the shape is unreachable from the live data path (see the
    // KNOWN BLIND DIMENSION note above the corpus), so it is deliberately
    // absent from the corpus rather than turning L2 red for intended
    // behaviour.
    expect(typeof applications[0].jobDescription).not.toBe("string");
  });

  it("an application that renders to nothing but its header still produces a section", () => {
    // Today the section is pushed whenever the array is non-empty -- EVEN when
    // every entry renders as a bare "Application 1:". A guard like
    // `if (rendered.length === 0) return null`, or filtering empty entries,
    // changes the model's input on this fixture. Byte identity forbids it.
    const applications = wire([{}, { stages: [] }]);
    expect(renderApplicationsSection(applications)).toBe(
      "--- USER'S APPLICATIONS ---\nApplication 1:\n\nApplication 2:",
    );
    expect(renderApplicationsSection(projectApplicationsForRequest(applications))).toBe(
      renderApplicationsSection(applications),
    );
  });

  it("[boundary] a FALSY-BUT-PRESENT company renders no Company line -- `if (app.company)` is truthiness, not a presence check", () => {
    // applicationContext.js:201-204 names this guard as moved VERBATIM and
    // forbids hardening it to `app.company != null`, because that would
    // render a `  Company: ` line for `company: ""` where today nothing
    // renders. No corpus fixture ever sets a falsy-but-present company (real
    // data either has a string or omits/nulls the field), so this case pins
    // the guarantee directly.
    const applications = [{ company: "", role: "Analyst" }];
    expect(renderApplicationsSection(applications)).toBe(
      "--- USER'S APPLICATIONS ---\nApplication 1:\n  Role: Analyst",
    );
  });
});

// ---------------------------------------------------------------------------
// L3 -- the embedded assistant reads the same thing. AC-11..AC-14, AC-21.
// ---------------------------------------------------------------------------

const APPLICATIONS_ASK = "how many applications do I have?";
const INTERVIEW_ASK = "what should I prepare for my upcoming interviews?";

function replyFor(applications, content) {
  return localChatReply({ messages: [{ role: "user", content }], applications });
}

describe("[L3] the embedded assistant's reply is byte-identical under the projection", () => {
  it("localChatReply(project(A)) === localChatReply(A) for the applications and interview intents", () => {
    for (const { label, applications } of CORPUS) {
      const projected = wire(projectApplicationsForRequest(applications));
      expect(replyFor(projected, APPLICATIONS_ASK), `${label}: applications reply changed`).toBe(
        replyFor(applications, APPLICATIONS_ASK),
      );
      expect(replyFor(projected, INTERVIEW_ASK), `${label}: interview reply changed`).toBe(
        replyFor(applications, INTERVIEW_ASK),
      );
    }
  });

  it("[AC-12] the pipeline count is the TOTAL tracked, not MAX_APPLICATIONS", () => {
    const applications = fixture("60 mixed, ten times the cap");
    const projected = wire(projectApplicationsForRequest(applications));
    const reply = replyFor(projected, APPLICATIONS_ASK);
    // PAIRED POSITIVE CONTROL for the equality: the number is 60, and it is
    // not the 25 a "select fewer applications" bound would report.
    expect(reply).toContain("You're tracking 60 applications");
    expect(reply).not.toContain("tracking 25 applications");
    expect(reply).toBe(replyFor(applications, APPLICATIONS_ASK));
  });

  it("[AC-13] an interview scheduled on application 26 still reaches the reply", () => {
    // The fixture matters: BOTH embedded handlers render `upcoming.slice(0, 5)`
    // (localAssistant.js:171 and :226), so a fixture where five or more
    // EARLIER applications carry a scheduled stage excludes the index-25 entry
    // before AND after the projection and proves nothing. Only indices 0, 1, 2
    // and 25 carry one here, so four entries compete for five slots.
    const applications = wire(
      Array.from({ length: 30 }, (_, i) => ({
        company: `Company ${String(i).padStart(3, "0")}`,
        role: `Rôle ${i}`,
        status: "interviewing",
        appliedAt: "2026-01-04",
        applicationUrl: null,
        jobDescription: TEXT_KINDS.accented(MAX_JD_CHARS * 2, MAX_JD_CHARS),
        tailoredResume: TEXT_KINDS.resume(MAX_TAILORED_CHARS * 2, MAX_TAILORED_CHARS),
        stages: [0, 1, 2, 25].includes(i)
          ? [
              {
                name: "Onsite loop",
                type: "onsite",
                scheduledAt: `2026-05-${String(i + 1).padStart(2, "0")}T16:00:00Z`,
                outcome: "pending",
                interviewers: ["Dana Q."],
                notes: "Bring the design doc.",
              },
            ]
          : [],
      })),
    );
    const projected = wire(projectApplicationsForRequest(applications));
    const reply = replyFor(projected, INTERVIEW_ASK);

    expect(reply).toBe(replyFor(applications, INTERVIEW_ASK));
    // PAIRED POSITIVE CONTROL: all four scheduled interviews are named,
    // including the one on the application past the rendered slice.
    expect(reply).toContain("Company 000");
    expect(reply).toContain("Company 001");
    expect(reply).toContain("Company 002");
    expect(reply).toContain("Company 025");
  });

  it("[AC-14] the repeat 'applications' ask keeps its per-application breakdown and its …and N more tail", () => {
    const applications = fixture("60 mixed, boundary lengths, accented");
    const projected = wire(projectApplicationsForRequest(applications));
    const messages = [
      { role: "user", content: APPLICATIONS_ASK },
      { role: "assistant", content: "You're tracking 60 applications." },
      { role: "user", content: "list my applications" },
    ];
    const reply = localChatReply({ messages, applications: projected });

    expect(reply).toBe(localChatReply({ messages, applications }));
    expect(reply).toContain("Here's each one:");
    expect(reply).toContain("…and 50 more.");
    expect(reply).toContain("Company 000");
  });

  it("[AC-21] zero applications still say so", () => {
    const reply = replyFor(projectApplicationsForRequest([]), APPLICATIONS_ASK);
    // "contains", not "equals": at depth 0 the reply is wrapped by withOffer.
    expect(reply).toContain("You don't have any tracked applications yet");
    expect(reply).toBe(replyFor([], APPLICATIONS_ASK));
  });
});

// ---------------------------------------------------------------------------
// The primitives.
// ---------------------------------------------------------------------------

describe("truncate: the ellipsis boundary", () => {
  it("appends the ellipsis only ABOVE max, never at it", () => {
    const line = TEXT_KINDS.accented(MAX_JD_CHARS + 2, MAX_JD_CHARS);
    expect(truncate(line.slice(0, MAX_JD_CHARS - 1), MAX_JD_CHARS)).toBe(line.slice(0, MAX_JD_CHARS - 1));
    expect(truncate(line.slice(0, MAX_JD_CHARS), MAX_JD_CHARS)).toBe(line.slice(0, MAX_JD_CHARS));
    expect(truncate(line.slice(0, MAX_JD_CHARS + 1), MAX_JD_CHARS)).toBe(`${line.slice(0, MAX_JD_CHARS)}…`);
    expect(truncate(line.slice(0, MAX_JD_CHARS + 2), MAX_JD_CHARS)).toBe(`${line.slice(0, MAX_JD_CHARS)}…`);
  });

  it("is moved VERBATIM: no trim, no default max, non-strings become the empty string", () => {
    // Every near-miss helper surveyed in this tree differs in exactly one of
    // these. A "tidying" .trim() breaks byte identity for any posting that
    // ends in whitespace at the cut, which scraped postings routinely do.
    expect(truncate("   spaced   ", 100)).toBe("   spaced   ");
    expect(truncate(`${"a".repeat(10)}   `, 10)).toBe(`${"a".repeat(10)}…`);
    // The fixture above puts its whitespace AFTER the cut (slice(0, 10) is
    // all "a"s), where `trim()` could never reach it -- so it passes whether
    // or not `truncate` trims. This one puts the whitespace straddling the
    // cut so a trimming implementation is caught: `trim()`ing "aaaaaaa   "
    // (the first 10 code units) would yield "aaaaaaa…" instead.
    expect(truncate("aaaaaaa   bbb", 10)).toBe("aaaaaaa   …");
    expect(truncate(null, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
    expect(truncate(12345, 10)).toBe("");
  });

  it("counts UTF-16 code units, not UTF-8 bytes", () => {
    const jd = TEXT_KINDS.accented(MAX_JD_CHARS + 1, MAX_JD_CHARS);
    expect(new TextEncoder().encode(jd).length).toBeGreaterThan(jd.length);
    expect(truncate(jd, MAX_JD_CHARS)).toBe(`${jd.slice(0, MAX_JD_CHARS)}…`);
    expect(truncate(jd, MAX_JD_CHARS)).toHaveLength(MAX_JD_CHARS + 1);
  });
});

describe("projectApplicationsForRequest: the allowlist and the bound", () => {
  it("keeps every always-tier field for EVERY application, past the pick included", () => {
    const applications = fixture("60 mixed, ten times the cap");
    const projected = projectApplicationsForRequest(applications);

    expect(projected).toHaveLength(applications.length);
    for (let i = 0; i < applications.length; i += 1) {
      expect(projected[i].company, `application ${i}`).toBe(applications[i].company ?? null);
      expect(projected[i].role, `application ${i}`).toBe(applications[i].role ?? null);
      expect(projected[i].status, `application ${i}`).toBe(applications[i].status ?? null);
      expect(projected[i].appliedAt, `application ${i}`).toBe(applications[i].appliedAt ?? null);
      expect(projected[i].applicationUrl, `application ${i}`).toBe(applications[i].applicationUrl ?? null);
      expect(projected[i].stages.map((s) => s.scheduledAt), `application ${i}`).toEqual(
        (applications[i].stages || []).map((s) => s.scheduledAt ?? null),
      );
      expect(projected[i].stages.map((s) => s.outcome), `application ${i}`).toEqual(
        (applications[i].stages || []).map((s) => s.outcome ?? null),
      );
    }
  });

  it("bounds the selected tier to max + 1 code units, and nulls it past the pick", () => {
    const applications = fixture("60 mixed, ten times the cap");
    const projected = projectApplicationsForRequest(applications);

    // Inside the pick: bounded to max + 1, which is exactly what `truncate`
    // needs to still produce today's ellipsis. max would lose it.
    expect(projected[0].jobDescription).toBe(applications[0].jobDescription.slice(0, MAX_JD_CHARS + 1));
    expect(projected[0].jobDescription).toHaveLength(MAX_JD_CHARS + 1);
    expect(projected[0].tailoredResume).toHaveLength(MAX_TAILORED_CHARS + 1);
    expect(truncate(projected[0].jobDescription, MAX_JD_CHARS)).toBe(
      truncate(applications[0].jobDescription, MAX_JD_CHARS),
    );
    expect(projected[MAX_APPLICATIONS - 1].jobDescription).toHaveLength(MAX_JD_CHARS + 1);

    // Past the pick: nothing the renderer will ever read.
    expect(projected[MAX_APPLICATIONS].jobDescription).toBe(null);
    expect(projected[MAX_APPLICATIONS].tailoredResume).toBe(null);
    expect(projected[59].jobDescription).toBe(null);
    // ...but the application itself is STILL THERE, with its scheduling data.
    expect(projected[59].company).toBe(applications[59].company);
    expect(projected[59].stages).toEqual(
      (applications[59].stages || []).map((s) => ({
        name: s.name ?? null,
        type: s.type ?? null,
        scheduledAt: s.scheduledAt ?? null,
        outcome: s.outcome ?? null,
      })),
    );
  });

  it("drops stages[].interviewers and stages[].notes, which neither consumer reads", () => {
    const applications = fixture("3 mixed, boundary lengths, accented");
    const withStages = applications.find((a) => (a.stages || []).length > 0);
    expect(withStages, "the fixture must carry a stage or this asserts nothing").toBeDefined();
    expect(withStages.stages.some((s) => s.notes || (s.interviewers || []).length > 0)).toBe(true);

    const projected = projectApplicationsForRequest(applications);
    for (const app of projected) {
      for (const stage of app.stages) {
        expect(Object.keys(stage).sort()).toEqual(["name", "outcome", "scheduledAt", "type"]);
      }
    }
  });

  it("never throws, whatever it is handed", () => {
    expect(projectApplicationsForRequest(undefined)).toEqual([]);
    expect(projectApplicationsForRequest(null)).toEqual([]);
    expect(projectApplicationsForRequest("not an array")).toEqual([]);
    expect(projectApplicationsForRequest([null, undefined])).toHaveLength(2);
    expect(projectApplicationsForRequest([{ stages: "nope" }])[0].stages).toEqual([]);
    expect(projectApplicationsForRequest([{ stages: [null] }])[0].stages).toEqual([
      { name: null, type: null, scheduledAt: null, outcome: null },
    ]);
  });

  it("returns a NEW array of NEW objects, leaving the caller's applications untouched", () => {
    const applications = fixture("3 mixed, ten times the cap");
    const before = JSON.stringify(applications);
    const projected = projectApplicationsForRequest(applications);
    expect(projected[0]).not.toBe(applications[0]);
    expect(JSON.stringify(applications)).toBe(before);
  });
});

describe("selectRenderedApplications", () => {
  it("takes the first MAX_APPLICATIONS, by reference, in order", () => {
    const applications = fixture("60 mixed, varying JD lengths");
    const picked = selectRenderedApplications(applications);
    expect(picked).toHaveLength(MAX_APPLICATIONS);
    expect(picked[0]).toBe(applications[0]);
    expect(picked[MAX_APPLICATIONS - 1]).toBe(applications[MAX_APPLICATIONS - 1]);
  });

  it("tolerates junk", () => {
    expect(selectRenderedApplications(undefined)).toEqual([]);
    expect(selectRenderedApplications("nope")).toEqual([]);
    expect(selectRenderedApplications([])).toEqual([]);
  });
});
