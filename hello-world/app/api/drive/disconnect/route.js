import { getAuth, unauthorized, configGate, storageUnavailable, driveJson } from "@/lib/drive/routeSupport";
import { disconnectDrive } from "@/lib/drive/driveTokens";

export const runtime = "nodejs";

/**
 * DELETE /api/drive/disconnect
 *
 * AC-C19a/b/c. `disconnectDrive` (lib/drive/driveTokens.js) already does the
 * two things that matter here: it revokes at Google BEST-EFFORT — a failed
 * revocation does not block the local delete — and it reports the local
 * delete's OWN confirmed result rather than assuming success from a
 * non-throwing call. This route's only job is to turn that into the right
 * HTTP outcome: 2xx ONLY when the delete is confirmed, and a genuine storage
 * failure is 503, NEVER `{ disconnected: true }` over a record that is still
 * sitting there — exactly the defect `lib/gmail/gmailClient.js`'s
 * `deleteTokens` has (it ignores the response status of its own delete
 * call), which is the bug AC-C19c/AC-C20d exist to not repeat.
 */
export async function DELETE() {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  const gate = configGate();
  if (gate) return gate;

  const { deleted, error } = await disconnectDrive(userId);

  if (error || !deleted) return storageUnavailable();

  return driveJson({ disconnected: true }, { status: 200 });
}
