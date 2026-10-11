// THE ONE FETCH that fills the project-bullet detail store.
//
// EVERY FIELD IS LISTED EXPLICITLY, NEVER A SPREAD. The caller assembles its
// payload from a bullet, its project and a question; a spread would let any field
// any of those grows travel to a paid endpoint without anyone deciding it should.
//
// EVERY FAILURE COMES BACK AS AN ENUMERATED CODE, never as a provider string.
// The route refuses to put its own error text on the wire, so by the time a
// failure reaches here the raw message does not exist; what carries the
// diagnosis is the kind.

// The client's budget is deliberately LONGER than the route's own budget for its
// model call (PROJECT_BULLET_DETAIL_TIMEOUT_MS = 4000 in the route), so that when
// both fire the server's diagnosis wins the race and the reader is told "that
// took too long to look up" rather than "network error".
const CLIENT_TIMEOUT_MS = 6000;

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Ask the server for one bullet's detail.
 *
 * Resolves to `{ detail, empty }`. Rejects with an error carrying `code` in
 * `"timeout" | "http" | "network" | "parse" | "disabled"`; the store turns that
 * into an error record, so nothing here ever throws past it.
 */
export async function fetchProjectBulletDetail(request) {
  const payload = {
    bullet: request?.bullet ?? "",
    title: request?.title ?? "",
    siblingBullets: request?.siblingBullets ?? [],
    bulletIndex: request?.bulletIndex ?? 0,
    question: request?.question ?? "",
    applicationId: request?.applicationId ?? "",
    engine: request?.engine ?? "",
    userContext: request?.userContext ?? "",
  };

  let response;
  try {
    response = await fetch("/api/copilot/answer/project-bullet-detail", {
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
    throw coded(
      body?.code === "disabled" ? "disabled" : body?.code === "project_bullet_timeout" ? "timeout" : "http",
      "The request failed.",
    );
  }

  return {
    detail: typeof body?.detail === "string" ? body.detail : "",
    empty: body?.empty === true,
  };
}
