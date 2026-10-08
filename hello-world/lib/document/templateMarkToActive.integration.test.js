// N151a (4b) — T9: the JOIN that is the whole point of the chunk. Marking a
// material as a template must make FUTURE generations use it (design §7 / P1 /
// R8). This is NOT a mock-the-mechanism test: it drives the REAL library route
// POST with a real .docx payload, backed by the REAL templateLibraryStore and
// templateSelectionStore over a round-tripping IN-MEMORY supabase, and then asks
// the REAL getActiveTemplateBytes what the next generation would format with.
//
// This is deliberately the real producer (register + set-selection, wired by the
// route's P1) feeding the real consumer (getActiveTemplateBytes), per the
// "test the JOIN with the REAL consumer" rule — the two halves are never checked
// against each other's assumptions.
//
// RED on HEAD: neither the route nor the stores exist (module-not-found). Once
// they land: the register's named row + the selection pointer + the precedence
// resolver together return the marked bytes. Mutations that must RED: the route
// skips register (no row -> null), or the route skips setSelection (resolver
// falls back to reserved/null, never the marked bytes). No-op CONTROL that must
// survive: marking the SAME name twice yields a friendly dup error and NO second
// row — the library does not grow.
//
// The in-memory supabase mirrors the chain idiom the plan says to follow
// (defaultTemplateStore.js): select().eq()...maybeSingle()/single(),
// insert().select().single(), upsert(), and storage upload/download by path. A
// correct build using that idiom round-trips here (proven in the 4b notes'
// reference run).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getActiveTemplateBytes } from "@/lib/document/templateSelectionStore.js";
import * as libraryRoute from "@/app/api/templates/library/route.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const USER = { id: "user-1" };

// Distinct docx payloads so "the marked bytes came back" is unambiguous.
const PK = [0x50, 0x4b, 0x03, 0x04];
const MARKED_BYTES = new Uint8Array([...PK, 0x4d, 0x4d]); // M for "marked"

// ---------------------------------------------------------------------------
// A round-tripping in-memory supabase: two tables with filterable reads and a
// unique (user_id,kind,lower(name)) index on resume_templates, plus storage
// objects keyed by path.
// ---------------------------------------------------------------------------
function makeMemoryClient() {
  const tables = { resume_templates: [], template_selections: [] };
  const objects = new Map();

  function uniqKey(r) {
    return `${r.user_id}::${r.kind}::${String(r.name).toLowerCase()}`;
  }

  function builder(tableName) {
    const rows = tables[tableName];
    let verb = "select";
    let writePayload = null;
    const eqs = [];
    const api = {};
    const result = () => {
      if (verb === "insert") {
        const r = { id: writePayload.id || globalThis.crypto.randomUUID(), ...writePayload };
        if (tableName === "resume_templates" && rows.some((x) => uniqKey(x) === uniqKey(r))) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        rows.push(r);
        return { data: r, error: null };
      }
      if (verb === "upsert") {
        const r = { ...writePayload };
        if (tableName === "template_selections") {
          const i = rows.findIndex((x) => x.user_id === r.user_id && x.kind === r.kind);
          if (i >= 0) rows[i] = { ...rows[i], ...r };
          else rows.push(r);
        } else rows.push(r);
        return { data: r, error: null };
      }
      if (verb === "delete") {
        const kept = rows.filter((x) => !eqs.every(([c, v]) => x[c] === v));
        tables[tableName] = kept;
        return { data: null, error: null };
      }
      const matched = rows.filter((x) => eqs.every(([c, v]) => x[c] === v));
      return { data: matched, error: null, _matched: matched };
    };
    const single = async () => {
      const r = result();
      if (r.error) return r;
      if (verb === "select") return { data: r._matched[0] || null, error: null };
      return { data: r.data, error: null };
    };
    for (const m of ["select", "order"]) api[m] = () => api;
    api.eq = (c, v) => { eqs.push([c, v]); return api; };
    api.insert = (p) => { verb = "insert"; writePayload = Array.isArray(p) ? p[0] : p; return api; };
    api.upsert = (p) => { verb = "upsert"; writePayload = Array.isArray(p) ? p[0] : p; return api; };
    api.delete = () => { verb = "delete"; return api; };
    api.single = single;
    api.maybeSingle = single;
    api.then = (res, rej) => Promise.resolve(result()).then((r) => ({ data: r.data, error: r.error })).then(res, rej);
    return api;
  }

  return {
    _tables: tables,
    _objects: objects,
    from: (t) => builder(t),
    storage: {
      from: () => ({
        upload: async (path, body) => { objects.set(path, body); return { data: { path }, error: null }; },
        download: async (path) => {
          const bytes = objects.get(path);
          if (!bytes) return { data: null, error: { message: "not found" } };
          return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
        },
        remove: async () => ({ data: {}, error: null }),
      }),
    },
    auth: { getUser: async () => ({ data: { user: USER } }) },
  };
}

function markRequest(name, bytes = MARKED_BYTES) {
  const fd = new FormData();
  fd.append("file", new File([bytes], `${name}.docx`, { type: DOCX_MIME }), `${name}.docx`);
  fd.append("kind", "resume");
  fd.append("name", name); // what the hook derives: item.name minus ".docx"
  return new Request("http://localhost/api/templates/library", { method: "POST", body: fd });
}

const writeHandler = () => libraryRoute.POST || libraryRoute.PUT;

let mem;
beforeEach(() => {
  vi.clearAllMocks();
  mem = makeMemoryClient();
  createClient.mockResolvedValue(mem);
});

describe("mark a material -> future generations use it (T9 / P1 / R8)", () => {
  it("after marking, getActiveTemplateBytes('resume') returns the MARKED bytes", async () => {
    const res = await writeHandler()(markRequest("Alpha Resume"));
    expect(res.status).toBe(200);

    // A named row landed in the library.
    const rows = mem._tables.resume_templates;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Alpha Resume");
    expect(rows[0].kind).toBe("resume");

    // And it is now the ACTIVE template: the next generation formats with it.
    const active = await getActiveTemplateBytes(mem, { userId: USER.id, kind: "resume" });
    expect(active, "the marked template is inert — no active bytes resolved").toBeTruthy();
    expect(Array.from(active.bytes)).toEqual(Array.from(MARKED_BYTES));
  });

  it("the selection points at the row that was just created (not some other template)", async () => {
    await writeHandler()(markRequest("Alpha Resume"));
    const sel = mem._tables.template_selections.find((s) => s.user_id === USER.id && s.kind === "resume");
    expect(sel, "no selection row written on mark (register skipped setSelection?)").toBeTruthy();
    expect(sel.template_id).toBe(mem._tables.resume_templates[0].id);
  });

  it("[no-op CONTROL] marking the SAME name twice -> friendly dup error, NO second row", async () => {
    const r1 = await writeHandler()(markRequest("Alpha Resume"));
    expect(r1.status).toBe(200);
    const r2 = await writeHandler()(markRequest("Alpha Resume"));
    expect(r2.status).toBeGreaterThanOrEqual(400);
    const body = await r2.json();
    expect(String(body.error || "")).not.toMatch(/23505/);
    expect(mem._tables.resume_templates, "a duplicate mark grew the library").toHaveLength(1);
  });

  it("[reachability control] a DIFFERENT second name adds a second row and re-points the selection", async () => {
    await writeHandler()(markRequest("Alpha Resume"));
    await writeHandler()(markRequest("Beta Resume"));
    expect(mem._tables.resume_templates).toHaveLength(2);
    const sel = mem._tables.template_selections.find((s) => s.kind === "resume");
    const beta = mem._tables.resume_templates.find((r) => r.name === "Beta Resume");
    expect(sel.template_id).toBe(beta.id); // mark = add + activate (P1)
  });
});

// WHAT THIS CANNOT CATCH: it does not render the materials UI — the button gate
// (T10) and the click->handler path (T11) are the ApplyingControls mount, and
// the "<M minus .docx>" name derivation + remote-bytes fetch is the hook
// (useMaterialsLocker.markMaterialAsTemplate, its own test). It also does not
// prove the live DB applied the migration (T1 / BL-A).
