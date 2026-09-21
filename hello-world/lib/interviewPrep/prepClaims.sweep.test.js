// ---------------------------------------------------------------------------
// R-N45-CLAIMS -- the INV-CLAIM-1 gate, and the single-writer premise it
// depends on. AC-CLAIM.6 / AC-CLAIM.7 / AC-CLAIM.8, plan ledger line P12.
//
// The gate only means anything if there is exactly ONE place a pack document
// is written. A second writer elsewhere in the tree -- a "quick fix" that
// updates `pack` directly rather than going through writePrepPackResult --
// would leave the gate in place, green, and completely bypassed. The census
// below is what makes that premise checkable instead of assumed.
//
// ---------------------------------------------------------------------------
// INSTRUMENT I1 (plan §6.3): a TABLE-SCOPED `.from(X).update(` census.
// ---------------------------------------------------------------------------
// The repo has the sweep SHAPE twice already but no table-scoped instance.
// Built on the shared lib/sourceScan/tokenizeSource.js, never a fifth private
// comment-stripper fork -- exportReachability.sweep.test.js's own header
// records that an earlier fork "was silently wrong and under-reported real
// sites with no error at all", and under-reporting for a sweep means
// reporting CLEAN.
//
// The table is named through a module constant (`PACKS_TABLE`), never the
// literal, at the one site that exists today -- so a census that matched only
// the literal string would find ZERO sites and pass "=== 1" by being off by
// one in the wrong direction, or pass "=== 0" vacuously. Constant resolution
// is therefore part of the instrument, and it has its own canary.
//
// HONEST BOUND ON WHAT THIS CENSUS CAN SEE: a writer that reaches the table
// through a dynamically-computed name (`supabase.from(tableFor(kind))`) is
// invisible to it. No such shape exists in this tree today (every `.from(` in
// app/ and lib/ takes a literal or a module constant); the census asserts the
// count it CAN see, and that bound is stated here rather than left implied.

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tokenizeSource } from "@/lib/sourceScan/tokenizeSource.js";
import { writePrepPackResult } from "./prepStore.js";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));
const PACKS_TABLE_NAME = "interview_prep_packs";
const PREP_STORE_PATH = path.join(ROOT, "lib", "interviewPrep", "prepStore.js");

/** Every production `.js` under app/ and lib/ -- never a `.test.js`, never
 *  this file. The same universe convention the two existing sweeps use. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js") && path.resolve(full) !== SELF_PATH) out.push(full);
  }
  return out;
}

/** `const NAME = "interview_prep_packs";` -- the module constants a `.from(`
 *  may name instead of the literal. Without this the census is blind to the
 *  only real writer in the tree. */
function tableAliases(readable) {
  const aliases = new Set([`"${PACKS_TABLE_NAME}"`, `'${PACKS_TABLE_NAME}'`, `\`${PACKS_TABLE_NAME}\``]);
  const re = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=\\s*["'\`]${PACKS_TABLE_NAME}["'\`]`, "g");
  let m;
  while ((m = re.exec(readable))) aliases.add(m[1]);
  return aliases;
}

/** The chain text following a `.from(` call, up to the statement's own
 *  terminating `;` at depth zero. */
function chainAfter(readable, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < readable.length; i += 1) {
    const ch = readable[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === ";" && depth <= 0) return readable.slice(openIdx, i);
  }
  return readable.slice(openIdx);
}

/** Every `.from(<packs table>)` chain in one source, with the verbs it uses. */
function packsChains(readable) {
  const aliases = tableAliases(readable);
  const chains = [];
  const re = /\.from\s*\(/g;
  let m;
  while ((m = re.exec(readable))) {
    const openIdx = readable.indexOf("(", m.index);
    let depth = 0;
    let close = openIdx;
    for (; close < readable.length; close += 1) {
      if (readable[close] === "(") depth += 1;
      else if (readable[close] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const argument = readable.slice(openIdx + 1, close).trim();
    if (!aliases.has(argument)) continue;
    const chain = chainAfter(readable, close);
    chains.push({ argument, chain, line: readable.slice(0, m.index).split("\n").length });
  }
  return chains;
}

// Memoized: the walk plus tokenize over app/ + lib/ costs over a second, and
// this sweep is called from two tests. A whole-tree scan re-run per test is
// exactly the shape that goes flaky under full-suite load in this repo (the
// N23 timeout cluster), so it runs once.
let cachedSites = null;

function packsUpdateSites() {
  if (cachedSites) return cachedSites;
  const files = walk(path.join(ROOT, "app")).concat(walk(path.join(ROOT, "lib")));
  const sites = [];
  for (const full of files) {
    const source = readFileSync(full, "utf8");
    // Cheap pre-filter, and the reason it is SOUND: a file that never spells
    // the table's name cannot name it in a `.from(` -- the alias resolution
    // below reads a `const NAME = "interview_prep_packs"` declaration in the
    // SAME file, which is itself an occurrence of the string. A cross-module
    // alias is outside what this census can see either way, and that bound is
    // stated in this file's header. Without the pre-filter this tokenizes all
    // ~1100 files in app/ + lib/ twice over and joins the N23 timeout flake
    // cluster under full-suite load -- measured: it did, in the reference run.
    if (!source.includes(PACKS_TABLE_NAME)) continue;
    const { readable } = tokenizeSource(source, { label: path.basename(full) });
    for (const chain of packsChains(readable)) {
      if (/\.update\s*\(/.test(chain.chain)) {
        sites.push(`${path.relative(ROOT, full).split(path.sep).join("/")}:${chain.line}`);
      }
    }
  }
  cachedSites = sites;
  return sites;
}

describe("[canaries] the table-scoped census is alive before any count is asserted", () => {
  it("resolves a module constant to the table, not only the string literal", () => {
    const fixture = 'const PACKS_TABLE = "interview_prep_packs";\nawait supabase.from(PACKS_TABLE).update({ a: 1 }).eq("id", x);';
    const { readable } = tokenizeSource(fixture);
    expect(tableAliases(readable).has("PACKS_TABLE")).toBe(true);
    expect(packsChains(readable)).toHaveLength(1);
  });

  it("[canary] finds a NON-EMPTY set of real writer sites in the tree -- today's positive control", () => {
    // Asserted BEFORE the "=== 1" below. A dead extractor finds zero sites,
    // and "=== 0" would then look like a clean tree rather than a broken
    // instrument. MUTATION KILL for this instrument: delete prepStore.js's
    // only `.update(` in a scratch copy and this canary goes 1 -> 0.
    expect(packsUpdateSites().length).toBeGreaterThan(0);
  });

  it("[canary] a chain against a DIFFERENT prep table is not counted", () => {
    const fixture = 'await supabase.from("interview_prep_events").update({ a: 1 }).eq("id", x);';
    expect(packsChains(tokenizeSource(fixture).readable)).toHaveLength(0);
  });

  it("[canary] a packs-table chain that only READS is not counted as a writer", () => {
    const fixture = 'await supabase.from("interview_prep_packs").select("status, pack").eq("id", x);';
    const chains = packsChains(tokenizeSource(fixture).readable);
    expect(chains).toHaveLength(1);
    expect(/\.update\s*\(/.test(chains[0].chain)).toBe(false);
  });

  it("[canary] a COMMENT describing a packs update contributes nothing", () => {
    const fixture = '// await supabase.from("interview_prep_packs").update({ pack });\nconst x = 1;';
    expect(packsChains(tokenizeSource(fixture).readable)).toHaveLength(0);
  });
});

describe("AC-CLAIM.6 -- interview_prep_packs has exactly one writer in the whole tree", () => {
  it("[HEAD-GREEN, disclosed -- its value is as a control on the NEXT diff] the single `.update(` site is prepStore.js's", () => {
    // DISCLOSED: this passes on HEAD today, because only one writer exists at
    // all. It is NOT coverage of anything N45 adds. Its job starts the moment
    // the section path, the restore path and the prune path land, each of
    // which is a natural place for a second writer to appear -- and a second
    // writer is what makes writePrepPackResult's INV-CLAIM-1 gate bypassable
    // without the gate ever looking broken.
    const sites = packsUpdateSites();
    expect(sites, `expected exactly one writer, found: ${sites.join(", ")}`).toHaveLength(1);
    expect(sites[0]).toMatch(/^lib\/interviewPrep\/prepStore\.js:/);
  });
});

// ---------------------------------------------------------------------------
// AC-CLAIM.7 -- the gate call precedes the write, inside one function body.
// ---------------------------------------------------------------------------

/** writePrepPackResult's own source text, brace-matched from its declaration
 *  to its closing `}`. Scoped to the function so a `claimOwnershipViolations(`
 *  sitting anywhere ELSE in the module cannot satisfy the ordering below. */
function writePrepPackResultBody() {
  const { readable } = tokenizeSource(readFileSync(PREP_STORE_PATH, "utf8"), { label: "prepStore.js" });
  const start = readable.indexOf("export async function writePrepPackResult");
  if (start < 0) throw new Error("writePrepPackResult's declaration was not found in prepStore.js");
  const firstBrace = readable.indexOf("{", readable.indexOf(")", start));
  let depth = 0;
  for (let i = firstBrace; i < readable.length; i += 1) {
    if (readable[i] === "{") depth += 1;
    else if (readable[i] === "}") {
      depth -= 1;
      if (depth === 0) return readable.slice(firstBrace, i + 1);
    }
  }
  throw new Error("writePrepPackResult's body did not close");
}

describe("AC-CLAIM.7 -- claimOwnershipViolations( runs BEFORE .update( inside writePrepPackResult", () => {
  it("[canary] the body extractor really isolates that function's own text", () => {
    // Positive control: checkPackByteBudget( is called inside this body today
    // and .update( is in it, while deletePrepPackContent's own `.delete(` is
    // NOT -- so the slice is the function, not the file.
    const body = writePrepPackResultBody();
    expect(body).toContain("checkPackByteBudget(");
    expect(body).toContain(".update(");
    expect(body).not.toContain("deletePrepPackContent");
  });

  it("[RED on HEAD: claimOwnershipViolations( appears nowhere in prepStore.js] the gate is called, and it is called first", () => {
    const body = writePrepPackResultBody();
    const gateIdx = body.indexOf("claimOwnershipViolations(");
    const updateIdx = body.indexOf(".update(");
    expect(gateIdx, "writePrepPackResult does not call claimOwnershipViolations at all").toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeLessThan(updateIdx);
  });
});

// ---------------------------------------------------------------------------
// AC-CLAIM.8 -- the BEHAVIOURAL half. A source-text ordering assertion cannot
// tell a gate that is called from a gate that is called and ignored.
// ---------------------------------------------------------------------------

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const LEASE_TOKEN = "33333333-3333-3333-3333-333333333333";

function crossOwnerPack() {
  // askThem's support names a claim id OWNED BY aboutYou. Everything else
  // about this pack is valid: it is within the byte budget, its claims are an
  // array, all four sections are complete. The ONLY thing wrong with it is
  // ownership, so nothing except the gate can refuse it.
  const foreign = "c/aboutYou/0123456789abcdef";
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: [{ text: "I ship reliable systems.", support: null }] } },
      whyRole: { answer: { lines: [{ text: "This role matches my background.", support: null }] } },
      askThem: {
        questions: [{ text: "How did the Berlin office change the roadmap?", support: { kind: "claim", claimId: foreign } }],
      },
      stages: { stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }] },
    },
    claims: [{ id: foreign, text: "Acme opened a Berlin office.", sourceUrl: "https://acme.example/news" }],
  };
}

function ownedPack() {
  const own = "c/askThem/0123456789abcdef";
  const pack = crossOwnerPack();
  pack.sections.askThem.questions[0].support.claimId = own;
  pack.claims[0].id = own;
  return pack;
}

function packsClient() {
  return makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
}

describe("AC-CLAIM.8 -- a cross-owner pack is REFUSED by writePrepPackResult, and the corrected one writes", () => {
  it("[RED on HEAD: the gate does not exist, so the cross-owner pack writes happily] the refusal half", () => {
    // MUTATION DISCIPLINE (plan §6.4): once the gate lands, commenting out
    // the claimOwnershipViolations call must make THIS assertion fail. If it
    // does not, the test is not exercising the gate and is rewritten -- never
    // counted as a kill.
    const sb = packsClient();
    return writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      pack: crossOwnerPack(),
      postingFingerprint: "fp-1",
    }).then((result) => {
      expect(result.written).toBe(false);
      expect(result.reason).toBe("error");
      // `?? []` because a write refused BEFORE any statement never calls
      // `.from()` at all, so the recorder has no entry for the table -- which
      // is itself the property being asserted, more strongly than a
      // zero-length array would be.
      expect(sb.calls.interview_prep_packs?.update ?? [], "a refused write must issue no UPDATE").toHaveLength(0);
    });
  });

  it("[no-op control -- HEAD-GREEN] the IDENTICAL pack with that one id corrected writes successfully", async () => {
    // Without this, `writePrepPackResult = async () => ({written:false})`
    // satisfies the refusal above. This is the assertion that says the gate
    // refuses the bad pack and only the bad pack.
    const sb = packsClient();
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      pack: ownedPack(),
      postingFingerprint: "fp-1",
    });
    expect(result.written).toBe(true);
    expect(sb.calls.interview_prep_packs.update).toHaveLength(1);
  });

  it("[no-op control -- HEAD-GREEN] a LEGACY unowned id still writes, so the gate cannot brick every pre-N45 pack", async () => {
    const legacy = ownedPack();
    legacy.sections.askThem.questions[0].support.claimId = "claim-7";
    legacy.claims[0].id = "claim-7";
    const sb = packsClient();
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      pack: legacy,
      postingFingerprint: "fp-1",
    });
    expect(result.written).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NOT TESTED HERE, AND WHY -- plan §S6's "both-or-neither" rule.
//
// The rule itself is sound: the stored `pack` IS the projection of
// `live_revisions`, so a write that moves one without the other leaves the
// two permanently disagreeing, silently, with the row still looking
// well-formed. But an assertion that `{pack}` without `{liveRevisions}` is
// refused CANNOT go green without amending assertions in a landed file this
// seat does not own. Measured: finishAttempt.test.js drives the REAL
// writePrepPackResult through makeSupabase at three call sites that pass
// `pack` and no `liveRevisions` -- its "DEFAULT deps" block (status "ready"),
// its "partial" pass-through, and its stale-token case -- and each asserts
// `written: true` / one UPDATE issued. Enforcing both-or-neither turns all
// three red.
//
// Landing a red here would hand the implementer a test whose only route to
// green runs through another seat's landed assertions. That is reported as a
// finding for step S6 instead: S6 must thread `liveRevisions` into those
// three payloads in the same step it adds the rule, with a stated why -- an
// EXTENSION of the fixtures, never a deleted assertion.
// ---------------------------------------------------------------------------

describe("[instrument self-check] vi is wired, so a failure here is the tree's, not the harness's", () => {
  it("makeSupabase records the UPDATE it is given", async () => {
    const sb = packsClient();
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
      reason: "provider-error",
    });
    expect(vi.isMockFunction(sb.from)).toBe(true);
    expect(sb.calls.interview_prep_packs.update).toHaveLength(1);
  });
});
