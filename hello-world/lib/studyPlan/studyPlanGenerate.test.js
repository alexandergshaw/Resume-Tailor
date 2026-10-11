// N157 SC-gen (4b TDD seat) -- studyPlanGenerate.js, the orchestration.
// Binds docs/loop/N157.SC-gen.plan.r1.md step 2 + risk rows R2/R3/R6/R8/R9,
// and docs/loop/N157.arch.r2.md §2.3-§2.6 / ledger ARCH-N157-3/4/5/16.
//
// INSTRUMENT STANCE. This file does NOT mock studyPlanStore. It drives the
// REAL writeStudyPlan (and the REAL readStudyPlan for the removal-ac) against a
// small in-memory supabase double that reproduces the column-wise upsert on a
// 1:1 primary key. Everything the route would observe -- the persisted status,
// engine, plan and cached research -- is read back off that double, so these
// tests exercise the real persistence path, not a hand-mirrored spy.
// `generateContent` and `readDigest` ARE injected (the gemini transport and the
// digest reader), exactly as the generateStudyPlan signature specifies.
//
// WHAT THE DOUBLE CANNOT PROVE, said plainly: it does not enforce study_plans'
// NOT NULL status column or the ready_has_modules CHECK -- those are live-DB
// (owner-env, §4 of the plan). It proves the WRITE CARRIES a non-empty status
// on every branch (R3), which is the application-side half of that guard.
//
// RED ON HEAD: lib/studyPlan/studyPlanGenerate.js does not exist yet, so the
// import below throws at collection and every `it` reds -- the honest greenfield
// red. Satisfiability + every named mutant (index-key R2, no-status R3,
// ready-when-incomplete R8, tools-attached, persist-removed S11) were watched
// against a discarded scratchpad reference (recorded in the seat report).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateStudyPlan, parseGeneratedPlan } from "@/lib/studyPlan/studyPlanGenerate.js";
import { itemKey } from "@/lib/studyPlan/studyPlanSchema.js";
import { readStudyPlan } from "@/lib/studyPlan/studyPlanStore.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-sc-gen";
const COMPANY = "Acme Robotics";
const ROLE = "Senior Platform Engineer";
const FP = "fingerprint-xyz";

// ---- the in-memory supabase double (column-wise upsert, scoped read) --------
function makeSupabase() {
  const store = new Map(); // application_id -> row
  const client = {
    from() {
      return {
        // writeStudyPlan: .upsert(row,{onConflict}).select().maybeSingle()
        upsert(row) {
          const key = row.application_id;
          const merged = { ...(store.get(key) || {}), ...row }; // column-wise
          store.set(key, merged);
          return {
            select() {
              return { async maybeSingle() { return { data: merged, error: null }; } };
            },
          };
        },
        // readStudyPlan: .select(proj).eq("application_id",..).eq("user_id",..).maybeSingle()
        select() {
          const f = {};
          const chain = {
            eq(col, val) { f[col] = val; return chain; },
            async maybeSingle() {
              const row = store.get(f.application_id);
              if (row && row.user_id === f.user_id) return { data: row, error: null };
              return { data: null, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, store };
}

// ---- digests the injected readDigest returns --------------------------------
const SOURCED_DIGEST = {
  status: "ready",
  markdown: "## What Acme does\n\nBuilds warehouse robots.",
  researched_at: "2026-09-01T00:00:00.000Z",
  sources: [{ url: "https://www.reuters.com/business/acme" }],
};
// Ready digest whose sources all got filtered -> evidence present but NOT complete.
const UNSOURCED_DIGEST = { ...SOURCED_DIGEST, sources: [] };

const readDigestReturning = (row) => vi.fn(async () => row);

// ---- a model reply the gemini path parses -----------------------------------
function modelPlan(items) {
  return {
    text: JSON.stringify({
      modules: [{ title: "Module 1", topics: [{ title: "Topic 1", area: "systems", items }] }],
    }),
  };
}
const ITEM_A = { text: "Explain Raft consensus", topicHint: "distributed", kind: "new" };
const ITEM_B = { text: "Describe Acme's cold-storage depots", topicHint: "company", kind: "review" };
const ITEM_C = { text: "Kubernetes pod scheduling", topicHint: "infra", kind: "new" };

function baseArgs(over = {}) {
  const args = {
    applicationId: APP_ID,
    userId: USER_ID,
    company: COMPANY,
    role: ROLE,
    postingFingerprint: FP,
    knobs: { newReviewRatio: 0.5 },
    model: "gemini-2.5-flash",
    ...over,
  };
  // C-0 (PD-1 / ledger DES-N157-C10, authorized data-only addition). The route
  // now hands generateStudyPlan an injected `readExistingPlan` seam, and the
  // preserve-on-uncertainty guard treats an ABSENT seam as UNCONFIRMED and skips
  // the write. The landed fresh-store `unavailable` cases must therefore confirm
  // POSITIVE absence to keep writing, so -- unless a case supplies its own seam
  // (the `in` check lets the C-0 oracle inject an error/rejecting/undefined one)
  // -- mirror the route and bind it to the SAME in-memory double's readStudyPlan.
  // DATA ONLY: on HEAD generateStudyPlan ignores this arg and nothing changes;
  // on the C-0 build it is what lets a fresh store still persist its row.
  if (!("readExistingPlan" in args) && args.supabase) {
    const client = args.supabase;
    args.readExistingPlan = ({ applicationId, userId }) => readStudyPlan(client, { applicationId, userId });
  }
  return args;
}

let sb;
beforeEach(() => {
  sb = makeSupabase();
});

// ---------------------------------------------------------------------------
describe("parseGeneratedPlan is total -- it never throws (R9)", () => {
  it("accepts a JSON object reply (ok:true)", () => {
    const r = parseGeneratedPlan({ text: JSON.stringify({ modules: [] }) });
    expect(r.ok).toBe(true);
  });
  it("refuses non-JSON text (ok:false, no throw)", () => {
    expect(() => parseGeneratedPlan({ text: "not json at all {" })).not.toThrow();
    expect(parseGeneratedPlan({ text: "not json at all {" }).ok).toBe(false);
  });
  it("refuses a JSON array (not a plan object)", () => {
    expect(parseGeneratedPlan({ text: "[1,2,3]" }).ok).toBe(false);
  });
  it("refuses empty / missing text", () => {
    expect(parseGeneratedPlan({ text: "" }).ok).toBe(false);
    expect(parseGeneratedPlan({}).ok).toBe(false);
    expect(parseGeneratedPlan(null).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("item keys are CONTENT-derived, not array indices (R2 -- reorder canary)", () => {
  // Collect every written item's id, paired with the content it was built from.
  async function writtenItemMap(items) {
    const s = makeSupabase();
    const generateContent = vi.fn(async () => modelPlan(items));
    await generateStudyPlan(
      baseArgs({ supabase: s.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    const plan = s.store.get(APP_ID).plan;
    const map = new Map();
    for (const m of plan.modules) for (const t of m.topics) for (const it of t.items) map.set(it.text, it.id);
    return map;
  }

  it("gives each item the schema's content-derived itemKey, independent of position", async () => {
    const forward = await writtenItemMap([ITEM_A, ITEM_B, ITEM_C]);
    // Each id equals itemKey computed from its own content -- NOT a 0/1/2 index.
    expect(forward.get(ITEM_A.text)).toBe(itemKey(ITEM_A));
    expect(forward.get(ITEM_B.text)).toBe(itemKey(ITEM_B));
    expect(forward.get(ITEM_C.text)).toBe(itemKey(ITEM_C));
  });

  it("a REORDERED model reply yields the SAME id for the same content", async () => {
    // A mutant that pre-assigns array-index ids (String(i)) before normalizePlan
    // makes ITEM_A's id move from "0" to "1" on reorder -> red. Content keys do
    // not move, which is what keeps a resume cursor on the right card (R2).
    const forward = await writtenItemMap([ITEM_A, ITEM_B, ITEM_C]);
    const reordered = await writtenItemMap([ITEM_C, ITEM_A, ITEM_B]);
    for (const text of [ITEM_A.text, ITEM_B.text, ITEM_C.text]) {
      expect(reordered.get(text)).toBe(forward.get(text));
    }
  });
});

// ---------------------------------------------------------------------------
describe("the status decision table, and the write ALWAYS carries status (R3/R8/§2.6)", () => {
  const VALID = new Set(["ready", "partial", "unavailable"]);

  it("gemini + complete evidence + >=1 module => 'ready'", async () => {
    const generateContent = vi.fn(async () => modelPlan([ITEM_A, ITEM_B]));
    const out = await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    expect(out.status).toBe("ready");
    expect(sb.store.get(APP_ID).status).toBe("ready");
  });

  it("gemini + INCOMPLETE evidence + >=1 module => 'partial', never 'ready' (R8)", async () => {
    // A mutant that returns 'ready' when evidence.complete is false -- unsourced
    // presented as researched -- reds here. This is the silent S6 harm.
    const generateContent = vi.fn(async () => modelPlan([ITEM_A, ITEM_B]));
    const out = await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(UNSOURCED_DIGEST), generateContent }),
    );
    expect(out.status).toBe("partial");
    expect(sb.store.get(APP_ID).status).toBe("partial");
  });

  it("gemini + malformed reply => 'unavailable', and it still WRITES a status (R3/R9)", async () => {
    const generateContent = vi.fn(async () => ({ text: "garbage not json {" }));
    const out = await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    expect(out.status).toBe("unavailable");
    expect(sb.store.get(APP_ID).status).toBe("unavailable");
  });

  it("embedded + >=1 evidence item => 'partial'; embedded makes NO model call", async () => {
    const generateContent = vi.fn(async () => modelPlan([ITEM_A]));
    const out = await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "embedded", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    expect(generateContent).not.toHaveBeenCalled(); // deterministic, zero outbound (R6)
    expect(out.status).toBe("partial");
    const row = sb.store.get(APP_ID);
    expect(row.status).toBe("partial");
    expect(row.engine).toBe("embedded");
    expect(row.plan.modules.length).toBeGreaterThanOrEqual(1);
  });

  it("embedded + NO evidence => 'unavailable'", async () => {
    const out = await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "embedded", readDigest: readDigestReturning(null), generateContent: vi.fn() }),
    );
    expect(out.status).toBe("unavailable");
    expect(sb.store.get(APP_ID).status).toBe("unavailable");
  });

  it("writes a non-empty, valid status member on EVERY branch (R3 -- no-status mutant guard)", async () => {
    // A mutant that forgets `status` on one branch leaves writeStudyPlan dropping
    // it (studyPlanStore:141), so the stored row has no status -- caught here as
    // `undefined not in {ready,partial,unavailable}`. Covers all four rows.
    const branches = [
      ["gemini", SOURCED_DIGEST, modelPlan([ITEM_A])],
      ["gemini", UNSOURCED_DIGEST, modelPlan([ITEM_A])],
      ["gemini", SOURCED_DIGEST, { text: "garbage {" }],
      ["embedded", SOURCED_DIGEST, modelPlan([ITEM_A])],
      ["embedded", null, modelPlan([ITEM_A])],
    ];
    for (const [engine, digest, reply] of branches) {
      const s = makeSupabase();
      await generateStudyPlan(
        baseArgs({ supabase: s.client, engine, readDigest: readDigestReturning(digest), generateContent: vi.fn(async () => reply) }),
      );
      const status = s.store.get(APP_ID)?.status;
      expect(VALID.has(status), `engine=${engine} digest=${!!digest}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the gemini transport is NON-grounded (R4 at the unit boundary)", () => {
  it("calls generateContent exactly once with NO tools/googleSearch, JSON mime, call-level timeout", async () => {
    // Belt to the wire test's braces: a mutant attaching tools (top-level OR in
    // config) reds here at the params layer, and the wire test reds on the bytes.
    const generateContent = vi.fn(async () => modelPlan([ITEM_A]));
    await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    expect(generateContent).toHaveBeenCalledTimes(1);
    const arg = generateContent.mock.calls[0][0];
    expect(arg.tools).toBeUndefined();
    expect(arg.config).toBeDefined();
    expect(arg.config.tools).toBeUndefined();
    expect(arg.config.googleSearch).toBeUndefined();
    expect(arg.config.responseMimeType).toBe("application/json");
    expect(typeof arg.config.httpOptions.timeout).toBe("number");
  });

  it("a model rejection becomes status 'unavailable' -- generateStudyPlan never throws (R9)", async () => {
    const generateContent = vi.fn(async () => { throw new Error("model timed out"); });
    let out;
    await expect(
      (async () => {
        out = await generateStudyPlan(
          baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
        );
      })(),
    ).resolves.toBeUndefined();
    expect(out.status).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
describe("cached research is carried onto the write for SC-D knob-only rebuilds (§5 OPEN)", () => {
  it("passes cachedResearch = the EvidenceSet and researchedAt = evidence.researchedAt", async () => {
    const generateContent = vi.fn(async () => modelPlan([ITEM_A]));
    await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    const row = sb.store.get(APP_ID);
    // The whole EvidenceSet is cached, and recency is copied from the digest.
    expect(row.cached_research).toBeTruthy();
    expect(row.cached_research.researchedAt).toBe(SOURCED_DIGEST.researched_at);
    expect(row.cached_research.items[0].text).toBe(SOURCED_DIGEST.markdown);
    expect(row.researched_at).toBe(SOURCED_DIGEST.researched_at);
    expect(row.posting_fingerprint).toBe(FP);
  });
});

// ---------------------------------------------------------------------------
describe("persistence is non-decorative -- the REMOVAL ac (S11 / ARCH-N157-16)", () => {
  it("after generate, readStudyPlan returns the persisted plan", async () => {
    // A variant with the writeStudyPlan call removed leaves this read empty
    // (status null, plan with zero modules). Proving the mechanism writes, not
    // just computes, is the in-app advantage the removal ac exists to pin; the
    // persist-removed mutant is watched red in the seat report.
    const generateContent = vi.fn(async () => modelPlan([ITEM_A, ITEM_B]));
    await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    const record = await readStudyPlan(sb.client, { applicationId: APP_ID, userId: USER_ID });
    expect(record.status).toBe("ready");
    expect(record.plan.modules.length).toBeGreaterThanOrEqual(1);
    expect(record.engine).toBeTruthy();
  });

  it("the persisted plan is scoped to the owner -- a different user reads nothing", async () => {
    const generateContent = vi.fn(async () => modelPlan([ITEM_A]));
    await generateStudyPlan(
      baseArgs({ supabase: sb.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent }),
    );
    const other = await readStudyPlan(sb.client, { applicationId: APP_ID, userId: "someone-else" });
    expect(other.status).toBe(null);
    expect(other.plan).toBe(null);
  });
});

// ===========================================================================
// C-0: the SERVER preserve-last-good guard (PD-1, design r2 section 4.3).
//
// This AMENDS a specified SC-gen behaviour: generateStudyPlan today ALWAYS
// writes, even an empty `unavailable` plan over a good one (the file header's
// "A failed attempt still writes its row"). The guard makes a COMPUTED
// `unavailable` consult an injected `readExistingPlan` seam and PRESERVE ON
// UNCERTAINTY -- it writes only when the read POSITIVELY confirms there is no
// good plan to protect (`error === null` AND no ready/partial plan with >= 1
// module). A read ERROR, a REJECTING/throwing seam, or an ABSENT seam is
// UNCONFIRMED and SKIPS the write. A ready/partial result never consults the
// read and always writes.
//
// SEAM SIGNATURE the implementer builds against (a NEW injected arg on
// generateStudyPlan, beside readDigest and generateContent):
//   readExistingPlan: ({ applicationId, userId }) => Promise<{ status, plan, error }>
// -- the shape readStudyPlan returns. The route passes it explicitly as
//   (args) => readStudyPlan(supabase, args).
// The skip returns { status:"unavailable", plan, evidence, written:false,
//   preserved:true, preservedReason, error }; every other result carries
//   preserved:false.
//
// INSTRUMENT. These tests drive the REAL writeStudyPlan against a store double
// whose `.upsert` is a vi.fn SPY, so "the write was withheld" is read off the
// spy's call count AND off the seeded row still being byte-identical (same
// object reference), never off a hand-mirrored flag. Where an oracle needs a
// read ERROR or a REJECTING seam -- which the never-throwing in-memory double
// cannot produce -- readExistingPlan is injected directly, exactly as the route
// injects it.
//
// RED ON HEAD, by row. HEAD has no guard and no `preserved` field.
//   * O2-O6, O11 red because HEAD CALLS upsert -- the destructive write the
//     guard must withhold -- and the seeded good row is replaced.
//   * O1, O7, O8 red because HEAD omits `preserved` (there is no field to equal
//     false); their write-direction assertions pass on HEAD and are the control
//     against a guard that over-fires (O1), blocks an idempotent rewrite (O7),
//     or consults the read on the success branch (O8).
// The no-op control is the unmodified source. Section 4.3 mutants M1 (treat a
// read error as absence -> reds O4/O5/O6/O11), M2 (always write -> reds O2-O5),
// M3 (consult the read on the success branch -> reds O8) and M5 (report a
// skipped write as written:true -> reds O2) each red a row here; M4 is the route
// mutant, exercised in app/api/study-plan/route.test.js.
// ===========================================================================
describe("C-0 preserve-last-good guard: PRESERVE ON UNCERTAINTY (section 4.3, O1-O8/O11)", () => {
  // A store double whose upsert is a spy and whose read reproduces the
  // column-wise, owner-scoped select readStudyPlan issues.
  function makeGuardStore(seedRow = null) {
    const store = new Map();
    if (seedRow) store.set(seedRow.application_id, seedRow);
    const upsert = vi.fn((row) => {
      const key = row.application_id;
      const merged = { ...(store.get(key) || {}), ...row };
      store.set(key, merged);
      return { select: () => ({ async maybeSingle() { return { data: merged, error: null }; } }) };
    });
    const client = {
      from() {
        return {
          upsert,
          select() {
            const f = {};
            const chain = {
              eq(col, val) { f[col] = val; return chain; },
              async maybeSingle() {
                const row = store.get(f.application_id);
                if (row && row.user_id === f.user_id) return { data: row, error: null };
                return { data: null, error: null };
              },
            };
            return chain;
          },
        };
      },
    };
    return { client, store, upsert };
  }

  // A genuine normalized plan with >= 1 module, produced by the real pipeline so
  // readStudyPlan + hasGoodPlan classify it exactly as production would.
  async function aGoodPlan() {
    const s = makeSupabase();
    await generateStudyPlan(
      baseArgs({ supabase: s.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST), generateContent: vi.fn(async () => modelPlan([ITEM_A, ITEM_B])) }),
    );
    const plan = s.store.get(APP_ID).plan;
    if (!plan || plan.modules.length < 1) throw new Error("test setup: aGoodPlan produced no modules");
    return plan;
  }

  const seededGoodRow = (plan, status) => ({
    application_id: APP_ID, user_id: USER_ID, status, plan, engine: "gemini", marker: "ORIGINAL",
  });

  // Args that COMPUTE "unavailable" (gemini, unparseable reply -> zero modules),
  // independent of whatever is stored -- generate recomputes from scratch.
  function computesUnavailable(over) {
    return baseArgs({
      engine: "gemini",
      readDigest: readDigestReturning(SOURCED_DIGEST),
      generateContent: vi.fn(async () => ({ text: "not a plan {" })),
      ...over,
    });
  }

  it("O1 (fresh-unavailable canary): a fresh store + computed unavailable still WRITES -- the guard must not wedge a legitimate first unavailable", async () => {
    // baseArgs binds readExistingPlan to this EMPTY store -> a POSITIVE absence.
    // A guard that over-fires (skips even on confirmed absence) reds the
    // upsert-called assertion. RED on HEAD via preserved:false (no field yet).
    const g = makeGuardStore();
    const out = await generateStudyPlan(computesUnavailable({ supabase: g.client }));
    expect(out.status).toBe("unavailable");
    expect(g.upsert).toHaveBeenCalledTimes(1);
    expect(g.store.get(APP_ID).status).toBe("unavailable");
    expect(out.written).toBe(true);
    expect(out.preserved).toBe(false);
  });

  it("O2: a stored READY plan (>= 1 module) + computed unavailable -> NO write, row byte-identical, preserved 'good-plan'", async () => {
    const plan = await aGoodPlan();
    const seed = seededGoodRow(plan, "ready");
    const g = makeGuardStore(seed);
    const out = await generateStudyPlan(computesUnavailable({
      supabase: g.client,
      readExistingPlan: ({ applicationId, userId }) => readStudyPlan(g.client, { applicationId, userId }),
    }));
    expect(out.status).toBe("unavailable");
    expect(g.upsert).not.toHaveBeenCalled();            // RED on HEAD (HEAD overwrites)
    expect(g.store.get(APP_ID)).toBe(seed);             // same reference, untouched
    expect(g.store.get(APP_ID).marker).toBe("ORIGINAL");
    expect(out.written).toBe(false);                    // M5 (report written:true) reds this
    expect(out.preserved).toBe(true);
    expect(out.preservedReason).toBe("good-plan");
  });

  it("O3: a stored PARTIAL plan (>= 1 module) is protected the same as ready", async () => {
    const plan = await aGoodPlan();
    const seed = seededGoodRow(plan, "partial");
    const g = makeGuardStore(seed);
    const out = await generateStudyPlan(computesUnavailable({
      supabase: g.client,
      readExistingPlan: ({ applicationId, userId }) => readStudyPlan(g.client, { applicationId, userId }),
    }));
    expect(g.upsert).not.toHaveBeenCalled();
    expect(g.store.get(APP_ID)).toBe(seed);
    expect(out.preserved).toBe(true);
    expect(out.preservedReason).toBe("good-plan");
  });

  it("O4 (preserve-on-uncertainty canary): a good plan + a TRANSIENT READ ERROR -> NO write, the plan survives, preserved 'unconfirmed'", async () => {
    // readStudyPlan NEVER throws: on a PostgREST blip it returns
    // { status:null, plan:null, error:"<msg>" }. r1's guard read that as "no
    // good plan" and clobbered the plan (F-1, the MAJOR). The guard must PRESERVE
    // here. Mutant M1 (treat a read error as absence) reds this exact row.
    const plan = await aGoodPlan();
    const seed = seededGoodRow(plan, "ready");
    const g = makeGuardStore(seed);
    const out = await generateStudyPlan(computesUnavailable({
      supabase: g.client,
      readExistingPlan: async () => ({ status: null, plan: null, error: "ETIMEDOUT reading study_plans" }),
    }));
    expect(out.status).toBe("unavailable");
    expect(g.upsert).not.toHaveBeenCalled();            // RED on HEAD and under M1
    expect(g.store.get(APP_ID)).toBe(seed);             // the good plan survives the blip
    expect(out.preserved).toBe(true);
    expect(out.preservedReason).toBe("unconfirmed");
  });

  it("O5: a REJECTING / throwing read seam -> NO write, preserved 'unconfirmed' (generateStudyPlan still does not throw)", async () => {
    const plan = await aGoodPlan();
    const seed = seededGoodRow(plan, "ready");
    const g = makeGuardStore(seed);
    let out;
    await expect(
      (async () => {
        out = await generateStudyPlan(computesUnavailable({
          supabase: g.client,
          readExistingPlan: async () => { throw new Error("read rejected"); },
        }));
      })(),
    ).resolves.toBeUndefined();
    expect(out.status).toBe("unavailable");
    expect(g.upsert).not.toHaveBeenCalled();            // RED on HEAD and under M1
    expect(g.store.get(APP_ID)).toBe(seed);
    expect(out.preserved).toBe(true);
    expect(out.preservedReason).toBe("unconfirmed");
  });

  it("O6: a FRESH store + a read error -> fail CLOSED (NO write); status is still 'unavailable'", async () => {
    // Nothing to protect, but the read could not confirm that, so the guard
    // still withholds the write. The cost (the unavailable row is not persisted)
    // is accepted in 4.3; the route reports unavailable anyway (route O-fresh).
    const g = makeGuardStore();
    const out = await generateStudyPlan(computesUnavailable({
      supabase: g.client,
      readExistingPlan: async () => ({ status: null, plan: null, error: "blip" }),
    }));
    expect(out.status).toBe("unavailable");
    expect(g.upsert).not.toHaveBeenCalled();            // RED on HEAD and under M1
    expect(out.preserved).toBe(true);
    expect(out.preservedReason).toBe("unconfirmed");
  });

  it("O7: a stored UNAVAILABLE / zero-module row is NOT a good plan -> write PROCEEDS (idempotent)", async () => {
    // Positive control for the skip: a mutant that treats ANY existing row as
    // "good" would block this write; the upsert-called assertion reds it.
    const seed = { application_id: APP_ID, user_id: USER_ID, status: "unavailable", plan: { modules: [] } };
    const g = makeGuardStore(seed);
    const out = await generateStudyPlan(computesUnavailable({
      supabase: g.client,
      readExistingPlan: ({ applicationId, userId }) => readStudyPlan(g.client, { applicationId, userId }),
    }));
    expect(out.status).toBe("unavailable");
    expect(g.upsert).toHaveBeenCalledTimes(1);          // write not blocked
    expect(out.written).toBe(true);
    expect(out.preserved).toBe(false);                  // RED on HEAD (no field)
  });

  it("O8: a READY result NEVER consults the read seam -> seam spy has zero calls, write proceeds, preserved:false", async () => {
    // Mutant M3 (consult the read on the success branch) makes readSpy fire ->
    // reds here. On a ready path the guard is never entered, so a successful
    // rebuild pays no extra read. RED on HEAD via preserved:false.
    const g = makeGuardStore();
    const readSpy = vi.fn(async () => ({ status: "ready", plan: { modules: [{ title: "x", topics: [{ title: "t", items: [] }] }] }, error: null }));
    const out = await generateStudyPlan(baseArgs({
      supabase: g.client, engine: "gemini", readDigest: readDigestReturning(SOURCED_DIGEST),
      generateContent: vi.fn(async () => modelPlan([ITEM_A, ITEM_B])), readExistingPlan: readSpy,
    }));
    expect(out.status).toBe("ready");
    expect(readSpy).not.toHaveBeenCalled();
    expect(g.upsert).toHaveBeenCalledTimes(1);
    expect(out.preserved).toBe(false);
  });

  it("O11: an ABSENT readExistingPlan seam is itself UNCONFIRMED -> NO write (fail closed), preserved 'unconfirmed'", async () => {
    // The key is present with an `undefined` value, so baseArgs does NOT bind a
    // default -- generateStudyPlan sees no seam. Mutant M1/M5-style rejection of
    // "absent = unconfirmed" and HEAD's always-write both red the upsert check.
    const plan = await aGoodPlan();
    const seed = seededGoodRow(plan, "ready");
    const g = makeGuardStore(seed);
    const out = await generateStudyPlan(computesUnavailable({
      supabase: g.client,
      readExistingPlan: undefined,
    }));
    expect(out.status).toBe("unavailable");
    expect(g.upsert).not.toHaveBeenCalled();            // RED on HEAD
    expect(g.store.get(APP_ID)).toBe(seed);
    expect(out.preserved).toBe(true);
    expect(out.preservedReason).toBe("unconfirmed");
  });
});
