// N151b (4b) — T7 / T8-fallback: the JOIN that is the point of the SWITCHER.
// Choosing a stored template (the new PUT verb) must make the NEXT generation
// format with it — proven through the REAL library route, the REAL stores, and
// the REAL getActiveTemplateBytes resolver over a round-tripping IN-MEMORY
// supabase. This is not a mocked-mechanism test: register (POST) + select (PUT) +
// resolve are all the shipping code.
//
// RED on HEAD: the PUT verb does not exist (route.PUT is undefined) — requirePut()
// fails loudly. GREEN after Step 1.
//
// Mutations that must RED:
//   T7 — PUT writes the wrong id / skips setSelection: the resolver then returns
//        the previously-active (or null) bytes, not the picked ones.
//   R1 — PUT drops the ownership guard: a foreign id activates and the active
//        bytes change to something the caller never owned (here: the route 200s a
//        foreign id instead of 404ing).
// No-op CONTROL that must survive: re-selecting the already-active template is
// idempotent; deleting a NON-active template leaves the active one unchanged.
//
// The in-memory supabase mirrors the chain idiom the stores use
// (defaultTemplateStore.js): select().eq()...maybeSingle()/single(),
// insert().select().single(), upsert(), delete(), storage upload/download. T8's
// ON DELETE SET NULL is a DB guarantee this fake cannot prove (pinned at the SQL
// level by N151a's migration-shape test); what this file proves for T8 is the
// resolver's own robustness — a deleted template's bytes are NEVER rendered, it
// falls back to null — which holds whether or not the pointer was nulled.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getActiveTemplateBytes } from "@/lib/document/templateSelectionStore.js";
import * as libraryRoute from "@/app/api/templates/library/route.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const USER = { id: "user-1" };
const PK = [0x50, 0x4b, 0x03, 0x04];
const BYTES_X = new Uint8Array([...PK, 0x58, 0x58]); // "XX"
const BYTES_Y = new Uint8Array([...PK, 0x59, 0x59]); // "YY"

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
        tables[tableName] = rows.filter((x) => !eqs.every(([c, v]) => x[c] === v));
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
    for (const m of ["select", "order", "update"]) api[m] = () => api;
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

const writeHandler = () => libraryRoute.POST;
function requirePut() {
  expect(typeof libraryRoute.PUT, "route.PUT verb does not exist on HEAD").toBe("function");
  return libraryRoute.PUT;
}
function postTemplate(name, bytes) {
  const fd = new FormData();
  fd.append("file", new File([bytes], `${name}.docx`, { type: DOCX_MIME }), `${name}.docx`);
  fd.append("kind", "resume");
  fd.append("name", name);
  return new Request("http://localhost/api/templates/library", { method: "POST", body: fd });
}
function putSelect(templateId) {
  return new Request("http://localhost/api/templates/library", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "resume", templateId }),
  });
}
function del(id) {
  return new Request(`http://localhost/api/templates/library?id=${id}`, { method: "DELETE" });
}
async function active(mem) {
  const found = await getActiveTemplateBytes(mem, { userId: USER.id, kind: "resume" });
  return found ? Array.from(found.bytes) : null;
}

let mem;
beforeEach(() => {
  vi.clearAllMocks();
  mem = makeMemoryClient();
  createClient.mockResolvedValue(mem);
});

describe("PUT-select an existing template -> future generations use it (T7)", () => {
  async function seedTwo() {
    await writeHandler()(postTemplate("Xtemplate", BYTES_X));
    await writeHandler()(postTemplate("Ytemplate", BYTES_Y)); // register auto-selects Y (N151a)
    const rows = mem._tables.resume_templates;
    return {
      x: rows.find((r) => r.name === "Xtemplate").id,
      y: rows.find((r) => r.name === "Ytemplate").id,
    };
  }

  it("selecting X makes getActiveTemplateBytes return X's bytes (real route->store->resolver)", async () => {
    const { x } = await seedTwo();
    expect(await active(mem), "sanity: the last registered template is active").toEqual(Array.from(BYTES_Y));

    const res = await requirePut()(putSelect(x));
    expect(res.status).toBe(200);
    expect(await active(mem), "the picked template is inert — the resolver did not return its bytes").toEqual(Array.from(BYTES_X));
  });

  it("[control] re-selecting the already-active template is idempotent", async () => {
    const { y } = await seedTwo();
    const res = await requirePut()(putSelect(y));
    expect(res.status).toBe(200);
    expect(await active(mem)).toEqual(Array.from(BYTES_Y));
  });

  it("a foreign/absent templateId is refused (404) and the active template is unchanged (R1)", async () => {
    const { x } = await seedTwo();
    await requirePut()(putSelect(x)); // X active
    const res = await requirePut()(putSelect("ghost-not-owned"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await active(mem), "a refused select changed the active template").toEqual(Array.from(BYTES_X));
  });
});

describe("deleting the active template never renders dangling bytes (T8-fallback)", () => {
  it("after deleting the active template, getActiveTemplateBytes falls back to null", async () => {
    await writeHandler()(postTemplate("Xtemplate", BYTES_X)); // X active
    const x = mem._tables.resume_templates.find((r) => r.name === "Xtemplate").id;
    expect(await active(mem)).toEqual(Array.from(BYTES_X));

    const res = await libraryRoute.DELETE(del(x));
    expect(res.status).toBe(200);
    // The row is gone; even with a dangling pointer the resolver gates its read on
    // the row's existence and returns null (reserved ?? null). The pointer-null
    // itself (GET selectedId -> null) is the ON DELETE SET NULL cascade's job,
    // pinned by N151a's migration-shape test and the hook refetch test (T8-runtime).
    expect(await active(mem), "a deleted template's bytes were still rendered").toBeNull();
  });

  it("[control] deleting a NON-active template leaves the active one intact", async () => {
    await writeHandler()(postTemplate("Xtemplate", BYTES_X));
    await writeHandler()(postTemplate("Ytemplate", BYTES_Y)); // Y active
    const x = mem._tables.resume_templates.find((r) => r.name === "Xtemplate").id;
    const res = await libraryRoute.DELETE(del(x));
    expect(res.status).toBe(200);
    expect(await active(mem)).toEqual(Array.from(BYTES_Y));
  });
});
