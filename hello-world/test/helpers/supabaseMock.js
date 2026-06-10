import { vi } from "vitest";

// A chainable mock of the Supabase PostgREST query builder. Every filter /
// modifier method returns `this` so calls can be chained exactly like the real
// client (`.from().select().eq().in().order().limit()...`). The chain resolves
// to a canned `{ data, error }` result, configured per table.
//
// Tables are described as a map: { tableName: { select, insert, update, delete,
// upsert } } where each value is the `{ data, error }` returned for that verb.
// A bare `{ data, error }` (no verb keys) is used as the default for every verb.
//
// The returned builder records calls so tests can assert filters were applied:
//   const sb = makeSupabase({ applications: { data: rows } });
//   await sb.from("applications").select("*").eq("user_id", "u1");
//   expect(sb.calls.applications.eq).toContainEqual(["user_id", "u1"]);

function makeResult(spec, verb) {
  if (!spec) return { data: null, error: null };
  if (Object.prototype.hasOwnProperty.call(spec, verb)) return spec[verb];
  if ("data" in spec || "error" in spec) return { data: spec.data ?? null, error: spec.error ?? null };
  return { data: null, error: null };
}

export function makeSupabase(tables = {}, opts = {}) {
  const calls = {};

  function builderFor(table) {
    const tableCalls =
      calls[table] || (calls[table] = { select: [], insert: [], update: [], delete: [], upsert: [], eq: [], in: [], order: [], limit: [], maybeSingle: 0, single: 0 });
    let verb = "select";

    const builder = {};
    const record = (name) =>
      vi.fn((...args) => {
        if (["select", "insert", "update", "delete", "upsert"].includes(name)) verb = name;
        if (Array.isArray(tableCalls[name])) tableCalls[name].push(args);
        return builder;
      });

    builder.select = record("select");
    builder.insert = record("insert");
    builder.update = record("update");
    builder.delete = record("delete");
    builder.upsert = record("upsert");
    builder.eq = record("eq");
    builder.in = record("in");
    builder.order = record("order");
    builder.limit = vi.fn((...args) => {
      tableCalls.limit.push(args);
      // .limit() is frequently the last call in a chain and is awaited directly.
      return Promise.resolve(makeResult(tables[table], verb));
    });
    builder.maybeSingle = vi.fn(() => {
      tableCalls.maybeSingle += 1;
      return Promise.resolve(makeResult(tables[table], verb));
    });
    builder.single = vi.fn(() => {
      tableCalls.single += 1;
      return Promise.resolve(makeResult(tables[table], verb));
    });
    // Allow awaiting the builder directly (e.g. after .in() with no .single()).
    builder.then = (resolve, reject) =>
      Promise.resolve(makeResult(tables[table], verb)).then(resolve, reject);

    return builder;
  }

  const client = {
    calls,
    from: vi.fn((table) => builderFor(table)),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.user ?? null } })),
    },
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async (path) => {
          const store = opts.storage || {};
          if (Object.prototype.hasOwnProperty.call(store, path)) {
            const entry = store[path];
            if (entry instanceof Error) return { data: null, error: entry };
            return { data: entry, error: null };
          }
          return { data: null, error: { message: "not found" } };
        }),
      })),
    },
  };

  return client;
}

// A minimal "Blob-like" object whose arrayBuffer() resolves to the given bytes,
// matching what supabase storage.download() returns.
export function fakeBlob(text = "PK\u0003\u0004 fake docx") {
  const bytes = new TextEncoder().encode(text);
  return {
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// Build a Request with a JSON body for route handler tests.
export function jsonRequest(body) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
