// F-8's fix (chunk N33/N25 verification round 1). The only guard on the
// N33 threading requirement -- every normalizePack()/countRefusedLines()
// call site must resolve `storedNames` from `readTrustedNames()`, never a
// hardcoded/absent value -- lives in
// lib/interviewPrep/trustedNamesCallSites.sweep.test.js's THREADING
// describe block, and it is a SOURCE-TEXT denylist:
// `FORBIDDEN_TRAILING_ARGS = new Set(["pack", "parsed", "parsed.pack",
// "body"])`, checked only for truthiness and non-membership in that set.
// Two mutants that leave every identifier and call SHAPE untouched, and
// therefore pass that sweep (and route.test.js's own source-text regex)
// unchanged, both survived the full 709-file suite:
//
//   - lib/interviewPrep/prepStore.js:394
//       normalizePack(pack, storedNames)  ->  normalizePack(pack, [])
//     (`[]` is truthy and is not one of the four forbidden literals)
//
//   - app/api/interview-prep/route.js:469-470
//       const { candidateName, interviewerNames } = await readTrustedNames(...);
//       const storedNames = flattenTrustedNames({ candidateName, interviewerNames });
//     mutated so the object literal's two fields are hardcoded
//     (`{ candidateName: null, interviewerNames: [] }`) instead of the
//     destructured result -- the call site `normalizePack(parsed.pack,
//     storedNames)` a few lines down is BYTE-IDENTICAL either way.
//
// Neither mutant can be caught by a source-text pattern, by construction --
// the fix is to run the real code. This file drives the REAL POST handler
// (not a mock of it) with a stateful Supabase fake
// (test/helpers/supabaseFake.js) seeded with a genuine candidate_identity
// row and application_trusted_names row, through the real Gemini-path
// branch (mocking only the network-facing edges: the Supabase client, the
// Gemini client, server env, and the digest-ensure lookup), and asserts
// against the ACTUAL PAYLOAD passed to `interview_prep_packs`'s `.update()`
// call -- the same thing a real database write would receive.
//
// WHAT THIS CAN CATCH: either of the two named mutants above, and any other
// future edit anywhere on this exact call chain (readTrustedNames ->
// flattenTrustedNames -> normalizePack -> writePrepPackResult's own second
// normalizePack pass) that silently starves storedNames before it reaches
// the write. WHAT THIS CANNOT CATCH: a change to the exemption's own
// matching rule (whole-span equality, case sensitivity, NFC normalization --
// nameExemption.test.js owns that), or a FIFTH call site introduced
// elsewhere in the tree (trustedNamesCallSites.sweep.test.js's CENSUS half,
// unmodified by this file, owns that). This file is additive: it does not
// edit, weaken or replace the sweep's existing THREADING/CENSUS tests.

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
import { POST } from "./route.js";

const APP_ID = "app-1";
const USER_ID = "user-1";
const LEASE_TOKEN = "lease-fixed-1";
const FUTURE_ISO = new Date(Date.now() + 60_000).toISOString();

const POSITION = {
  id: "pos-1",
  title: "Engineer",
  company: "Acme Robotics",
  description: "Build things for the fleet.",
};

// A Title-Case, name-shaped, uncited span -- exactly the shape K1-SHAPE
// drops absent an exemption (prepParse.test.js's own fixtures use the same
// candidate name for the identical reason).
const EXEMPT_LINE = "Alex Shaw led the migration to the new platform.";

function packWithExemptLine() {
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: [{ text: EXEMPT_LINE, support: null }] } },
      whyRole: { answer: { lines: [{ text: "This role matches my background in payments.", support: null }] } },
      askThem: { questions: [{ text: "How is this team's work measured?", support: null }] },
      stages: {
        stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }],
      },
    },
    claims: [],
  };
}

function request() {
  return new Request("http://localhost/api/interview-prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: APP_ID }),
  });
}

/** `withTrustedNames: false` seeds neither table, reproducing the
 *  pre-N33/no-name-entered baseline -- storedNames is genuinely empty, not
 *  merely untested. */
function seedSupabase({ withTrustedNames }) {
  return makeStatefulSupabase(
    {
      applications: [{ id: APP_ID, user_id: USER_ID, position_id: POSITION.id }],
      positions: [POSITION],
      candidate_identity: withTrustedNames ? [{ user_id: USER_ID, candidate_name: "Alex Shaw" }] : [],
      application_trusted_names: withTrustedNames
        ? [{ application_id: APP_ID, user_id: USER_ID, interviewer_names: ["Priya Nair"] }]
        : [],
      interview_prep_packs: [
        {
          id: "pack-1",
          application_id: APP_ID,
          user_id: USER_ID,
          status: "running",
          lease_token: LEASE_TOKEN,
          lease_until: FUTURE_ISO,
          pack: null,
        },
      ],
    },
    {
      user: { id: USER_ID },
      relationships: { "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" } },
      rpc: {
        claim_prep_pack_slot: { data: true, error: null },
        record_prep_model_call: { data: true, error: null },
      },
    },
  );
}

function writtenPackFrom(sb) {
  const updateCalls = sb.calls.filter((c) => c.table === "interview_prep_packs" && c.verb === "update");
  expect(updateCalls.length, "expected exactly one UPDATE against interview_prep_packs").toBe(1);
  return updateCalls[0].payload.pack;
}

let cryptoSpy;

beforeEach(() => {
  vi.clearAllMocks();
  // wantsEmbedded reads process.env directly -- a real key forces the
  // Gemini (non-embedded) branch, the only one that reaches the storedNames
  // resolution this file is pinning (the embedded branch never calls
  // readTrustedNames at all -- F-11's own disclosed reason).
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  listDigests.mockResolvedValue({
    digests: { [APP_ID]: { application_id: APP_ID, status: "ready" } },
    error: null,
  });
  getGeminiClient.mockReturnValue({
    models: { generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(packWithExemptLine()) }) },
  });
  // claimPrepPack's own leaseToken is a fresh crypto.randomUUID() every call
  // -- pinning it lets the seeded interview_prep_packs row's lease_token
  // match the terminal UPDATE's own .eq("lease_token", ...) filter.
  cryptoSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(LEASE_TOKEN);
});

afterEach(() => {
  cryptoSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("F-8 -- a stored name genuinely reaches the exemption on the REAL POST handler, end to end (not a source-text scan)", () => {
  it("[the instrument this file adds] WITH a real candidate_identity row, the pack written to interview_prep_packs still carries the candidate's own uncited name line", async () => {
    const sb = seedSupabase({ withTrustedNames: true });
    createClient.mockResolvedValue(sb);

    const res = await POST(request());
    const body = await res.json();
    expect(body.status, `POST did not reach a terminal write: ${JSON.stringify(body)}`).not.toBe("failed");

    const pack = writtenPackFrom(sb);
    expect(pack, "the write carried no pack payload at all").toBeTruthy();
    const lines = pack.sections.aboutYou.answer.lines.map((l) => l.text);
    expect(lines).toContain(EXEMPT_LINE);
  });

  it("[negative control -- proves the assertion above is not vacuous] WITHOUT any stored name, the identical line is DROPPED from the written pack", async () => {
    const sb = seedSupabase({ withTrustedNames: false });
    createClient.mockResolvedValue(sb);

    const res = await POST(request());
    const body = await res.json();
    expect(body.status).not.toBe("failed");

    const pack = writtenPackFrom(sb);
    const lines = pack.sections.aboutYou.answer.lines.map((l) => l.text);
    expect(lines).not.toContain(EXEMPT_LINE);
  });
});
