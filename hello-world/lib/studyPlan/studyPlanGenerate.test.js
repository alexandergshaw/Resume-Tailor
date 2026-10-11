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
  return {
    applicationId: APP_ID,
    userId: USER_ID,
    company: COMPANY,
    role: ROLE,
    postingFingerprint: FP,
    knobs: { newReviewRatio: 0.5 },
    model: "gemini-2.5-flash",
    ...over,
  };
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
