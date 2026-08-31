// GET /api/drive/documents?jobId=… — ARCH.md §11's durable per-scope Drive
// reference, hydrated once per posting: `{fileId, contentHash, version,
// webViewLink}` for each `DOCX_SCOPES` entry that has a `drive_documents`
// row for (this user, the posting's position, scope).
//
// Pure Supabase read — this route never builds a Drive client and never
// imports `driveTokens.js` or `driveClient.js`. Connection LIVENESS is a
// separate concern the client already gets from `GET /api/drive/status`
// (AC-D1: "Download from Drive" is gated on a row existing AND the
// connection being live — the second half is not this route's job).
//
// No `jobId`, or a `jobId` with no resolvable `position_id` (AC-P14/P15: not
// tracked, or the posting predates this feature) both return an EMPTY map at
// 200, never an error — there is nothing durable to report, which is not the
// same as a failure.

import { getAuth, configGate, storageUnavailable, driveJson, unauthorized } from "@/lib/drive/routeSupport";
import { resolvePositionId, listDriveDocuments } from "@/lib/supabase/driveDocuments";

export const runtime = "nodejs";

function toReference(row) {
  return {
    fileId: row.drive_file_id,
    contentHash: typeof row.drive_content_hash === "string" ? row.drive_content_hash : null,
    version: typeof row.drive_file_version === "string" ? row.drive_file_version : null,
    webViewLink: typeof row.drive_web_view_link === "string" ? row.drive_web_view_link : null,
  };
}

export async function GET(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const configResponse = configGate();
  if (configResponse) return configResponse;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (typeof jobId !== "string" || !jobId) return driveJson({ documents: {} });

  const positionId = await resolvePositionId(supabase, jobId);
  if (!positionId) return driveJson({ documents: {} }); // AC-P14/P15

  const { documents, error } = await listDriveDocuments(supabase, userId, positionId);
  if (error) return storageUnavailable(); // AC-C4: any real store error, never a silent empty map

  const out = {};
  for (const [scope, row] of Object.entries(documents || {})) {
    out[scope] = toReference(row);
  }
  return driveJson({ documents: out });
}
