// ---------------------------------------------------------------------------
// N45 step S8 -- POST /api/interview-prep honours a `section` argument END TO
// END. AC-N45.1 (the happy path), AC-N45.3 (its failure path), AC-LOG.1,
// AC-O15.3 and the claim-ownership half of AC-CLAIM.9.
// ---------------------------------------------------------------------------
//
// `c14a155` landed the merge (`buildPackDocument`), the section-owned claims
// (`mintSectionClaims`), the revisions table and the restore. It did NOT land
// the route argument that reaches any of them for a single section: today
// GATE 5 reads only `applicationId` and `triggerClass` (route.js:344-355), and
// a `section` in the body is ignored outright, so a POST naming one section
// regenerates all four -- the exact destruction N45 exists to remove.
//
// HOW THIS FILE DRIVES IT: the REAL POST and GET handlers against
// test/helpers/supabaseFake.js's stateful in-memory PostgREST, with only the
// network-facing edges mocked (the Supabase client, the Gemini client, server
// env, the digest lookup). That is route.restore.test.js's own instrument
// shape, reused deliberately: a test that called `buildPackDocument` directly
// with a hand-built base passes for a build in which no route branch ever
// calls it with one.
//
// THE LOAD-BEARING PIECE OF THE HARNESS is the same one that file documents:
// supabaseFake models tables, not stored procedures, so `claim_prep_pack_slot`
// is REPLAYED here, statement for statement from the migration's own text --
// including `pack = '{}'::jsonb` at :92. Without that replay every byte-
// identity assertion below would pass on HEAD for the wrong reason. The replay
// carries its own canary.
//
// CONTRACTS THIS FILE BINDS (plan §S8 named the step, not the wire):
//   POST body   {applicationId, triggerClass?, section?}
//               `section` absent  -> today's whole-pack behaviour, unchanged.
//               `section` present and unrecognized -> 400, before any claim
//               (triggerClassOf's own V-8 ruling, applied to the sibling
//               field: an unknown value is refused, never normalised).
//   POST reply  {status, section, sectionProduced} on the section path.
//   Model reply {"section": <name>, "content": {...}, "claims": [...]}
//               -- ONE section's own body, never a whole `sections` envelope.
//
// WHAT THIS FILE CANNOT ASSERT, stated rather than faked:
//   * Anything a real Postgres would refuse. No Postgres is reachable from
//     this checkout; the CHECKs are read, not run.
//   * `interview_prep_events.section` as a COLUMN. The events row is read back
//     out of the fake, which has no schema -- so this file proves the route
//     WRITES the field, not that the table can hold it. The migration that
//     adds it is the implementer's (plan §S4 listed the column; `c14a155`'s
//     migration does not contain it -- verified by reading
//     20260923000000_prep_section_revisions.sql, which mentions
//     `interview_prep_events` zero times).

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
import { claimOwnershipViolations, claimOwner } from "@/lib/interviewPrep/prepClaims.js";
import { POST, GET } from "./route.js";

const APP_ID = "app-section-1";
const REVISIONS_TABLE = "interview_prep_section_revisions";
const EVENTS_TABLE = "interview_prep_events";
const PACKS_TABLE = "interview_prep_packs";
const SECTION_NAMES = ["aboutYou", "whyRole", "askThem", "stages"];
const POSITION = {
  id: "pos-section-1",
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

function storedPack() {
  return normalizePack({ version: 1, sections: { ...BODIES }, claims: [] }, []);
}

/** The model's one-section reply, as JSON text. */
function sectionReply(section, content, claims = []) {
  return JSON.stringify({ section, content, claims });
}

// ---------------------------------------------------------------------------
// claim_prep_pack_slot, replayed statement for statement from
// supabase/migrations/20260922000000_interview_prep_remove_spend_caps.sql:86-102.
// ---------------------------------------------------------------------------
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
  row.pack = {}; // :92 -- the blanking N47 names. Before the prompt is built.
  row.researched_at = null;
  row.reason = null;
  row.updated_at = nowIso;
  sb.seed(PACKS_TABLE, rows);
  return true;
}

let userCounter = 0;

/** Every test gets its OWN userId: the route's rate limiter is module-scoped
 *  and keyed on the caller's id, so a shared id would answer a later POST in
 *  this file with a 429 that looks exactly like a real red. */
function seedTree({ withRevisions = true, storedStatus = "ready" } = {}) {
  userCounter += 1;
  const userId = `user-section-${userCounter}`;
  const pack = storedPack();

  const revisions = withRevisions
    ? SECTION_NAMES.map((section, i) => ({
        id: `rev-${section}-1`,
        application_id: APP_ID,
        user_id: userId,
        section,
        revision: 1,
        content: pack.sections[section],
        claims: [],
        engine: "gemini",
        content_version: 1,
        restored_from: null,
        created_at: `2026-09-0${i + 1}T00:00:00.000Z`,
      }))
    : [];

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
          status: storedStatus,
          lease_token: null,
          lease_until: null,
          pack,
          live_revisions: withRevisions ? { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 } : {},
          researched_at: "2026-09-01T00:00:00.000Z",
          reason: null,
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      [REVISIONS_TABLE]: revisions,
      [EVENTS_TABLE]: [],
    },
    {
      user: { id: userId },
      relationships: {
        "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" },
      },
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
    throw new Error(`[route.section] unmodelled rpc "${fn}"`);
  });

  return { sb, userId, pack };
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

function sectionJson(pack, section) {
  return JSON.stringify(pack?.sections?.[section]);
}

function askThemTexts(pack) {
  return (pack?.sections?.askThem?.questions || []).map((q) => q.text);
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
  cryptoSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("lease-section-fixed");
});

afterEach(() => {
  cryptoSpy.mockRestore();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("[harness canary] -- this must hold or nothing below measures anything", () => {
  it("the replayed claim RPC really does blank `pack` to {} before any generation", async () => {
    // HEAD-GREEN BY DESIGN: it proves applyClaimSlot is a faithful replay of
    // migration :92 rather than a no-op. A no-op replay would make every
    // byte-identity assertion below pass for the wrong reason.
    const { sb, userId } = seedTree();
    expect(sectionJson(sb.row(PACKS_TABLE, () => true).pack, "askThem")).toBeTruthy();
    applyClaimSlot(sb, {
      applicationId: APP_ID,
      userId,
      leaseToken: "t",
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    const row = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(row.status).toBe("running");
    expect(row.pack).toEqual({});
  });
});

describe("AC-N45.1 -- a POST naming ONE section regenerates only that section", () => {
  it("the other three sections are byte-identical afterwards, and the named one changed", async () => {
    const { sb, pack } = seedTree();
    const before = SECTION_NAMES.map((s) => sectionJson(pack, s));
    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));

    const { res, body } = await post(sb, { section: "askThem" });
    expect(res.status, `POST refused a section-scoped request: ${JSON.stringify(body)}`).toBe(200);
    expect(body.section, "the reply does not name the section it regenerated").toBe("askThem");
    expect(body.sectionProduced).toBe(true);

    const after = await readBack(sb);
    expect(askThemTexts(after.pack), "the named section was not regenerated").toEqual([NEW_QUESTION]);
    for (const [i, section] of SECTION_NAMES.entries()) {
      if (section === "askThem") continue;
      expect(sectionJson(after.pack, section), `${section} changed during a per-section regeneration`).toBe(before[i]);
    }
  });

  it("[under-fire control] a POST with NO section still replaces the WHOLE pack, exactly as today", async () => {
    // Without this, "merge into the base" satisfied unconditionally would
    // quietly make every regeneration additive -- a different feature, and one
    // that never lets a candidate start fresh.
    const { sb } = seedTree();
    replyingGemini(
      JSON.stringify({
        version: 1,
        sections: {
          aboutYou: { answer: { lines: [{ text: "A brand new introduction.", support: null }] } },
          whyRole: { answer: { lines: [{ text: "A brand new reason.", support: null }] } },
          askThem: { questions: [{ text: "A brand new question?", support: null }] },
          stages: { stages: [{ name: "New", questions: ["New?"], recommendedAnswer: null, support: null }] },
        },
        claims: [],
      }),
    );

    const { body } = await post(sb, {});
    expect(body.status).toBe("ready");
    const after = await readBack(sb);
    expect(askThemTexts(after.pack)).toEqual(["A brand new question?"]);
    expect(after.pack.sections.aboutYou.answer.lines.map((l) => l.text)).toEqual(["A brand new introduction."]);
  });

  it("the regenerated section gets a NEW revision row and the pointer moves for it alone", async () => {
    const { sb } = seedTree();
    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));
    await post(sb, { section: "askThem" });

    const rows = sb.rows(REVISIONS_TABLE);
    const bySection = Object.fromEntries(
      SECTION_NAMES.map((s) => [s, rows.filter((r) => r.section === s).map((r) => r.revision).sort()]),
    );
    expect(bySection.askThem, "no new revision row for the regenerated section").toEqual([1, 2]);
    expect(bySection.aboutYou).toEqual([1]);
    expect(bySection.whyRole).toEqual([1]);
    expect(bySection.stages).toEqual([1]);

    const packRow = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(packRow.live_revisions).toEqual({ aboutYou: 1, whyRole: 1, askThem: 2, stages: 1 });
  });

  it("the new section's claims are minted section-owned, and no model-supplied id survives", async () => {
    // AC-CLAIM.9 through the section door. The reply below hands over an
    // attacker-shaped id AND one that claims another section's namespace.
    const { sb } = seedTree();
    replyingGemini(
      sectionReply(
        "askThem",
        { questions: [{ text: NEW_QUESTION, support: { kind: "claim", claimId: "'; DROP TABLE" } }] },
        [
          { id: "'; DROP TABLE", text: "Acme runs a four-stage loop.", sourceUrl: "https://acme.example/careers" },
          { id: "c/aboutYou/0123456789abcdef", text: "Acme is hiring.", sourceUrl: "https://acme.example/jobs" },
        ],
      ),
    );

    await post(sb, { section: "askThem" });
    const packRow = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    const ids = (packRow.pack.claims || []).map((c) => c.id);
    expect(ids, "the section path minted no claims at all").not.toEqual([]);
    for (const id of ids) {
      expect(id).toMatch(/^c\/(aboutYou|whyRole|askThem|stages)\/[0-9a-f]{16}$/);
      expect(id).not.toBe("'; DROP TABLE");
    }
    // The surviving claim is owned by the section that was regenerated -- the
    // cross-owner id the model asked for (c/aboutYou/...) cannot be laundered
    // into askThem's support by supplying it in askThem's own reply.
    expect(claimOwner(ids[0])).toBe("askThem");
    expect(claimOwnershipViolations(packRow.pack)).toEqual([]);
  });
});

describe("AC-N45.3 -- a FAILED section-scoped attempt destroys nothing", () => {
  it("all four sections, including the requested one's own prior content, come back byte-identical", async () => {
    const { sb, pack } = seedTree();
    const before = SECTION_NAMES.map((s) => sectionJson(pack, s));
    rejectingGemini();

    const { body } = await post(sb, { section: "askThem" });
    // Two assertions, deliberately together: the byte-identity alone is
    // satisfiable today by the WHOLE-PACK restore path (which ignores
    // `section` entirely), so it cannot discriminate on its own. The reply
    // naming the section is what makes this case red on HEAD.
    expect(body.section, "the reply does not name the section the attempt was for").toBe("askThem");

    const after = await readBack(sb);
    for (const [i, section] of SECTION_NAMES.entries()) {
      expect(sectionJson(after.pack, section), `${section} was lost by a failed section attempt`).toBe(before[i]);
    }
  });

  it("a failed section attempt appends NO revision row and does not move the pointer", async () => {
    const { sb } = seedTree();
    rejectingGemini();
    await post(sb, { section: "askThem" });

    expect(sb.rows(REVISIONS_TABLE).filter((r) => r.section === "askThem").map((r) => r.revision)).toEqual([1]);
    const packRow = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(packRow.live_revisions).toEqual({ aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 });
  });
});

describe("AC-LOG.1 -- a section attempt's event row records ITS outcome, not the pack's status", () => {
  it("a reply that yields nothing usable for the requested section writes outcome 'failed' with that section, while the pack stays ready", async () => {
    // The telemetry lie this prevents: the pack's own terminal status is
    // 'ready' (the other three sections are intact), so an event row that
    // mirrors the pack status reports a success for an attempt that produced
    // nothing. The V-8 triggerClass fix closed this exact shape once already.
    const { sb } = seedTree();
    replyingGemini(sectionReply("askThem", { questions: [] }));

    const { body } = await post(sb, { section: "askThem" });
    expect(body.sectionProduced).toBe(false);

    const events = sb.rows(EVENTS_TABLE);
    expect(events.length, "no event row was written for a section-scoped attempt").toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.section, "the event row does not record which section the attempt was for").toBe("askThem");
    expect(last.outcome).toBe("failed");

    const packRow = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(["ready", "partial"], `the pack's own status became ${packRow.status}`).toContain(packRow.status);
    expect(askThemTexts(packRow.pack)).toEqual(["How is this team's work measured?"]);
  });

  it("[no-op control] a WHOLE-PACK attempt's event row carries a null section", async () => {
    // Without this, "always write the requested section" is satisfied by
    // writing a constant, and every whole-pack event would claim to be about
    // one section.
    const { sb } = seedTree();
    replyingGemini(
      JSON.stringify({ version: 1, sections: { ...BODIES }, claims: [] }),
    );
    await post(sb, {});
    const events = sb.rows(EVENTS_TABLE);
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].section ?? null).toBeNull();
  });
});

describe("GATE 5 -- an unrecognized section is refused before anything is spent", () => {
  it("returns 400 and issues no claim RPC and no model call", async () => {
    const { sb } = seedTree();
    const generateContent = replyingGemini(sectionReply("askThem", { questions: [] }));

    const { res } = await post(sb, { section: "notASection" });
    expect(res.status, "an unknown section was accepted").toBe(400);
    expect(sb.calls.filter((c) => c.verb === "rpc").map((c) => c.fn)).toEqual([]);
    expect(generateContent).not.toHaveBeenCalled();
    const packRow = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(packRow.status).toBe("ready");
    expect(askThemTexts(packRow.pack)).toEqual(["How is this team's work measured?"]);
  });

  it("[no-op control] the whole-pack path, with no section at all, is NOT refused", async () => {
    const { sb } = seedTree();
    replyingGemini(JSON.stringify({ version: 1, sections: { ...BODIES }, claims: [] }));
    const { res } = await post(sb, {});
    expect(res.status).toBe(200);
  });
});

describe("F-B1 (fix round) -- a legacy row's first per-section regeneration must not leave a partial pointer", () => {
  it("a failed attempt AFTER the first per-section regeneration on a legacy row leaves all four sections intact", async () => {
    // Legacy row: no revision rows at all, live_revisions {} -- every row in
    // production before this chunk. The first section-scoped write on it
    // must bring EVERY section under the pointer, not just the one it
    // regenerated -- otherwise the very next failed attempt's restore can
    // only rebuild the section the pointer names and silently drops the
    // other three (verify.r2.md F-B1).
    const { sb, pack } = seedTree({ withRevisions: false });
    const before = SECTION_NAMES.map((s) => sectionJson(pack, s));

    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));
    const first = await post(sb, { section: "askThem" });
    expect(first.body.sectionProduced, `first regeneration did not succeed: ${JSON.stringify(first.body)}`).toBe(true);

    const packRowAfterFirst = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(
      Object.keys(packRowAfterFirst.live_revisions).sort(),
      "the pointer is still partial after the first section-scoped write on a legacy row",
    ).toEqual([...SECTION_NAMES].sort());

    rejectingGemini();
    await post(sb, { section: "aboutYou" });

    const after = await readBack(sb);
    expect(askThemTexts(after.pack), "the earlier successful regeneration was lost").toEqual([NEW_QUESTION]);
    for (const [i, section] of SECTION_NAMES.entries()) {
      if (section === "askThem") continue;
      expect(
        sectionJson(after.pack, section),
        `${section} was destroyed by a failed attempt following the first per-section regeneration`,
      ).toBe(before[i]);
    }
  });
});

describe("F-B2 (fix round) -- the embedded engine honours `section`", () => {
  it("a section-scoped POST on the embedded engine regenerates only that section", async () => {
    const { sb, pack } = seedTree();
    const before = SECTION_NAMES.map((s) => sectionJson(pack, s));

    const { res, body } = await post(sb, { section: "askThem", engine: "embedded" });
    expect(res.status, `embedded section POST was refused: ${JSON.stringify(body)}`).toBe(200);
    expect(body.section, "the embedded reply does not name the section it regenerated").toBe("askThem");
    expect(body.sectionProduced).toBe(true);

    const after = await readBack(sb);
    expect(sectionJson(after.pack, "askThem"), "the embedded engine did not change the requested section").not.toBe(
      before[2],
    );
    for (const [i, section] of SECTION_NAMES.entries()) {
      if (section === "askThem") continue;
      expect(
        sectionJson(after.pack, section),
        `${section} changed on an embedded engine's section-scoped regeneration`,
      ).toBe(before[i]);
    }
  });

  it("[under-fire control] a WHOLE-PACK POST on the embedded engine still replaces all four sections", async () => {
    // Without this, "honour section" satisfied by never touching more than
    // one section would quietly break the embedded engine's own whole-pack
    // behaviour, which this control still exercises.
    const { sb, pack } = seedTree();
    const before = SECTION_NAMES.map((s) => sectionJson(pack, s));
    const { body } = await post(sb, { engine: "embedded" });
    expect(body.status).toBe("partial");
    const after = await readBack(sb);
    for (const [i, section] of SECTION_NAMES.entries()) {
      expect(sectionJson(after.pack, section), `${section} was not replaced by a whole-pack embedded regeneration`).not.toBe(
        before[i],
      );
    }
  });
});

describe("F-B3 (fix round) -- a failed base read refuses the attempt before the claim, leaving the pack untouched", () => {
  function seedPoisonedTree() {
    userCounter += 1;
    const userId = `user-section-poison-${userCounter}`;
    const pack = storedPack();
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
            status: "ready",
            lease_token: null,
            lease_until: null,
            pack,
            live_revisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
            researched_at: "2026-09-01T00:00:00.000Z",
            reason: null,
            updated_at: "2026-09-01T00:00:00.000Z",
          },
        ],
        [REVISIONS_TABLE]: [],
        [EVENTS_TABLE]: [],
      },
      {
        user: { id: userId },
        relationships: { "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" } },
        errors: { [REVISIONS_TABLE]: { select: { message: "PGRST205 schema cache" } } },
      },
    );
    // A base read that fails must refuse BEFORE the claim -- this stub makes
    // that observable directly instead of only inferring it from a status
    // code: if the route ever reaches the claim anyway, this is what runs.
    sb.rpc = vi.fn(async (fn) => {
      sb.calls.push({ table: null, verb: "rpc", fn });
      return { data: null, error: { message: `[F-B3 instrument] unexpected rpc "${fn}" -- the base-read refusal did not fire` } };
    });
    return { sb, pack };
  }

  it("a poisoned revisions read is refused with a real error, no claim, and the pack untouched", async () => {
    const { sb, pack } = seedPoisonedTree();
    const before = SECTION_NAMES.map((s) => sectionJson(pack, s));

    const { res } = await post(sb, { section: "askThem" });
    expect(res.status, "a failed base read was not refused as a terminal error").toBe(500);
    expect(sb.calls.filter((c) => c.verb === "rpc"), "the claim RPC was reached despite the base read failing").toEqual([]);

    const packRow = sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
    expect(packRow.status, "status changed even though the request was refused before the claim").toBe("ready");
    for (const [i, section] of SECTION_NAMES.entries()) {
      expect(sectionJson(packRow.pack, section), `${section} changed even though the request was refused before the claim`).toBe(
        before[i],
      );
    }
  });

  it("[no-op control] the identical tree with an UNPOISONED revisions read is not refused", async () => {
    const { sb } = seedTree({ withRevisions: false });
    replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));
    const { res } = await post(sb, { section: "askThem" });
    expect(res.status, "the no-op control itself was refused -- the 500 above is not proven caused by the poisoned read").toBe(200);
  });
});

describe("AC-O15.3 -- the section path adds no second spend site", () => {
  it("one section-scoped POST issues exactly one model call and exactly one record_prep_model_call", async () => {
    const { sb } = seedTree();
    const generateContent = replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));

    await post(sb, { section: "askThem" });

    expect(generateContent, "the section path issued more than one generation call").toHaveBeenCalledTimes(1);
    const rpcs = sb.calls.filter((c) => c.verb === "rpc").map((c) => c.fn);
    expect(rpcs.filter((f) => f === "record_prep_model_call")).toHaveLength(1);
    expect(rpcs.filter((f) => f === "claim_prep_pack_slot")).toHaveLength(1);
  });

  it("the section prompt asks for ONE section and carries no other section's current text", async () => {
    // AC-EGRESS.1's route-level half: prepSection.test.js owns the builder's
    // own contract; this asserts the ROUTE hands it a one-section job rather
    // than re-sending the stored pack.
    const { sb } = seedTree();
    const generateContent = replyingGemini(sectionReply("askThem", { questions: [{ text: NEW_QUESTION, support: null }] }));
    await post(sb, { section: "askThem" });

    const sent = JSON.stringify(generateContent.mock.calls[0][0]);
    expect(sent).toContain("askThem");
    expect(sent, "the prompt carried another section's stored content").not.toContain(
      "I have shipped payment rails end to end.",
    );
    expect(sent).not.toContain("This role matches my background in payments.");
  });
});
