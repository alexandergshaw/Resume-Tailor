// Thin client for the /api/copilot/detect route. Confirms whether an assembled
// interviewer utterance is a question and returns a cleaned, typed version.
// Returns { isQuestion, question, type }.
export async function confirmQuestion({ utterance, context }) {
  const res = await fetch("/api/copilot/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterance, context }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Detection failed (${res.status}).`);
  }
  return json;
}
