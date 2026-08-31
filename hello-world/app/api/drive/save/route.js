// POST /api/drive/save — ARCH.md §7.2 (create), §7.4 (update in place), §7.5
// (three-way conflict compare), §8.2 (guarded create). One document per
// request, multipart/form-data (§7.3): part `file` is the raw .docx `Blob`,
// part `meta` is JSON `{ jobId, scope, name, jobTitle, company, contentHash,
// knownRef?, clientVersion?, onConflict? }`.
//
// THIS ROUTE NEVER CALLS `drive.files.*` DIRECTLY. Every Drive write goes
// through `lib/drive/driveClient.js` — the single module the `[src]` sweep
// in `driveSourceSweep.test.js` permits to hold that call. That is what
// keeps the update call from ever being assembled by hand here, which is the
// one call shape (ARCH.md §8.1) that can silently flatten a user's native
// Google Doc into a stored binary blob without throwing.
//
// The guarded-create duplicate check (ARCH.md §8.2 / AC-P10) lives INSIDE
// `createDoc` (driveClient.js's own `files.list`-by-name lookup), gated by
// its own `adopt` flag rather than duplicated here. Only the plain
// no-known-ref create below (`adopt` defaults to true) runs it. The other
// two creates below pass `adopt: false` on purpose (WAVE4-SEAMS.md
// BLOCKER-1): a stale/gone/non-Doc replacement target, and the user's
// explicit "Save as a new Doc" choice, would otherwise have this same guard
// find and PATCH the exact Doc that call is required to leave untouched.
// See createDoc's own doc comment for the guard's mechanics, and
// WAVE4-REVERIFY.md MAJOR-2 for the residual risk that opt-out leaves open.

import { getAuth, configGate, notConnected, storageUnavailable, driveJson, badRequest, unauthorized } from "@/lib/drive/routeSupport";
import { authorizedDriveClient, saveDriveTokens } from "@/lib/drive/driveTokens";
import { createDoc, updateDoc, getDocMeta, ensureAppFolder } from "@/lib/drive/driveClient";
import { classifyDriveError, DRIVE_ERROR_KIND } from "@/lib/drive/driveErrors";
import { DOCS_MIME } from "@/lib/drive/driveMime";
import { DRIVE_UPLOAD_MAX_BYTES } from "@/lib/drive/driveSize";
import { resolvePositionId, listDriveDocuments, upsertDriveDocument } from "@/lib/supabase/driveDocuments";
import { DOCX_SCOPES } from "@/lib/tailor/documentScopes";

export const runtime = "nodejs";

// AC-S25: the message must name THIS APP's own 4 MB decision — never
// "Drive's limit" (Drive itself accepts files far larger; this ceiling is
// the multipart transport budget in ARCH.md §7.3). Computed from the one
// exported constant, never re-typed, so the two can't drift.
function oversizeUploadMessage() {
  const mb = Math.round(DRIVE_UPLOAD_MAX_BYTES / (1024 * 1024));
  return `This document is larger than the ${mb} MB limit this app allows for a Drive upload. Download it as .docx here instead.`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// WAVE4-SEAMS.md BLOCKER-1: a non-adopting create (see the two call sites
// below) must never land a Doc with the exact same name as the one it
// deliberately did not touch — an identically-named pair is not tellable
// apart in Drive's UI, which defeats the whole point of leaving the
// original alone. The suffix is fixed rather than uniqued against a live
// Drive listing on purpose: disambiguation only needs "tellable apart", and
// listing here to check would reintroduce exactly the adoption risk
// `adopt: false` exists to avoid.
function disambiguatedName(name, reason) {
  return `${name} (${reason})`;
}

// AC-E8: gaxios auto-retries neither POST (`files.create`) nor PATCH
// (`files.update`), so this feature's own code must. Transient only — a
// reconnect/refused/storage-full/gone classification is never worth a
// second attempt with the same credentials and the same request.
async function withTransientRetry(fn, { retries = 2, baseDelayMs = 20 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || classifyDriveError(err) !== DRIVE_ERROR_KIND.TRANSIENT) throw err;
      attempt += 1;
      await sleep(baseDelayMs * attempt);
    }
  }
}

// Maps a caught Drive/refresh error to this route's §7.3 response shape.
// RECONNECT reuses routeSupport's own `notConnected()` — a rejected token
// means the app should treat the caller as no-longer-connected, the same
// response AC-E4a specifies for the no-record case.
function driveErrorResponse(err) {
  const kind = classifyDriveError(err);
  switch (kind) {
    case DRIVE_ERROR_KIND.RECONNECT:
      return notConnected();
    case DRIVE_ERROR_KIND.STORAGE_FULL:
      return driveJson({ error: "drive_storage_full" }, { status: 403 });
    case DRIVE_ERROR_KIND.REFUSED:
      return driveJson({ error: "drive_refused" }, { status: 403 });
    case DRIVE_ERROR_KIND.TRANSIENT:
      return driveJson({ error: "drive_transient" }, { status: 503 });
    case DRIVE_ERROR_KIND.GONE:
      return driveJson({ error: "drive_gone" }, { status: 404 });
    default:
      // classifyDriveError's "unknown" — no machine code in ARCH.md §7.3's
      // closed list covers this case (a genuinely unclassifiable failure).
      // `driveSaveBatch.js` already has its own generic fallback copy for
      // an errorKind it doesn't recognise, so an unmapped code here degrades
      // gracefully on the client rather than needing a bespoke string.
      return driveJson({ error: "drive_error" }, { status: 500 });
  }
}

// The in-session-only reference a client holds — never durable, never read
// from `drive_documents`. Consulted whenever the durable row lookup above
// didn't resolve a ref, not only when there is no `position_id` at all
// (AC-P14, broadened by WAVE4-REVERIFY.md MAJOR-2 — see the call site).
function refFromKnownRef(knownRef) {
  if (!knownRef || typeof knownRef !== "object") return null;
  if (typeof knownRef.fileId !== "string" || !knownRef.fileId) return null;
  return { fileId: knownRef.fileId, version: typeof knownRef.version === "string" ? knownRef.version : null };
}

function refFromRow(row) {
  if (!row) return null;
  return { fileId: row.drive_file_id, version: row.drive_file_version ?? null };
}

export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized(); // AC-S24: zero Drive calls

  const configResponse = configGate();
  if (configResponse) return configResponse; // AC-C22a

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Invalid form data.");
  }

  const file = form.get("file");
  if (!file || typeof file === "string") return badRequest("Missing file.");

  const metaRaw = form.get("meta");
  let meta;
  try {
    meta = JSON.parse(typeof metaRaw === "string" ? metaRaw : "");
  } catch {
    return badRequest("Invalid meta.");
  }
  if (!meta || typeof meta !== "object") return badRequest("Invalid meta.");

  const scope = meta.scope;
  if (!DOCX_SCOPES.includes(scope)) return badRequest("Invalid scope.");

  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  if (!name) return badRequest("Missing name.");

  // AC-S22b/AC-S25: server-side backstop on the exact constant the client's
  // own pre-flight (driveSize.js) already applies — never re-typed.
  if (typeof file.size === "number" && file.size > DRIVE_UPLOAD_MAX_BYTES) {
    return driveJson(
      { error: "payload_too_large", message: oversizeUploadMessage(), limitBytes: DRIVE_UPLOAD_MAX_BYTES },
      { status: 413 },
    );
  }

  // WAVE4-SEAMS.md GAP 2: an empty upload must never reach Drive — it would
  // silently overwrite the user's real document with nothing, and it would
  // still come back mimeType:DOCS_MIME (Drive happily converts zero bytes
  // into a blank Doc), so the §8.1 post-write assertion below cannot catch
  // it either. Checked on the multipart part's own reported size, before
  // any Drive round trip, the same way the oversize guard above is.
  if (typeof file.size === "number" && file.size === 0) {
    return badRequest("The uploaded file is empty.");
  }

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/drive/oauth2callback`;
  const auth = await authorizedDriveClient(userId, redirectUri);
  if (!auth.ok) {
    return auth.reason === "not_connected" ? notConnected() : storageUnavailable(); // §9.5, AC-E4a
  }
  const { drive, connection } = auth;

  const positionId = await resolvePositionId(supabase, meta.jobId);

  let existingRef = null;
  if (positionId) {
    const { documents, error } = await listDriveDocuments(supabase, userId, positionId);
    if (error) return storageUnavailable(); // §9.5 / AC-C4: never "not_connected" for a real store failure
    existingRef = refFromRow(documents[scope]);
  }
  if (!existingRef) {
    // WAVE4-REVERIFY.md MAJOR-2: fall back to the client's session-local
    // knownRef whenever the durable row above didn't resolve one — not only
    // when there is no position id at all. Without this, the very next
    // "ordinary" save after a `Save as a new Doc` choice (or after any
    // plain create whose `drive_documents` upsert then failed) has no ref
    // in hand, falls into the plain-create branch below, and that branch's
    // `createDoc(..., { adopt: true })` — the one place in this route that
    // still keys adoption on a Doc's NAME rather than a known id, because at
    // this point there genuinely is no id anywhere else to key on — cannot
    // tell the Doc it (or a sibling request) just made apart from a
    // same-named Doc this app deliberately left untouched elsewhere. A
    // session-local knownRef, when the client has one, is exactly the
    // stored identity that closes that gap for the realistic case: the same
    // client, moments later, already holding the id its own previous
    // response handed it. AC-P14: still in-session only, never persisted.
    existingRef = refFromKnownRef(meta.knownRef);
  }

  let docxBuffer;
  try {
    docxBuffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return badRequest("Could not read the uploaded file.");
  }

  let folderId;
  try {
    folderId = await ensureAppFolder(drive, connection.folder_id || null); // ARCH.md §8.4
  } catch (err) {
    return driveErrorResponse(err);
  }
  if (folderId && folderId !== connection.folder_id) {
    // Best-effort write-back onto the connection row (§8.4 step 4). AWAITED
    // — not fire-and-forget — per WAVE4-SEAMS.md GAP 3/MAJOR-8: a Next.js
    // route handler on a serverless platform can be frozen or torn down the
    // instant the response is returned, so an un-awaited promise here is
    // not guaranteed to run to completion at all, which means the "healed
    // by the next save's cached-id read" claim in §8.4 would not actually
    // hold — there would be nothing to heal FROM. The write's own failure
    // still never blocks or fails the save itself; only the completion of
    // the attempt is awaited.
    try {
      // WAVE4-REVERIFY.md MAJOR-1's twin: `saveDriveTokens` RESOLVES
      // `{ connection: null, error }` on every realistic storage failure —
      // it only REJECTS if something outside its own try/catch throws. A
      // bare `try/catch` around the await alone would never see the
      // resolved-error shape, so log both.
      const { error: writeBackError } = await saveDriveTokens(userId, undefined, { folderId });
      if (writeBackError) {
        console.error("[drive] folder-id write-back failed:", writeBackError);
      }
    } catch (err) {
      // best-effort: a failure here just means the next save repeats
      // ensureAppFolder's find-or-create; nothing user-facing depends on it
      // — but it is still logged, never silently discarded.
      console.error("[drive] folder-id write-back threw:", err);
    }
  }

  let writeResult;
  let created = false;
  let replaced = false;

  try {
    if (!existingRef) {
      writeResult = await withTransientRetry(() => createDoc(drive, { name, folderId, docxBuffer }));
      created = true;
    } else {
      let docMeta = null;
      let gone = false;
      try {
        docMeta = await getDocMeta(drive, existingRef.fileId); // ARCH.md §7.4's pre-flight
      } catch (err) {
        if (classifyDriveError(err) === DRIVE_ERROR_KIND.GONE) {
          gone = true; // AC-E7: deleted target — no prompt, recreate and repoint
        } else {
          return driveErrorResponse(err);
        }
      }

      if (gone || docMeta.trashed || docMeta.explicitlyTrashed || docMeta.mimeType !== DOCS_MIME) {
        // AC-E9a/E9b/E10, AC-E13: deleted, trashed, or no longer a native
        // Doc — never PATCH into any of those states. Create a replacement.
        // `adopt: false` on all four cases (WAVE4-SEAMS.md BLOCKER-1(b)),
        // harmless even where nothing can collide, and it defends against a
        // Drive listing race. The old target's name is still exactly this
        // Doc's name, so a still-adopting `createDoc` would find IT and
        // PATCH it right back into a Doc — the identical bug the "never
        // PATCH into any of those states" comment above already forbids,
        // just reached through createDoc's internal guard instead of this
        // route's own check.
        //
        // WAVE4-REVERIFY.md MINOR-3: the disambiguating suffix itself is
        // applied only when there is actually something to disambiguate
        // FROM. `gone` (404) means the id doesn't resolve to anything
        // findable at all; `trashed`/`explicitlyTrashed` means it's excluded
        // by createDoc's own `trashed = false` filter. Only a target that's
        // still live, in the folder, and simply no longer a native Doc
        // (`docMeta.mimeType !== DOCS_MIME`) can actually be found by
        // createDoc's by-name lookup — that is the one case worth renaming
        // the recreated document to dodge.
        const collidesByName = Boolean(docMeta) && docMeta.mimeType !== DOCS_MIME;
        writeResult = await withTransientRetry(() =>
          createDoc(drive, {
            name: collidesByName ? disambiguatedName(name, "recovered") : name,
            folderId,
            docxBuffer,
            adopt: false,
          }),
        );
        created = true;
        replaced = true;
      } else if (meta.onConflict === "overwrite") {
        // The user already saw the conflict prompt and chose to overwrite.
        writeResult = await withTransientRetry(() => updateDoc(drive, { fileId: existingRef.fileId, docxBuffer }));
      } else if (meta.onConflict === "new") {
        // The user chose "Save as a new Doc" — the conflicted Doc is left
        // alone; a fresh one is created and becomes this app's tracked
        // reference for the scope going forward. `adopt: false` is
        // load-bearing here (WAVE4-SEAMS.md BLOCKER-1): the conflicted Doc
        // carries this exact name, so a plain `createDoc` call would find
        // and PATCH it via its own adoption guard — silently destroying the
        // very Doc this button exists to preserve, while still reporting
        // `created: true`.
        writeResult = await withTransientRetry(() =>
          createDoc(drive, { name: disambiguatedName(name, "new copy"), folderId, docxBuffer, adopt: false }),
        );
        created = true;
      } else {
        // ARCH.md §7.5 / AC-S14: the three-way compare. A two-way compare
        // (live Drive vs. the stored row, both read in this same request)
        // is blind to this app's OWN concurrency — see §7.5's tab-A/tab-B
        // example. `clientVersion` is what the client's session was
        // hydrated with when it started this save.
        const clientVersion = typeof meta.clientVersion === "string" ? meta.clientVersion : null;
        const rowVersion = existingRef.version;
        const driveVersion = typeof docMeta.version === "string" ? docMeta.version : null;

        if (clientVersion !== rowVersion) {
          return driveJson(
            { error: "conflict_session", fileId: existingRef.fileId, name: docMeta.name, webViewLink: docMeta.webViewLink },
            { status: 409 },
          );
        }
        if (rowVersion !== driveVersion) {
          return driveJson(
            { error: "conflict_foreign", fileId: existingRef.fileId, name: docMeta.name, webViewLink: docMeta.webViewLink },
            { status: 409 },
          );
        }
        writeResult = await withTransientRetry(() => updateDoc(drive, { fileId: existingRef.fileId, docxBuffer }));
      }
    }
  } catch (err) {
    return driveErrorResponse(err);
  }

  // ARCH.md §8.1's post-write assertion: a write that didn't come back as a
  // native Doc is NOT a success, however the request itself went — no link
  // row, no drive_documents write claiming a live Doc.
  if (!writeResult || writeResult.mimeType !== DOCS_MIME) {
    return driveJson({ error: "drive_not_converted" }, { status: 500 });
  }

  // AC-P8/P9a/P9b/P12: persistence is best-effort and never blocks the save
  // — the Doc already exists and the link already works even if this write
  // fails. AC-P13/P14: with no position id there is nothing durable to
  // write; the reference lives only in the client's session.
  let persisted = false;
  if (positionId) {
    const { document, error: upsertError } = await upsertDriveDocument(supabase, userId, positionId, scope, {
      driveFileId: writeResult.id,
      driveContentHash: typeof meta.contentHash === "string" ? meta.contentHash : null,
      driveFileVersion: typeof writeResult.version === "string" ? writeResult.version : null,
      driveWebViewLink: typeof writeResult.webViewLink === "string" ? writeResult.webViewLink : null,
    });
    persisted = !upsertError && Boolean(document);
  }

  return driveJson({
    scope,
    fileId: writeResult.id,
    name: writeResult.name,
    webViewLink: writeResult.webViewLink,
    version: writeResult.version,
    mimeType: writeResult.mimeType,
    created,
    replaced,
    persisted,
  });
}
