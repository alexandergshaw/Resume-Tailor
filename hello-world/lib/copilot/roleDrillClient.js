// AC-Q4 - thin browser clients for the two "Speak as" role-drill routes,
// same shape as lib/copilot/questionClient.js (fetch, pass the selected
// engine, throw the server's own error message on a non-ok response).
//
// The one property worth calling out is what these functions do NOT send.
// This drill is about how a professional role SOUNDS - cadence, register,
// terms of art - not about the user's own resume, cover letter, prep
// context or job posting. Those never had a reason to travel with either
// request, so the request bodies below list every field they send, in full,
// on purpose: role/asked/engine for the situation, and
// role/situationId/situationPrompt/engine for the response. Nothing else.
// Adding a field to either body later should be a deliberate, visible edit
// to this file, not something that rides along inside a spread.

import { readEngine } from "@/app/settings/engine";

// -> { role, situation: { id, prompt, context }, source, exhausted }
//
// `asked` is the array of situation PROMPT strings already shown this
// session (same convention lib/copilot/questionClient.js uses for
// interview questions) so the server can avoid repeating one.
export async function fetchRoleSituation({ role, asked }) {
  const res = await fetch("/api/copilot/role-situation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, asked, engine: readEngine() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Role situation request failed (${res.status}).`);
  }
  return json;
}

// -> { role, lines, cadence, terms, termsUsed, avoid, source }
export async function fetchRoleResponse({ role, situationId, situationPrompt }) {
  const res = await fetch("/api/copilot/role-response", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, situationId, situationPrompt, engine: readEngine() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Role response request failed (${res.status}).`);
  }
  return json;
}
