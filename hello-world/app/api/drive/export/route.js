// GET /api/drive/export?fileId=… — ARCH.md §7.6. Converts a saved Google Doc
// back to `.docx` bytes and returns them as the raw response body, so the
// client can build a `Blob` and hand it to `triggerBlobDownload` (never done
// here — that function lives in `lib/document/download.js` and is a
// client-side concern).
//
// Routes through `lib/drive/driveClient.js`'s `exportDocx` only — never
// `drive.files.*` directly (the `[src]` sweep in `driveSourceSweep.test.js`
// would fail this file otherwise). `exportDocx` is the one function in this
// feature that already gets `responseType: "arraybuffer"` right as the
// SECOND argument to `files.export` — get that wrong and gaxios silently
// hands back a `Blob`, and `Buffer.from(blob)` produces a garbage 0/1-byte
// buffer instead of throwing (driveClient.js's own header).
//
// `files.export` is a GET, so gaxios retries it automatically (AC-E8c) —
// this route deliberately does NOT wrap it in this feature's own retry
// logic, unlike the save route's create/update calls.

import { getAuth, configGate, notConnected, storageUnavailable, driveJson, badRequest, unauthorized } from "@/lib/drive/routeSupport";
import { authorizedDriveClient } from "@/lib/drive/driveTokens";
import { exportDocx } from "@/lib/drive/driveClient";
import { classifyDriveError, DRIVE_ERROR_KIND } from "@/lib/drive/driveErrors";
import { DRIVE_EXPORT_MAX_BYTES } from "@/lib/drive/driveSize";
import { DOCX_MIME } from "@/lib/drive/driveMime";

export const runtime = "nodejs";

// AC-D6a/AC-D9: the message names THIS APP's 10 MB export ceiling, computed
// from the one exported constant rather than re-typed.
function oversizeExportMessage() {
  const mb = Math.round(DRIVE_EXPORT_MAX_BYTES / (1024 * 1024));
  return `That Google Doc is larger than the ${mb} MB limit this app allows for a Drive download. Open it in Google Docs and export it there.`;
}

function driveErrorResponse(err) {
  const kind = classifyDriveError(err);
  switch (kind) {
    case DRIVE_ERROR_KIND.RECONNECT:
      return notConnected();
    case DRIVE_ERROR_KIND.GONE:
      return driveJson({ error: "drive_gone" }, { status: 404 }); // AC-D8b, AC-E11/E12
    case DRIVE_ERROR_KIND.STORAGE_FULL:
      return driveJson({ error: "drive_storage_full" }, { status: 403 });
    case DRIVE_ERROR_KIND.REFUSED:
      return driveJson({ error: "drive_refused" }, { status: 403 });
    case DRIVE_ERROR_KIND.TRANSIENT:
      return driveJson({ error: "drive_transient" }, { status: 503 });
    default:
      return driveJson({ error: "drive_error" }, { status: 500 });
  }
}

export async function GET(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized(); // AC-D9

  const configResponse = configGate();
  if (configResponse) return configResponse;

  const { searchParams, origin } = new URL(request.url);
  const fileId = searchParams.get("fileId");
  if (typeof fileId !== "string" || !fileId) return badRequest("Missing fileId.");

  const redirectUri = `${origin}/api/drive/oauth2callback`;
  const auth = await authorizedDriveClient(userId, redirectUri);
  if (!auth.ok) {
    return auth.reason === "not_connected" ? notConnected() : storageUnavailable();
  }

  let bytes;
  try {
    bytes = await exportDocx(auth.drive, fileId); // AC-D3
  } catch (err) {
    return driveErrorResponse(err);
  }

  // AC-D6a/AC-D9: Vercel's response-body cap applies to an export's bytes
  // just as it applies to a save's request bytes — this is the "app's own
  // decision, not Drive's" ceiling the same way DRIVE_UPLOAD_MAX_BYTES is.
  if (bytes.length > DRIVE_EXPORT_MAX_BYTES) {
    return driveJson(
      { error: "payload_too_large", message: oversizeExportMessage(), limitBytes: DRIVE_EXPORT_MAX_BYTES },
      { status: 413 },
    );
  }

  // AC-D3's positive control: a Blob mis-read cannot produce a real "PK"
  // (.docx zip) header at bytes[0..1] — the raw bytes are handed straight
  // through here, unmodified, so that control is meaningful against this
  // response too.
  return new Response(bytes, { status: 200, headers: { "Content-Type": DOCX_MIME } });
}
