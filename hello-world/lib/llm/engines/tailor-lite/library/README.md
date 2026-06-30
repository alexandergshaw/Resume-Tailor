# Tailor library (Supabase-backed, user-editable)

The deterministic ("embedded") engine is driven by a **library**: the buzzword
taxonomy, focus areas, skill groups, content-library fragments, and profile values.
It used to live only as bundled JSON in `../data/*.json`; it now lives **per-user in
Supabase** and is editable from the **`/library`** page — so the library can be
managed without code changes / AI edits.

The bundled JSON is retained as the **seed** (per-user, on first use) and the
**offline fallback**, so tailoring can never break. Stopwords stay bundled-only.

## Data flow

```
/library UI ──CRUD──▶ /api/library/*  ──▶  Supabase (tailor_* tables, RLS per user)
                                   │              ▲
   tailor request (userId) ──▶ engine ──▶ loadLibrary({userId})
                                   │   (in-process + Redis cache, keyed by
                                   ▼    tailor_profile.library_version)
                              rowsToLibrary ──▶ { taxonomy, profile, skillGroups,
                                                  contentLibrary } (+ bundled stopwords)
```

- **No userId, or any DB error/empty → bundled defaults** (`defaults.js`). The
  engine is byte-identical to its pre-Supabase behavior in that case.
- Every write bumps `tailor_profile.library_version`; the loader keys its caches on
  that version, so an edit invalidates the cache on the next tailor run.

## Files

| File | Role |
| --- | --- |
| `defaults.js` | The bundled library (one object); seed + fallback source. |
| `assemble.js` | Pure rows↔shapes converters (exact round-trip of the JSON). |
| `seed.js` | Idempotent per-user seed from defaults. |
| `loadLibrary.js` | Resolve the active library for a request (cache + fallback). |
| `validate.js` | Pure validators for the editor (errors + non-blocking warnings). |
| `apiSupport.js` / `crudRoute.js` | Auth + version-bump helpers; generic CRUD. |
| `../data/*.json` | The bundled defaults (still the seed + fallback). |
| `app/api/library/**` | REST: `GET /api/library`, per-dataset CRUD, `PUT profile`, `POST preview`. |
| `app/components/LibraryEditor.js` | The tabbed editor UI. |
| `supabase/migrations/*_tailor_library.sql` | The schema (RLS per user). |

## Operating it

1. **Apply the migration:** `supabase db push` (creates the `tailor_*` tables + RLS).
2. **Service-role key:** the engine's loader reads each user's rows with the admin
   client, so `SUPABASE_SERVICE_ROLE_KEY` must be set (it already powers
   `lib/supabase/admin.js`). Without it, reads fail safely → bundled defaults.
3. **Use it:** open **`/library`** while signed in. Your library is seeded from the
   defaults on first load. Edit Buzzwords / Focus Areas / Skill Groups / Content
   Library / Profile, then use the **Preview** tab (paste a posting) to render the
   résumé + cover letter against your current library — no AI involved.

## Editing guidance (what the validators enforce / warn)

- **Buzzwords:** `canonical` + a valid `category`; aliases are the lowercased
  synonyms matched in postings. Avoid ultra-generic single-word aliases (e.g.
  `next`) — they cause false matches; the editor warns about these.
- **Focus areas:** `match` terms should be **discriminative** role/discipline phrases
  (e.g. "Solution Architect", "Design System") — not generic skills every posting
  lists — or the area mis-activates. An area with no `match` terms never activates.
- **Content fragments:** `frag_id` is a slug; `slots` are the placeholder names the
  fragment can fill; mark invented metrics/spin as `fabricated` (only used at high
  aggressiveness).
