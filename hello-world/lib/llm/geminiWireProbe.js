// TEST-ONLY support module. Captures the JSON body the `@google/genai` SDK
// actually puts on the wire, so a test can assert what was REQUESTED rather
// than what the caller thought it requested.
//
// WHY THIS HAS TO EXIST. `GenerateContentParameters` has exactly three
// properties — `model`, `contents`, `config`. `tools` belongs to
// `GenerateContentConfig`. The SDK's parameter transformer reads only those
// three keys and silently discards everything else before building the
// request; a `tools` passed at the top level never reaches Google, with no
// error and no warning.
//
// Every grounded feature in this repo was written that way, and the tests that
// were supposed to pin the request shape asserted it against an INJECTED FAKE
// CLIENT. A fake sees whatever object the caller hands it, so it confirmed a
// `tools` that the real transport dropped — the assertions were permanently
// green against a request that never carried the key. The failure downstream
// is silent and total: no `tools` → no search → no `groundingMetadata` → every
// corroboration step drops every claim → the feature returns nothing while
// still paying for a full model call, looking exactly like a model that found
// nothing.
//
// Dependency injection is the right pattern for the pipeline and the wrong
// instrument for the transport. Whenever a test's claim is "we asked the
// service for X", it has to go through the real SDK and read the bytes.
//
// Lives in `lib/` rather than beside one test because eight test files need
// it, following the same precedent as
// `lib/copilot/practiceSessionTestDoubles.js`. It is imported only by tests
// and pulls in nothing at module scope, so it costs the bundle nothing.

// A minimal, well-formed generateContent response. Enough for the SDK to parse
// and hand back; callers that need specific text pass their own via `text`.
function okResponse(text) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Runs `call()` with `globalThis.fetch` stubbed, and returns every request body
 * the SDK sent, parsed.
 *
 * `call` is expected to invoke a real `GoogleGenAI` client. It may reject —
 * the caller is usually a production function that will go on to parse the
 * response and may not like the canned one — and that is fine: the request has
 * already been captured by then. A rejection is swallowed rather than
 * reported, so assert on the captured bodies, never on `call`'s outcome. If
 * the function throws BEFORE issuing its request the returned array is empty,
 * which fails any honest assertion loudly rather than passing vacuously.
 *
 * Restores the original `fetch` unconditionally.
 */
export async function captureGeminiRequests(call, { text = "{}" } = {}) {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    try {
      bodies.push(JSON.parse(init?.body));
    } catch {
      bodies.push(null); // a non-JSON body is still a request that happened
    }
    return okResponse(text);
  };
  try {
    await call();
  } catch {
    // See the doc above: the response is canned, so a production caller
    // rejecting while parsing it says nothing about the request.
  } finally {
    globalThis.fetch = original;
  }
  return bodies;
}

/**
 * The tool declarations on a captured request body, or `undefined` when the
 * request carried none. Exists so a test reads `toolsOf(body)` rather than
 * `body.tools` — the whole point is that the top-level key on the ARGUMENT
 * object is not the same thing as the key on the WIRE, and naming the accessor
 * keeps that distinction visible at every call site.
 */
export function toolsOf(body) {
  return body?.tools;
}
