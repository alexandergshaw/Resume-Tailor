// ---------------------------------------------------------------------------
// N45 step S7c -- ORDINARY (whole-pack) generation must mint section-owned
// claims and write history, so the two write paths cannot diverge.
// AC-CLAIM.9, the INV-CLAIM-1 invariant end to end, and the precondition for
// every N46 restore.
// ---------------------------------------------------------------------------
//
// WHY THIS IS THE QUIET HALF OF THE CHUNK, and why it needs its own file:
// `c14a155` landed the revisions table and the restore, but ordinary
// generation still writes NOTHING to either. Verified on this tree: the
// success call at route.js:598-610 passes `pack` and `storedNames` and no
// `liveRevisions`, and `mintSectionClaims` appears nowhere in route.js. So
// every pack generated after that commit has:
//   * an EMPTY `live_revisions` pointer, so `readLiveSectionRevisions` returns
//     no sections and the N47 restore falls back to the stored `pack` column;
//   * NO revision rows, so N46's history is empty for every application in
//     production and the restore UI this round makes reachable has nothing to
//     list;
//   * MODEL-SUPPLIED claim ids, unowned by any section, so the first
//     per-section regeneration of such a pack has to lean on INV-CLAIM-1's
//     legacy escape hatch forever.
// None of that produces an error. It is the "complete mechanism, no last hop"
// shape one layer down.
//
// Harness: the REAL POST and GET against test/helpers/supabaseFake.js, with
// `claim_prep_pack_slot` replayed statement for statement (its own canary is
// in route.section.test.js; the replay here is the same code and this file
// asserts its effect directly in the first case). Only the network-facing
// edges are mocked.

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
import { claimOwnershipViolations, claimOwner } from "@/lib/interviewPrep/prepClaims.js";
import { POST } from "./route.js";

const APP_ID = "app-history-1";
const PACKS_TABLE = "interview_prep_packs";
const REVISIONS_TABLE = "interview_prep_section_revisions";
const SECTION_NAMES = ["aboutYou", "whyRole", "askThem", "stages"];
const POSITION = {
  id: "pos-history-1",
  title: "Engineer",
  company: "Acme Robotics",
  description: "Build things for the fleet.",
};

const MODEL_CLAIM_ID = "model-picked-id-1";

/** A complete four-section reply whose claims carry MODEL-SUPPLIED ids, and
 *  whose aboutYou line cites one of them. Nothing in a model reply may survive
 *  as an id in a written pack (AC-CLAIM.9), and the citation must still
 *  resolve afterwards -- a mint that rewrites ids without rewriting the
 *  references produces a dangling support, which `normalizeDroppingList` nulls
 *  and the candidate simply never sees again. */
function modelReply() {
  return JSON.stringify({
    version: 1,
    sections: {
      aboutYou: {
        answer: { lines: [{ text: "I have shipped payment rails end to end.", support: { kind: "claim", claimId: MODEL_CLAIM_ID } }] },
      },
      whyRole: { answer: { lines: [{ text: "This role matches my background in payments.", support: null }] } },
      askThem: { questions: [{ text: "How is this team's work measured?", support: null }] },
      stages: {
        stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }],
      },
    },
    claims: [{ id: MODEL_CLAIM_ID, text: "Acme runs a four-stage interview loop.", sourceUrl: "https://acme.example/careers" }],
  });
}

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

function seedTree({ existingRevisions = null } = {}) {
  userCounter += 1;
  const userId = `user-history-${userCounter}`;
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
          status: existingRevisions ? "ready" : null,
          lease_token: null,
          lease_until: null,
          pack: {},
          live_revisions: existingRevisions ? Object.fromEntries(SECTION_NAMES.map((s) => [s, 1])) : {},
          researched_at: null,
          reason: null,
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      [REVISIONS_TABLE]: existingRevisions || [],
      interview_prep_events: [],
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
    throw new Error(`[route.wholePackHistory] unmodelled rpc "${fn}"`);
  });

  return { sb, userId };
}

function existingRevisionRows(userId) {
  return SECTION_NAMES.map((section) => ({
    id: `rev-${section}-1`,
    application_id: APP_ID,
    user_id: userId,
    section,
    revision: 1,
    content: { answer: { lines: [{ text: "Older text.", support: null }] } },
    claims: [],
    engine: "gemini",
    content_version: 1,
    restored_from: null,
    created_at: "2026-09-01T00:00:00.000Z",
  }));
}

async function post(sb, body = {}) {
  createClient.mockResolvedValue(sb);
  const res = await POST(
    new Request("http://localhost/api/interview-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: APP_ID, ...body }),
    }),
  );
  return { res, body: await res.json() };
}

function packRow(sb) {
  return sb.row(PACKS_TABLE, (r) => r.application_id === APP_ID);
}

function revisionsBySection(sb) {
  const rows = sb.rows(REVISIONS_TABLE);
  return Object.fromEntries(
    SECTION_NAMES.map((s) => [s, rows.filter((r) => r.section === s).map((r) => r.revision).sort((a, b) => a - b)]),
  );
}

function replyingGemini(text) {
  const generateContent = vi.fn().mockResolvedValue({ text });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

let cryptoSpy;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  listDigests.mockResolvedValue({ digests: { [APP_ID]: { application_id: APP_ID, status: "ready" } }, error: null });
  cryptoSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("lease-history-fixed");
});

afterEach(() => {
  cryptoSpy.mockRestore();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("S7c -- an ordinary whole-pack generation writes history", () => {
  it("appends one revision row per produced section and points live_revisions at them", async () => {
    const { sb } = seedTree();
    replyingGemini(modelReply());

    const { body } = await post(sb);
    expect(body.status, `the generation itself failed: ${JSON.stringify(body)}`).toBe("ready");

    expect(revisionsBySection(sb), "a successful whole-pack generation wrote no revision rows").toEqual({
      aboutYou: [1],
      whyRole: [1],
      askThem: [1],
      stages: [1],
    });
    expect(packRow(sb).live_revisions).toEqual({ aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 });
  });

  it("each revision row records the ENGINE that produced it, which is the provenance H1 reads", async () => {
    // buildPackDocument emits `templateOrigin` only when every contributing
    // section is embedded. A revision row with no engine, or a wrong one, is
    // how a gemini-authored section acquires the embedded template's K1-SHAPE
    // exemption -- the O-15 bypass risk R9 names.
    const { sb } = seedTree();
    replyingGemini(modelReply());
    await post(sb);
    const engines = new Set(sb.rows(REVISIONS_TABLE).map((r) => r.engine));
    expect([...engines]).toEqual(["gemini"]);
  });

  it("a SECOND generation bumps every section's revision rather than overwriting the first", async () => {
    // Immutability is the whole premise of N46: a revision row is never
    // updated, only appended, which is also why the table grants no UPDATE.
    const { sb, userId } = seedTree({ existingRevisions: [] });
    sb.seed(REVISIONS_TABLE, existingRevisionRows(userId));
    sb.seed(PACKS_TABLE, [{ ...packRow(sb), status: "ready", live_revisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 } }]);
    replyingGemini(modelReply());

    await post(sb);
    expect(revisionsBySection(sb)).toEqual({ aboutYou: [1, 2], whyRole: [1, 2], askThem: [1, 2], stages: [1, 2] });
    expect(packRow(sb).live_revisions).toEqual({ aboutYou: 2, whyRole: 2, askThem: 2, stages: 2 });
    const first = sb.rows(REVISIONS_TABLE).find((r) => r.section === "aboutYou" && r.revision === 1);
    expect(first.content, "revision 1 was rewritten in place").toEqual({
      answer: { lines: [{ text: "Older text.", support: null }] },
    });
  });

  it("[no-op control] a FAILED generation appends no revision row and leaves the pointer alone", async () => {
    // Without this control, "append on every terminal write" satisfies the
    // cases above and fills the history with empty failures -- and a candidate
    // restoring one would restore nothing.
    const { sb, userId } = seedTree({ existingRevisions: [] });
    sb.seed(REVISIONS_TABLE, existingRevisionRows(userId));
    sb.seed(PACKS_TABLE, [{ ...packRow(sb), status: "ready", live_revisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 } }]);
    getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn().mockRejectedValue(new Error("boom")) } });

    await post(sb);
    expect(revisionsBySection(sb)).toEqual({ aboutYou: [1], whyRole: [1], askThem: [1], stages: [1] });
    expect(packRow(sb).live_revisions).toEqual({ aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 });
  });

  it("the EMBEDDED path writes history too, with its own engine recorded", async () => {
    // GATE 11 (route.js:443-456) is a terminal content write like any other.
    // If only the gemini path writes history, an embedded pack has no
    // revisions, so per-section regeneration of one silently merges into an
    // empty base -- G1's defect arriving through a different door.
    // `engine: "embedded"` in the body is a de-escalation, which
    // wantsEmbedded (lib/llm/featureEngine.js:45) always honours -- no env
    // stubbing needed, and it exercises the same GATE 11 branch a
    // server-forced embedded deployment takes.
    const { sb } = seedTree();
    const { body } = await post(sb, { engine: "embedded" });
    expect(body.status).toBe("partial");

    expect(revisionsBySection(sb)).toEqual({ aboutYou: [1], whyRole: [1], askThem: [1], stages: [1] });
    expect([...new Set(sb.rows(REVISIONS_TABLE).map((r) => r.engine))]).toEqual(["embedded"]);
    expect(packRow(sb).live_revisions).toEqual({ aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 });
  });
});

describe("S7c / AC-CLAIM.9 -- no model-supplied claim id survives an ordinary generation", () => {
  it("every written claim id is section-owned, and the citation that referenced a model id still resolves", async () => {
    const { sb } = seedTree();
    replyingGemini(modelReply());
    await post(sb);

    const pack = packRow(sb).pack;
    const ids = (pack.claims || []).map((c) => c.id);
    expect(ids, "the whole-pack path minted no claims -- the model's own ids were kept").not.toContain(MODEL_CLAIM_ID);
    expect(ids.length).toBe(1);
    expect(ids[0]).toMatch(/^c\/aboutYou\/[0-9a-f]{16}$/);
    expect(claimOwner(ids[0])).toBe("aboutYou");

    // The reference was rewritten with the id, not orphaned by it.
    const support = pack.sections.aboutYou.answer.lines[0].support;
    expect(support, "the cited line lost its support when its claim id was re-minted").toBeTruthy();
    expect(support.claimId).toBe(ids[0]);
  });

  it("the written pack satisfies INV-CLAIM-1 outright", async () => {
    const { sb } = seedTree();
    replyingGemini(modelReply());
    await post(sb);
    expect(claimOwnershipViolations(packRow(sb).pack)).toEqual([]);
  });

  it("the revision row carries the SAME minted claims as the pack, so a restore restores its citations with it", async () => {
    // N46's own trap, named in its backlog entry: restoring a section without
    // restoring its claims produces a section whose citations silently
    // describe different sources -- worse than no history, because it looks
    // correct.
    const { sb } = seedTree();
    replyingGemini(modelReply());
    await post(sb);

    const row = sb.rows(REVISIONS_TABLE).find((r) => r.section === "aboutYou");
    const packIds = (packRow(sb).pack.claims || []).map((c) => c.id);
    expect((row.claims || []).map((c) => c.id)).toEqual(packIds);
  });
});
