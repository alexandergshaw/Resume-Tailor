// The client-side pre-flight size guard, and the one constant that bounds it
// on both sides of the wire.
//
// Vercel caps a function's request body at 4.5 MB flat, before route code
// ever runs -- a platform 413 that carries none of this app's messaging. The
// guard below is applied before the upload leaves the browser (AC-S22a) and
// again by the route on the same constant (AC-S22b), so a request that
// would trip Vercel's own limit never gets there: the user always sees this
// app's message, never a bare platform error.

import { DRIVE_BATCH_MESSAGE } from "./driveMessages.js";

// Enforced twice from this one export: once client-side (this module) and
// once server-side (the /api/drive/save route imports the same constant).
// 4,000,000 bytes — comfortably under Vercel's 4.5 MB body cap, leaving
// headroom for the rest of the multipart envelope (the "meta" JSON part and
// multipart boundaries).
export const DRIVE_UPLOAD_MAX_BYTES = 4_000_000;

// The ceiling for a files.export download (AC-D6a/AC-D9). Exports aren't
// bound by Vercel's *request* body limit -- they bound the *response* size
// this app is willing to buffer into an ArrayBuffer.
export const DRIVE_EXPORT_MAX_BYTES = 10_000_000;

// The message shown when a document is too large to upload. This is
// `driveMessages.js`'s `DRIVE_BATCH_MESSAGE.tooLargeUpload` VERBATIM --
// `driveMessages.js` is the single source of record for this string
// (WAVE2-SEAMS.md MAJOR-7 collapsed three independently-spelled variants
// down to this one). It is deliberately digit-free and never blames
// Google -- Drive itself accepts files up to 5 TB, so naming "Drive's
// limit" here would be a straight-up lie about which system drew the line
// and would misdirect anyone trying to work around it; this names THIS
// APP's own decision instead, and always offers a real recovery (the local
// .docx download, unaffected by this guard) rather than a dead end.
// Deliberately takes no `bytes` argument: the canonical string never varies
// by the file's actual size, so there is nothing to interpolate.
export function oversizeMessage() {
  return DRIVE_BATCH_MESSAGE.tooLargeUpload;
}
