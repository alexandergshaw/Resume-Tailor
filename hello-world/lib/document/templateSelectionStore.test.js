// N151a (4b) — templateSelectionStore: the per-(user,kind) SELECTION pointer
// and the selection-aware bytes resolver (plan Step 2). This module does not
// exist on HEAD, so every test is RED by module-not-found until Step 2 lands
// it. Contracts (plan Step 2 / design §4.1, §6.1):
//   getSelection(supabase, { userId, kind })        -> { template_id } | null
//   setSelection(supabase, { userId, kind, templateId }) -> { ok:true } | { error }
//   getActiveTemplateBytes(supabase, { userId, kind })   -> { bytes } | null
//     PRECEDENCE (load-bearing, R3/PL-3): selection's template bytes
//     ?? reserved-row bytes (getDefaultTemplateBytes) ?? null.
//
// Covers T2 (precedence) and T3 (setSelection/getSelection + per-user .eq).
//
// getDefaultTemplateBytes (the N97 reserved-row fallback) is MOCKED so this
// suite isolates the selection store's own precedence from the reserved store's
// internals (defaultTemplateStore.test.js owns those).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/document/defaultTemplateStore.js", () => ({
  getDefaultTemplateBytes: vi.fn(async () => null),
}));

import { getDefaultTemplateBytes } from "@/lib/document/defaultTemplateStore.js";
import {
  getSelection,
  setSelection,
  getActiveTemplateBytes,
} from "@/lib/document/templateSelectionStore.js";

// DISTINCT byte payloads so "selected vs reserved" is detectable: a reserved-
// first mutant returns RESERVED where SELECTED is expected (and vice versa).
const PK = [0x50, 0x4b, 0x03, 0x04];
const SELECTED_BYTES = new Uint8Array([...PK, 0xaa, 0xaa]);
const RESERVED_BYTES = new Uint8Array([...PK, 0xbb, 0xbb]);

const blobOf = (bytes) => ({
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

// A recorder modelling the resume_templates / template_selections query builder
// AND storage.download, with an ORDERED event log and per-table read results.
// Flexible about which terminal verb resolves so a reasonable implementation
// (select-then-upsert, or a single upsert) all pass.
function makeStore({
  selectionRow = null, // what a template_selections read resolves to
  templateRow = null, // what a resume_templates read resolves to
  downloadBlob = null,
  downloadError = null,
} = {}) {
  const events = [];
  const downloads = [];
  const byTable = { template_selections: [], resume_templates: [] };

  function makeBuilder(tableName) {
    let verb = "select";
    const readRow = tableName === "template_selections" ? selectionRow : templateRow;
    const resolve = () => {
      if (verb === "insert" || verb === "update" || verb === "upsert") {
        return { data: { ...(byTable[tableName].at(-1)?.payload || {}) }, error: null };
      }
      if (verb === "delete") return { data: null, error: null };
      return { data: readRow, error: null }; // select
    };
    const builder = {};
    const rec = (name) => (...args) => {
      if (["insert", "update", "upsert", "delete"].includes(name)) {
        verb = name;
        byTable[tableName].push({ verb: name, payload: args[0], args });
      }
      if (name === "eq") byTable[tableName].push({ verb: "eq", col: args[0], val: args[1] });
      events.push(`${tableName}.${name}`);
      return builder;
    };
    for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "order", "match"]) {
      builder[m] = rec(m);
    }
    builder.single = vi.fn(async () => resolve());
    builder.maybeSingle = vi.fn(async () => resolve());
    builder.then = (res, rej) => Promise.resolve(resolve()).then(res, rej);
    return builder;
  }

  const supabase = {
    from: vi.fn((t) => {
      events.push(`from:${t}`);
      return makeBuilder(t);
    }),
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async (path) => {
          downloads.push(path);
          if (downloadError) return { data: null, error: { message: downloadError } };
          return { data: downloadBlob, error: null };
        }),
      })),
    },
  };

  return { supabase, events, downloads, byTable };
}

// Every eq(col,val) recorded across both tables, flattened.
function allEqs(byTable) {
  return [...byTable.template_selections, ...byTable.resume_templates].filter((e) => e.verb === "eq");
}

beforeEach(() => {
  vi.clearAllMocks();
  getDefaultTemplateBytes.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// T2 — getActiveTemplateBytes precedence = selection ?? reserved ?? null.
// ---------------------------------------------------------------------------
describe("getActiveTemplateBytes — precedence (T2 / R3 / PL-3)", () => {
  it("returns the SELECTED template's bytes when a selection resolves to a present object", async () => {
    // A reserved row ALSO exists — the point of this fixture is that selection
    // WINS. A reserved-first mutant returns RESERVED_BYTES here and reds.
    getDefaultTemplateBytes.mockResolvedValue({ bytes: RESERVED_BYTES });
    const { supabase } = makeStore({
      selectionRow: { template_id: "tmpl-1" },
      templateRow: { id: "tmpl-1", user_id: "u1", storage_path: "u1/templates/tmpl-1.docx" },
      downloadBlob: blobOf(SELECTED_BYTES),
    });
    const got = await getActiveTemplateBytes(supabase, { userId: "u1", kind: "resume" });
    expect(got, "no bytes returned for a live selection").toBeTruthy();
    expect(Array.from(got.bytes)).toEqual(Array.from(SELECTED_BYTES));
    expect(Array.from(got.bytes)).not.toEqual(Array.from(RESERVED_BYTES));
  });

  it("falls back to the RESERVED bytes when a selection exists but its object is gone", async () => {
    // template_id set, but the stored object 404s -> must fall through to the
    // reserved row, never return null. A "no fall-back" mutant reds (null).
    getDefaultTemplateBytes.mockResolvedValue({ bytes: RESERVED_BYTES });
    const { supabase } = makeStore({
      selectionRow: { template_id: "tmpl-1" },
      templateRow: { id: "tmpl-1", user_id: "u1", storage_path: "u1/templates/tmpl-1.docx" },
      downloadError: "not found",
    });
    const got = await getActiveTemplateBytes(supabase, { userId: "u1", kind: "resume" });
    expect(got, "no fall-back to reserved when the selected object is gone").toBeTruthy();
    expect(Array.from(got.bytes)).toEqual(Array.from(RESERVED_BYTES));
  });

  it("returns the RESERVED bytes when there is no selection but a reserved row exists", async () => {
    getDefaultTemplateBytes.mockResolvedValue({ bytes: RESERVED_BYTES });
    const { supabase } = makeStore({ selectionRow: null });
    const got = await getActiveTemplateBytes(supabase, { userId: "u1", kind: "resume" });
    expect(got).toBeTruthy();
    expect(Array.from(got.bytes)).toEqual(Array.from(RESERVED_BYTES));
  });

  it("[control, under-fire] returns null when neither a selection nor a reserved row exists", async () => {
    // Proves the resolver does not over-fire (always hand back something): with
    // no substrate it is a strict null, which is what keeps the egress override
    // a no-op (AC-8 / ST-9).
    getDefaultTemplateBytes.mockResolvedValue(null);
    const { supabase } = makeStore({ selectionRow: null });
    expect(await getActiveTemplateBytes(supabase, { userId: "u1", kind: "resume" })).toBeNull();
  });

  it("[control, over-fire] when a selection IS present, the reserved fallback is NOT what reaches the caller", async () => {
    // Distinct from fixture 1 by intent: proves the reserved store is consulted
    // only on a miss, not blended in. Selected present -> selected returned even
    // though the reserved store would answer with different bytes.
    getDefaultTemplateBytes.mockResolvedValue({ bytes: RESERVED_BYTES });
    const { supabase } = makeStore({
      selectionRow: { template_id: "tmpl-9" },
      templateRow: { id: "tmpl-9", user_id: "u1", storage_path: "u1/templates/tmpl-9.docx" },
      downloadBlob: blobOf(SELECTED_BYTES),
    });
    const got = await getActiveTemplateBytes(supabase, { userId: "u1", kind: "resume" });
    expect(Array.from(got.bytes)).toEqual(Array.from(SELECTED_BYTES));
  });
});

// ---------------------------------------------------------------------------
// T3 — setSelection / getSelection + per-user .eq (R4).
// ---------------------------------------------------------------------------
describe("getSelection (T3)", () => {
  it("returns null when no selection row exists", async () => {
    const { supabase } = makeStore({ selectionRow: null });
    expect(await getSelection(supabase, { userId: "u1", kind: "resume" })).toBeNull();
  });

  it("reads template_selections filtered by the caller's user_id and kind", async () => {
    const { supabase, byTable } = makeStore({ selectionRow: { template_id: "tmpl-1" } });
    const got = await getSelection(supabase, { userId: "u1", kind: "resume" });
    expect(got).toMatchObject({ template_id: "tmpl-1" });
    const eqs = byTable.template_selections.filter((e) => e.verb === "eq");
    expect(eqs).toContainEqual({ verb: "eq", col: "user_id", val: "u1" });
    expect(eqs).toContainEqual({ verb: "eq", col: "kind", val: "resume" });
  });
});

describe("setSelection (T3 / R4)", () => {
  it("writes the selection for the caller's own user_id and kind and returns { ok:true }", async () => {
    const { supabase, byTable } = makeStore({ selectionRow: null });
    const res = await setSelection(supabase, { userId: "owner-9", kind: "resume", templateId: "tmpl-7" });
    expect(res).toMatchObject({ ok: true });
    const writes = byTable.template_selections.filter((e) => ["insert", "update", "upsert"].includes(e.verb));
    expect(writes.length, "no selection write issued").toBeGreaterThan(0);
    // The written payload targets the caller and the chosen template.
    const payloads = writes.map((w) => w.payload).filter(Boolean);
    expect(payloads.some((p) => p.template_id === "tmpl-7")).toBe(true);
    for (const p of payloads) {
      if ("user_id" in p) expect(p.user_id).toBe("owner-9");
      if ("kind" in p) expect(p.kind).toBe("resume");
    }
  });

  it("R4: no statement targets a user_id other than the caller's", async () => {
    const { supabase, byTable } = makeStore({ selectionRow: { template_id: "old" } });
    await setSelection(supabase, { userId: "owner-9", kind: "resume", templateId: "tmpl-7" });
    for (const e of allEqs(byTable)) {
      if (e.col === "user_id") expect(e.val).toBe("owner-9");
    }
    for (const w of byTable.template_selections.filter((e) => ["insert", "update", "upsert"].includes(e.verb))) {
      if (w.payload && "user_id" in w.payload) expect(w.payload.user_id).toBe("owner-9");
    }
  });

  it("refuses an unsupported kind with { error } and writes nothing", async () => {
    const { supabase, byTable } = makeStore({ selectionRow: null });
    const res = await setSelection(supabase, { userId: "u1", kind: "email", templateId: "tmpl-7" });
    expect(res.error, "email kind must be refused").toBeTruthy();
    expect(res.ok).toBeFalsy();
    const writes = byTable.template_selections.filter((e) => ["insert", "update", "upsert"].includes(e.verb));
    expect(writes).toHaveLength(0);
  });

  it("[control] a valid kind is NOT refused (the email refusal is specific, not blanket)", async () => {
    const { supabase } = makeStore({ selectionRow: null });
    const res = await setSelection(supabase, { userId: "u1", kind: "cover", templateId: "tmpl-7" });
    expect(res.error).toBeFalsy();
    expect(res).toMatchObject({ ok: true });
  });
});

// WHAT THIS CANNOT CATCH: it exercises the store with a faked client, so it does
// not prove the route calls setSelection (route.test.js / T7) nor that an egress
// surface consumes getActiveTemplateBytes (default/route.selectionAware / T8).
// The "second set replaces" guarantee is structural (PK(user,kind), asserted in
// the migration-shape test T1), not re-proven here against a fake upsert.
