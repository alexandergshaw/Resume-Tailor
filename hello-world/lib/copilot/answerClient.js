// Thin client for the /api/copilot/answer route. Returns { points, type }.
export async function draftAnswer({ question, context }) {
  const res = await fetch("/api/copilot/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Answer request failed (${res.status}).`);
  }
  return json;
}
