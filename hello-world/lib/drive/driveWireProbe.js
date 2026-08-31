// TEST-ONLY support module. Captures the HTTP request the REAL `googleapis`
// Drive client actually builds, so a test can assert what was REQUESTED
// rather than what the caller thought it requested. Sibling of
// `lib/llm/geminiWireProbe.js` — same problem, same fix, different SDK.
//
// WHY THIS HAS TO EXIST. `files.export` takes `mimeType` as a genuine
// top-level parameter; `files.update` does not — `Params$Resource$
// Files$Update` has `fileId`/`requestBody`/`media` and nothing else that
// reaches the request body. The installed request builder
// (`googleapis-common/build/src/apirequest.js`) lifts only `media`,
// `requestBody` (aliased `resource`), `auth` and `headers` out of the call's
// params before serializing every remaining key as a QUERY STRING (`:232`,
// `options.params = params`). So `drive.files.update({ fileId, mimeType,
// media })` does not throw: `mimeType` silently becomes `?mimeType=...`,
// the server ignores it, and — because `requestBody` is now absent — the
// upload downgrades to `uploadType=media`, a bare `.docx` PATCH with no
// conversion target (`:213`). That is how a user's native Google Doc gets
// silently flattened into a stored binary blob. No exception, no rejected
// promise, no console warning.
//
// An INJECTED FAKE DRIVE CLIENT CANNOT CATCH THIS CLASS OF BUG. A fake sees
// whatever object the caller hands it, so it would happily confirm a
// `mimeType` key that the real client drops on the floor. This project has
// already shipped a feature that was completely inert for exactly this
// reason — a key silently dropped by an SDK, with the test asserting the
// request shape against a fake that could never have seen the drop
// (`gemini-tools-nesting`).
//
// THE MECHANISM (verified against the installed `googleapis-common@8.0.1`
// source, not documentation). `createAPIRequest`
// (`apirequest.js:47-311`) accepts ANY plain object as `authClient` — it
// only checks `typeof authClient === 'object'` (`:292`) — and, after it has
// already split the call's params into `requestBody`/`media`/query-string
// (`:59-227`), calls `await authClient.request(options)` (`:308`) and hands
// the result back through the SDK's response marshalling. So a stub auth
// object standing in for the real `OAuth2Client` observes the fully-built
// request: the expanded URL, the final query-string params (with the real
// `paramsSerializer` the library would have used), and — for a multipart
// create/update — the actual bytes of the multipart body, metadata part and
// media part included. Nothing about the request construction is bypassed;
// only the network call at the very end is replaced.
//
// Lives in `lib/` rather than beside one test because both
// `driveClient.wire.test.js` (this wave) and `app/api/drive/save/route.
// wire.test.js` (a later wave) need it — same precedent as
// `lib/llm/geminiWireProbe.js` and `lib/copilot/practiceSessionTestDoubles.
// js`. Imported only by tests; costs the production bundle nothing.

import { google } from "googleapis";

/**
 * A captured request: the actually-dispatched HTTP shape, not the argument
 * object the caller passed to `drive.files.*`.
 *
 * @typedef {object} CapturedDriveRequest
 * @property {string} url - the fully expanded URL (path params substituted)
 * @property {string} method
 * @property {object} params - the query-string params object, AFTER path
 *   params have been stripped and BEFORE serialization — this is where a
 *   key the client silently relocated (e.g. a top-level `mimeType` on an
 *   update) shows up.
 * @property {string} queryString - `params` run through the SAME serializer
 *   function the real request used (`options.paramsSerializer`), so this is
 *   the literal query string that would have gone on the wire, not an
 *   approximation built by the test.
 * @property {string|undefined} bodyText - the raw request body as text:
 *   the full `multipart/related` payload (boundaries, both parts, and their
 *   `content-type` headers) for a create/update with media; the plain JSON
 *   string for a metadata-only write (e.g. folder create); `undefined` for
 *   a body-less request (e.g. `files.get`, `files.list`).
 */

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

async function bodyTextOf(options) {
  const { data } = options;
  if (data == null) return undefined;
  if (typeof data === "string") return data;
  if (typeof data.pipe === "function") return streamToString(data);
  // A metadata-only write (no media) sends the plain resource object as
  // `options.data` — not a stream, not a string.
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

/**
 * Runs `call(drive)` against a REAL `googleapis` Drive v3 client whose
 * transport is a stub `authClient` object, and returns every request the
 * client actually built.
 *
 * `call` receives the constructed `drive` client and is expected to invoke
 * one or more `lib/drive/driveClient.js` functions (or `drive.files.*`
 * directly) with it. It may reject — the canned response below is minimal
 * and a production caller may not like it once it starts inspecting the
 * result — and that is fine: the request has already been captured by the
 * time any rejection happens, so assert on the returned array, never on
 * `call`'s outcome. If `call` throws before issuing a request, the returned
 * array is empty, which fails any honest assertion loudly rather than
 * passing vacuously.
 *
 * @param {(drive: import('googleapis').drive_v3.Drive) => Promise<unknown>} call
 * @param {{ data?: object }} [opts] - `data` is the `Schema$File`-shaped
 *   body every captured call is answered with (default `{}`). Set it when
 *   `call`'s own logic branches on the response (e.g. a post-write mimeType
 *   check) — the SHAPE OF THE OUTGOING REQUEST is what this probe verifies;
 *   the canned response only exists so `call` can complete.
 * @returns {Promise<CapturedDriveRequest[]>}
 */
export async function captureDriveRequests(call, { data = {} } = {}) {
  const captured = [];
  const stubAuth = {
    // No `getUniverseDomain` — `apirequest.js:294` only calls it `if
    // (typeof authClient.getUniverseDomain === 'function')`, so its absence
    // is safe and deliberately not stubbed: this object is otherwise
    // exactly what the real `authClient.request(options)` call site sees.
    async request(options) {
      captured.push({
        url: options.url,
        method: options.method,
        params: { ...(options.params || {}) },
        queryString:
          options.params && typeof options.paramsSerializer === "function"
            ? options.paramsSerializer(options.params)
            : "",
        bodyText: await bodyTextOf(options),
      });
      return { data, status: 200, headers: {} };
    },
  };

  const drive = google.drive({ version: "v3", auth: stubAuth });

  try {
    await call(drive);
  } catch {
    // See the doc above: the response is canned, so a production caller
    // rejecting while processing it says nothing about the request that was
    // already captured.
  }
  return captured;
}

/**
 * The parsed JSON metadata part of a captured multipart request — i.e. the
 * `requestBody` the caller supplied, as it actually appeared on the wire.
 * `undefined` for a request with no multipart body (e.g. a metadata-only
 * folder create, `files.get`, `files.list`, `files.export`).
 *
 * Exists so a test reads `requestBodyOf(req)` rather than hand-rolling a
 * multipart parse at every call site.
 */
export function requestBodyOf(req) {
  const text = req?.bodyText;
  if (typeof text !== "string") return undefined;
  const parts = text.split(/--[^\r\n]+\r\n/).filter((p) => p.trim().length > 0);
  const metaPart = parts.find((p) => p.startsWith("content-type: application/json"));
  if (!metaPart) return undefined;
  const jsonText = metaPart.slice(metaPart.indexOf("\r\n\r\n") + 4).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return undefined;
  }
}

/**
 * The `content-type` declared on a captured multipart request's MEDIA part
 * (the second part — the uploaded file bytes, not the JSON metadata).
 * `undefined` for a request with no multipart media part.
 */
export function mediaContentTypeOf(req) {
  const text = req?.bodyText;
  if (typeof text !== "string") return undefined;
  const parts = text.split(/--[^\r\n]+\r\n/).filter((p) => p.trim().length > 0);
  const mediaPart = parts.find((p) => !p.startsWith("content-type: application/json"));
  if (!mediaPart) return undefined;
  const match = mediaPart.match(/^content-type: ([^\r\n]+)/);
  return match ? match[1] : undefined;
}
