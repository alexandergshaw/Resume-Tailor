// Thin client for /api/copilot/ideal-project (N125), the worked example's two
// tiers: READY (a cache peek on the server, milliseconds) and TAILORED
// (`tailored: true`, a live per-question model call behind a server deadline).
// Mirrors answerClient.js's shape, with one deliberate difference: this NEVER
// throws. A worked example is an aid beside an answer, not the answer, so a
// failed request (offline, a non-2xx, an unparseable body, an aborted fetch
// when the question moves on) resolves to `null` and the caller decides what
// "no example" looks like — it must never surface as an error mid-question.
//
// `engine` is passed IN rather than read from the engine store here the way
// answerClient.js does, because the caller (useIdealProject) already holds it
// to decide whether to ask for TAILORED at all, and a second read could
// disagree with the first. The server still gates on it independently.
//
// Resolves to the parsed body (`{ tier, source, idealProject }`) or null.
export async function fetchIdealProject({ applicationId, question, engine, tailored = false, signal } = {}) {
  try {
    const res = await fetch("/api/copilot/ideal-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId, question, engine, ...(tailored ? { tailored: true } : {}) }),
      signal,
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}
