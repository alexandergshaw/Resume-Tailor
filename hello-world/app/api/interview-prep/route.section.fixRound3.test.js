// ---------------------------------------------------------------------------
// Fix round 3 (verify.r4.md, against 5104701): F-M5 (a legacy pack whose
// claims repeat a free-form id is wiped by its first section regeneration),
// F-M6/F-M3 (a claims:[] seeded row, or a partial pointer left by an
// earlier bug, still loses content on a later failure), and F-m3 widened
// (an oversized seeded section blocks a DIFFERENT section's own
// regeneration and wastes a model call doing it).
//
// A SEPARATE file from route.section.test.js -- not a scope choice, a line-
// budget one: that file is already 834 lines, and this round's fixtures
// (four scenarios, each with its own pack shape) would have pushed it over
// the 1000-line cap. The harness below is the SAME shape route.section.
// test.js documents at its own header: the real POST/GET/PATCH handlers
// against test/helpers/supabaseFake.js's stateful in-memory PostgREST, with
// claim_prep_pack_slot REPLAYED statement for statement (including
// `pack = '{}'::jsonb`) so every byte-identity assertion below means what it
// says.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({ listDigests: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { listDigests } from "@/lib/supabase/applicationDigests";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { normalizePack } from "@/lib/interviewPrep/prepParse.js";
import { claimOwnershipViolations } from "@/lib/interviewPrep/prepClaims.js";
import { sectionRevisionIsIntact } from "@/lib/interviewPrep/prepMerge.js";
import { POST, GET, PATCH } from "./route.js";

const APP_ID = "app-section-fix3";
const REVISIONS_TABLE = "interview_prep_section_revisions";
const EVENTS_TABLE = "interview_prep_events";
const PACKS_TABLE = "interview_prep_packs";
const SECTION_NAMES = ["aboutYou", "whyRole", "askThem", "stages"];
const POSITION = {
  id: "pos-section-fix3",
  title: "Engineer",
  company: "Acme Robotics",
  description: "Build things for the fleet.",
};

const BODIES = {
  aboutYou: { answer: { lines: [{ text: "I have shipped payment rails end to end.", support: null }] } },
  whyRole: { answer: { lines: [{ text: "This role matches my background in payments.", support: null }] } },
  askThem: { questions: [{ text: "How is this team's work measured?", support: null }] },
  stages: {
    stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }],
  },
};

const NEW_QUESTION = "What does the first quarter look like for this team?";

/** The model's one-section reply, as JSON text. */
function sectionReply(section, content, claims = []) {
  return JSON.stringify({ section, content, claims });
}

// claim_prep_pack_slot, replayed statement for statement from
// supabase/migrations/20260922000000_interview_prep_remove_spend_caps.sql:86-102
// -- the same replay route.section.test.js documents at its own header.
function applyClaimSlot(sb, { applicationId, userId, leaseToken, leaseUntil }) {
  const rows = sb.rows(PACKS_TABLE);
  const row = rows.find((r) => r.application_id === applicationId && r.user_id === userId);
  const nowIso = new Date().toISOString();
  if (!row) {
    rows.push({
      id: `pack-${applicationId}`,
      application_id: applicationId,
      user_id: userId,
      status: "running",
      lease_until: leaseUntil,
      lease_token: leaseToken,
      pack: {},
      live_revisions: {},
      researched_at: null,
      reason: null,
      updated_at: nowIso,
    });
    sb.seed(PACKS_TABLE, rows);
    return true;
  }
  const reclaimable = row.status !== "running" || (row.lease_until != null && row.lease_until < nowIso);
  if (!reclaimable) return false;
  row.status = "running";
  row.lease_until = leaseUntil;
  row.lease_token = leaseToken;
  row.pack = {};
  row.researched_at = null;
  row.reason = null;
  row.updated_at = nowIso;
  sb.seed(PACKS_TABLE, rows);
  return true;
}

let userCounter = 0;

/** A tree seeded exactly as the caller supplies -- every scenario below
 *  needs its own pack/pointer/revision-row shape rather than one shared
 *  default fixture. */
function seedCustomTree({ pack, liveRevisions = {}, revisions = [], status = "ready", tag = "fix3" }) {
  userCounter += 1;
  const userId = `user-section-${tag}-${userCounter}`;
  const revRows = revisions.map((r, i) => ({
    id: `rev-${r.section}-${r.revision}`,
    application_id: APP_ID,
    user_id: userId,
    content_version: 1,
    restored_from: null,
    created_at: `2026-09-0${(i % 9) + 1}T00:00:00.000Z`,
    ...r,
  }));
  const sb = makeStatefulSupabase(
    {
      applications: [{ id: APP_ID, user_id: userId, position_id: POSITION.id }],
      positions: [POSITION],
      candidate_identity: [],
      application_trusted_names: [],
      [PACKS_TABLE]: [
        {
          id: `pack-${APP_ID}`,
          application_id: APP_ID,
          user_id: userId,
          status,
          lease_token: null,
          lease_until: null,
          pack,
          live_revisions: liveRevisions,
          researched_at: "2026-09-01T00:00:00.000Z",
          reason: null,
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      [REVISIONS_TABLE]: revRows,
      [EVENTS_TABLE]: [],
    },
    {
      user: { id: userId },
      relationships: { "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" } },
    },
  );
  sb.rpc = vi.fn(async (fn, args) => {
    sb.calls.push({ table: null, verb: "rpc", fn, args });
    if (fn === "claim_prep_pack_slot") {
      return {
        data: applyClaimSlot(sb, {
          applicationId: args.p_application_id,
          userId,
          leaseToken: args.p_lease_token,
          leaseUntil: args.p_lease_until,
        }),
        error: null,
      };
    }
    if (fn === "record_prep_model_call") return { data: true, error: null };
    throw new Error(`[route.section fix round 3] unmodelled rpc "${fn}"`);
  });
  return { sb, userId };
}

function postRequest(body) {
  return new Request("http://localhost/api/interview-prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: APP_ID, ...body }),
  });
}

async function post(sb, body) {
  createClient.mockResolvedValue(sb);
  const res = await POST(postRequest(body));
  return { res, body: await res.json() };
}

async function readBack(sb) {
  createClient.mockResolvedValue(sb);
  const res = await GET(new Request(`http://localhost/api/interview-prep?applicationId=${APP_ID}`, { method: "GET" }));
  return await res.json();
}

async function patch(sb, body) {
  createClient.mockResolvedValue(sb);
  const res = await PATCH(
    new Request("http://localhost/api/interview-prep", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: APP_ID, ...body }),
    }),
  );
  return { res, body: await res.json() };
}

function replyingGemini(text) {
  const generateContent = vi.fn().mockResolvedValue({ text });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

function rejectingGemini() {
  const generateContent = vi.fn().mockRejectedValue(new Error("upstream exploded"));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

let cryptoSpy;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  listDigests.mockResolvedValue({
    digests: { [APP_ID]: { application_id: APP_ID, status: "ready" } },
    error: null,
  });
  cryptoSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("lease-section-fix3-fixed");
});

afterEach(() => {
  cryptoSpy.mockRestore();
  vi.unstubAllEnvs();
});

/** A legacy pack: aboutYou and whyRole each carry ONE cited, free-form
 *  (pre-N45) legacy claim id; askThem/stages are the ordinary uncited
 *  fixture. The Maria Lopez line is the one every scenario below checks
 *  survives. */
function legacyPackWithClaims() {
  return normalizePack(
    {
      version: 1,
      sections: {
        aboutYou: {
          answer: {
            lines: [{ text: "Maria Lopez leads the platform team.", support: { kind: "claim", claimId: "legacy-name" } }],
          },
        },
        whyRole: {
          answer: {
            lines: [
              { text: "This role matches my background in payments.", support: { kind: "claim", claimId: "legacy-role" } },
            ],
          },
        },
        askThem: BODIES.askThem,
        stages: BODIES.stages,
      },
      claims: [
        { id: "legacy-name", text: "Maria Lopez leads the platform team.", sourceUrl: "https://acme.example/team" },
        { id: "legacy-role", text: "The posting emphasizes payments experience.", sourceUrl: "https://acme.example/jobs" },
      ],
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// F-M5 -- a legacy duplicate free-form claim id must not wipe the pack.
// Ruling: normalize legacy duplicates before any write; a refusal after the
// claim must still restore the pack.
// ---------------------------------------------------------------------------

describe("F-M5 (fix round) -- a legacy pack whose claims repeat a free-form id is not wiped by its first regeneration", () => {
  function legacyPackWithDuplicateId() {
    return normalizePack(
      {
        version: 1,
        sections: {
          aboutYou: {
            answer: {
              lines: [{ text: "Maria Lopez leads the platform team.", support: { kind: "claim", claimId: "legacy-name" } }],
            },
          },
          whyRole: BODIES.whyRole,
          askThem: BODIES.askThem,
          stages: BODIES.stages,
        },
        claims: [
          { id: "legacy-name", text: "Maria Lopez leads the platform team.", sourceUrl: "https://acme.example/team" },
          // The duplicate: SAME id, a second entry -- pre-N45's free-form
          // model schema (route.js's old whole-pack prompt) never
          // guaranteed uniqueness on a model-chosen id.
          {
            id: "legacy-name",
            text: "Maria Lopez leads the platform team (duplicate).",
            sourceUrl: "https://acme.example/team2",
          },
        ],
      },
      [],
    );
  }

  it("a section regeneration on a legacy pack with a duplicate free-form claim id succeeds -- no write gate refuses it", async () => {
    const pack = legacyPackWithDuplicateId();
    const { sb } = seedCustomTree({ pack, tag: "m5dup" });
    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));

    const { res, body } = await post(sb, { section: "askThem" });
    expect(res.status, `a legacy duplicate id refused the write: ${JSON.stringify(body)}`).toBe(200);
    expect(body.sectionProduced).toBe(true);

    const packRow = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(packRow.status, "the row was left stuck mid-attempt instead of completing").not.toBe("running");

    const after = await readBack(sb);
    const line = after.pack.sections.aboutYou.answer.lines[0];
    expect(line.text).toContain("Maria Lopez");
    expect(line.support, "the cited line lost its citation").not.toBeNull();
    expect(claimOwnershipViolations(after.pack)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-M6/F-M3 -- restorePayload repairs a missing or degraded revision source.
// Ruling (option b): fall back to the live pack's own content and claims,
// re-minted, instead of the degraded revision.
// ---------------------------------------------------------------------------

describe("F-M6/F-M3 (fix round) -- restorePayload repairs a missing or degraded revision source from the live pack", () => {
  it("a claims:[] seeded row (the 88adbca shape) is rebuilt from the live pack, and the Maria Lopez line survives cited", async () => {
    const pack = legacyPackWithClaims();
    const revisions = SECTION_NAMES.map((s) => ({
      section: s,
      revision: 1,
      content: pack.sections[s],
      claims: [],
      engine: "gemini",
    }));
    const { sb } = seedCustomTree({
      pack,
      liveRevisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
      revisions,
      tag: "m6",
    });

    rejectingGemini();
    await post(sb, { section: "askThem" });

    const after = await readBack(sb);
    const aboutYouLine = after.pack.sections.aboutYou.answer.lines[0];
    expect(aboutYouLine.text).toContain("Maria Lopez");
    expect(aboutYouLine.support, "a claims:[] seeded revision row destroyed the citation on restore").not.toBeNull();
    const whyRoleLine = after.pack.sections.whyRole.answer.lines[0];
    expect(whyRoleLine.support, "whyRole's citation was lost through the same degraded row").not.toBeNull();
    expect(claimOwnershipViolations(after.pack)).toEqual([]);
  });

  it("a partial pointer (the ff59a97 shape), PATCHed and then followed by a failed attempt, still restores every section", async () => {
    const pack = legacyPackWithClaims();
    const revisions = [{ section: "askThem", revision: 1, content: pack.sections.askThem, claims: [], engine: "gemini" }];
    const { sb } = seedCustomTree({ pack, liveRevisions: { askThem: 1 }, revisions, tag: "m3" });

    const patchResult = await patch(sb, { section: "askThem", revision: 1 });
    expect(patchResult.res.status, `the PATCH restore was refused: ${JSON.stringify(patchResult.body)}`).toBe(200);

    rejectingGemini();
    await post(sb, { section: "whyRole" });

    const after = await readBack(sb);
    const aboutYouLine = after.pack.sections.aboutYou.answer.lines[0];
    expect(aboutYouLine.text).toContain("Maria Lopez");
    expect(aboutYouLine.support, "aboutYou was destroyed even though only askThem's pointer was ever partial").not.toBeNull();
    const whyRoleLine = after.pack.sections.whyRole.answer.lines[0];
    expect(whyRoleLine.support, "whyRole's citation was lost after a partial-pointer PATCH and a failed attempt").not.toBeNull();
    expect(claimOwnershipViolations(after.pack)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-m3 (widened) -- an oversized SEEDED section must not block regenerating
// a different, requested section, and must never cost a model call finding
// that out.
// ---------------------------------------------------------------------------

describe("F-m3 (fix round, widened) -- an oversized seeded section no longer blocks regenerating a DIFFERENT section", () => {
  function legacyPackWithOversizedAboutYou() {
    const pack = legacyPackWithClaims();
    const lines = pack.sections.aboutYou.answer.lines.slice();
    const claims = pack.claims.slice();
    for (let i = 0; i < 120; i += 1) {
      const id = `legacy-big-${i}`;
      lines.push({
        text: `I delivered project number ${i} for the ledger org ${"x".repeat(150)}.`,
        support: { kind: "claim", claimId: id },
      });
      claims.push({ id, text: `Acme project ${i} is described publicly ${"y".repeat(200)}.`, sourceUrl: `https://acme.example/p/${i}` });
    }
    return normalizePack({ ...pack, sections: { ...pack.sections, aboutYou: { answer: { lines } } }, claims }, []);
  }

  it("a legacy aboutYou whose content+claims exceed the revision byte cap no longer blocks a POST regenerating askThem", async () => {
    const pack = legacyPackWithOversizedAboutYou();
    const { sb } = seedCustomTree({ pack, tag: "m3size" });
    const generateContent = replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));

    const { res, body } = await post(sb, { section: "askThem" });
    expect(res.status, `an oversized OTHER section still blocked the requested one: ${JSON.stringify(body)}`).toBe(200);
    expect(body.sectionProduced).toBe(true);
    expect(generateContent, "the model was called more than once for a single section regeneration").toHaveBeenCalledTimes(1);

    const after = await readBack(sb);
    expect(
      after.pack.sections.aboutYou.answer.lines[0].text,
      "the oversized section's own content was lost, not merely left unseeded",
    ).toContain("Maria Lopez");
  });
});

// ---------------------------------------------------------------------------
// Class ruling (fix round) -- PATCH no longer repairs a degraded revision at
// all. Repairing on PATCH (F-M7's own fix) had produced findings three
// rounds running (F-M9/F-M10/F-m12), so the repair itself -- never merely
// one bug in it -- is gone: `sectionRevisionIsIntact` (prepMerge.js) decides
// safe-as-is vs refuse, and a refusal (409, F-m11's body shape below) never
// appends a revision row or touches the pack. These tests close F-M9, F-M10
// and F-m12 by construction: a refused PATCH leaves the revisions table and
// the pack byte-identical, row count included, not merely line texts equal.
// ---------------------------------------------------------------------------

describe("F-M7/F-M9/F-M10/F-m12 (fix round, class ruling) -- a degraded PATCH target is refused before any write, never repaired", () => {
  it("a claims:[] degraded row (the 88adbca shape) is refused with the F-m11 body shape, and the pack row + revisions table stay byte-identical", async () => {
    const pack = legacyPackWithClaims();
    const revisions = SECTION_NAMES.map((s) => ({ section: s, revision: 1, content: pack.sections[s], claims: [], engine: "gemini" }));
    const { sb } = seedCustomTree({
      pack,
      liveRevisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
      revisions,
      tag: "m7refuse",
    });
    // The live pack still carries the SAME "legacy-name" claim revision 1's
    // own content cites -- a shape the OLD repair path could have used to
    // succeed. The class ruling refuses anyway: PATCH no longer looks at the
    // live pack's claims pool at all.
    const packRowBefore = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    const revisionsBefore = sb.rows(REVISIONS_TABLE);

    const patchResult = await patch(sb, { section: "aboutYou", revision: 1 });
    expect(patchResult.res.status, `a degraded revision was not refused: ${JSON.stringify(patchResult.body)}`).toBe(409);
    expect(patchResult.body).toEqual({
      error: "This older version lost its sources and can't be restored. Regenerate the section instead.",
      status: "unrestorable",
      reason: "revision-degraded",
    });

    const packRowAfter = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(packRowAfter, "a refused PATCH must not change the pack row at all").toEqual(packRowBefore);

    const revisionsAfter = sb.rows(REVISIONS_TABLE);
    expect(revisionsAfter.length, "a refused PATCH must not append a revision row (F-M9)").toBe(revisionsBefore.length);
    expect(revisionsAfter, "a refused PATCH must not change any existing revision row either").toEqual(revisionsBefore);
  });

  it("clicking a refused PATCH twice never grows the revisions table -- no phantom history entries (F-M9)", async () => {
    const pack = legacyPackWithClaims();
    const revisions = SECTION_NAMES.map((s) => ({ section: s, revision: 1, content: pack.sections[s], claims: [], engine: "gemini" }));
    const { sb } = seedCustomTree({
      pack,
      liveRevisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
      revisions,
      tag: "m9repeat",
    });
    const countBefore = sb.rows(REVISIONS_TABLE).length;

    await patch(sb, { section: "aboutYou", revision: 1 });
    const second = await patch(sb, { section: "aboutYou", revision: 1 });
    expect(second.res.status, `the second refused click was not a 409: ${JSON.stringify(second.body)}`).toBe(409);

    expect(sb.rows(REVISIONS_TABLE).length, "a repeat click on a refused PATCH must never grow the table").toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// F-M8 (fix round, verify.r5.md MAJOR) -- the fallback's own engine must
// never grant the embedded-template exemption to content it did not itself
// confirm came from the embedded template.
// ---------------------------------------------------------------------------

describe("F-M8 (fix round) -- the restore fallback's engine never leaks the embedded-template exemption onto model-written content", () => {
  function legacyPackWithOversizedAboutYou() {
    const pack = legacyPackWithClaims();
    const lines = pack.sections.aboutYou.answer.lines.slice();
    const claims = pack.claims.slice();
    for (let i = 0; i < 120; i += 1) {
      const id = `legacy-big-${i}`;
      lines.push({
        text: `I delivered project number ${i} for the ledger org ${"x".repeat(150)}.`,
        support: { kind: "claim", claimId: id },
      });
      claims.push({ id, text: `Acme project ${i} is described publicly ${"y".repeat(200)}.`, sourceUrl: `https://acme.example/p/${i}` });
    }
    return normalizePack({ ...pack, sections: { ...pack.sections, aboutYou: { answer: { lines } } }, claims }, []);
  }

  it("an oversized gemini aboutYou left unseeded, with the other three regenerated on the EMBEDDED engine, then a failed attempt -- no templateOrigin", async () => {
    const pack = legacyPackWithOversizedAboutYou();
    const { sb } = seedCustomTree({ pack, tag: "m8embed" });

    for (const section of ["askThem", "whyRole", "stages"]) {
      const embeddedResult = await post(sb, { section, engine: "embedded" });
      expect(embeddedResult.res.status, `embedded regeneration of ${section} failed: ${JSON.stringify(embeddedResult.body)}`).toBe(200);
    }

    rejectingGemini();
    await post(sb, { section: "askThem" });

    const row = sb.row(PACKS_TABLE, (x) => x.application_id === APP_ID);
    expect(
      row.pack.templateOrigin,
      "the fallback's own engine granted the embedded-template exemption to model-written aboutYou content",
    ).toBeUndefined();

    const after = await readBack(sb);
    expect(after.pack.sections.aboutYou.answer.lines[0].text).toContain("Maria Lopez");
  });
});

// ---------------------------------------------------------------------------
// F-m7 (fix round, verify.r5.md MINOR) -- the fallback's carry of the
// section's already-owned claims from a PRIOR restore, not only newly-minted
// ones, matters from the SECOND restore of a degraded row onwards.
// ---------------------------------------------------------------------------

describe("F-m7 (fix round) -- a SECOND restore of a degraded row carries forward the FIRST restore's own minted claim", () => {
  it("two consecutive failures keep the aboutYou citation on the SAME, previously-minted claim, not just newly-minted ones", async () => {
    const pack = legacyPackWithClaims();
    const revisions = SECTION_NAMES.map((s) => ({ section: s, revision: 1, content: pack.sections[s], claims: [], engine: "gemini" }));
    const { sb } = seedCustomTree({
      pack,
      liveRevisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
      revisions,
      tag: "m7carry",
    });

    rejectingGemini();
    await post(sb, { section: "askThem" });
    const first = await readBack(sb);
    const firstLine = first.pack.sections.aboutYou.answer.lines[0];
    expect(firstLine.text).toContain("Maria Lopez");
    expect(firstLine.support, "the FIRST restore lost the citation").not.toBeNull();

    rejectingGemini();
    await post(sb, { section: "whyRole" });
    const second = await readBack(sb);
    const secondLine = second.pack.sections.aboutYou.answer.lines[0];
    expect(secondLine.text).toContain("Maria Lopez");
    expect(secondLine.support, "the SECOND restore dropped the already-minted citation").not.toBeNull();
    const claimIds = new Set((second.pack.claims || []).map((c) => c.id));
    expect(
      claimIds.has(secondLine.support.claimId),
      "the second restore's fallback carried only newly-minted claims, dropping the section's own already-owned one",
    ).toBe(true);
    expect(claimOwnershipViolations(second.pack)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-m8 (fix round, verify.r5.md MINOR) -- sectionProduced must not lie about
// a retried failure: a CHECK-safe fallback retry ends with `status: "failed"`
// even though the response is HTTP 200, and the section it names was never
// actually produced.
// ---------------------------------------------------------------------------

describe("F-m8 (fix round) -- sectionProduced must not report true for a retried failure", () => {
  it("an INV-CLAIM-1 refusal on the success write answers sectionProduced:false with status:'failed' -- never a real success's shape", async () => {
    const id = "c/aboutYou/0123456789abcdef";
    const content = {
      answer: { lines: [{ text: "Maria Lopez leads the platform team.", support: { kind: "claim", claimId: id } }] },
    };
    const claimEntry = { id, text: "Maria Lopez leads the platform team.", sourceUrl: "https://acme.example/team" };
    // A genuine OWNED duplicate: two claims entries sharing the SAME
    // `c/aboutYou/...` id -- the ONLY way INV-CLAIM-1's gate refuses a write
    // that otherwise passed every upstream check.
    const pack = {
      version: 1,
      sections: { aboutYou: content, whyRole: BODIES.whyRole, askThem: BODIES.askThem, stages: BODIES.stages },
      claims: [claimEntry, { ...claimEntry }],
    };
    const revisions = [
      { section: "aboutYou", revision: 1, content, claims: [claimEntry], engine: "gemini" },
      { section: "whyRole", revision: 1, content: BODIES.whyRole, claims: [], engine: "gemini" },
      { section: "askThem", revision: 1, content: BODIES.askThem, claims: [], engine: "gemini" },
      { section: "stages", revision: 1, content: BODIES.stages, claims: [], engine: "gemini" },
    ];
    const { sb } = seedCustomTree({
      pack,
      liveRevisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
      revisions,
      tag: "m8owndup",
    });
    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));

    const { res, body } = await post(sb, { section: "askThem" });

    const row = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(row.status, `the write's own ownership violation was not reflected in the pack's status: ${row.error}`).toBe("failed");
    expect(res.status).toBe(200);
    expect(body.status).toBe("failed");
    expect(
      body.sectionProduced,
      "a retried CHECK-violation failure reported sectionProduced:true, indistinguishable from a real success",
    ).toBe(false);

    const after = await readBack(sb);
    expect(after.pack.sections.askThem.questions.map((q) => q.text)).not.toContain(NEW_QUESTION);
  });

  it("[no-op control] an ordinary successful section regeneration still reports sectionProduced:true with status:'ready'", async () => {
    const { sb } = seedCustomTree({ pack: legacyPackWithClaims(), tag: "m8ok" });
    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));

    const { res, body } = await post(sb, { section: "askThem" });
    expect(res.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.sectionProduced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-m9 (fix round, verify.r6.md MINOR) -- the embedded engine's own success
// site told the SAME lie F-m8 fixed on the model path: `Boolean(section)`
// reported sectionProduced:true even for a check-violation retry whose
// status is really "failed". Both sites now share sectionSucceeded.
// ---------------------------------------------------------------------------

describe("F-m9 (fix round) -- sectionProduced must not report true for a retried failure on the EMBEDDED engine either", () => {
  it("an INV-CLAIM-1 refusal on an embedded success write answers sectionProduced:false with status:'failed'", async () => {
    const id = "c/aboutYou/0123456789abcdef";
    const content = {
      answer: { lines: [{ text: "Maria Lopez leads the platform team.", support: { kind: "claim", claimId: id } }] },
    };
    const claimEntry = { id, text: "Maria Lopez leads the platform team.", sourceUrl: "https://acme.example/team" };
    // The SAME genuine owned duplicate F-m8's model-path test uses -- the
    // only way INV-CLAIM-1's write-time gate refuses an otherwise-clean
    // write, regardless of which engine produced the section itself.
    const pack = {
      version: 1,
      sections: { aboutYou: content, whyRole: BODIES.whyRole, askThem: BODIES.askThem, stages: BODIES.stages },
      claims: [claimEntry, { ...claimEntry }],
    };
    const revisions = [
      { section: "aboutYou", revision: 1, content, claims: [claimEntry], engine: "gemini" },
      { section: "whyRole", revision: 1, content: BODIES.whyRole, claims: [], engine: "gemini" },
      { section: "askThem", revision: 1, content: BODIES.askThem, claims: [], engine: "gemini" },
      { section: "stages", revision: 1, content: BODIES.stages, claims: [], engine: "gemini" },
    ];
    const { sb } = seedCustomTree({
      pack,
      liveRevisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
      revisions,
      tag: "m9owndup",
    });

    const { res, body } = await post(sb, { section: "askThem", engine: "embedded" });

    const row = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(row.status, `the write's own ownership violation was not reflected in the pack's status: ${row.error}`).toBe("failed");
    expect(res.status).toBe(200);
    expect(body.status).toBe("failed");
    expect(
      body.sectionProduced,
      "the embedded engine's own success site reported sectionProduced:true for a retried CHECK-violation failure",
    ).toBe(false);
  });

  it("[no-op control] an ordinary successful embedded section regeneration still reports sectionProduced:true", async () => {
    const { sb } = seedCustomTree({ pack: legacyPackWithClaims(), tag: "m9ok" });

    const { res, body } = await post(sb, { section: "askThem", engine: "embedded" });
    expect(res.status).toBe(200);
    expect(body.sectionProduced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-m10 (fix round, verify.r6.md MINOR) -- Mm8-readyOnly (`status ===
// "ready"`) survived 742/742: sectionProduced:true was pinned only for a
// READY pack. A legacy pack thinner than four sections legitimately ends
// "partial" after a regeneration, and must be reported as produced too.
// ---------------------------------------------------------------------------

describe("F-m10 (fix round) -- sectionProduced:true must hold on a partial pack too, not only a ready one", () => {
  it("regenerating a section on a legacy pack that stays partial (2 of 4 complete before, 3 after) still reports sectionProduced:true", async () => {
    const pack = normalizePack(
      {
        version: 1,
        sections: {
          aboutYou: BODIES.aboutYou,
          whyRole: BODIES.whyRole,
          askThem: { questions: [] },
          stages: { stages: [] },
        },
        claims: [],
      },
      [],
    );
    const { sb } = seedCustomTree({ pack, tag: "m10partial" });
    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));

    const { res, body } = await post(sb, { section: "askThem" });
    expect(res.status, `partial-pack regeneration was refused: ${JSON.stringify(body)}`).toBe(200);
    expect(body.status, "the pack should stay partial -- stages is still empty").toBe("partial");
    expect(
      body.sectionProduced,
      "a partial pack's own successful section regeneration must still report sectionProduced:true -- this is what kills the status==='ready' mutant",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-M11 (fix round, verify.r7.md MAJOR) -- the class ruling's one surviving
// PATCH success path (restoring an INTACT revision) had no landed test that
// the target actually cites a claim. This is that positive twin: an OLDER
// revision whose own content cites its own, section-owned claim restores
// with the citation intact end to end -- resolving in pack.claims, clean
// ownership, and an appended history row that is itself intact.
// ---------------------------------------------------------------------------

describe("F-M11 (fix round) -- PATCH restores an OLDER revision that cites its own claim, citation intact end to end", () => {
  const CLAIM_ID = "c/aboutYou/89ab0123ef4567cd";
  const CLAIM_ENTRY = { id: CLAIM_ID, text: "Maria Lopez leads the platform team.", sourceUrl: "https://acme.example/team" };
  const CITED_CONTENT = {
    answer: { lines: [{ text: "Maria Lopez leads the platform team.", support: { kind: "claim", claimId: CLAIM_ID } }] },
  };
  const LIVE_CONTENT = { answer: { lines: [{ text: "The current, uncited answer.", support: null }] } };

  it("PATCH rev1 (cited, intact) returns 200, the citation resolves in pack.claims, ownership is clean, and the appended row is intact", async () => {
    const pack = normalizePack(
      {
        version: 1,
        sections: { aboutYou: LIVE_CONTENT, whyRole: BODIES.whyRole, askThem: BODIES.askThem, stages: BODIES.stages },
        claims: [],
      },
      [],
    );
    const revisions = [
      { section: "aboutYou", revision: 1, content: CITED_CONTENT, claims: [CLAIM_ENTRY], engine: "gemini" },
      { section: "aboutYou", revision: 2, content: LIVE_CONTENT, claims: [], engine: "gemini" },
    ];
    const { sb } = seedCustomTree({ pack, liveRevisions: { aboutYou: 2 }, revisions, tag: "m11pos" });

    const patchResult = await patch(sb, { section: "aboutYou", revision: 1 });
    expect(patchResult.res.status, `a cited, intact older revision was refused: ${JSON.stringify(patchResult.body)}`).toBe(200);
    expect(patchResult.body).toEqual({ status: "restored" });

    const after = await readBack(sb);
    const line = after.pack.sections.aboutYou.answer.lines[0];
    expect(line.text).toContain("Maria Lopez");
    expect(line.support, "the restored citation was dropped").not.toBeNull();
    const resolved = (after.pack.claims || []).find((c) => c.id === line.support.claimId);
    expect(resolved?.sourceUrl, "the restored citation does not resolve in pack.claims").toBe("https://acme.example/team");
    expect(claimOwnershipViolations(after.pack)).toEqual([]);

    const appended = sb.rows(REVISIONS_TABLE).find((r) => r.section === "aboutYou" && r.revision === 3);
    expect(appended.restored_from, "the appended row does not record what it was restored from").toBe(1);
    expect(sectionRevisionIsIntact("aboutYou", appended), "the appended history row is not itself intact").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-B1 (fix round r10, BLOCKER) -- readLiveSectionRevisions' round-two read
// used to swallow a failure instead of reporting it, so GATE 8b's own
// refusal ("a failed base read is a terminal refusal, never an empty base")
// never fired for the half of the read that carries content. Executed on the
// blanked-pack shape the code itself documents: `pack = '{}'`, pointer
// populated, status terminal (not "running") -- the state a crashed
// predecessor's `claim_prep_pack_slot` leaves, which the NEXT attempt is
// supposed to rebuild from.
// ---------------------------------------------------------------------------

describe("F-B1 (fix round r10, BLOCKER) -- a round-two read failure refuses the POST before any write, never writes an empty document", () => {
  const CLAIM_ENTRY = { id: "legacy-name", text: "Maria Lopez leads the platform team.", sourceUrl: "https://acme.example/team" };
  const CITED_CONTENT = { answer: { lines: [{ text: "Maria Lopez leads the platform team.", support: { kind: "claim", claimId: "legacy-name" } }] } };

  // A `.maybeSingle()` read whose own statement carries a `revision` eq
  // filter is round two's own targeted body read -- never round one's narrow
  // scan (no `revision` filter) and never the packs row's own read (a
  // different table).
  function failTargetedRevisionReads(sb) {
    const realFrom = sb.from;
    sb.from = vi.fn((table) => {
      const builder = realFrom(table);
      if (table !== REVISIONS_TABLE) return builder;
      let targeted = false;
      const realEq = builder.eq;
      builder.eq = vi.fn((column, value) => {
        if (column === "revision") targeted = true;
        return realEq(column, value);
      });
      const realMaybeSingle = builder.maybeSingle;
      builder.maybeSingle = vi.fn(() => {
        if (targeted) return Promise.resolve({ data: null, error: { message: "connection reset" } });
        return realMaybeSingle();
      });
      return builder;
    });
  }

  it("refuses the POST (500) and leaves the packs row byte-identical when round two's own body read fails", async () => {
    const revisions = [{ section: "aboutYou", revision: 1, content: CITED_CONTENT, claims: [CLAIM_ENTRY], engine: "gemini" }];
    const { sb } = seedCustomTree({ pack: {}, liveRevisions: { aboutYou: 1 }, revisions, status: "failed", tag: "b1" });
    failTargetedRevisionReads(sb);
    const before = JSON.stringify(sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID));

    rejectingGemini();
    const { res, body } = await post(sb, {});

    expect(res.status, `a round-two read failure did not refuse the POST: ${JSON.stringify(body)}`).toBe(500);
    const after = JSON.stringify(sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID));
    expect(after, "the packs row was written to even though the base read failed -- claim_prep_pack_slot must never have run").toBe(before);
  });

  it("[no-op control] the SAME blanked-pack fixture, with round two healthy, restores the Maria Lopez line on the SAME failure path", async () => {
    // Proves the 500 above is caused by the read failure, not by anything
    // else about this fixture: without the injected failure, the identical
    // shape already restores correctly (r9's own closed finding).
    const revisions = [{ section: "aboutYou", revision: 1, content: CITED_CONTENT, claims: [CLAIM_ENTRY], engine: "gemini" }];
    const { sb } = seedCustomTree({ pack: {}, liveRevisions: { aboutYou: 1 }, revisions, status: "failed", tag: "b1ctrl" });

    rejectingGemini();
    const { res } = await post(sb, {});
    expect(res.status).toBe(200);

    const after = await readBack(sb);
    const line = after.pack.sections.aboutYou.answer.lines[0];
    expect(line.text).toContain("Maria Lopez");
    expect(line.support, "the control's own restore lost the citation").not.toBeNull();
  });

  it("F-R11-2 (fix round r11, minor) -- the 500 body never carries the database's own error text; the detail stays server-side", async () => {
    const revisions = [{ section: "aboutYou", revision: 1, content: CITED_CONTENT, claims: [CLAIM_ENTRY], engine: "gemini" }];
    const { sb } = seedCustomTree({ pack: {}, liveRevisions: { aboutYou: 1 }, revisions, status: "failed", tag: "b1msg" });
    failTargetedRevisionReads(sb);

    rejectingGemini();
    const { res, body } = await post(sb, {});

    expect(res.status).toBe(500);
    expect(JSON.stringify(body), "the database's own error text reached the response body").not.toContain("connection reset");
    expect(body.error).toBe("Could not load this application's prep pack.");
  });
});
