// THE ONE FETCH that fills the expansion store.
//
// EVERY FIELD IS LISTED EXPLICITLY, NEVER A SPREAD. The caller assembles its
// payload from a line object, a grounding record and a settings read; a spread
// would let any field any of those three grows travel to a paid endpoint
// without anyone deciding it should.
//
// NO `stream` FIELD. Not a flag that is ignored: a field this client does not
// have and that route does not read. The contrast worth keeping in view is
// answerClient.js, which exposes `draftAnswer` and `draftAnswerStreaming` as
// TWO exported functions rather than one request with a caller-chosen flag.
//
// EVERY FAILURE COMES BACK AS AN ENUMERATED CODE, never as a provider string.
// The route refuses to put its own error text on the wire, so by the time a
// failure reaches here the raw message does not exist; what carries the
// diagnosis is the kind.

// Deliberately LONGER than the route's own 4000ms budget for its model call.
// When both fire, the server's own diagnosis wins the race, so the reader is
// told "that took too long to look up" rather than "network error".
const CLIENT_TIMEOUT_MS = 6000;

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Ask the server for one bullet's sub-bullets.
 *
 * Resolves to `{ subBullets, caption, empty }`. Rejects with an error carrying
 * `code` in `"timeout" | "http" | "network" | "parse" | "disabled"`.
 */
export async function fetchExpansion(request) {
  const payload = {
    question: request?.question ?? "",
    parentPoint: request?.parentPoint ?? "",
    points: request?.points ?? [],
    pointIndex: request?.pointIndex ?? 0,
    applicationId: request?.applicationId ?? "",
    profile: request?.profile ?? "",
    interviewType: request?.interviewType ?? "",
    codeLanguage: request?.codeLanguage ?? "",
    engine: request?.engine ?? "",
  };

  let response;
  try {
    response = await fetch("/api/copilot/answer/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw coded("timeout", "The request took too long.");
    }
    throw coded("network", "The request could not be sent.");
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw coded("parse", "The response could not be read.");
  }

  if (!response.ok) {
    // The kill switch is its own code so the UI can say the feature is off and
    // offer NO Retry: retrying something an operator switched off is a lie.
    throw coded(body?.code === "disabled" ? "disabled" : body?.code === "expansion_timeout" ? "timeout" : "http", "The request failed.");
  }

  return {
    subBullets: Array.isArray(body?.subBullets) ? body.subBullets : [],
    caption: typeof body?.caption === "string" ? body.caption : "",
    empty: body?.empty === true,
  };
}
