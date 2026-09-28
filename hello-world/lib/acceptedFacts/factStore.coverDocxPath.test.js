// N59 step 5 (4b) -- factStore must forward the new cover version's stored docx
// path to the accept RPC as p_docx_path. AC-3 / AC-8, seam K10.
//
// The whole read-path fix is worthless if the accept RPC keeps storing a cover
// version row with a NULL docx_path: the next reload would have no pointer to
// resolve, and the accepted fact's styling would be lost again -- the exact
// durability gap N59 exists to close, re-opened one layer down. The migration
// 66ea826 gave accept_application_facts a `p_docx_path text default null`
// parameter; this pins that lib/acceptedFacts/factStore.js actually PASSES the
// value through, rather than letting it default to null forever.
//
// RED-ON-HEAD REASON: factStore.js's rpc call (lines ~99-107) names
// p_application_id ... p_inserted_facts and NOTHING for the docx path, so
// coverVersion.docxPath is dropped on the floor.
//
// The RPC's own runtime (does the row actually get docx_path stored) is a
// delayed promise, post-deploy -- this repo runs no migration in a test. This
// file measures the ONE thing provable now: the argument reaches supabase.rpc.

import { describe, it, expect } from "vitest";
import { acceptFactsForJob } from "./factStore.js";

// A minimal Supabase stand-in: resolves the owned application, then captures the
// exact params object handed to supabase.rpc.
function makeClient({ coverLetterId = "cov-1" } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    from(table) {
      const builder = {
        _table: table,
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === "positions") return { data: { id: "pos-1" }, error: null };
          if (table === "applications") return { data: { id: "app-1", cover_letter_id: coverLetterId }, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
    rpc: async (name, params) => {
      rpcCalls.push({ name, params });
      return { data: { status: "ok", revision: 2, facts: [], removed: [] }, error: null };
    },
  };
}

const COVER_PATH = "user-1/generated/cover-9f8e7d.docx";

function coverVersion(over = {}) {
  return {
    lines: ["Dear Hiring Manager,", "I would be glad to contribute."],
    insertedFacts: [{ id: "art-1", text: "Acme opened a Dublin lab.", lineIndex: 1, offset: 0 }],
    docxPath: COVER_PATH,
    ...over,
  };
}

describe("acceptFactsForJob forwards the cover version's docx path to the RPC (AC-3, K10)", () => {
  it("passes coverVersion.docxPath as p_docx_path", async () => {
    // RED on HEAD: the rpc call names no p_docx_path at all.
    const client = makeClient();
    const res = await acceptFactsForJob(client, "user-1", {
      jobRef: "job-1",
      facts: [],
      baseRevision: 1,
      removed: [],
      coverVersion: coverVersion(),
    });
    expect(res.status).toBe("ok");
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].name).toBe("accept_application_facts");
    expect(client.rpcCalls[0].params.p_docx_path).toBe(COVER_PATH);
  });

  it("passes null when the cover version carries no docx path (upload failed / pre-migration)", async () => {
    // AC-6 safe direction at the store layer: an accept whose splice could not be
    // uploaded must store a NULL pointer (so the next reload honestly refuses),
    // never a stale or a fabricated one. `?? null`, not `|| ""`.
    const client = makeClient();
    await acceptFactsForJob(client, "user-1", {
      jobRef: "job-1",
      facts: [],
      baseRevision: 1,
      removed: [],
      coverVersion: coverVersion({ docxPath: null }),
    });
    expect(client.rpcCalls[0].params.p_docx_path).toBeNull();
  });

  it("passes null for a facts-only accept with no cover version", async () => {
    // An application with no cover letter sends coverVersion: null. p_docx_path
    // must be null, not undefined-that-omits-the-arg (which would make the 8-arg
    // RPC resolution ambiguous against a stale overload -- migration risk K1).
    const client = makeClient({ coverLetterId: null });
    await acceptFactsForJob(client, "user-1", {
      jobRef: "job-1",
      facts: [{ id: "f1", text: "A fact.", url: "https://x.example.com/a", placement: "current" }],
      baseRevision: 1,
      removed: [],
      coverVersion: null,
    });
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].params.p_docx_path).toBeNull();
    // The property must be PRESENT (explicitly null), not merely absent.
    expect("p_docx_path" in client.rpcCalls[0].params).toBe(true);
  });

  it("CONTROL: the other RPC params are unchanged by the addition", async () => {
    // Guards against a fix that adds p_docx_path but disturbs a sibling param.
    const client = makeClient();
    await acceptFactsForJob(client, "user-1", {
      jobRef: "job-1",
      facts: [],
      baseRevision: 3,
      removed: ["https://gone.example.com/x"],
      coverVersion: coverVersion(),
    });
    const p = client.rpcCalls[0].params;
    expect(p.p_application_id).toBe("app-1");
    expect(p.p_base_revision).toBe(3);
    expect(p.p_removed).toEqual(["https://gone.example.com/x"]);
    expect(p.p_cover_content).toBe("Dear Hiring Manager,\nI would be glad to contribute.");
    expect(p.p_inserted_facts).toEqual(coverVersion().insertedFacts);
  });
});
